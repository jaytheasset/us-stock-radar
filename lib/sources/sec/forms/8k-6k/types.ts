export const SEC_8K_6K_PARSER_VERSION = "sec_8k_6k_parser_v1";
export const SEC_8K_6K_PARSER_GROUP = "8k-6k";
export const SEC_8K_6K_FORM_SCOPE = "8-K / 6-K, 8-K/A / 6-K/A";

export const SEC_8K_6K_APPROVED_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "ipo_listing",
  "earnings",
  "sales_performance",
  "operating_update",
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
  "other",
] as const;

export type Sec8k6kEventType = (typeof SEC_8K_6K_APPROVED_EVENT_TYPES)[number];
export type Sec8k6kConfidence = "high" | "medium" | "low";
export type Sec8k6kSignal = "bullish" | "bearish" | "volatile" | "neutral";
export type Sec8k6kDeliveryLevel = "archive" | "feed" | "alert";
export type Sec8k6kDisplayType =
  | "generic"
  | "offering_terms"
  | "capital_financing"
  | "spac_transaction_status"
  | "candidate_special"
  | "strategic_transaction"
  | "governance_event"
  | "operating_event";

export type Sec8k6kAnalysisFamily =
  | "risk_status"
  | "capital_financing"
  | "strategic_transaction"
  | "governance_vote"
  | "operating_legal_routine";

export const SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES = [
  "equity_issuance",
  "share_linked_financing",
  "atm_capacity",
  "debt_liquidity",
  "capital_structure_action",
  "capital_return",
] as const;

export type Sec8k6kCapitalFinancingMode = (typeof SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES)[number];

export const SEC_8K_6K_FILING_CUE_TYPES = [
  "exchange_listing_notice",
  "securities_offering_or_issuance",
  "financial_results",
  "sales_or_operating_update",
  "product_or_commercial_update",
  "leadership_or_governance_change",
  "insider_or_control_update",
  "shareholder_vote_or_approval",
  "strategic_transaction_terms",
  "financial_distress_or_default",
  "legal_or_regulatory_proceeding",
  "dividend_declaration",
  "capital_return_authorization",
  "fda_or_clinical_update",
  "routine_administrative_amendment",
  "material_amendment_language",
  "uncategorized_text",
] as const;

export type Sec8k6kFilingCueType = (typeof SEC_8K_6K_FILING_CUE_TYPES)[number];

export type Sec8k6kParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  rawPayload?: unknown;
  metadata?: unknown;
  marketContext?: unknown;
  market_context?: unknown;
};

export type Sec8k6kDocumentSummary = {
  type: string | null;
  description: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_truncated: boolean;
  fetch_status: number | null;
  fetch_error: string | null;
};

export type Sec8k6kDocumentRoutingOutline = {
  source_ref: string;
  document_type: string | null;
  title: string | null;
  subtitle: string | null;
  lead_context: string[];
  section_headings: string[];
};

export type Sec8k6kField<T = string> = {
  value: T;
  evidence: string;
  confidence: Sec8k6kConfidence;
};

export type Sec8k6kMoneyValue = {
  amount: number | null;
  currency: "USD" | null;
  scale: "raw" | "thousand" | "million" | "billion" | null;
};

export type Sec8k6kMoneyField = Sec8k6kField<Sec8k6kMoneyValue> & {
  text: string;
};

export type Sec8k6kNumberField = Sec8k6kField<number | null> & {
  text: string;
};

export type Sec8k6kItem = {
  item: string;
  label: string;
  evidence: string;
};

export type Sec8k6kReferencedFiling = {
  formType: string;
  filedDate: string;
  accessionNumber: string | null;
  itemNumber: string | null;
  evidence: string;
  confidence: Sec8k6kConfidence;
};

export type Sec8k6kUnnumberedSection = {
  heading: string;
  evidence: string;
};

export type Sec8k6kFilingCue = {
  cueType: Sec8k6kFilingCueType;
  label: string;
  evidence: string;
  confidence: Sec8k6kConfidence;
  itemNumbers: string[];
};

export type Sec8k6kAmendmentInfo = {
  isAmendment: boolean;
  amendmentNumber: number | null;
  parentAccessionNumber: string | null;
  parentFiledDate: string | null;
  administrativeSignals: Sec8k6kField[];
  materialChangeSignals: Sec8k6kField[];
  isRoutineAdministrativeOnly: boolean;
  hasMaterialChangeLanguage: boolean;
  needsParentContext: boolean;
  excerpt: string | null;
};

