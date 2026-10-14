import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { allocate, type Posterior } from './allocator';
import { readPre, readSid } from './cookies';
import { db, DbError, llmLogger, must, UNIQUE_VIOLATION } from './db';
import { env, isStudyOpen } from './env';
import { gradeAnswer, type GradableQuestion, type GradeResult } from './grader';
import { secureRandom } from './random';
import { generateFeedback } from './tutor';
import type { Arm, Band, ClientState, FeedbackPayload, SessionStep } from './types';

// ---------- errors and route wrapper ----------

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json(err.body, { status: err.status });
      if (err instanceof ZodError) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      console.error(err);
      return NextResponse.json({ error: 'server' }, { status: 500 });
    }
  };
}

export const closedError = () => new HttpError(403, { closed: true });

// ---------- rows ----------

export interface SessionRow {
  id: string;
  participant_id: string;
  is_test: boolean;
  grade_band: Band;
  question_ids: string[];
  current_index: number;
  step: SessionStep;
  step_shown_at: string;
  completed_at: string | null;
}

export interface QuestionRow extends GradableQuestion {
  domain: string;
  bands: string[];
  active: boolean;
}

interface AnswerRow {
  id: string;
  attempt: number;
  text: string;
  grader_status: 'ok' | 'deterministic' | 'failed';
  score: number | null;
  misconception: string | null;
}

export interface DecisionRow {
  id: string;
  session_id: string;
  question_id: string;
  first_answer_id: string;
  assigned_arm: Arm;
  delivered_arm: Arm;
  feedback_text: string | null;
  tutor_status: string;
  decided_at: string;
  feedback_shown_at: string | null;
  retry_answer_id: string | null;
  reward: number | null;
  excluded_reason: string | null;
}

const SESSION_COLS = 'id, participant_id, is_test, grade_band, question_ids, current_index, step, step_shown_at, completed_at';
const ANSWER_COLS = 'id, attempt, text, grader_status, score, misconception';

// ---------- loaders ----------

const questionCache = new Map<string, { q: QuestionRow; at: number }>();

export async function getQuestion(id: string): Promise<QuestionRow> {
  const hit = questionCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.q;
  const q = must(await db().from('questions').select('*').eq('id', id).single(), 'load question') as QuestionRow;
  questionCache.set(id, { q, at: Date.now() });
  return q;
}

export async function loadSession(id: string): Promise<SessionRow | null> {
  const { data, error } = await db().from('sessions').select(SESSION_COLS).eq('id', id).maybeSingle();
  if (error) throw new DbError(error.message, error.code);
  return data as SessionRow | null;
}

async function loadAnswer(sessionId: string, questionId: string, attempt: 1 | 2): Promise<AnswerRow | null> {
  const { data, error } = await db()
    .from('answers')
    .select(ANSWER_COLS)
    .eq('session_id', sessionId)
    .eq('question_id', questionId)
    .eq('attempt', attempt)
    .maybeSingle();
  if (error) throw new DbError(error.message, error.code);
  return data as AnswerRow | null;
}

export async function loadDecision(sessionId: string, questionId: string): Promise<DecisionRow | null> {
  const { data, error } = await db()
    .from('decisions')
    .select('*')
    .eq('session_id', sessionId)
    .eq('question_id', questionId)
    .maybeSingle();
  if (error) throw new DbError(error.message, error.code);
  return data as DecisionRow | null;
}

async function usernameOf(participantId: string): Promise<string> {
  const p = must(await db().from('participants').select('username').eq('id', participantId).single(), 'load participant');
  return (p as { username: string }).username;
}

// ---------- state ----------

export async function buildState(s: SessionRow): Promise<ClientState> {
  const username = await usernameOf(s.participant_id);
  const inQuiz = s.step !== 'survey' && s.step !== 'done';
  const qid = inQuiz ? s.question_ids[s.current_index] : null;
  const q = qid ? await getQuestion(qid) : null;
  const state: ClientState = {
    step: s.step,
    username,
    index: s.current_index,
    total: s.question_ids.length,
    isTest: s.is_test,
    question: q ? { id: q.id, prompt: q.prompt_ro } : null,
  };
  if (s.step === 'explanation' && q) {
    const d = await loadDecision(s.id, q.id);
    state.explanation = q.explanation_ro;
    if (!d) {
      // first-answer grader failed: fallback text + explanation, no result line, no rating
      state.result = null;
      state.showRating = false;
    } else {
      state.result = d.reward === 1 ? 'success' : d.reward === 0 ? 'fail' : null;
      state.showRating = true;
    }
  }
  return state;
}

