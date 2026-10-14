import { shuffle, type Rng } from './random';
import type { Band, Domain, Tier } from './types';

export interface SelectableQuestion {
  id: string;
  domain: Domain;
  tier: Tier;
  bands: string[];
}

export interface SelectionResult {
  ids: string[];
  note: string | null;
}

/** Grade band from spec 6.2. grade = null means "Altceva". */
export function gradeBand(grade: number | null, ageBand: string): Band {
  if (grade !== null) return grade <= 8 ? 'lower' : 'upper';
  return ageBand === '16-17' || ageBand === '18plus' ? 'upper' : 'lower';
}

/**
 * Picks `count` questions of one tier, each from a different domain where possible.
 * Domains with at least one not-yet-answered question are preferred (spec 6.3 rule 7);
 * inside a domain an unanswered question is preferred over a repeat.
 */
function pickTier(
  pool: SelectableQuestion[],
  tier: Tier,
  count: number,
  answered: Set<string>,
  rng: Rng,
  notes: string[],
): SelectableQuestion[] {
  const byDomain = new Map<Domain, SelectableQuestion[]>();
  for (const q of pool) {
    if (q.tier !== tier) continue;
    const list = byDomain.get(q.domain) ?? [];
    list.push(q);
    byDomain.set(q.domain, list);
  }
  const domains = shuffle(rng, [...byDomain.keys()].sort());
  const fresh = domains.filter((d) => byDomain.get(d)!.some((q) => !answered.has(q.id)));
  const stale = domains.filter((d) => !fresh.includes(d));
  const ordered = [...fresh, ...stale];

  const chosen: SelectableQuestion[] = [];
  for (const d of ordered.slice(0, count)) {
    const list = byDomain.get(d)!;
    const unanswered = list.filter((q) => !answered.has(q.id));
    const from = unanswered.length > 0 ? unanswered : list;
    if (unanswered.length === 0) notes.push(`${tier}: repeated an answered question from ${d}`);
    chosen.push(shuffle(rng, from)[0]);
  }

  if (chosen.length < count) {
    // Not enough domains have this tier: fall back to a second question from an already used domain.
    notes.push(`${tier}: only ${chosen.length} domains available for ${count} slots; a domain is repeated`);
    const used = new Set(chosen.map((q) => q.id));
    const rest = shuffle(rng, pool.filter((q) => q.tier === tier && !used.has(q.id)));
    rest.sort((a, b) => Number(answered.has(a.id)) - Number(answered.has(b.id)));
    for (const q of rest) {
      if (chosen.length >= count) break;
      chosen.push(q);
    }
  }
  if (chosen.length < count) throw new Error(`Not enough ${tier} questions in the bank for this band`);

  const skipped = (['algorithms', 'data', 'worlds', 'web', 'ai'] as Domain[]).filter((d) => !byDomain.has(d));
  if (skipped.length > 0) {
    notes.push(`${tier}: no active question for ${skipped.join(', ')}`);
  }
  return chosen;
}

/** Spec 6.3: 2 warm-ups, then alternating hard/easy, always ending on easy. */
export function selectQuestions(
  all: SelectableQuestion[],
  band: Band,
  nQuestions: number,
  rng: Rng,
  answeredIds: Iterable<string> = [],
): SelectionResult {
  if (nQuestions < 4 || nQuestions % 2 !== 0) throw new Error('nQuestions must be even and >= 4');
  const answered = new Set(answeredIds);
  const pool = all.filter((q) => q.bands.includes(band));
  const notes: string[] = [];

  const warmups = pickTier(pool, 'warmup', 2, answered, rng, notes);
  const k = nQuestions - 2;
  const hard = pickTier(pool, 'hard', Math.ceil(k / 2), answered, rng, notes);
  const easy = pickTier(pool, 'easy', Math.floor(k / 2), answered, rng, notes);

  const ids = warmups.map((q) => q.id);
  for (let i = 0; i < k / 2; i++) {
    ids.push(hard[i].id, easy[i].id);
  }
  return { ids, note: notes.length ? notes.join('; ') : null };
}
