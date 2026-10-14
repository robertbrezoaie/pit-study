import './loadEnv';
import { env } from '../lib/env';
import { getProvider } from '../lib/llm/adapter';

// Checks the LLM key and lists model ids, so a dated id (not a "-latest" alias) can be pinned.
// Then makes one tiny JSON call with each configured model. Writes nothing to the database.

async function main() {
  // Works even while the app itself still runs on the mock LLM.
  process.env.LLM_PROVIDER = 'openai_compatible';
  if (!env.llmApiKey) throw new Error('LLM_API_KEY is empty: paste your Mistral key in .env.local');
  const res = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${env.llmApiKey}` },
  });
  if (!res.ok) throw new Error(`GET /models -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { id: string; deprecation?: string | null; capabilities?: Record<string, boolean> }[] };
  const ids = json.data
    .filter((m) => m.capabilities?.completion_chat !== false)
    .map((m) => `${m.id}${m.deprecation ? `   (deprecated: ${m.deprecation})` : ''}`)
    .sort();
  console.log(`Chat models available to this key (${ids.length}):\n  ${ids.join('\n  ')}\n`);
  console.log('Pin a dated id; "-latest" aliases can change during the study.\n');

  for (const [purpose, model] of [['grade', process.env.LLM_MODEL_GRADER], ['hint', process.env.LLM_MODEL_TUTOR]] as const) {
    if (!model) {
      console.log(`${purpose}: model not set`);
      continue;
    }
    if (/latest/.test(model)) console.log(`WARNING: ${model} is an alias, not a pinned version`);
    const r = await getProvider().call(
      { purpose, system: 'Return only JSON.', user: 'Return {"text": "salut"} as JSON.', temperature: 0, maxTokens: 50, timeoutMs: 15000 },
      model,
    );
    console.log(`${purpose} (${model}): ${r.ok ? 'OK' : `FAILED (${r.error})`} in ${r.latencyMs} ms -> ${r.text}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
