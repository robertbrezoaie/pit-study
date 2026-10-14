import { env } from '../env';
import type { LlmRequest, LlmResult } from './adapter';

/**
 * Chat-completions endpoint for alternative providers (spec 3.3), e.g. Mistral AI
 * (LLM_BASE_URL=https://api.mistral.ai/v1). With LLM_JSON_MODE=true the request asks for
 * response_format json_object; every prompt in this app already asks for JSON only.
 */
export async function openaiCompatibleCall(req: LlmRequest, model: string): Promise<LlmResult> {
  const started = Date.now();
  const jsonMode = env.llmJsonMode;
  const body = {
    model,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.user },
    ],
  };
  const sentParams = { model, temperature: req.temperature, max_tokens: req.maxTokens, json_mode: jsonMode };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.llmApiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, text: `HTTP ${res.status}: ${t.slice(0, 400)}`, latencyMs, error: 'http', sentParams };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? null;
    return {
      ok: !!text,
      text,
      latencyMs,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      error: text ? undefined : 'other',
      sentParams,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const timeout = (err as Error)?.name === 'AbortError';
    return { ok: false, text: timeout ? null : String(err).slice(0, 500), latencyMs, error: timeout ? 'timeout' : 'other', sentParams };
  } finally {
    clearTimeout(timer);
  }
}
