begin;

create index if not exists
  live_room_direct_message_reports_conversation_message_idx
on public.live_room_direct_message_reports (conversation_id, message_id);

commit;
