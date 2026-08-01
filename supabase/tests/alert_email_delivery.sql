begin;

select plan(19);

select has_table('public', 'alert_email_webhook_events', 'email webhook events have a durable idempotency ledger');
select has_column('public', 'alert_delivery_channel_attempts', 'provider_status', 'attempts track provider status');
select has_column('public', 'alert_delivery_channel_attempts', 'next_retry_at', 'attempts track bounded email retry time');
select ok((select relrowsecurity from pg_class where oid = 'public.alert_email_webhook_events'::regclass), 'email webhook ledger has RLS');
select ok(not has_table_privilege('anon', 'public.alert_email_webhook_events', 'select'), 'anon cannot read webhook events');
select ok(not has_table_privilege('authenticated', 'public.alert_email_webhook_events', 'select'), 'authenticated cannot read webhook events');
select ok(not has_function_privilege('anon', 'public.record_alert_email_webhook_event(text,text,text,timestamptz)', 'execute'), 'anon cannot record provider events');
select ok(not has_function_privilege('authenticated', 'public.record_alert_email_webhook_event(text,text,text,timestamptz)', 'execute'), 'authenticated cannot record provider events');

insert into public.user_profiles (id, email) values ('00000000-0000-4000-8000-000000000601', 'email-alert-db@example.test');
insert into public.user_delivery_channels (user_id, channel, enabled, destination, verified_at)
values ('00000000-0000-4000-8000-000000000601', 'email', true, 'email-alert-db@example.test', now());
insert into public.user_alert_deliveries (
  id, user_id, title, source_type, source_label, alert_lane, severity,
  delivered_channels, delivery_status, scheduled_for, dedupe_key
) values (
  '00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000601',
  'Email DB test', 'other', 'pgTAP', 'watchlist', 'high', array['email']::text[],
  'queued', now(), 'email-alert-db-test'
);

select is((select acquired from public.claim_alert_delivery_channel_attempt(
  '00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000601',
  'email', '00000000-0000-4000-8000-000000000603')), true, 'email attempt can be claimed');
select is(public.finish_alert_delivery_channel_attempt(
  '00000000-0000-4000-8000-000000000602', 'email', '00000000-0000-4000-8000-000000000603',
  'sent', 'resend-test-message', null), true, 'email attempt records provider success');
select is(public.record_alert_email_webhook_event('svix-email-1', 'resend-test-message', 'email.delivered', now()), true, 'first delivered webhook is recorded');
select is(public.record_alert_email_webhook_event('svix-email-1', 'resend-test-message', 'email.delivered', now()), false, 'webhook replay is idempotent');
select is(public.record_alert_email_webhook_event('svix-email-2', 'resend-test-message', 'email.bounced', now()), true, 'hard bounce is recorded');
select is((select enabled from public.user_delivery_channels where user_id = '00000000-0000-4000-8000-000000000601' and channel = 'email'), false, 'hard bounce disables only Email');

insert into public.user_profiles (id, email) values ('00000000-0000-4000-8000-000000000631', 'email-race-db@example.test');
insert into public.user_delivery_channels (user_id, channel, enabled, destination, verified_at)
values ('00000000-0000-4000-8000-000000000631', 'email', true, 'email-race-db@example.test', now());
insert into public.user_alert_deliveries (
  id, user_id, title, source_type, source_label, alert_lane, severity,
  delivered_channels, delivery_status, scheduled_for, dedupe_key
) values (
  '00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000631',
  'Email webhook race test', 'other', 'pgTAP', 'watchlist', 'high', array['email']::text[],
  'queued', now(), 'email-webhook-race-test'
);
select is((select acquired from public.claim_alert_delivery_channel_attempt(
  '00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000631',
  'email', '00000000-0000-4000-8000-000000000633')), true, 'race attempt can be claimed');
select is(public.record_alert_email_webhook_event('svix-race-1', 'resend-race-message', 'email.bounced', now()), true, 'webhook can arrive before provider id persistence');
select is(public.finish_alert_delivery_channel_attempt(
  '00000000-0000-4000-8000-000000000632', 'email', '00000000-0000-4000-8000-000000000633',
  'sent', 'resend-race-message', null), true, 'finishing reconciles an early webhook');
select is((select provider_status from public.alert_delivery_channel_attempts where delivery_id = '00000000-0000-4000-8000-000000000632' and channel = 'email'), 'email.bounced', 'early webhook status is attached to the attempt');
select is((select enabled from public.user_delivery_channels where user_id = '00000000-0000-4000-8000-000000000631' and channel = 'email'), false, 'early hard bounce still suppresses Email');

rollback;
