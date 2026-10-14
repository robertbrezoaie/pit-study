import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Agent, fetch as undiciFetch } from 'undici';
import { env } from './env';
import type { LlmCallRow } from './llm/call';

// Server only: uses the service-role key. The browser never talks to Supabase (spec 3).
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  // Dev/test only (instrumentation.ts, DB_DRIVER=pglite): in-memory Postgres with the same schema.
  const dev = (globalThis as { __pitDevDb?: unknown }).__pitDevDb;
  if (dev) return dev as SupabaseClient;
  client ??= createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // A stuck connection must fail fast instead of holding the route until Vercel's 30 s limit.
    global: { fetch: timedFetch },
  });
  return client;
}

/** Throws on a Supabase error so route handlers fail loudly instead of continuing with bad state. */
export function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`, res.error.code);
  return res.data;
}

export class DbError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const UNIQUE_VIOLATION = '23505';

// Supabase requests sometimes hung (seen in production: >10 s, then cut off). Most likely cause:
// a pooled keep-alive connection that died while the function instance was suspended between
// requests. Remedy: our own connection pool that drops idle sockets quickly, a 6 s limit per
// request, and one retry on a fresh attempt. Inserts into sessions and llm_calls are not retried,
// because a duplicate row would distort the data; every other write is idempotent here
// (unique constraints, conditional updates, finalize_retry guard).
const DB_TIMEOUT_MS = 6_000;
const dbAgent = new Agent({ keepAliveTimeout: 2_000, keepAliveMaxTimeout: 5_000, connect: { timeout: 5_000 } });
const NO_RETRY_INSERT = /\/rest\/v1\/(sessions|llm_calls)(\?|$)/;

function attempt(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const url = input instanceof Request ? input.url : String(input);
  return undiciFetch(url, { ...(init as object), signal, dispatcher: dbAgent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await attempt(input, init);
  } catch (err) {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    const timedOut = (err as Error)?.name === 'TimeoutError';
    if (!timedOut || (method === 'POST' && NO_RETRY_INSERT.test(url))) throw err;
    console.warn(JSON.stringify({ ev: 'db_retry', method, path: new URL(url).pathname }));
    return attempt(input, init);
  }
}

/** Returns a CallLogger that writes llm_calls rows for the given session. */
export function llmLogger(sessionId: string | null) {
  return async (row: LlmCallRow): Promise<string | null> => {
    const { data, error } = await db()
      .from('llm_calls')
      .insert({ ...row, session_id: sessionId })
      .select('id')
      .single();
    if (error) {
      // Logging must not break the learner flow, but it must be visible in the server logs.
      console.error('llm_calls insert failed', error.message);
      return null;
    }
    return data.id as string;
  };
}
