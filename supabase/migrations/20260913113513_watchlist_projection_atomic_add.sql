-- Change detector only. Security relationships remain in the existing reader.
create or replace function public.watchlist_projection_snapshot()
returns text language sql stable security invoker set search_path = ''
as $$
  with scoped_results as (
    select r.* from public.sec_cover_observation_results r
    where r.accession_number in (
      select evidence_accession_number from public.sec_ticker_resolution_decisions
      union select before_accession_number from public.sec_ticker_resolution_decisions
      union select after_accession_number from public.sec_ticker_resolution_decisions
    )
  )
  select pg_catalog.md5(pg_catalog.array_to_string(array[
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_structured_raw_sources t where t.id in (select source_raw_id from scoped_results)),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from scoped_results t),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_cover_security_observations t where t.result_id in (select id from scoped_results)),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_ticker_security_identities t),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_ticker_change_evidence t),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_ticker_resolution_decisions t),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(t)::text), '' order by pg_catalog.md5(pg_catalog.to_jsonb(t)::text)), '')) from public.sec_ticker_resolution_human_decisions t)
  ], ':'));
$$;

create or replace function public.add_watchlist_ticker_verified(
  p_user_id uuid, p_saved_ticker text, p_company_name text,
  p_aliases text[], p_projection_snapshot text, p_limit integer
)
returns jsonb language plpgsql volatile security invoker
set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_saved text[];
  v_usage integer;
begin
  if p_user_id is null or p_saved_ticker is null or
     p_saved_ticker !~ '^[A-Z0-9.-]{1,12}$' or
     p_aliases is null or cardinality(p_aliases) < 1 or cardinality(p_aliases) > 1000 or
     not (p_saved_ticker = any(p_aliases)) or
     exists (select 1 from unnest(p_aliases) a where a is null or a !~ '^[A-Z0-9.-]{1,12}$') or
     p_projection_snapshot is null or p_projection_snapshot !~ '^[0-9a-f]{32}$' or
     p_limit < 0 then
    raise exception 'Invalid verified watchlist addition' using errcode = '22023';
  end if;
  -- All application POSTs, including shared literal buttons, enter this lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('watchlist-add:' || p_user_id::text, 0));
  if public.watchlist_projection_snapshot() <> p_projection_snapshot then
    return jsonb_build_object('status', 'stale');
  end if;
  select coalesce(array_agg(ticker order by ticker), array[]::text[])
    into v_saved from public.watchlist_tickers where user_id = p_user_id and ticker = any(p_aliases);
  if cardinality(v_saved) > 0 then
    return jsonb_build_object('status', 'duplicate', 'savedTickers', v_saved);
  end if;
  select count(*) into v_usage from public.watchlist_tickers where user_id = p_user_id;
  if p_limit is not null and v_usage >= p_limit then
    return jsonb_build_object('status', 'limit', 'usage', v_usage);
  end if;
  -- Final validation and INSERT share one MVCC statement snapshot. Decisions
  -- committed after that snapshot affect the next effective read.
  insert into public.watchlist_tickers(user_id, ticker, company_name)
    select p_user_id, p_saved_ticker, p_company_name
    where public.watchlist_projection_snapshot() = p_projection_snapshot;
  if not found then return jsonb_build_object('status', 'stale'); end if;
  return jsonb_build_object('status', 'inserted');
end;
$$;

revoke all on function public.watchlist_projection_snapshot() from public, anon, authenticated;
revoke all on function public.add_watchlist_ticker_verified(uuid,text,text,text[],text,integer) from public, anon, authenticated;
grant execute on function public.watchlist_projection_snapshot() to service_role;
grant execute on function public.add_watchlist_ticker_verified(uuid,text,text,text[],text,integer) to service_role;

