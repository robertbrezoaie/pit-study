import './loadEnv';
import { readFileSync } from 'node:fs';
import { gradeAnswer, type GradableQuestion } from '../lib/grader';
import { env } from '../lib/env';
import { validateBank } from '../lib/questionSchema';

// Spec 7.6: runs the grader on seed/grader_smoke.json. Writes nothing to the database.
// Usage: npm run smoke:grader [-- --only ALG-E1,AI-H2] [--concurrency 4] [--delay 1500]
// --delay: pause (ms) per worker between items, for low provider rate limits (e.g. Mistral free tier).

interface SmokeItem {
  question_id: string;
  kind: 'level' | 'injection';
  answer: string;
  expected_score: number;
  expected_flags: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const bank = validateBank(JSON.parse(readFileSync('seed/questions.json', 'utf8')));
  const byId = new Map(bank.map((q) => [q.id, { ...q, version: 1 } as GradableQuestion & { bands: string[] }]));
  let items = JSON.parse(readFileSync('seed/grader_smoke.json', 'utf8')) as SmokeItem[];
  const only = arg('only')?.split(',');
  if (only) items = items.filter((i) => only.includes(i.question_id));
  const concurrency = Number(arg('concurrency') ?? 4);
  const delay = Number(arg('delay') ?? 0);
  const failureReasons = new Map<string, number>();
  const log = async (row: { status: string; response_text: string | null }) => {
    if (row.status !== 'ok') {
      const reason = `${row.status}: ${(row.response_text ?? '').slice(0, 160)}`;
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
    }
    return null;
  };
  console.log(`Grader: ${env.llmProvider} / ${env.graderModel}, prompt ${env.promptVersion}, ${items.length} items\n`);

  const results: { item: SmokeItem; score: number | null; flags: string[]; status: string; rationale?: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      const q = byId.get(item.question_id);
      if (!q) throw new Error(`Unknown question ${item.question_id}`);
      // Smoke answers are graded for the upper band unless the question is lower-only.
      const band = q.bands.includes('upper') ? 'upper' : 'lower';
      const g = await gradeAnswer({ question: q, text: item.answer, dontKnow: false, band, promptVersion: env.promptVersion, log });
      if (g.status === 'ok') {
        const flags = Object.entries(g.flags).filter(([, v]) => v).map(([k]) => k);
        results.push({ item, score: g.score, flags, status: 'ok', rationale: g.rationale });
      } else {
        results.push({ item, score: g.status === 'deterministic' ? 0 : null, flags: [], status: g.status });
      }
      process.stdout.write(g.status === 'failed' ? 'x' : '.');
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('\n');

  const levels = results.filter((r) => r.item.kind === 'level');
  const graded = levels.filter((r) => r.score !== null);
  const exact = graded.filter((r) => r.score === r.item.expected_score).length;
  const within1 = graded.filter((r) => Math.abs((r.score ?? 0) - r.item.expected_score) <= 1).length;
  const sameSide = graded.filter((r) => (r.score! >= 2) === (r.item.expected_score >= 2)).length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log(`Level items: ${levels.length} (grader failures: ${levels.length - graded.length})`);
  console.log(`  exact agreement:          ${exact}/${graded.length} (${pct(exact, graded.length)})`);
  console.log(`  within one point:         ${within1}/${graded.length} (${pct(within1, graded.length)})`);
  console.log(`  same correct/incorrect:   ${sameSide}/${graded.length} (${pct(sameSide, graded.length)})`);

  const mism = graded.filter((r) => r.score !== r.item.expected_score);
  if (mism.length) {
    console.log('\nMismatches (expected -> got):');
    for (const r of mism.sort((a, b) => a.item.question_id.localeCompare(b.item.question_id))) {
      console.log(`  ${r.item.question_id}  ${r.item.expected_score} -> ${r.score}  "${r.item.answer}"`);
      if (r.rationale) console.log(`      ${r.rationale}`);
    }
  }

  const inj = results.filter((r) => r.item.kind === 'injection');
  console.log(`\nInjection items: ${inj.length}`);
  let injOk = true;
  for (const r of inj) {
    const pass = r.score === 0 && r.flags.includes('gaming_attempt');
    injOk &&= pass;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${r.item.question_id}  score=${r.score} flags=[${r.flags.join(',')}]  "${r.item.answer}"`);
  }
  console.log(`\nAll injections flagged and scored 0: ${injOk ? 'YES' : 'NO'}`);
  if (failed) {
    console.log(`Grader failures: ${failed}. Reasons (per LLM call):`);
    for (const [reason, n] of failureReasons) console.log(`  ${n} x ${reason}`);
  }
  process.exit(injOk ? 0 : 1);
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
