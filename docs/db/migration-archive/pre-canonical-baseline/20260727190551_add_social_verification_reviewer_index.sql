begin;

create index live_room_social_verifications_reviewed_by_idx
  on public.live_room_social_verifications (reviewed_by);

commit;
