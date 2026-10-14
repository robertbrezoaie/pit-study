import { NextResponse } from 'next/server';
import { z } from 'zod';
import { NAME_REACTION_FALLBACKS } from '@/lib/copy';
import { readPre, writePre } from '@/lib/cookies';
import { llmLogger } from '@/lib/db';
import { env } from '@/lib/env';
import { callJson } from '@/lib/llm/call';
import { nameReactionPrompt } from '@/lib/prompts/names';
import { pick, secureRandom } from '@/lib/random';
import { getPreOrThrow, HttpError, route } from '@/lib/session';

export const maxDuration = 30;
const schema = z.object({ text: z.string().trim().min(1).max(400) });

export const POST = route(async () => {
  const pre = await getPreOrThrow();
  if (!pre.username) throw new HttpError(409, { error: 'no_username' });
  if (pre.reaction) return NextResponse.json({ text: pre.reaction });

  const started = Date.now();
  let text: string;
  let callId: string | null = null;
  try {
    const out = await callJson({
      purpose: 'name_reaction',
      system: '',
      user: nameReactionPrompt(env.promptVersion, pre.username),
      schema,
      promptVersion: env.promptVersion,
      log: llmLogger(null), // session_id is attached when the session is created
      deadline: started + 6000,
    });
    callId = out.callId;
    text = out.status === 'ok' && out.value ? out.value.text : pick(secureRandom, NAME_REACTION_FALLBACKS);
  } catch (err) {
    console.error('name reaction failed', err);
    text = pick(secureRandom, NAME_REACTION_FALLBACKS);
  }

  // Only store it if the learner is still on the same name.
  const latest = await readPre();
  if (latest && latest.username === pre.username) await writePre({ ...latest, reaction: text, reactionCallId: callId });
  return NextResponse.json({ text });
});
