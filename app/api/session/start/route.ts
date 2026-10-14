import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readSid, writeSid } from '@/lib/cookies';
import { db, DbError, must } from '@/lib/db';
import { deviceFromUserAgent } from '@/lib/device';
import { env } from '@/lib/env';
import { seededRng } from '@/lib/random';
import { gradeBand, selectQuestions, type SelectableQuestion } from '@/lib/selection';
import { buildState, getPreOrThrow, HttpError, loadSession, route } from '@/lib/session';

const body = z.object({
  grade: z.number().int().min(4).max(12).nullable(),
  ageBand: z.enum(['under10', '10-11', '12-13', '14-15', '16-17', '18plus']),
  gender: z.enum(['boy', 'girl', 'undisclosed']),
  prior: z.enum(['yes', 'no', 'unsure']),
  setting: z.enum(['class', 'home', 'other']),
  browserPrior: z.boolean(),
});

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const pre = await getPreOrThrow();
  if (!pre.participantId) throw new HttpError(409, { error: 'no_username' });

  // A double click or a refresh after start must not create a second session.
  const existingSid = await readSid();
  if (existingSid) {
    const s = await loadSession(existingSid);
    if (s && s.participant_id === pre.participantId && s.step !== 'done') return NextResponse.json(await buildState(s));
  }

  const band = gradeBand(b.grade, b.ageBand);
  const priorSessions = must(
    await db().from('sessions').select('id, is_test').eq('participant_id', pre.participantId),
    'prior sessions',
  ) as { id: string; is_test: boolean }[];
  const priorCount = priorSessions.filter((r) => !r.is_test).length;
  let answered: string[] = [];
  if (priorSessions.length > 0) {
    const rows = must(
      await db().from('answers').select('question_id').in('session_id', priorSessions.map((r) => r.id)).eq('attempt', 1),
      'answered questions',
    ) as { question_id: string }[];
    answered = rows.map((r) => r.question_id);
  }

  const bank = must(await db().from('questions').select('id, domain, tier, bands').eq('active', true), 'load bank') as SelectableQuestion[];
  const seed = randomUUID();
  const sel = selectQuestions(bank, band, env.nQuestions, seededRng(seed), answered);

  const { data, error } = await db()
    .from('sessions')
    .insert({
      participant_id: pre.participantId,
      is_test: pre.test,
      assent: true,
      grade: b.grade,
      grade_band: band,
      age_band: b.ageBand,
      gender: b.gender,
      self_reported_prior: b.prior,
      setting: b.setting,
      prior_session_count: priorCount,
      browser_prior: b.browserPrior,
      device: deviceFromUserAgent(req.headers.get('user-agent')),
      question_ids: sel.ids,
      selection_seed: seed,
      selection_note: sel.note,
      name_reaction: pre.reaction ?? null,
      app_version: env.appVersion,
      prompt_version: env.promptVersion,
      grader_model: env.graderModel,
      tutor_model: env.tutorModel,
      random_share: env.randomShare,
    })
    .select('id')
    .single();
  if (error) throw new DbError(error.message, error.code);
  const sid = (data as { id: string }).id;

  if (pre.reactionCallId) {
    await db().from('llm_calls').update({ session_id: sid }).eq('id', pre.reactionCallId).is('session_id', null);
  }
  await writeSid(sid);
  return NextResponse.json(await buildState((await loadSession(sid))!));
});
