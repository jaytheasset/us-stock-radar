-- Telegram connect token support for Alerts delivery channels.
-- Safe to run multiple times. Does not modify events/feed tables.

create table if not exists telegram_connect_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_connect_tokens_user_idx
  on telegram_connect_tokens(user_id);

create index if not exists telegram_connect_tokens_hash_idx
  on telegram_connect_tokens(token_hash);

create index if not exists telegram_connect_tokens_expires_idx
  on telegram_connect_tokens(expires_at);

-- RLS is intentionally not enabled yet. Add auth.uid() policies when Supabase Auth is wired.
