alter table event_calendar_items
  add column if not exists calendar_event_key text,
  add column if not exists calendar_status text not null default 'tentative',
  add column if not exists confirmation_source text not null default 'news',
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by_event_id uuid references events(id) on delete set null,
  add column if not exists superseded_by_item_id uuid references event_calendar_items(id) on delete set null;

do $$
begin
  alter table event_calendar_items
    add constraint event_calendar_items_status_check
    check (calendar_status in ('tentative', 'confirmed', 'superseded', 'cancelled'));
exception
  when duplicate_object then null;
end $$;

update event_calendar_items
set
  calendar_event_key = lower(
    concat_ws(
      ':',
      coalesce(nullif(ticker, ''), 'market'),
      calendar_event_type,
      coalesce(event_date::text, estimated_start_date::text, estimated_end_date::text, 'unknown'),
      coalesce(event_time::text, 'all_day'),
      left(regexp_replace(lower(calendar_title), '[^a-z0-9]+', '-', 'g'), 80)
    )
  )
where calendar_event_key is null;

update event_calendar_items
set
  calendar_status = case
    when source_group::text = 'filings'
      and event_date is not null
      and is_estimated = false
      and date_precision = 'exact'
      then 'confirmed'
    else calendar_status
  end,
  confirmation_source = coalesce(nullif(confirmation_source, ''), source_group::text),
  confirmed_at = case
    when source_group::text = 'filings'
      and event_date is not null
      and is_estimated = false
      and date_precision = 'exact'
      then coalesce(confirmed_at, now())
    else confirmed_at
  end;

alter table event_calendar_items
  alter column calendar_event_key set not null;

create index if not exists event_calendar_items_key_idx
  on event_calendar_items(calendar_event_key);

create index if not exists event_calendar_items_status_date_idx
  on event_calendar_items(calendar_status, event_date, estimated_start_date);
