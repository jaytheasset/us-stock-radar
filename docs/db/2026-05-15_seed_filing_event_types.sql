-- Seed the fixed large filing event taxonomy.
-- News event types are intentionally not added here; they will be defined separately.

do $$
begin
  create type source_group as enum ('news', 'filings', 'market');
exception
  when duplicate_object then null;
end $$;

create table if not exists event_types (
  code text primary key,
  label text not null,
  category text not null,
  badge_tone text not null,
  source_groups source_group[] not null default '{}',
  status text not null default 'active',
  covered_forms text[] not null default '{}',
  description text,
  examples jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

delete from event_types
where code = 'price_momentum'
   or code in (
  'current_report',
  'prospectus_supplement',
  'quarterly_report',
  'financing_dilution',
  'earnings_result',
  'earnings_delay',
  'earnings_preview',
  'going_concern',
  'reverse_split',
  'delisting_watch',
  'mna',
  'merger_acquisition',
  'contract_award',
  'partnership',
  'product_launch',
  'product_delay',
  'project_update',
  'production_update',
  'clinical_update',
  'regulatory_approval',
  'fda_catalyst',
  'insider_buy',
  'ownership_change',
  'dividend'
);

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
values
  (
    'listing_risk',
    'Listing Risk',
    'Filing Events',
    'risk',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','DEF 14A','PRE 14A'],
    'Exchange listing, compliance, delisting, reverse split, trading suspension, or compliance recovery disclosure.',
    '["Nasdaq deficiency notice","compliance regained","reverse split for minimum bid compliance"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'dilution_risk',
    'Dilution Risk',
    'Filing Events',
    'dilution',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','S-1','S-1/A','F-1','F-1/A','S-3','S-3/A','S-3ASR','F-3','F-3/A','424B3','424B5'],
    'Offering, resale, shelf, ATM, warrant, convertible, private placement, or dilution-risk resolution disclosure.',
    '["ATM offering","convertible note financing","debt repayment reducing dilution risk"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'earnings',
    'Earnings',
    'Filing Events',
    'earnings',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','10-Q','10-Q/A','10-K','10-K/A','20-F','20-F/A'],
    'Earnings, financial results, guidance, late periodic report, or earnings-related filing update.',
    '["quarterly results","guidance update","late 10-Q filing"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'sales_performance',
    'Sales Performance',
    'Filing Events',
    'earnings',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A'],
    'Revenue, sales, booking, backlog, order, margin, operating metric, or customer-demand disclosure outside a full earnings report.',
    '["revenue growth update","sales decline warning","backlog improvement"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'product_update',
    'Product Update',
    'Filing Events',
    'general',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A'],
    'Product, service, project, operations, production, launch, delay, commercialization, or technical milestone disclosure.',
    '["product launch","production update","commercial rollout delay"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'leadership_governance',
    'Leadership / Governance',
    'Filing Events',
    'regulatory',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','DEF 14A','PRE 14A'],
    'Executive, board, auditor, governance, control, resignation, appointment, compensation, or internal-control disclosure.',
    '["CEO resignation","auditor change","material weakness update"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'insider_ownership',
    'Insider / Ownership',
    'Filing Events',
    'regulatory',
    array['filings']::source_group[],
    'active',
    array['4','4/A','SC 13D','SC 13D/A','SC 13G','SC 13G/A','144','144/A'],
    'Insider transaction, beneficial ownership, activist stake, major holder, or planned sale disclosure.',
    '["insider purchase","13D activist stake","Rule 144 planned sale"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'shareholder_vote',
    'Shareholder Vote',
    'Filing Events',
    'regulatory',
    array['filings']::source_group[],
    'active',
    array['DEF 14A','PRE 14A','DEFA14A','DEFM14A','PREM14A','8-K','8-K/A','6-K','6-K/A'],
    'Proxy, shareholder meeting, vote result, proposal, approval, rejection, or consent solicitation disclosure.',
    '["shareholder approval","proxy vote proposal","special meeting result"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'strategic_transaction',
    'Strategic Transaction',
    'Filing Events',
    'deal',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','S-4','S-4/A','F-4','F-4/A','SC TO-T','SC TO-T/A','SC TO-I','SC TO-I/A','SC 14D9','SC 14D9/A'],
    'Merger, acquisition, tender offer, asset sale, JV, partnership, license, strategic investment, or material agreement disclosure.',
    '["merger agreement","asset sale","material customer contract"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'financial_risk',
    'Financial Risk',
    'Filing Events',
    'risk',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A','10-Q','10-Q/A','10-K','10-K/A','20-F','20-F/A','NT 10-K','NT 10-Q'],
    'Liquidity, going concern, default, debt, covenant, credit facility, restructuring, bankruptcy, or financial-condition disclosure.',
    '["going concern warning","loan covenant default","liquidity improvement"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'legal_risk',
    'Legal Risk',
    'Filing Events',
    'risk',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A'],
    'Lawsuit, investigation, subpoena, settlement, regulatory action, enforcement, compliance, or legal-resolution disclosure.',
    '["SEC investigation","lawsuit settlement","regulatory inquiry resolved"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'dividends',
    'Dividends',
    'Filing Events',
    'market',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A'],
    'Dividend, distribution, special dividend, payout suspension, payout increase, payout cut, or record-date disclosure.',
    '["monthly distribution","special dividend","dividend suspension"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
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
  ),
  (
    'fda_clinical',
    'FDA / Clinical',
    'Filing Events',
    'clinical',
    array['filings']::source_group[],
    'active',
    array['8-K','8-K/A','6-K','6-K/A'],
    'FDA, clinical, trial, approval, clearance, CRL, safety, PDUFA, advisory committee, or healthcare regulatory disclosure.',
    '["FDA approval","clinical trial result","complete response letter"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
  ),
  (
    'other',
    'Other',
    'Filing Events',
    'general',
    array['filings']::source_group[],
    'active',
    array[]::text[],
    'Fallback for filing disclosures that do not fit the fixed filing event taxonomy.',
    '["administrative filing update","miscellaneous disclosure"]'::jsonb,
    '{"taxonomy_version":"filing_event_types_v1"}'::jsonb
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
  metadata = excluded.metadata,
  updated_at = now();

comment on table event_types is 'Canonical event_type registry used by feed badges, filters, and parser output.';