/** Pre-session or session state for GET /api/session/state. */
export async function currentState(): Promise<ClientState | { closed: true }> {
  const sid = await readSid();
  if (sid) {
    const s = await loadSession(sid);
    if (s) {
      if (!s.is_test && !isStudyOpen()) return { closed: true };
      return buildState(s);
    }
  }
  const pre = await readPre();
  if (!pre) return { step: 'start' };
  if (!pre.test && !isStudyOpen()) return { closed: true };
  if (pre.participantId && pre.username) return { step: 'profile', username: pre.username, reaction: pre.reaction ?? null };
  return { step: 'name' };
}

// ---------- guards and transitions ----------

export async function requireSession(): Promise<SessionRow> {
  const sid = await readSid();
  if (!sid) throw new HttpError(401, { error: 'no_session' });
  const s = await loadSession(sid);
  if (!s) throw new HttpError(401, { error: 'no_session' });
  if (!s.is_test && !isStudyOpen()) throw closedError();
  return s;
}

/** 409 with the current state when the request does not match the session's step/question. */
export async function expectStep(s: SessionRow, steps: SessionStep[], questionId?: string): Promise<void> {
  const ok = steps.includes(s.step) && (questionId === undefined || s.question_ids[s.current_index] === questionId);
  if (!ok) throw new HttpError(409, { error: 'state_mismatch', state: await buildState(s) });
}

/**
 * Moves the session from its current (step, index) to a new one. Conditional on the old values,
 * so two racing requests cannot both advance it. Returns the fresh session row either way.
 */
async function transition(
  s: SessionRow,
  to: SessionStep,
  index = s.current_index,
  extra: Record<string, unknown> = {},
): Promise<SessionRow> {
  const { data, error } = await db()
    .from('sessions')
    .update({ step: to, current_index: index, step_shown_at: new Date().toISOString(), ...extra })
    .eq('id', s.id)
    .eq('step', s.step)
    .eq('current_index', s.current_index)
    .select(SESSION_COLS)
    .maybeSingle();
  if (error) throw new DbError(error.message, error.code);
  return (data as SessionRow | null) ?? (await loadSession(s.id))!;
}

export async function advance(s: SessionRow): Promise<SessionRow> {
  const next = s.current_index + 1;
  return next < s.question_ids.length ? transition(s, 'question', next) : transition(s, 'survey');
}

export async function finishSurvey(s: SessionRow): Promise<SessionRow> {
  return transition(s, 'done', s.current_index, { completed_at: new Date().toISOString() });
}

// ---------- answers ----------

async function insertAnswer(row: Record<string, unknown>): Promise<{ id: string; inserted: boolean }> {
  const { data, error } = await db().from('answers').insert(row).select('id').single();
  if (!error) return { id: (data as { id: string }).id, inserted: true };
  if (error.code !== UNIQUE_VIOLATION) throw new DbError(error.message, error.code);
  const existing = await loadAnswer(row.session_id as string, row.question_id as string, row.attempt as 1 | 2);
  return { id: existing!.id, inserted: false };
}

function answerRow(
  s: SessionRow,
  q: QuestionRow,
  attempt: 1 | 2,
  text: string,
  dontKnow: boolean,
  shownAt: string,
  g: GradeResult,
) {
  const submitted = new Date();
  const ok = g.status === 'ok';
  return {
    session_id: s.id,
    question_id: q.id,
    question_version: q.version,
    attempt,
    text,
    dont_know: g.status === 'deterministic' ? g.dontKnow : dontKnow,
    shown_at: shownAt,
    submitted_at: submitted.toISOString(),
    response_ms: Math.max(0, submitted.getTime() - new Date(shownAt).getTime()),
    grader_status: g.status,
    score: g.status === 'failed' ? null : g.score,
    misconception: ok ? g.misconception : null,
    confidence: ok ? g.confidence : null,
    flags: ok ? g.flags : null,
    rationale: ok ? g.rationale : null,
    llm_call_id: g.status === 'deterministic' ? null : g.callId,
    // spec 7.4: only LLM-graded, non-warm-up, non-test answers are sampled for human rating
    rating_sample: ok && q.tier !== 'warmup' && !s.is_test && secureRandom() < env.ratingSampleP,
  };
}

