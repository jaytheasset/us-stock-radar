begin;

create function private.join_live_room_community_room_owner()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_live_room_membership(
    new.room_id,
    new.owner_user_id
  );

  return new;
end;
$$;

comment on function private.join_live_room_community_room_owner() is
  'Makes every Community Room creator a persistent room member in the same transaction as room creation.';

create trigger join_live_room_community_room_owner
after insert on public.live_room_community_rooms
for each row
execute function private.join_live_room_community_room_owner();

revoke all on function private.join_live_room_community_room_owner()
  from public, anon, authenticated;
grant execute on function private.join_live_room_community_room_owner()
  to service_role;

do $$
declare
  v_room record;
begin
  for v_room in
    select room.room_id, room.owner_user_id
    from public.live_room_community_rooms as room
    where not exists (
      select 1
      from public.live_room_memberships as membership
      where membership.room_id = room.room_id
        and membership.member_user_id = room.owner_user_id
    )
  loop
    perform private.ensure_live_room_membership(
      v_room.room_id,
      v_room.owner_user_id
    );
  end loop;
end;
$$;

commit;
