import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiCompatibleCall } from '@/lib/llm/openaiCompatible';

// Mistral AI via the OpenAI-compatible adapter.
const req = { purpose: 'grade' as const, system: 'sys', user: 'usr', temperature: 0, maxTokens: 300, timeoutMs: 12000 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(status: number, payload: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status });
  });
  return calls;
}

describe('openai_compatible adapter (Mistral)', () => {
  it('sends the spec settings, JSON mode and the bearer key to /chat/completions', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.mistral.ai/v1/');
    vi.stubEnv('LLM_API_KEY', 'k123');
    vi.stubEnv('LLM_JSON_MODE', 'true');
    const calls = stubFetch(200, { choices: [{ message: { content: '{"score":2}' } }], usage: { prompt_tokens: 50, completion_tokens: 7 } });
    const r = await openaiCompatibleCall(req, 'mistral-small-test');
    expect(calls[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer k123');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'mistral-small-test',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    });
    expect(r).toMatchObject({ ok: true, text: '{"score":2}', inputTokens: 50, outputTokens: 7, sentParams: { json_mode: true } });
  });

  it('omits response_format when JSON mode is off', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.mistral.ai/v1');
    vi.stubEnv('LLM_JSON_MODE', '');
    const calls = stubFetch(200, { choices: [{ message: { content: '{}' } }] });
    await openaiCompatibleCall(req, 'm');
    expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty('response_format');
  });

  it('reports HTTP errors (e.g. 429 rate limit) as failed calls', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.mistral.ai/v1');
    stubFetch(429, { message: 'Requests rate limit exceeded' });
    const r = await openaiCompatibleCall(req, 'm');
    expect(r).toMatchObject({ ok: false, error: 'http' });
    expect(r.text).toMatch(/HTTP 429/);
  });
});