export async function submitFirstAnswer(
  s: SessionRow,
  questionId: string,
  text: string,
  dontKnow: boolean,
): Promise<{ outcome: 'correct' | 'mistake' | 'grader_failed'; state: ClientState }> {
  const q = await getQuestion(questionId);
  const shownAt = s.step_shown_at;
  const g = await gradeAnswer({
    question: q,
    text,
    dontKnow,
    band: s.grade_band,
    promptVersion: env.promptVersion,
    log: llmLogger(s.id),
  });
  await insertAnswer(answerRow(s, q, 1, text, dontKnow, shownAt, g));
  // On a duplicate submit the stored answer wins, so the outcome is always derived from it.
  const a = (await loadAnswer(s.id, q.id, 1))!;
  const outcome = a.grader_status === 'failed' ? 'grader_failed' : (a.score ?? 0) >= 2 ? 'correct' : 'mistake';
  const to: SessionStep = outcome === 'correct' ? 'correct' : outcome === 'mistake' ? 'feedback' : 'explanation';
  const fresh = s.step === 'question' ? await transition(s, to) : s;
  return { outcome, state: await buildState(fresh) };
}

// ---------- feedback (allocation + tutor) ----------

const MIN_LOADING_MS = 1500;
const STALE_PENDING_MS = 40_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readPosterior(): Promise<Posterior> {
  const rows = must(await db().from('bandit_state').select('arm, a, b'), 'load bandit_state') as {
    arm: Arm;
    a: number;
    b: number;
  }[];
  const p = {} as Posterior;
  for (const r of rows) p[r.arm] = { a: r.a, b: r.b };
  if (!p.plain || !p.hint || !p.example) throw new Error('bandit_state is missing an arm');
  return p;
}

async function updateDecision(id: string, patch: Record<string, unknown>, onlyIfPending = false): Promise<DecisionRow | null> {
  let qb = db().from('decisions').update(patch).eq('id', id);
  if (onlyIfPending) qb = qb.eq('tutor_status', 'pending');
  const { data, error } = await qb.select('*').maybeSingle();
  if (error) throw new DbError(error.message, error.code);
  return data as DecisionRow | null;
}

function tutorFailedPatch(isTest: boolean) {
  return {
    tutor_status: 'failed',
    delivered_arm: 'plain',
    feedback_text: null,
    ...(isTest ? {} : { excluded_reason: 'tutor_failed' }),
  };
}

