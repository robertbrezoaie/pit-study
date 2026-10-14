import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, DbError, UNIQUE_VIOLATION } from '@/lib/db';
import { buildState, expectStep, finishSurvey, requireSession, route } from '@/lib/session';

const scale = z.number().int().min(1).max(5);
const body = z.object({
  preferredHelp: z.enum(['plain', 'hint', 'example', 'unsure']),
  fair: scale,
  understood: scale,
  wantAgain: scale,
  comment: z.string().trim().max(2000).optional(),
});

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const s = await requireSession();
  await expectStep(s, ['survey']);
  const { error } = await db().from('surveys').insert({
    session_id: s.id,
    preferred_help: b.preferredHelp,
    fair: b.fair,
    understood: b.understood,
    want_again: b.wantAgain,
    comment: b.comment ? b.comment : null,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw new DbError(error.message, error.code);
  return NextResponse.json(await buildState(await finishSurvey(s)));
});
