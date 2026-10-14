import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clearAll, writePre } from '@/lib/cookies';
import { env, isStudyOpen } from '@/lib/env';
import { HttpError, route } from '@/lib/session';

const body = z.object({ token: z.string(), assent: z.literal(true), test: z.boolean().optional() });

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  if (b.token !== env.studyToken) throw new HttpError(404, { error: 'not_found' });
  const test = b.test === true;
  if (!test && !isStudyOpen()) return NextResponse.json({ closed: true });
  await clearAll();
  await writePre({ assent: true, test, iat: Date.now(), names: [] });
  return NextResponse.json({ ok: true });
});
