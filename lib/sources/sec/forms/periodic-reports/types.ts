export const PERIODIC_REPORTS_PARSER_GROUP = "periodic-reports";
export const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";

export const SUPPORTED_PERIODIC_REPORT_FORMS = ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"] as const;

export type SupportedPeriodicReportForm = (typeof SUPPORTED_PERIODIC_REPORT_FORMS)[number];

export const APPROVED_SEC_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "ipo_listing",
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

export type ApprovedSecEventType = (typeof APPROVED_SEC_EVENT_TYPES)[number];

export const PERIODIC_REPORT_DISPLAY_TYPES = ["generic", "periodic_report", "offering_terms", "candidate_special"] as const;
export type PeriodicReportDisplayType = (typeof PERIODIC_REPORT_DISPLAY_TYPES)[number];

export type DeliveryLevel = "archive" | "feed" | "alert";
export type ImpactLevel = "low" | "medium" | "high";
export type SignalDirection = "bullish" | "bearish" | "volatile" | "neutral";
export type ConfidenceLevel = "high" | "medium" | "low";
export type MarketScope = "company" | "sector" | "theme" | "macro";

export type RawCoverageStatus = "present" | "missing" | "ambiguous" | "not_applicable";

export type RawEvidenceValue = string | number | boolean | string[] | number[] | null;

export type PeriodicRawEvidence = {
  id: string;
  category: string;
  label: string;
  value: RawEvidenceValue;
  evidence: string;
  source: string;
  locationHint: string | null;
  confidence: ConfidenceLevel;
};

export type PeriodicReportSection = {
  key: string;
  item: string;
  title: string;
  part: string | null;
  occurrenceCount: number;
  charCount: number;
  excerpt: string;
  source: "filing_text";
  confidence: ConfidenceLevel;
};

export type PeriodicReportContextSnippet = {
  id: string;
  topic: string;
  item: string | null;
  sectionKey: string | null;
  text: string;
  source: "primary_document_context";
  confidence: ConfidenceLevel;
};

export type PeriodicReportSecurity = {
  title: string | null;
  ticker: string | null;
  exchange: string | null;
  evidence: string;
  confidence: ConfidenceLevel;
};

export type PeriodicReportCoverageCheck = {
  id: string;
  label: string;
  status: RawCoverageStatus;
  reason: string;
  evidence: string | null;
  critical: boolean;
};

export type PeriodicReportNoiseCandidate = {
  id: string;
  category: string;
  label: string;
  reason: string;
  evidence: string;
  confidence: ConfidenceLevel;
};

export type PeriodicReportSourceDocument = {
  sequence: string | null;
  type: string | null;
  description: string | null;
  filename: string | null;
  url: string | null;
  isPrimary: boolean;
  hasText: boolean;
  textCharCount: number;
  textTruncated: boolean;
  isInlineXbrl: boolean;
  isMachineReadableXbrl: boolean;
  isLikelyBoilerplateExhibit: boolean;
  evidence: string;
};

export type PeriodicReportAttachmentText = {
  sequence: string | null;
  type: string | null;
  description: string | null;
  filename: string | null;
  url: string | null;
  textCharCount: number;
  textTruncated: boolean;
  includedInSourceText: boolean;
  evidence: string;
};

export type PeriodicReportXbrlFact = {
  name: string;
  label: string | null;
  value: string | number | boolean | null;
  unitRef: string | null;
  decimals: string | null;
  contextRef: string | null;
  period: string | null;
  statement: string | null;
  sourceDocument: string | null;
  evidence: string;
  confidence: ConfidenceLevel;
};

export type PeriodicReportSourcePackage = {
  documents: PeriodicReportSourceDocument[];
  attachmentTexts: PeriodicReportAttachmentText[];
  xbrlFacts: PeriodicReportXbrlFact[];
  documentCount: number;
  attachmentTextCount: number;
  xbrlFactCount: number;
  retainedXbrlFactCount: number;
  hasPrimaryDocument: boolean;
  hasInlineXbrlDocument: boolean;
  hasMachineReadableXbrlDocument: boolean;
  hasTruncatedSource: boolean;
};

export type PeriodicReportAmendmentFacts = {
  isAmendment: boolean;
  amendmentNumber: number | null;
  explanatoryNote: string | null;
  amendedItems: string[];
  routineIndicators: PeriodicRawEvidence[];
  restatementIndicators: PeriodicRawEvidence[];
  parentAccessionNumber: string | null;
  originalFilingDate: string | null;
  sourceEvidence: string[];
};

export type PeriodicReportCoverPageFacts = {
  companyName: string | null;
  formType: SupportedPeriodicReportForm | null;
  reportingPeriod: string | null;
  fiscalYear: string | null;
  fiscalQuarter: string | null;
  jurisdiction: string | null;
  filerStatus: string[];
  securities: PeriodicReportSecurity[];
};

