import { describe, expect, it } from 'vitest';
import { computePropensities, decide, estimateThompsonProbs, type Posterior } from '@/lib/allocator';
import { sampleBeta } from '@/lib/beta';
import { createSecureRng } from '@/lib/random';
import { ARMS } from '@/lib/types';

const rng = createSecureRng();

describe('spec 8.5 – bandit allocator', () => {
  it('1. Beta sampler mean within 0.01 of a/(a+b)', () => {
    for (const [a, b] of [[1, 1], [2, 5], [30, 10]]) {
      let sum = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) sum += sampleBeta(a, b, rng);
      expect(Math.abs(sum / n - a / (a + b))).toBeLessThan(0.01);
    }
  });

  it('2. equal states give probsTS ≈ 1/3 each (±0.02)', () => {
    const post: Posterior = { plain: { a: 4, b: 4 }, hint: { a: 4, b: 4 }, example: { a: 4, b: 4 } };
    const p = estimateThompsonProbs(post, 5000, rng);
    for (const k of ARMS) expect(Math.abs(p[k] - 1 / 3)).toBeLessThan(0.02);
    // Beta(1,1) at the start of the study, too
    const p0 = estimateThompsonProbs({ plain: { a: 1, b: 1 }, hint: { a: 1, b: 1 }, example: { a: 1, b: 1 } }, 5000, rng);
    for (const k of ARMS) expect(Math.abs(p0[k] - 1 / 3)).toBeLessThan(0.02);
  });

  it('3. propensities sum to 1 and each is ≥ RANDOM_SHARE/3', () => {
    const states: Posterior[] = [
      { plain: { a: 1, b: 1 }, hint: { a: 1, b: 1 }, example: { a: 1, b: 1 } },
      { plain: { a: 2, b: 40 }, hint: { a: 40, b: 2 }, example: { a: 5, b: 5 } },
      { plain: { a: 100, b: 1 }, hint: { a: 1, b: 100 }, example: { a: 1, b: 100 } },
    ];
    for (const share of [0.5, 0.2, 1]) {
      for (const st of states) {
        const p = computePropensities(estimateThompsonProbs(st, 5000, rng), share);
        const sum = ARMS.reduce((s, k) => s + p[k], 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
        for (const k of ARMS) expect(p[k]).toBeGreaterThanOrEqual(share / 3 - 1e-12);
      }
    }
  });

  it('4. over 30,000 allocations, empirical arm frequencies match the logged propensities (±0.01)', () => {
    const post: Posterior = { plain: { a: 5, b: 10 }, hint: { a: 10, b: 5 }, example: { a: 3, b: 3 } };
    const probs = estimateThompsonProbs(post, 5000, rng);
    const counts = { plain: 0, hint: 0, example: 0 };
    let logged = { plain: 0, hint: 0, example: 0 };
    const n = 30_000;
    for (let i = 0; i < n; i++) {
      const a = decide(post, probs, 0.5, rng);
      counts[a.arm]++;
      logged = a.propensities;
      expect(a.propensity).toBe(a.propensities[a.arm]);
    }
    for (const k of ARMS) expect(Math.abs(counts[k] / n - logged[k])).toBeLessThan(0.01);
  });

  it('6. simulation: plain share in the Thompson half falls over time (printed, not asserted)', () => {
    const truth = { plain: 0.3, hint: 0.5, example: 0.5 };
    const post: Posterior = { plain: { a: 1, b: 1 }, hint: { a: 1, b: 1 }, example: { a: 1, b: 1 } };
    const windows: number[][] = [[], [], []];
    for (let t = 0; t < 300; t++) {
      const a = decide(post, estimateThompsonProbs(post, 1000, rng), 0.5, rng);
      if (a.half === 'thompson') windows[Math.floor(t / 100)].push(a.arm === 'plain' ? 1 : 0);
      const reward = rng() < truth[a.arm] ? 1 : 0;
      post[a.arm].a += reward;
      post[a.arm].b += 1 - reward;
    }
    const shares = windows.map((w) => (w.length ? (w.reduce((s, x) => s + x, 0) / w.length).toFixed(2) : '-'));
    console.log(`plain share in Thompson half, decisions 1–100 / 101–200 / 201–300: ${shares.join(' / ')}`);
    console.log('final posterior', JSON.stringify(post));
  });
});
