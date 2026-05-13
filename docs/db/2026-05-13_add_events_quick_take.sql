alter table events
  add column if not exists quick_take text;

comment on column events.quick_take is 'One-line feed card takeaway shown under the title. Use summary for detail-page copy.';
