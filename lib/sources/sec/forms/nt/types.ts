export const NT_APPROVED_EVENT_TYPES = [
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

export type NtApprovedEventType = (typeof NT_APPROVED_EVENT_TYPES)[number];

export const NT_PARSER_VERSION = "nt-parser-v1";
export const NT_PARSER_GROUP = "nt";

export type NtSupportedFormType = "NT 10-K" | "NT 10-Q" | "NT 20-F";
export type NtDeliveryLevel = "archive" | "feed" | "alert";
export type NtSignalTone = "bullish" | "bearish" | "volatile" | "neutral";
export type NtConfidence = "high" | "medium" | "low";

export interface NtFilingDocumentInput {
  type?: string | null;
  sequence?: string | number | null;
  filename?: string | null;
  document?: string | null;
  description?: string | null;
  text?: string | null;
  html?: string | null;
  isPrimary?: boolean | null;
}

export interface NtFilingInput {
  formType: string;
  filingText: string;
  primaryDocumentText?: string | null;
  documents?: NtFilingDocumentInput[];
  attachments?: NtFilingDocumentInput[];
  rawPayload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  accessionNumber?: string | null;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  periodOfReport?: string | null;
  filedAt?: string | null;
}

export interface NtParserOutput {
  parserVersion: string;
  parserGroup: "nt";
  formType: NtSupportedFormType;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: {
    companyName: string | null;
    ticker: string | null;
    exchange: string | null;
    sourceFormType: string;
    bodyFormType: string | null;
    submissionBodyFormMismatch: boolean;
    targetReportCheckboxGroup: {
      selectedReport: "10-K" | "10-Q" | "20-F" | null;
      selectedTransitionReport: "10-K" | "10-Q" | "20-F" | null;
      checkedReports: Array<"10-K" | "10-Q" | "20-F">;
      checkedTransitionReports: Array<"10-K" | "10-Q" | "20-F">;
      ambiguous: boolean;
      evidence: string[];
      confidence: NtConfidence;
    };
    checkedReports: Array<"10-K" | "10-Q" | "20-F">;
    delayedReport: "10-K" | "10-Q" | "20-F";
    periodOfReport: string | null;
    periodOfReportEvidence: string | null;
    filedAt: string | null;
    extensionDays: 5 | 15;
    isAmendment: boolean;
    amendmentPartialBody: boolean;
    amendmentNumber: string | null;
    amendmentPurpose: string | null;
    originalAccessionNumber: string | null;
    isTransitionReport: boolean;
    transitionReportType: "10-K" | "10-Q" | "20-F" | null;
    transitionPeriodEnded: string | null;
    transitionPeriodEndedEvidence: string | null;
    partIi: {
      rule12b25ReliefChecked: boolean | null;
      rule12b25ReliefEvidence: string | null;
      rule12b25ReliefConfidence: NtConfidence;
      unableWithoutUnreasonableEffortChecked: boolean | null;
      withinExtensionChecked: boolean | null;
      accountantStatementChecked: boolean | null;
    };
    partIv: {
      contact: {
        name: string | null;
        areaCode: string | null;
        telephoneNumber: string | null;
        rawContactLine: string | null;
        confidence: NtConfidence;
      };
      otherPeriodicReports: {
        answer: boolean | null;
        ambiguous: boolean;
        evidence: string | null;
        explanation: string | null;
        missingReportHints: string[];
        foundByFallback: boolean;
      };
      significantChange: {
        answer: boolean | null;
        ambiguous: boolean;
        evidence: string | null;
        explanation: string | null;
        quantitativeDisclosurePresent: boolean;
        foundByFallback: boolean;
      };
    };
    unableWithoutUnreasonableEffort: boolean | null;
    anticipatedWithinExtension: boolean | null;
    accountantStatementAttached: boolean | null;
    accountantStatementText: string | null;
    significantChangeExpected: boolean | null;
    significantChangeDescription: string | null;
    otherPeriodicReportsFiled: boolean | null;
    noRelianceOrRestatementDisclosed: boolean;
    lateFilingReason: string | null;
    partIiiNarrativeFlags: string[];
    portionOnly: {
      detected: boolean;
      itemWording: string | null;
      ambiguous: boolean;
      evidence: string | null;
    };
    electronicFilingDifficulty: {
      detected: boolean;
      primaryReason: boolean;
      evidence: string | null;
    };
    sourceTextFlags: string[];
    rawDataQuality: {
      requiredFieldsPresent: {
        formType: boolean;
        delayedReport: boolean;
        periodOfReport: boolean;
        partIiiNarrative: boolean;
        extensionExpectation: boolean;
        significantChangeAnswer: boolean;
      };
      missingCriticalFields: string[];
      ambiguousFields: string[];
      noiseCandidates: Array<{
        label: string;
        reason: string;
      }>;
    };
    sourceExcerpts: Array<{
      label: string;
      text: string;
    }>;
  };
  signals: Array<{
    name: string;
    sentiment: NtSignalTone;
    materiality: "low" | "medium" | "high";
    reason: string;
  }>;
  calendarItems: Array<{
    label: string;
    date: string | null;
    description: string;
  }>;
  warnings: string[];
  raw: {
    inputFormType: string;
    textExcerpt: string;
    selectedDocument?: {
      source: string;
      type: string | null;
      sequence: string | null;
      filename: string | null;
      description: string | null;
      confidence: NtConfidence;
      reason: string;
    };
    documentInventory?: Array<{
      source: string;
      type: string | null;
      sequence: string | null;
      filename: string | null;
      description: string | null;
      isPrimary: boolean;
      primaryCandidate: boolean;
      textCharCount: number;
      excludedReason: string | null;
    }>;
    sectionSegments?: {
      topBlock: string | null;
      partI: string | null;
      partII: string | null;
      partIII: string | null;
      partIV: string | null;
      signatureTail: string | null;
      confidence: NtConfidence;
      warnings: string[];
    };
    cleanedSourceBlocks?: Array<{
      block_type: string;
      label: string | null;
      source: string | null;
      text: string;
    }>;
  };
}

export interface NtAnalysisOutput {
  source_group: "filings";
  market_scope: "company" | "sector" | "theme" | "macro";
  event_type: NtApprovedEventType;
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
  score_explanation: {
    summary: string;
  };
  nt_scoring_assessment: {
    delay_status: string;
    underlying_issue: string;
    results_change: string;
    financial_reliability_risk: string;
    severity: string;
    material_offset: string | null;
    alert_driver: string | null;
  };
  signal: NtSignalTone;
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: string[];
  calendar_items: Array<{
    label: string;
    date: string | null;
    description: string;
  }>;
  confidence: NtConfidence;
  needs_human_review: boolean;
}

export interface NtDisplayPayload {
  display_type: "generic" | "offering_terms" | "candidate_special";
  display_version: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}

export interface NtFixtureExpected {
  expected_delivery_level: NtDeliveryLevel;
  expected_impact: "low" | "medium" | "high";
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
}

export interface NtRequiredOutputJson {
  parser_output: NtParserOutput;
  analysis_output: NtAnalysisOutput;
  display_payload: NtDisplayPayload;
  fixture_expected: NtFixtureExpected;
}

export function deriveNtDeliveryLevel(score: number): NtDeliveryLevel {
  if (score < 50) return "archive";
  if (score < 75) return "feed";
  return "alert";
}

export function isNtApprovedEventType(
  eventType: string,
): eventType is NtApprovedEventType {
  return NT_APPROVED_EVENT_TYPES.includes(eventType as NtApprovedEventType);
}
