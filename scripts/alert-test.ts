import './loadEnv';
import { sendNtfy } from '../lib/alerts';

// Sends one test alert to the researcher's phone. Usage: ENV_FILE=.env.production.local npm run alert:test
async function main() {
  if (!process.env.ALERT_NTFY_TOPIC) throw new Error('ALERT_NTFY_TOPIC is not set');
  const ok = await sendNtfy('Studiu PIT: alertă de probă', 'Dacă vezi mesajul acesta, alertele ajung pe telefon. Nu trebuie făcut nimic.', 3);
  console.log(ok ? 'Sent. Check your phone.' : 'ntfy did not accept the message');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
