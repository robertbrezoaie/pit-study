-- Operational alerts (not research data): one row per alert sent, at most one per kind per
-- 10-minute bucket. The primary key makes the "already sent" check atomic across instances.
create table ops_alerts (
  kind text not null,
  bucket bigint not null,          -- floor(epoch_ms / 600000)
  detail jsonb,
  sent_at timestamptz not null default now(),
  primary key (kind, bucket)
);
alter table ops_alerts enable row level security;
