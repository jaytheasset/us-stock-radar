create table if not exists event_calendar_items (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid references events(id) on delete cascade,
  raw_item_id uuid references raw_items(id) on delete set null,
  source_code text references sources(code),
  source_group source_group not null,
  ticker text,
  company_name text,
  calendar_event_key text not null,
  calendar_event_type text not null,
  calendar_group text not null,
  calendar_title text not null,
  event_date date,
  event_time time,
  event_timezone text,
  date_precision text not null default 'exact'
    check (date_precision in ('exact', 'month', 'quarter', 'year', 'unknown')),
  estimated_start_date date,
  estimated_end_date date,
  is_estimated boolean not null default false,
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  calendar_status text not null default 'tentative'
    check (calendar_status in ('tentative', 'confirmed', 'superseded', 'cancelled')),
  confirmation_source text not null default 'news',
  confirmed_at timestamptz,
  confirmed_by_event_id uuid references events(id) on delete set null,
  superseded_by_item_id uuid references event_calendar_items(id) on delete set null,
  source_url text,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (
    event_date is not null
    or estimated_start_date is not null
    or estimated_end_date is not null
  )
);

create index if not exists event_calendar_items_date_idx
  on event_calendar_items(event_date, estimated_start_date, calendar_group);

create index if not exists event_calendar_items_event_idx
  on event_calendar_items(source_event_id);

create index if not exists event_calendar_items_key_idx
  on event_calendar_items(calendar_event_key);

create index if not exists event_calendar_items_ticker_idx
  on event_calendar_items(ticker, event_date)
  where ticker is not null;

create index if not exists event_calendar_items_type_idx
  on event_calendar_items(calendar_event_type, event_date);

create index if not exists event_calendar_items_status_date_idx
  on event_calendar_items(calendar_status, event_date, estimated_start_date);
