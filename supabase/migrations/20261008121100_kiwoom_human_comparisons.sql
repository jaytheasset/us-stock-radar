-- CLI-created migration ordered after its existing 20261008121000 dependency.
-- Supporting human assertions only. No ticker/current/identity/Watchlist/Alert writes.
create function private.kiwoom_canonical_json(v jsonb) returns text language sql immutable strict set search_path = '' as $fn$
  select case jsonb_typeof(v)
    when 'object' then '{' || coalesce((select string_agg(to_jsonb(key)::text || ':' || private.kiwoom_canonical_json(value), ',' order by key collate "C") from jsonb_each(v)), '') || '}'
    when 'array' then '[' || coalesce((select string_agg(private.kiwoom_canonical_json(value), ',' order by ord) from jsonb_array_elements(v) with ordinality a(value,ord)), '') || ']'
    else v::text end;
$fn$;
create function private.kiwoom_json_hash(v jsonb) returns text language sql immutable strict set search_path = '' as $fn$
  select encode(extensions.digest(private.kiwoom_canonical_json(v),'sha256'),'hex');
$fn$;
revoke all on function private.kiwoom_canonical_json(jsonb), private.kiwoom_json_hash(jsonb) from public,anon,authenticated;
grant execute on function private.kiwoom_canonical_json(jsonb), private.kiwoom_json_hash(jsonb) to service_role;

create table public.kiwoom_sec_human_judgments (
  id uuid primary key,
  case_id uuid not null,
  revision integer not null check (revision > 0),
  previous_id uuid references public.kiwoom_sec_human_judgments(id),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  decision_id uuid not null references public.sec_ticker_resolution_decisions(id) on delete restrict,
  review_id uuid not null references public.kiwoom_ticker_evidence_reviews(id) on delete restrict,
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 100000),
  judgment jsonb not null check (jsonb_typeof(judgment) = 'object'),
  judgment_sha256 text not null check (judgment_sha256 ~ '^[a-f0-9]{64}$'),
  ticker_authority text not null default 'none' check (ticker_authority = 'none'),
  audit_log_id uuid not null references public.admin_audit_logs(id) deferrable initially deferred,
  created_at timestamptz not null default clock_timestamp(),
  unique(case_id,revision), unique(actor_user_id,request_id),
  check (judgment ->> 'version' = 'sec-human-change-v1'),
  check (judgment ->> 'status' in ('confirmed','unconfirmed','withdrawn')),
  check (request_hash = private.kiwoom_json_hash(draft)),
  check (judgment_sha256 = private.kiwoom_json_hash(judgment))
);
create table public.kiwoom_sec_human_comparisons (
  judgment_id uuid primary key references public.kiwoom_sec_human_judgments(id) deferrable initially deferred,
  comparison jsonb not null check (jsonb_typeof(comparison) = 'object' and octet_length(comparison::text) <= 500000),
  comparison_sha256 text not null check (comparison_sha256 ~ '^[a-f0-9]{64}$'),
  check (comparison ->> 'tickerAuthority' = 'none'),
  check (comparison ->> 'comparisonSha256' = comparison_sha256),
  check (comparison_sha256 = private.kiwoom_json_hash(comparison - 'comparisonSha256'))
);
alter table public.kiwoom_sec_human_judgments add foreign key(id) references public.kiwoom_sec_human_comparisons(judgment_id) deferrable initially deferred;
create index kiwoom_human_recent on public.kiwoom_sec_human_judgments(created_at desc,id desc);
create index kiwoom_human_decision on public.kiwoom_sec_human_judgments(decision_id);
create index kiwoom_human_review on public.kiwoom_sec_human_judgments(review_id);
alter table public.kiwoom_sec_human_judgments enable row level security;
alter table public.kiwoom_sec_human_comparisons enable row level security;
revoke all on public.kiwoom_sec_human_judgments,public.kiwoom_sec_human_comparisons from public,anon,authenticated,service_role;
grant select,insert on public.kiwoom_sec_human_judgments,public.kiwoom_sec_human_comparisons to service_role;
create trigger kiwoom_human_append_only before update or delete on public.kiwoom_sec_human_judgments
for each row execute function private.kiwoom_evidence_append_only();
create trigger kiwoom_comparison_append_only before update or delete on public.kiwoom_sec_human_comparisons
for each row execute function private.kiwoom_evidence_append_only();

