import { NextResponse } from 'next/server';
import { clearAll } from '@/lib/cookies';
import { route } from '@/lib/session';

export const POST = route(async () => {
  await clearAll();
  return NextResponse.json({ ok: true });
});
