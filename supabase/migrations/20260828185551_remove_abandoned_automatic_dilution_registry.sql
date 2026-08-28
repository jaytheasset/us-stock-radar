-- Remove only the abandoned automatic dilution Registry persistence objects.
-- Plain DROP statements intentionally reject unexpected dependencies.

begin;

lock table
  public.dilution_source_observations,
  public.dilution_economic_exposures
in access exclusive mode;

do $cleanup$
declare
  v_function regprocedure;
  v_observations regclass;
  v_exposures regclass;
  v_observation_rows bigint;
  v_exposure_rows bigint;
begin
  v_function := pg_catalog.to_regprocedure(
    'public.persist_dilution_source_observation(text,jsonb,text,jsonb,jsonb,jsonb)'
  );
  if v_function is null then
    raise exception using
      errcode = '42883',
      message = 'Expected abandoned function public.persist_dilution_source_observation(text,jsonb,text,jsonb,jsonb,jsonb) was not found';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    join pg_catalog.pg_language as language_row
      on language_row.oid = procedure_row.prolang
    where procedure_row.oid = v_function::oid
      and namespace_row.nspname = 'public'
      and procedure_row.proname = 'persist_dilution_source_observation'
      and procedure_row.prokind = 'f'
      and pg_catalog.oidvectortypes(procedure_row.proargtypes)
        = 'text, jsonb, text, jsonb, jsonb, jsonb'
      and pg_catalog.pg_get_function_result(procedure_row.oid) = 'jsonb'
      and procedure_row.prosecdef
      and language_row.lanname = 'plpgsql'
  ) then
    raise exception using
      errcode = '42883',
      message = 'Abandoned function identity does not match the expected exact object';
  end if;

  v_observations := pg_catalog.to_regclass('public.dilution_source_observations');
  if v_observations is null or not exists (
    select 1
    from pg_catalog.pg_class as class_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = class_row.relnamespace
    where class_row.oid = v_observations::oid
      and namespace_row.nspname = 'public'
      and class_row.relname = 'dilution_source_observations'
      and class_row.relkind = 'r'
  ) then
    raise exception using
      errcode = '42P01',
      message = 'Expected abandoned table public.dilution_source_observations was not found';
  end if;

  v_exposures := pg_catalog.to_regclass('public.dilution_economic_exposures');
  if v_exposures is null or not exists (
    select 1
    from pg_catalog.pg_class as class_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = class_row.relnamespace
    where class_row.oid = v_exposures::oid
      and namespace_row.nspname = 'public'
      and class_row.relname = 'dilution_economic_exposures'
      and class_row.relkind = 'r'
  ) then
    raise exception using
      errcode = '42P01',
      message = 'Expected abandoned table public.dilution_economic_exposures was not found';
  end if;

  select pg_catalog.count(*)
  into v_observation_rows
  from public.dilution_source_observations;

  select pg_catalog.count(*)
  into v_exposure_rows
  from public.dilution_economic_exposures;

  if v_observation_rows <> 0 or v_exposure_rows <> 0 then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Abandoned dilution Registry tables must be empty before cleanup (dilution_source_observations=%s, dilution_economic_exposures=%s)',
        v_observation_rows,
        v_exposure_rows
      );
  end if;
end
$cleanup$;

drop function public.persist_dilution_source_observation(text, jsonb, text, jsonb, jsonb, jsonb);
drop table public.dilution_source_observations;
drop table public.dilution_economic_exposures;

commit;
