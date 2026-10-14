import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { advance, buildState, expectStep, requireSession, route } from '@/lib/session';

const body = z.object({ questionId: z.string(), helpful: z.number().int().min(1).max(5).nullable() });

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const s = await requireSession();
  await expectStep(s, ['explanation'], b.questionId);
  if (b.helpful !== null) {
    await db().from('decisions').update({ helpful_rating: b.helpful }).eq('session_id', s.id).eq('question_id', b.questionId);
  }
  return NextResponse.json(await buildState(await advance(s)));
});
