-- Reset events for canonical live-feed schema.
-- Approved for current development data: existing events can be deleted.
--
-- This migration intentionally removes the legacy event fields that were
-- replaced by canonical columns:
--   impact_level -> impact
--   market_direction / direction -> signal
--   metadata.alert_policy.visibility -> delivery_level
--   metadata.source_group -> source_group

create extension if not exists pgcrypto;

do $$
begin
  create type source_group as enum ('news', 'filings', 'market');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_delivery_level as enum ('archive', 'feed', 'alert');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_impact as enum ('high', 'medium', 'low');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_signal as enum ('bullish', 'bearish', 'volatile', 'neutral');
exception
  when duplicate_object then null;
end $$;

alter table events
  add column if not exists source_group source_group,
  add column if not exists quick_take text,
  add column if not exists score integer,
  add column if not exists delivery_level event_delivery_level,
  add column if not exists impact event_impact,
  add column if not exists signal event_signal,
  add column if not exists group_dedupe_key text,
  add column if not exists cross_group_event_key text,
  add column if not exists metadata jsonb default '{}'::jsonb;

truncate table events restart identity cascade;

alter table events
  drop column if exists impact_level,
  drop column if exists confidence,
  drop column if exists market_direction,
  drop column if exists direction;

alter table events
  alter column source_group set not null,
  alter column score set not null,
  alter column delivery_level set not null,
  alter column impact set not null,
  alter column signal set not null,
  alter column group_dedupe_key set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null;

do $$
begin
  alter table events
    add constraint events_score_range check (score >= 0 and score <= 100);
exception
  when duplicate_object then null;
end $$;

drop index if exists events_group_dedupe_idx;
create unique index events_group_dedupe_idx
  on events(source_group, group_dedupe_key);

create index if not exists events_detected_idx
  on events(detected_at desc);

create index if not exists events_group_detected_idx
  on events(source_group, detected_at desc);

create index if not exists events_type_delivery_idx
  on events(event_type, delivery_level);

create index if not exists events_score_idx
  on events(score desc, delivery_level);

create index if not exists events_signal_idx
  on events(signal, detected_at desc);

create index if not exists events_cross_group_key_idx
  on events(cross_group_event_key)
  where cross_group_event_key is not null;

comment on column events.source_group is 'Canonical source group: news, filings, or market. Do not store this in metadata.';
comment on column events.quick_take is 'One-line feed card takeaway shown under the title.';
comment on column events.score is '0-100 score. Delivery level is derived upstream and written explicitly.';
comment on column events.delivery_level is 'Canonical archive/feed/alert visibility. Do not store alert visibility in metadata.';
comment on column events.impact is 'Canonical high/medium/low impact label.';
comment on column events.signal is 'Canonical bullish/bearish/volatile/neutral signal. Replaces market_direction/direction.';
comment on column events.metadata is 'Raw/debug/extra payload only. Not used for live-feed canonical filters.';
