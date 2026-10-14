import { sendNtfy } from './alerts';
import { db } from './db';

// Monthly LLM budget alert. Mistral does not expose the remaining allowance through the API, so the
// app estimates its own spend: tokens logged in llm_calls this month x LLM_PRICE_*_PER_M.
// Push notification at 50%, 80% and 95% of LLM_MONTHLY_BUDGET, once per threshold per month.
// Checked at most every 5 minutes per server instance, and only while learners are active.

export const THRESHOLDS = [0.5, 0.8, 0.95] as const;
const CHECK_EVERY_MS = 5 * 60_000;
let lastCheck = 0;

export interface UsageRow {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export function budgetConfig() {
  const budget = Number(process.env.LLM_MONTHLY_BUDGET ?? '');
  const pin = Number(process.env.LLM_PRICE_IN_PER_M ?? '');
  const pout = Number(process.env.LLM_PRICE_OUT_PER_M ?? '');
  if (!(budget > 0) || !(pin >= 0) || !(pout >= 0) || !process.env.LLM_PRICE_IN_PER_M) return null;
  return { budget, pin, pout };
}

/** Only calls to the configured (paid) models are priced; earlier free-tier models are ignored. */
export function pricedModels(): Set<string> {
  return new Set([process.env.LLM_MODEL_GRADER, process.env.LLM_MODEL_TUTOR].map((m) => m?.trim()).filter(Boolean) as string[]);
}

export function estimateCost(rows: UsageRow[], pin: number, pout: number, models?: Set<string>): number {
  if (models && models.size) rows = rows.filter((r) => models.has(r.model));
  return rows.reduce((s, r) => s + (Number(r.input_tokens) * pin + Number(r.output_tokens) * pout) / 1e6, 0);
}

/** Highest threshold reached, or null. */
export function crossedThreshold(cost: number, budget: number): (typeof THRESHOLDS)[number] | null {
  let hit: (typeof THRESHOLDS)[number] | null = null;
  for (const t of THRESHOLDS) if (cost >= t * budget) hit = t;
  return hit;
}

export async function monthUsage(): Promise<UsageRow[]> {
  const { data, error } = await db().rpc('llm_month_usage');
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageRow[];
}

/** Throttled; never throws. */
export async function maybeCheckBudget(): Promise<void> {
  const cfg = budgetConfig();
  if (!cfg || !process.env.ALERT_NTFY_TOPIC?.trim()) return;
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  try {
    const cost = estimateCost(await monthUsage(), cfg.pin, cfg.pout, pricedModels());
    const t = crossedThreshold(cost, cfg.budget);
    if (t === null) return;
    const now = new Date();
    const month = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1; // e.g. 202610
    const { error } = await db().from('ops_alerts').insert({
      kind: `budget_${Math.round(t * 100)}`,
      bucket: month,
      detail: { cost: Number(cost.toFixed(2)), budget: cfg.budget },
    });
    if (error) return; // this threshold was already announced this month
    const pct = Math.round(t * 100);
    await sendNtfy(
      `Studiu PIT: ${pct}% din bugetul lunar Mistral consumat`,
      `Cost estimat luna aceasta: ${cost.toFixed(2)} din ${cfg.budget} (${pct}%+). ` +
        (t >= 0.95
          ? 'Aproape epuizat: mărește limita de cheltuieli în admin.mistral.ai → Billing, altfel apelurile vor fi refuzate.'
          : 'Verifică admin.mistral.ai → Billing și Usage.'),
      t >= 0.8 ? 5 : 4,
    );
  } catch (err) {
    console.error('budget check failed', err);
  }
}
