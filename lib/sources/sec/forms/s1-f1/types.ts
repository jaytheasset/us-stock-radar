export const S1F1_PARSER_VERSION = "s1-f1-parser-v1";
export const S1F1_PARSER_GROUP = "s1-f1";
export const S1F1_ROOM_FORM_SCOPE = "S-1 / F-1, S-1/A / F-1/A";

export const APPROVED_SEC_EVENT_TYPES = [
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

export type SecEventType = (typeof APPROVED_SEC_EVENT_TYPES)[number];

export type DeliveryLevel = "archive" | "feed" | "alert";
export type SignalDirection = "bullish" | "bearish" | "volatile" | "neutral";
export type ConfidenceLevel = "high" | "medium" | "low";
export type MarketScope = "company" | "sector" | "theme" | "macro";
export type DisplayType = "generic" | "offering_terms" | "candidate_special" | "spac_transaction_status";
export type ImpactLevel = "low" | "medium" | "high";
export type SignalSeverity = "low" | "medium" | "high";
export type S1F1DocumentBucket = "body" | "important_exhibit" | "noise";
export type S1F1DocumentKind =
  | "main_filing"
  | "filing_fee_exhibit"
  | "legal_opinion"
  | "tax_opinion"
  | "auditor_consent"
  | "legal_consent"
  | "material_contract"
  | "underwriting_agreement"
  | "placement_agency_agreement"
  | "selling_agency_agreement"
  | "distribution_agreement"
  | "lock_up_agreement"
  | "registration_rights_agreement"
  | "warrant_agreement"
  | "pre_funded_warrant_agreement"
  | "rights_agreement"
  | "indenture"
  | "note_purchase_agreement"
  | "convertible_note_agreement"
  | "loan_agreement"
  | "credit_agreement"
  | "lease_agreement"
  | "employment_agreement"
  | "consulting_agreement"
  | "service_agreement"
  | "acquisition_agreement"
  | "merger_agreement"
  | "deposit_agreement"
  | "ads_related_exhibit"
  | "charter_bylaws"
  | "charter"
  | "bylaws"
  | "memorandum_and_articles"
  | "subsidiary_list"
  | "power_of_attorney"
  | "other_exhibit"
  | "other_document";
export type S1F1FilingVariant =
  | "base_registration"
  | "pre_effective_amendment"
  | "post_effective_amendment"
  | "rule_462b_mef"
  | "unknown";
export type S1F1PostEffectivePurpose =
  | "deregistration"
  | "limited_update"
  | "prospectus_update"
  | "unknown";

export interface S1F1Evidence {
  label: string;
  excerpt: string;
  source: "filing_text" | "metadata" | "parent_filing_context" | "market_context_fixture";
}

export interface S1F1Signal {
  event_type: SecEventType;
  label: string;
  severity: SignalSeverity;
  signal: SignalDirection;
  evidence: S1F1Evidence[];
  deterministic?: boolean;
}

export interface S1F1CalendarItem {
  label: string;
  date: string | null;
  evidence: S1F1Evidence[];
}

export interface S1F1MarketContext {
  price?: number;
  previous_close?: number;
  market_cap?: number;
  shares_outstanding?: number;
  public_float?: number;
  volume?: number;
  avg_volume?: number;
}

export interface S1F1DocumentFilterItem {
  sequence: number | null;
  type: string;
  filename: string | null;
  description: string | null;
  documentKind?: S1F1DocumentKind;
  isMainDocument?: boolean;
  confidence?: ConfidenceLevel;
  bucket: S1F1DocumentBucket;
  reason: string;
  included: boolean;
  sourceTextLength: number;
  textLength: number;
  includedTextLength: number;
  snippets: Array<{
    label: string;
    text: string;
  }>;
}

export interface S1F1DocumentBlock {
  order: number;
  documentSequence: number | null;
  documentType: string;
  filename: string | null;
  tag: string;
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isCentered: boolean;
  isAllCaps: boolean;
  isTitleCase: boolean;
  isStandalone: boolean;
  insideTable: boolean;
  isTableHeaderCell: boolean;
  isTableRowLabel: boolean;
  anchorHint: string | null;
  styleHints: string[];
  tableId: number | null;
  rowIndex: number | null;
  cellIndex: number | null;
}

export interface S1F1DocumentTable {
  id: number;
  order: number;
  documentSequence: number | null;
  documentType: string;
  filename: string | null;
  caption: string | null;
  headerRows: string[][];
  rows: string[][];
  text: string;
}

export interface S1F1MainDocumentSelection {
  sequence: number | null;
  type: string;
  filename: string | null;
  description: string | null;
  reason: string;
  confidence: ConfidenceLevel;
  candidateCount: number;
}

export interface S1F1DocumentFilterSummary {
  detectedCompleteSubmission: boolean;
  originalTextLength: number;
  filteredTextLength: number;
  documentCount: number;
  bodyCount: number;
  importantExhibitCount: number;
  noiseCount: number;
  mainDocument?: S1F1MainDocumentSelection | null;
  warnings?: string[];
  blocks?: S1F1DocumentBlock[];
  tables?: S1F1DocumentTable[];
  items: S1F1DocumentFilterItem[];
}

export interface S1F1DetectedSection {
  key: string;
  title: string;
  heading: string;
  lineIndex: number;
  confidence: ConfidenceLevel;
  excerpt: string;
  tocHint?: boolean;
  source?: "dom_block" | "line";
  score?: number;
  blockOrder?: number | null;
  insideTable?: boolean;
}

export interface S1F1SectionTable {
  tableId: number;
  sectionKey: string | null;
  sectionTitle: string | null;
  text: string;
}

export interface S1F1SectionDetection {
  sections: S1F1DetectedSection[];
  tocHints: S1F1DetectedSection[];
  warnings: string[];
  tables?: S1F1SectionTable[];
}

export interface S1F1RiskFactorsStructure {
  sectionDetected: boolean;
  categoryHeadings: string[];
  riskFactorHeadings: string[];
  groups?: Array<{
    category: string | null;
    headings: string[];
  }>;
  headingCount: number;
}

export interface S1F1ForeignIssuerPhraseHit {
  phrase: string;
  excerpt: string;
}

export interface S1F1ExtractionCandidate {
  label: string;
  value: string;
  normalizedValue?: number | null;
  unit?: string | null;
  evidence: string;
  confidence: ConfidenceLevel;
  isPlaceholder?: boolean;
  isAssumed?: boolean;
}

export interface S1F1ExtractedTableRow {
  tableId: number;
  sectionKey: string | null;
  label: string;
  cells: string[];
  text: string;
}

export interface S1F1OfferingTermsExtraction {
  formType: string;
  offeringTypes: string[];
  securities: string[];
  primaryOfferingLanguage: S1F1ExtractionCandidate[];
  resaleOfferingLanguage: S1F1ExtractionCandidate[];
  shareCountCandidates: S1F1ExtractionCandidate[];
  adsRatioCandidates: S1F1ExtractionCandidate[];
  assumedOfferingPriceCandidates: S1F1ExtractionCandidate[];
  priceRangeCandidates: S1F1ExtractionCandidate[];
  proposedMaximumAggregateOfferingCandidates: S1F1ExtractionCandidate[];
  estimatedGrossProceedsCandidates: S1F1ExtractionCandidate[];
  estimatedNetProceedsCandidates: S1F1ExtractionCandidate[];
  underwritingDiscountCandidates: S1F1ExtractionCandidate[];
  overAllotmentCandidates: S1F1ExtractionCandidate[];
  distributionMethodLanguage: S1F1ExtractionCandidate[];
  tickerCandidates: S1F1ExtractionCandidate[];
  exchangeCandidates: S1F1ExtractionCandidate[];
  noPublicMarketLanguage: S1F1ExtractionCandidate[];
  sellingStockholderLanguage: S1F1ExtractionCandidate[];
  warnings: string[];
}

export interface S1F1UseOfProceedsExtraction {
  sectionDetected: boolean;
  grossProceedsCandidates: S1F1ExtractionCandidate[];
  netProceedsCandidates: S1F1ExtractionCandidate[];
  offeringExpenseCandidates: S1F1ExtractionCandidate[];
  useCategories: S1F1ExtractionCandidate[];
  noIssuerProceedsLanguage: S1F1ExtractionCandidate[];
  sellingHolderProceedsLanguage: S1F1ExtractionCandidate[];
  placeholderCandidates: S1F1ExtractionCandidate[];
  tableRows: S1F1ExtractedTableRow[];
  warnings: string[];
}

export interface S1F1CapitalizationExtraction {
  sectionDetected: boolean;
  unitLabels: string[];
  columnLabels: string[];
  tableRows: S1F1ExtractedTableRow[];
  rowCandidates: S1F1ExtractionCandidate[];
  shareCountCandidates: S1F1ExtractionCandidate[];
  conversionLanguage: S1F1ExtractionCandidate[];
  shareSplitLanguage: S1F1ExtractionCandidate[];
  adsPresentationLanguage: S1F1ExtractionCandidate[];
  warnings: string[];
}

export interface S1F1DilutionExtraction {
  sectionDetected: boolean;
  offeringPriceCandidates: S1F1ExtractionCandidate[];
  assumedOfferingPriceCandidates: S1F1ExtractionCandidate[];
  netTangibleBookValueCandidates: S1F1ExtractionCandidate[];
  increaseAttributableCandidates: S1F1ExtractionCandidate[];
  dilutionPerShareCandidates: S1F1ExtractionCandidate[];
  dilutionPercentageCandidates: S1F1ExtractionCandidate[];
  ownershipPercentageCandidates: S1F1ExtractionCandidate[];
  shareCountCandidates: S1F1ExtractionCandidate[];
  adsRatioCandidates: S1F1ExtractionCandidate[];
  placeholderCandidates: S1F1ExtractionCandidate[];
  tableRows: S1F1ExtractedTableRow[];
  warnings: string[];
}

export interface S1F1SectionExtractions {
  offeringTerms: S1F1OfferingTermsExtraction;
  useOfProceeds: S1F1UseOfProceedsExtraction;
  capitalization: S1F1CapitalizationExtraction;
  dilution: S1F1DilutionExtraction;
}

export interface S1F1FinancialStatementTableInventoryItem {
  tableId: number;
  classification:
    | "balance_sheet"
    | "statements_of_operations"
    | "statements_of_comprehensive_income_loss"
    | "stockholders_equity"
    | "cash_flows"
    | "notes"
    | "summary_financial_data"
    | "selected_financial_data"
    | "other_financial_statement";
  title: string | null;
  sectionKey: string | null;
  periodColumns: string[];
  auditedStatus: "audited" | "unaudited" | "mixed" | "unclear";
  currency: string | null;
  unit: string | null;
  rows: S1F1ExtractedTableRow[];
  warnings: string[];
}

export interface S1F1FinancialLineItem {
  statementType: string;
  tableId: number | null;
  label: string;
  rowLabel: string;
  columns: string[];
  values: string[];
  evidence: string;
  source: "mda_text" | "financial_statement_table";
  confidence: ConfidenceLevel;
}

export interface S1F1MdaExtraction {
  sectionDetected: boolean;
  sectionKey: string | null;
  subsectionHeadings: string[];
  lineItems: S1F1FinancialLineItem[];
  liquidityPhrases: S1F1ExtractionCandidate[];
  warnings: string[];
}

export interface S1F1LiquidityPhraseInventory {
  phrases: Array<S1F1ExtractionCandidate & { sectionKey: string | null }>;
  warnings: string[];
}

export interface S1F1NoteTopicInventory {
  topics: Array<S1F1ExtractionCandidate & { topic: string; sourceLocation: "paragraph" | "table"; sectionKey: string | null }>;
  warnings: string[];
}

export interface S1F1AuditorAccountingExtraction {
  auditorNameCandidates: S1F1ExtractionCandidate[];
  auditorReportTitleCandidates: S1F1ExtractionCandidate[];
  auditOpinionDateCandidates: S1F1ExtractionCandidate[];
  pcaobPhrases: S1F1ExtractionCandidate[];
  goingConcernParagraphs: S1F1ExtractionCandidate[];
  auditedFinancialStatementPhrases: S1F1ExtractionCandidate[];
  unauditedInterimPhrases: S1F1ExtractionCandidate[];
  accountingBasisPhrases: S1F1ExtractionCandidate[];
  reportingCurrencyCandidates: S1F1ExtractionCandidate[];
  functionalCurrencyCandidates: S1F1ExtractionCandidate[];
  warnings: string[];
}

export interface S1F1FinancialExtractions {
  mda: S1F1MdaExtraction;
  financialStatementTables: S1F1FinancialStatementTableInventoryItem[];
  financialLineItems: S1F1FinancialLineItem[];
  liquidity: S1F1LiquidityPhraseInventory;
  notes: S1F1NoteTopicInventory;
  auditorAndAccounting: S1F1AuditorAccountingExtraction;
  warnings: string[];
}

export interface S1F1ContextualCandidate extends S1F1ExtractionCandidate {
  sectionKey: string | null;
}

export interface S1F1TableExtraction {
  sectionDetected: boolean;
  tableRows: S1F1ExtractedTableRow[];
  columnLabels: string[];
  warnings: string[];
}

export interface S1F1RelatedPartyExtraction extends S1F1TableExtraction {
  negativeDisclosure: S1F1ContextualCandidate[];
  partyNameCandidates: S1F1ContextualCandidate[];
  relationshipCandidates: S1F1ContextualCandidate[];
  transactionTypeCandidates: S1F1ContextualCandidate[];
  amountCandidates: S1F1ContextualCandidate[];
  interestRateCandidates: S1F1ContextualCandidate[];
  maturityCandidates: S1F1ContextualCandidate[];
  conversionCandidates: S1F1ContextualCandidate[];
  forgivenessCandidates: S1F1ContextualCandidate[];
  outstandingBalanceCandidates: S1F1ContextualCandidate[];
  policyLanguage: S1F1ContextualCandidate[];
  crossSectionHints: S1F1ContextualCandidate[];
}

export interface S1F1LegalProceedingsExtraction extends S1F1TableExtraction {
  negativeDisclosure: S1F1ContextualCandidate[];
  proceedingCandidates: S1F1ContextualCandidate[];
  amountCandidates: S1F1ContextualCandidate[];
  dateCandidates: S1F1ContextualCandidate[];
  partyCandidates: S1F1ContextualCandidate[];
  riskFactorOnlyHints: S1F1ContextualCandidate[];
}

export interface S1F1OwnershipExtraction extends S1F1TableExtraction {
  ownerRows: S1F1ExtractedTableRow[];
  footnotes: S1F1ContextualCandidate[];
  ownershipLanguage: S1F1ContextualCandidate[];
  lockupHints: S1F1ContextualCandidate[];
  controlledCompanyHints: S1F1ContextualCandidate[];
  dualClassVotingHints: S1F1ContextualCandidate[];
}

export interface S1F1SellingHolderExtraction extends S1F1TableExtraction {
  holderRows: S1F1ExtractedTableRow[];
  relationshipCandidates: S1F1ContextualCandidate[];
  affiliateCandidates: S1F1ContextualCandidate[];
  brokerDealerCandidates: S1F1ContextualCandidate[];
  underwriterStatusCandidates: S1F1ContextualCandidate[];
  lockupCandidates: S1F1ContextualCandidate[];
  resaleLanguage: S1F1ContextualCandidate[];
  registrationRightsLanguage: S1F1ContextualCandidate[];
  privatePlacementLanguage: S1F1ContextualCandidate[];
  securityTypeCandidates: S1F1ContextualCandidate[];
  proceedsLanguage: S1F1ContextualCandidate[];
}

export interface S1F1ManagementExtraction extends S1F1TableExtraction {
  personRows: S1F1ExtractedTableRow[];
  paragraphCandidates: S1F1ContextualCandidate[];
  committeeLanguage: S1F1ContextualCandidate[];
  independentDirectorLanguage: S1F1ContextualCandidate[];
  familyRelationshipLanguage: S1F1ContextualCandidate[];
  compensationTablePresence: boolean;
  employmentAgreementLanguage: S1F1ContextualCandidate[];
  relatedPartyOverlapHints: S1F1ContextualCandidate[];
}

export interface S1F1CrossSectionHint {
  label: string;
  evidence: string;
  sections: string[];
  confidence: ConfidenceLevel;
}

export interface S1F1GovernanceExtractions {
  relatedParty: S1F1RelatedPartyExtraction;
  legalProceedings: S1F1LegalProceedingsExtraction;
  ownership: S1F1OwnershipExtraction;
  sellingHolders: S1F1SellingHolderExtraction;
  management: S1F1ManagementExtraction;
  crossSectionHints: S1F1CrossSectionHint[];
  warnings: string[];
}

export interface S1F1ExhibitIndexItem {
  exhibitNumber: string | null;
  title: string;
  description: string | null;
  filename: string | null;
  documentType: string | null;
  family: string | null;
  statusFlags: string[];
  row: S1F1ExtractedTableRow | null;
  evidence: string;
}

export interface S1F1ExhibitIndexExtraction extends S1F1TableExtraction {
  items: S1F1ExhibitIndexItem[];
  familyCounts: Record<string, number>;
  statusCandidates: S1F1ContextualCandidate[];
  footnotes: S1F1ContextualCandidate[];
}

export interface S1F1AttachedExhibitInventoryItem {
  sequence: number | null;
  type: string | null;
  filename: string | null;
  description: string | null;
  documentKind: S1F1DocumentKind | string;
  bucket: S1F1DocumentBucket | "attachment";
  sourceTextAvailable: boolean;
  textLength: number;
  titleSignals: string[];
  disagreementWarnings: string[];
  evidence: string;
}

export interface S1F1SourceCandidate extends S1F1ContextualCandidate {
  sourceDocument: string | null;
}

export interface S1F1MaterialContractExtraction {
  contractDocuments: S1F1AttachedExhibitInventoryItem[];
  contractTypeCandidates: S1F1SourceCandidate[];
  titleCandidates: S1F1SourceCandidate[];
  dateCandidates: S1F1SourceCandidate[];
  partyCandidates: S1F1SourceCandidate[];
  termCandidates: S1F1SourceCandidate[];
  redactionCandidates: S1F1SourceCandidate[];
  warnings: string[];
}

export interface S1F1UnderwritingAgreementExtraction {
  sectionDetected: boolean;
  agreementDocuments: S1F1AttachedExhibitInventoryItem[];
  underwriterCandidates: S1F1SourceCandidate[];
  agentCandidates: S1F1SourceCandidate[];
  methodLanguage: S1F1SourceCandidate[];
  feeCandidates: S1F1SourceCandidate[];
  warrantCandidates: S1F1SourceCandidate[];
  termCandidates: S1F1SourceCandidate[];
  warnings: string[];
}

export interface S1F1LockupRegistrationRightsExtraction {
  lockupDocuments: S1F1AttachedExhibitInventoryItem[];
  registrationRightsDocuments: S1F1AttachedExhibitInventoryItem[];
  lockupLanguage: S1F1SourceCandidate[];
  registrationRightsLanguage: S1F1SourceCandidate[];
  warnings: string[];
}

export interface S1F1AdsDepositAgreementExtraction {
  adsDetected: boolean;
  depositAgreementDocuments: S1F1AttachedExhibitInventoryItem[];
  adsRatioCandidates: S1F1SourceCandidate[];
  depositaryCandidates: S1F1SourceCandidate[];
  feeCandidates: S1F1SourceCandidate[];
  rightsLanguage: S1F1SourceCandidate[];
  warnings: string[];
}

export interface S1F1LegalOpinionConsentExtraction {
  legalOpinionDocuments: S1F1AttachedExhibitInventoryItem[];
  taxOpinionDocuments: S1F1AttachedExhibitInventoryItem[];
  consentDocuments: S1F1AttachedExhibitInventoryItem[];
  lawFirmCandidates: S1F1SourceCandidate[];
  auditorFirmCandidates: S1F1SourceCandidate[];
  opinionLanguage: S1F1SourceCandidate[];
  consentLanguage: S1F1SourceCandidate[];
  datedSignatureCandidates: S1F1SourceCandidate[];
  warnings: string[];
}

export interface S1F1FilingFeeExhibitExtraction extends S1F1TableExtraction {
  documents: S1F1AttachedExhibitInventoryItem[];
  feeTableTitleCandidates: S1F1SourceCandidate[];
  feeLineCandidates: S1F1SourceCandidate[];
  footnotes: S1F1SourceCandidate[];
}

export interface S1F1ExhibitConsistencyHint {
  label: string;
  evidence: string;
  confidence: ConfidenceLevel;
}

export interface S1F1ExhibitExtractions {
  exhibitIndex: S1F1ExhibitIndexExtraction;
  attachedExhibits: S1F1AttachedExhibitInventoryItem[];
  materialContracts: S1F1MaterialContractExtraction;
  underwritingAgreements: S1F1UnderwritingAgreementExtraction;
  lockupRegistrationRights: S1F1LockupRegistrationRightsExtraction;
  adsDepositAgreement: S1F1AdsDepositAgreementExtraction;
  legalOpinionsConsents: S1F1LegalOpinionConsentExtraction;
  filingFeeExhibits: S1F1FilingFeeExhibitExtraction;
  consistencyHints: S1F1ExhibitConsistencyHint[];
  warnings: string[];
}

export interface S1F1SpacTransactionStatusFacts {
  statusDetected: boolean;
  current_stage: string | null;
  current_stage_label: string | null;
  deal_status: string | null;
  stage_summary: string | null;
  stages: string[];
  target_company: string | null;
  target_summary: string | null;
  expected_ticker: string | null;
  deal_value: string | null;
  announced_date: string | null;
  sponsor: string | null;
  ipo_date: string | null;
  ipo_year: string | null;
  unit_right_warrant_terms: string | null;
  redemption_rate: string | null;
  trust_cash_before: string | null;
  trust_cash_after: string | null;
  redemption_price: string | null;
  public_shares_remaining: string | null;
  min_cash_condition: string | null;
  min_cash_status: string | null;
  float_impact: string | null;
  closing_date: string | null;
  ticker_change_date: string | null;
  risk_flags: string[];
  watch_next: string[];
  sources: S1F1Evidence[];
  event_history: string[];
  warnings: string[];
}

export interface S1F1OfferingFacts {
  kind: "ipo" | "resale" | "mixed" | "primary" | "unknown";
  ipo_kind?: "traditional" | "spac" | null;
  securities: string[];
  shares_offered: number | null;
  price_low: number | null;
  price_high: number | null;
  gross_proceeds: number | null;
  selling_shareholder_shares: number | null;
  use_of_proceeds: string | null;
  underwriters: string[];
}

export interface S1F1AmendmentFacts {
  is_amendment: boolean;
  amendment_number: number | null;
  stated_material_change: string | null;
  routine_or_administrative: boolean;
  parent_context_provided: boolean;
}

export interface S1F1FilingFacts {
  filing_family: "s1_f1_registration";
  reported_form_type: string;
  filing_variant: S1F1FilingVariant;
  boundary_case: boolean;
  parent_context_needed: boolean;
  parent_registration_number: string | null;
  post_effective_purpose: S1F1PostEffectivePurpose | null;
  deregister_unsold_securities: boolean;
  no_additional_securities_registered: boolean;
  rule_462b: {
    base_form: "S-1" | "F-1" | null;
    prior_registration_number: string | null;
    added_securities_amount: number | null;
    automatic_effective: boolean;
    within_20_percent_limit: boolean;
  };
  evidence: S1F1Evidence[];
}

export interface S1F1ForeignIssuerFacts {
  is_foreign_private_issuer: boolean;
  ads_offering: boolean;
  vie_structure: boolean;
  hfcaa_or_pcaob_risk: boolean;
  cayman_holding_company: boolean;
}

export interface S1F1Facts {
  filing: S1F1FilingFacts;
  company_name: string | null;
  ticker: string | null;
  exchange: string | null;
  registration_kind: S1F1OfferingFacts["kind"];
  offering: S1F1OfferingFacts;
  amendment: S1F1AmendmentFacts;
  foreign_issuer: S1F1ForeignIssuerFacts;
  risks: {
    going_concern: boolean;
    listing_risk: boolean;
    legal_risk: boolean;
    fda_or_clinical: boolean;
    insider_control: boolean;
    strategic_transaction: boolean;
  };
  market_context_summary: {
    provided: boolean;
    offering_to_market_cap_pct: number | null;
    shares_to_float_pct: number | null;
  };
}

export interface S1F1ParserInput {
  formType: string;
  accessionNumber?: string | null;
  filingText: string;
  metadata?: {
    companyName?: string | null;
    ticker?: string | null;
    exchange?: string | null;
    filedAt?: string | null;
  };
  attachments?: Array<{
    name: string;
    description?: string | null;
    text?: string | null;
  }>;
  parentFilingContext?: {
    formType?: string | null;
    accessionNumber?: string | null;
    summary?: string | null;
    offering?: Partial<S1F1OfferingFacts>;
  } | null;
  marketContext?: S1F1MarketContext | null;
}

export interface S1F1ParserOutput {
  parserVersion: string;
  parserGroup: typeof S1F1_PARSER_GROUP;
  formType: string;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: S1F1Facts;
  signals: S1F1Signal[];
  calendarItems: S1F1CalendarItem[];
  warnings: string[];
  raw: {
    sourceTextLength: number;
    attachmentNames: string[];
    deterministic?: {
      canFinishWithoutLlm: boolean;
      reason: string;
      event_type: SecEventType;
      score: number;
    };
    documentFilter?: S1F1DocumentFilterSummary;
    cleanedSourceBlocks?: S1F1CleanedSourceBlock[];
    sectionDetection?: S1F1SectionDetection;
    riskFactors?: S1F1RiskFactorsStructure;
    foreignIssuerPhraseHits?: S1F1ForeignIssuerPhraseHit[];
    sectionExtractions?: S1F1SectionExtractions;
    financialExtractions?: S1F1FinancialExtractions;
    governanceExtractions?: S1F1GovernanceExtractions;
    exhibitExtractions?: S1F1ExhibitExtractions;
    spacTransactionStatus?: S1F1SpacTransactionStatusFacts;
    marketContext?: S1F1MarketContext | null;
    parentFilingContext?: S1F1ParserInput["parentFilingContext"];
  };
}

export interface S1F1CleanedSourceBlock {
  source: "primary" | "attachment";
  sectionKey: string | null;
  sectionTitle: string | null;
  documentName: string | null;
  text: string;
  tables: string[];
}

export interface S1F1PrimaryTicker {
  ticker: string | null;
  exchange: string | null;
}

export interface S1F1AnalysisOutput {
  source_group: "filings";
  market_scope: MarketScope;
  event_type: SecEventType;
  event_title: string;
  primary_ticker: S1F1PrimaryTicker;
  tickers: string[];
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
  related_tickers: string[];
  calendar_items: S1F1CalendarItem[];
  confidence: ConfidenceLevel;
  needs_human_review: boolean;
}

export interface S1F1DisplayPayload {
  display_type: DisplayType;
  display_version?: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}

export interface S1F1FixtureExpected {
  expected_delivery_level: DeliveryLevel;
  expected_impact: ImpactLevel;
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  special_ui_needed: boolean;
  special_ui_reason: string | null;
  integration_notes: string[];
}

export interface S1F1RequiredOutputJson {
  parser_output: S1F1ParserOutput;
  analysis_output: S1F1AnalysisOutput;
  display_payload: S1F1DisplayPayload;
  fixture_expected?: S1F1FixtureExpected;
}

export interface S1F1RouterDecision {
  event_type: SecEventType;
  preliminary_action:
    | "finish_deterministically"
    | "send_to_analysis_llm"
    | "archive_low_signal";
  reasoning: string;
  confidence: ConfidenceLevel;
  market_context_needed: boolean;
  market_context_reason: string | null;
  market_context_fields: string[];
  display_type?: DisplayType;
  display_version?: string;
  analysis_llm_needed?: boolean;
}

export function isApprovedSecEventType(value: string): value is SecEventType {
  return (APPROVED_SEC_EVENT_TYPES as readonly string[]).includes(value);
}

export function deliveryLevelFromScore(score: number): DeliveryLevel {
  if (score < 50) return "archive";
  if (score < 75) return "feed";
  return "alert";
}
