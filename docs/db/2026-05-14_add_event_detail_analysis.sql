-- Add detail-page analysis structures for canonical events.
--
-- Keep feed/list fields on events:
--   quick_take, summary, score, impact, signal, delivery_level
--
-- Store longer detail-page sections here so the live feed remains lightweight.

create table if not exists event_analysis (
  event_id uuid primary key references events(id) on delete cascade,
  analysis_scope text not null default 'company'
    check (analysis_scope in ('company', 'sector', 'theme', 'market')),
  why_it_matters text,
  bullish_points jsonb not null default '[]'::jsonb,
  bearish_points jsonb not null default '[]'::jsonb,
  key_evidence jsonb not null default '[]'::jsonb,
  watch_next jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists event_analysis_scope_idx
  on event_analysis(analysis_scope);

create table if not exists event_tickers (
  event_id uuid not null references events(id) on delete cascade,
  symbol text not null,
  role text not null default 'related'
    check (role in ('primary', 'related', 'peer', 'mentioned', 'sector_constituent', 'theme_constituent')),
  relevance_score integer check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 100)),
  sort_order integer not null default 100,
  reason text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (event_id, symbol, role)
);

create index if not exists event_tickers_symbol_idx
  on event_tickers(symbol, role);

create index if not exists event_tickers_event_sort_idx
  on event_tickers(event_id, sort_order);

comment on table event_analysis is 'One detailed analysis row per event for detail-page sections.';
comment on column event_analysis.analysis_scope is 'company, sector, theme, or market analysis scope.';
comment on column event_analysis.why_it_matters is 'Detail-page explanation of why the event matters.';
comment on column event_analysis.bullish_points is 'JSON array of bullish detail-page bullets.';
comment on column event_analysis.bearish_points is 'JSON array of bearish detail-page bullets.';
comment on column event_analysis.key_evidence is 'JSON array of source-backed evidence bullets or structured evidence objects.';
comment on column event_analysis.watch_next is 'JSON array of next catalysts, risks, dates, or checks.';
comment on column event_analysis.metadata is 'Raw/debug/extra analysis payload only.';

comment on table event_tickers is 'Ticker links for events, including related ticker cards on detail pages.';
comment on column event_tickers.role is 'primary, related, peer, mentioned, sector_constituent, or theme_constituent.';
comment on column event_tickers.relevance_score is '0-100 optional ticker relevance score for sorting.';
