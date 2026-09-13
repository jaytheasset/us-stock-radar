begin;

create table public.sec_ticker_resolution_human_decisions (
  id uuid primary key,
  automatic_decision_id uuid not null
    references public.sec_ticker_resolution_decisions(id) on delete restrict,
  automatic_decision_sha256 text not null,
  scope_key text not null,
  scope_payload jsonb not null,
  revision integer not null,
  action text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  reason text not null,
  automatic_snapshot jsonb not null,
  evidence_references jsonb not null,
  previous_human_decision_id uuid
    references public.sec_ticker_resolution_human_decisions(id) on delete restrict,
  withdraws_human_decision_id uuid
    references public.sec_ticker_resolution_human_decisions(id) on delete restrict,
  resulting_effective_action text,
  resulting_effective_human_decision_id uuid
    references public.sec_ticker_resolution_human_decisions(id) on delete restrict,
  request_id text not null,
  request_payload_sha256 text not null,
  audit_log_id uuid not null unique
    references public.admin_audit_logs(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_ticker_resolution_human_decisions_scope_revision_unique
    unique (scope_key, revision),
  constraint sec_ticker_resolution_human_decisions_request_unique
    unique (request_id),
  constraint sec_ticker_resolution_human_decisions_auto_hash_check
    check (automatic_decision_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sec_ticker_resolution_human_decisions_scope_check
    check (
      scope_key ~ '^[0-9a-f]{64}$'
      and pg_catalog.jsonb_typeof(scope_payload) = 'object'
    ),
  constraint sec_ticker_resolution_human_decisions_revision_check
    check (revision >= 1),
  constraint sec_ticker_resolution_human_decisions_action_check
    check (action in ('reviewed', 'approved', 'rejected', 'withdrawn')),
  constraint sec_ticker_resolution_human_decisions_actor_role_check
    check (actor_role in ('super_admin', 'operations')),
  constraint sec_ticker_resolution_human_decisions_reason_check
    check (pg_catalog.char_length(reason) between 4 and 2000),
  constraint sec_ticker_resolution_human_decisions_snapshot_check
    check (
      pg_catalog.jsonb_typeof(automatic_snapshot) = 'object'
      and pg_catalog.jsonb_typeof(evidence_references) = 'object'
    ),
  constraint sec_ticker_resolution_human_decisions_request_check
    check (
      pg_catalog.char_length(request_id) between 1 and 240
      and request_payload_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint sec_ticker_resolution_human_decisions_previous_check
    check (
      (revision = 1 and previous_human_decision_id is null)
      or (revision > 1 and previous_human_decision_id is not null)
    ),
  constraint sec_ticker_resolution_human_decisions_result_check
    check (
      (
        action in ('approved', 'rejected')
        and resulting_effective_action = action
        and resulting_effective_human_decision_id = id
        and withdraws_human_decision_id is null
      )
      or (
        action = 'reviewed'
        and withdraws_human_decision_id is null
        and (
          (resulting_effective_action is null and resulting_effective_human_decision_id is null)
          or (
            resulting_effective_action in ('approved', 'rejected')
            and resulting_effective_human_decision_id is not null
          )
        )
      )
      or (
        action = 'withdrawn'
        and withdraws_human_decision_id is not null
        and resulting_effective_action is null
        and resulting_effective_human_decision_id is null
      )
    )
);

create index sec_ticker_resolution_human_decisions_scope_created_idx
  on public.sec_ticker_resolution_human_decisions (scope_key, revision desc);
create index sec_ticker_resolution_human_decisions_automatic_idx
  on public.sec_ticker_resolution_human_decisions (automatic_decision_id, created_at desc);

alter table public.sec_ticker_resolution_human_decisions enable row level security;
revoke all on table public.sec_ticker_resolution_human_decisions
  from public, anon, authenticated, service_role;
grant select, insert on table public.sec_ticker_resolution_human_decisions to service_role;

create function private.sec_ticker_resolution_human_scope_payload(
  p_decision public.sec_ticker_resolution_decisions
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'issuerCik', p_decision.issuer_cik,
    'resolutionType', p_decision.resolution_type,
    'beforeAccessionNumber', p_decision.before_accession_number,
    'afterAccessionNumber', p_decision.after_accession_number
  )
$function$;

create function private.sec_ticker_resolution_human_scope_key(
  p_decision public.sec_ticker_resolution_decisions
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          pg_catalog.chr(31),
          p_decision.issuer_cik,
          p_decision.resolution_type,
          p_decision.before_accession_number,
          p_decision.after_accession_number
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

create function private.reject_sec_ticker_resolution_human_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'SEC ticker human decision rows are append-only';
end
$function$;

create trigger sec_ticker_resolution_human_decisions_append_only
before update or delete on public.sec_ticker_resolution_human_decisions
for each row execute function private.reject_sec_ticker_resolution_human_mutation();

create function private.assert_sec_ticker_resolution_source_current(
  p_decision public.sec_ticker_resolution_decisions
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_reference jsonb;
  v_selected public.sec_cover_observation_results;
  v_match_count integer;
begin
  for v_reference in
    select value
    from pg_catalog.jsonb_array_elements(
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'resultId', p_decision.source_result_id,
          'accessionNumber', p_decision.evidence_accession_number,
          'sourceSha256', p_decision.decision_payload #>> '{input,sourceSha256}'
        ),
        pg_catalog.jsonb_build_object(
          'resultId', p_decision.decision_payload #>> '{input,beforeResultId}',
          'accessionNumber', p_decision.before_accession_number,
          'sourceSha256', p_decision.decision_payload #>> '{input,beforeSourceSha256}'
        ),
        pg_catalog.jsonb_build_object(
          'resultId', p_decision.decision_payload #>> '{input,afterResultId}',
          'accessionNumber', p_decision.after_accession_number,
          'sourceSha256', p_decision.decision_payload #>> '{input,afterSourceSha256}'
        )
      )
    )
  loop
    if coalesce(v_reference ->> 'accessionNumber', '') = ''
      or coalesce(v_reference ->> 'sourceSha256', '') !~ '^[0-9a-f]{64}$'
    then
      raise exception 'ADMIN_TICKER_SOURCE_REVISION_CONFLICT';
    end if;

    select pg_catalog.count(*)::integer into v_match_count
    from public.sec_cover_observation_results as result
    where result.accession_number = v_reference ->> 'accessionNumber'
      and result.source_sha256 = v_reference ->> 'sourceSha256'
      and (
        nullif(v_reference ->> 'resultId', '') is null
        or result.id = (v_reference ->> 'resultId')::uuid
      );
    if v_match_count <> 1 then
      raise exception 'ADMIN_TICKER_SOURCE_REVISION_CONFLICT';
    end if;

    select result.* into v_selected
    from public.sec_cover_observation_results as result
    where result.accession_number = v_reference ->> 'accessionNumber'
      and result.source_sha256 = v_reference ->> 'sourceSha256'
      and (
        nullif(v_reference ->> 'resultId', '') is null
        or result.id = (v_reference ->> 'resultId')::uuid
      )
    limit 1;

    if exists (
      select 1
      from public.sec_cover_observation_results as revision
      where revision.accession_number = v_selected.accession_number
        and revision.source_kind = v_selected.source_kind
        and revision.source_url = v_selected.source_url
        and revision.source_document = v_selected.source_document
        and revision.source_sha256 <> v_selected.source_sha256
    ) then
      raise exception 'ADMIN_TICKER_SOURCE_REVISION_CONFLICT';
    end if;
  end loop;
end
$function$;

create function public.admin_apply_sec_ticker_resolution_human_decision(
  p_actor_user_id uuid,
  p_automatic_decision_id uuid,
  p_expected_automatic_sha256 text,
  p_expected_revision integer,
  p_action text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_request_id text := pg_catalog.btrim(coalesce(p_request_id, ''));
  v_request_payload jsonb;
  v_request_payload_sha256 text;
  v_replay public.sec_ticker_resolution_human_decisions;
  v_automatic public.sec_ticker_resolution_decisions;
  v_latest_automatic public.sec_ticker_resolution_decisions;
  v_identity public.sec_ticker_security_identities;
  v_evidence public.sec_ticker_change_evidence;
  v_previous public.sec_ticker_resolution_human_decisions;
  v_scope_payload jsonb;
  v_scope_key text;
  v_revision integer;
  v_id uuid := extensions.gen_random_uuid();
  v_audit_id uuid := extensions.gen_random_uuid();
  v_resulting_action text;
  v_resulting_decision_id uuid;
  v_withdraws_decision_id uuid;
  v_snapshot jsonb;
  v_evidence_references jsonb;
  v_response jsonb;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations']
  );
  if v_actor_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  if pg_catalog.char_length(v_reason) < 4 or pg_catalog.char_length(v_reason) > 2000 then
    raise exception 'ADMIN_TICKER_REASON_REQUIRED';
  end if;
  if v_action not in ('reviewed', 'approved', 'rejected', 'withdrawn') then
    raise exception 'ADMIN_TICKER_ACTION_INVALID';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'ADMIN_TICKER_EXPECTED_REVISION_REQUIRED';
  end if;
  if pg_catalog.char_length(v_request_id) < 1 or pg_catalog.char_length(v_request_id) > 240 then
    raise exception 'ADMIN_TICKER_REQUEST_ID_REQUIRED';
  end if;
  if coalesce(p_expected_automatic_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'ADMIN_TICKER_AUTOMATIC_REVISION_REQUIRED';
  end if;

  v_request_payload := pg_catalog.jsonb_build_object(
    'actorUserId', p_actor_user_id,
    'automaticDecisionId', p_automatic_decision_id,
    'expectedAutomaticSha256', p_expected_automatic_sha256,
    'expectedRevision', p_expected_revision,
    'action', v_action,
    'reason', v_reason
  );
  v_request_payload_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sec-ticker-human-request:' || v_request_id, 0)
  );
  select human.* into v_replay
  from public.sec_ticker_resolution_human_decisions as human
  where human.request_id = v_request_id;
  if found then
    if v_replay.request_payload_sha256 <> v_request_payload_sha256 then
      raise exception 'ADMIN_TICKER_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed',
      'humanDecisionId', v_replay.id,
      'automaticDecisionId', v_replay.automatic_decision_id,
      'revision', v_replay.revision,
      'action', v_replay.action,
      'resultingEffectiveAction', v_replay.resulting_effective_action,
      'scopeKey', v_replay.scope_key,
      'auditLogId', v_replay.audit_log_id
    );
  end if;

  select decision.* into v_automatic
  from public.sec_ticker_resolution_decisions as decision
  where decision.id = p_automatic_decision_id;
  if not found then
    raise exception 'ADMIN_TICKER_AUTOMATIC_NOT_FOUND';
  end if;
  if v_automatic.decision_sha256 <> p_expected_automatic_sha256 then
    raise exception 'ADMIN_TICKER_AUTOMATIC_REVISION_CONFLICT';
  end if;

  v_scope_payload := private.sec_ticker_resolution_human_scope_payload(v_automatic);
  v_scope_key := private.sec_ticker_resolution_human_scope_key(v_automatic);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sec-ticker-human-scope:' || v_scope_key, 0)
  );

  select decision.* into v_latest_automatic
  from public.sec_ticker_resolution_decisions as decision
  where decision.method_version = v_automatic.method_version
    and private.sec_ticker_resolution_human_scope_key(decision) = v_scope_key
  order by decision.created_at desc, decision.id desc
  limit 1;
  if v_latest_automatic.id is distinct from v_automatic.id then
    raise exception 'ADMIN_TICKER_AUTOMATIC_REVISION_CONFLICT';
  end if;
  perform private.assert_sec_ticker_resolution_source_current(v_automatic);

  select human.* into v_previous
  from public.sec_ticker_resolution_human_decisions as human
  where human.scope_key = v_scope_key
  order by human.revision desc
  limit 1;
  v_revision := coalesce(v_previous.revision, 0) + 1;
  if p_expected_revision <> v_revision - 1 then
    raise exception 'ADMIN_TICKER_HUMAN_REVISION_CONFLICT';
  end if;

  if v_action = 'reviewed' and v_automatic.resolution_state <> 'AUTO' then
    raise exception 'ADMIN_TICKER_ACTION_UNAVAILABLE';
  end if;

  if v_action = 'approved' then
    if v_automatic.resolution_state not in ('REVIEW', 'UNRESOLVED')
      or v_automatic.security_identity_id is null
      or v_automatic.evidence_id is null
      or v_automatic.rule_reasons <> '["EFFECTIVE_DATE_CONFLICT"]'::jsonb
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(v_automatic.rule_reasons) as reason(value)
        where reason.value not in ('EFFECTIVE_DATE_CONFLICT')
      )
    then
      raise exception 'ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT';
    end if;

    select identity.* into v_identity
    from public.sec_ticker_security_identities as identity
    where identity.id = v_automatic.security_identity_id
      and identity.issuer_cik = v_automatic.issuer_cik;
    select evidence.* into v_evidence
    from public.sec_ticker_change_evidence as evidence
    where evidence.id = v_automatic.evidence_id
      and evidence.security_identity_id = v_automatic.security_identity_id
      and evidence.issuer_cik = v_automatic.issuer_cik
      and evidence.source_result_id = v_automatic.source_result_id;

    if v_identity.id is null or v_evidence.id is null
      or v_identity.security_type <> 'common_stock'
      or v_automatic.decision_payload #>> '{relationship,identityId}' is distinct from v_identity.id::text
      or v_automatic.decision_payload #>> '{relationship,evidenceId}' is distinct from v_evidence.id::text
      or v_automatic.decision_payload #>> '{relationship,oldTicker}' is distinct from v_evidence.old_ticker
      or v_automatic.decision_payload #>> '{relationship,newTicker}' is distinct from v_evidence.new_ticker
      or v_automatic.decision_payload #>> '{relationship,effectiveDate}' is distinct from v_evidence.effective_date::text
      or v_automatic.decision_payload #>> '{relationship,effectivePrecision}' is distinct from v_evidence.effective_precision
      or v_automatic.decision_payload #>> '{relationship,continuityBasis}' is distinct from v_evidence.continuity_basis
    then
      raise exception 'ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT';
    end if;
  else
    if v_automatic.security_identity_id is not null then
      select identity.* into v_identity
      from public.sec_ticker_security_identities as identity
      where identity.id = v_automatic.security_identity_id;
    end if;
    if v_automatic.evidence_id is not null then
      select evidence.* into v_evidence
      from public.sec_ticker_change_evidence as evidence
      where evidence.id = v_automatic.evidence_id;
    end if;
  end if;

  if v_action = 'withdrawn' then
    if v_previous.resulting_effective_action not in ('approved', 'rejected')
      or v_previous.resulting_effective_human_decision_id is null
    then
      raise exception 'ADMIN_TICKER_WITHDRAWAL_UNAVAILABLE';
    end if;
    v_withdraws_decision_id := v_previous.resulting_effective_human_decision_id;
    v_resulting_action := null;
    v_resulting_decision_id := null;
  elsif v_action in ('approved', 'rejected') then
    v_resulting_action := v_action;
    v_resulting_decision_id := v_id;
  else
    v_resulting_action := v_previous.resulting_effective_action;
    v_resulting_decision_id := v_previous.resulting_effective_human_decision_id;
  end if;

  v_snapshot := pg_catalog.jsonb_build_object(
    'id', v_automatic.id,
    'decisionSha256', v_automatic.decision_sha256,
    'resolutionState', v_automatic.resolution_state,
    'method', v_automatic.method,
    'methodVersion', v_automatic.method_version,
    'ruleReasons', v_automatic.rule_reasons,
    'decisionPayload', v_automatic.decision_payload,
    'createdAt', v_automatic.created_at
  );
  v_evidence_references := pg_catalog.jsonb_build_object(
    'sourceResultId', v_automatic.source_result_id,
    'sourceSha256', v_automatic.decision_payload #>> '{input,sourceSha256}',
    'beforeResultId', v_automatic.decision_payload #>> '{input,beforeResultId}',
    'beforeObservationKey', v_automatic.decision_payload #>> '{input,beforeObservationKey}',
    'beforeSourceSha256', v_automatic.decision_payload #>> '{input,beforeSourceSha256}',
    'afterResultId', v_automatic.decision_payload #>> '{input,afterResultId}',
    'afterObservationKey', v_automatic.decision_payload #>> '{input,afterObservationKey}',
    'afterSourceSha256', v_automatic.decision_payload #>> '{input,afterSourceSha256}',
    'identityId', v_identity.id,
    'identitySha256', v_identity.identity_sha256,
    'evidenceId', v_evidence.id,
    'evidenceSha256', v_evidence.evidence_sha256,
    'sourceTextSpanSha256', v_evidence.source_text_span_sha256,
    'relationship', v_automatic.decision_payload -> 'relationship'
  );

  insert into public.admin_audit_logs (
    id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data,
    request_id
  ) values (
    v_audit_id,
    p_actor_user_id,
    v_actor_role,
    'ticker_resolution.human_' || v_action,
    'sec_ticker_resolution',
    v_automatic.id::text,
    v_reason,
    case when v_previous.id is null then null else pg_catalog.to_jsonb(v_previous) end,
    pg_catalog.jsonb_build_object(
      'humanDecisionId', v_id,
      'automaticDecisionId', v_automatic.id,
      'automaticDecisionSha256', v_automatic.decision_sha256,
      'scopeKey', v_scope_key,
      'revision', v_revision,
      'action', v_action,
      'resultingEffectiveAction', v_resulting_action,
      'withdrawsHumanDecisionId', v_withdraws_decision_id,
      'evidenceReferences', v_evidence_references
    ),
    v_request_id
  );

  insert into public.sec_ticker_resolution_human_decisions (
    id,
    automatic_decision_id,
    automatic_decision_sha256,
    scope_key,
    scope_payload,
    revision,
    action,
    actor_user_id,
    actor_role,
    reason,
    automatic_snapshot,
    evidence_references,
    previous_human_decision_id,
    withdraws_human_decision_id,
    resulting_effective_action,
    resulting_effective_human_decision_id,
    request_id,
    request_payload_sha256,
    audit_log_id
  ) values (
    v_id,
    v_automatic.id,
    v_automatic.decision_sha256,
    v_scope_key,
    v_scope_payload,
    v_revision,
    v_action,
    p_actor_user_id,
    v_actor_role,
    v_reason,
    v_snapshot,
    v_evidence_references,
    v_previous.id,
    v_withdraws_decision_id,
    v_resulting_action,
    v_resulting_decision_id,
    v_request_id,
    v_request_payload_sha256,
    v_audit_id
  );

  v_response := pg_catalog.jsonb_build_object(
    'status', 'inserted',
    'humanDecisionId', v_id,
    'automaticDecisionId', v_automatic.id,
    'revision', v_revision,
    'action', v_action,
    'resultingEffectiveAction', v_resulting_action,
    'scopeKey', v_scope_key,
    'auditLogId', v_audit_id
  );
  return v_response;
