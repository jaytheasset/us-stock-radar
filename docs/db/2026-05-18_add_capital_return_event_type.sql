-- Add the cross-source event type used for buyback and share repurchase announcements.
-- Apply this before allowing news or SEC filing analysis to persist event_type = 'capital_return'.
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
  'capital_return',
  'Capital Return',
  'Cross-source Events',
  'market',
  array['news','filings']::source_group[],
  'active',
  array['8-K','8-K/A','6-K','6-K/A','10-Q','10-Q/A','10-K','10-K/A','20-F','20-F/A'],
  'Share repurchase, buyback authorization, repurchase allocation increase, or capital return program where repurchases are the primary event.',
  '["share repurchase authorization","buyback program","repurchase allocation increase","capital return program","combined buyback and dividend update where buyback is primary"]'::jsonb,
  '{"taxonomy_version":"cross_source_event_types_v1"}'::jsonb
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
