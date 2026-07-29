alter type public.live_room_post_signal
  add value if not exists 'stock_split';
alter type public.live_room_post_signal
  add value if not exists 'reverse_split';
alter type public.live_room_post_signal
  add value if not exists 'direction_bullish';
alter type public.live_room_post_signal
  add value if not exists 'direction_bearish';
alter type public.live_room_post_signal
  add value if not exists 'direction_volatile';
alter type public.live_room_post_signal
  add value if not exists 'direction_neutral';

create or replace function public.live_room_post_signals_valid(
  p_values public.live_room_post_signal[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) <= 4
    and pg_catalog.array_position(p_values, null) is null
    and pg_catalog.cardinality(p_values) = (
      select pg_catalog.count(distinct signal)::integer
      from pg_catalog.unnest(p_values) as signal
    )
    and (
      select pg_catalog.count(*)::integer
      from pg_catalog.unnest(p_values) as signal
      where signal::text not in (
        'direction_bullish',
        'direction_bearish',
        'direction_volatile',
        'direction_neutral'
      )
    ) <= 3
    and (
      select pg_catalog.count(*)::integer
      from pg_catalog.unnest(p_values) as signal
      where signal::text in (
        'direction_bullish',
        'direction_bearish',
        'direction_volatile',
        'direction_neutral'
      )
    ) <= 1
$function$;

alter function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
) owner to postgres;

revoke all on function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
) from public, anon, authenticated;
grant execute on function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
) to service_role;
