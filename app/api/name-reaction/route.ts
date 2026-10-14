import { NextResponse } from 'next/server';
import { NAME_REACTION_FALLBACKS } from '@/lib/copy';
import { readPre, writePre } from '@/lib/cookies';
import { pick, secureRandom } from '@/lib/random';
import { getPreOrThrow, HttpError, route } from '@/lib/session';

// The name reaction uses only the 8 fixed lines of spec 10.3 (researcher's decision, DECISIONS.md #36):
// the LLM wrote incorrect Romanian and off-tone content for children. No LLM call is made here.

export const POST = route(async () => {
  const pre = await getPreOrThrow();
  if (!pre.username) throw new HttpError(409, { error: 'no_username' });
  if (pre.reaction) return NextResponse.json({ text: pre.reaction });

  const text = pick(secureRandom, NAME_REACTION_FALLBACKS);
  const latest = await readPre();
  if (latest && latest.username === pre.username) await writePre({ ...latest, reaction: text, reactionCallId: null });
  return NextResponse.json({ text });
});
