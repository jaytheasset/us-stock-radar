begin;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'message',
  report.id,
  'normal',
  'live_room_message',
  report.message_id,
  case
    when message.id is null then jsonb_build_object(
      'evidence_missing', true,
      'target_id', report.message_id
    )
    else jsonb_build_object(
      'author_user_id', message.member_user_id,
      'author_display_name', message.author_display_name,
      'body', message.body,
      'created_at', message.created_at,
      'room_id', message.room_id,
      'visibility_status', message.visibility_status
    )
  end,
  report.created_at,
  report.created_at
from public.live_room_message_reports as report
left join public.live_room_messages as message on message.id = report.message_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'post',
  report.id,
  'normal',
  'live_room_post',
  report.post_id,
  case
    when post.id is null then jsonb_build_object(
      'evidence_missing', true,
      'target_id', report.post_id
    )
    else jsonb_build_object(
      'author_user_id', post.author_user_id,
      'body', post.body,
      'created_at', post.created_at,
      'room_id', post.room_id,
      'title', post.title,
      'visibility_status', post.visibility_status
    )
  end,
  report.created_at,
  report.created_at
from public.live_room_post_reports as report
left join public.live_room_posts as post on post.id = report.post_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'comment',
  report.id,
  'normal',
  'live_room_post_comment',
  report.comment_id,
  case
    when comment.id is null then jsonb_build_object(
      'evidence_missing', true,
      'target_id', report.comment_id
    )
    else jsonb_build_object(
      'author_user_id', comment.author_user_id,
      'body', comment.body,
      'created_at', comment.created_at,
      'post_id', comment.post_id,
      'visibility_status', comment.visibility_status
    )
  end,
  report.created_at,
  report.created_at
from public.live_room_post_comment_reports as report
left join public.live_room_post_comments as comment
  on comment.id = report.comment_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'direct_message',
  report.id,
  case
    when report.priority >= 150 then 'critical'
    when report.priority >= 100 then 'high'
    when report.priority < 40 then 'low'
    else 'normal'
  end,
  'live_room_direct_message',
  report.message_id,
  case
    when message.id is null then jsonb_build_object(
      'evidence_missing', true,
      'target_id', report.message_id
    )
    else jsonb_build_object(
      'author_user_id', message.sender_user_id,
      'body', message.body,
      'conversation_id', message.conversation_id,
      'created_at', message.created_at,
      'message_kind', message.message_kind,
      'risk_flags', message.risk_flags,
      'risk_score', message.risk_score
    )
  end,
  report.created_at,
  report.created_at
from public.live_room_direct_message_reports as report
left join public.live_room_direct_messages as message
  on message.id = report.message_id
on conflict (report_type, report_id) do nothing;

commit;
