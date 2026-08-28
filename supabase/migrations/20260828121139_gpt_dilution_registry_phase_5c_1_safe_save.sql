-- GPT dilution registry Phase 5C-1 safe-save contract.
--
-- A successful paste marker is stored on the first available append-only row,
-- preferring snapshots, then activity, then totals. PostgreSQL executes the
-- function call in one transaction, so a marker cannot survive partial Apply.

alter table public.dilution_instrument_snapshots
  add column paste_id text;

alter table public.dilution_instrument_snapshots
  add constraint dilution_instrument_snapshots_paste_id_format_check
    check (
      paste_id is null
      or paste_id ~ '^dilution-registry:v1:[0-9a-f]{64}$'
    ),
  add constraint dilution_instrument_snapshots_paste_id_key
    unique (paste_id);

alter table public.dilution_instrument_activity
  add column paste_id text;

alter table public.dilution_instrument_activity
  add constraint dilution_instrument_activity_paste_id_format_check
    check (
      paste_id is null
      or paste_id ~ '^dilution-registry:v1:[0-9a-f]{64}$'
    ),
  add constraint dilution_instrument_activity_paste_id_key
    unique (paste_id);

alter table public.dilution_totals
  add column paste_id text;

alter table public.dilution_totals
  add constraint dilution_totals_paste_id_format_check
    check (
      paste_id is null
      or paste_id ~ '^dilution-registry:v1:[0-9a-f]{64}$'
    ),
  add constraint dilution_totals_paste_id_key
    unique (paste_id);

comment on column public.dilution_instrument_snapshots.paste_id is
  'Server-derived SHA-256 identity of the exact UTF-8 Preview source. Used when a successful paste contains snapshots.';

comment on column public.dilution_instrument_activity.paste_id is
  'Server-derived SHA-256 identity of the exact UTF-8 Preview source. Used when a successful paste has activity but no snapshots.';

comment on column public.dilution_totals.paste_id is
  'Server-derived SHA-256 identity of the exact UTF-8 Preview source. Used when a successful paste has totals but no snapshots or activity.';

