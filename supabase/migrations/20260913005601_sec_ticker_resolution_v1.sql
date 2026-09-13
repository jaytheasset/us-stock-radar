create table public.sec_ticker_security_identities (
  id uuid primary key,
  issuer_cik text not null references public.sec_issuers(cik) on delete restrict,
  security_type text not null,
  security_class text,
  before_result_id uuid not null,
  before_observation_key text not null,
  after_result_id uuid not null,
  after_observation_key text not null,
  before_security_title text not null,
  after_security_title text not null,
  identity_method text not null,
  identity_version text not null,
  identity_payload jsonb not null,
  identity_sha256 text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_ticker_security_identities_hash_unique unique (identity_sha256),
  constraint sec_ticker_security_identities_id_issuer_unique unique (id, issuer_cik),
  constraint sec_ticker_security_identities_before_result_fk
    foreign key (before_result_id, issuer_cik)
    references public.sec_cover_observation_results(id, issuer_cik) on delete restrict,
  constraint sec_ticker_security_identities_after_result_fk
    foreign key (after_result_id, issuer_cik)
    references public.sec_cover_observation_results(id, issuer_cik) on delete restrict,
  constraint sec_ticker_security_identities_before_observation_fk
    foreign key (before_result_id, before_observation_key)
    references public.sec_cover_security_observations(result_id, observation_key) on delete restrict,
  constraint sec_ticker_security_identities_after_observation_fk
    foreign key (after_result_id, after_observation_key)
    references public.sec_cover_security_observations(result_id, observation_key) on delete restrict,
  constraint sec_ticker_security_identities_type_check
    check (security_type in ('common_stock', 'ordinary_shares', 'adr')),
  constraint sec_ticker_security_identities_class_check
    check (security_class is null or (pg_catalog.btrim(security_class) <> '' and pg_catalog.char_length(security_class) <= 80)),
  constraint sec_ticker_security_identities_title_check
    check (pg_catalog.btrim(before_security_title) <> '' and pg_catalog.btrim(after_security_title) <> ''),
  constraint sec_ticker_security_identities_method_check
    check (identity_method = 'sec-cover-security-continuity' and identity_version = 'sec-ticker-security-identity-v1'),
  constraint sec_ticker_security_identities_hash_check
    check (identity_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sec_ticker_security_identities_payload_check
    check (pg_catalog.jsonb_typeof(identity_payload) = 'object')
);

create table public.sec_ticker_change_evidence (
  id uuid primary key,
  security_identity_id uuid not null references public.sec_ticker_security_identities(id) on delete restrict,
  issuer_cik text not null references public.sec_issuers(cik) on delete restrict,
  source_result_id uuid not null,
  source_raw_id uuid not null,
  source_kind text not null default 'filing_xbrl',
  source_accession_number text not null,
  source_url text not null,
  source_document text not null,
  source_sha256 text not null,
  source_text_method text not null,
  source_text_version text not null,
  source_text_span_start integer not null,
  source_text_span_end integer not null,
  source_text_span text not null,
  source_text_span_sha256 text not null,
  old_ticker text not null,
  new_ticker text not null,
  effective_date date not null,
  effective_at timestamptz,
  effective_precision text not null,
  effective_text text not null,
  continuity_basis text not null,
  extraction_method text not null,
  extraction_version text not null,
  evidence_payload jsonb not null,
  evidence_sha256 text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_ticker_change_evidence_hash_unique unique (evidence_sha256),
  constraint sec_ticker_change_evidence_identity_issuer_unique unique (id, issuer_cik),
  constraint sec_ticker_change_evidence_identity_issuer_fk
    foreign key (security_identity_id, issuer_cik)
    references public.sec_ticker_security_identities(id, issuer_cik) on delete restrict,
  constraint sec_ticker_change_evidence_source_result_fk
    foreign key (source_result_id, issuer_cik)
    references public.sec_cover_observation_results(id, issuer_cik) on delete restrict,
  constraint sec_ticker_change_evidence_source_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind) on delete restrict,
  constraint sec_ticker_change_evidence_source_kind_check check (source_kind = 'filing_xbrl'),
  constraint sec_ticker_change_evidence_accession_check check (source_accession_number ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint sec_ticker_change_evidence_source_check
    check (
      source_url ~ '^https://([a-z0-9-]+\.)*sec\.gov/Archives/edgar/data/'
      and pg_catalog.btrim(source_document) <> ''
      and source_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint sec_ticker_change_evidence_span_check
    check (
      source_text_method = 'sec-visible-text-exact-span'
      and source_text_version = 'sec-visible-text-v1'
      and source_text_span_start >= 0
      and source_text_span_end > source_text_span_start
      and source_text_span_end - source_text_span_start = pg_catalog.char_length(source_text_span)
      and pg_catalog.btrim(source_text_span) <> ''
      and source_text_span_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint sec_ticker_change_evidence_ticker_check
    check (
      old_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'
      and new_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'
      and old_ticker <> new_ticker
    ),
  constraint sec_ticker_change_evidence_effective_check
    check (
      effective_precision in ('date', 'market_open', 'exact_timestamp')
      and pg_catalog.btrim(effective_text) <> ''
      and ((effective_precision = 'exact_timestamp') = (effective_at is not null))
    ),
  constraint sec_ticker_change_evidence_continuity_check
    check (continuity_basis in ('unchanged_terms', 'unchanged_cusip_and_rights')),
  constraint sec_ticker_change_evidence_method_check
    check (extraction_method = 'sec-primary-document-ticker-change' and extraction_version = 'sec-ticker-change-evidence-v1'),
  constraint sec_ticker_change_evidence_payload_check
    check (pg_catalog.jsonb_typeof(evidence_payload) = 'object' and evidence_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.sec_ticker_resolution_decisions (
  id uuid primary key,
  issuer_cik text not null references public.sec_issuers(cik) on delete restrict,
  evidence_accession_number text not null,
  before_accession_number text not null,
  after_accession_number text not null,
  source_result_id uuid not null,
  security_identity_id uuid,
  evidence_id uuid,
  resolution_type text not null,
  resolution_state text not null,
  method text not null,
  method_version text not null,
  rule_reasons jsonb not null,
  decision_payload jsonb not null,
  decision_sha256 text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_ticker_resolution_decisions_replay_unique
    unique (issuer_cik, evidence_accession_number, before_accession_number, after_accession_number, method_version, decision_sha256),
  constraint sec_ticker_resolution_decisions_identity_issuer_fk
    foreign key (security_identity_id, issuer_cik)
    references public.sec_ticker_security_identities(id, issuer_cik) on delete restrict,
  constraint sec_ticker_resolution_decisions_evidence_issuer_fk
    foreign key (evidence_id, issuer_cik)
    references public.sec_ticker_change_evidence(id, issuer_cik) on delete restrict,
  constraint sec_ticker_resolution_decisions_source_result_fk
    foreign key (source_result_id, issuer_cik)
    references public.sec_cover_observation_results(id, issuer_cik) on delete restrict,
  constraint sec_ticker_resolution_decisions_accession_check
    check (
      evidence_accession_number ~ '^\d{10}-\d{2}-\d{6}$'
      and before_accession_number ~ '^\d{10}-\d{2}-\d{6}$'
      and after_accession_number ~ '^\d{10}-\d{2}-\d{6}$'
    ),
  constraint sec_ticker_resolution_decisions_type_check
    check (resolution_type = 'same_security_ticker_change'),
  constraint sec_ticker_resolution_decisions_state_check
    check (resolution_state in ('AUTO', 'REVIEW', 'UNRESOLVED')),
  constraint sec_ticker_resolution_decisions_auto_check
    check (resolution_state <> 'AUTO' or (security_identity_id is not null and evidence_id is not null)),
  constraint sec_ticker_resolution_decisions_method_check
    check (method = 'deterministic-sec-ticker-resolution' and method_version = 'sec-ticker-resolution-v1'),
  constraint sec_ticker_resolution_decisions_payload_check
    check (
      pg_catalog.jsonb_typeof(rule_reasons) = 'array'
      and pg_catalog.jsonb_array_length(rule_reasons) > 0
      and pg_catalog.jsonb_typeof(decision_payload) = 'object'
      and decision_sha256 ~ '^[0-9a-f]{64}$'
    )
);

create index sec_ticker_resolution_decisions_current_idx
  on public.sec_ticker_resolution_decisions (
    issuer_cik, evidence_accession_number, before_accession_number, after_accession_number,
    created_at desc, id desc
  );
create index sec_ticker_change_evidence_tickers_idx
  on public.sec_ticker_change_evidence (issuer_cik, old_ticker, new_ticker, effective_date);

alter table public.sec_ticker_security_identities enable row level security;
alter table public.sec_ticker_change_evidence enable row level security;
alter table public.sec_ticker_resolution_decisions enable row level security;

revoke all on table public.sec_ticker_security_identities from public, anon, authenticated, service_role;
revoke all on table public.sec_ticker_change_evidence from public, anon, authenticated, service_role;
revoke all on table public.sec_ticker_resolution_decisions from public, anon, authenticated, service_role;
grant select, insert on table public.sec_ticker_security_identities to service_role;
grant select, insert on table public.sec_ticker_change_evidence to service_role;
grant select, insert on table public.sec_ticker_resolution_decisions to service_role;

create or replace function public.reject_sec_ticker_resolution_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'SEC ticker resolution rows are append-only';
end;
$$;

create trigger sec_ticker_security_identities_append_only
before update or delete on public.sec_ticker_security_identities
for each row execute function public.reject_sec_ticker_resolution_mutation();

create trigger sec_ticker_change_evidence_append_only
before update or delete on public.sec_ticker_change_evidence
for each row execute function public.reject_sec_ticker_resolution_mutation();

create trigger sec_ticker_resolution_decisions_append_only
before update or delete on public.sec_ticker_resolution_decisions
for each row execute function public.reject_sec_ticker_resolution_mutation();

create or replace function public.persist_sec_ticker_resolution(
  p_identity jsonb,
  p_evidence jsonb,
  p_decision jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity_id uuid;
  v_evidence_id uuid;
  v_decision_id uuid;
  v_source_result public.sec_cover_observation_results%rowtype;
  v_source_raw public.sec_structured_raw_sources%rowtype;
  v_inserted boolean := false;
begin
  if coalesce(pg_catalog.jsonb_typeof(p_decision), '') <> 'object'
     or (p_identity is not null and coalesce(pg_catalog.jsonb_typeof(p_identity), '') <> 'object')
     or (p_evidence is not null and coalesce(pg_catalog.jsonb_typeof(p_evidence), '') <> 'object') then
    raise exception using errcode = '22023', message = 'SEC ticker resolution payloads must be objects or null';
  end if;

  select * into v_source_result
  from public.sec_cover_observation_results
  where id = (p_decision ->> 'source_result_id')::uuid;
  if not found
     or v_source_result.issuer_cik is distinct from p_decision ->> 'issuer_cik'
     or v_source_result.accession_number is distinct from p_decision ->> 'evidence_accession_number' then
    raise exception using errcode = '22023', message = 'SEC ticker resolution source result identity mismatch';
  end if;

  insert into public.sec_issuers (cik)
  values (v_source_result.issuer_cik)
  on conflict (cik) do nothing;

  if p_identity is not null then
    if p_identity ->> 'issuer_cik' is distinct from p_decision ->> 'issuer_cik' then
      raise exception using errcode = '22023', message = 'SEC ticker security identity issuer mismatch';
    end if;
    insert into public.sec_ticker_security_identities (
      id, issuer_cik, security_type, security_class,
      before_result_id, before_observation_key, after_result_id, after_observation_key,
      before_security_title, after_security_title, identity_method, identity_version,
      identity_payload, identity_sha256
    ) values (
      (p_identity ->> 'id')::uuid, p_identity ->> 'issuer_cik', p_identity ->> 'security_type',
      nullif(p_identity ->> 'security_class', ''), (p_identity ->> 'before_result_id')::uuid,
      p_identity ->> 'before_observation_key', (p_identity ->> 'after_result_id')::uuid,
      p_identity ->> 'after_observation_key', p_identity ->> 'before_security_title',
      p_identity ->> 'after_security_title', p_identity ->> 'identity_method',
      p_identity ->> 'identity_version', p_identity -> 'identity_payload', p_identity ->> 'identity_sha256'
    ) on conflict (identity_sha256) do nothing;
    select id into v_identity_id from public.sec_ticker_security_identities
      where identity_sha256 = p_identity ->> 'identity_sha256';
    if v_identity_id is distinct from (p_identity ->> 'id')::uuid then
      raise exception using errcode = '22023', message = 'SEC ticker security identity replay mismatch';
    end if;
  end if;

  if p_evidence is not null then
    if v_identity_id is null
       or p_evidence ->> 'security_identity_id' is distinct from v_identity_id::text
       or p_evidence ->> 'issuer_cik' is distinct from p_decision ->> 'issuer_cik'
       or p_evidence ->> 'source_result_id' is distinct from v_source_result.id::text
       or p_evidence ->> 'source_accession_number' is distinct from v_source_result.accession_number
       or p_evidence ->> 'source_raw_id' is distinct from v_source_result.source_raw_id::text
       or p_evidence ->> 'source_url' is distinct from v_source_result.source_url
       or p_evidence ->> 'source_document' is distinct from v_source_result.source_document
       or p_evidence ->> 'source_sha256' is distinct from v_source_result.source_sha256 then
      raise exception using errcode = '22023', message = 'SEC ticker change evidence source mismatch';
    end if;
    select * into v_source_raw
    from public.sec_structured_raw_sources
    where id = (p_evidence ->> 'source_raw_id')::uuid;
    if not found
       or v_source_raw.cik is distinct from p_evidence ->> 'issuer_cik'
       or v_source_raw.source_kind is distinct from 'filing_xbrl'
       or v_source_raw.source_url is distinct from p_evidence ->> 'source_url'
       or v_source_raw.content_hash is distinct from p_evidence ->> 'source_sha256' then
      raise exception using errcode = '22023', message = 'SEC ticker change evidence raw source mismatch';
    end if;
    insert into public.sec_ticker_change_evidence (
      id, security_identity_id, issuer_cik, source_result_id, source_raw_id, source_kind,
      source_accession_number, source_url, source_document, source_sha256,
      source_text_method, source_text_version, source_text_span_start, source_text_span_end,
      source_text_span, source_text_span_sha256, old_ticker, new_ticker, effective_date,
      effective_at, effective_precision, effective_text, continuity_basis,
      extraction_method, extraction_version, evidence_payload, evidence_sha256
    ) values (
      (p_evidence ->> 'id')::uuid, v_identity_id, p_evidence ->> 'issuer_cik',
      (p_evidence ->> 'source_result_id')::uuid, (p_evidence ->> 'source_raw_id')::uuid,
      p_evidence ->> 'source_kind', p_evidence ->> 'source_accession_number',
      p_evidence ->> 'source_url', p_evidence ->> 'source_document', p_evidence ->> 'source_sha256',
      p_evidence ->> 'source_text_method', p_evidence ->> 'source_text_version',
      (p_evidence ->> 'source_text_span_start')::integer, (p_evidence ->> 'source_text_span_end')::integer,
      p_evidence ->> 'source_text_span', p_evidence ->> 'source_text_span_sha256',
      p_evidence ->> 'old_ticker', p_evidence ->> 'new_ticker', (p_evidence ->> 'effective_date')::date,
      nullif(p_evidence ->> 'effective_at', '')::timestamptz, p_evidence ->> 'effective_precision',
      p_evidence ->> 'effective_text', p_evidence ->> 'continuity_basis',
      p_evidence ->> 'extraction_method', p_evidence ->> 'extraction_version',
      p_evidence -> 'evidence_payload', p_evidence ->> 'evidence_sha256'
    ) on conflict (evidence_sha256) do nothing;
    select id into v_evidence_id from public.sec_ticker_change_evidence
      where evidence_sha256 = p_evidence ->> 'evidence_sha256';
    if v_evidence_id is distinct from (p_evidence ->> 'id')::uuid then
      raise exception using errcode = '22023', message = 'SEC ticker change evidence replay mismatch';
    end if;
  end if;

  if p_decision ->> 'resolution_state' = 'AUTO' and (v_identity_id is null or v_evidence_id is null) then
    raise exception using errcode = '22023', message = 'AUTO SEC ticker resolution requires verified identity and evidence';
  end if;
  if p_decision ->> 'security_identity_id' is distinct from v_identity_id::text
     or p_decision ->> 'evidence_id' is distinct from v_evidence_id::text then
    raise exception using errcode = '22023', message = 'SEC ticker resolution decision linkage mismatch';
  end if;

  insert into public.sec_ticker_resolution_decisions (
    id, issuer_cik, evidence_accession_number, before_accession_number, after_accession_number,
    source_result_id, security_identity_id, evidence_id, resolution_type, resolution_state,
    method, method_version, rule_reasons, decision_payload, decision_sha256
  ) values (
    (p_decision ->> 'id')::uuid, p_decision ->> 'issuer_cik',
    p_decision ->> 'evidence_accession_number', p_decision ->> 'before_accession_number',
    p_decision ->> 'after_accession_number', (p_decision ->> 'source_result_id')::uuid,
    v_identity_id, v_evidence_id, p_decision ->> 'resolution_type', p_decision ->> 'resolution_state',
    p_decision ->> 'method', p_decision ->> 'method_version', p_decision -> 'rule_reasons',
    p_decision -> 'decision_payload', p_decision ->> 'decision_sha256'
  ) on conflict (
    issuer_cik, evidence_accession_number, before_accession_number, after_accession_number,
    method_version, decision_sha256
  ) do nothing returning id into v_decision_id;
  if v_decision_id is not null then
    v_inserted := true;
  else
    select id into v_decision_id from public.sec_ticker_resolution_decisions
    where issuer_cik = p_decision ->> 'issuer_cik'
      and evidence_accession_number = p_decision ->> 'evidence_accession_number'
      and before_accession_number = p_decision ->> 'before_accession_number'
      and after_accession_number = p_decision ->> 'after_accession_number'
      and method_version = p_decision ->> 'method_version'
      and decision_sha256 = p_decision ->> 'decision_sha256';
  end if;
  if v_decision_id is distinct from (p_decision ->> 'id')::uuid then
    raise exception using errcode = '22023', message = 'SEC ticker resolution decision replay mismatch';
  end if;
  return pg_catalog.jsonb_build_object(
    'status', case when v_inserted then 'inserted' else 'replayed' end,
    'decision_id', v_decision_id,
    'resolution_state', p_decision ->> 'resolution_state',
    'identity_id', v_identity_id,
    'evidence_id', v_evidence_id
  );
end;
$$;

revoke all on function public.persist_sec_ticker_resolution(jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.persist_sec_ticker_resolution(jsonb, jsonb, jsonb) to service_role;

comment on table public.sec_ticker_security_identities is
  'Minimal immutable security continuity identities scoped to exact before/after SEC cover observations; not a symbol master.';
comment on table public.sec_ticker_change_evidence is
  'Immutable deterministic ticker-change evidence tied to a verified SEC raw body, exact visible-text span, and cover observations.';
comment on table public.sec_ticker_resolution_decisions is
  'Append-only AUTO, REVIEW, or UNRESOLVED decisions. Readers must revalidate current source and cover state.';
