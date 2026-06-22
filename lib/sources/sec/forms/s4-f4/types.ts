export const S4_F4_PARSER_GROUP = "s4-f4";
export const S4_F4_PARSER_VERSION = "s4-f4-v1";
export const S4_F4_ROOM_LABEL = "S-4 / F-4 / S-4/A / F-4/A";

export const APPROVED_EVENT_TYPES = [
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
  "ipo_listing",
  "fda_clinical",
  "other",
] as const;

export type ApprovedEventType = (typeof APPROVED_EVENT_TYPES)[number];
export type DeliveryLevel = "archive" | "feed" | "alert";
export type ImpactLevel = "low" | "medium" | "high";
export type Signal = "bullish" | "bearish" | "volatile" | "neutral";
export type Confidence = "high" | "medium" | "low";
export type DisplayType = "generic" | "offering_terms" | "candidate_special" | "spac_transaction_status";
export type DisplayVersion =
  | "s4_f4_generic_v1"
  | "s4_f4_offering_terms_v1"
  | "s4_f4_candidate_special_v1"
  | "s4_f4_spac_transaction_status_v1";
export type IpoKind = "traditional" | "spac";
export type MarketScope = "company" | "sector" | "theme" | "macro";
export type S4F4AnalysisAction = "analysis_required";

export interface TickerRef {
  ticker: string | null;
  exchange: string | null;
}

export interface MarketContext {
  price?: number;
  previous_close?: number;
  market_cap?: number;
  shares_outstanding?: number;
  public_float?: number;
  volume?: number;
  avg_volume?: number;
}

export interface S4F4FixtureParticipant {
  name: string;
  ticker?: string | null;
  exchange?: string | null;
  role: "issuer" | "acquirer" | "target" | "counterparty" | "registrant";
}

export interface S4F4ParentFilingContext {
  accessionNumber: string;
  formType: "S-4" | "F-4" | "S-4/A" | "F-4/A";
  summary: string;
  terms?: Record<string, unknown>;
}

export type S4F4RuntimeParentFilingContext = S4F4ParentFilingContext | Record<string, unknown>;

export interface S4F4Fixture {
  id: string;
  description: string;
  formType: "S-4" | "F-4" | "S-4/A" | "F-4/A";
  accessionNumber: string | null;
  filingDate?: string;
  companyName: string;
  primaryTicker: TickerRef;
  participants: S4F4FixtureParticipant[];
  filingText: string;
  attachments?: Array<Record<string, unknown>>;
  market_context?: MarketContext | null;
  parentFilingContext?: S4F4RuntimeParentFilingContext | null;
}

export interface EvidenceItem {
  label: string;
  value: string;
  sourceText: string;
}

