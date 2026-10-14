import { db } from './db';

// Push alerts to the researcher's phone (ntfy) when the LLM provider stops answering, so a
// rate limit, an exhausted budget or a revoked key can be fixed during class instead of
// silently losing data. Messages carry only error codes and counts, never learner data.
// No-op unless ALERT_NTFY_TOPIC is set.

export type AlertKind = 'llm_auth' | 'llm_quota' | 'llm_rate' | 'llm_failures';

const WINDOW_MS = 10 * 60_000; // at most one alert per kind per 10 minutes
const FAILURE_LOOKBACK_MS = 5 * 60_000;
const FAILURE_THRESHOLD = 5;

export function classifyHttpStatus(status?: number): AlertKind | null {
  if (status === 401 || status === 403) return 'llm_auth';
  if (status === 402) return 'llm_quota';
  if (status === 429) return 'llm_rate';
  return null;
}

export interface FailureInfo {
  purpose: string;
  model: string;
  status: string; // llm_calls.status
  httpStatus?: number;
}

export function alertMessage(kind: AlertKind, info: FailureInfo, recentFailures: number): { title: string; message: string } {
  const recent = `${recentFailures} apeluri eșuate în ultimele 5 minute (ultimul: ${info.purpose}, ${info.model}).`;
  switch (kind) {
    case 'llm_rate':
      return {
        title: 'Studiu PIT: Mistral refuză apelurile (limită, HTTP 429)',
        message: `S-a atins limita de cereri sau de tokeni. ${recent} Verifică admin.mistral.ai → Limits și Billing. Ghid: README, secțiunea Alerte.`,
      };
    case 'llm_quota':
      return {
        title: 'Studiu PIT: bugetul Mistral e epuizat (HTTP 402)',
        message: `Mistral cere plată sau credit. ${recent} Verifică admin.mistral.ai → Billing.`,
      };
    case 'llm_auth':
      return {
        title: `Studiu PIT: cheia Mistral nu mai e acceptată (HTTP ${info.httpStatus})`,
        message: `${recent} Generează o cheie nouă și pune-o pe Vercel (README, secțiunea Alerte).`,
      };
    case 'llm_failures':
      return {
        title: 'Studiu PIT: multe apeluri la Mistral eșuează',
        message: `${recent} Tip: ${info.status}${info.httpStatus ? ` (HTTP ${info.httpStatus})` : ''}. Verifică status.mistral.ai și Q7 în Supabase.`,
      };
  }
}

export async function sendNtfy(title: string, message: string, priority = 5): Promise<boolean> {
  const topic = process.env.ALERT_NTFY_TOPIC?.trim();
  if (!topic) return false;
  const server = (process.env.ALERT_NTFY_URL?.trim() || 'https://ntfy.sh').replace(/\/$/, '');
  // JSON publishing keeps Romanian diacritics intact (HTTP headers cannot carry them).
  const res = await fetch(server, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority, tags: ['warning'] }),
    signal: AbortSignal.timeout(3000),
  });
  return res.ok;
}

/** Called after a failed LLM call. Never throws; adds latency only when something already failed. */
export async function onLlmFailure(info: FailureInfo): Promise<void> {
  if (!process.env.ALERT_NTFY_TOPIC?.trim()) return;
  try {
    const since = new Date(Date.now() - FAILURE_LOOKBACK_MS).toISOString();
    const { count } = await db()
      .from('llm_calls')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'ok')
      .neq('status', 'invalid_json')
      .gte('created_at', since);
    const recent = count ?? 0;
    let kind = classifyHttpStatus(info.httpStatus);
    if (!kind && recent < FAILURE_THRESHOLD) return;
    kind ??= 'llm_failures';
    // Claim this kind for the current 10-minute window; a conflict means it was already sent.
    const { error } = await db()
      .from('ops_alerts')
      .insert({ kind, bucket: Math.floor(Date.now() / WINDOW_MS), detail: { ...info, recent } });
    if (error) return;
    const { title, message } = alertMessage(kind, info, recent);
    await sendNtfy(title, message);
  } catch (err) {
    console.error('alert failed', err);
  }
}
