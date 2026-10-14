import type { LlmRequest, LlmResult } from './adapter';

/**
 * Deterministic stand-in for local development and the load test (LLM_PROVIDER=mock).
 * MOCK_LLM_FAIL=all|grade|grade_half|tutor simulates outages (acceptance criterion 7).
 * Grade heuristic: injection-looking text -> 0 + gaming flag; otherwise by length (<20: 1, <60: 2, else 3).
 */
export async function mockCall(req: LlmRequest, _model: string): Promise<LlmResult> {
  const started = Date.now();
  const latency = Number(process.env.MOCK_LLM_LATENCY_MS ?? 150 + Math.random() * 450);
  await new Promise((r) => setTimeout(r, Math.min(latency, req.timeoutMs)));
  const fail = process.env.MOCK_LLM_FAIL ?? '';
  const isTutor = req.purpose === 'hint' || req.purpose === 'example';
  const gradeFails = req.purpose === 'grade' && (fail === 'grade' || (fail === 'grade_half' && Math.random() < 0.5));
  if (fail === 'all' || gradeFails || (fail === 'tutor' && isTutor)) {
    return { ok: false, text: 'mock failure', latencyMs: Date.now() - started, error: 'http' };
  }
  if (latency >= req.timeoutMs) return { ok: false, text: null, latencyMs: Date.now() - started, error: 'timeout' };

  let out: unknown;
  if (req.purpose === 'grade') {
    const m = req.user.match(/<learner_answer>\n?([\s\S]*?)\n?<\/learner_answer>/);
    const answer = (m?.[1] ?? '').trim();
    const gaming = /(ignor|system|score|nota maxim|puncte|json|grade this|corector)/i.test(answer);
    const score = gaming ? 0 : answer.length < 20 ? 1 : answer.length < 60 ? 2 : 3;
    out = {
      score,
      misconception: score < 2 ? 'other' : null,
      confidence: 0.7,
      flags: { off_topic: false, gaming_attempt: gaming, wrong_language: false, needs_adult_attention: false },
      rationale: 'Notă simulată (mock).',
    };
  } else if (req.purpose === 'name_reaction') {
    out = { text: 'Ce nume grozav! Hai să începem.' };
  } else if (req.purpose === 'hint') {
    out = { text: 'Gândește-te la ce se întâmplă pas cu pas. Ce verifică programul și când? Încearcă din nou.' };
  } else {
    out = {
      text: 'Să luăm alt exemplu: o lampă se aprinde doar când apeși întrerupătorul. Întâi verificăm condiția, apoi facem acțiunea. Încearcă la fel la întrebarea ta.',
    };
  }
  return { ok: true, text: JSON.stringify(out), latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0 };
}