/** Idempotent: allocates once per mistake (rule 5), then returns the same feedback on every call. */
export async function getFeedback(s: SessionRow, questionId: string): Promise<FeedbackPayload> {
  const started = Date.now();
  // Phase log: if a request ever stalls, the Vercel logs show the last phase reached.
  const mark = (phase: string) =>
    console.log(JSON.stringify({ ev: 'feedback', sid: s.id, qid: questionId, phase, ms: Date.now() - started }));
  mark('start');
  const q = await getQuestion(questionId);
  let d = await loadDecision(s.id, q.id);
  let mine = false;

  if (!d) {
    const first = await loadAnswer(s.id, q.id, 1);
    if (!first || first.grader_status === 'failed' || (first.score ?? 0) >= 2) {
      throw new HttpError(409, { error: 'state_mismatch', state: await buildState(s) });
    }
    const posterior = await readPosterior();
    mark('posterior');
    const alloc = allocate(posterior, env.randomShare);
    const { data, error } = await db()
      .from('decisions')
      .insert({
        session_id: s.id,
        question_id: q.id,
        first_answer_id: first.id,
        allocator_half: alloc.half,
        assigned_arm: alloc.arm,
        delivered_arm: alloc.arm,
        propensity: alloc.propensity,
        propensities: alloc.propensities,
        thompson_probs: alloc.thompsonProbs,
        posterior_snapshot: alloc.posterior,
        tutor_status: alloc.arm === 'plain' ? 'not_needed' : 'pending',
        excluded_reason: s.is_test ? 'test' : null,
      })
      .select('*')
      .single();
    if (error && error.code !== UNIQUE_VIOLATION) throw new DbError(error.message, error.code);
    if (error) {
      d = await loadDecision(s.id, q.id);
    } else {
      d = data as DecisionRow;
      mine = true;
    }
    mark(mine ? `decided:${d!.assigned_arm}` : 'decision_exists');
    if (mine && d!.tutor_status === 'pending') {
      const kind = d!.assigned_arm as 'hint' | 'example';
      let res;
      try {
        res = await generateFeedback({
          kind,
          question: q,
          firstAnswer: first.text,
          misconception: first.misconception,
          band: s.grade_band,
          promptVersion: env.promptVersion,
          log: llmLogger(s.id),
          deadline: started + 27_000,
        });
      } catch (err) {
        console.error('tutor crashed', err);
        res = { status: 'failed' as const, text: null, callId: null };
      }
      const patch =
        res.status === 'failed' || !res.text
          ? { ...tutorFailedPatch(s.is_test), llm_call_id: res.callId }
          : { tutor_status: res.status, feedback_text: res.text, llm_call_id: res.callId };
      mark(`tutor:${res.status}`);
      d = (await updateDecision(d!.id, patch, true)) ?? (await loadDecision(s.id, q.id));
      mark('decision_updated');
    }
  }

  // Another request is generating this decision's feedback: wait for it, or give up on a stale one.
  while (d!.tutor_status === 'pending') {
    if (Date.now() - new Date(d!.decided_at).getTime() > STALE_PENDING_MS) {
      d = (await updateDecision(d!.id, tutorFailedPatch(s.is_test), true)) ?? (await loadDecision(s.id, q.id));
      break;
    }
    if (Date.now() - started > 25_000) throw new HttpError(503, { error: 'busy' });
    await sleep(500);
    d = await loadDecision(s.id, q.id);
  }

  if (!d!.feedback_shown_at) {
    await db().from('decisions').update({ feedback_shown_at: new Date().toISOString() }).eq('id', d!.id).is('feedback_shown_at', null);
  }
  const wait = MIN_LOADING_MS - (Date.now() - started);
  if (wait > 0) await sleep(wait);
  mark('done');

  return d!.delivered_arm === 'plain' ? { kind: 'plain' } : { kind: d!.delivered_arm, text: d!.feedback_text ?? undefined };
}

// ---------- retry ----------

export async function submitRetry(
  s: SessionRow,
  questionId: string,
  text: string,
  dontKnow: boolean,
): Promise<{ success: boolean | null; explanation: string; state: ClientState }> {
  const q = await getQuestion(questionId);
  const d = await loadDecision(s.id, q.id);
  if (!d || d.tutor_status === 'pending') throw new HttpError(409, { error: 'state_mismatch', state: await buildState(s) });

  // Blind grading: same function and prompt as the first attempt (rule 4).
  const g = await gradeAnswer({
    question: q,
    text,
    dontKnow,
    band: s.grade_band,
    promptVersion: env.promptVersion,
    log: llmLogger(s.id),
  });
  const shownAt = d.feedback_shown_at ?? d.decided_at;
  const ins = await insertAnswer(answerRow(s, q, 2, text, dontKnow, shownAt, g));

  if (ins.inserted) {
    const reward = g.status === 'failed' ? null : g.score >= 2 ? 1 : 0;
    const eligible = !s.is_test && d.delivered_arm === d.assigned_arm && reward !== null;
    must(
      await db().rpc('finalize_retry', {
        p_decision: d.id,
        p_retry_answer: ins.id,
        p_reward: reward,
        p_excluded: g.status === 'failed' ? 'retry_grader_failed' : null,
        p_update: eligible,
      }),
      'finalize_retry',
    );
  }
  const fresh = s.step === 'feedback' ? await transition(s, 'explanation') : s;
  const after = await loadDecision(s.id, q.id);
  const success = after?.reward === 1 ? true : after?.reward === 0 ? false : null;
  return { success, explanation: q.explanation_ro, state: await buildState(fresh) };
}

export async function getPreOrThrow() {
  const pre = await readPre();
  if (!pre) throw new HttpError(401, { error: 'no_assent' });
  if (!pre.test && !isStudyOpen()) throw closedError();
  return pre;
}
