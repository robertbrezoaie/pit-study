import { NextResponse } from 'next/server';
import { z } from 'zod';
import { expectStep, getFeedback, requireSession, route } from '@/lib/session';

export const maxDuration = 30;
const body = z.object({ questionId: z.string() });

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const s = await requireSession();
  await expectStep(s, ['feedback'], b.questionId);
  return NextResponse.json(await getFeedback(s, b.questionId));
});
