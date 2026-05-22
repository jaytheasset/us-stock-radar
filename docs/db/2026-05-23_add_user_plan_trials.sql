-- Adds one-time Pro trial metadata to user_plan_subscriptions.
-- Safe to run more than once. RLS remains unchanged.

alter table if exists user_plan_subscriptions
  add column if not exists trial_plan text;

alter table if exists user_plan_subscriptions
  add column if not exists trial_started_at timestamptz;

alter table if exists user_plan_subscriptions
  add column if not exists trial_ends_at timestamptz;

alter table if exists user_plan_subscriptions
  add column if not exists trial_used_at timestamptz;

alter table if exists user_plan_subscriptions
  add column if not exists trial_cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_plan_subscriptions_trial_plan_check'
      and conrelid = 'user_plan_subscriptions'::regclass
  ) then
    alter table user_plan_subscriptions
      add constraint user_plan_subscriptions_trial_plan_check
      check (trial_plan is null or trial_plan in ('pro'));
  end if;
end $$;

create index if not exists user_plan_subscriptions_trial_ends_at_idx
  on user_plan_subscriptions(trial_ends_at)
  where trial_ends_at is not null;
