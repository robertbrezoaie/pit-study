import type { z } from 'zod';
import { onLlmFailure } from '../alerts';
import { maybeCheckBudget } from '../budget';
import { getProvider, modelFor, PURPOSE_SETTINGS, type LlmPurpose, type LlmRequest, type LlmResult } from './adapter';

export const JSON_RETRY_LINE = 'Return only valid JSON matching the schema.';

export type LlmCallStatus = 'ok' | 'invalid_json' | 'timeout' | 'error';

/** One row for llm_calls (spec rule 9). */
export interface LlmCallRow {
  purpose: LlmPurpose;
  provider: string;
  model: string;
  prompt_version: string;
  request: Record<string, unknown>;
  response_text: string | null;
  parsed: unknown;
  status: LlmCallStatus;
  attempt: number;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

/** Persists one attempt and returns its id (or null when not logging, e.g. the smoke test). */
export type CallLogger = (row: LlmCallRow) => Promise<string | null>;

export interface JsonCallOutcome<T> {
  status: LlmCallStatus;
  value: T | null;
  /** id of the last logged attempt */
  callId: string | null;
  /** raw parsed JSON of the last attempt, even if schema validation failed */
  raw: unknown;
  attempts: number;
}

/** Tolerates a ```json fence or stray prose around a single JSON object. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('no JSON object found');
  }
}

function statusOf(r: LlmResult): LlmCallStatus {
  return r.error === 'timeout' ? 'timeout' : 'error';
}

/**
 * Calls the LLM expecting JSON. On invalid JSON (or schema mismatch) retries once with
 * JSON_RETRY_LINE appended (spec 3.3). Transport failures are not retried: the learner flow
 * has its own fallback and must not wait twice.
 */
export async function callJson<S extends z.ZodTypeAny>(opts: {
  purpose: LlmPurpose;
  system: string;
  user: string;
  schema: S;
  promptVersion: string;
  log: CallLogger;
  attemptOffset?: number;
  /** epoch ms; a JSON retry is skipped if it could not finish before this */
  deadline?: number;
}): Promise<JsonCallOutcome<z.infer<S>>> {
  const provider = getProvider();
  const model = modelFor(opts.purpose);
  const settings = PURPOSE_SETTINGS[opts.purpose];
  let user = opts.user;
  let callId: string | null = null;
  let raw: unknown = null;
  let attempts = 0;

  for (let i = 0; i < 2; i++) {
    attempts++;
    const req: LlmRequest = { purpose: opts.purpose, system: opts.system, user, ...settings };
    const res = await provider.call(req, model);
    let parsed: unknown = null;
    let status: LlmCallStatus;
    let value: z.infer<S> | null = null;
    if (!res.ok) {
      status = statusOf(res);
    } else {
      try {
        parsed = extractJson(res.text ?? '');
        const v = opts.schema.safeParse(parsed);
        if (v.success) {
          value = v.data;
          status = 'ok';
        } else {
          status = 'invalid_json';
        }
      } catch {
        status = 'invalid_json';
      }
    }
    raw = parsed;
    callId = await opts.log({
      purpose: opts.purpose,
      provider: provider.name,
      model,
      prompt_version: opts.promptVersion,
      request: {
        system: opts.system,
        user,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        timeout_ms: settings.timeoutMs,
        sent_params: res.sentParams ?? null,
      },
      response_text: res.text,
      parsed,
      status,
      attempt: (opts.attemptOffset ?? 0) + attempts,
      latency_ms: res.latencyMs,
      input_tokens: res.inputTokens ?? null,
      output_tokens: res.outputTokens ?? null,
    });
    if (status === 'ok') {
      await maybeCheckBudget();
      return { status, value, callId, raw, attempts };
    }
    if (status !== 'invalid_json') {
      await onLlmFailure({ purpose: opts.purpose, model, status, httpStatus: res.httpStatus });
      return { status, value: null, callId, raw, attempts };
    }
    if (opts.deadline && Date.now() + settings.timeoutMs > opts.deadline) break;
    user = `${opts.user}\n\n${JSON_RETRY_LINE}`;
  }
  return { status: 'invalid_json', value: null, callId, raw, attempts };
}
