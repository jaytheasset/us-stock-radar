begin;

select plan(13);

select has_table(
  'public',
  'calendar_event_analysis_links',
  'Calendar analysis relationships have a dedicated table'
);

select columns_are(
  'public',
  'calendar_event_analysis_links',
  array[
    'id',
    'calendar_event_id',
    'analysis_event_id',
    'relation_type',
    'link_status',
    'match_score',
    'match_method',
    'is_primary',
    'reason',
    'evidence',
    'created_at',
    'updated_at'
  ],
  'link rows expose only relationship and matching metadata'
);

select has_index(
  'public',
  'calendar_event_analysis_links',
  'calendar_event_analysis_links_calendar_idx',
  'Calendar-to-analysis reads have an index'
);

select has_index(
  'public',
  'calendar_event_analysis_links',
  'calendar_event_analysis_links_analysis_idx',
  'analysis-to-Calendar reads have an index'
);

select has_index(
  'public',
  'calendar_event_analysis_links',
  'calendar_event_analysis_links_primary_uidx',
  'one representative analysis is enforced per Calendar event'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'calendar_event_analysis_links'
  ),
  'link rows have RLS enabled'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'public.calendar_event_analysis_links',
    'select,insert,update,delete'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'public.calendar_event_analysis_links',
    'select,insert,update,delete'
  ),
  'browser roles cannot read or mutate analysis links directly'
);

select ok(
  pg_catalog.has_table_privilege(
    'service_role',
    'public.calendar_event_analysis_links',
    'select,insert,update,delete'
  ),
  'service role manages analysis links'
);

select function_privs_are(
  'public',
  'upsert_calendar_event_analysis_matches',
  array['uuid', 'jsonb', 'uuid'],
  'service_role',
  array['EXECUTE'],
  'only the service role executes the matcher write RPC'
);

insert into public.calendar_events (
  id, canonical_identity_key, event_type, category, title, event_date,
  event_time, time_status, market_session, lifecycle_status,
  schedule_confidence, impact_level, impact_scope
)
values (
  '00000000-0000-4000-8000-000000000201',
  'pg-tap:calendar-analysis-link',
  'earnings',
  'company',
  'Calendar analysis link test',
  date '2026-08-06',
  null,
  'time-not-announced',
  'tna',
  'scheduled',
  'tentative',
  'high',
  'company'
);

insert into public.events (
  id, source_code, source_group, source_name, published_at, ticker,
  event_type, score, delivery_level, impact, signal, market_scope,
  title, group_dedupe_key, metadata
)
values
  (
    '00000000-0000-4000-8000-000000000202',
    'qa_sec', 'filings', 'SEC EDGAR', timestamptz '2026-08-06 20:00:00+00',
    'TEST', 'material_filing', 80, 'alert', 'high', 'neutral', 'company',
    'Earnings result', 'pg-tap:calendar-analysis:result',
    '{"accession_number":"0000000000-26-000001"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'qa_sec', 'filings', 'SEC EDGAR', timestamptz '2026-08-07 20:00:00+00',
    'TEST', 'material_filing', 70, 'feed', 'medium', 'neutral', 'company',
    'Earnings amendment', 'pg-tap:calendar-analysis:amendment',
    '{"accession_number":"0000000000-26-000002","form_type":"8-K/A"}'::jsonb
  );

select is(
  (
    select processed_count
    from public.upsert_calendar_event_analysis_matches(
      '00000000-0000-4000-8000-000000000201',
      '[
        {"analysis_event_id":"00000000-0000-4000-8000-000000000202","relation_type":"result","link_status":"linked","match_score":100,"match_method":"exact","reason":{"codes":["exact_identifier_match"]},"evidence":{"accession":true}},
        {"analysis_event_id":"00000000-0000-4000-8000-000000000203","relation_type":"amendment","link_status":"linked","match_score":95,"match_method":"rules","reason":{"codes":["amendment_match"]},"evidence":{"ticker":true}}
      ]'::jsonb,
      '00000000-0000-4000-8000-000000000202'
    )
  ),
  2,
  'one atomic call processes the representative and amendment links'
);

select is(
  (
    select count(*)
    from public.calendar_event_analysis_links
    where calendar_event_id = '00000000-0000-4000-8000-000000000201'
  ),
  2::bigint,
  'multiple related analyses remain stored'
);

select is(
  (
    select analysis_event_id
    from public.calendar_event_analysis_links
    where calendar_event_id = '00000000-0000-4000-8000-000000000201'
      and is_primary
  ),
  '00000000-0000-4000-8000-000000000202'::uuid,
  'exact result is the sole representative analysis'
);

select is(
  (
    select changed_count
    from public.upsert_calendar_event_analysis_matches(
      '00000000-0000-4000-8000-000000000201',
      '[
        {"analysis_event_id":"00000000-0000-4000-8000-000000000202","relation_type":"result","link_status":"linked","match_score":100,"match_method":"exact","reason":{"codes":["exact_identifier_match"]},"evidence":{"accession":true}},
        {"analysis_event_id":"00000000-0000-4000-8000-000000000203","relation_type":"amendment","link_status":"linked","match_score":95,"match_method":"rules","reason":{"codes":["amendment_match"]},"evidence":{"ticker":true}}
      ]'::jsonb,
      '00000000-0000-4000-8000-000000000202'
    )
  ),
  0,
  'reprocessing an identical observation is idempotent'
);

select * from finish();

rollback;