export type PeriodicReportRawDataAudit = {
  missingCriticalRawData: boolean;
  hasPotentiallyUselessRawData: boolean;
  mustHaveChecks: PeriodicReportCoverageCheck[];
  noiseCandidates: PeriodicReportNoiseCandidate[];
  retainedEvidenceCount: number;
  notes: string[];
};

export type PeriodicReportFacts = {
  companyName: string | null;
  primaryTicker: string | null;
  exchange: string | null;
  reportingPeriod: string | null;
  fiscalYear: string | null;
  fiscalQuarter: string | null;
  isAnnualReport: boolean;
  isQuarterlyReport: boolean;
  isForeignIssuerAnnualReport: boolean;
  isAmendment: boolean;
  sourcePackage: PeriodicReportSourcePackage;
  coverPage: PeriodicReportCoverPageFacts;
  amendment: PeriodicReportAmendmentFacts;
  sections: PeriodicReportSection[];
  contextSnippets: PeriodicReportContextSnippet[];
  financialStatementLines: PeriodicRawEvidence[];
  highValueEvidence: PeriodicRawEvidence[];
  dateCandidates: PeriodicRawEvidence[];
  rawDataAudit: PeriodicReportRawDataAudit;
};

export type PeriodicReportSignal = {
  event_type: ApprovedSecEventType;
  signal_type: string;
  strength: ImpactLevel;
  summary: string;
  evidence: string;
  deterministic: boolean;
};

export type PeriodicReportCalendarItem = {
  item_type: string;
  date: string | null;
  description: string;
  evidence: string;
};

export type PeriodicParserOutput = {
  parserVersion: string;
  parserGroup: typeof PERIODIC_REPORTS_PARSER_GROUP;
  formType: SupportedPeriodicReportForm | typeof PERIODIC_REPORTS_FORM_SCOPE;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: PeriodicReportFacts;
  signals: PeriodicReportSignal[];
  calendarItems: PeriodicReportCalendarItem[];
  warnings: string[];
  raw: Record<string, unknown>;
};

export type PeriodicAnalysisOutput = {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: ApprovedSecEventType;
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
  scoring_assessment: {
    market_cap_tier: "micro" | "small" | "mid" | "large" | "mega" | "unknown";
    primary_change_severity: "routine" | "meaningful" | "strong" | "major" | "critical";
    operating_direction: "positive" | "negative" | "mixed" | "neutral" | "unknown";
    cash_flow_direction: "positive" | "negative" | "mixed" | "neutral" | "unknown";
    guidance_direction: "positive" | "negative" | "mixed" | "neutral" | "absent";
    earnings_quality: "high" | "mixed" | "low" | "unknown";
    material_offsets: string[];
    alert_driver: string | null;
  };
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
  report_ui: {
    snapshot_intro: string;
    snapshot_metrics: Array<{ label: string; value: string; note: string | null }>;
    performance_comparisons: Array<{
      label: string;
      current_label: string;
      current_value: string;
      current_numeric: number;
      comparison_label: string;
      comparison_value: string;
      comparison_numeric: number;
      comparison_basis: "yoy" | "qoq" | "other";
      change_note: string | null;
      change_tone: "improvement" | "deterioration" | "neutral";
    }>;
    guidance_metrics: Array<{
      label: string;
      guidance_label: string;
      guidance_value: string;
      performance_relationship: "same_basis" | "related_different_basis" | "standalone";
      performance_label: string | null;
      note: string | null;
    }>;
    key_business_updates: Array<{ title: string; value: string | null; summary: string }>;
  };
  related_tickers: string[];
  calendar_items: PeriodicReportCalendarItem[];
  confidence: ConfidenceLevel;
  needs_human_review: boolean;
};

export type PeriodicDisplayPayload = {
  display_type: PeriodicReportDisplayType;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
};

export type PeriodicFixtureExpected = {
  expected_delivery_level: DeliveryLevel;
  expected_impact: ImpactLevel;
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
};

export type PeriodicRoomResult = {
  parser_output: PeriodicParserOutput;
  analysis_output: PeriodicAnalysisOutput;
  display_payload: PeriodicDisplayPayload;
  fixture_expected: PeriodicFixtureExpected;
};

export function deriveDeliveryLevel(score: number): DeliveryLevel {
  if (score < 50) return "archive";
  if (score < 75) return "feed";
  return "alert";
}

export function isApprovedSecEventType(value: string): value is ApprovedSecEventType {
  return APPROVED_SEC_EVENT_TYPES.includes(value as ApprovedSecEventType);
}

export function isSupportedPeriodicReportForm(value: string | null): value is SupportedPeriodicReportForm {
  return SUPPORTED_PERIODIC_REPORT_FORMS.includes(value as SupportedPeriodicReportForm);
}
