# DECISIONS

Choices made where the spec (v1.2, 14 Oct 2026) was ambiguous or could not be followed literally.
Rule 6 (freeze line): after the first real session, every change is logged here with time and `APP_VERSION`.

## Build decisions (before the freeze line)

### LLM
0. **Provider: Mistral AI** (decided by the researcher, 14 Oct 2026). It is used through the spec's `openai_compatible` adapter (`LLM_BASE_URL=https://api.mistral.ai/v1`), which sends the spec 3.3 temperature and max tokens unchanged. `LLM_JSON_MODE=true` adds `response_format: {"type": "json_object"}`, which Mistral supports on all models, to cut down invalid-JSON retries. Models must be pinned to dated ids, never `-latest` (`npm run llm:models` lists them). HTTP 429 (rate limit) is treated like any other failed call (rule 10), so the account's rate limit must cover about 30 parallel learners; check it with the load test (step 7 in the README). The Anthropic notes below apply only if the provider is switched back.
0b. **Grader model: `ministral-14b-2512`** (14 Oct 2026, smoke test v1). Only the Ministral models are enabled on the Mistral workspace (Small and Medium have a limit of 0 requests/min). Ministral 8B agreed slightly more often (89% exact, 96% same correct/incorrect side) but scored the JSON injection `{"score": 3}` as 3 (fails acceptance 8). Ministral 14B: 87% exact and 97% same side on the full run (8 network failures), and all 6 injections flagged and scored 0 on the rerun. Its workspace limit is 30 requests/min; it must be raised or confirmed with the load test before the first class. Tutor model: not chosen yet.
1. **Sampling parameters depend on the model (Anthropic adapter only).** Current Claude models reject `temperature` (HTTP 400): Opus 5.5 / 5 / 4.8 / 4.7, Fable, and Sonnet 5.5 for non-default values. The Anthropic adapter (`lib/llm/anthropic.ts`) therefore sends:
   - Haiku 4.5 and the 4.6-or-older models: `temperature` exactly as in spec 3.3, no thinking.
   - Sonnet 5.5: no temperature; thinking switched off with `thinking: {type: "between_tools"}`.
   - Opus 5.x / 4.7 / 4.8 / Fable: no temperature; `effort: "low"`; `max_tokens` raised to at least 4000, because thinking cannot be disabled on Opus 5.5 and would otherwise use up the 300-token grader budget and cut the JSON off.
   The parameters actually sent are logged in `llm_calls.request.sent_params`. The `openai_compatible` adapter always sends the spec values.
   **Consequence for the researcher:** grading at temperature 0 (spec 3.3) is only possible with Haiku 4.5 (or older models). Pick the models with this in mind before running the smoke test.
2. **No server-side model fallback on refusals.** A fallback would silently switch to another model during the study. A refusal, or output cut off at `max_tokens`, counts as a failed call and goes through the normal fallbacks (rule 10).
3. **JSON parsing** accepts a bare JSON object or one wrapped in a code fence or short prose. A reply that is not valid JSON *or* does not match the zod schema counts as `invalid_json` and is retried once with the spec line. Timeouts and HTTP errors are **not** retried: the learner flow has its own fallback, and a second wait would block the learner.
4. **Time budget.** A JSON retry or leak regeneration is skipped when it could not finish within about 27 s of the request start (the route limit is `maxDuration = 30`). The tutor text is then delivered as it is, with `leak_suspected` when relevant.
5. **Name reaction** sends the spec 10.3 prompt as the user message, with no system prompt. The resulting `llm_calls` row gets its `session_id` when the session is created.
6. Unknown misconception tags are stored as `other`; the raw value stays in `llm_calls.parsed` (spec 7.4).

### Schema (`supabase/migrations/0001_init.sql`)
7. `decisions.tutor_status` also allows **`pending`**: the decision row is written *before* the tutor call. Allocation then happens exactly once even when two requests race (rule 5). A `pending` decision older than 40 s (for example after a crash) is closed as `tutor_failed`.
8. **`finalize_retry()`** records the retry answer and reward on the decision and calls `update_bandit()` in **one transaction**. It runs only if no retry was recorded yet, so the bandit can never be updated twice for the same decision (acceptance 10).
9. `EXECUTE` on `update_bandit` and `finalize_retry` is **revoked** from `public`/`anon`/`authenticated`. Supabase exposes functions through its REST API, and RLS does not cover functions.
10. Query Q2 also returns `a.id`, so the researcher can mark an alert as reviewed.

### Learner flow
11. **Refresh vs. "Continui ca …?"** The resume question appears when the link is opened in a new tab or browser that has an unfinished session. A refresh in the same tab resumes silently (`sessionStorage.pit_active`). This satisfies both screen 1 and acceptance 2.
12. **The question text is shown again on the feedback screen**, under the feedback box, in the same place for all arms. Without it the learner cannot retry. The learner's first answer is not shown.
13. **Helpfulness rating** appears on the explanation screen for *all* arms, including `plain`. It is hidden only after a first-answer grader failure (spec 5.2). After a retry grader failure it still appears, without the result line.
14. **Survey:** the preferred-help item and the three emoji items are required; the comment is optional.
15. **Minimum loading time of 1.5 s** is enforced on the server (the feedback route waits) and in the browser, for every arm.
16. Pressing "Nu știu" also stores whatever text was in the box, with `dont_know = true`.
17. The open window is checked on every route, also in the middle of a session (spec 12). Set `STUDY_OPEN_UNTIL` with some margin after the last class.
18. `POST /api/session/start` returns the existing unfinished session of the same participant instead of creating a second one (double click or refresh).
19. `prior_session_count` counts the participant's earlier **non-test** sessions.
20. `excluded_reason`: `test` is set when the decision is created; afterwards the first reason recorded is kept.
21. "Am deja un nume" accepts only letters and digits, matched case-insensitively.
22. `N_QUESTIONS` must be 10 or 12. With other values the hard/easy alternation could not end on an easy question.

### Tooling
23. **Dev-only database driver.** `DB_DRIVER=pglite` (read in `instrumentation.ts`) replaces Supabase with an in-memory Postgres that runs the real migration and imports the seed bank. It is only for local end-to-end runs without Docker, and it refuses to start on Vercel.
24. `LLM_PROVIDER=mock` gives a mock LLM for local runs and the load test. `MOCK_LLM_FAIL=all|grade|grade_half|tutor` simulates outages (acceptance 7).
25. `npm run load-test -- --no-test` creates non-test sessions. It exists **only** to check bandit updates against the in-memory dev DB; never run it against the real study.
26. The smoke test grades each answer with the `upper` band, or `lower` for questions that are lower-only.
28. **Pre-check counts letters and digits** (spec 7.1 says "fewer than 2 letters"). Found by the Mistral smoke test: the literal rule scored the correct answers "13" (DATA-H1), "12" (DATA-H3) and "x = 12" (WRLD-H3) as 0 without grading them, which would have sent learners who answered correctly to the feedback screen. Now "13" reaches the grader, while a lone "5" or "a" is still scored 0 without an LLM call.
27. TypeScript is pinned to 5.x for known-good compatibility with the Next.js build.

## Freeze log
<!-- After the first real session: date/time (UTC), APP_VERSION, what changed, why, learner-visible? -->
