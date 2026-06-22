-- Add the cross-source event type used for traditional IPO, SPAC IPO,
-- direct listing, IPO pricing, and first-trading/listing updates.
-- Apply this before allowing news or SEC filing analysis to persist
-- event_type = 'ipo_listing'.
-- This file is a migration draft; do not run it without explicit approval.

insert into event_types (
  code,
  label,
  category,
  badge_tone,
  source_groups,
  status,
  covered_forms,
  description,
  examples,
  metadata
)
values (
  'ipo_listing',
  'IPO / Listing',
  'Cross-source Events',
  'market',
  array['news','filings']::source_group[],
  'active',
  array['S-1','S-1/A','F-1','F-1/A','424B4','8-K','8-K/A','6-K','6-K/A','EFFECT'],
  'Traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading, listing transition, or registration effectiveness tied to a new public listing.',
  '["IPO pricing","SPAC unit IPO","first trading day","direct listing","registration effectiveness for new listing"]'::jsonb,
  '{"taxonomy_version":"cross_source_event_types_v2","subtypes":["traditional","spac"]}'::jsonb
)
on conflict (code) do update set
  label = excluded.label,
  category = excluded.category,
  badge_tone = excluded.badge_tone,
  source_groups = excluded.source_groups,
  status = excluded.status,
  covered_forms = excluded.covered_forms,
  description = excluded.description,
  examples = excluded.examples,
  metadata = event_types.metadata || excluded.metadata,
  updated_at = now();
