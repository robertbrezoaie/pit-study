# Punctul IT study page (Report 5, Part B)

Learner study page for the LearnSpace AI layer: LLM grader, bandit allocator (`plain` / `hint` / `example`) and LLM tutor.
The spec is in [docs/Report5_PartB_Build_Spec.md](docs/Report5_PartB_Build_Spec.md); deviations and choices are listed in [DECISIONS.md](DECISIONS.md).

## Run locally (no Supabase, no API key)

`.env.local` is set up for an in-memory database and a mock LLM:

```bash
npm install
npm run dev                      # http://localhost:3000/q/localtesttoken123?test=1
npm test                         # unit + database tests (46)
npm run load-test -- --base http://localhost:3000   # 30 parallel test learners, mock LLM
```

The in-memory database is reset on every server restart.

## Where it runs

| | |
|---|---|
| Code | github.com/robertbrezoaie/pit-study (private); every push to `main` deploys |
| Hosting | Vercel project `pit-study`, functions in `fra1`; env vars set for Production only |
| Database | Supabase project `pit-study` (ref `ndnrvthleemlhwnsckmc`, Central EU Frankfurt) |
| LLM | Mistral AI, `ministral-14b-2512` for grader and tutor |
| Local copies of the production settings | `.env.production.local` (gitignored; scripts: `ENV_FILE=.env.production.local npm run …`) |

## Set up the real study

1. **Supabase**: create a project in an **EU (Frankfurt)** region. In the SQL Editor run `supabase/migrations/0001_init.sql` (or `supabase link` + `supabase db push`). Save the queries from `supabase/queries.sql` in the SQL Editor.
2. **Env**: copy `.env.example` to `.env` and fill it in. Remove `DB_DRIVER` and `LLM_PROVIDER=mock` (these are only in `.env.local`), or delete `.env.local`.
   `COOKIE_SECRET`: `openssl rand -hex 32`. `STUDY_TOKEN`: at least 10 random characters.
3. **Questions**: `npm run import:questions` (upserts by id; bumps `version` when content changes; never touches `active`).
4. **LLM (Mistral AI)**: put the Mistral API key in `LLM_API_KEY` and keep `LLM_PROVIDER=openai_compatible`, `LLM_BASE_URL=https://api.mistral.ai/v1`, `LLM_JSON_MODE=true`. Run `npm run llm:models`: it checks the key, lists the chat models with their dated ids, and makes one test call per configured model. Pin dated ids (not `-latest`) in `LLM_MODEL_GRADER` / `LLM_MODEL_TUTOR`. Then run `npm run smoke:grader`. It prints agreement with the expected scores, the mismatches with the grader's reasons, and whether all 6 injections were flagged and scored 0. It writes nothing to the database. In the Mistral console, check the data/training settings (spec 14) and the rate limits.
5. **Deploy to Vercel**: add the env vars in the project settings. Functions run in `fra1` (`vercel.json`). `APP_VERSION` is taken from the git commit automatically when deploying from git.
6. **Test session**: open `https://<domain>/q/<STUDY_TOKEN>?test=1` with 2–3 learners. Test sessions ignore the open window, never update the bandit, and are never sampled for rating.
7. Run the load test once against the deployment with the real LLM, paced like a real class of 12: `npm run load-test -- --base https://<domain> --n 12 --pace 150` (about 30 minutes). It uses `?test=1` sessions. Without `--pace`, simulated learners answer instantly and exceed the Mistral per-minute limit in a way a real class would not. Afterwards, check Q4 for any `error` rows (HTTP 429 = rate limit).
8. **Freeze**: from the first real session on, log every change in DECISIONS.md.

## Alerts during a class (Mistral stops answering)

When Mistral refuses calls (HTTP 401/402/429) or at least 5 calls fail within 5 minutes, the server sends a
push notification to the **ntfy** app on the researcher's phone: at most one per problem type per 10 minutes,
with error codes and counts only, never learner data. Children keep going (fallbacks), but those answers
are lost for the analysis, so act quickly.

**Setup (once):** install ntfy (iOS/Android), tap "+", subscribe to the topic in `ALERT_NTFY_TOPIC`
(`.env.production.local`; server ntfy.sh). Check with `ENV_FILE=.env.production.local npm run alert:test`.

**What to do when an alert arrives:**

| Alert | Likely cause | Fix |
|---|---|---|
| limită, HTTP 429 | requests/minute or monthly token limit reached | admin.mistral.ai → Limits: raise the limit for `ministral-14b-2512` (or ask Mistral support); check Billing |
| buget epuizat, HTTP 402 | no credit / payment problem | admin.mistral.ai → Billing |
| cheia nu mai e acceptată, HTTP 401/403 | key deleted, expired or wrong workspace | create a new key (admin.mistral.ai → API Keys), then `vercel env add LLM_API_KEY production --force` and redeploy (`vercel redeploy https://pit-study.vercel.app`, about 1 min); also update `.env.production.local` |
| multe apeluri eșuează | timeouts / Mistral outage | status.mistral.ai; nothing to fix on our side, wait |

Afterwards run **Q7** in the SQL Editor to see whether calls succeed again (last 15 minutes).

## Where things are

| | |
|---|---|
| Learner UI (one page, server-driven steps) | `app/q/[token]/page.tsx`, `components/StudyApp.tsx`, copy in `lib/copy.ts` |
| API routes (spec 12) | `app/api/*` |
| Flow, state machine, allocation, retry | `lib/session.ts` |
| Grader / tutor / prompts | `lib/grader.ts`, `lib/tutor.ts`, `lib/prompts/*` (keyed by `PROMPT_VERSION`) |
| Bandit | `lib/allocator.ts`, `lib/beta.ts`; DB functions `update_bandit`, `finalize_retry` |
| Question selection | `lib/selection.ts` |
| LLM adapters | `lib/llm/*` (`anthropic`, `openai_compatible`, `mock`) |

## Daily checks (researcher)

- **Q2** every day (answers flagged `needs_adult_attention`).
- After day 1: **Q1 / Q1b** (share of wrong first answers; target about 45%).
- **Q4** for LLM failures and latency.
