-- Worker-friendly delivery log hardening.
-- This migration only touches user_alert_deliveries.
-- It is safe to run multiple times and does not modify event/source tables.

alter table if exists user_alert_deliveries
  add column if not exists dedupe_key text,
  add column if not exists scheduled_for timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists attempted_at timestamptz,
  add column if not exists last_error text;

do $$
begin
  if to_regclass('public.user_alert_deliveries') is not null then
    update user_alert_deliveries
       set scheduled_for = coalesce(scheduled_for, delivered_at, created_at, now())
     where scheduled_for is null;

    update user_alert_deliveries
       set sent_at = coalesce(sent_at, delivered_at)
     where sent_at is null
       and delivery_status = 'sent';
  end if;
end $$;

do $$
begin
  if to_regclass('public.user_alert_deliveries') is not null then
    create unique index if not exists user_alert_deliveries_user_dedupe_key_unique
      on user_alert_deliveries(user_id, dedupe_key)
      where dedupe_key is not null;

    create index if not exists user_alert_deliveries_status_scheduled_idx
      on user_alert_deliveries(delivery_status, scheduled_for);

    create index if not exists user_alert_deliveries_user_status_scheduled_idx
      on user_alert_deliveries(user_id, delivery_status, scheduled_for);
  end if;
end $$;

-- RLS remains disabled for now. Add auth.uid() policies when Supabase Auth is wired.
