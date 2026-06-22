export const SC13_PARSER_VERSION = "sc13-v1";
export const SC13_PARSER_GROUP = "sc13";
export const SC13_ROOM_FORM_TYPE = "SC 13D / SC 13D/A, SC 13G / SC 13G/A";

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
export type ImpactLevel = "low" | "medium" | "high";
export type SignalDirection = "bullish" | "bearish" | "volatile" | "neutral";
export type Confidence = "high" | "medium" | "low";
export type DisplayType = "generic" | "offering_terms" | "candidate_special";
export type MarketScope = "company" | "sector" | "theme" | "macro";
export type ScheduleType = "13D" | "13G" | "unknown";
export type Sc13SourceFlavor = "plain_text" | "html" | "xml" | "rendered_xml" | "full_submission" | "mixed" | "unknown";
export type Sc13RuleBasis = "13d-1(b)" | "13d-1(c)" | "13d-1(d)";
export type OwnershipIntent = "active" | "passive" | "unknown";
export type PreliminaryAction = "archive" | "feed" | "alert" | "needs_analysis";

export interface SecPrimaryTicker {
  ticker: string | null;
  exchange: string | null;
}

export interface Sc13MarketContext {
  price?: number | null;
  previous_close?: number | null;
  market_cap?: number | null;
  shares_outstanding?: number | null;
  public_float?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
}

export interface Sc13OwnershipPower {
  sole: number | null;
  shared: number | null;
}

export interface Sc13ReportingPersonFact {
  name: string;
  citizenshipOrOrganization: string | null;
  sourceOfFunds: string | null;
  typeOfReportingPerson: string | null;
  sharesBeneficiallyOwned: number | null;
  percentOwned: number | null;
  votingPower: Sc13OwnershipPower;
  dispositivePower: Sc13OwnershipPower;
  groupCheckbox: {
    a: boolean | null;
    b: boolean | null;
  };
  excludesCertainShares: boolean | null;
  comments: string | null;
  rawSourceText?: string | null;
  rawValues?: {
    citizenshipOrOrganization?: string | null;
    sourceOfFunds?: string | null;
    typeOfReportingPerson?: string | null;
    sharesBeneficiallyOwned?: string | null;
    percentOwned?: string | null;
    soleVotingPower?: string | null;
    sharedVotingPower?: string | null;
    soleDispositivePower?: string | null;
    sharedDispositivePower?: string | null;
  };
}

export interface Sc13FilingInput {
  formType: string;
  accessionNumber?: string | null;
  issuerName?: string | null;
  companyName?: string | null;
  primaryTicker?: SecPrimaryTicker | null;
  filedAt?: string | null;
  text: string;
  attachments?: Array<Record<string, unknown>>;
}

export interface Sc13ParseContext {
  marketContext?: Sc13MarketContext | null;
  priorParserOutput?: Sc13ParserOutput | null;
  priorExhibitReferences?: Sc13ExhibitReference[] | null;
}

export interface Sc13ExhibitReference {
  label: string | null;
  normalizedLabel: string | null;
  title: string | null;
  source: "item7" | "body" | "attachment";
  sourceLocation: string | null;
  rawText: string;
  uncertain: boolean;
  agreementLike: boolean;
  matchedItem6: boolean;
}

export interface Sc13ExhibitComparison {
  added: Sc13ExhibitReference[];
  removed: Sc13ExhibitReference[];
  changedTitles: Array<{
    normalizedLabel: string;
    currentTitle: string | null;
    priorTitle: string | null;
  }>;
  item7Changed: boolean | null;
}

export interface Sc13KeywordHit {
  category: "governance" | "transaction" | "financing" | "legal" | "sales";
  keyword: string;
  source: "item3" | "item4" | "item5" | "item6" | "item7" | "item10" | "filing_text";
  evidence: string;
}

