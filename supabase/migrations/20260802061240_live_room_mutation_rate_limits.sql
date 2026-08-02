create table public.live_room_mutation_rate_limits (
  actor_key text not null,
  action text not null,
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint live_room_mutation_rate_limits_pkey primary key (actor_key, action),
  constraint live_room_mutation_rate_limits_actor_key_check
    check (char_length(actor_key) between 1 and 128),
  constraint live_room_mutation_rate_limits_action_check
    check (action in ('follow', 'like', 'report')),
  constraint live_room_mutation_rate_limits_request_count_check
    check (request_count >= 0)
);

alter table public.live_room_mutation_rate_limits enable row level security;
alter table public.live_room_mutation_rate_limits force row level security;

revoke all on table public.live_room_mutation_rate_limits
  from public, anon, authenticated;
grant select, insert, update on table public.live_room_mutation_rate_limits
  to service_role;

create or replace function public.consume_live_room_mutation_rate_limit(
  p_actor_key text,
  p_action text
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_window_seconds integer;
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_actor_key is null
    or p_actor_key <> btrim(p_actor_key)
    or char_length(p_actor_key) not between 1 and 128
  then
    raise exception using errcode = '22023', message = 'invalid rate-limit actor key';
  end if;

  case p_action
    when 'follow' then
      v_limit := 60;
      v_window_seconds := 600;
    when 'like' then
      v_limit := 120;
      v_window_seconds := 300;
    when 'report' then
      v_limit := 10;
      v_window_seconds := 3600;
    else
      raise exception using errcode = '22023', message = 'invalid rate-limit action';
  end case;

  insert into public.live_room_mutation_rate_limits as bucket (
    actor_key,
    action,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_actor_key,
    p_action,
    v_now,
    1,
    v_now
  )
  on conflict (actor_key, action) do update
  set
    window_started_at = case
      when bucket.window_started_at + make_interval(secs => v_window_seconds) <= v_now
        then v_now
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at + make_interval(secs => v_window_seconds) <= v_now
        then 1
      else bucket.request_count + 1
    end,
    updated_at = v_now
  returning bucket.window_started_at, bucket.request_count
  into v_window_started_at, v_request_count;

  allowed := v_request_count <= v_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_window_started_at
            + make_interval(secs => v_window_seconds)
            - v_now
          )
        )
      )::integer
    )
  end;
  return next;
end;
$$;

revoke all on function public.consume_live_room_mutation_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_live_room_mutation_rate_limit(text, text)
  to service_role;

comment on table public.live_room_mutation_rate_limits is
  'Server-owned fixed-window buckets for Live Room follow, like, and report abuse controls.';
