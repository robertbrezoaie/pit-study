import { z } from 'zod';
import { DOMAINS, TIERS } from './types';

const ID_PREFIX: Record<(typeof DOMAINS)[number], string> = {
  algorithms: 'ALG',
  data: 'DATA',
  worlds: 'WRLD',
  web: 'WEB',
  ai: 'AI',
};
const TIER_LETTER: Record<(typeof TIERS)[number], string> = { warmup: 'W', easy: 'E', hard: 'H' };

export const questionSchema = z
  .object({
    id: z.string().regex(/^(ALG|DATA|WRLD|WEB|AI)-[WEH]\d+$/),
    domain: z.enum(DOMAINS),
    tier: z.enum(TIERS),
    bands: z.array(z.enum(['lower', 'upper'])).min(1),
    prompt_ro: z.string().min(1),
    reference_answer_ro: z.string().min(1),
    rubric: z.object({ '0': z.string().min(1), '1': z.string().min(1), '2': z.string().min(1), '3': z.string().min(1) }).strict(),
    misconceptions: z.array(z.object({ tag: z.string().regex(/^[a-z0-9_]+$/), description: z.string().min(1) }).strict()),
    explanation_ro: z.string().min(1),
  })
  .strict()
  .superRefine((q, ctx) => {
    const expected = `${ID_PREFIX[q.domain]}-${TIER_LETTER[q.tier]}`;
    if (!q.id.startsWith(expected)) {
      ctx.addIssue({ code: 'custom', message: `id ${q.id} does not match domain/tier (expected prefix ${expected})` });
    }
  });

export type SeedQuestion = z.infer<typeof questionSchema>;

/** Validates a whole bank: each entry, unique ids, unique misconception tags across the bank. */
export function validateBank(raw: unknown): SeedQuestion[] {
  const bank = z.array(questionSchema).parse(raw);
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const q of bank) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id ${q.id}`);
    ids.add(q.id);
    for (const m of q.misconceptions) {
      if (m.tag === 'other') throw new Error(`Misconception tag "other" is reserved (${q.id})`);
      if (tags.has(m.tag)) throw new Error(`Duplicate misconception tag ${m.tag} (${q.id})`);
      tags.add(m.tag);
    }
  }
  return bank;
}
