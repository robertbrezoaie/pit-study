import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writePre } from '@/lib/cookies';
import { db, DbError, UNIQUE_VIOLATION } from '@/lib/db';
import { USERNAME_RE } from '@/lib/names';
import { getPreOrThrow, HttpError, route } from '@/lib/session';

const body = z.object({ mode: z.enum(['new', 'existing']), username: z.string().trim().min(1).max(40) });
const TEN_MIN = 10 * 60 * 1000;

export const POST = route(async (req: Request) => {
  const b = body.parse(await req.json());
  const pre = await getPreOrThrow();
  let participant: { id: string; username: string };

  if (b.mode === 'new') {
    const offered = pre.names.some((x) => x.n === b.username && Date.now() - x.t < TEN_MIN);
    if (!USERNAME_RE.test(b.username) || !offered) throw new HttpError(400, { error: 'invalid_name' });
    const { data, error } = await db().from('participants').insert({ username: b.username }).select('id, username').single();
    if (error?.code === UNIQUE_VIOLATION) throw new HttpError(409, { error: 'taken' });
    if (error) throw new DbError(error.message, error.code);
    participant = data;
  } else {
    // Case-insensitive exact match; the character check keeps ilike free of wildcards.
    if (!/^[A-Za-z0-9]+$/.test(b.username)) throw new HttpError(404, { error: 'not_found' });
    const { data, error } = await db().from('participants').select('id, username').ilike('username', b.username).maybeSingle();
    if (error) throw new DbError(error.message, error.code);
    if (!data) throw new HttpError(404, { error: 'not_found' });
    participant = data;
  }

  await writePre({ ...pre, participantId: participant.id, username: participant.username, reaction: undefined, reactionCallId: null });
  return NextResponse.json({ username: participant.username });
});
