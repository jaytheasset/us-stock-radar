export const SEC_TENDER_ROOM_FORM_TYPE = "Tender / CB / 13E3";
export const SEC_TENDER_PARSER_GROUP = "tender";
export const SEC_TENDER_DISPLAY_PAYLOAD_VERSION = "sec_tender_display_payload_v1";

export const SEC_TENDER_APPROVED_EVENT_TYPES = [
  "listing_risk",
  "ipo_listing",
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

export const SEC_TENDER_SCORE_BANDS = {
  archiveMaxExclusive: 50,
  feedMin: 50,
  alertMin: 75,
} as const;

export type SecTenderEventType = (typeof SEC_TENDER_APPROVED_EVENT_TYPES)[number];
export type SecTenderConfidence = "high" | "medium" | "low";
export type SecTenderSignal = "bullish" | "bearish" | "volatile" | "neutral";
export type SecTenderDeliveryLevel = "archive" | "feed" | "alert";
export type SecTenderMarketScope = "company" | "sector" | "theme" | "macro";
export type SecTenderDisplayType = "generic";

export type SecTenderField<T> = {
  value: T;
  evidence: string;
  confidence: SecTenderConfidence;
};

export type SecTenderMoneyValue = {
  amount: number | null;
  currency: "USD" | null;
  scale: "raw" | "thousand" | "million" | "billion" | null;
};

export type SecTenderMoneyField = SecTenderField<SecTenderMoneyValue> & {
  text: string;
};

export type SecTenderPriceField = SecTenderField<{
  price: number | null;
  currency: "USD" | null;
}> & {
  text: string;
};

export type SecTenderDateField = SecTenderField<{
  date: string | null;
  text: string;
}>;

export type SecTenderNoiseCategory =
  | "core_filing"
  | "offer_material"
  | "transaction_material"
  | "fairness_material"
  | "procedural_holder_form"
  | "filing_fee"
  | "graphic_asset"
  | "structured_data"
  | "generic_exhibit"
  | "other";

export type SecTenderLlmRelevance = "core" | "supporting" | "low" | "exclude_candidate";

export type SecTenderNoiseProfile = {
  category: SecTenderNoiseCategory;
  llm_relevance: SecTenderLlmRelevance;
  flags: string[];
  reason: string;
};

export type SecTenderDocumentSummary = {
  sequence: number | null;
  type: string | null;
  description: string | null;
  filename: string | null;
  role: string;
  noise_category: SecTenderNoiseCategory;
  llm_relevance: SecTenderLlmRelevance;
  noise_flags: string[];
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_available: boolean;
  text_truncated: boolean;
  fetch_status: number | null;
  fetch_error: string | null;
};

export type SecTenderAttachmentText = {
  type?: string | null;
  description?: string | null;
  text?: string | null;
};

export type SecTenderParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  rawPayload?: unknown;
  metadata?: unknown;
  attachmentTexts?: SecTenderAttachmentText[];
  parentFilingContext?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
};

export type SecTenderArchiveSubmissionInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  submissionText: string;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SecTenderParserOutput = {
  parserVersion: string;
  parserGroup: typeof SEC_TENDER_PARSER_GROUP;
  formType: typeof SEC_TENDER_ROOM_FORM_TYPE;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: Record<string, unknown>;
  signals: Array<Record<string, unknown>>;
  calendarItems: Array<Record<string, unknown>>;
  warnings: string[];
  raw: Record<string, unknown>;
};

export type SecTenderAnalysisOutput = {
  source_group: "filings";
  market_scope: SecTenderMarketScope;
  event_type: SecTenderEventType;
  event_title: string;
  primary_ticker: {
    ticker: string | null;
    exchange: string | null;
  };
  tickers: Array<Record<string, unknown>>;
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: SecTenderSignal;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: Array<Record<string, unknown>>;
  calendar_items: Array<Record<string, unknown>>;
  confidence: SecTenderConfidence;
  needs_human_review: boolean;
};

export type SecTenderDisplayPayload = {
  display_type: SecTenderDisplayType;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
};

export type SecTenderTransactionFingerprint = {
  transaction_family: "tender_offer" | "going_private" | "exchange_offer" | "cross_border" | "issuer_repurchase" | "other";
  transaction_type:
    | "issuer_tender"
    | "third_party_tender"
    | "going_private_cash_out"
    | "exchange_offer"
    | "merger_tender"
    | "final_results"
    | "amendment_update"
    | "other";
  target_company: string | null;
  target_ticker: string | null;
  buyer_parent: string | null;
  buyer_group: string[];
  offeror: string | null;
  filing_persons: string[];
  cash_price: string | null;
  exchange_ratio: string | null;
  consideration_summary: string | null;
  offer_size: string | null;
  securities_sought: string | null;
  minimum_condition: string | null;
  financing_condition: string | null;
  offer_expiration: string | null;
  final_result_date: string | null;
  merger_agreement_date: string | null;
  expected_closing: string | null;
  amendment_number: string | null;
  amendment_change_type:
    | "price_change"
    | "deadline_extension"
    | "final_results"
    | "financing_change"
    | "condition_change"
    | "procedural"
    | "no_material_change"
    | "unknown";
  material_terms_changed: string[];
  source_forms: string[];
  source_accession: string | null;
  source_evidence: string[];
};

export type SecTenderFixtureExpected = {
  expected_delivery_level: SecTenderDeliveryLevel;
  expected_impact: "low" | "medium" | "high";
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
};

export type SecTenderRequiredOutput = {
  analysis_output: SecTenderAnalysisOutput;
  display_payload: SecTenderDisplayPayload;
  transaction_fingerprint: SecTenderTransactionFingerprint;
};

export type SecTenderExpectedOutput = SecTenderRequiredOutput & {
  parser_output: SecTenderParserOutput;
  fixture_expected: SecTenderFixtureExpected;
};

export function secTenderDeliveryLevelForScore(score: number): SecTenderDeliveryLevel {
  if (score >= SEC_TENDER_SCORE_BANDS.alertMin) return "alert";
  if (score >= SEC_TENDER_SCORE_BANDS.feedMin) return "feed";
  return "archive";
}

export function isSecTenderApprovedEventType(value: string): value is SecTenderEventType {
  return SEC_TENDER_APPROVED_EVENT_TYPES.includes(value as SecTenderEventType);
}
