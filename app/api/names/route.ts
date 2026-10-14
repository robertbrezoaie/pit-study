import { NextResponse } from 'next/server';
import { writePre } from '@/lib/cookies';
import { db, must } from '@/lib/db';
import { generateCandidates } from '@/lib/names';
import { getPreOrThrow, route } from '@/lib/session';

export const dynamic = 'force-dynamic';
const TEN_MIN = 10 * 60 * 1000;

export const GET = route(async () => {
  const pre = await getPreOrThrow();
  const now = Date.now();
  const recent = pre.names.filter((x) => now - x.t < TEN_MIN);
  const offered = new Set(recent.map((x) => x.n));

  let names: string[] = [];
  for (let round = 0; round < 5 && names.length < 3; round++) {
    const candidates = generateCandidates(6, new Set([...offered, ...names]));
    const taken = must(await db().from('participants').select('username').in('username', candidates), 'check names') as {
      username: string;
    }[];
    const takenLc = new Set(taken.map((t) => t.username.toLowerCase()));
    names = [...names, ...candidates.filter((c) => !takenLc.has(c.toLowerCase()))].slice(0, 3);
  }

  await writePre({ ...pre, names: [...recent, ...names.map((n) => ({ n, t: now }))].slice(-30) });
  return NextResponse.json({ names });
});
