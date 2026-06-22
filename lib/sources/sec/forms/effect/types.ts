export const EFFECT_PARSER_VERSION = "effect-parser-v1";
export const EFFECT_PARSER_GROUP = "effect";

export const APPROVED_EVENT_TYPES = [
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

export type ApprovedEventType = (typeof APPROVED_EVENT_TYPES)[number];
export type DeliveryLevel = "archive" | "feed" | "alert";
export type DisplayType = "generic" | "offering_terms" | "candidate_special";
export type IpoKind = "traditional" | "spac";
export type ExpectedImpact = "low" | "medium" | "high";
export type FilingSignal = "bullish" | "bearish" | "volatile" | "neutral";
export type FilingConfidence = "high" | "medium" | "low";
export type MarketScope = "company" | "sector" | "theme" | "macro";

export interface EffectDocumentInput {
  documentType?: string | null;
  name?: string | null;
  url?: string | null;
  text?: string | null;
  html?: string | null;
}

export interface EffectParentFilingContext {
  formType?: string | null;
  accessionNumber?: string | null;
  registrationNumber?: string | null;
  filingDate?: string | null;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  eventType?: string | null;
  eventTitle?: string | null;
  ipoKind?: IpoKind | string | null;
  score?: number | null;
  analysisReference?: string | null;
  originalFilingReference?: string | null;
  summary?: string | null;
  shouldShowOriginalAnalysis?: boolean | null;
}

export interface EffectFilingInput {
  formType?: string | null;
  accessionNumber?: string | null;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  cik?: string | null;
  filingDate?: string | null;
  effectiveDate?: string | null;
  effectiveTime?: string | null;
  registrationNumber?: string | null;
  effectiveFilingForm?: string | null;
  relatedSubmissionType?: string | null;
  referenceAccessionNumber?: string | null;
  indexRegistrationForm?: string | null;
  headerRegistrationForm?: string | null;
  originalFilingReference?: string | null;
  text?: string | null;
  html?: string | null;
  documents?: EffectDocumentInput[];
  parentFilingContext?: EffectParentFilingContext | null;
  marketContext?: Record<string, unknown> | null;
}

export interface EffectFixtureInput {
  name?: string;
  filing: EffectFilingInput;
  parentFilingContext?: EffectParentFilingContext | null;
  marketContext?: Record<string, unknown> | null;
  expected?: Record<string, unknown>;
}

export type EffectParseInput = EffectFilingInput | EffectFixtureInput;

export interface EvidenceItem {
  label: string;
  value: string;
  source: string;
}

export interface CalendarItem {
  label: string;
  date: string;
  source: string;
}

export interface PrimaryTicker {
  ticker: string | null;
  exchange: string | null;
}

export interface EffectSeriesClassContract {
  seriesId: string | null;
  seriesName: string | null;
  classContractId: string | null;
  classContractName: string | null;
}

export interface EffectFilerFact {
  cik: string | null;
  entityName: string | null;
  fileNumber: string | null;
  seriesClassContract: EffectSeriesClassContract | null;
}

export interface EffectFacts {
  companyName: string | null;
  ticker: string | null;
  exchange: string | null;
  cik: string | null;
  filingDate: string | null;
  effectiveDate: string | null;
  effectiveTime: string | null;
  accessionNumber: string | null;
  registrationNumber: string | null;
  effectiveRegistrationReference: string | null;
  effectiveFilingForm: string | null;
  relatedSubmissionType: string | null;
  referenceAccessionNumber: string | null;
  originalFilingReference: string | null;
  originalAccessionNumber: string | null;
  originalAnalysisReference: string | null;
  filers: EffectFilerFact[];
  primaryFiler: EffectFilerFact | null;
  hasMultipleFilers: boolean;
  hasSeriesClassContractData: boolean;
  effectiveFormSource: string | null;
  effectiveDateSource: string | null;
  parentContextProvided: boolean;
  parentEventType: ApprovedEventType | null;
  parentEventTitle: string | null;
  parentIpoKind: IpoKind | null;
  parentFormType: string | null;
  parentAccessionNumber: string | null;
  parentRegistrationNumber: string | null;
  parentScore: number | null;
  originalAnalysisShouldBeShown: boolean;
  effectiveTargetClear: boolean;
  parentTargetMatch: boolean | null;
  parentTargetConflicts: string[];
  targetAmbiguityWarnings: string[];
  sourceExcerpts: EvidenceItem[];
}

export interface EffectParserOutput {
  parserVersion: string;
  parserGroup: "effect";
  formType: "EFFECT";
  accessionNumber: string | null;
  isSupported: true;
  summary: string | null;
  facts: EffectFacts;
  signals: string[];
  calendarItems: CalendarItem[];
  warnings: string[];
  raw: {
    sourceTextLength: number;
    documentCount: number;
    xmlDetected: boolean;
    headerDetected: boolean;
    parentFilingContextUsed: boolean;
    marketContextProvided: boolean;
  };
}

export interface EffectRouterDecision {
  deterministic: boolean;
  requiresLlm: boolean;
  eventType: ApprovedEventType;
  routeReason: string;
  preliminaryScore: number;
  preliminarySignal: FilingSignal;
  preliminaryConfidence: FilingConfidence;
  expectedImpact: ExpectedImpact;
  displayType: DisplayType;
  marketContextNeeded: boolean;
  marketContextReason: string | null;
  marketContextFields: string[];
  needsHumanReview: boolean;
}

export interface AnalysisOutput {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: ApprovedEventType;
  event_title: string;
  primary_ticker: PrimaryTicker;
  tickers: PrimaryTicker[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: FilingSignal;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: EvidenceItem[];
  what_to_watch_next: string[];
  related_tickers: string[];
  calendar_items: CalendarItem[];
  confidence: FilingConfidence;
  needs_human_review: boolean;
}

export interface EffectDisplayPayload {
  display_type: DisplayType;
  data: {
    effective_filing_form: string | null;
    ipo_kind: IpoKind | null;
    effective_registration_reference: string | null;
    effective_date: string | null;
    original_filing_reference: string | null;
  };
  evidence: EvidenceItem[];
  notes: string[];
}

export interface FixtureExpected {
  expected_delivery_level: DeliveryLevel;
  expected_impact: ExpectedImpact;
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
}

export interface EffectRequiredOutput {
  parser_output: EffectParserOutput;
  analysis_output: AnalysisOutput;
  display_payload: EffectDisplayPayload;
  fixture_expected: FixtureExpected;
}

export function isApprovedEventType(value: unknown): value is ApprovedEventType {
  return typeof value === "string" && APPROVED_EVENT_TYPES.includes(value as ApprovedEventType);
}

export function deliveryLevelForScore(score: number): DeliveryLevel {
  if (score >= 75) {
    return "alert";
  }

  if (score >= 50) {
    return "feed";
  }

  return "archive";
}
