import { z } from 'zod';
import { escapeAnswer, type GradableQuestion } from './grader';
import { isLeaky } from './leakage';
import { callJson, type CallLogger } from './llm/call';
import { LEAK_RETRY_LINE, tutorSystem } from './prompts/tutor';
import type { Band } from './types';

export type TutorStatus = 'ok' | 'regenerated_ok' | 'leak_suspected' | 'failed';

export interface TutorResult {
  status: TutorStatus;
  text: string | null;
  callId: string | null;
}

const tutorOutputSchema = z.object({ text: z.string().trim().min(1) });

export function buildTutorUser(
  q: GradableQuestion,
  firstAnswer: string,
  misconception: string | null,
  band: Band,
): string {
  const m = misconception ? q.misconceptions.find((x) => x.tag === misconception) : undefined;
  const miscLine = m ? `${m.tag}: ${m.description}` : misconception === 'other' ? 'other (unlisted)' : 'none';
  return `<question>${q.prompt_ro}</question>
<reference_answer>${q.reference_answer_ro}</reference_answer>
<misconception>${miscLine}</misconception>
<grade_band>${band}</grade_band>
<learner_answer>
${escapeAnswer(firstAnswer)}
</learner_answer>`;
}

/** Writes a hint or a worked example, with the leakage guard of spec 9.4. */
export async function generateFeedback(opts: {
  kind: 'hint' | 'example';
  question: GradableQuestion;
  firstAnswer: string;
  misconception: string | null;
  band: Band;
  promptVersion: string;
  log: CallLogger;
  deadline?: number;
}): Promise<TutorResult> {
  const system = tutorSystem(opts.promptVersion, opts.kind);
  const user = buildTutorUser(opts.question, opts.firstAnswer, opts.misconception, opts.band);

  const first = await callJson({
    purpose: opts.kind,
    system,
    user,
    schema: tutorOutputSchema,
    promptVersion: opts.promptVersion,
    log: opts.log,
    deadline: opts.deadline,
  });
  if (first.status !== 'ok' || !first.value) return { status: 'failed', text: null, callId: first.callId };
  if (!isLeaky(opts.question.reference_answer_ro, first.value.text)) {
    return { status: 'ok', text: first.value.text, callId: first.callId };
  }

  if (opts.deadline && Date.now() + 15_000 > opts.deadline) {
    // No time left to regenerate within the route limit: deliver and flag.
    return { status: 'leak_suspected', text: first.value.text, callId: first.callId };
  }
  const second = await callJson({
    purpose: opts.kind,
    system,
    user: `${user}\n\n${LEAK_RETRY_LINE[opts.promptVersion] ?? LEAK_RETRY_LINE.v1}`,
    schema: tutorOutputSchema,
    promptVersion: opts.promptVersion,
    log: opts.log,
    attemptOffset: first.attempts,
    deadline: opts.deadline,
  });
  if (second.status !== 'ok' || !second.value) {
    // The regeneration failed: the first text exists, so deliver it and mark the suspected leak.
    return { status: 'leak_suspected', text: first.value.text, callId: first.callId };
  }
  if (isLeaky(opts.question.reference_answer_ro, second.value.text)) {
    return { status: 'leak_suspected', text: second.value.text, callId: second.callId };
  }
  return { status: 'regenerated_ok', text: second.value.text, callId: second.callId };
}