create function public.admin_record_kiwoom_human_comparison(
  p_actor_user_id uuid,p_request_id uuid,p_request_hash text,p_draft jsonb,p_judgment jsonb,p_comparison jsonb
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare
  v_role text; v_case uuid; v_id uuid; v_audit uuid := extensions.gen_random_uuid(); v_expected integer;
  v_last public.kiwoom_sec_human_judgments; v_saved public.kiwoom_sec_human_judgments;
  v_review public.kiwoom_ticker_evidence_reviews; v_comparison public.kiwoom_sec_human_comparisons;
  v_decision public.sec_ticker_resolution_decisions; v_raw public.sec_structured_raw_sources;
begin
  v_role := private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
  if v_role is null then raise exception 'ADMIN_PERMISSION_REQUIRED'; end if;
  if p_request_id is null or jsonb_typeof(p_draft) is distinct from 'object' or
    p_request_hash is distinct from private.kiwoom_json_hash(p_draft) then raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  -- Fixed request -> human case -> existing Kiwoom case lock order.
  perform pg_advisory_xact_lock(hashtextextended('kiwoom-human-request:' || p_actor_user_id::text || ':' || p_request_id::text,0));
  select * into v_saved from public.kiwoom_sec_human_judgments where actor_user_id=p_actor_user_id and request_id=p_request_id;
  if found then
    if v_saved.request_hash <> p_request_hash or v_saved.draft <> p_draft then raise exception 'KIWOOM_HUMAN_IDEMPOTENCY_CONFLICT'; end if;
    select * into strict v_comparison from public.kiwoom_sec_human_comparisons where judgment_id=v_saved.id;
    return jsonb_build_object('status','replayed','judgment',to_jsonb(v_saved),'comparison',to_jsonb(v_comparison));
  end if;
  v_case := (p_draft ->> 'caseId')::uuid; v_expected := (p_draft ->> 'expectedRevision')::integer; v_id := (p_judgment ->> 'id')::uuid;
  if v_case is null or v_expected is null or v_expected < 0 or v_id is null then raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kiwoom-human-case:' || v_case::text,0));
  select * into v_last from public.kiwoom_sec_human_judgments where case_id=v_case order by revision desc limit 1;
  if coalesce(v_last.revision,0) <> v_expected or v_last.id is distinct from (p_draft ->> 'previousId')::uuid or
    v_last.judgment ->> 'status' = 'withdrawn' or
    (v_last.id is not null and v_last.decision_id::text <> p_draft ->> 'decisionId') then raise exception 'KIWOOM_HUMAN_REVISION_CONFLICT'; end if;
  if p_judgment ->> 'version' is distinct from 'sec-human-change-v1' or
    p_judgment #>> '{actor,id}' is distinct from p_actor_user_id::text or
    p_judgment #>> '{actor,provenance}' is distinct from 'caller_supplied_unverified' or
    p_judgment ->> 'caseId' is distinct from v_case::text or (p_judgment ->> 'revision')::int is distinct from v_expected+1 or
    p_judgment ->> 'previousJudgmentSha256' is distinct from v_last.judgment_sha256 or
    p_judgment ->> 'candidateRevisionSha256' is distinct from p_draft ->> 'expectedCandidateRevisionSha256' or
    p_judgment -> 'source' is distinct from p_draft -> 'source' or
    p_comparison -> 'secHuman' is distinct from p_judgment or
    p_comparison ->> 'humanJudgmentSha256' is distinct from private.kiwoom_json_hash(p_judgment) or
    p_comparison #>> '{originalLink,candidate,decisionId}' is distinct from p_draft ->> 'decisionId' or
    p_comparison #>> '{originalLink,candidate,decisionSha256}' is distinct from p_draft ->> 'expectedDecisionSha256' or
    p_comparison #>> '{originalLink,candidate,revisionSha256}' is distinct from p_draft ->> 'expectedCandidateRevisionSha256' or
    p_comparison #> '{originalLink,observed}' is distinct from p_draft -> 'row' then raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  if exists (select 1 from jsonb_each(p_draft -> 'human') e where e.value is distinct from p_judgment -> e.key) then raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  if p_draft ->> 'action' = 'withdraw' then
    if v_last.id is null or p_judgment ->> 'status' is distinct from 'withdrawn' or
      (p_draft - 'action' - 'expectedRevision' - 'previousId' - 'human') <> (v_last.draft - 'action' - 'expectedRevision' - 'previousId' - 'human') or
      ((p_draft -> 'human') - 'status' - 'reason') <> ((v_last.draft -> 'human') - 'status' - 'reason') or
      p_comparison #>> '{assessment,eligible}' is distinct from 'false' then raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  elsif p_draft ->> 'action' = 'append' and p_judgment ->> 'status' in ('confirmed','unconfirmed') then
    select * into v_decision from public.sec_ticker_resolution_decisions where id=(p_draft ->> 'decisionId')::uuid;
    if not found or v_decision.decision_sha256 is distinct from p_draft ->> 'expectedDecisionSha256' or
      v_decision.decision_payload is distinct from p_comparison #> '{automatic,decision,decision_payload}' then raise exception 'KIWOOM_HUMAN_INPUT_STALE'; end if;
    select * into v_raw from public.sec_structured_raw_sources where id=(p_judgment #>> '{source,rawSourceId}')::uuid;
    if not found or v_raw.content_hash is distinct from p_judgment #>> '{source,sha256}' or
      encode(extensions.digest(v_raw.raw_content,'sha256'),'hex') is distinct from p_judgment #>> '{source,sha256}' or
      v_raw.source_url is distinct from p_judgment #>> '{source,url}' then raise exception 'KIWOOM_HUMAN_INPUT_STALE'; end if;
    select * into v_review from public.kiwoom_ticker_evidence_reviews where id=(p_draft ->> 'reviewId')::uuid;
    if not found then raise exception 'KIWOOM_HUMAN_INPUT_STALE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('kiwoom-case:' || v_review.case_id::text,0));
    if v_review.verdict='withdrawn' or v_review.revision <> (p_draft ->> 'expectedReviewRevision')::int or
      v_review.source_hash is distinct from p_draft ->> 'expectedSnapshotSha256' or
      v_review.draft #>> '{proof,imageSha256}' is distinct from p_draft ->> 'expectedImageSha256' or
      v_review.draft #>> '{proof,locator}' is distinct from p_draft #>> '{row,locator}' or
      v_review.id::text is distinct from p_draft #>> '{row,reviewId}' or
      v_review.case_id::text is distinct from p_draft #>> '{row,caseId}' or
      exists(select 1 from public.kiwoom_ticker_evidence_reviews where case_id=v_review.case_id and revision>v_review.revision)
      then raise exception 'KIWOOM_HUMAN_INPUT_STALE'; end if;
  else raise exception 'KIWOOM_HUMAN_INPUT_INVALID'; end if;
  -- Deferred FKs require all three records; an error at any step rolls back the RPC.
  insert into public.kiwoom_sec_human_judgments(id,case_id,revision,previous_id,actor_user_id,request_id,request_hash,decision_id,review_id,draft,judgment,judgment_sha256,audit_log_id)
  values(v_id,v_case,v_expected+1,v_last.id,p_actor_user_id,p_request_id,p_request_hash,(p_draft ->> 'decisionId')::uuid,
    (p_draft ->> 'reviewId')::uuid,p_draft,p_judgment,private.kiwoom_json_hash(p_judgment),v_audit) returning * into v_saved;
  insert into public.kiwoom_sec_human_comparisons(judgment_id,comparison,comparison_sha256)
  values(v_id,p_comparison,p_comparison ->> 'comparisonSha256') returning * into v_comparison;
  insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
  values(v_audit,p_actor_user_id,v_role,'kiwoom_human.' || (p_draft ->> 'action'),'kiwoom_human_comparison',v_case::text,p_judgment ->> 'reason',
    case when v_last.id is null then null else jsonb_build_object('id',v_last.id,'revision',v_last.revision) end,
    jsonb_build_object('id',v_id,'revision',v_expected+1,'judgmentSha256',v_saved.judgment_sha256,'comparisonSha256',v_comparison.comparison_sha256,'tickerAuthority','none'),p_request_id::text);
  return jsonb_build_object('status','inserted','judgment',to_jsonb(v_saved),'comparison',to_jsonb(v_comparison));
end;
$fn$;
revoke all on function public.admin_record_kiwoom_human_comparison(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_record_kiwoom_human_comparison(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
