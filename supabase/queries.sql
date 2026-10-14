-- Saved queries for the researcher (spec section 13).
-- Paste each block into the Supabase SQL Editor and save it there.
-- Test sessions (?test=1) are excluded everywhere except Q4.

-- Q1. Share of wrong first answers (check after day 1; target about half)
select count(*) as n,
       round(avg((a.score < 2)::int)::numeric, 2) as wrong_share
from answers a join sessions s on s.id = a.session_id
where a.attempt = 1 and a.grader_status in ('ok','deterministic') and not s.is_test;

-- Q1b. The same per tier, then per question (easiest first within each tier)
select q.tier, count(*) as n,
       round(avg((a.score < 2)::int)::numeric, 2) as wrong_share
from answers a join sessions s on s.id = a.session_id join questions q on q.id = a.question_id
where a.attempt = 1 and a.grader_status in ('ok','deterministic') and not s.is_test
group by q.tier order by q.tier;

select q.tier, a.question_id, count(*) as n,
       round(avg((a.score < 2)::int)::numeric, 2) as wrong_share
from answers a join sessions s on s.id = a.session_id join questions q on q.id = a.question_id
where a.attempt = 1 and a.grader_status in ('ok','deterministic') and not s.is_test
group by q.tier, a.question_id order by q.tier, wrong_share;

-- Q2. Answers that may need an adult's attention (check daily)
select a.id, a.submitted_at, p.username, s.setting, a.question_id, a.text
from answers a
join sessions s on s.id = a.session_id
join participants p on p.id = s.participant_id
where (a.flags->>'needs_adult_attention')::boolean and not a.alert_reviewed
order by a.submitted_at desc;
-- mark as reviewed: update answers set alert_reviewed = true where id = '<id>';

-- Q3. Bandit state and allocations
select * from bandit_state;

select d.allocator_half, d.assigned_arm, count(*) as n,
       round(avg(d.reward)::numeric, 2) as raw_success   -- monitoring only, not analysis
from decisions d join sessions s on s.id = d.session_id
where not s.is_test
group by 1, 2 order by 1, 2;

-- Q4. LLM failures and latency
select purpose, status, count(*) as n,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from llm_calls group by 1, 2 order by 1, 2;

-- Q7. LLM health right now (during a class): calls in the last 15 minutes by purpose and status,
--     then the latest failures with the provider's error text. Alerts are listed in ops_alerts.
select purpose, status, count(*) as n, max(created_at) as last_at
from llm_calls where created_at > now() - interval '15 minutes'
group by 1, 2 order by 1, 2;

select created_at, purpose, status, latency_ms, left(response_text, 200) as error_text
from llm_calls where status <> 'ok' and created_at > now() - interval '15 minutes'
order by created_at desc limit 20;

-- Q5. Sessions started and completed, by setting
select s.setting, count(*) as started, count(s.completed_at) as completed
from sessions s where not s.is_test group by 1;

-- Q6. Blind rating sheet for one rater and one day
--     (no LLM score, no attempt number, no arm, no username)
--     Replace the dates, and 'R1' with 'R2' for the second rater (gives a different order).
select a.id as item_id,
       q.prompt_ro as intrebare,
       q.reference_answer_ro as raspuns_referinta,
       q.rubric->>'0' as nota_0, q.rubric->>'1' as nota_1,
       q.rubric->>'2' as nota_2, q.rubric->>'3' as nota_3,
       a.text as raspuns_copil,
       null::int as nota
from answers a
join questions q on q.id = a.question_id
join sessions s on s.id = a.session_id
where a.rating_sample and a.grader_status = 'ok' and not s.is_test
  and a.submitted_at >= '2026-10-15' and a.submitted_at < '2026-10-16'
order by md5(a.id::text || 'R1');

-- Deactivate a question (also note it in DECISIONS.md):
-- update questions set active = false, updated_at = now() where id = '<id>';
