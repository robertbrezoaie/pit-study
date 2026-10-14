-- LearnSpace Report 5 – study page schema (spec section 11).
-- Deviations from the spec text are listed in DECISIONS.md:
--   * decisions.tutor_status also allows 'pending' (decision row exists, tutor text not yet written)
--   * finalize_retry(): records the reward and updates the bandit in one transaction
--   * EXECUTE on the functions is revoked from anon/authenticated (PostgREST would expose them)

create extension if not exists pgcrypto;

create table participants (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  created_at timestamptz not null default now()
);
create unique index participants_username_ci on participants (lower(username));

create table questions (
  id text primary key,
  domain text not null check (domain in ('algorithms','data','worlds','web','ai')),
  tier text not null check (tier in ('warmup','easy','hard')),
  bands text[] not null default '{lower,upper}',
  prompt_ro text not null,
  reference_answer_ro text not null,
  rubric jsonb not null,
  misconceptions jsonb not null default '[]',
  explanation_ro text not null,
  active boolean not null default true,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  is_test boolean not null default false,
  assent boolean not null check (assent),
  grade int check (grade between 4 and 12),  -- null = 'Altceva'
  grade_band text not null check (grade_band in ('lower','upper')),
  age_band text not null check (age_band in ('under10','10-11','12-13','14-15','16-17','18plus')),
  gender text not null check (gender in ('boy','girl','undisclosed')),
  self_reported_prior text not null check (self_reported_prior in ('yes','no','unsure')),
  setting text not null check (setting in ('class','home','other')),
  prior_session_count int not null default 0,
  browser_prior boolean not null default false,
  device text check (device in ('desktop','mobile','tablet')),
  question_ids text[] not null,
  selection_seed text not null,
  selection_note text,
  current_index int not null default 0,
  step text not null default 'question'
    check (step in ('question','correct','feedback','explanation','survey','done')),
  step_shown_at timestamptz not null default now(),  -- when the current step was first served
  name_reaction text,
  app_version text not null,
  prompt_version text not null,
  grader_model text not null,
  tutor_model text not null,
  random_share real not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index sessions_participant on sessions (participant_id);

create table llm_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  purpose text not null check (purpose in ('grade','hint','example','name_reaction')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  request jsonb not null,                    -- system + user message exactly as sent
  response_text text,
  parsed jsonb,
  status text not null check (status in ('ok','invalid_json','timeout','error')),
  attempt int not null default 1,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
create index llm_calls_session on llm_calls (session_id);

create table answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  question_id text not null references questions(id),
  question_version int not null,
  attempt int not null check (attempt in (1,2)),
  text text not null,
  dont_know boolean not null default false,
  shown_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  response_ms int not null,
  grader_status text not null check (grader_status in ('ok','deterministic','failed')),
  score int check (score between 0 and 3),
  misconception text,
  confidence real,
  flags jsonb,
  rationale text,
  llm_call_id uuid references llm_calls(id),
  rating_sample boolean not null default false,
  alert_reviewed boolean not null default false,
  unique (session_id, question_id, attempt)
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  question_id text not null references questions(id),
  first_answer_id uuid not null references answers(id),
  allocator_half text not null check (allocator_half in ('random','thompson')),
  assigned_arm text not null check (assigned_arm in ('plain','hint','example')),
  delivered_arm text not null check (delivered_arm in ('plain','hint','example')),
  propensity double precision not null,
  propensities jsonb not null,               -- {"plain":..,"hint":..,"example":..}
  thompson_probs jsonb not null,
  posterior_snapshot jsonb not null,         -- {"plain":{"a":..,"b":..}, ...}
  feedback_text text,
  tutor_status text not null
    check (tutor_status in ('pending','ok','regenerated_ok','leak_suspected','failed','not_needed')),
  llm_call_id uuid references llm_calls(id),
  decided_at timestamptz not null default now(),
  feedback_shown_at timestamptz,
  retry_answer_id uuid references answers(id),
  reward int check (reward in (0,1)),
  bandit_updated boolean not null default false,
  helpful_rating int check (helpful_rating between 1 and 5),
  excluded_reason text,
  unique (session_id, question_id)
);

create table bandit_state (
  arm text primary key check (arm in ('plain','hint','example')),
  a int not null default 1,
  b int not null default 1,
  n int not null default 0,
  updated_at timestamptz not null default now()
);
insert into bandit_state (arm) values ('plain'), ('hint'), ('example');

create function update_bandit(p_arm text, p_reward int) returns void
language sql as $$
  update bandit_state
     set a = a + p_reward, b = b + (1 - p_reward), n = n + 1, updated_at = now()
   where arm = p_arm;
$$;

-- Records the retry outcome on a decision and, when p_update is true, updates the bandit,
-- all in one transaction. Returns false if the decision already had a retry recorded
-- (so a duplicate request can never update the bandit twice).
create function finalize_retry(
  p_decision uuid, p_retry_answer uuid, p_reward int, p_excluded text, p_update boolean
) returns boolean
language plpgsql as $$
declare
  v_arm text;
begin
  update decisions
     set retry_answer_id = p_retry_answer,
         reward = p_reward,
         excluded_reason = coalesce(excluded_reason, p_excluded),
         bandit_updated = p_update
   where id = p_decision and retry_answer_id is null
   returning assigned_arm into v_arm;
  if not found then
    return false;
  end if;
  if p_update then
    perform update_bandit(v_arm, p_reward);
  end if;
  return true;
end;
$$;

create table surveys (
  session_id uuid primary key references sessions(id),
  preferred_help text check (preferred_help in ('plain','hint','example','unsure')),
  fair int check (fair between 1 and 5),
  understood int check (understood between 1 and 5),
  want_again int check (want_again between 1 and 5),
  comment text,
  submitted_at timestamptz not null default now()
);

-- filled later from the human raters' sheets (no UI in this version)
create table ratings (
  answer_id uuid not null references answers(id),
  rater text not null check (rater in ('R1','R2','CONSENSUS')),
  score int not null check (score between 0 and 3),
  rated_at timestamptz not null default now(),
  primary key (answer_id, rater)
);

alter table participants enable row level security;
alter table questions enable row level security;
alter table sessions enable row level security;
alter table llm_calls enable row level security;
alter table answers enable row level security;
alter table decisions enable row level security;
alter table bandit_state enable row level security;
alter table surveys enable row level security;
alter table ratings enable row level security;

-- Functions are callable through PostgREST by default; only the service role may run them.
revoke execute on function update_bandit(text, int) from public;
revoke execute on function finalize_retry(uuid, uuid, int, text, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function update_bandit(text, int) from anon, authenticated';
    execute 'revoke execute on function finalize_retry(uuid, uuid, int, text, boolean) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function update_bandit(text, int) to service_role';
    execute 'grant execute on function finalize_retry(uuid, uuid, int, text, boolean) to service_role';
  end if;
end $$;
