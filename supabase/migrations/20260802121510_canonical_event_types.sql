-- Canonical storage taxonomy: 17 public alert types plus two internal parser
-- types (operating_update and other). Existing non-canonical fixture rows are
-- intentionally preserved.
with canonical_event_types as (
  select value as definition
  from jsonb_array_elements($event_types$
[
  {
    "code": "listing_risk",
    "label": "Listing Risk",
    "category": "Filing Events",
    "badge_tone": "risk",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Exchange listing, compliance, delisting, reverse split, trading suspension, or compliance recovery disclosure.",
    "visibility": "public"
  },
  {
    "code": "dilution_risk",
    "label": "Dilution Risk",
    "category": "Filing Events",
    "badge_tone": "dilution",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Offering, resale, shelf, ATM, warrant, convertible, private placement, or dilution-risk resolution disclosure.",
    "visibility": "public"
  },
  {
    "code": "earnings",
    "label": "Earnings",
    "category": "Filing Events",
    "badge_tone": "earnings",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Earnings, financial results, guidance, late periodic report, or earnings-related filing update.",
    "visibility": "public"
  },
  {
    "code": "sales_performance",
    "label": "Sales Performance",
    "category": "Filing Events",
    "badge_tone": "earnings",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Revenue, sales, booking, backlog, order, margin, operating metric, or customer-demand disclosure outside a full earnings report.",
    "visibility": "public"
  },
  {
    "code": "operating_update",
    "label": "Operating Update",
    "category": "Filing Events",
    "badge_tone": "general",
    "source_groups": ["filings"],
    "status": "active",
    "description": "Workforce, restructuring, cost reduction, facility, capacity, or other operating-plan disclosure outside a full earnings report.",
    "visibility": "internal"
  },
  {
    "code": "product_update",
    "label": "Product Update",
    "category": "Filing Events",
    "badge_tone": "general",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Product, service, project, operations, production, launch, delay, commercialization, or technical milestone disclosure.",
    "visibility": "public"
  },
  {
    "code": "leadership_governance",
    "label": "Leadership / Governance",
    "category": "Filing Events",
    "badge_tone": "regulatory",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Executive, board, auditor, governance, control, resignation, appointment, compensation, or internal-control disclosure.",
    "visibility": "public"
  },
  {
    "code": "insider_ownership",
    "label": "Insider / Ownership",
    "category": "Filing Events",
    "badge_tone": "regulatory",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Insider transaction, beneficial ownership, activist stake, major holder, or planned sale disclosure.",
    "visibility": "public"
  },
  {
    "code": "ipo_listing",
    "label": "IPO / Listing",
    "category": "Filing Events",
    "badge_tone": "deal",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
    "visibility": "public"
  },
  {
    "code": "shareholder_vote",
    "label": "Shareholder Vote",
    "category": "Filing Events",
    "badge_tone": "regulatory",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Proxy, shareholder meeting, vote result, proposal, approval, rejection, or consent solicitation disclosure.",
    "visibility": "public"
  },
  {
    "code": "strategic_transaction",
    "label": "Strategic Transaction",
    "category": "Filing Events",
    "badge_tone": "deal",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Merger, acquisition, tender offer, asset sale, JV, partnership, license, strategic investment, or material agreement disclosure.",
    "visibility": "public"
  },
  {
    "code": "financial_risk",
    "label": "Financial Risk",
    "category": "Filing Events",
    "badge_tone": "risk",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Liquidity, going concern, default, debt, covenant, credit facility, restructuring, bankruptcy, or financial-condition disclosure.",
    "visibility": "public"
  },
  {
    "code": "legal_risk",
    "label": "Legal Risk",
    "category": "Filing Events",
    "badge_tone": "risk",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Lawsuit, investigation, subpoena, settlement, regulatory action, enforcement, compliance, or legal-resolution disclosure.",
    "visibility": "public"
  },
  {
    "code": "dividends",
    "label": "Dividends",
    "category": "Filing Events",
    "badge_tone": "market",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Dividend, distribution, special dividend, payout suspension, payout increase, payout cut, or record-date disclosure.",
    "visibility": "public"
  },
  {
    "code": "capital_return",
    "label": "Capital Return",
    "category": "Cross-source Events",
    "badge_tone": "market",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Share repurchase, buyback authorization, repurchase allocation increase, or capital return program where repurchases are the primary event.",
    "visibility": "public"
  },
  {
    "code": "fda_clinical",
    "label": "FDA / Clinical",
    "category": "Filing Events",
    "badge_tone": "clinical",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "FDA, clinical, trial, approval, clearance, CRL, safety, PDUFA, advisory committee, or healthcare regulatory disclosure.",
    "visibility": "public"
  },
  {
    "code": "policy_regulation",
    "label": "Policy & Regulation",
    "category": "Cross-source Events",
    "badge_tone": "regulatory",
    "source_groups": ["news", "market"],
    "status": "active",
    "description": "Policy decisions, agency actions, regulation changes, official rulings, or enforcement developments with market impact.",
    "visibility": "public"
  },
  {
    "code": "macro_market",
    "label": "Macro Market",
    "category": "Cross-source Events",
    "badge_tone": "market",
    "source_groups": ["news", "market"],
    "status": "active",
    "description": "Rates, inflation, employment, sanctions, geopolitics, or other market-wide macro catalyst.",
    "visibility": "public"
  },
  {
    "code": "other",
    "label": "Other",
    "category": "Filing Events",
    "badge_tone": "general",
    "source_groups": ["news", "filings"],
    "status": "active",
    "description": "Fallback for filing disclosures that do not fit the fixed filing event taxonomy.",
    "visibility": "internal"
  }
]
$event_types$::jsonb)
)
insert into public.event_types as existing (
  code,
  label,
  category,
  badge_tone,
  source_groups,
  status,
  description,
  metadata
)
select
  definition ->> 'code',
  definition ->> 'label',
  definition ->> 'category',
  definition ->> 'badge_tone',
  array(
    select jsonb_array_elements_text(definition -> 'source_groups')
  )::public.source_group[],
  definition ->> 'status',
  definition ->> 'description',
  jsonb_build_object(
    'taxonomy_version', 'canonical_event_types_v1',
    'visibility', definition ->> 'visibility'
  )
from canonical_event_types
on conflict (code) do update set
  label = excluded.label,
  category = excluded.category,
  badge_tone = excluded.badge_tone,
  source_groups = excluded.source_groups,
  status = excluded.status,
  description = excluded.description,
  metadata = existing.metadata || excluded.metadata,
  updated_at = now()
where (
  existing.label,
  existing.category,
  existing.badge_tone,
  existing.source_groups,
  existing.status,
  existing.description
) is distinct from (
  excluded.label,
  excluded.category,
  excluded.badge_tone,
  excluded.source_groups,
  excluded.status,
  excluded.description
)
or not existing.metadata @> excluded.metadata;
