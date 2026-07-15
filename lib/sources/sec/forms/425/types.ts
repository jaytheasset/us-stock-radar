export const SEC_425_PARSER_VERSION = "sec_425_parser_v2";
export const SEC_425_PARSER_GROUP = "425";

export const SEC_425_APPROVED_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "earnings",
  "sales_performance",
  "product_update",
  "leadership_governance",
  "insider_ownership",
  "shareholder_vote",
  "strategic_transaction",
  "financial_risk",
  "legal_risk",
  "dividends",
  "capital_return",
  "fda_clinical",
  "ipo_listing",
  "other",
] as const;

export const SEC_425_SIGNAL_VALUES = ["bullish", "bearish", "volatile", "neutral"] as const;
export const SEC_425_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_425_DELIVERY_LEVEL_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_425_DISPLAY_TYPE_VALUES = ["generic", "offering_terms", "candidate_special", "spac_transaction_status"] as const;
export const SEC_425_MARKET_SCOPE_VALUES = ["company", "sector", "theme", "macro"] as const;

export type Sec425ApprovedEventType = (typeof SEC_425_APPROVED_EVENT_TYPES)[number];
export type Sec425Signal = (typeof SEC_425_SIGNAL_VALUES)[number];
export type Sec425Confidence = (typeof SEC_425_CONFIDENCE_VALUES)[number];
export type Sec425DeliveryLevel = (typeof SEC_425_DELIVERY_LEVEL_VALUES)[number];
export type Sec425DisplayType = (typeof SEC_425_DISPLAY_TYPE_VALUES)[number];
export type Sec425MarketScope = (typeof SEC_425_MARKET_SCOPE_VALUES)[number];

export type Sec425Field = {
  value: string;
  evidence: string;
  confidence: Sec425Confidence;
};

export type Sec425SignalFact = {
  type: string;
  value: string;
  evidence: string;
  confidence: Sec425Confidence;
};

export type Sec425CalendarItem = {
  type: string;
  date: string;
  label: string;
  evidence: string;
};

export type Sec425AttachmentInput = {
  documentType?: string | null;
  description?: string | null;
  filename?: string | null;
  text?: string | null;
  isPrimary?: boolean | null;
  url?: string | null;
};

export const SEC_425_DOCUMENT_ROLE_VALUES = [
  "primary_425",
  "offer_letter",
  "press_release",
  "investor_presentation",
  "fact_sheet",
  "transaction_agreement",
  "agreement_amendment",
  "stockholder_agreement",
  "employment_agreement",
  "faq",
  "transcript",
  "stakeholder_communication",
  "meeting_notice",
  "regulatory_update",
  "social_media",
  "other",
] as const;

export type Sec425DocumentRole = (typeof SEC_425_DOCUMENT_ROLE_VALUES)[number];

export type Sec425SourceBlock = {
  block_id: string;
  block_type: string;
  source_ref: string;
  origin: "primary" | "attachment";
  document_index: number | null;
  document_type: string | null;
  document_role: Sec425DocumentRole;
  content_role: Sec425DocumentRole;
  exhibit_number: string | null;
  filename: string | null;
  url: string | null;
  heading: string | null;
  sequence: number;
  text: string;
  char_count: number;
  is_table: boolean;
  is_boilerplate: boolean;
};

export type Sec425SourceDocument = {
  source_ref: string;
  origin: "primary" | "attachment";
  document_index: number | null;
  document_type: string | null;
  document_role: Sec425DocumentRole;
  description: string | null;
  filename: string | null;
  url: string | null;
  is_primary: boolean;
  text_char_count: number;
  source_block_count: number;
};

export type Sec425MarketContext = {
  price?: number | null;
  previous_close?: number | null;
  market_cap?: number | null;
  shares_outstanding?: number | null;
  public_float?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
};

export type Sec425ParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  primaryDocumentUrl?: string | null;
  primaryDocumentFilename?: string | null;
  primaryDocumentDescription?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  formType?: string | null;
  accessionNumber?: string | null;
  companyName?: string | null;
  primaryTicker?: string | null;
  exchange?: string | null;
  filingText?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  attachments?: Sec425AttachmentInput[];
  market_context?: Sec425MarketContext | null;
  parent_filing_context?: Record<string, unknown> | null;
  expected?: {
    event_type?: Sec425ApprovedEventType;
    expected_delivery_level?: Sec425DeliveryLevel;
    deterministic?: boolean;
  };
  rawPayload?: unknown;
  metadata?: unknown;
};

export type Sec425DealFacts = {
  transaction_type: string | null;
  transaction_status: string | null;
  parties: string[];
  consideration_text: string | null;
  cash_component: string | null;
  stock_component: string | null;
  exchange_ratio: string | null;
  transaction_value: string | null;
  premium: string | null;
  expected_close: string | null;
  evidence: string[];
};

export type Sec425DocumentSummary = {
  document_type: string | null;
  description: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_truncated: boolean;
};

export type Sec425AmendmentFacts = {
  is_amendment_or_follow_up: boolean;
  amendment_number: number | null;
  amendment_title: string | null;
  amendment_date: string | null;
  original_agreement_date: string | null;
  amended_sections: string[];
  unchanged_remainder_language: string | null;
  evidence: string[];
};

export type Sec425VoteResult = {
  proposal: string;
  status: "approved" | "not_approved" | "unknown";
  votes_for: number | null;
  votes_against: number | null;
  abstentions: number | null;
  evidence: string;
};

