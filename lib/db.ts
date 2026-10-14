import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

const DB_TIMEOUT_MS = 10_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
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
