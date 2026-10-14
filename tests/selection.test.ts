import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBank } from '@/lib/questionSchema';
import { createSecureRng, seededRng } from '@/lib/random';
import { gradeBand, selectQuestions } from '@/lib/selection';
import type { Band } from '@/lib/types';

const bank = validateBank(JSON.parse(readFileSync('seed/questions.json', 'utf8')));
const byId = new Map(bank.map((q) => [q.id, q]));
const rng = createSecureRng();

describe('acceptance 15 – question selection', () => {
  for (const band of ['lower', 'upper'] as Band[]) {
    for (const n of [12, 10]) {
      it(`${band} band, N_QUESTIONS = ${n}: 1,000 sessions satisfy every rule`, () => {
        for (let i = 0; i < 1000; i++) {
          const { ids, note } = selectQuestions(bank, band, n, rng);
          const qs = ids.map((id) => byId.get(id)!);
          expect(ids.length).toBe(n);
          expect(new Set(ids).size).toBe(n); // no repeats
          expect(qs.every((q) => q.bands.includes(band))).toBe(true);
          // positions 1–2: warm-ups from two different domains
          expect(qs[0].tier).toBe('warmup');
          expect(qs[1].tier).toBe('warmup');
          expect(qs[0].domain).not.toBe(qs[1].domain);
          expect(qs.slice(2).every((q) => q.tier !== 'warmup')).toBe(true);
          // W W H E H E … : no two hard questions adjacent, last is easy
          for (let k = 2; k < n; k++) expect(qs[k].tier).toBe(k % 2 === 0 ? 'hard' : 'easy');
          for (let k = 1; k < n; k++) expect(qs[k].tier === 'hard' && qs[k - 1].tier === 'hard').toBe(false);
          expect(qs[n - 1].tier).toBe('easy');
          // within each tier no domain appears twice
          for (const tier of ['warmup', 'easy', 'hard']) {
            const d = qs.filter((q) => q.tier === tier).map((q) => q.domain);
            expect(new Set(d).size).toBe(d.length);
          }
          expect(note).toBeNull();
        }
      });
    }
  }

  it('N = 12 gives one easy and one hard question per domain', () => {
    const { ids } = selectQuestions(bank, 'lower', 12, rng);
    const qs = ids.map((id) => byId.get(id)!);
    for (const tier of ['easy', 'hard']) {
      expect(new Set(qs.filter((q) => q.tier === tier).map((q) => q.domain)).size).toBe(5);
    }
  });

  it('the same seed reproduces the same selection', () => {
    const a = selectQuestions(bank, 'upper', 12, seededRng('abc'));
    const b = selectQuestions(bank, 'upper', 12, seededRng('abc'));
    expect(a.ids).toEqual(b.ids);
  });

  it('returning learners get unanswered questions when enough remain', () => {
    const first = selectQuestions(bank, 'lower', 12, rng).ids;
    for (let i = 0; i < 100; i++) {
      const second = selectQuestions(bank, 'lower', 12, rng, first).ids;
      expect(second.filter((id) => first.includes(id))).toEqual([]);
    }
  });

  it('upper-only questions never reach the lower band', () => {
    for (let i = 0; i < 500; i++) {
      const { ids } = selectQuestions(bank, 'lower', 12, rng);
      expect(ids).not.toContain('DATA-H3');
      expect(ids).not.toContain('AI-H6');
    }
  });

  it('a domain without an active question of a tier is substituted and noted', () => {
    const reduced = bank.filter((q) => !(q.domain === 'web' && q.tier === 'hard'));
    const { ids, note } = selectQuestions(reduced, 'lower', 10, rng);
    const qs = ids.map((id) => byId.get(id)!);
    expect(qs.filter((q) => q.tier === 'hard').every((q) => q.domain !== 'web')).toBe(true);
    expect(note).toMatch(/hard: no active question for web/);
  });
});

describe('spec 6.2 – grade band', () => {
  it('maps grades and "Altceva"', () => {
    expect(gradeBand(4, '10-11')).toBe('lower');
    expect(gradeBand(8, '14-15')).toBe('lower');
    expect(gradeBand(9, '14-15')).toBe('upper');
    expect(gradeBand(12, '18plus')).toBe('upper');
    expect(gradeBand(null, '14-15')).toBe('lower');
    expect(gradeBand(null, 'under10')).toBe('lower');
    expect(gradeBand(null, '16-17')).toBe('upper');
    expect(gradeBand(null, '18plus')).toBe('upper');
  });
});