export type Sec8k6kMarketContextCue = {
  fields: string[];
  reason: string;
  evidence: string;
  confidence: Sec8k6kConfidence;
};

export type Sec8k6kMarketContextFacts = {
  fields: string[];
  cues: Sec8k6kMarketContextCue[];
};

export type Sec8k6kCalendarItem = {
  label: string;
  dateText: string;
  evidence: string;
};

export type Sec8k6kSourceCue = Sec8k6kFilingCue;
export type Sec8k6kParserSignal = Sec8k6kFilingCue;

export type Sec8k6kParserFacts = {
  rawItemId: string | null;
  sourceUrl: string | null;
  filedAt: string | null;
  companyName: string | null;
  ticker: string | null;
  secFormType: "8-K" | "6-K" | "8-K/A" | "6-K/A" | null;
  isForeignIssuerReport: boolean;
  isAmendment: boolean;
  amendment: Sec8k6kAmendmentInfo;
  items: Sec8k6kItem[];
  referencedFilings: Sec8k6kReferencedFiling[];
  unnumberedSections?: Sec8k6kUnnumberedSection[];
  filingCues: Sec8k6kFilingCue[];
  sourceCues: Sec8k6kSourceCue[];
  moneyAmounts: Sec8k6kMoneyField[];
  shareCounts: Sec8k6kNumberField[];
  dates: Sec8k6kField[];
  marketContext: Sec8k6kMarketContextFacts;
  extracted: Record<string, unknown>;
  documents: Sec8k6kDocumentSummary[];
  documentRoutingOutlines: Sec8k6kDocumentRoutingOutline[];
  textStats: {
    bodyChars: number;
    analysisChars: number;
    combinedChars: number;
  };
};

export type Sec8k6kParserOutput = {
  parserVersion: typeof SEC_8K_6K_PARSER_VERSION;
  parserGroup: typeof SEC_8K_6K_PARSER_GROUP;
  formType: typeof SEC_8K_6K_FORM_SCOPE;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: Sec8k6kParserFacts;
  signals: Sec8k6kParserSignal[];
  calendarItems: Sec8k6kCalendarItem[];
  warnings: string[];
  raw: Record<string, unknown>;
};

export type Sec8k6kAnalysisOutput = {
  source_group: "filings";
  market_scope: "company" | "sector" | "theme" | "macro";
  event_type: Sec8k6kEventType;
  material_events?: Array<{
    role: "primary" | "secondary";
    event_type: Sec8k6kEventType;
    event_summary: string;
    key_terms: string[];
    source_block_ids: string[];
  }>;
  event_title: string;
  primary_ticker: {
    ticker: string | null;
    exchange: string | null;
  };
  tickers: string[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  score_explanation?: {
    summary: string;
  };
  signal: Sec8k6kSignal;
  quick_take: string;
  summary: string;
  listing_status_snapshot?: Array<{
    label: string;
    value: string;
    note: string | null;
  }>;
  why_it_matters?: string;
  bullish_points?: string[];
  bearish_points?: string[];
  key_evidence?: string[];
  what_to_watch_next?: string[];
  related_tickers?: string[];
  calendar_items?: Sec8k6kCalendarItem[];
  confidence: Sec8k6kConfidence;
  needs_human_review: boolean;
};

export type Sec8k6kDisplayPayload = {
  display_type: Sec8k6kDisplayType;
  data: Record<string, unknown>;
  evidence?: string[];
  notes?: string[];
};

export type Sec8k6kFixtureExpected = {
  expected_delivery_level: Sec8k6kDeliveryLevel;
  expected_impact: "low" | "medium" | "high";
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  analysis_family: Sec8k6kAnalysisFamily;
  expected_display_type: Sec8k6kDisplayType;
  expected_display_version: string;
  integration_notes: string[];
};

export type Sec8k6kRoomExpectedOutput = {
  parser_output: Sec8k6kParserOutput;
  analysis_output: Sec8k6kAnalysisOutput;
  display_payload: Sec8k6kDisplayPayload;
  fixture_expected: Sec8k6kFixtureExpected;
};

export function deriveSec8k6kDeliveryLevel(score: number): Sec8k6kDeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

export function isSec8k6kApprovedEventType(value: unknown): value is Sec8k6kEventType {
  return SEC_8K_6K_APPROVED_EVENT_TYPES.includes(value as Sec8k6kEventType);
}
