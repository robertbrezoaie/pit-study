-- Token usage of the current calendar month (UTC), per model, for the budget alert.
-- Counts every logged LLM call (test sessions cost money too).
create function llm_month_usage()
returns table (model text, calls bigint, input_tokens bigint, output_tokens bigint)
language sql stable as $$
  select model, count(*), coalesce(sum(input_tokens), 0)::bigint, coalesce(sum(output_tokens), 0)::bigint
  from llm_calls
  where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  group by model;
$$;

revoke execute on function llm_month_usage() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function llm_month_usage() from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function llm_month_usage() to service_role';
  end if;
end $$;
