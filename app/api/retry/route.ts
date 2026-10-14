import { NextResponse } from 'next/server';
import { z } from 'zod';
import { expectStep, requireSession, route, submitRetry } from '@/lib/session';

export const maxDuration = 30;
const body = z.object({ questionId: z.string(), text: z.string().max(600).optional(), dontKnow: z.boolean().optional() });

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const s = await requireSession();
  await expectStep(s, ['feedback'], b.questionId);
  return NextResponse.json(await submitRetry(s, b.questionId, (b.text ?? '').trim(), b.dontKnow === true));
});
