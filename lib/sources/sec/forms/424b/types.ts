export const PARSER_GROUP_424B = "424b";
export const PARSER_VERSION_424B = "424b-parser-v1";
export const FORM_SCOPE_424B = "424B family";
export const DISPLAY_PAYLOAD_VERSION_424B = "424b-display-payload-v1";

export const APPROVED_424B_EVENT_TYPES = [
  "ipo_listing",
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
  "other",
] as const;

export type Approved424bEventType = (typeof APPROVED_424B_EVENT_TYPES)[number];
export type DeliveryLevel = "archive" | "feed" | "alert";
export type SignalTone = "bullish" | "bearish" | "volatile" | "neutral";
export type ConfidenceLevel = "high" | "medium" | "low";
export type MarketScope = "company" | "sector" | "theme" | "macro";
export type DisplayType = "generic" | "offering_terms" | "candidate_special" | "spac_transaction_status";
export type DisplayPayloadVersion424b = typeof DISPLAY_PAYLOAD_VERSION_424B;

export interface Sec424bIssuer {
  name?: string | null;
  ticker?: string | null;
  exchange?: string | null;
}

export interface Sec424bAttachment {
  filename?: string;
  description?: string;
  text: string;
}

export interface Sec424bMarketContext {
  price?: number;
  previous_close?: number;
  market_cap?: number;
  shares_outstanding?: number;
  public_float?: number;
  volume?: number;
  avg_volume?: number;
  [key: string]: unknown;
}

export interface Sec424bParseInput {
  formType: string;
  accessionNumber?: string | null;
  issuer?: Sec424bIssuer;
  filingText: string;
  attachments?: Sec424bAttachment[];
  parentFilingContext?: Record<string, unknown>;
  marketContext?: Sec424bMarketContext;
  market_context?: Sec424bMarketContext;
}

export interface Sec424bFixtureInput extends Sec424bParseInput {
  name?: string;
  fixture_assertions?: Record<string, unknown>;
  expected_event_type?: Approved424bEventType;
  expected_score_band?: DeliveryLevel;
}

export interface EvidenceItem {
  label: string;
  value?: string | number | boolean | null;
  excerpt?: string;
  source?: string;
}

export interface Sec424bSecurityFact {
  securityType: string;
  amount?: number | null;
  maximumAggregateOfferingAmount?: number | null;
  pricePerSecurity?: number | null;
  source: string;
}

export interface Sec424bSignal {
  name: string;
  value: string | number | boolean | string[] | null;
  reason?: string;
  evidence?: EvidenceItem[];
}

export interface Sec424bCalendarItem {
  date: string;
  label: string;
  source: string;
}

export interface Sec424bSourceInventoryItem {
  filename: string | null;
  description: string | null;
  text_chars: number;
  material_hint: boolean;
}

export interface Sec424bParserOutput {
  parserVersion: string;
  parserGroup: typeof PARSER_GROUP_424B;
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: Record<string, unknown>;
  signals: Sec424bSignal[];
  calendarItems: Sec424bCalendarItem[];
  warnings: string[];
  raw: Record<string, unknown>;
}

export interface Sec424bAnalysisOutput {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: Approved424bEventType;
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
  signal: SignalTone;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: string[];
  calendar_items: Sec424bCalendarItem[];
  confidence: ConfidenceLevel;
  needs_human_review: boolean;
  analysis_action?: string | null;
  archive_summary?: string | null;
  offering_display_model?: Record<string, unknown>;
  offering_security_audit?: Record<string, unknown>;
}

export interface Sec424bDisplayPayload {
  display_type: DisplayType;
  display_version: DisplayPayloadVersion424b;
  data: Record<string, unknown>;
  evidence: EvidenceItem[];
  notes: string[];
}

export interface Sec424bFixtureExpected {
  expected_delivery_level: DeliveryLevel;
  expected_impact: "low" | "medium" | "high";
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
}

export interface Sec424bRoomResult {
  parser_output: Sec424bParserOutput;
  analysis_output: Sec424bAnalysisOutput;
  display_payload: Sec424bDisplayPayload;
  fixture_expected: Sec424bFixtureExpected;
}

export function isApproved424bEventType(
  value: string | null | undefined,
): value is Approved424bEventType {
  return APPROVED_424B_EVENT_TYPES.includes(value as Approved424bEventType);
}

export function deriveDeliveryLevel(score: number): DeliveryLevel {
  if (score >= 75) {
    return "alert";
  }

  if (score >= 50) {
    return "feed";
  }

  return "archive";
}

export function deriveExpectedImpact(score: number): "low" | "medium" | "high" {
  if (score >= 75) {
    return "high";
  }

  if (score >= 50) {
    return "medium";
  }

  return "low";
}