end
$function$;

revoke all on function private.sec_ticker_resolution_human_scope_payload(
  public.sec_ticker_resolution_decisions
) from public, anon, authenticated, service_role;
revoke all on function private.sec_ticker_resolution_human_scope_key(
  public.sec_ticker_resolution_decisions
) from public, anon, authenticated, service_role;
revoke all on function private.reject_sec_ticker_resolution_human_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_sec_ticker_resolution_source_current(
  public.sec_ticker_resolution_decisions
) from public, anon, authenticated, service_role;
revoke all on function public.admin_apply_sec_ticker_resolution_human_decision(
  uuid, uuid, text, integer, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function private.sec_ticker_resolution_human_scope_payload(
  public.sec_ticker_resolution_decisions
) to service_role;
grant execute on function private.sec_ticker_resolution_human_scope_key(
  public.sec_ticker_resolution_decisions
) to service_role;
grant execute on function private.reject_sec_ticker_resolution_human_mutation()
  to service_role;
grant execute on function private.assert_sec_ticker_resolution_source_current(
  public.sec_ticker_resolution_decisions
) to service_role;
grant execute on function public.admin_apply_sec_ticker_resolution_human_decision(
  uuid, uuid, text, integer, text, text, text
) to service_role;

comment on table public.sec_ticker_resolution_human_decisions is
  'Append-only administrator review events bound to exact automatic SEC ticker decisions and evidence. Reviewed is non-decisive; withdrawal preserves history.';

commit;
