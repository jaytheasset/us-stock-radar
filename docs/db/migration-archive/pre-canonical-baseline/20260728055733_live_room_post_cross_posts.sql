-- Canonical Live Room posts are stored once. Company-room reads may expose a
-- post in an additional company room when that ticker is present in
-- related_tickers. Browsers still have no direct table/function privileges.

create index if not exists live_room_posts_related_tickers_gin_idx
  on public.live_room_posts
  using gin (related_tickers)
  where visibility_status = 'visible';
create or replace function public.validate_live_room_post_cross_targets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room public.live_room_rooms;
  v_invalid_tickers text[];
begin
  select room.*
  into v_room
  from public.live_room_rooms as room
  where room.id = new.room_id;

  if v_room.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_UNAVAILABLE';
  end if;

  if v_room.room_kind = 'company'
    and v_room.ticker = any(new.related_tickers)
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_PRIMARY_TICKER_DUPLICATE';
  end if;

  select pg_catalog.array_agg(candidate order by candidate)
  into v_invalid_tickers
  from pg_catalog.unnest(new.related_tickers) as candidate
  where not exists (
    select 1
    from public.tickers as ticker
    where pg_catalog.upper(pg_catalog.btrim(ticker.symbol)) = candidate
      and ticker.is_active is true
  );

  if pg_catalog.coalesce(
    pg_catalog.cardinality(v_invalid_tickers),
    0
  ) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_TICKERS';
  end if;

  return new;
end
$$;
revoke all privileges
on function public.validate_live_room_post_cross_targets()
from public, anon, authenticated;
grant execute
on function public.validate_live_room_post_cross_targets()
to service_role;
drop trigger if exists live_room_post_cross_targets_guard
on public.live_room_posts;
create trigger live_room_post_cross_targets_guard
before insert or update of room_id, related_tickers
on public.live_room_posts
for each row
execute function public.validate_live_room_post_cross_targets();
