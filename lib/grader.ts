import { z } from 'zod';
import { callJson, type CallLogger } from './llm/call';
import { graderSystem } from './prompts/grader';
import type { Band, Tier } from './types';

export interface GradableQuestion {
  id: string;
  tier: Tier;
  version: number;
  prompt_ro: string;
  reference_answer_ro: string;
  rubric: Record<'0' | '1' | '2' | '3', string>;
  misconceptions: { tag: string; description: string }[];
  explanation_ro: string;
}

export interface GraderFlags {
  off_topic: boolean;
  gaming_attempt: boolean;
  wrong_language: boolean;
  needs_adult_attention: boolean;
}

export type GradeResult =
  | {
      status: 'ok';
      score: number;
      misconception: string | null;
      confidence: number;
      flags: GraderFlags;
      rationale: string;
      callId: string | null;
    }
  | { status: 'deterministic'; score: 0; dontKnow: boolean }
  | { status: 'failed'; callId: string | null };

/** Escapes < and > so the learner's text cannot close the <learner_answer> tag (spec 7.3). */
export function escapeAnswer(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The grader's user message. By construction it only receives the question, the band and the
 * answer text: never the attempt number, the arm or any feedback text (rule 4).
 */
export function buildGraderUser(q: GradableQuestion, answer: string, band: Band): string {
  const misc = q.misconceptions.map((m) => `- ${m.tag}: ${m.description}`).join('\n');
  return `<question>${q.prompt_ro}</question>
<reference_answer>${q.reference_answer_ro}</reference_answer>
<rubric>
0: ${q.rubric['0']}
1: ${q.rubric['1']}
2: ${q.rubric['2']}
3: ${q.rubric['3']}
</rubric>
<misconceptions>
${misc}
</misconceptions>
<grade_band>${band}</grade_band>
<learner_answer>
${escapeAnswer(answer)}
</learner_answer>`;
}

/**
 * Spec 7.1: "Nu știu", or near-empty after trimming. Digits count like letters (DECISIONS #28):
 * DATA-H1, DATA-H3 and WRLD-H3 have numeric answers ("13", "12", "x = 12").
 */
export function deterministicCheck(text: string, dontKnow: boolean): { score: 0; dontKnow: boolean } | null {
  if (dontKnow) return { score: 0, dontKnow: true };
  const chars = text.trim().match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (chars < 2) return { score: 0, dontKnow: false };
  return null;
}

const flag = z.boolean().catch(false);

export const graderOutputSchema = z.object({
  score: z.number().int().min(0).max(3),
  misconception: z.string().nullable().catch(null),
  confidence: z.number().transform((c) => Math.min(1, Math.max(0, c))),
  flags: z
    .object({ off_topic: flag, gaming_attempt: flag, wrong_language: flag, needs_adult_attention: flag })
    .catch({ off_topic: false, gaming_attempt: false, wrong_language: false, needs_adult_attention: false }),
  rationale: z.string().catch(''),
});

export function normalizeMisconception(tag: string | null, q: GradableQuestion): string | null {
  if (tag === null || tag.trim() === '' || tag === 'null') return null;
  return q.misconceptions.some((m) => m.tag === tag) ? tag : 'other';
}

export async function gradeAnswer(opts: {
  question: GradableQuestion;
  text: string;
  dontKnow: boolean;
  band: Band;
  promptVersion: string;
  log: CallLogger;
}): Promise<GradeResult> {
  const det = deterministicCheck(opts.text, opts.dontKnow);
  if (det) return { status: 'deterministic', score: 0, dontKnow: det.dontKnow };

  const out = await callJson({
    purpose: 'grade',
    system: graderSystem(opts.promptVersion),
    user: buildGraderUser(opts.question, opts.text, opts.band),
    schema: graderOutputSchema,
    promptVersion: opts.promptVersion,
    log: opts.log,
  });
  if (out.status !== 'ok' || !out.value) return { status: 'failed', callId: out.callId };
  const v = out.value;
  return {
    status: 'ok',
    score: v.score,
    misconception: normalizeMisconception(v.misconception, opts.question),
    confidence: v.confidence,
    flags: v.flags,
    rationale: v.rationale,
    callId: out.callId,
  };
}
