import './loadEnv';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { db, must } from '../lib/db';
import { validateBank, type SeedQuestion } from '../lib/questionSchema';

// Upserts seed/questions.json by id. A question whose content changed gets version + 1 (spec 6.1).
// `active` is never touched here: deactivation is done by the researcher in Supabase.

const CONTENT_KEYS = ['domain', 'tier', 'bands', 'prompt_ro', 'reference_answer_ro', 'rubric', 'misconceptions', 'explanation_ro'] as const;

async function main() {
  const file = process.argv[2] ?? 'seed/questions.json';
  const bank = validateBank(JSON.parse(readFileSync(file, 'utf8')));
  console.log(`Validated ${bank.length} questions from ${file}`);

  const existing = must(await db().from('questions').select('*'), 'load questions') as (SeedQuestion & { version: number })[];
  const byId = new Map(existing.map((q) => [q.id, q]));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const q of bank) {
    const old = byId.get(q.id);
    if (!old) {
      must(await db().from('questions').insert({ ...q, version: 1 }), `insert ${q.id}`);
      inserted++;
      continue;
    }
    const changed = CONTENT_KEYS.some((k) => !isDeepStrictEqual(old[k], q[k]));
    if (!changed) {
      unchanged++;
      continue;
    }
    must(
      await db().from('questions').update({ ...q, version: old.version + 1, updated_at: new Date().toISOString() }).eq('id', q.id),
      `update ${q.id}`,
    );
    console.log(`  ${q.id}: content changed -> version ${old.version + 1}`);
    updated++;
  }
  const missing = existing.filter((q) => !bank.some((b) => b.id === q.id)).map((q) => q.id);
  console.log(`Inserted ${inserted}, updated ${updated}, unchanged ${unchanged}.`);
  if (missing.length) console.log(`In the database but not in the file (left as they are): ${missing.join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