export type Sec425VoteFacts = {
  meeting_date: string | null;
  record_date: string | null;
  reconvened_date: string | null;
  vote_recommendation: string | null;
  solicitation_present: boolean;
  adjourned: boolean;
  no_vote_conducted: boolean;
  quorum: string | null;
  voting_threshold: string | null;
  vote_results: Sec425VoteResult[];
  evidence: string[];
};

export type Sec425OfferFacts = {
  offer_type: "tender_offer" | "exchange_offer" | "public_exchange_offer" | null;
  is_hostile_or_unsolicited: boolean;
  subject_company: string | null;
  consideration: string | null;
  schedule_to_reference: boolean;
  form_s4_reference: boolean;
  consent_solicitation: boolean;
  evidence: string[];
};

export type Sec425SpacFacts = {
  is_spac_business_combination: boolean;
  spac_name: string | null;
  target_name: string | null;
  combined_company_name: string | null;
  expected_ticker: string | null;
  pre_money_valuation: string | null;
  equity_value: string | null;
  enterprise_value: string | null;
  pipe_amount: string | null;
  trust_cash: string | null;
  earnout_shares: string | null;
  warrant_terms: string | null;
  sponsor_transfer: string | null;
  redemption_risk: string | null;
  evidence: string[];
};

export type Sec425LegalFacts = {
  litigation_or_claims: string[];
  regulatory_risk: string[];
  injunction_or_delay_risk: string[];
};

export type Sec425FinancingFacts = {
  financing_risk: string[];
  financing_condition: string | null;
  going_concern_or_liquidity_risk: string[];
};

export type Sec425RawDataCandidate = {
  kind: string;
  value: string;
  context: string;
  source: "primary" | "attachment" | "combined";
  document_type: string | null;
  document_index: number | null;
  is_table: boolean;
  noise_hint: string | null;
};

export type Sec425SourceSection = {
  section_type: string;
  heading: string | null;
  text: string;
  source: "primary" | "attachment" | "combined";
  document_type: string | null;
  document_index: number | null;
  contains_transaction_language: boolean;
  contains_risk_relevant_language: boolean;
  is_boilerplate: boolean;
};

export type Sec425RawDataFacts = {
  signal_candidates: Sec425RawDataCandidate[];
  noise_candidates: Sec425RawDataCandidate[];
  table_rows: Sec425RawDataCandidate[];
  sections: Sec425SourceSection[];
  content_types: string[];
  candidate_text: string;
  parser_only_case: string | null;
  extraction_quality: {
    text_char_count: number;
    image_marker_count: number;
    image_document_count: number;
    pipe_table_marker_count: number;
    likely_extraction_failure: boolean;
    table_heavy_broken_text: boolean;
  };
};

export type Sec425ParserFacts = {
  company_name: string | null;
  primary_ticker: string | null;
  exchange: string | null;
  filed_by: string | null;
  subject_company: string | null;
  documents: Sec425DocumentSummary[];
  communication_types: string[];
  transaction_parties: string[];
  deal: Sec425DealFacts;
  amendment: Sec425AmendmentFacts;
  vote: Sec425VoteFacts;
  offer: Sec425OfferFacts;
  spac: Sec425SpacFacts;
  legal: Sec425LegalFacts;
  financing: Sec425FinancingFacts;
  boilerplate_markers: string[];
  no_new_material_info: boolean;
  material_change: boolean;
  deterministic_archive_reason: string | null;
  source_excerpts: string[];
  raw_data: Sec425RawDataFacts;
  market_context: Sec425MarketContext | null;
};

export type Sec425ParserOutput = {
  parserVersion: typeof SEC_425_PARSER_VERSION;
  parserGroup: typeof SEC_425_PARSER_GROUP;
  formType: "425";
  accessionNumber: string | null;
  isSupported: true;
  summary: string | null;
  facts: Sec425ParserFacts;
  signals: Sec425SignalFact[];
  calendarItems: Sec425CalendarItem[];
  warnings: string[];
  raw: {
    rawItemId: string | null;
    sourceUniqueId: string | null;
    sourceUrl: string | null;
    publishedAt: string | null;
    title: string | null;
    textStats: {
      filingTextChars: number;
      attachmentTextChars: number;
    };
    parentFilingContextPresent: boolean;
    cleaned_source_blocks: Sec425SourceBlock[];
    router_source_blocks: Sec425SourceBlock[];
    document_inventory: Sec425SourceDocument[];
  };
};

export type Sec425PrimaryTicker = {
  ticker: string | null;
  exchange: string | null;
};

export type Sec425AnalysisOutput = {
  source_group: "filings";
  market_scope: Sec425MarketScope;
  event_type: Sec425ApprovedEventType;
  event_title: string;
  primary_ticker: Sec425PrimaryTicker;
  tickers: Sec425PrimaryTicker[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: Sec425Signal;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: Sec425PrimaryTicker[];
  calendar_items: Sec425CalendarItem[];
  confidence: Sec425Confidence;
  needs_human_review: boolean;
};

export type Sec425DisplayPayload = {
  display_type: Sec425DisplayType;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
};

export type Sec425FixtureExpected = {
  expected_delivery_level: Sec425DeliveryLevel;
  expected_impact: "low" | "medium" | "high";
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
};

export type Sec425RoomResult = {
  parser_output: Sec425ParserOutput;
  analysis_output: Sec425AnalysisOutput;
  display_payload: Sec425DisplayPayload;
  fixture_expected: Sec425FixtureExpected;
};

export function isSec425ApprovedEventType(value: unknown): value is Sec425ApprovedEventType {
  return typeof value === "string" && SEC_425_APPROVED_EVENT_TYPES.includes(value as Sec425ApprovedEventType);
}

export function deliveryLevelFromScore(score: number): Sec425DeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}
