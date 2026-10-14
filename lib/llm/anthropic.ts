import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import type { LlmRequest, LlmResult } from './adapter';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // maxRetries 0: the spec's own retry rules apply, and every attempt must be logged.
  client ??= new Anthropic({ apiKey: env.llmApiKey, maxRetries: 0 });
  return client;
}

/**
 * Request parameters differ by model generation (see DECISIONS.md):
 *  - Haiku 4.5 and the 4.6-and-older models accept `temperature` and run without thinking.
 *  - Sonnet 5.5 rejects non-default temperature; thinking is switched off with `between_tools`.
 *  - Opus 5.x / 4.7 / 4.8 and Fable reject temperature. Opus 5.5 cannot disable thinking, so
 *    effort is set to "low" and max_tokens gets headroom so thinking cannot truncate the JSON.
 */
export function anthropicParams(model: string, req: LlmRequest): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: 'user', content: req.user }],
  };
  const m = model.toLowerCase();
  const legacy = /haiku-4-5|sonnet-4-6|opus-4-6|sonnet-4-5|opus-4-5|claude-3/.test(m);
  if (legacy) return { ...base, temperature: req.temperature };
  if (/sonnet-5-5/.test(m)) return { ...base, thinking: { type: 'between_tools' } };
  return { ...base, max_tokens: Math.max(req.maxTokens, 4000), output_config: { effort: 'low' } };
}

export async function anthropicCall(req: LlmRequest, model: string): Promise<LlmResult> {
  const started = Date.now();
  const params = anthropicParams(model, req);
  const sentParams = { ...params, system: undefined, messages: undefined };
  try {
    const res = await getClient().messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: req.timeoutMs },
    );
    const latencyMs = Date.now() - started;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens' || !text) {
      return { ok: false, text: text || null, latencyMs, error: 'other', sentParams, ...usage };
    }
    return { ok: true, text, latencyMs, sentParams, ...usage };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, text: null, latencyMs, error: 'timeout', sentParams };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, text: String(err.message).slice(0, 500), latencyMs, error: 'http', sentParams };
    }
    return { ok: false, text: String(err).slice(0, 500), latencyMs, error: 'other', sentParams };
  }
}