export interface Sc13CleanedSourceBlock {
  block_type:
    | "filing_metadata"
    | "source_inventory"
    | "cover_page"
    | "item_section"
    | "exhibit_reference"
    | "sales_table_source"
    | "parser_warning"
    | "site_context";
  title: string;
  source: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface Sc13Facts {
  sourceFlavor: Sc13SourceFlavor;
  sourceDocuments: Array<{
    type: string | null;
    filename: string | null;
    description: string | null;
    selectedPrimary: boolean;
  }>;
  issuerName: string | null;
  reportingPersons: string[];
  reportingPersonDetails: Sc13ReportingPersonFact[];
  hasMultipleReportingPersons: boolean;
  securityClass: string | null;
  cusip: string | null;
  primaryTicker: SecPrimaryTicker;
  scheduleType: ScheduleType;
  ruleBasis: Sc13RuleBasis | null;
  isAmendment: boolean;
  amendmentNumber: number | null;
  isExitFiling: boolean;
  finalAmendment: boolean;
  eventDate: string | null;
  filingDate: string | null;
  sharesBeneficiallyOwned: number | null;
  percentOwned: number | null;
  previousPercentOwned: number | null;
  ownershipPercentChange: number | null;
  votingPower: {
    sole: number | null;
    shared: number | null;
  };
  dispositivePower: {
    sole: number | null;
    shared: number | null;
  };
  ownershipIntent: OwnershipIntent;
  passiveCertification: boolean;
  ordinaryCourseCertification: boolean;
  sourceOfFunds: string | null;
  reportingPersonTypes: string[];
  item4Purpose: string | null;
  itemSections: {
    item1: string | null;
    item2: string | null;
    item3: string | null;
    item4: string | null;
    item5: string | null;
    item6: string | null;
    item7: string | null;
    item8: string | null;
    item9: string | null;
    item10: string | null;
  };
  item4HasActivistLanguage: boolean;
  item4KeywordHits: Sc13KeywordHit[];
  transactionKeywordHits: Sc13KeywordHit[];
  financingKeywordHits: Sc13KeywordHit[];
  legalKeywordHits: Sc13KeywordHit[];
  salesKeywordHits: Sc13KeywordHit[];
  strategicTransactionLanguage: boolean;
  legalRiskLanguage: boolean;
  financingLanguage: boolean;
  financingAmountUsd: number | null;
  salesPlanLanguage: boolean;
  salesTable: Array<{
    date: string | null;
    reportingPerson: string | null;
    sharesSold: number | null;
    priceRange: string | null;
    weightedAveragePrice: number | null;
  }>;
  ownershipTableIncorporatedByReference: boolean;
  jointFilingAgreement: boolean;
  ownershipCalculationNotes: string[];
  groupMembers: string[];
  exhibitReferences: Sc13ExhibitReference[];
  exhibitComparison: Sc13ExhibitComparison | null;
}

export interface ParserSignal {
  type: string;
  strength: "low" | "medium" | "high";
  message: string;
}

export interface CalendarItem {
  date: string;
  label: string;
  source: string;
}

export interface Sc13ParserOutput {
  parserVersion: string;
  parserGroup: "sc13";
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  cleaned_source_blocks: Sc13CleanedSourceBlock[];
  facts: Sc13Facts;
  signals: ParserSignal[];
  calendarItems: CalendarItem[];
  warnings: string[];
  raw: {
    sourceLength: number;
    sourceFlavor?: Sc13SourceFlavor;
    excerpts: Record<string, string | null>;
  };
}

export interface Sc13RouteDecision {
  event_type: ApprovedEventType;
  preliminary_action: PreliminaryAction;
  display_type: DisplayType;
  display_version: string;
  requires_analysis_llm: boolean;
  reason: string;
  confidence: Confidence;
  deterministic: boolean;
}

export interface AnalysisOutput {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: ApprovedEventType;
  event_title: string;
  primary_ticker: SecPrimaryTicker;
  tickers: SecPrimaryTicker[];
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: SignalDirection;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: SecPrimaryTicker[];
  calendar_items: CalendarItem[];
  confidence: Confidence;
  needs_human_review: boolean;
}

export interface DisplayPayload {
  display_type: DisplayType;
  display_version: string;
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

export interface RequiredFixtureResult {
  parser_output: Sc13ParserOutput;
  analysis_output: AnalysisOutput;
  display_payload: DisplayPayload;
  fixture_expected: FixtureExpected;
}

export interface Sc13Fixture {
  case_id: string;
  description: string;
  filing: Sc13FilingInput;
  market_context?: Sc13MarketContext | null;
  expected?: {
    event_type?: ApprovedEventType;
    deterministic?: boolean;
    score_band?: DeliveryLevel;
    extracted_facts?: Partial<Sc13Facts>;
  };
}