export interface CleanedSourceBlock {
  block_type:
    | "filing_metadata"
    | "document_inventory"
    | "primary_source_section"
    | "selected_exhibit_snippet"
    | "table_source_block"
    | "amendment_change_not_identified"
    | "ambiguous_source_block"
    | "source_noise_summary"
    | "source_availability"
    | "parser_warning"
    | "site_context";
  title: string;
  source: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ParserSignal {
  type:
    | "document_structure"
    | "exchange_offer"
    | "exhibits_only"
    | "strategic_transaction"
    | "shareholder_vote"
    | "dilution"
    | "legal"
    | "financial"
    | "material_amendment"
    | "routine_amendment"
    | "market_context";
  strength: "low" | "medium" | "high";
  description: string;
  evidence: EvidenceItem[];
}

export interface CalendarItem {
  date: string;
  label: string;
  type: "meeting" | "record_date" | "closing" | "deadline";
}

export type S4F4DocumentKind =
  | "merger_proxy_prospectus"
  | "spac_business_combination"
  | "exchange_offer"
  | "notes_exchange_offer"
  | "exhibits_only_amendment"
  | "unknown";

export type S4F4ExchangeOfferKind =
  | "equity_exchange"
  | "debt_exchange"
  | "debt_restructuring_exchange"
  | "mixed_restructuring"
  | "unknown";

export interface S4F4ExhibitFact {
  type: string;
  description: string;
  filedHerewith: boolean | null;
}

export type RawItemStatus = "present" | "missing" | "not_applicable" | "ambiguous" | "noise";

export interface RawItemCheck {
  item: string;
  label: string;
  status: RawItemStatus;
  confidence: Confidence;
  reason: string;
  evidence: EvidenceItem[];
}

export interface NoiseCandidate {
  item: string;
  count: number;
  reason: string;
  evidence: EvidenceItem[];
}

export type SourceAvailability =
  | "full_submission"
  | "primary_document"
  | "index_or_inventory_only"
  | "graphic_or_binary_only"
  | "empty_or_too_short"
  | "unknown";

export interface S4F4Facts {
  secFormType: string;
  isAmendment: boolean;
  companyName: string;
  primaryTicker: TickerRef;
  participants: S4F4FixtureParticipant[];
  structure: {
    documentKind: S4F4DocumentKind;
    isExhibitsOnly: boolean;
    bodyOmitted: boolean;
    hasProxyStatementProspectus: boolean;
    hasQuestionsAndAnswers: boolean;
    hasRiskFactors: boolean;
    hasProFormaFinancials: boolean;
    hasCoRegistrantTable: boolean;
  };
  transaction: {
    type:
      | "merger"
      | "share_exchange"
      | "exchange_offer"
      | "cross_border_business_combination"
      | "amendment_update"
      | "unknown";
    description: string | null;
    consideration: {
      cashPerShare: number | null;
      stockRatio: number | null;
      notes: string[];
    };
    registeredShares: number | null;
  };
  exchangeOffer: {
    present: boolean;
    kind: S4F4ExchangeOfferKind;
    oldSecurities: string[];
    newSecurities: string[];
    hasConsentSolicitation: boolean;
    hasRightsOffering: boolean;
    hasMakewholeAgreement: boolean;
    hasMinimumTenderCondition: boolean;
    hasWarrants: boolean;
    hasExternalProceedingMechanic: boolean;
  };
  vote: {
    required: boolean;
    meetingDate: string | null;
    recordDate: string | null;
    proposal: string | null;
  };
  amendment: {
    isAmendment: boolean;
    materialChange: boolean;
    routineAdministrative: boolean;
    changedSections: string[];
  };
  risk: {
    legalRisk: boolean;
    financialRisk: boolean;
    regulatoryApprovalRisk: boolean;
    appraisalRights: boolean;
    litigationMentioned: boolean;
  };
  dilution: {
    shareIssuanceMentioned: boolean;
      registeredShares: number | null;
      marketContextProvided: boolean;
  };
  exhibits: {
    count: number;
    filedHerewithCount: number;
    items: S4F4ExhibitFact[];
  };
  rawExtraction: {
    sourceAvailability: SourceAvailability;
    primaryTextChars: number;
    normalizedTextChars: number;
    requiredItems: RawItemCheck[];
    optionalItems: RawItemCheck[];
    missingRequiredItems: string[];
    ambiguousItems: string[];
    noiseCandidates: NoiseCandidate[];
    mustKeepItems: string[];
    shouldDropItems: string[];
  };
  evidence: EvidenceItem[];
}

export interface ParserOutput {
  parserVersion: string;
  parserGroup: typeof S4_F4_PARSER_GROUP;
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  cleaned_source_blocks: CleanedSourceBlock[];
  facts: S4F4Facts;
  signals: ParserSignal[];
  calendarItems: CalendarItem[];
  warnings: string[];
  raw: Record<string, unknown>;
}

export interface S4F4AnalysisPlan {
  event_type: ApprovedEventType;
  preliminary_action: S4F4AnalysisAction;
  display_type: DisplayType;
  display_version: DisplayVersion;
  requires_analysis: boolean;
  deterministic: boolean;
  reason: string;
  analysis_basis: string[];
  analysis_focus: string[];
}

export interface AnalysisOutput {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: ApprovedEventType;
  event_title: string;
  primary_ticker: TickerRef;
  tickers: TickerRef[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: Signal;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: TickerRef[];
  calendar_items: CalendarItem[];
  confidence: Confidence;
  needs_human_review: boolean;
}

export interface DisplayPayload {
  display_type: DisplayType;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}

export interface FixtureExpected {
  expected_delivery_level: DeliveryLevel;
  expected_impact: ImpactLevel;
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
}

export interface RequiredOutputJson {
  parser_output: ParserOutput;
  analysis_output: AnalysisOutput;
  display_payload: DisplayPayload;
  fixture_expected: FixtureExpected;
}

export function isApprovedEventType(value: string): value is ApprovedEventType {
  return APPROVED_EVENT_TYPES.includes(value as ApprovedEventType);
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
