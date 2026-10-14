import './loadEnv';
import { budgetConfig, crossedThreshold, estimateCost, monthUsage } from '../lib/budget';

// Prints this month's LLM usage and estimated cost. Usage: ENV_FILE=.env.production.local npm run budget
async function main() {
  const rows = await monthUsage();
  for (const r of rows) console.log(`${r.model.padEnd(24)} calls ${r.calls}  in ${r.input_tokens}  out ${r.output_tokens}`);
  const cfg = budgetConfig();
  if (!cfg) return console.log('LLM_MONTHLY_BUDGET / LLM_PRICE_IN_PER_M / LLM_PRICE_OUT_PER_M not set');
  const cost = estimateCost(rows, cfg.pin, cfg.pout);
  const t = crossedThreshold(cost, cfg.budget);
  console.log(`Estimated cost this month: ${cost.toFixed(2)} of ${cfg.budget} (${((100 * cost) / cfg.budget).toFixed(1)}%)${t ? `, past ${t * 100}%` : ''}`);
  console.log('Estimate only: covers calls made by the app; prices are set in env. Mistral Usage/Billing is authoritative.');
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
