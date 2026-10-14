import { NextResponse } from 'next/server';
import { z } from 'zod';
import { advance, buildState, expectStep, requireSession, route } from '@/lib/session';

const body = z.object({ questionId: z.string() });

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const s = await requireSession();
  await expectStep(s, ['correct', 'explanation'], b.questionId);
  return NextResponse.json(await buildState(await advance(s)));
});
