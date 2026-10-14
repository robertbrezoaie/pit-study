import { config } from 'dotenv';

// Scripts read the same env files as Next.js (.env.local wins over .env).
// ENV_FILE=<file> uses only that file, e.g. ENV_FILE=.env.production.local for the real Supabase project.
if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true });
} else {
  config({ path: '.env.local', quiet: true });
  config({ path: '.env', quiet: true });
}
