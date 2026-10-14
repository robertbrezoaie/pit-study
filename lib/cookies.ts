import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from './env';

export const PRE_COOKIE = 'pre';
export const SID_COOKIE = 'sid';
const SIX_HOURS = 6 * 60 * 60;

/** Pre-session state (Start and Name steps happen before a session row exists). */
export interface PreSession {
  assent: true;
  test: boolean;
  iat: number;
  /** names generated for this browser, with the time they were generated (ms) */
  names: { n: string; t: number }[];
  participantId?: string;
  username?: string;
  reaction?: string;
  reactionCallId?: string | null;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', env.cookieSecret).update(payload).digest());
}

export function seal(value: unknown): string {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

const baseOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SIX_HOURS,
};

export async function readPre(): Promise<PreSession | null> {
  const jar = await cookies();
  const pre = unseal<PreSession>(jar.get(PRE_COOKIE)?.value);
  if (!pre || !pre.assent) return null;
  if (Date.now() - pre.iat > SIX_HOURS * 1000) return null;
  return pre;
}

export async function writePre(pre: PreSession): Promise<void> {
  const jar = await cookies();
  jar.set(PRE_COOKIE, seal(pre), baseOpts);
}

export async function readSid(): Promise<string | null> {
  const jar = await cookies();
  const v = unseal<{ sid: string }>(jar.get(SID_COOKIE)?.value);
  return v?.sid ?? null;
}

export async function writeSid(sid: string): Promise<void> {
  const jar = await cookies();
  jar.set(SID_COOKIE, seal({ sid }), baseOpts);
}

export async function clearAll(): Promise<void> {
  const jar = await cookies();
  jar.delete(PRE_COOKIE);
  jar.delete(SID_COOKIE);
}
