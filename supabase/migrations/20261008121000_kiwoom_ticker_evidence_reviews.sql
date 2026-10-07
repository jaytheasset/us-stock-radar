-- Supporting evidence, NOT a security identity registry or a ticker publisher.
create table public.kiwoom_ticker_evidence_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  case_id uuid not null,
  revision integer not null check (revision > 0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  verdict text not null check (verdict in ('supports','conflicts','unclear','withdrawn')),
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and draft #>> '{facts,market}' = 'US'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and snapshot ->> 'authority' = 'supporting_evidence_only'),
  ticker_authority text not null default 'none' check (ticker_authority = 'none'),
  audit_log_id uuid not null references public.admin_audit_logs(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (case_id, revision),
  unique (actor_user_id, request_id),
  check (octet_length(snapshot::text) <= 10000000),
  check (source_hash = snapshot ->> 'sourceHash' and source_hash = draft ->> 'expectedSourceHash'),
  check (verdict = draft ->> 'verdict' and case_id::text = draft ->> 'caseId'),
  check (revision = (draft ->> 'expectedRevision')::integer + 1)
);
create index kiwoom_ticker_evidence_recent on public.kiwoom_ticker_evidence_reviews (created_at desc, id desc);
alter table public.kiwoom_ticker_evidence_reviews enable row level security;
revoke all on table public.kiwoom_ticker_evidence_reviews from public, anon, authenticated, service_role;
grant select, insert on table public.kiwoom_ticker_evidence_reviews to service_role;

create function private.kiwoom_evidence_append_only() returns trigger language plpgsql set search_path = '' as $fn$
begin raise exception 'KIWOOM_EVIDENCE_APPEND_ONLY'; end;
$fn$;
create trigger kiwoom_evidence_append_only before update or delete on public.kiwoom_ticker_evidence_reviews
for each row execute function private.kiwoom_evidence_append_only();
revoke all on function private.kiwoom_evidence_append_only() from public;

create function public.admin_record_kiwoom_ticker_evidence(
  p_actor_user_id uuid, p_request_id uuid, p_request_hash text, p_draft jsonb, p_snapshot jsonb
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare
  v_role text;
  v_case uuid;
  v_expected integer;
  v_last public.kiwoom_ticker_evidence_reviews;
  v_saved public.kiwoom_ticker_evidence_reviews;
  v_id uuid := extensions.gen_random_uuid();
  v_audit uuid := extensions.gen_random_uuid();
begin
  v_role := private.admin_actor_role(p_actor_user_id, array['super_admin','operations']);
  if v_role is null then raise exception 'ADMIN_PERMISSION_REQUIRED'; end if;
  if p_request_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or
     jsonb_typeof(p_draft) is distinct from 'object' or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'KIWOOM_REVIEW_INVALID';
  end if;
  v_case := (p_draft ->> 'caseId')::uuid;
  v_expected := (p_draft ->> 'expectedRevision')::integer;
  if v_case is null or v_expected is null or v_expected < 0 or
     p_draft #>> '{facts,market}' is distinct from 'US' or
     p_snapshot ->> 'authority' is distinct from 'supporting_evidence_only' or
     p_snapshot ->> 'version' is distinct from 'kiwoom-notice-v1' or
     p_snapshot ->> 'id' is distinct from p_draft ->> 'noticeId' or
     p_snapshot ->> 'sourceHash' is distinct from p_draft ->> 'expectedSourceHash' or
     coalesce(p_draft ->> 'verdict','') not in ('supports','conflicts','unclear','withdrawn') or
     char_length(coalesce(p_draft ->> 'reason','')) not between 4 and 2000 then
    raise exception 'KIWOOM_REVIEW_INVALID';
  end if;
  if p_draft ->> 'verdict' in ('supports','conflicts') and
     p_draft -> 'usMarketRowReviewed' is distinct from 'true'::jsonb then raise exception 'KIWOOM_REVIEW_INVALID'; end if;
  -- Stable lock order: request identity first, then review-case revision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kiwoom-request:' || p_actor_user_id::text || ':' || p_request_id::text,0));
  select * into v_saved from public.kiwoom_ticker_evidence_reviews where actor_user_id = p_actor_user_id and request_id = p_request_id;
  if found then
    if v_saved.request_hash <> p_request_hash or v_saved.draft <> p_draft then raise exception 'KIWOOM_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('status','replayed','review',pg_catalog.to_jsonb(v_saved));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kiwoom-case:' || v_case::text,0));
  select * into v_last from public.kiwoom_ticker_evidence_reviews where case_id = v_case order by revision desc limit 1;
  if coalesce(v_last.revision,0) <> v_expected then raise exception 'KIWOOM_REVISION_CONFLICT'; end if;
  if p_draft ->> 'verdict' = 'withdrawn' and (v_last.id is null or v_last.verdict = 'withdrawn' or
      v_last.draft -> 'facts' <> p_draft -> 'facts' or v_last.source_hash <> p_snapshot ->> 'sourceHash') then
    raise exception 'KIWOOM_REVISION_CONFLICT';
  end if;
  insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
  values (v_audit,p_actor_user_id,v_role,'kiwoom_evidence.' || (p_draft ->> 'verdict'),'kiwoom_ticker_evidence',v_case::text,
    p_draft ->> 'reason',case when v_last.id is null then null else jsonb_build_object('id',v_last.id,'revision',v_last.revision) end,
    jsonb_build_object('id',v_id,'revision',v_expected+1,'sourceHash',p_snapshot ->> 'sourceHash','tickerAuthority','none'),p_request_id::text);
  insert into public.kiwoom_ticker_evidence_reviews(id,case_id,revision,actor_user_id,request_id,request_hash,source_hash,verdict,draft,snapshot,audit_log_id)
  values (v_id,v_case,v_expected+1,p_actor_user_id,p_request_id,p_request_hash,p_snapshot ->> 'sourceHash',p_draft ->> 'verdict',p_draft,p_snapshot,v_audit)
  returning * into v_saved;
  return pg_catalog.jsonb_build_object('status','inserted','review',pg_catalog.to_jsonb(v_saved));
end;
$fn$;
revoke all on function public.admin_record_kiwoom_ticker_evidence(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_record_kiwoom_ticker_evidence(uuid,uuid,text,jsonb,jsonb) to service_role;
