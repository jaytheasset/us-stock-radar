-- Server-managed links between normalized Calendar events and analyzed SEC events.
-- The relationship stores matching evidence only; neither provider payloads nor
-- analysis bodies are duplicated here.

create table public.calendar_event_analysis_links (
  id uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete cascade,
  analysis_event_id uuid not null
    references public.events (id)
    on update restrict
    on delete restrict,
  relation_type text not null,
  link_status text not null,
  match_score numeric(5, 2) not null,
  match_method text not null,
  is_primary boolean not null default false,
  reason jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_analysis_links_event_analysis_key
    unique (calendar_event_id, analysis_event_id),
  constraint calendar_event_analysis_links_relation_type_check
    check (relation_type in ('announcement', 'result', 'amendment', 'related')),
  constraint calendar_event_analysis_links_link_status_check
    check (link_status in ('candidate', 'linked', 'rejected')),
  constraint calendar_event_analysis_links_match_score_check
    check (match_score >= 0 and match_score <= 100),
  constraint calendar_event_analysis_links_match_method_check
    check (match_method in ('exact', 'rules', 'llm', 'manual')),
  constraint calendar_event_analysis_links_primary_check
    check (not is_primary or link_status = 'linked'),
  constraint calendar_event_analysis_links_reason_check
    check (pg_catalog.jsonb_typeof(reason) = 'object'),
  constraint calendar_event_analysis_links_evidence_check
    check (pg_catalog.jsonb_typeof(evidence) = 'object')
);

comment on table public.calendar_event_analysis_links is
  'Server-managed relationship between a normalized Calendar occurrence and one or more analyzed SEC events. No analysis body or provider payload is copied.';
comment on column public.calendar_event_analysis_links.match_score is
  'Deterministic score. Rules may auto-link at 90 or above; scores from 70 through 89 remain candidates.';
comment on column public.calendar_event_analysis_links.reason is
  'Machine-readable matcher decision codes. This internal field is not returned by the Calendar API.';
comment on column public.calendar_event_analysis_links.evidence is
  'Minimal structured matching evidence. This internal field is not returned by the Calendar API.';

create index calendar_event_analysis_links_calendar_idx
  on public.calendar_event_analysis_links
  (calendar_event_id, link_status, match_score desc, analysis_event_id);
create index calendar_event_analysis_links_analysis_idx
  on public.calendar_event_analysis_links
  (analysis_event_id, calendar_event_id);
create unique index calendar_event_analysis_links_primary_uidx
  on public.calendar_event_analysis_links (calendar_event_id)
  where is_primary and link_status = 'linked';

alter table public.calendar_event_analysis_links enable row level security;

revoke all on table public.calendar_event_analysis_links
from public, anon, authenticated;

grant select, insert, update, delete
on table public.calendar_event_analysis_links
to service_role;

create function public.upsert_calendar_event_analysis_matches(
  p_calendar_event_id uuid,
  p_matches jsonb,
  p_primary_analysis_event_id uuid default null
)
returns table (
  processed_count integer,
  changed_count integer,
  primary_analysis_event_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_processed_count integer := 0;
  v_changed_count integer := 0;
  v_manual_primary uuid;
  v_primary uuid;
begin
  if p_calendar_event_id is null then
    raise exception 'calendar_event_id is required';
  end if;
  if p_matches is null or pg_catalog.jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be a JSON array';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_calendar_event_id::text, 0)
  );

  select pg_catalog.count(*)::integer
  into v_processed_count
  from pg_catalog.jsonb_array_elements(p_matches);

  insert into public.calendar_event_analysis_links as existing (
    calendar_event_id,
    analysis_event_id,
    relation_type,
    link_status,
    match_score,
    match_method,
    is_primary,
    reason,
    evidence,
    updated_at
  )
  select
    p_calendar_event_id,
    input.analysis_event_id,
    input.relation_type,
    input.link_status,
    input.match_score,
    input.match_method,
    false,
    coalesce(input.reason, '{}'::jsonb),
    coalesce(input.evidence, '{}'::jsonb),
    pg_catalog.now()
  from pg_catalog.jsonb_to_recordset(p_matches) as input (
    analysis_event_id uuid,
    relation_type text,
    link_status text,
    match_score numeric,
    match_method text,
    reason jsonb,
    evidence jsonb
  )
  on conflict (calendar_event_id, analysis_event_id) do update
  set
    relation_type = excluded.relation_type,
    link_status = case
      when existing.link_status = 'linked' and excluded.link_status = 'candidate'
        then existing.link_status
      else excluded.link_status
    end,
    match_score = greatest(existing.match_score, excluded.match_score),
    match_method = excluded.match_method,
    reason = excluded.reason,
    evidence = excluded.evidence,
    updated_at = pg_catalog.now()
  where existing.match_method <> 'manual'
    and (
      existing.relation_type,
      existing.link_status,
      existing.match_score,
      existing.match_method,
      existing.reason,
      existing.evidence
    ) is distinct from (
      excluded.relation_type,
      case
        when existing.link_status = 'linked' and excluded.link_status = 'candidate'
          then existing.link_status
        else excluded.link_status
      end,
      greatest(existing.match_score, excluded.match_score),
      excluded.match_method,
      excluded.reason,
      excluded.evidence
    );

  get diagnostics v_changed_count = row_count;

  select link.analysis_event_id
  into v_manual_primary
  from public.calendar_event_analysis_links as link
  where link.calendar_event_id = p_calendar_event_id
    and link.is_primary
    and link.link_status = 'linked'
    and link.match_method = 'manual'
  limit 1;

  if v_manual_primary is not null then
    v_primary := v_manual_primary;
  elsif p_primary_analysis_event_id is not null then
    update public.calendar_event_analysis_links
    set is_primary = false,
        updated_at = case when is_primary then pg_catalog.now() else updated_at end
    where calendar_event_id = p_calendar_event_id
      and is_primary
      and analysis_event_id <> p_primary_analysis_event_id;

    update public.calendar_event_analysis_links
    set is_primary = true,
        updated_at = case when is_primary then updated_at else pg_catalog.now() end
    where calendar_event_id = p_calendar_event_id
      and analysis_event_id = p_primary_analysis_event_id
      and link_status = 'linked';

    if not found then
      raise exception 'primary analysis must be a linked match for this Calendar event';
    end if;
    v_primary := p_primary_analysis_event_id;
  else
    select link.analysis_event_id
    into v_primary
    from public.calendar_event_analysis_links as link
    where link.calendar_event_id = p_calendar_event_id
      and link.is_primary
      and link.link_status = 'linked'
    limit 1;
  end if;

  return query select v_processed_count, v_changed_count, v_primary;
end;
$$;

revoke all on function public.upsert_calendar_event_analysis_matches(uuid, jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.upsert_calendar_event_analysis_matches(uuid, jsonb, uuid)
to service_role;
