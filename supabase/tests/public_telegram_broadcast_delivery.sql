begin;

select plan(28);

select has_table(
  'public',
  'public_telegram_broadcast_deliveries',
  'public Telegram broadcast has a dedicated delivery table'
);

select has_index(
  'public',
  'public_telegram_broadcast_deliveries',
  'public_telegram_broadcast_event_channel_key',
  'event and public channel have one durable delivery row'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.public_telegram_broadcast_deliveries'::regclass
  ),
  'public broadcast delivery state has RLS enabled'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.public_telegram_broadcast_deliveries',
    'select'
  ),
  'anonymous clients cannot read public broadcast state'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.public_telegram_broadcast_deliveries',
    'select'
  ),
  'authenticated clients cannot read public broadcast state'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.public_telegram_broadcast_deliveries',
    'select,insert,update,delete'
  ),
  'service role owns public broadcast persistence'
);

select has_function(
  'public',
  'claim_public_telegram_broadcast',
  array['uuid', 'uuid'],
  'public broadcast claim function exists'
);

select has_function(
  'public',
  'finish_public_telegram_broadcast',
  array['uuid', 'uuid', 'text', 'text', 'text'],
  'public broadcast finish function exists'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'claim_public_telegram_broadcast'
  ),
  'public broadcast claim is SECURITY INVOKER'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.events'::regclass
      and tgname = 'events_enqueue_public_telegram_broadcast'
      and not tgisinternal
  ),
  'event analysis storage enqueues the public broadcast'
);

insert into public.events (
  id, source_code, source_group, source_name, published_at, ticker,
  event_type, score, delivery_level, impact, signal, market_scope,
  title, quick_take, group_dedupe_key, metadata
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'qa_news', 'news', 'QA News', pg_catalog.now() - interval '10 minutes',
    'LOW', 'material_filing', 74, 'feed', 'medium', 'neutral', 'company',
    'Below public broadcast threshold', 'Score 74 must remain excluded.',
    'pg-tap:public-telegram:score-74', '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'qa_news', 'news', 'QA News', pg_catalog.now() - interval '10 minutes',
    'HIGH', 'material_filing', 75, 'alert', 'high', 'bullish', 'company',
    'At public broadcast threshold', 'Score 75 must be queued.',
    'pg-tap:public-telegram:score-75', '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'qa_news', 'news', 'QA News', pg_catalog.now() - interval '10 minutes',
    'WAIT', 'material_filing', 90, 'alert', 'high', 'bullish', 'company',
    'Analysis is incomplete', null,
    'pg-tap:public-telegram:no-quick-take', '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    'qa_news', 'news', 'QA News', null,
    'TIME', 'material_filing', 80, 'alert', 'high', 'bullish', 'company',
    'Original event time arrives later', 'Analysis is already complete.',
    'pg-tap:public-telegram:late-published-at', '{}'::jsonb
  );

select is(
  (
    select count(*)
    from public.public_telegram_broadcast_deliveries
    where event_id in (
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
      '00000000-0000-4000-8000-000000000303'
    )
  ),
  1::bigint,
  'score 74 and missing analysis are excluded while score 75 is queued'
);

update public.events
set quick_take = 'Analysis completed after the original due time.'
where id = '00000000-0000-4000-8000-000000000303';

select is(
  (
    select count(*)
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000303'
  ),
  1::bigint,
  'late analysis completion enqueues the event immediately'
);

select ok(
  (
    select scheduled_for <= pg_catalog.now()
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000303'
  ),
  'late analysis keeps the original event time plus five-minute due boundary'
);

select is(
  (
    select scheduled_for
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  (
    select published_at + interval '5 minutes'
    from public.events
    where id = '00000000-0000-4000-8000-000000000302'
  ),
  'the public broadcast is scheduled five minutes after original event time'
);

update public.events
set published_at = detected_at - interval '20 minutes'
where id = '00000000-0000-4000-8000-000000000304';

select is(
  (
    select scheduled_for
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000304'
  ),
  (
    select published_at + interval '5 minutes'
    from public.events
    where id = '00000000-0000-4000-8000-000000000304'
  ),
  'an unattempted pending row follows a late original event timestamp'
);

select is(
  (
    select count(*)
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000304'
  ),
  1::bigint,
  'a timestamp correction updates rather than duplicates the delivery row'
);

select is(
  (
    select acquired
    from public.claim_public_telegram_broadcast(
      (
        select id
        from public.public_telegram_broadcast_deliveries
        where event_id = '00000000-0000-4000-8000-000000000302'
      ),
      '00000000-0000-4000-8000-000000000311'
    )
  ),
  true,
  'the first worker atomically claims the public broadcast'
);

select is(
  (
    select acquired
    from public.claim_public_telegram_broadcast(
      (
        select id
        from public.public_telegram_broadcast_deliveries
        where event_id = '00000000-0000-4000-8000-000000000302'
      ),
      '00000000-0000-4000-8000-000000000312'
    )
  ),
  false,
  'a concurrent worker cannot claim the same public post'
);

select is(
  public.finish_public_telegram_broadcast(
    (
      select id
      from public.public_telegram_broadcast_deliveries
      where event_id = '00000000-0000-4000-8000-000000000302'
    ),
    '00000000-0000-4000-8000-000000000311',
    'failed',
    null,
    'provider rejected the request'
  ),
  true,
  'a definite provider failure is persisted'
);

select is(
  (
    select status
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  'failed',
  'failed is a durable public broadcast state'
);

select ok(
  (
    select next_retry_at > pg_catalog.now()
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  'a definite failure receives a five-minute retry boundary'
);

update public.public_telegram_broadcast_deliveries
set next_retry_at = pg_catalog.now() - interval '1 second'
where event_id = '00000000-0000-4000-8000-000000000302';

select is(
  (
    select acquired
    from public.claim_public_telegram_broadcast(
      (
        select id
        from public.public_telegram_broadcast_deliveries
        where event_id = '00000000-0000-4000-8000-000000000302'
      ),
      '00000000-0000-4000-8000-000000000313'
    )
  ),
  true,
  'a definite failure is claimable after its retry boundary'
);

select is(
  (
    select attempt_count
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  2,
  'retry attempts are counted without creating a second delivery row'
);

select is(
  public.finish_public_telegram_broadcast(
    (
      select id
      from public.public_telegram_broadcast_deliveries
      where event_id = '00000000-0000-4000-8000-000000000302'
    ),
    '00000000-0000-4000-8000-000000000313',
    'sent',
    '1001',
    null
  ),
  true,
  'the retry can finalize a sent provider outcome'
);

select is(
  (
    select acquired
    from public.claim_public_telegram_broadcast(
      (
        select id
        from public.public_telegram_broadcast_deliveries
        where event_id = '00000000-0000-4000-8000-000000000302'
      ),
      '00000000-0000-4000-8000-000000000314'
    )
  ),
  false,
  'a sent public channel post is never reclaimed'
);

select is(
  (
    select status
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  'sent',
  'sent is the final durable public channel outcome'
);

select is(
  (
    select count(*)
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
      and channel = 'telegram_public'
  ),
  1::bigint,
  'one event has exactly one public Telegram delivery row'
);

update public.events
set score = 76
where id = '00000000-0000-4000-8000-000000000302';

select is(
  (
    select count(*)
    from public.public_telegram_broadcast_deliveries
    where event_id = '00000000-0000-4000-8000-000000000302'
  ),
  1::bigint,
  'event analysis updates cannot enqueue a duplicate public post'
);

select * from finish();

rollback;