create or replace function public.apply_dilution_registry_v1(
  p_payload jsonb,
  p_paste_id text,
  p_source text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_issuer_cik text;
  v_instruments_added integer := 0;
  v_snapshots_added integer := 0;
  v_activities_added integer := 0;
  v_totals_added integer := 0;
  v_expected_paste_id text;
begin
  if p_paste_id is null
    or p_paste_id !~ '^dilution-registry:v1:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'dilution registry paste_id is invalid';
  end if;

  if p_source is null then
    raise exception using
      errcode = '22023',
      message = 'dilution registry Preview source is required';
  end if;

  v_expected_paste_id := 'dilution-registry:v1:' ||
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_source, 'UTF8'), 'sha256'),
      'hex'
    );

  if p_paste_id is distinct from v_expected_paste_id then
    raise exception using
      errcode = '22023',
      message = 'dilution registry paste_id does not match the exact Preview source';
  end if;

  begin
    if p_payload is distinct from p_source::jsonb then
      raise exception using
        errcode = '22023',
        message = 'dilution registry payload does not match the exact Preview source';
    end if;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'dilution registry Preview source is not valid JSON';
  end;

  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or (
      p_payload ? 'issuer'
      and p_payload->'issuer' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_payload->'issuer') <> 'object'
    )
    or pg_catalog.jsonb_typeof(p_payload->'instruments') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'snapshots') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'activities') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'totals') <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'dilution registry payload shape is invalid';
  end if;

  if exists (
    select 1
    from (
      select item from pg_catalog.jsonb_array_elements(p_payload->'instruments') as rows(item)
      union all
      select item from pg_catalog.jsonb_array_elements(p_payload->'snapshots') as rows(item)
      union all
      select item from pg_catalog.jsonb_array_elements(p_payload->'activities') as rows(item)
      union all
      select item from pg_catalog.jsonb_array_elements(p_payload->'totals') as rows(item)
    ) as payload_rows
    where pg_catalog.jsonb_typeof(payload_rows.item) <> 'object'
  ) then
    raise exception using
      errcode = '22023',
      message = 'dilution registry array items must be objects';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dilution-registry-paste|' || p_paste_id, 0)
  );

  if exists (
    select 1
    from (
      select snapshot.paste_id
      from public.dilution_instrument_snapshots as snapshot
      where snapshot.paste_id = p_paste_id
      union all
      select activity.paste_id
      from public.dilution_instrument_activity as activity
      where activity.paste_id = p_paste_id
      union all
      select total.paste_id
      from public.dilution_totals as total
      where total.paste_id = p_paste_id
    ) as successful_paste
  ) then
    return pg_catalog.jsonb_build_object(
      'already_saved', true,
      'paste_id', p_paste_id,
      'added', pg_catalog.jsonb_build_object(
        'instruments', 0,
        'snapshots', 0,
        'activities', 0,
        'totals', 0
      )
    );
  end if;

  if pg_catalog.jsonb_array_length(p_payload->'instruments') = 0
    and pg_catalog.jsonb_array_length(p_payload->'snapshots') = 0
    and pg_catalog.jsonb_array_length(p_payload->'activities') = 0
    and pg_catalog.jsonb_array_length(p_payload->'totals') = 0
  then
    return pg_catalog.jsonb_build_object(
      'already_saved', true,
      'paste_id', p_paste_id,
      'added', pg_catalog.jsonb_build_object(
        'instruments', 0,
        'snapshots', 0,
        'activities', 0,
        'totals', 0
      )
    );
  end if;

  v_issuer_cik := p_payload#>>'{issuer,issuer_cik}';
  if v_issuer_cik is null
    or v_issuer_cik !~ '^[0-9]{10}$'
    or v_issuer_cik = '0000000000'
  then
    raise exception using
      errcode = '22023',
      message = 'dilution registry issuer_cik is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
    where pg_catalog.btrim(coalesce(instrument.item->>'instrument_key', '')) = ''
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
  ) <> (
    select pg_catalog.count(distinct instrument.item->>'instrument_key')
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
  ) then
    raise exception using
      errcode = '22023',
      message = 'dilution registry instrument_key values must be present and unique';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
    where instrument.item ? 'holders'
      and instrument.item->'holders' <> 'null'::jsonb
      and (
        pg_catalog.jsonb_typeof(instrument.item->'holders') <> 'array'
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(instrument.item->'holders') as holder(value)
          where pg_catalog.jsonb_typeof(holder.value) <> 'string'
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'dilution registry holders must be an array of strings';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as input_instrument(item)
    join public.dilution_instruments as stored
      on stored.instrument_key = input_instrument.item->>'instrument_key'
    where stored.issuer_cik is distinct from v_issuer_cik
      or stored.instrument_type is distinct from input_instrument.item->>'instrument_type'
  ) then
    raise exception using
      errcode = '23514',
      message = 'dilution registry instrument identity does not match the stored issuer or type';
  end if;

  insert into public.dilution_instruments (
    instrument_key,
    issuer_cik,
    instrument_type,
    name,
    series_or_tranche,
    holders,
    first_source_accession
  )
  select
    instrument.item->>'instrument_key',
    v_issuer_cik,
    instrument.item->>'instrument_type',
    instrument.item->>'name',
    instrument.item->>'series_or_tranche',
    case
      when pg_catalog.jsonb_typeof(instrument.item->'holders') = 'array' then
        array(
          select pg_catalog.jsonb_array_elements_text(instrument.item->'holders')
        )
      else null
    end,
    instrument.item->>'first_source_accession'
  from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
  order by instrument.item->>'instrument_key'
  on conflict (instrument_key) do nothing;
  get diagnostics v_instruments_added = row_count;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'instruments') as input_instrument(item)
    left join public.dilution_instruments as stored
      on stored.instrument_key = input_instrument.item->>'instrument_key'
    where stored.id is null
      or stored.issuer_cik is distinct from v_issuer_cik
      or stored.instrument_type is distinct from input_instrument.item->>'instrument_type'
  ) then
    raise exception using
      errcode = '23514',
      message = 'dilution registry instrument identity changed during apply';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'snapshots') as snapshot(item)
    where pg_catalog.btrim(coalesce(snapshot.item->>'instrument_key', '')) = ''
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
        where instrument.item->>'instrument_key' = snapshot.item->>'instrument_key'
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'dilution registry snapshot references a missing instrument_key';
  end if;

  insert into public.dilution_instrument_snapshots (
    instrument_id,
    as_of_date,
    status,
    closed_reason,
    can_convert_or_exercise,
    restriction,
    currency,
    original_amount,
    remaining_amount,
    converted_amount,
    repaid_amount,
    interest_rate,
    interest_converted,
    original_units,
    remaining_units,
    converted_units,
    exercised_units,
    cancelled_units,
    expired_units,
    stated_value,
    original_capacity,
    used_amount,
    remaining_capacity,
    shares_issued,
    shares_sold,
    gross_proceeds,
    remaining_potential_shares,
    price_type,
    conversion_price,
    exercise_price,
    floor_price,
    price_formula,
    available_date,
    start_date,
    end_date,
    end_date_type,
    term_months,
    resale_status,
    registered_resale_shares,
    share_basis_date,
    source_accession,
    source_note,
    review_note,
    last_checked,
    paste_id
  )
  select
    instrument.id,
    (snapshot.item->>'as_of_date')::date,
    snapshot.item->>'status',
    snapshot.item->>'closed_reason',
    (snapshot.item->>'can_convert_or_exercise')::boolean,
    snapshot.item->>'restriction',
    snapshot.item->>'currency',
    (snapshot.item->>'original_amount')::numeric,
    (snapshot.item->>'remaining_amount')::numeric,
    (snapshot.item->>'converted_amount')::numeric,
    (snapshot.item->>'repaid_amount')::numeric,
    (snapshot.item->>'interest_rate')::numeric,
    (snapshot.item->>'interest_converted')::numeric,
    (snapshot.item->>'original_units')::numeric,
    (snapshot.item->>'remaining_units')::numeric,
    (snapshot.item->>'converted_units')::numeric,
    (snapshot.item->>'exercised_units')::numeric,
    (snapshot.item->>'cancelled_units')::numeric,
    (snapshot.item->>'expired_units')::numeric,
    (snapshot.item->>'stated_value')::numeric,
    (snapshot.item->>'original_capacity')::numeric,
    (snapshot.item->>'used_amount')::numeric,
    (snapshot.item->>'remaining_capacity')::numeric,
    (snapshot.item->>'shares_issued')::numeric,
    (snapshot.item->>'shares_sold')::numeric,
    (snapshot.item->>'gross_proceeds')::numeric,
    (snapshot.item->>'remaining_potential_shares')::numeric,
    snapshot.item->>'price_type',
    (snapshot.item->>'conversion_price')::numeric,
    (snapshot.item->>'exercise_price')::numeric,
    (snapshot.item->>'floor_price')::numeric,
    snapshot.item->>'price_formula',
    (snapshot.item->>'available_date')::date,
    (snapshot.item->>'start_date')::date,
    (snapshot.item->>'end_date')::date,
    snapshot.item->>'end_date_type',
    (snapshot.item->>'term_months')::numeric,
    snapshot.item->>'resale_status',
    (snapshot.item->>'registered_resale_shares')::numeric,
    (snapshot.item->>'share_basis_date')::date,
    snapshot.item->>'source_accession',
    snapshot.item->>'source_note',
    snapshot.item->>'review_note',
    (snapshot.item->>'last_checked')::date,
    case when snapshot.ordinality = 1 then p_paste_id else null end
  from pg_catalog.jsonb_array_elements(p_payload->'snapshots')
    with ordinality as snapshot(item, ordinality)
  join public.dilution_instruments as instrument
    on instrument.instrument_key = snapshot.item->>'instrument_key';
  get diagnostics v_snapshots_added = row_count;

  if v_snapshots_added <> pg_catalog.jsonb_array_length(p_payload->'snapshots') then
    raise exception using
      errcode = '23514',
      message = 'dilution registry snapshot insert count did not match the payload';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'activities') as activity(item)
    where (
      activity.item ? 'instrument_key'
      and activity.item->'instrument_key' <> 'null'::jsonb
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
        where instrument.item->>'instrument_key' = activity.item->>'instrument_key'
      )
    ) or (
      activity.item ? 'related_instrument_keys'
      and activity.item->'related_instrument_keys' <> 'null'::jsonb
      and (
        pg_catalog.jsonb_typeof(activity.item->'related_instrument_keys') <> 'array'
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(activity.item->'related_instrument_keys') as related(value)
          where pg_catalog.jsonb_typeof(related.value) <> 'string'
            or not exists (
              select 1
              from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
              where instrument.item->>'instrument_key' = related.value#>>'{}'
            )
        )
      )
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'dilution registry activity references a missing instrument_key';
  end if;

  insert into public.dilution_instrument_activity (
    issuer_cik,
    instrument_id,
    related_instrument_keys,
    activity_type,
    activity_date,
    period_start,
    period_end,
    currency,
    units_issued,
    amount_converted,
    amount_repaid,
    interest_converted,
    units_converted,
    units_exercised,
    units_cancelled,
    units_expired,
    used_amount,
    shares_issued,
    shares_sold,
    gross_proceeds,
    details,
    source_accession,
    source_note,
    last_checked,
    paste_id
  )
  select
    v_issuer_cik,
    instrument.id,
    case
      when pg_catalog.jsonb_typeof(activity.item->'related_instrument_keys') = 'array' then
        array(
          select pg_catalog.jsonb_array_elements_text(activity.item->'related_instrument_keys')
        )
      else null
    end,
    activity.item->>'activity_type',
    (activity.item->>'activity_date')::date,
    (activity.item->>'period_start')::date,
    (activity.item->>'period_end')::date,
    activity.item->>'currency',
    (activity.item->>'units_issued')::numeric,
    (activity.item->>'amount_converted')::numeric,
    (activity.item->>'amount_repaid')::numeric,
    (activity.item->>'interest_converted')::numeric,
    (activity.item->>'units_converted')::numeric,
    (activity.item->>'units_exercised')::numeric,
    (activity.item->>'units_cancelled')::numeric,
    (activity.item->>'units_expired')::numeric,
    (activity.item->>'used_amount')::numeric,
    (activity.item->>'shares_issued')::numeric,
    (activity.item->>'shares_sold')::numeric,
    (activity.item->>'gross_proceeds')::numeric,
    activity.item->>'details',
    activity.item->>'source_accession',
    activity.item->>'source_note',
    (activity.item->>'last_checked')::date,
    case
      when pg_catalog.jsonb_array_length(p_payload->'snapshots') = 0
        and activity.ordinality = 1
      then p_paste_id
      else null
    end
  from pg_catalog.jsonb_array_elements(p_payload->'activities')
    with ordinality as activity(item, ordinality)
  left join public.dilution_instruments as instrument
    on instrument.instrument_key = activity.item->>'instrument_key';
  get diagnostics v_activities_added = row_count;

  if v_activities_added <> pg_catalog.jsonb_array_length(p_payload->'activities') then
    raise exception using
      errcode = '23514',
      message = 'dilution registry activity insert count did not match the payload';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload->'totals') as total(item)
    where total.item->>'issuer_cik' is distinct from v_issuer_cik
      or (
        total.item ? 'included_instrument_keys'
        and total.item->'included_instrument_keys' <> 'null'::jsonb
        and (
          pg_catalog.jsonb_typeof(total.item->'included_instrument_keys') <> 'array'
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(total.item->'included_instrument_keys') as included(value)
            where pg_catalog.jsonb_typeof(included.value) <> 'string'
              or not exists (
                select 1
                from pg_catalog.jsonb_array_elements(p_payload->'instruments') as instrument(item)
                where instrument.item->>'instrument_key' = included.value#>>'{}'
              )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'dilution registry total issuer or included instrument_key is invalid';
  end if;

  insert into public.dilution_totals (
    issuer_cik,
    instrument_type,
    name,
    total_shares,
    other_shares,
    total_amount,
    other_amount,
    currency,
    as_of_date,
    status,
    included_instrument_keys,
    source_accession,
    source_note,
    review_note,
    last_checked,
    paste_id
  )
  select
    total.item->>'issuer_cik',
    total.item->>'instrument_type',
    total.item->>'name',
    (total.item->>'total_shares')::numeric,
    (total.item->>'other_shares')::numeric,
    (total.item->>'total_amount')::numeric,
    (total.item->>'other_amount')::numeric,
    total.item->>'currency',
    (total.item->>'as_of_date')::date,
    total.item->>'status',
    case
      when pg_catalog.jsonb_typeof(total.item->'included_instrument_keys') = 'array' then
        array(
          select pg_catalog.jsonb_array_elements_text(total.item->'included_instrument_keys')
        )
      else null
    end,
    total.item->>'source_accession',
    total.item->>'source_note',
    total.item->>'review_note',
    (total.item->>'last_checked')::date,
    case
      when pg_catalog.jsonb_array_length(p_payload->'snapshots') = 0
        and pg_catalog.jsonb_array_length(p_payload->'activities') = 0
        and total.ordinality = 1
      then p_paste_id
      else null
    end
  from pg_catalog.jsonb_array_elements(p_payload->'totals')
    with ordinality as total(item, ordinality);
  get diagnostics v_totals_added = row_count;

  if v_totals_added <> pg_catalog.jsonb_array_length(p_payload->'totals') then
    raise exception using
      errcode = '23514',
      message = 'dilution registry total insert count did not match the payload';
  end if;

  return pg_catalog.jsonb_build_object(
    'already_saved', (
      v_instruments_added = 0
      and v_snapshots_added = 0
      and v_activities_added = 0
      and v_totals_added = 0
    ),
    'paste_id', p_paste_id,
    'added', pg_catalog.jsonb_build_object(
      'instruments', v_instruments_added,
      'snapshots', v_snapshots_added,
      'activities', v_activities_added,
      'totals', v_totals_added
    )
  );
end
$function$;

comment on function public.apply_dilution_registry_v1(jsonb, text, text) is
  'Verifies a server-derived exact-source paste identity, atomically reuses or creates instrument identities, appends snapshots/activity/totals, and writes one marker on the first available append-only row. Payloads with no append-only rows are honest idempotent no-ops after instrument reuse.';

revoke all on function public.apply_dilution_registry_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.apply_dilution_registry_v1(jsonb, text, text)
  to service_role;
