export const S8_APPROVED_EVENT_TYPES = [
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

export type S8ApprovedEventType = (typeof S8_APPROVED_EVENT_TYPES)[number];

export type S8SignalSeverity = "low" | "medium" | "high";
export type S8DeliveryLevel = "archive" | "feed" | "alert";
export type S8Impact = "low" | "medium" | "high";
export type S8RouteAction = "finalize_archive" | "send_to_analysis";
export type S8NormalizedFilingType =
  | "initial_s8"
  | "general_instruction_e_additional_securities"
  | "post_effective_amendment"
  | "ambiguous_conflicting_s8_family";
export const S8_UI_MODES = [
  "plan_registration",
  "inducement_awards",
  "reoffer_resale",
  "post_effective_amendment",
] as const;
export type S8UiMode = (typeof S8_UI_MODES)[number];
export const S8_SNAPSHOT_METRIC_LABELS = [
  "Shares Outstanding",
  "Registered plan shares",
  "Plan Shares / Outstanding",
  "Plan Type",
  "Plan Name",
  "Immediate Dilution",
  "Vesting Period",
  "Registered inducement shares",
  "Inducement Shares / Outstanding",
  "Award Type",
  "Grant Date",
  "Recipient Count",
  "Reoffer resale shares",
  "Resale Shares / Outstanding",
  "Parent plan shares",
  "Parent Plan / Outstanding",
  "Reoffer subset",
  "Subset of Parent Plan",
  "Selling Holders",
  "Amendment Status",
  "Additional Shares",
  "Prior Shares Carried Forward",
  "Remaining Plan Shares Removed",
] as const;
export type S8SnapshotMetricLabel = (typeof S8_SNAPSHOT_METRIC_LABELS)[number];
export const S8_CONTEXT_DETAIL_LABELS = [
  "Parent filing",
  "Parent plan shares",
  "Reoffer subset",
  "Relationship",
  "Company proceeds",
  "Selling holders",
  "What changed",
  "What did not change",
] as const;
export type S8ContextDetailLabel = (typeof S8_CONTEXT_DETAIL_LABELS)[number];
export type S8Bucket =
  | "admin_archive"
  | "dilution_registration"
  | "material_dilution"
  | "reoffer_resale"
  | "parent_context_needed"
  | "parser_uncertain";
export type S8AnalysisReason =
  | "router_finalized_low_impact"
  | "router_finalized_administrative"
  | "materiality_analysis_needed"
  | "reoffer_resale_analysis_needed"
  | "parent_context_analysis_needed"
  | "parser_uncertainty_analysis_needed";

export type S8MarketContext = {
  price?: number | null;
  previous_close?: number | null;
  market_cap?: number | null;
  shares_outstanding?: number | null;
  public_float?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
};

export type S8Issuer = {
  name?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  sector?: string | null;
  industry_group?: string | null;
};

export type S8Attachment = {
  documentType?: string | null;
  description?: string | null;
  text?: string | null;
};

export type S8RawSourceDocument = {
  id: string;
  documentRole: "primary_filing" | "fee_exhibit" | "xbrl_fee_xml" | "reoffer_source" | "other_relevant_attachment";
  source: "primary" | "attachment";
  documentType: string | null;
  description: string | null;
  textKind: "normalized_text" | "raw_text";
  text: string;
};

export type S8NoiseCandidate = {
  label: "incorporation_by_reference" | "signature_block" | "legal_opinion" | "consent_exhibit" | "other_exhibit";
  source: "primary" | "attachment";
  documentType: string | null;
  description: string | null;
  reason: string;
};

export type S8FeeTableRow = {
  securityType: string | null;
  securityClassTitle: string | null;
  feeCalculationRule: string | null;
  amountRegisteredText?: string | null;
  amountRegistered: number | null;
  proposedMaximumOfferingPricePerUnitText?: string | null;
  proposedMaximumOfferingPricePerUnit: number | null;
  maximumAggregateOfferingPriceText?: string | null;
  maximumAggregateOfferingPrice: number | null;
  feeRateText?: string | null;
  feeRate: number | null;
  registrationFeeText?: string | null;
  registrationFee: number | null;
  footnotes?: string[];
  footnoteText?: string[];
  source?: "ex_filing_fees" | "primary_document" | "inline_xbrl" | "html_table" | "plain_text";
  confidence?: "high" | "medium" | "low";
  isPlanInterest?: boolean;
  hasRule416?: boolean;
  planNames?: string[];
  planMatchConfidence?: "direct" | "inferred";
};

export type S8PlanType =
  | "equity_incentive"
  | "employee_stock_purchase"
  | "stock_option"
  | "inducement"
  | "savings_retirement"
  | "unknown";

export type S8PlanNameFact = {
  name: string;
  planType: S8PlanType;
  sources: Array<
    | "cover"
    | "fee_table"
    | "fee_footnote"
    | "explanatory_note"
    | "primary_body"
    | "exhibit_index"
    | "legal_opinion"
    | "plan_exhibit"
  >;
  confidence: "high" | "medium" | "low";
};

export type S8PlanShareAllocation = {
  planName: string;
  shares: number | null;
  source:
    | "cover"
    | "explanatory_note"
    | "fee_table"
    | "fee_footnote"
    | "primary_body"
    | "exhibit_index"
    | "legal_opinion"
    | "plan_exhibit";
  confidence?: "high" | "medium" | "low";
  evidenceLevel?: "direct" | "inferred";
  feeRowIndex?: number | null;
  linkedPlanNames?: string[];
};

export type S8ConsultantAdvisorContextBucket =
  | "boilerplate_reference"
  | "plan_eligibility"
  | "actual_recipient_or_issuance"
  | "reoffer_or_resale_context"
  | "financing_or_promotion_related"
  | "unknown_context";

export type S8ConsultantAdvisorContext = {
  term: string;
  bucket: S8ConsultantAdvisorContextBucket;
  section: S8DetectedSection["key"] | "attachment" | "unknown";
  confidence: "high" | "medium" | "low";
  evidence: string;
};

export type S8PriorRegistrationStatement = {
  fileNumber: string;
  filedAt: string | null;
};

export type S8ReverseSplitAdjustment = {
  ratio: string;
  effectiveAt: string | null;
};

export type S8SellingSecurityholder = {
  name: string;
  relationship: string | null;
  relationshipHint?: "director" | "officer" | "employee" | "consultant" | "advisor" | "affiliate" | "former_officer" | "former_director" | "unknown";
  sharesOwnedBefore: number | null;
  percentOwnedBefore: string | null;
  sharesOffered: number | null;
  sharesOwnedAfter?: number | null;
  percentOwnedAfter?: string | null;
  sharesRegistered: number | null;
  footnotes?: string[];
  footnoteText?: string[];
  source?: "fixture_row" | "html_table" | "plain_text";
  confidence?: "high" | "medium" | "low";
};

export type S8DetectedSection = {
  key:
    | "cover_page"
    | "explanatory_note"
    | "part_i"
    | "part_ii"
    | "reoffer_prospectus"
    | "resale_prospectus"
    | "selling_holders"
    | "exhibit_index"
    | "signatures";
  heading: string;
  start: number;
  end: number | null;
  confidence: "high" | "medium" | "low";
};

export type S8InducementAward = {
  awardType: string;
  shares: number;
  recipientCount: number | null;
  grantedAt: string | null;
};

export type S8ParentFilingContext = {
  accessionNumber?: string | null;
  formType?: string | null;
  filedAt?: string | null;
  registeredShares?: number | null;
  planNames?: string[];
  summary?: string | null;
};

export type S8FixtureInput = {
  fixtureName: string;
  formType: string;
  accessionNumber?: string | null;
  filedAt?: string | null;
  issuer?: S8Issuer;
  filingText: string;
  attachments?: S8Attachment[];
  parentFilingContext?: S8ParentFilingContext | null;
  marketContext?: S8MarketContext | null;
  flowExpectation?: {
    parserCanFinishWithoutLlm?: boolean;
    routerCanFinishWithoutLlm?: boolean;
    reason?: string;
  };
};

export type S8Signal = {
  type: string;
  severity: S8SignalSeverity;
  message: string;
  evidence: string[];
};

export type S8DisplayPayload = {
  display_type: "generic" | "offering_terms" | "candidate_special";
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
};

export type S8ParserOutput = {
  parserVersion: string;
  parserGroup: "s8";
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: {
    issuerName: string | null;
    ticker: string | null;
    exchange: string | null;
    filedAt: string | null;
    isAmendment: boolean;
    amendmentType: string | null;
    planNames: string[];
    planNameFacts?: S8PlanNameFact[];
    planExtractionConfidence?: "high" | "medium" | "low";
    planExtractionWarnings?: string[];
    securityType: string | null;
    registeredShares: number | null;
    additionalShares: number | null;
    parentRegisteredShares: number | null;
    estimatedOfferingAmount: number | null;
    registrationFee: number | null;
    feeTableRows?: S8FeeTableRow[];
    planShareAllocations?: S8PlanShareAllocation[];
    priorRegistrationStatements?: S8PriorRegistrationStatement[];
    reverseSplitAdjustments?: S8ReverseSplitAdjustment[];
    reofferProspectus?: boolean;
    reofferShares?: number | null;
    reofferNoIssuerProceeds?: boolean;
    sellingSecurityholders?: S8SellingSecurityholder[];
    inducementAwards?: S8InducementAward[];
    inducementAwardTotalShares?: number | null;
    generalInstructionE?: boolean;
    correctionOnly?: boolean;
    filingProvidedPrice?: {
      price: number;
      pricedAt: string | null;
      source: string;
    } | null;
    dilutionPercentOfSharesOutstanding: number | null;
    dilutionPercentOfPublicFloat: number | null;
    noAdditionalSecurities: boolean;
    exhibitOnly: boolean;
    signatureOnly: boolean;
    needsParentComparison: boolean;
    normalizedS8Type?: S8NormalizedFilingType;
    s8FamilyDetected?: boolean;
    likelyFeeTableMaterial?: boolean;
    exFilingFeesExhibit?: boolean;
    feeTableSource?: "ex_filing_fees" | "primary_document" | "mixed" | "not_found";
    feeTableExtractionConfidence?: "high" | "medium" | "low";
    feeTableWarnings?: string[];
    feeTablePurposeConflicts?: string[];
    rule416?: boolean;
    planInterests?: boolean;
    unusualFeeTableSecurities?: boolean;
    postEffectiveAmendment?: boolean;
    deregistrationOfUnsoldSecurities?: boolean;
    resaleProspectus?: boolean;
    sellingHolderSection?: boolean;
    sellingHolderExtractionConfidence?: "high" | "medium" | "low";
    sellingHolderWarnings?: string[];
    rule144InResaleContext?: boolean;
    controlSecurities?: boolean;
    restrictedSecurities?: boolean;
    rule144?: boolean;
    consultantAdvisorServiceProvider?: boolean;
    consultantAdvisorContexts?: S8ConsultantAdvisorContext[];
    consultantAdvisorContextConfidence?: "high" | "medium" | "low";
    consultantAdvisorContextWarnings?: string[];
    investorRelationsPromotionalFinancingServices?: boolean;
    shellReverseMergerDelinquentFiler?: boolean;
    s8PosRegistersAdditionalSecurities?: boolean;
    sectionExtractionConfidence?: "high" | "medium" | "low";
  };
  signals: S8Signal[];
  calendarItems: unknown[];
  warnings: string[];
  raw: {
    sourceTextExcerpt: string;
    sourceDocuments: S8RawSourceDocument[];
    noiseCandidates: S8NoiseCandidate[];
    attachments: S8Attachment[];
    parentFilingContext: S8ParentFilingContext | null;
    marketContext: S8MarketContext | null;
    extractedShareCounts: number[];
    sections?: S8DetectedSection[];
  };
};

export type S8RouterDecision = {
  parserGroup: "s8";
  route_action: S8RouteAction;
  event_type: S8ApprovedEventType;
  s8_bucket: S8Bucket;
  analysis_reason: S8AnalysisReason;
  score_hint: number;
  reason: string;
  evidence: string[];
  final_output?: {
    analysis_output: S8AnalysisOutput;
    display_payload: S8DisplayPayload;
  };
};

export type S8AnalysisOutput = {
  source_group: "filings";
  market_scope: "company" | "sector" | "theme" | "macro";
  event_type: S8ApprovedEventType;
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
  signal: "bullish" | "bearish" | "volatile" | "neutral";
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: string[];
  calendar_items: unknown[];
  confidence: "high" | "medium" | "low";
  needs_human_review: boolean;
};

export type S8RequiredFixtureOutput = {
  parser_output: S8ParserOutput;
  analysis_output: S8AnalysisOutput;
  display_payload: S8DisplayPayload;
  fixture_expected: {
    expected_delivery_level: S8DeliveryLevel;
    expected_impact: S8Impact;
    market_context_needed: boolean;
    market_context_reason: string | null;
    market_context_fields: string[];
    special_ui_needed: boolean;
    special_ui_reason: string | null;
    integration_notes: string[];
  };
};

export function scoreToS8DeliveryLevel(score: number): S8DeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

export function isS8ApprovedEventType(value: string): value is S8ApprovedEventType {
  return S8_APPROVED_EVENT_TYPES.includes(value as S8ApprovedEventType);
}
