export const PROXY_PARSER_VERSION = "proxy-parser-v1";
export const PROXY_PARSER_GROUP = "proxy";

export const APPROVED_PROXY_EVENT_TYPES = [
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

export type ProxyEventType = (typeof APPROVED_PROXY_EVENT_TYPES)[number];
export type ProxySignalSeverity = "low" | "medium" | "high";

export interface ProxyParserInput {
  formType?: string | null;
  accessionNumber?: string | null;
  companyName?: string | null;
  primaryTicker?: {
    ticker?: string | null;
    exchange?: string | null;
  } | null;
  filingText?: string | null;
  attachments?: Array<{
    name?: string | null;
    filename?: string | null;
    document?: string | null;
    type?: string | null;
    documentType?: string | null;
    description?: string | null;
    url?: string | null;
    isPrimary?: boolean | null;
    text?: string | null;
  }> | null;
  market_context?: Record<string, unknown> | null;
}

export type ProxyDocumentClass =
  | "proxy_body"
  | "preliminary_proxy_body"
  | "additional_material"
  | "supplemental_proxy_material"
  | "proxy_card_only"
  | "voting_instruction_only"
  | "notice_only"
  | "vote_reminder_only"
  | "merger_proxy"
  | "contested_solicitation"
  | "shareholder_solicitation"
  | "unknown_proxy_related_material";

export interface ProxyDocumentInventoryItem {
  sequence: string | null;
  type: string | null;
  filename: string | null;
  description: string | null;
  source: "filing_text" | "attachment";
  isPrimary: boolean;
  isTextLike: boolean;
  textChars: number;
  proxyClass: ProxyDocumentClass;
  proposalHeadingCount: number;
  highRiskSignals: string[];
  administrativeOnlyCandidate: boolean;
}

export type ProxyProposalSourceArea = "notice" | "body" | "proxy_card" | "voting_instruction" | "toc" | "unknown";
export type ProxyProposalSponsor = "management" | "shareholder" | "dissident" | "unknown";
export type ProxyDetailedProposalCategory =
  | "director_election"
  | "auditor_ratification"
  | "say_on_pay"
  | "say_on_frequency"
  | "equity_incentive_plan"
  | "employee_stock_purchase_plan"
  | "charter_amendment"
  | "bylaw_amendment"
  | "reverse_stock_split"
  | "authorized_share_increase"
  | "merger_acquisition"
  | "asset_sale"
  | "liquidation"
  | "reincorporation"
  | "related_party_transaction"
  | "shareholder_proposal"
  | "proxy_access"
  | "special_meeting_right"
  | "written_consent_right"
  | "classified_board"
  | "supermajority_vote"
  | "officer_exculpation"
  | "adjournment"
  | "other_unknown";

export interface ProxyProposalExtractionCandidate {
  id: string;
  title: string;
  normalizedTitle: string;
  sourceArea: ProxyProposalSourceArea;
  documentClass: ProxyDocumentClass;
  category: string;
  detailedCategory: ProxyDetailedProposalCategory;
  sponsor: ProxyProposalSponsor;
  boardRecommendation: "FOR" | "AGAINST" | "ABSTAIN" | "WITHHOLD" | "NO_RECOMMENDATION" | null;
  shareholderRecommendation: "FOR" | "AGAINST" | "ABSTAIN" | "WITHHOLD" | null;
  voteMechanicsText: string | null;
  sourceText: string;
  bodyText: string | null;
  confidence: "high" | "medium" | "low";
  uncertain: boolean;
}

export interface ProxyProposalExtractionSummary {
  candidates: ProxyProposalExtractionCandidate[];
  dedupedCount: number;
  sourceCounts: {
    notice: number;
    body: number;
    proxy_card: number;
    voting_instruction: number;
    toc: number;
    unknown: number;
  };
  countMismatch: boolean;
  recommendationConflicts: Array<{
    proposalId: string;
    recommendations: string[];
  }>;
  generalVoteMechanics: string[];
  uncertain: boolean;
}

export type ProxySectionKind =
  | "notice_of_meeting"
  | "voting_information"
  | "proposal_summary"
  | "proposal_section"
  | "board_governance"
  | "director_nominees"
  | "director_independence"
  | "board_committees"
  | "audit_committee"
  | "executive_compensation"
  | "compensation_discussion"
  | "summary_compensation_table_area"
  | "pay_versus_performance_area"
  | "director_compensation"
  | "beneficial_ownership"
  | "related_person_transactions"
  | "auditor_ratification"
  | "audit_fees"
  | "equity_compensation_plan"
  | "shareholder_proposals"
  | "other_matters"
  | "proxy_card"
  | "appendix_annex"
  | "unknown";

export interface ProxySectionItem {
  id: string;
  kind: ProxySectionKind;
  heading: string;
  sourceDocumentIndex: number;
  documentClass: ProxyDocumentClass;
  startLine: number;
  endLine: number;
  sourceText: string;
  bodyTextChars: number;
  proposalId: string | null;
  fromToc: boolean;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

export interface ProxySectionSegmentationSummary {
  sections: ProxySectionItem[];
  tocHints: ProxySectionItem[];
  bodySectionCount: number;
  warnings: string[];
  uncertain: boolean;
}

export type ProxyKeyTableType =
  | "director_nominee_table"
  | "board_skills_matrix"
  | "committee_membership_table"
  | "audit_fee_table"
  | "summary_compensation_table"
  | "grants_of_plan_based_awards"
  | "outstanding_equity_awards"
  | "option_exercises_and_stock_vested"
  | "pension_benefits"
  | "nonqualified_deferred_compensation"
  | "director_compensation"
  | "pay_versus_performance"
  | "beneficial_ownership"
  | "equity_compensation_plan_information"
  | "new_plan_benefits"
  | "proposal_summary_table"
  | "unknown_key_table";

export interface ProxyKeyTableItem {
  id: string;
  tableType: ProxyKeyTableType;
  heading: string | null;
  caption: string | null;
  sourceDocumentIndex: number;
  documentClass: ProxyDocumentClass;
  sectionKind: ProxySectionKind | null;
  proposalId: string | null;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[][];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  isLayoutTable: boolean;
}

export interface ProxyKeyTableExtractionSummary {
  tables: ProxyKeyTableItem[];
  ignoredLayoutTableCount: number;
  damagedTableCount: number;
  warnings: string[];
  uncertain: boolean;
}

export interface ProxyTextCoverageItem {
  sourceDocumentIndex: number;
  documentClass: ProxyDocumentClass;
  rawChars: number;
  textChars: number;
  imageReferenceCount: number;
  htmlTableCount: number;
  textCoverageRatio: number;
  imageHeavy: boolean;
  warning: string | null;
}

export interface ProxyTextCoverageSummary {
  documents: ProxyTextCoverageItem[];
  hasImageHeavyDocument: boolean;
  warnings: string[];
}

export type ProxySupplementalMaterialType =
  | "none"
  | "additional_proxy_material"
  | "supplemental_proxy_statement"
  | "amended_proxy_statement"
  | "revised_proxy_statement"
  | "correction_to_proxy_statement"
  | "proxy_card_or_reminder"
  | "shareholder_letter_or_solicitation"
  | "transaction_update"
  | "unknown_supplemental_material";

export type ProxySupplementChangeCategory =
  | "meeting_date_change"
  | "meeting_time_change"
  | "meeting_location_change"
  | "record_date_change"
  | "proposal_added"
  | "proposal_removed"
  | "proposal_title_changed"
  | "proposal_number_changed"
  | "board_recommendation_changed"
  | "vote_requirement_changed"
  | "adjournment_or_postponement"
  | "nominee_change"
  | "auditor_update"
  | "compensation_update"
  | "equity_plan_update"
  | "reverse_split_ratio_update"
  | "authorized_share_update"
  | "charter_bylaw_update"
  | "shareholder_proposal_update"
  | "litigation_update"
  | "settlement_update"
  | "merger_agreement_update"
  | "merger_consideration_update"
  | "fairness_opinion_update"
  | "special_committee_update"
  | "financing_update"
  | "regulatory_approval_update"
  | "deal_terms_update"
  | "proxy_contest_update"
  | "no_other_changes_statement"
  | "parent_reference_only"
  | "unknown_change";

export interface ProxyParentReference {
  referenceType:
    | "definitive_proxy_statement"
    | "annual_meeting_proxy"
    | "special_meeting_proxy"
    | "proxy_statement_prospectus"
    | "previously_mailed_proxy"
    | "previously_filed_proxy"
    | "generic_parent_proxy";
  date: string | null;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface ProxySupplementChangeSignal {
  category: ProxySupplementChangeCategory;
  label: string;
  sourceText: string;
  proposalId: string | null;
  confidence: "high" | "medium" | "low";
}

export interface ProxySupplementReconciliation {
  available: boolean;
  parentDocumentIndex: number | null;
  supplementDocumentIndex: number | null;
  nearDuplicate: boolean;
  noSubstantiveChangeStatement: boolean;
  addedParagraphs: string[];
  changedProposalIds: string[];
  meetingMetadataConflicts: string[];
  recommendationConflicts: string[];
  changedTableCaptions: string[];
  warnings: string[];
}

export interface ProxySupplementalAnalysisSummary {
  isSupplementalOrAmended: boolean;
  materialType: ProxySupplementalMaterialType;
  documentKinds: Array<{
    sourceDocumentIndex: number;
    documentClass: ProxyDocumentClass;
    materialType: ProxySupplementalMaterialType;
    evidence: string | null;
  }>;
  parentReferences: ProxyParentReference[];
  changeSignals: ProxySupplementChangeSignal[];
  reconciliation: ProxySupplementReconciliation;
  warnings: string[];
  uncertain: boolean;
}

export interface ProxyProposal {
  id: string;
  title: string;
  category: string;
  recommendation: "FOR" | "AGAINST" | "ABSTAIN" | "WITHHOLD" | null;
  sourceText: string;
  isShareholderProposal: boolean;
}

export interface ProxySignal {
  name: string;
  eventType: ProxyEventType;
  severity: ProxySignalSeverity;
  evidence: string;
  proposalId: string | null;
}

export interface ProxyCalendarItem {
  type: "shareholder_meeting" | "record_date";
  date: string;
  description: string;
}

export interface ProxyCoverFacts {
  filedByRegistrant: boolean | null;
  filedByOtherThanRegistrant: boolean | null;
  checkedBoxes: string[];
  amendmentNumber: string | null;
  filingPersons: string[];
}

export interface ProxySupplementFacts {
  isSupplement: boolean;
  originalProxyDate: string | null;
  hasAmendedNotice: boolean;
  hasAmendedProxyCard: boolean;
  affectedProposalIds: string[];
  withdrawnNominees: string[];
  sourceText: string | null;
}

export interface ProxyContestedFacts {
  isContested: boolean;
  solicitationSource: "registrant" | "third_party" | "unknown";
  proxyCardColors: string[];
  dissidentGroups: string[];
  dissidentNominees: string[];
  opposedNominees: string[];
  sourceText: string | null;
}

export interface ProxyReverseSplitFacts {
  hasReverseSplitProposal: boolean;
  ratioText: string | null;
  authorizedSharesUnchanged: boolean | null;
  parValueUnchanged: boolean | null;
  listingComplianceMentioned: boolean;
  minimumBidMentioned: boolean;
  sourceText: string | null;
}

export interface ProxyNoticeOnlyFacts {
  isNoticeOnly: boolean;
  proxyMaterialsUrl: string | null;
  votingUrl: string | null;
  notBallot: boolean;
  controlNumberMentioned: boolean;
  sourceText: string | null;
}

export interface ProxyPreliminaryFacts {
  isPreliminary: boolean;
  placeholderCount: number;
  placeholderFields: string[];
}

export interface ProxyRawAttachmentInventoryItem {
  name: string;
  textChars: number;
  hasText: boolean;
}

export interface ProxyRawImportantBlock {
  kind:
    | "meeting_date"
    | "record_date"
    | "proposal"
    | "ownership"
    | "supplement"
    | "contested"
    | "reverse_split"
    | "notice_only"
    | "preliminary_placeholder"
    | "transaction_consideration"
    | "transaction_vote_required";
  label: string;
  text: string;
}

export interface ProxyRawNoiseBlock {
  kind:
    | "sec_submission_wrapper"
    | "html_style_or_script"
    | "inline_xbrl"
    | "page_header_or_table_of_contents"
    | "proxy_access_boilerplate"
    | "voting_instruction_boilerplate"
    | "forward_looking_safe_harbor"
    | "html_entity_noise";
  count: number;
  sample: string;
}

export interface ProxyParserOutput {
  parserVersion: string;
  parserGroup: "proxy";
  formType: "Proxy";
  accessionNumber: string | null;
  isSupported: true;
  summary: string | null;
  facts: {
    companyName: string | null;
    primaryTicker: {
      ticker: string | null;
      exchange: string | null;
    };
    secFormType: string | null;
    proxyType: string | null;
    meetingDate: string | null;
    recordDate: string | null;
    proposalCount: number;
    proposals: ProxyProposal[];
    ownership: {
      maxBeneficialOwnershipPercent: number | null;
      holder: string | null;
      sourceText: string | null;
    };
    dilution: {
      hasEquityPlanVote: boolean;
      sharesRequested: number | null;
      percentOfOutstanding: number | null;
      proposalIds: string[];
    };
    transaction: {
      hasTransactionVote: boolean;
      consideration: string | null;
      voteRequired: string | null;
      proposalIds: string[];
      agreementDate?: string | null;
      mergerParties?: string[];
      premiumToLastClose?: string | null;
      appraisalRightsMentioned?: boolean;
      delistingMentioned?: boolean;
    };
    legal: {
      hasLegalRiskProposal: boolean;
      proposalIds: string[];
      topics: string[];
    };
    cover?: ProxyCoverFacts;
    supplement?: ProxySupplementFacts;
    contested?: ProxyContestedFacts;
    reverseSplit?: ProxyReverseSplitFacts;
    noticeOnly?: ProxyNoticeOnlyFacts;
    preliminary?: ProxyPreliminaryFacts;
    deterministic: {
      canFinishWithoutLlm: boolean;
      reason: string | null;
      eventType: ProxyEventType | null;
      suggestedScore: number | null;
    };
  };
  signals: ProxySignal[];
  calendarItems: ProxyCalendarItem[];
  warnings: string[];
  raw: {
    secFormType: string | null;
    primaryTextChars: number;
    combinedTextChars: number;
    attachmentNames: string[];
    attachmentInventory: ProxyRawAttachmentInventoryItem[];
    documentInventory: ProxyDocumentInventoryItem[];
    administrativeOnlyCandidate: boolean;
    proposalExtraction: ProxyProposalExtractionSummary;
    sectionSegmentation: ProxySectionSegmentationSummary;
    keyTableExtraction: ProxyKeyTableExtractionSummary;
    textCoverage: ProxyTextCoverageSummary;
    supplementalAnalysis: ProxySupplementalAnalysisSummary;
    importantBlocks: ProxyRawImportantBlock[];
    noiseBlocks: ProxyRawNoiseBlock[];
    market_context: Record<string, unknown> | null;
  };
}

const DATE_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";

const ROUTINE_PROXY_CATEGORIES = new Set([
  "director_election",
  "auditor_ratification",
  "compensation",
]);

type ProxySourceDocument = {
  sequence: string | null;
  type: string | null;
  filename: string | null;
  description: string | null;
  source: "filing_text" | "attachment";
  isPrimary: boolean;
  body: string;
};

export function parseProxyFiling(input: ProxyParserInput): ProxyParserOutput {
  const companyName = cleanString(input.companyName);
  const primaryTicker = {
    ticker: cleanString(input.primaryTicker?.ticker),
    exchange: cleanString(input.primaryTicker?.exchange),
  };
  const secFormType = cleanString(input.formType);
  const documents = extractProxyDocuments(input, secFormType);
  const documentInventory = buildDocumentInventory(documents, secFormType);
  const primaryText = normalizeFilingText(documents.find((document) => document.isPrimary)?.body ?? input.filingText ?? "");
  const text = normalizeFilingText(buildFilingText(documents));
  const rawInputText = buildRawInputText(input);
  const attachmentInventory = buildAttachmentInventory(input);
  const cover = extractCoverFacts(text, secFormType);
  const proxyType = extractProxyType(text, secFormType, cover);
  const meetingDate = extractDateNear(text, [
    "(?:annual|special)\\s+meeting[^.\\n]{0,120}?(?:will\\s+be\\s+held|to\\s+be\\s+held|held\\s+on)[^.\\n]{0,120}?",
    "meeting\\s+of\\s+shareholders[^.\\n]{0,120}?(?:will\\s+be\\s+held|to\\s+be\\s+held|held\\s+on)[^.\\n]{0,120}?",
  ]);
  const recordDate = extractDateNear(text, [
    "record\\s+date[^.\\n]{0,300}?",
    "stockholders?\\s+of\\s+record[^.\\n]{0,300}?",
    "as\\s+of\\s+the\\s+close\\s+of\\s+business\\s+on\\s+",
    "at\\s+the\\s+close\\s+of\\s+business\\s+on\\s+",
    "close\\s+of\\s+business\\s+on\\s+",
  ]);
  const proposalExtraction = extractProposalExtraction(documents, documentInventory, text);
  const proposals = proposalExtraction.proposals;
  const sectionSegmentation = segmentProxySections(documents, documentInventory);
  const keyTableExtraction = extractProxyKeyTables(documents, documentInventory, sectionSegmentation, proposalExtraction.summary);
  const textCoverage = detectProxyTextCoverage(documents, documentInventory);
  const supplementalAnalysis = analyzeSupplementalProxyMaterials(
    documents,
    documentInventory,
    proposalExtraction.summary,
    sectionSegmentation,
    keyTableExtraction,
  );
  const ownership = extractOwnershipFacts(text);
  const dilution = extractDilutionFacts(proposals);
  const transaction = extractTransactionFacts(text, proposals);
  const legal = extractLegalFacts(proposals);
  const supplement = extractSupplementFacts(text);
  const contested = extractContestedFacts(text, cover, secFormType);
  const reverseSplit = extractReverseSplitFacts(text, proposals);
  const noticeOnly = extractNoticeOnlyFacts(text, secFormType);
  const preliminary = extractPreliminaryFacts(text, secFormType, cover);
  const warnings = buildWarnings({
    secFormType,
    proposals,
    cover,
    supplement,
    contested,
    noticeOnly,
    preliminary,
    proposalExtraction: proposalExtraction.summary,
    sectionSegmentation,
    keyTableExtraction,
    textCoverage,
    supplementalAnalysis,
  });
  const routineProxy = isRoutineAnnualProxy(proxyType, proposals, ownership, warnings);
  const signals = buildSignals({
    proposals,
    ownership,
    routineProxy,
    supplement,
    contested,
    reverseSplit,
    noticeOnly,
  });
  const calendarItems = buildCalendarItems(companyName, proxyType, meetingDate, recordDate);

  return {
    parserVersion: PROXY_PARSER_VERSION,
    parserGroup: PROXY_PARSER_GROUP,
    formType: "Proxy",
    accessionNumber: cleanString(input.accessionNumber),
    isSupported: true,
    summary: buildSummary(companyName, proxyType, proposals.length, meetingDate),
    facts: {
      companyName,
      primaryTicker,
      secFormType,
      proxyType,
      meetingDate,
      recordDate,
      proposalCount: proposals.length,
      proposals,
      ownership,
      dilution,
      transaction,
      legal,
      ...(cover ? { cover } : {}),
      ...(supplement ? { supplement } : {}),
      ...(contested ? { contested } : {}),
      ...(reverseSplit ? { reverseSplit } : {}),
      ...(noticeOnly ? { noticeOnly } : {}),
      ...(preliminary ? { preliminary } : {}),
      deterministic: routineProxy
        ? {
            canFinishWithoutLlm: true,
            reason:
              "Definitive annual proxy contains only routine director, auditor, and compensation voting items.",
            eventType: "shareholder_vote",
            suggestedScore: 25,
          }
        : {
            canFinishWithoutLlm: false,
            reason: null,
            eventType: null,
            suggestedScore: null,
          },
    },
    signals,
    calendarItems,
    warnings,
    raw: {
      secFormType,
      primaryTextChars: primaryText.length,
      combinedTextChars: text.length,
      attachmentNames: attachmentInventory.map((attachment) => attachment.name),
      attachmentInventory,
      documentInventory,
      administrativeOnlyCandidate: isAdministrativeOnlyFilingCandidate(
        documentInventory,
        proposalExtraction.summary,
        textCoverage,
        supplementalAnalysis,
      ),
      proposalExtraction: proposalExtraction.summary,
      sectionSegmentation,
      keyTableExtraction,
      textCoverage,
      supplementalAnalysis,
      importantBlocks: buildImportantBlocks(text, {
        meetingDate,
        recordDate,
        proposals,
        ownership,
        transaction,
        supplement,
        contested,
        reverseSplit,
        noticeOnly,
        preliminary,
      }),
      noiseBlocks: buildNoiseBlocks(rawInputText),
      market_context: input.market_context ?? null,
    },
  };
}

function extractProxyDocuments(input: ProxyParserInput, secFormType: string | null): ProxySourceDocument[] {
  const documents: ProxySourceDocument[] = [];
  documents.push(...parseProxyDocumentText(input.filingText ?? "", "filing_text", null, secFormType));

  for (const [index, attachment] of (input.attachments ?? []).entries()) {
    const attachmentName =
      cleanString(attachment.filename) ||
      cleanString(attachment.document) ||
      cleanString(attachment.name) ||
      `attachment_${index + 1}`;
    const parsed = parseProxyDocumentText(attachment.text ?? "", "attachment", attachmentName, secFormType);

    if (parsed.length) {
      documents.push(...parsed.map((document) => ({
        ...document,
        type: document.type || cleanString(attachment.type) || cleanString(attachment.documentType),
        filename: document.filename || attachmentName,
        description: document.description || cleanString(attachment.description),
        isPrimary: Boolean(attachment.isPrimary) || document.isPrimary,
      })));
    } else if (cleanString(attachment.text)) {
      documents.push({
        sequence: null,
        type: cleanString(attachment.type) || cleanString(attachment.documentType),
        filename: attachmentName,
        description: cleanString(attachment.description),
        source: "attachment",
        isPrimary: Boolean(attachment.isPrimary),
        body: attachment.text ?? "",
      });
    }
  }

  if (!documents.length) {
    documents.push({
      sequence: null,
      type: secFormType,
      filename: null,
      description: null,
      source: "filing_text",
      isPrimary: true,
      body: input.filingText ?? "",
    });
  }

  return markPrimaryProxyDocument(documents, secFormType);
}

function parseProxyDocumentText(
  text: string,
  source: "filing_text" | "attachment",
  fallbackFilename: string | null,
  secFormType: string | null,
): ProxySourceDocument[] {
  if (!cleanString(text)) {
    return [];
  }

  const secDocuments = parseSecDocumentBlocks(text, source);
  if (secDocuments.length) {
    return secDocuments;
  }

  const combinedSections = parseCombinedDocumentSections(text, source);
  if (combinedSections.length) {
    return combinedSections;
  }

  return [
    {
      sequence: null,
      type: secFormType,
      filename: fallbackFilename,
      description: null,
      source,
      isPrimary: source === "filing_text",
      body: text,
    },
  ];
}

function parseSecDocumentBlocks(text: string, source: "filing_text" | "attachment"): ProxySourceDocument[] {
  const blocks = [...text.matchAll(/<DOCUMENT\b[^>]*>([\s\S]*?)<\/DOCUMENT>/gi)];
  return blocks.map((match, index) => {
    const block = match[1] ?? "";
    return {
      sequence: readSecDocumentTag(block, "SEQUENCE"),
      type: readSecDocumentTag(block, "TYPE"),
      filename: readSecDocumentTag(block, "FILENAME"),
      description: readSecDocumentTag(block, "DESCRIPTION"),
      source,
      isPrimary: index === 0,
      body: readSecDocumentBody(block),
    };
  });
}

function readSecDocumentTag(block: string, tagName: string): string | null {
  const match = block.match(new RegExp(`<${tagName}>\\s*([^\\r\\n<]+)`, "i"));
  return match?.[1] ? normalizeSpaces(match[1]) : null;
}

function readSecDocumentBody(block: string): string {
  const textMatch = block.match(/<TEXT\b[^>]*>([\s\S]*?)(?:<\/TEXT>|$)/i);
  if (textMatch?.[1]) {
    return textMatch[1];
  }
  return block
    .replace(/<(?:TYPE|SEQUENCE|FILENAME|DESCRIPTION)>[^\r\n<]*/gi, " ")
    .replace(/<\/?DOCUMENT\b[^>]*>/gi, " ");
}

function parseCombinedDocumentSections(text: string, source: "filing_text" | "attachment"): ProxySourceDocument[] {
  const headings = [...text.matchAll(/^###\s+([^\n]+)\n/gm)];
  if (!headings.length) {
    return [];
  }

  return headings.map((heading, index) => {
    const headingText = normalizeSpaces(heading[1] ?? "");
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? text.length;
    const { type, description } = parseCombinedDocumentHeading(headingText);
    return {
      sequence: null,
      type,
      filename: null,
      description,
      source,
      isPrimary: index === 0,
      body: text.slice(start, end).trim(),
    };
  });
}

function parseCombinedDocumentHeading(headingText: string): { type: string | null; description: string | null } {
  const [typePart, ...descriptionParts] = headingText.split(/\s+-\s+/);
  return {
    type: cleanString(typePart),
    description: cleanString(descriptionParts.join(" - ")),
  };
}

function markPrimaryProxyDocument(
  documents: ProxySourceDocument[],
  secFormType: string | null,
): ProxySourceDocument[] {
  if (documents.some((document) => document.isPrimary && isPrimaryProxyDocumentCandidate(document, secFormType))) {
    return documents;
  }

  const primaryIndex = documents.findIndex((document) => isPrimaryProxyDocumentCandidate(document, secFormType));
  const fallbackIndex = documents.findIndex((document) => isTextLikeProxyDocument(document));
  const selectedIndex = primaryIndex >= 0 ? primaryIndex : fallbackIndex >= 0 ? fallbackIndex : 0;

  return documents.map((document, index) => ({
    ...document,
    isPrimary: index === selectedIndex,
  }));
}

function isPrimaryProxyDocumentCandidate(document: ProxySourceDocument, secFormType: string | null): boolean {
  if (!isTextLikeProxyDocument(document) || isExhibitLikeSecondaryDocument(document)) {
    return false;
  }
  const type = normalizeDocumentType(document.type);
  const form = normalizeDocumentType(secFormType);
  if (type && form && type === form) {
    return true;
  }
  return /\b(?:DEF|PRE|DEFA|DEFM|PREM|DEFC|PREC)\s*14A\b/i.test(type || "");
}

function isTextLikeProxyDocument(document: ProxySourceDocument): boolean {
  const label = `${document.type ?? ""} ${document.filename ?? ""} ${document.description ?? ""}`;
  if (/\.(?:jpg|jpeg|gif|png|bmp|svg|pdf|xls|xlsx|zip|xsd)(?:$|\?)/i.test(label)) {
    return false;
  }
  if (/\b(?:GRAPHIC|ZIP|XSD|XML SCHEMA|EX-101|INSTANCE DOCUMENT|CALCULATION LINKBASE|LABELS LINKBASE|PRESENTATION LINKBASE)\b/i.test(label)) {
    return false;
  }
  return normalizeFilingText(document.body).length > 0;
}

function isExhibitLikeSecondaryDocument(document: ProxySourceDocument): boolean {
  const label = `${document.type ?? ""} ${document.filename ?? ""} ${document.description ?? ""}`;
  return /\bEX-\d/i.test(label) && !/\bEX-99\b/i.test(label);
}

function normalizeDocumentType(value: string | null | undefined): string | null {
  const normalized = cleanString(value)?.toUpperCase().replace(/\s+/g, " ");
  return normalized || null;
}

function buildFilingText(documents: ProxySourceDocument[]): string {
  const parts: string[] = [];
  for (const document of documents) {
    if (!isTextLikeProxyDocument(document)) {
      continue;
    }
    const normalized = normalizeFilingText(document.body);
    if (!normalized || parts.some((part) => isNearDuplicateText(part, normalized))) {
      continue;
    }
    parts.push(normalized);
  }
  return parts.join("\n\n");
}

function buildRawInputText(input: ProxyParserInput): string {
  const parts = [input.filingText ?? ""];
  for (const attachment of input.attachments ?? []) {
    if (attachment.text) {
      parts.push(attachment.text);
    }
  }
  return parts.join("\n");
}

function buildAttachmentInventory(input: ProxyParserInput): ProxyRawAttachmentInventoryItem[] {
  return (input.attachments ?? []).map((attachment) => {
    const normalizedText = normalizeFilingText(attachment.text ?? "");
    return {
      name: cleanString(attachment.name) ?? "unnamed",
      textChars: normalizedText.length,
      hasText: normalizedText.length > 0,
    };
  });
}

function buildDocumentInventory(
  documents: ProxySourceDocument[],
  secFormType: string | null,
): ProxyDocumentInventoryItem[] {
  return documents.map((document) => {
    const normalizedText = normalizeFilingText(document.body);
    const proxyClass = classifyProxyDocument(document, normalizedText, secFormType);
    const highRiskSignals = detectHighRiskProxySignals(normalizedText);
    return {
      sequence: document.sequence,
      type: document.type,
      filename: document.filename,
      description: document.description,
      source: document.source,
      isPrimary: document.isPrimary,
      isTextLike: isTextLikeProxyDocument(document),
      textChars: normalizedText.length,
      proxyClass,
      proposalHeadingCount: countProposalHeadingCandidates(normalizedText),
      highRiskSignals,
      administrativeOnlyCandidate: isAdministrativeOnlyDocumentCandidate(proxyClass, highRiskSignals),
    };
  });
}

function classifyProxyDocument(
  document: ProxySourceDocument,
  text: string,
  secFormType: string | null,
): ProxyDocumentClass {
  const label = `${document.type ?? ""} ${document.filename ?? ""} ${document.description ?? ""}`;
  const firstPortion = text.slice(0, 8000);
  const haystack = `${label}\n${firstPortion}`;

  if (/\bDEFC14A\b|\bPREC14A\b/i.test(secFormType ?? "") || hasContestedProxySignal(haystack)) {
    return "contested_solicitation";
  }
  if (/\b(?:PREM14A|DEFM14A)\b/i.test(secFormType ?? "") || hasMergerProxySignal(haystack)) {
    return "merger_proxy";
  }
  if (hasSupplementProxySignal(haystack) || hasSubstantiveSupplementChangeLanguage(haystack)) {
    return "supplemental_proxy_material";
  }
  if (hasProxyCardOnlySignal(haystack)) {
    return "proxy_card_only";
  }
  if (hasVotingInstructionOnlySignal(haystack)) {
    return "voting_instruction_only";
  }
  if (hasNoticeOnlyProxySignal(haystack)) {
    return "notice_only";
  }
  if (hasVoteReminderOnlySignal(haystack)) {
    return "vote_reminder_only";
  }
  if (hasShareholderSolicitationSignal(haystack)) {
    return "shareholder_solicitation";
  }
  if (/\bPRE\s*14A\b/i.test(secFormType ?? "") || /\bpreliminary\s+proxy\s+statement\b/i.test(haystack)) {
    return "preliminary_proxy_body";
  }
  if (/\bDEFA14A\b/i.test(secFormType ?? "") || /\bdefinitive\s+additional\s+materials\b/i.test(haystack)) {
    return "additional_material";
  }
  if (/\bproxy\s+statement\b|\bannual\s+meeting\b|\bspecial\s+meeting\b/i.test(haystack) || countProposalHeadingCandidates(text) > 0) {
    return "proxy_body";
  }
  return "unknown_proxy_related_material";
}

function hasProxyCardOnlySignal(text: string): boolean {
  return /\bproxy\s+card\b/i.test(text) && hasProxyCardVotingOptions(text);
}

function hasVotingInstructionOnlySignal(text: string): boolean {
  return (
    /\bvoting\s+instruction\s+(?:form|card)\b/i.test(text) ||
    /\binstruct(?:ions?)?\s+how\s+to\s+vote\b/i.test(text) ||
    (/\bvote\s+by\s+(?:internet|phone|mail)\b/i.test(text) && hasProxyCardVotingOptions(text))
  );
}

function hasNoticeOnlyProxySignal(text: string): boolean {
  return (
    /\bimportant\s+notice\s+regarding\s+the\s+availability\s+of\s+proxy\s+materials\b/i.test(text) ||
    /\bnotice\s+of\s+internet\s+availability\b/i.test(text) ||
    /\bthis\s+is\s+not\s+a\s+ballot\b/i.test(text)
  );
}

function hasVoteReminderOnlySignal(text: string): boolean {
  return /\b(?:reminder|urgent|please)\b.{0,80}\bvote\b|\byour\s+vote\s+is\s+important\b|\bvote\s+today\b|\bvote\s+now\b/i.test(text);
}

function hasSupplementProxySignal(text: string): boolean {
  return /\b(?:supplement|supplemental|amend|amended|amendment|revise|revised|update|updated|correction|corrected)\b.{0,140}\bproxy\b|\bproxy\b.{0,140}\b(?:supplemented|amended|revised|updated|corrected)\b|\bproxy\s+statement\s+is\s+hereby\s+(?:supplemented|amended|revised|updated)\b|\bsupplement\s+to\s+(?:the\s+)?(?:definitive\s+|preliminary\s+)?proxy\s+statement\b|\bamends?\s+and\s+supplements?\b|\badditional\s+proxy\s+materials?\b|\bproxy\s+supplement\b|\bproxy\s+statement\/prospectus\b/i.test(text);
}

function hasMergerProxySignal(text: string): boolean {
  return /\b(?:merger|acquisition|business\s+combination|transaction|fairness\s+opinion|special\s+committee|agreement\s+and\s+plan\s+of\s+merger)\b/i.test(text);
}

function hasContestedProxySignal(text: string): boolean {
  return /\b(?:dissident|activist|proxy\s+contest|contested\s+solicitation|opposition|universal\s+proxy|not\s+on\s+behalf\s+of\s+the\s+board|solicitation\s+is\s+being\s+made\s+by)\b/i.test(text);
}

function hasShareholderSolicitationSignal(text: string): boolean {
  return /\b(?:shareholder|stockholder)\s+proposal\b|\brule\s+14a-8\b|\bshareholder\s+solicitation\b|\bstockholder\s+solicitation\b/i.test(text);
}

function hasProxyCardVotingOptions(text: string): boolean {
  return (
    /\bFOR\b[\s|/]+(?:AGAINST|WITHHOLD)\b[\s|/]+(?:ABSTAIN|FOR\s+ALL|WITHHOLD\s+ALL|FOR\s+ALL\s+EXCEPT)\b/i.test(text) ||
    /\bFOR\s+ALL\b[\s|/]+\bWITHHOLD\s+ALL\b|\bFOR\s+ALL\s+EXCEPT\b/i.test(text)
  );
}

function detectHighRiskProxySignals(text: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ["supplement", /\bsupplement(?:al|ed)?\b/i],
    ["amend", /\bamend(?:ed|ment)?\b/i],
    ["revise", /\brevis(?:e|ed|ion)\b/i],
    ["update", /\bupdat(?:e|ed)\b/i],
    ["correction", /\bcorrect(?:ion|ed)\b/i],
    ["change", /\b(?:proxy\s+statement|proposal|meeting\s+(?:date|time|location)|board\s+recommendation|vote\s+requirement|record\s+date|disclosure|terms?)\b[^.\n]{0,120}\bchange(?:d|s)?\b|\bchange(?:d|s)?\b[^.\n]{0,120}\b(?:proxy\s+statement|proposal|meeting\s+(?:date|time|location)|board\s+recommendation|vote\s+requirement|record\s+date|disclosure|terms?)\b/i],
    ["shareholder_proposal", /\b(?:shareholder|stockholder)\s+proposal\b/i],
    ["merger", /\bmerger\b/i],
    ["acquisition", /\bacquisition\b/i],
    ["transaction", /\btransaction\b/i],
    ["fairness_opinion", /\bfairness\s+opinion\b/i],
    ["special_committee", /\bspecial\s+committee\b/i],
    ["litigation", /\blitigation\b/i],
    ["settlement", /\bsettlement\b/i],
    ["dissident", /\bdissident\b/i],
    ["activist", /\bactivist\b/i],
    ["contest", /\bcontest(?:ed)?\b/i],
    ["opposition", /\bopposition\b/i],
    ["universal_proxy", /\buniversal\s+proxy\b/i],
    ["compensation_discussion", /\bcompensation\s+discussion|executive\s+compensation[^.\n]{0,120}(?:discussion|analysis)|say-on-pay[^.\n]{0,120}(?:support|oppose|reason|because)\b/i],
    ["equity_plan", /\bequity\s+plan\b/i],
    ["incentive_plan", /\bincentive\s+plan\b/i],
    ["employee_stock_purchase_plan", /\bemployee\s+stock\s+purchase\s+plan|ESPP\b/i],
    ["repricing", /\brepricing\b/i],
    ["evergreen", /\bevergreen\b/i],
    ["reverse_split", /\breverse\s+(?:stock\s+)?split\b/i],
    ["authorized_shares", /\bauthorized\s+shares?\b/i],
    ["charter", /\bcharter\b/i],
    ["bylaw", /\bby-?law\b/i],
    ["adjournment", /\badjournment\s+proposal|\badjournment\b[^.\n]{0,120}\b(?:merger|transaction|acquisition)\b|\b(?:merger|transaction|acquisition)\b[^.\n]{0,120}\badjournment\b/i],
  ];

  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function isAdministrativeOnlyDocumentCandidate(
  proxyClass: ProxyDocumentClass,
  highRiskSignals: string[],
): boolean {
  return (
    highRiskSignals.length === 0 &&
    (
      proxyClass === "proxy_card_only" ||
      proxyClass === "voting_instruction_only" ||
      proxyClass === "notice_only" ||
      proxyClass === "vote_reminder_only"
    )
  );
}

function isAdministrativeOnlyFilingCandidate(
  documentInventory: ProxyDocumentInventoryItem[],
  proposalExtraction: ProxyProposalExtractionSummary,
  textCoverage: ProxyTextCoverageSummary,
  supplementalAnalysis: ProxySupplementalAnalysisSummary,
): boolean {
  if (proposalExtraction.countMismatch || proposalExtraction.candidates.some(isAdministrativeBlockingProposalCandidate)) {
    return false;
  }
  if (hasSupplementalAdministrativeBlocker(supplementalAnalysis)) {
    return false;
  }
  if (textCoverage.hasImageHeavyDocument) {
    const textLikeDocuments = documentInventory.filter((document) => document.isTextLike);
    return textLikeDocuments.length > 0 && textLikeDocuments.every((document) => document.administrativeOnlyCandidate);
  }
  const textLikeDocuments = documentInventory.filter((document) => document.isTextLike);
  return textLikeDocuments.length > 0 && textLikeDocuments.every((document) => document.administrativeOnlyCandidate);
}

function hasSupplementalAdministrativeBlocker(supplementalAnalysis: ProxySupplementalAnalysisSummary): boolean {
  const safeSupplementTypes = new Set<ProxySupplementalMaterialType>(["none", "proxy_card_or_reminder"]);
  const substantiveChangeSignals = supplementalAnalysis.changeSignals.filter(
    (signal) => signal.category !== "parent_reference_only" && signal.category !== "no_other_changes_statement",
  );

  return (
    (supplementalAnalysis.isSupplementalOrAmended && !safeSupplementTypes.has(supplementalAnalysis.materialType)) ||
    substantiveChangeSignals.length > 0 ||
    supplementalAnalysis.reconciliation.changedProposalIds.length > 0 ||
    supplementalAnalysis.reconciliation.meetingMetadataConflicts.length > 0 ||
    supplementalAnalysis.reconciliation.recommendationConflicts.length > 0 ||
    supplementalAnalysis.reconciliation.changedTableCaptions.length > 0
  );
}

function isAdministrativeBlockingProposalCandidate(candidate: ProxyProposalExtractionCandidate): boolean {
  const blockingCategories = new Set<ProxyDetailedProposalCategory>([
    "equity_incentive_plan",
    "employee_stock_purchase_plan",
    "charter_amendment",
    "bylaw_amendment",
    "reverse_stock_split",
    "authorized_share_increase",
    "merger_acquisition",
    "asset_sale",
    "liquidation",
    "reincorporation",
    "related_party_transaction",
    "shareholder_proposal",
    "proxy_access",
    "special_meeting_right",
    "written_consent_right",
    "classified_board",
    "supermajority_vote",
    "officer_exculpation",
    "adjournment",
  ]);

  if (blockingCategories.has(candidate.detailedCategory)) {
    return true;
  }

  return /\b(compensation discussion|say-on-pay[^.\n]{0,120}(?:support|oppose|reason|because)|executive compensation[^.\n]{0,120}(?:discussion|analysis))\b/i.test(
    `${candidate.sourceText} ${candidate.bodyText ?? ""}`,
  );
}

function countProposalHeadingCandidates(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => parseProposalCandidate(normalizeSpaces(line)))
    .filter(Boolean).length;
}

function isNearDuplicateText(left: string, right: string): boolean {
  const a = normalizeSpaces(left).slice(0, 4000);
  const b = normalizeSpaces(right).slice(0, 4000);
  if (!a || !b) return false;
  return a.includes(b.slice(0, Math.min(1000, b.length))) || b.includes(a.slice(0, Math.min(1000, a.length)));
}

function normalizeFilingText(text: string): string {
  return normalizeProxyHtmlText(text);
}

function normalizeProxyHtmlText(text: string): string {
  const withoutHidden = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ");
  const withBreaks = withoutHidden
    .replace(/<\/(?:p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " | ");

  return decodeProxyHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  /*
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, "\"")
    .replace(/&#8221;|&rdquo;/gi, "\"")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8226;|&bull;/gi, "[•]")
    .replace(/&#8201;|&#8194;|&#8203;/gi, " ")
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n");
*/
}

function decodeProxyHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, "\"")
    .replace(/&#8221;|&rdquo;/gi, "\"")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8226;|&bull;/gi, "[bullet]")
    .replace(/&#8201;|&#8194;|&#8203;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/\u200b/g, "")
    .replace(/&[#a-z0-9]+;/gi, " ");
}

function cleanString(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], keyForValue: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyForValue(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildImportantBlocks(
  text: string,
  input: {
    meetingDate: string | null;
    recordDate: string | null;
    proposals: ProxyProposal[];
    ownership: ProxyParserOutput["facts"]["ownership"];
    transaction: ProxyParserOutput["facts"]["transaction"];
    supplement: ProxySupplementFacts | null;
    contested: ProxyContestedFacts | null;
    reverseSplit: ProxyReverseSplitFacts | null;
    noticeOnly: ProxyNoticeOnlyFacts | null;
    preliminary: ProxyPreliminaryFacts | null;
  },
): ProxyRawImportantBlock[] {
  const blocks: ProxyRawImportantBlock[] = [];
  const add = (kind: ProxyRawImportantBlock["kind"], label: string, value: string | null | undefined) => {
    const rawValue = cleanString(value);
    if (!rawValue) return;
    const sourceText = sourceWindow(text, rawValue) ?? rawValue;
    blocks.push({ kind, label, text: trimBlockText(sourceText) });
  };

  add("meeting_date", "shareholder meeting date", input.meetingDate);
  add("record_date", "voting record date", input.recordDate);

  for (const proposal of input.proposals) {
    add("proposal", `${proposal.id}: ${proposal.title}`, proposal.sourceText);
  }

  add("ownership", "beneficial ownership", input.ownership.sourceText);
  add("transaction_consideration", "transaction consideration", input.transaction.consideration);
  add("transaction_vote_required", "transaction vote required", input.transaction.voteRequired);
  add("supplement", "proxy supplement or amendment", input.supplement?.sourceText);
  add("contested", "contested solicitation evidence", input.contested?.sourceText);
  add("reverse_split", "reverse split proposal evidence", input.reverseSplit?.sourceText);
  add("notice_only", "notice-only proxy evidence", input.noticeOnly?.sourceText);

  if (input.preliminary?.placeholderFields.length) {
    blocks.push({
      kind: "preliminary_placeholder",
      label: "preliminary placeholders",
      text: trimBlockText(input.preliminary.placeholderFields.join("; ")),
    });
  }

  return uniqueBlocks(blocks).slice(0, 40);
}

function buildNoiseBlocks(rawInputText: string): ProxyRawNoiseBlock[] {
  const patterns: Array<{ kind: ProxyRawNoiseBlock["kind"]; pattern: RegExp }> = [
    {
      kind: "sec_submission_wrapper",
      pattern: /<SEC-|<DOCUMENT>|<TYPE>|<SEQUENCE>|<FILENAME>|<DESCRIPTION>/gi,
    },
    {
      kind: "html_style_or_script",
      pattern: /<style\b|<script\b|font-family|mso-|(?:^|[\s"])css(?:[\s":;]|$)/gi,
    },
    {
      kind: "inline_xbrl",
      pattern: /\bix:|inline\s+xbrl|\bxbrli:/gi,
    },
    {
      kind: "page_header_or_table_of_contents",
      pattern: /table\s+of\s+contents|page\s+\d+|\n\s*\d+\s*\n/gi,
    },
    {
      kind: "proxy_access_boilerplate",
      pattern: /important\s+notice\s+regarding\s+the\s+availability\s+of\s+proxy\s+materials|notice\s+of\s+internet\s+availability/gi,
    },
    {
      kind: "voting_instruction_boilerplate",
      pattern: /control\s+number|vote\s+by\s+internet|vote\s+by\s+phone|proxy\s+card/gi,
    },
    {
      kind: "forward_looking_safe_harbor",
      pattern: /forward-looking\s+statements?|safe\s+harbor/gi,
    },
    {
      kind: "html_entity_noise",
      pattern: /&nbsp;|&#160;|&#8201;|&#8194;|&#8203;|&[#a-z0-9]+;/gi,
    },
  ];

  const blocks: ProxyRawNoiseBlock[] = [];
  for (const { kind, pattern } of patterns) {
    const matches = [...rawInputText.matchAll(pattern)];
    if (!matches.length) continue;
    const first = matches[0];
    const sample = first.index === undefined
      ? first[0]
      : rawInputText.slice(Math.max(0, first.index - 80), Math.min(rawInputText.length, first.index + first[0].length + 160));
    blocks.push({
      kind,
      count: matches.length,
      sample: trimBlockText(normalizeFilingText(sample)),
    });
  }
  return blocks;
}

function uniqueBlocks(blocks: ProxyRawImportantBlock[]): ProxyRawImportantBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = `${block.kind}:${block.label}:${block.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceWindow(text: string, value: string): string | null {
  const needle = normalizeSpaces(value);
  if (!needle) return null;
  const normalizedText = normalizeSpaces(text);
  const index = normalizedText.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return normalizedText.slice(Math.max(0, index - 160), Math.min(normalizedText.length, index + needle.length + 220));
}

function trimBlockText(value: string): string {
  return normalizeSpaces(value).slice(0, 900);
}

function firstMatchingSentence(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return normalizeSpaces(match[0]);
    }
  }
  return null;
}

function extractProxyType(
  text: string,
  secFormType: string | null,
  cover: ProxyCoverFacts | null,
): string | null {
  if (isContestedProxyMaterial(text, cover, secFormType)) {
    return "contested";
  }
  if (isLikelyNoticeOnlyMaterial(text, secFormType)) {
    return "notice_only";
  }
  if (/\bPREM14A\b/i.test(secFormType ?? "") || /\bDEFM14A\b/i.test(secFormType ?? "")) {
    return "special";
  }
  if (/\b(consent\s+solicitation|soliciting\s+written\s+consents|action\s+by\s+written\s+consent\s+in\s+lieu\s+of\s+a\s+meeting)\b/i.test(text)) {
    return "written_consent";
  }
  if (/\bannual\s+meeting\b/i.test(text)) {
    return "annual";
  }
  if (/\bspecial\s+meeting\b/i.test(text)) {
    return "special";
  }
  return null;
}

function isLikelyNoticeOnlyMaterial(text: string, secFormType: string | null): boolean {
  const isAdditionalMaterial = secFormType === "DEFA14A";
  const hasNoticeOnlyLanguage =
    /\bimportant\s+notice\s+regarding\s+the\s+availability\s+of\s+proxy\s+materials\b/i.test(text) ||
    /\bnotice\s+of\s+internet\s+availability\b/i.test(text) ||
    /\bthis\s+is\s+not\s+a\s+ballot\b/i.test(text);
  const hasSupplementChange =
    /\bproxy\s+statement\s+is\s+hereby\s+supplemented\b/i.test(text) ||
    /\bsupplement\s+to\s+(?:the\s+)?(?:definitive\s+)?proxy\s+statement\b/i.test(text) ||
    /\bno\s+longer\s+(?:be\s+)?(?:a\s+director\s+)?nominee\b/i.test(text) ||
    /\bno\s+longer\s+be\s+re-nominated\b/i.test(text);

  return isAdditionalMaterial && hasNoticeOnlyLanguage && !hasSupplementChange;
}

function isContestedProxyMaterial(
  text: string,
  cover: ProxyCoverFacts | null,
  secFormType: string | null,
): boolean {
  return (
    /\bDEFC14A\b|\bPREC14A\b/i.test(secFormType ?? "") ||
    Boolean(cover?.filedByOtherThanRegistrant) ||
    /\bTHIS\s+SOLICITATION\s+IS\s+BEING\s+MADE\s+BY\b/i.test(text) ||
    /\bnot\s+on\s+behalf\s+of\s+the\s+board\s+of\s+directors\b/i.test(text) ||
    /\bproxy\s+statement\s+of\b[\s\S]{0,120}\b(?:trian|blackwells|activist|group)\b/i.test(text)
  );
}

function extractDateNear(text: string, leadingPatterns: string[]): string | null {
  for (const leadingPattern of leadingPatterns) {
    const match = text.match(new RegExp(`${leadingPattern}(${DATE_PATTERN})`, "i"));
    if (match) {
      const sourceWindow = normalizeSpaces(match[0]);
      if (isShareholderProposalDeadlineDate(sourceWindow)) {
        continue;
      }
      return normalizeSpaces(match[1]);
    }
  }
  return null;
}

function isShareholderProposalDeadlineDate(sourceWindow: string): boolean {
  return (
    /\bheld\s+on\s+a\s+date\s+that\s+is\s+(?:before|after)\b/i.test(sourceWindow) ||
    /\bfrom\s+the\s+date\s+of\s+the\s+\d{4}\s+annual\s+meeting\b/i.test(sourceWindow) ||
    /\b(?:stockholder|shareholder)\s+proposal\b/i.test(sourceWindow) ||
    /\brule\s+14a-8\b/i.test(sourceWindow)
  );
}

function segmentProxySections(
  documents: ProxySourceDocument[],
  documentInventory: ProxyDocumentInventoryItem[],
): ProxySectionSegmentationSummary {
  const sections: ProxySectionItem[] = [];
  const tocHints: ProxySectionItem[] = [];
  const warnings: string[] = [];

  documents.forEach((document, documentIndex) => {
    if (!isTextLikeProxyDocument(document)) {
      return;
    }

    const documentClass = documentInventory[documentIndex]?.proxyClass ?? "unknown_proxy_related_material";
    const lines = normalizeFilingText(document.body).split(/\r?\n/).map((line) => line.trim());
    const headings: Array<{ lineIndex: number; heading: string; kind: ProxySectionKind; proposalId: string | null; fromToc: boolean }> = [];

    lines.forEach((line, index) => {
      const heading = normalizeSpaces(line);
      if (!heading || isLikelyPageHeaderOrFooter(heading) || hasProxyCardVotingOptions(heading)) {
        return;
      }
      const classified = classifyProxySectionHeading(lines, index, documentClass);
      if (!classified) {
        return;
      }
      headings.push({
        lineIndex: index,
        heading,
        kind: classified.kind,
        proposalId: classified.proposalId,
        fromToc: classified.fromToc,
      });
    });

    headings.forEach((heading, index) => {
      const nextHeading = headings[index + 1];
      const endLine = nextHeading ? Math.max(heading.lineIndex, nextHeading.lineIndex - 1) : Math.min(lines.length - 1, heading.lineIndex + 120);
      const bodyLines = lines.slice(heading.lineIndex, endLine + 1).filter((line) => line && !isLikelyPageHeaderOrFooter(line));
      const sourceText = trimBlockText(bodyLines.join(" "));
      const item: ProxySectionItem = {
        id: `section-${documentIndex + 1}-${index + 1}`,
        kind: heading.kind,
        heading: heading.heading,
        sourceDocumentIndex: documentIndex,
        documentClass,
        startLine: heading.lineIndex,
        endLine,
        sourceText,
        bodyTextChars: sourceText.length,
        proposalId: heading.proposalId,
        fromToc: heading.fromToc,
        confidence: heading.fromToc ? "low" : sourceText.length < 80 ? "medium" : "high",
        warnings: sourceText.length < 60 && !heading.fromToc ? ["Section heading detected but extracted body is thin."] : [],
      };

      if (item.warnings.length) {
        warnings.push(`${item.heading}: ${item.warnings[0]}`);
      }
      if (heading.fromToc) {
        tocHints.push(item);
      } else {
        sections.push(item);
      }
    });
  });

  if (tocHints.length && !sections.length) {
    warnings.push("Only table-of-contents section hints were detected; body section evidence is thin or unavailable.");
  }

  return {
    sections,
    tocHints,
    bodySectionCount: sections.length,
    warnings,
    uncertain: warnings.length > 0,
  };
}

function classifyProxySectionHeading(
  lines: string[],
  index: number,
  documentClass: ProxyDocumentClass,
): { kind: ProxySectionKind; proposalId: string | null; fromToc: boolean } | null {
  const line = normalizeSpaces(lines[index] ?? "");
  const previousContext = normalizeSpaces(lines.slice(Math.max(0, index - 12), index + 1).join(" "));
  const fromToc = /\btable\s+of\s+contents\b/i.test(previousContext) && !/\bproxy\s+statement\b/i.test(previousContext);
  if (/\|/.test(line) && /\b(?:FOR|AGAINST|ABSTAIN|WITHHOLD|FOR ALL)\b/i.test(line)) {
    return null;
  }
  const proposal = parseProposalCandidateAt(lines, index);
  if (proposal) {
    const sourceArea = classifyProposalSourceArea(lines, index, documentClass);
    if (sourceArea === "proxy_card" || sourceArea === "voting_instruction") {
      return null;
    }
    return {
      kind: fromToc || sourceArea === "notice" ? "proposal_summary" : "proposal_section",
      proposalId: normalizeProposalId(proposal.id)?.toUpperCase() ?? null,
      fromToc: fromToc || sourceArea === "toc",
    };
  }

  if (isLikelyTableHeaderLine(line) || /[.!?]$/.test(line)) {
    return null;
  }

  const kind = classifySectionKindFromHeading(line, documentClass);
  if (!kind) {
    return null;
  }

  return {
    kind,
    proposalId: null,
    fromToc,
  };
}

function classifySectionKindFromHeading(line: string, documentClass: ProxyDocumentClass): ProxySectionKind | null {
  const normalized = normalizeSpaces(line).replace(/^\d+\s+/, "").replace(/\s+\d+$/, "");
  if (documentClass === "proxy_card_only" || /\bproxy\s+card\b|\bvoting\s+instruction\s+(?:form|card)\b/i.test(normalized)) {
    return "proxy_card";
  }
  if (/^notice\s+of\s+(?:annual|special)\s+meeting\b|\bnotice\s+of\s+internet\s+availability\b/i.test(normalized)) return "notice_of_meeting";
  if (/^(?:questions?\s+and\s+answers|voting\s+information|how\s+to\s+vote|information\s+about\s+voting)\b/i.test(normalized)) return "voting_information";
  if (/^(?:proposal\s+summary|matters?\s+to\s+be\s+voted\s+on)\b/i.test(normalized)) return "proposal_summary";
  if (/^(?:corporate\s+governance|board\s+of\s+directors|governance)\b/i.test(normalized)) return "board_governance";
  if (/\b(?:director nominees?|election of directors|nominees for director)\b/i.test(normalized)) return "director_nominees";
  if (/\bdirector independence\b/i.test(normalized)) return "director_independence";
  if (/\b(?:board committees?|committee membership)\b/i.test(normalized)) return "board_committees";
  if (/\baudit committee\b/i.test(normalized)) return "audit_committee";
  if (/^executive compensation\b/i.test(normalized)) return "executive_compensation";
  if (/\bcompensation discussion and analysis\b|\bCD&A\b/i.test(normalized)) return "compensation_discussion";
  if (/\bsummary compensation table\b/i.test(normalized)) return "summary_compensation_table_area";
  if (/\bpay versus performance\b/i.test(normalized)) return "pay_versus_performance_area";
  if (/\bdirector compensation\b/i.test(normalized)) return "director_compensation";
  if (/\b(?:security ownership|beneficial ownership|ownership of securities)\b/i.test(normalized)) return "beneficial_ownership";
  if (/\brelated (?:person|party) transactions?\b/i.test(normalized)) return "related_person_transactions";
  if (/\b(?:auditor ratification|ratification of appointment|independent registered public accounting firm)\b/i.test(normalized)) return "auditor_ratification";
  if (/\baudit fees?\b/i.test(normalized)) return "audit_fees";
  if (/\b(?:equity compensation plan|equity incentive plan|incentive plan)\b/i.test(normalized)) return "equity_compensation_plan";
  if (/\b(?:shareholder|stockholder)\s+proposals?\b/i.test(normalized)) return "shareholder_proposals";
  if (/\bother matters\b/i.test(normalized)) return "other_matters";
  if (/^(?:appendix|annex)\b/i.test(normalized)) return "appendix_annex";
  return null;
}

function isLikelyTableHeaderLine(line: string): boolean {
  return (
    /\b(?:Name|Year|Fees|Total|Audit|Compensation|Shares|Percent|Number)\b(?:\s+\|\s+|\s{2,})\b(?:Name|Year|Fees|Total|Audit|Compensation|Shares|Percent|Number)\b/i.test(line) ||
    /^[|:\-\s]+$/.test(line)
  );
}

function extractProxyKeyTables(
  documents: ProxySourceDocument[],
  documentInventory: ProxyDocumentInventoryItem[],
  sectionSegmentation: ProxySectionSegmentationSummary,
  proposalExtraction: ProxyProposalExtractionSummary,
): ProxyKeyTableExtractionSummary {
  const tables: ProxyKeyTableItem[] = [];
  const warnings: string[] = [];
  let ignoredLayoutTableCount = 0;
  let damagedTableCount = 0;

  documents.forEach((document, documentIndex) => {
    if (!isTextLikeProxyDocument(document)) {
      return;
    }
    const documentClass = documentInventory[documentIndex]?.proxyClass ?? "unknown_proxy_related_material";
    const parsedTables = parseHtmlTables(document.body);

    parsedTables.forEach((table, tableIndex) => {
      const nearbyHeading = nearestHeadingBefore(document.body, table.startIndex);
      const lineNumber = normalizeFilingText(document.body.slice(0, table.startIndex)).split(/\r?\n/).length - 1;
      const linkedSection = findNearestSection(sectionSegmentation.sections, documentIndex, lineNumber);
      const context = normalizeSpaces([
        nearbyHeading,
        table.caption,
        linkedSection?.heading,
        table.headers.join(" "),
        table.rows.flat().join(" "),
      ].filter(Boolean).join(" "));
      const layout = isLayoutProxyTable(table, context);
      if (layout) {
        ignoredLayoutTableCount += 1;
        return;
      }

      const tableType = classifyProxyKeyTable(context);
      if (tableType === null) {
        ignoredLayoutTableCount += 1;
        return;
      }

      const tableWarnings = [...table.warnings];
      if (table.rowCount < 2 || table.columnCount < 2) {
        tableWarnings.push("Table structure appears damaged or too thin for reliable row/column extraction.");
      }
      if (tableWarnings.length) {
        damagedTableCount += 1;
        warnings.push(`${table.caption || nearbyHeading || tableType}: ${tableWarnings[0]}`);
      }

      const proposalId = linkTableToProposal(tableType, context, linkedSection, proposalExtraction);
      tables.push({
        id: `table-${documentIndex + 1}-${tableIndex + 1}`,
        tableType,
        heading: nearbyHeading,
        caption: table.caption,
        sourceDocumentIndex: documentIndex,
        documentClass,
        sectionKind: linkedSection?.kind ?? null,
        proposalId,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        headers: table.headers,
        sampleRows: table.rows.slice(0, 4),
        confidence: tableWarnings.length ? "medium" : "high",
        warnings: tableWarnings,
        isLayoutTable: false,
      });
    });
  });

  if (ignoredLayoutTableCount >= 6) {
    warnings.push("Many tables were ignored as layout/navigation tables; verify important proxy tables were not image-based or malformed.");
  }

  return {
    tables,
    ignoredLayoutTableCount,
    damagedTableCount,
    warnings,
    uncertain: warnings.length > 0,
  };
}

type ParsedProxyTable = {
  caption: string | null;
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  startIndex: number;
  warnings: string[];
};

function parseHtmlTables(html: string): ParsedProxyTable[] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => {
    const tableHtml = match[0] ?? "";
    const captionRaw = extractFirstMatch(tableHtml, /<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionRaw ? cleanString(normalizeFilingText(captionRaw)) : null;
    const warnings: string[] = [];
    if (/\browspan\s*=|\bcolspan\s*=/i.test(tableHtml)) {
      warnings.push("Table contains rowspan/colspan; normalization is approximate.");
    }

    const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((rowMatch) => parseHtmlTableRow(rowMatch[1] ?? "", warnings))
      .filter((row) => row.some((cell) => cell));
    const headerRow = rows.find((row, index) => index === 0 || row.some((cell) => /name|year|fees?|total|shares?|percent|committee|skill|compensation|award|value/i.test(cell))) ?? [];
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

    return {
      caption,
      headers: headerRow,
      rows,
      rowCount: rows.length,
      columnCount,
      startIndex: match.index ?? 0,
      warnings: unique(warnings),
    };
  });
}

function parseHtmlTableRow(rowHtml: string, warnings: string[]): string[] {
  const cells: string[] = [];
  for (const cellMatch of rowHtml.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
    const attrs = cellMatch[1] ?? "";
    const text = normalizeTableCellText(cellMatch[2] ?? "");
    const colspan = Number((attrs.match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1"));
    const rowspan = Number((attrs.match(/\browspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1"));
    if (rowspan > 1) warnings.push("Table contains rowspan; row alignment may be approximate.");
    const repeat = Number.isFinite(colspan) && colspan > 1 && colspan <= 12 ? colspan : 1;
    for (let index = 0; index < repeat; index += 1) {
      cells.push(text);
    }
  }
  return cells;
}

function normalizeTableCellText(html: string): string {
  return normalizeSpaces(normalizeFilingText(html).replace(/\(\d+\)|\[\d+\]|†|‡|[*]/g, " "));
}

function extractFirstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1] ?? null;
}

function nearestHeadingBefore(html: string, startIndex: number): string | null {
  const prefixText = normalizeFilingText(html.slice(Math.max(0, startIndex - 5000), startIndex));
  const lines = prefixText.split(/\r?\n/).map((line) => normalizeSpaces(line)).filter(Boolean);
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 30); index -= 1) {
    const line = lines[index];
    if (!line || isLikelyPageHeaderOrFooter(line) || isLikelyTableHeaderLine(line)) continue;
    if (classifySectionKindFromHeading(line, "proxy_body") || parseProposalCandidate(line)) {
      return line;
    }
  }
  return null;
}

function findNearestSection(
  sections: ProxySectionItem[],
  documentIndex: number,
  lineNumber: number,
): ProxySectionItem | null {
  return [...sections]
    .filter((section) => section.sourceDocumentIndex === documentIndex && section.startLine <= lineNumber)
    .sort((a, b) => b.startLine - a.startLine)[0] ?? null;
}

function isLayoutProxyTable(table: ParsedProxyTable, context: string): boolean {
  const cellTexts = table.rows.flat().filter(Boolean);
  if (/\b(summary compensation table|pay versus performance|audit fees?|beneficial ownership|security ownership|equity compensation plan|new plan benefits?)\b/i.test(context)) {
    return false;
  }
  if (table.rowCount <= 1 && table.columnCount <= 1) return true;
  if (cellTexts.length <= 2) return true;
  if (cellTexts.filter((cell) => cell.length <= 2).length / Math.max(1, cellTexts.length) > 0.75) return true;
  if (/\b(?:home|previous|next|table of contents|back to top|logo|image)\b/i.test(context) && cellTexts.length < 12) return true;
  if (hasProxyCardVotingOptions(context) && !/\b(?:compensation|fees?|ownership|shares|award|committee|nominee|skills?|performance)\b/i.test(context)) {
    return true;
  }
  return false;
}

function classifyProxyKeyTable(context: string): ProxyKeyTableType | null {
  if (/\bpay versus performance\b/i.test(context)) return "pay_versus_performance";
  if (/\bsummary compensation table\b/i.test(context)) return "summary_compensation_table";
  if (/\bgrants? of plan-based awards?\b/i.test(context)) return "grants_of_plan_based_awards";
  if (/\boutstanding equity awards?\b/i.test(context)) return "outstanding_equity_awards";
  if (/\boption exercises? and stock vested\b/i.test(context)) return "option_exercises_and_stock_vested";
  if (/\bpension benefits?\b/i.test(context)) return "pension_benefits";
  if (/\bnonqualified deferred compensation\b/i.test(context)) return "nonqualified_deferred_compensation";
  if (/\bdirector compensation\b/i.test(context)) return "director_compensation";
  if (/\bnew plan benefits?\b/i.test(context)) return "new_plan_benefits";
  if (/\bequity compensation plan information\b|\bnumber of securities to be issued\b|\bweighted-average exercise price\b/i.test(context)) {
    return "equity_compensation_plan_information";
  }
  if (/\baudit fees?\b|\baudit-related fees?\b|\btax fees?\b|\ball other fees?\b/i.test(context)) return "audit_fee_table";
  if (/\bbeneficial ownership\b|\bsecurity ownership\b|\bpercent of class\b|\bshares beneficially owned\b/i.test(context)) return "beneficial_ownership";
  if (/\bcommittee\b/i.test(context) && /\b(?:audit|compensation|nominating|governance)\b/i.test(context)) {
    return "committee_membership_table";
  }
  if (/\bskills? matrix\b|\b(?:finance|cybersecurity|leadership|industry experience|risk management)\b/i.test(context) && /\bdirector\b/i.test(context)) {
    return "board_skills_matrix";
  }
  if (/\b(?:director nominee|nominee|age|class|director since|principal occupation)\b/i.test(context)) return "director_nominee_table";
  if (/\bproposal\b/i.test(context) && /\b(?:board recommendation|vote required|for|against|abstain)\b/i.test(context)) {
    return "proposal_summary_table";
  }
  return null;
}

function linkTableToProposal(
  tableType: ProxyKeyTableType,
  context: string,
  linkedSection: ProxySectionItem | null,
  proposalExtraction: ProxyProposalExtractionSummary,
): string | null {
  if (linkedSection?.proposalId) return linkedSection.proposalId;
  const desiredCategory = tableLinkedDetailedCategory(tableType);
  if (!desiredCategory) return null;
  const candidate = proposalExtraction.candidates.find((proposal) =>
    proposal.detailedCategory === desiredCategory ||
    (desiredCategory === "say_on_pay" && proposal.category === "compensation") ||
    normalizeProposalTitleForMatching(context).includes(proposal.normalizedTitle),
  );
  return candidate?.id ?? null;
}

function tableLinkedDetailedCategory(tableType: ProxyKeyTableType): ProxyDetailedProposalCategory | null {
  if (tableType === "director_nominee_table" || tableType === "board_skills_matrix") return "director_election";
  if (tableType === "audit_fee_table") return "auditor_ratification";
  if (tableType === "summary_compensation_table" || tableType === "pay_versus_performance") return "say_on_pay";
  if (tableType === "equity_compensation_plan_information" || tableType === "new_plan_benefits") return "equity_incentive_plan";
  return null;
}

function detectProxyTextCoverage(
  documents: ProxySourceDocument[],
  documentInventory: ProxyDocumentInventoryItem[],
): ProxyTextCoverageSummary {
  const items = documents.map((document, index) => {
    const rawChars = document.body.length;
    const textChars = normalizeFilingText(document.body).length;
    const imageReferenceCount = [...document.body.matchAll(/<img\b|\.(?:jpg|jpeg|png|gif|svg)\b/gi)].length;
    const htmlTableCount = [...document.body.matchAll(/<table\b/gi)].length;
    const textCoverageRatio = rawChars > 0 ? textChars / rawChars : 1;
    const imageHeavy =
      imageReferenceCount >= 3 &&
      (textChars < 1200 || textCoverageRatio < 0.25) &&
      !documentInventory[index]?.administrativeOnlyCandidate;
    return {
      sourceDocumentIndex: index,
      documentClass: documentInventory[index]?.proxyClass ?? "unknown_proxy_related_material",
      rawChars,
      textChars,
      imageReferenceCount,
      htmlTableCount,
      textCoverageRatio: Number(textCoverageRatio.toFixed(3)),
      imageHeavy,
      warning: imageHeavy ? "Document appears image-heavy or low-text; parser evidence may be incomplete without OCR." : null,
    };
  });
  const warnings = items.map((item) => item.warning).filter((warning): warning is string => Boolean(warning));
  return {
    documents: items,
    hasImageHeavyDocument: items.some((item) => item.imageHeavy),
    warnings,
  };
}

function analyzeSupplementalProxyMaterials(
  documents: ProxySourceDocument[],
  documentInventory: ProxyDocumentInventoryItem[],
  proposalExtraction: ProxyProposalExtractionSummary,
  sectionSegmentation: ProxySectionSegmentationSummary,
  keyTableExtraction: ProxyKeyTableExtractionSummary,
): ProxySupplementalAnalysisSummary {
  const documentKinds = documents.map((document, index) => {
    const text = normalizeFilingText(document.body);
    const materialType = classifySupplementalMaterialType(text, documentInventory[index]?.proxyClass ?? "unknown_proxy_related_material");
    return {
      sourceDocumentIndex: index,
      documentClass: documentInventory[index]?.proxyClass ?? "unknown_proxy_related_material",
      materialType,
      evidence: firstSupplementalMaterialEvidence(text),
    };
  });
  const combinedText = normalizeFilingText(documents.map((document) => document.body).join("\n\n"));
  const parentReferences = extractParentProxyReferences(combinedText);
  const changeSignals = extractSupplementChangeSignals(combinedText, proposalExtraction);
  const reconciliation = reconcileLocalParentAndSupplement(documents, documentKinds);
  const isSupplementalOrAmended =
    documentKinds.some((document) => document.materialType !== "none" && document.materialType !== "proxy_card_or_reminder") ||
    changeSignals.length > 0 ||
    parentReferences.length > 0;
  const materialType = chooseSupplementalMaterialType(documentKinds, changeSignals);
  const warnings = buildSupplementalAnalysisWarnings({
    isSupplementalOrAmended,
    materialType,
    parentReferences,
    changeSignals,
    reconciliation,
    proposalExtraction,
    sectionSegmentation,
    keyTableExtraction,
  });

  return {
    isSupplementalOrAmended,
    materialType,
    documentKinds,
    parentReferences,
    changeSignals,
    reconciliation,
    warnings,
    uncertain: warnings.length > 0,
  };
}

function classifySupplementalMaterialType(
  text: string,
  documentClass: ProxyDocumentClass,
): ProxySupplementalMaterialType {
  if (
    (
      documentClass === "proxy_card_only" ||
      documentClass === "vote_reminder_only" ||
      documentClass === "voting_instruction_only" ||
      documentClass === "notice_only"
    ) &&
    !hasSupplementProxySignal(text) &&
    !hasSubstantiveSupplementChangeLanguage(text)
  ) {
    return "proxy_card_or_reminder";
  }
  if (/\bproxy\s+statement\/prospectus\b|\bmerger\b|\bfairness\s+opinion\b|\bspecial\s+committee\b/i.test(text) && hasSupplementProxySignal(text)) {
    return "transaction_update";
  }
  if (/\bcorrection\s+to\s+(?:the\s+)?proxy\s+statement\b|\bcorrected\s+proxy\s+statement\b|\bproxy\s+statement\s+is\s+hereby\s+corrected\b/i.test(text)) return "correction_to_proxy_statement";
  if (/\brevised\s+proxy\s+statement\b|\brevision\s+to\s+(?:the\s+)?proxy\s+statement\b|\bproxy\s+statement\s+is\s+(?:hereby\s+)?revised\b|\bPRER14A\b|\bDEFR14A\b/i.test(text)) return "revised_proxy_statement";
  if (/\bamended\s+proxy\s+statement\b|\bamendment\s+to\s+(?:the\s+)?proxy\s+statement\b|\bproxy\s+statement\s+is\s+hereby\s+amended\b/i.test(text)) return "amended_proxy_statement";
  if (/\bsupplemental\s+proxy\s+statement\b|\bsupplement\s+to\s+(?:the\s+)?(?:definitive\s+|preliminary\s+)?proxy\s+statement\b|\bproxy\s+supplement\b|\bamends\s+and\s+supplements\b|\bupdate\s+to\s+(?:the\s+)?proxy\s+statement\b/i.test(text)) {
    return "supplemental_proxy_statement";
  }
  if (/\badditional\s+proxy\s+materials?\b|\bdefinitive\s+additional\s+materials\b/i.test(text)) return "additional_proxy_material";
  if (/\bshareholder\s+letter\b|\bstockholder\s+letter\b|\bsolicitation\b|\bdissident\b|\bactivist\b/i.test(text) && documentClass !== "proxy_body") {
    return "shareholder_letter_or_solicitation";
  }
  return "none";
}

function firstSupplementalMaterialEvidence(text: string): string | null {
  return firstMatchingSentence(text, [
    /[^.\n]*\bsupplement\s+to\s+(?:the\s+)?(?:definitive\s+|preliminary\s+)?proxy\s+statement[^.\n]*\./i,
    /[^.\n]*\bsupplemental\s+proxy\s+statement[^.\n]*\./i,
    /[^.\n]*\bamends?\s+and\s+supplements?[^.\n]*proxy[^.\n]*\./i,
    /[^.\n]*\bamended\s+proxy\s+statement[^.\n]*\./i,
    /[^.\n]*\brevised\s+proxy\s+statement[^.\n]*\./i,
    /[^.\n]*\bcorrection\s+to\s+(?:the\s+)?proxy\s+statement[^.\n]*\./i,
    /[^.\n]*\badditional\s+proxy\s+materials?[^.\n]*\./i,
  ]);
}

function hasSubstantiveSupplementChangeLanguage(text: string): boolean {
  return /\b(?:amend|amended|amendment|supplement|supplemented|supplemental|revise|revised|revision|update|updated|correction|corrected)\b[^.\n]{0,160}\b(?:proxy|proposal|meeting|recommendation|disclosure|statement)\b|\b(?:proxy|proposal|meeting|recommendation|disclosure|statement)\b[^.\n]{0,160}\b(?:amended|supplemented|revised|updated|corrected)\b|\b(?:withdraw|withdrawn|adjourn|postpone|new proposal|additional proposal)\b/i.test(text);
}

function chooseSupplementalMaterialType(
  documentKinds: ProxySupplementalAnalysisSummary["documentKinds"],
  changeSignals: ProxySupplementChangeSignal[],
): ProxySupplementalMaterialType {
  const priority: ProxySupplementalMaterialType[] = [
    "transaction_update",
    "amended_proxy_statement",
    "revised_proxy_statement",
    "correction_to_proxy_statement",
    "supplemental_proxy_statement",
    "additional_proxy_material",
    "shareholder_letter_or_solicitation",
    "proxy_card_or_reminder",
  ];
  for (const type of priority) {
    if (documentKinds.some((document) => document.materialType === type)) return type;
  }
  if (changeSignals.length) return "unknown_supplemental_material";
  return "none";
}

function extractParentProxyReferences(text: string): ProxyParentReference[] {
  const references: ProxyParentReference[] = [];
  const patterns: Array<{ referenceType: ProxyParentReference["referenceType"]; pattern: RegExp }> = [
    { referenceType: "definitive_proxy_statement", pattern: /[^.\n]*\bdefinitive\s+proxy\s+statement[^.\n]*(?:filed\s+with\s+the\s+SEC|filed\s+with\s+the\s+Securities\s+and\s+Exchange\s+Commission|dated|previously\s+filed)[^.\n]*\./gi },
    { referenceType: "annual_meeting_proxy", pattern: /[^.\n]*\bsupplement\s+to\s+(?:the\s+)?proxy\s+statement\s+for\s+(?:the\s+)?annual\s+meeting[^.\n]*\./gi },
    { referenceType: "special_meeting_proxy", pattern: /[^.\n]*\bsupplement\s+to\s+(?:the\s+)?proxy\s+statement\s+for\s+(?:the\s+)?special\s+meeting[^.\n]*\./gi },
    { referenceType: "proxy_statement_prospectus", pattern: /[^.\n]*\bproxy\s+statement\/prospectus[^.\n]*(?:dated|filed|mailed|previously\s+filed)?[^.\n]*\./gi },
    { referenceType: "previously_mailed_proxy", pattern: /[^.\n]*\bpreviously\s+mailed\s+proxy\s+statement[^.\n]*\./gi },
    { referenceType: "previously_filed_proxy", pattern: /[^.\n]*\bproxy\s+statement\s+previously\s+filed[^.\n]*\./gi },
    { referenceType: "generic_parent_proxy", pattern: /[^.\n]*\b(?:as\s+previously\s+disclosed|as\s+set\s+forth\s+in\s+the\s+proxy\s+statement|proxy\s+statement\s+dated)[^.\n]*\./gi },
  ];

  for (const { referenceType, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const evidence = normalizeSpaces(match[0]);
      references.push({
        referenceType,
        date: extractFirstDate(evidence),
        evidence,
        confidence: extractFirstDate(evidence) ? "high" : "medium",
      });
    }
  }

  return uniqueBy(references, (reference) => `${reference.referenceType}:${reference.evidence}`).slice(0, 10);
}

function extractSupplementChangeSignals(
  text: string,
  proposalExtraction: ProxyProposalExtractionSummary,
): ProxySupplementChangeSignal[] {
  const signalPatterns: Array<{
    category: ProxySupplementChangeCategory;
    label: string;
    pattern: RegExp;
    confidence: "high" | "medium" | "low";
  }> = [
    { category: "meeting_date_change", label: "meeting date change", pattern: /\b(?:meeting\s+date|annual\s+meeting|special\s+meeting)[^.\n]{0,120}\b(?:changed|rescheduled|postponed|adjourned|new\s+date|now\s+be\s+held|will\s+now\s+be\s+held)\b[^.\n]*\./i, confidence: "high" },
    { category: "meeting_time_change", label: "meeting time change", pattern: /\b(?:meeting\s+time|time\s+of\s+the\s+meeting)[^.\n]{0,120}\b(?:changed|rescheduled|updated|new\s+time)\b[^.\n]*\./i, confidence: "high" },
    { category: "meeting_location_change", label: "meeting location or virtual meeting change", pattern: /\b(?:location|virtual\s+meeting|meeting\s+site|webcast)[^.\n]{0,120}\b(?:changed|updated|moved|held\s+virtually)\b[^.\n]*\./i, confidence: "high" },
    { category: "record_date_change", label: "record date change", pattern: /\brecord\s+date[^.\n]{0,120}\b(?:changed|updated|new|revised)\b[^.\n]*\./i, confidence: "high" },
    { category: "proposal_added", label: "proposal added", pattern: /\b(?:new|additional)\s+proposal\b[^.\n]*\.|\bproposal\s+\d+[A-Za-z]?[^.\n]{0,120}\b(?:has\s+been\s+added|is\s+added|was\s+added)\b[^.\n]*\./i, confidence: "high" },
    { category: "proposal_removed", label: "proposal removed", pattern: /\bproposal\s+\d+[A-Za-z]?[^.\n]{0,120}\b(?:removed|withdrawn|will\s+not\s+be\s+presented|no\s+longer\s+will\s+be\s+voted)\b[^.\n]*\./i, confidence: "high" },
    { category: "proposal_title_changed", label: "proposal title changed", pattern: /\bproposal\s+\d+[A-Za-z]?[^.\n]{0,120}\b(?:title|description)[^.\n]{0,80}\b(?:changed|revised|updated)\b[^.\n]*\./i, confidence: "medium" },
    { category: "proposal_number_changed", label: "proposal number changed", pattern: /\bproposal\s+number[^.\n]{0,120}\b(?:changed|renumbered|revised)\b[^.\n]*\./i, confidence: "medium" },
    { category: "board_recommendation_changed", label: "board recommendation changed", pattern: /\b(?:Board|Board\s+of\s+Directors|Management)[^.\n]{0,160}\b(?:changed|revised|withdrawn|makes?\s+no\s+recommendation|now\s+recommends?)\b[^.\n]*\./i, confidence: "high" },
    { category: "vote_requirement_changed", label: "vote requirement changed", pattern: /\bvote\s+required[^.\n]{0,120}\b(?:changed|revised|updated)\b[^.\n]*\.|\b(?:quorum|abstentions?|broker\s+non-votes?)[^.\n]{0,120}\b(?:changed|revised|updated)\b[^.\n]*\./i, confidence: "high" },
    { category: "adjournment_or_postponement", label: "meeting adjournment or postponement", pattern: /\b(?:adjourned|adjournment|postponed|postponement|reconvened)\b[^.\n]*\./i, confidence: "high" },
    { category: "nominee_change", label: "director nominee change", pattern: /\b(?:nominee|director nominee)[^.\n]{0,120}\b(?:added|removed|withdrawn|withdrew|replaced|no\s+longer)\b[^.\n]*\.|\b(?:will\s+no\s+longer\s+be\s+re-nominated|no\s+longer\s+(?:be\s+)?(?:a\s+director\s+)?nominee|withdrawn\s+(?:its\s+)?nomination)\b[^.\n]*\./i, confidence: "high" },
    { category: "auditor_update", label: "auditor or audit proposal update", pattern: /\b(?:auditor|independent registered public accounting firm|audit proposal)[^.\n]{0,120}\b(?:changed|updated|revised|resigned|dismissed|appointed)\b[^.\n]*\./i, confidence: "medium" },
    { category: "compensation_update", label: "compensation disclosure update", pattern: /\b(?:compensation|say-on-pay|summary compensation table|CD&A)[^.\n]{0,120}\b(?:updated|revised|corrected|amended)\b[^.\n]*\./i, confidence: "medium" },
    { category: "equity_plan_update", label: "equity or incentive plan update", pattern: /\b(?:equity incentive plan|stock incentive plan|incentive plan|share reserve|reserve|repricing|evergreen)[^.\n]{0,160}\b(?:updated|revised|increased|decreased|changed|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "reverse_split_ratio_update", label: "reverse split ratio update", pattern: /\breverse\s+(?:stock\s+)?split[^.\n]{0,160}\b(?:ratio|range|one-for-|1-for-|\d+\s*:\s*\d+)[^.\n]{0,120}\b(?:updated|revised|changed|amended|set|fixed)\b[^.\n]*\./i, confidence: "high" },
    { category: "authorized_share_update", label: "authorized share amount update", pattern: /\bauthorized\s+shares?[^.\n]{0,160}\b(?:updated|revised|changed|increased|decreased|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "charter_bylaw_update", label: "charter or bylaw amendment update", pattern: /\b(?:charter|certificate of incorporation|by-?laws?)[^.\n]{0,160}\b(?:updated|revised|changed|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "shareholder_proposal_update", label: "shareholder proposal update", pattern: /\b(?:shareholder|stockholder)\s+proposal[^.\n]{0,160}\b(?:added|withdrawn|excluded|changed|revised|updated)\b[^.\n]*\./i, confidence: "high" },
    { category: "litigation_update", label: "litigation update", pattern: /\blitigation[^.\n]{0,160}\b(?:updated|settled|resolved|filed|dismissed|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "settlement_update", label: "settlement update", pattern: /\bsettlement[^.\n]{0,160}\b(?:agreement|updated|reached|approved|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "merger_agreement_update", label: "merger agreement update", pattern: /\bmerger\s+agreement[^.\n]{0,160}\b(?:amended|updated|revised|changed)\b[^.\n]*\./i, confidence: "high" },
    { category: "merger_consideration_update", label: "merger consideration or price update", pattern: /\b(?:merger consideration|per share|purchase price|price)[^.\n]{0,160}\b(?:increased|decreased|changed|revised|updated|amended)\b[^.\n]*\./i, confidence: "high" },
    { category: "fairness_opinion_update", label: "fairness opinion update", pattern: /\bfairness\s+opinion[^.\n]{0,160}\b(?:updated|revised|supplemented|delivered|received)\b[^.\n]*\./i, confidence: "high" },
    { category: "special_committee_update", label: "special committee update", pattern: /\bspecial\s+committee[^.\n]{0,160}\b(?:updated|approved|recommended|formed|determined)\b[^.\n]*\./i, confidence: "high" },
    { category: "financing_update", label: "financing update", pattern: /\bfinancing[^.\n]{0,160}\b(?:updated|revised|amended|committed|obtained|condition)\b[^.\n]*\./i, confidence: "medium" },
    { category: "regulatory_approval_update", label: "regulatory approval update", pattern: /\bregulatory\s+approval[^.\n]{0,160}\b(?:updated|received|condition|clearance|approved|pending)\b[^.\n]*\./i, confidence: "medium" },
    { category: "deal_terms_update", label: "deal terms update", pattern: /\b(?:go-shop|no-shop|termination fee|closing condition)[^.\n]{0,160}\b(?:updated|revised|amended|changed)\b[^.\n]*\./i, confidence: "medium" },
    { category: "proxy_contest_update", label: "proxy contest or activist update", pattern: /\b(?:proxy contest|dissident|activist|opposition|universal proxy)[^.\n]{0,160}\b(?:updated|changed|revised|withdrawn|settled)\b[^.\n]*\./i, confidence: "high" },
    { category: "no_other_changes_statement", label: "no other changes statement", pattern: /\bexcept\s+as\s+(?:described|set\s+forth)\s+in\s+this\s+supplement[^.\n]{0,180}\bno\s+other\s+changes\b[^.\n]*\./i, confidence: "medium" },
  ];

  const signals: ProxySupplementChangeSignal[] = [];
  for (const { category, label, pattern, confidence } of signalPatterns) {
    const sentence = firstMatchingSentence(text, [pattern]);
    if (!sentence) continue;
    signals.push({
      category,
      label,
      sourceText: sentence,
      proposalId: inferProposalIdFromText(sentence, proposalExtraction),
      confidence,
    });
  }

  if (extractParentProxyReferences(text).length && signals.length === 0) {
    const parentReference = extractParentProxyReferences(text)[0];
    signals.push({
      category: "parent_reference_only",
      label: "parent proxy referenced without specific detected change",
      sourceText: parentReference.evidence,
      proposalId: null,
      confidence: "low",
    });
  }

  return uniqueBy(signals, (signal) => `${signal.category}:${signal.sourceText}`).slice(0, 30);
}

function reconcileLocalParentAndSupplement(
  documents: ProxySourceDocument[],
  documentKinds: ProxySupplementalAnalysisSummary["documentKinds"],
): ProxySupplementReconciliation {
  const empty: ProxySupplementReconciliation = {
    available: false,
    parentDocumentIndex: null,
    supplementDocumentIndex: null,
    nearDuplicate: false,
    noSubstantiveChangeStatement: false,
    addedParagraphs: [],
    changedProposalIds: [],
    meetingMetadataConflicts: [],
    recommendationConflicts: [],
    changedTableCaptions: [],
    warnings: [],
  };
  const supplementKind = documentKinds.find(
    (document) => document.materialType !== "none" && document.materialType !== "proxy_card_or_reminder",
  );
  if (!supplementKind) {
    return empty;
  }

  const supplementIndex = supplementKind.sourceDocumentIndex;
  const parentIndex = documents.findIndex((document, index) => {
    if (index === supplementIndex || !isTextLikeProxyDocument(document)) return false;
    const kind = documentKinds[index]?.materialType ?? "none";
    if (kind !== "none" && kind !== "proxy_card_or_reminder") return false;
    const text = normalizeFilingText(document.body);
    return /\b(?:proxy\s+statement|annual\s+meeting|special\s+meeting|notice\s+of\s+meeting)\b/i.test(text);
  });

  if (parentIndex < 0) {
    return {
      ...empty,
      supplementDocumentIndex: supplementIndex,
    };
  }

  const parentDocument = documents[parentIndex];
  const supplementDocument = documents[supplementIndex];
  const parentText = normalizeFilingText(parentDocument?.body ?? "");
  const supplementText = normalizeFilingText(supplementDocument?.body ?? "");
  const parentProposals = extractProposals(parentText);
  const supplementProposals = extractProposals(supplementText);
  const changedProposalIds = unique(
    supplementProposals
      .filter((proposal) => !parentProposals.some((parentProposal) => areSameReconciledProposal(parentProposal, proposal)))
      .map((proposal) => proposal.id),
  ).slice(0, 20);
  const meetingMetadataConflicts = compareMeetingMetadata(parentText, supplementText);
  const recommendationConflicts = unique([
    ...compareProposalRecommendations(parentProposals, supplementProposals),
    ...compareRecommendationEvidence(parentText, supplementText),
  ]);
  const addedParagraphs = findAddedParagraphs(parentText, supplementText);
  const changedTableCaptions = compareTableCaptions(parentDocument?.body ?? "", supplementDocument?.body ?? "");
  const noSubstantiveChangeStatement = /\bexcept\s+as\s+(?:described|set\s+forth)\s+in\s+this\s+supplement[^.\n]{0,180}\bno\s+other\s+changes\b/i.test(supplementText);
  const nearDuplicate = isNearDuplicateText(parentText, supplementText);
  const warnings: string[] = [];

  if (changedProposalIds.length) {
    warnings.push("Local parent/supplement comparison found added or changed proposal evidence.");
  }
  if (meetingMetadataConflicts.length) {
    warnings.push("Local parent/supplement comparison found conflicting meeting metadata.");
  }
  if (recommendationConflicts.length) {
    warnings.push("Local parent/supplement comparison found conflicting board recommendation evidence.");
  }
  if (changedTableCaptions.length) {
    warnings.push("Local parent/supplement comparison found changed or added table captions.");
  }

  return {
    available: true,
    parentDocumentIndex: parentIndex,
    supplementDocumentIndex: supplementIndex,
    nearDuplicate,
    noSubstantiveChangeStatement,
    addedParagraphs,
    changedProposalIds,
    meetingMetadataConflicts,
    recommendationConflicts,
    changedTableCaptions,
    warnings,
  };
}

function buildSupplementalAnalysisWarnings(input: {
  isSupplementalOrAmended: boolean;
  materialType: ProxySupplementalMaterialType;
  parentReferences: ProxyParentReference[];
  changeSignals: ProxySupplementChangeSignal[];
  reconciliation: ProxySupplementReconciliation;
  proposalExtraction: ProxyProposalExtractionSummary;
  sectionSegmentation: ProxySectionSegmentationSummary;
  keyTableExtraction: ProxyKeyTableExtractionSummary;
}): string[] {
  const warnings = [...input.reconciliation.warnings];
  const substantiveChangeSignals = input.changeSignals.filter(
    (signal) => signal.category !== "parent_reference_only" && signal.category !== "no_other_changes_statement",
  );

  if (input.parentReferences.length && !input.reconciliation.available) {
    warnings.push("Supplement references a parent proxy, but local parent proxy text was unavailable for reconciliation.");
  }
  if (input.parentReferences.some((reference) => !reference.date)) {
    warnings.push("Parent proxy reference date could not be confidently parsed.");
  }
  if (
    input.isSupplementalOrAmended &&
    isAmendmentLikeSupplementalType(input.materialType) &&
    !substantiveChangeSignals.length &&
    !input.reconciliation.addedParagraphs.length &&
    !input.reconciliation.changedProposalIds.length &&
    !input.reconciliation.nearDuplicate
  ) {
    warnings.push("Supplement/amendment language detected, but parser did not find a specific changed term.");
  }
  if (input.changeSignals.some((signal) => signal.category === "board_recommendation_changed")) {
    warnings.push("Supplement appears to change board recommendation evidence; do not silently overwrite conflicting recommendation text.");
  }
  if (
    input.changeSignals.some((signal) =>
      signal.category === "proposal_added" ||
      signal.category === "proposal_removed" ||
      signal.category === "proposal_title_changed" ||
      signal.category === "proposal_number_changed"
    )
  ) {
    warnings.push("Supplement appears to change proposal count, numbering, or title evidence; preserve parent and supplement candidates.");
  }
  if (input.proposalExtraction.countMismatch) {
    warnings.push("Proposal counts differ across notice, body, proxy card, or supplement sources.");
  }

  const tableUpdateCategories = new Set<ProxySupplementChangeCategory>([
    "auditor_update",
    "compensation_update",
    "equity_plan_update",
    "reverse_split_ratio_update",
    "authorized_share_update",
    "merger_consideration_update",
    "fairness_opinion_update",
  ]);
  if (input.changeSignals.some((signal) => tableUpdateCategories.has(signal.category)) && !input.keyTableExtraction.tables.length) {
    warnings.push("Supplement suggests a table-sensitive update, but parser did not link a related key proxy table.");
  }
  if (
    input.changeSignals.some((signal) => signal.category === "shareholder_proposal_update" || signal.category === "proxy_contest_update") &&
    !input.sectionSegmentation.sections.some((section) => section.kind === "shareholder_proposals" || section.kind === "proposal_section")
  ) {
    warnings.push("Supplement suggests a proposal or solicitation update, but parser could not link it to a section.");
  }

  return unique(warnings);
}

function isAmendmentLikeSupplementalType(materialType: ProxySupplementalMaterialType): boolean {
  return (
    materialType === "supplemental_proxy_statement" ||
    materialType === "amended_proxy_statement" ||
    materialType === "revised_proxy_statement" ||
    materialType === "correction_to_proxy_statement" ||
    materialType === "transaction_update" ||
    materialType === "unknown_supplemental_material"
  );
}

function inferProposalIdFromText(
  text: string,
  proposalExtraction: ProxyProposalExtractionSummary,
): string | null {
  const explicit = text.match(/\b(?:Proposal|Item|Matter)\s+(?:(?:No\.?|Number)\s*)?([0-9A-Za-z]+)\b/i);
  if (explicit?.[1]) {
    const normalized = normalizeProposalId(explicit[1]);
    if (normalized) return normalized.toUpperCase();
  }

  const normalizedText = normalizeProposalTitleForMatching(text);
  const matched = proposalExtraction.candidates.find(
    (proposal) =>
      proposal.normalizedTitle &&
      (normalizedText.includes(proposal.normalizedTitle) || proposal.normalizedTitle.includes(normalizedText)),
  );
  return matched?.id ?? null;
}

function extractFirstDate(text: string): string | null {
  return cleanString(text.match(new RegExp(DATE_PATTERN, "i"))?.[0]);
}

function areSameReconciledProposal(left: ProxyProposal, right: ProxyProposal): boolean {
  const leftNumber = canonicalProposalNumber(left.id);
  const rightNumber = canonicalProposalNumber(right.id);
  const leftTitle = normalizeProposalTitleForMatching(left.title);
  const rightTitle = normalizeProposalTitleForMatching(right.title);
  if (leftNumber && rightNumber && leftNumber === rightNumber) {
    return true;
  }
  return areSimilarProposalTitles(leftTitle, rightTitle);
}

function compareMeetingMetadata(parentText: string, supplementText: string): string[] {
  const warnings: string[] = [];
  const meetingPatterns = [
    "(?:annual|special)\\s+meeting[^.\\n]{0,160}?(?:will\\s+be\\s+held|to\\s+be\\s+held|held\\s+on|new\\s+date|rescheduled\\s+to|changed\\s+to)[^.\\n]{0,120}?",
    "meeting\\s+date[^.\\n]{0,180}?",
  ];
  const recordPatterns = [
    "record\\s+date[^.\\n]{0,180}?",
    "stockholders?\\s+of\\s+record[^.\\n]{0,180}?",
  ];
  const parentMeetingDate = extractDateNear(parentText, meetingPatterns);
  const supplementMeetingDate = extractDateNear(supplementText, meetingPatterns);
  const parentRecordDate = extractDateNear(parentText, recordPatterns);
  const supplementRecordDate = extractDateNear(supplementText, recordPatterns);

  if (parentMeetingDate && supplementMeetingDate && parentMeetingDate !== supplementMeetingDate) {
    warnings.push(`meeting date: ${parentMeetingDate} -> ${supplementMeetingDate}`);
  }
  if (parentRecordDate && supplementRecordDate && parentRecordDate !== supplementRecordDate) {
    warnings.push(`record date: ${parentRecordDate} -> ${supplementRecordDate}`);
  }
  return warnings;
}

function compareProposalRecommendations(parentProposals: ProxyProposal[], supplementProposals: ProxyProposal[]): string[] {
  const conflicts: string[] = [];
  for (const supplementProposal of supplementProposals) {
    if (!supplementProposal.recommendation) continue;
    const parentProposal = parentProposals.find((proposal) => areSameReconciledProposal(proposal, supplementProposal));
    if (parentProposal?.recommendation && parentProposal.recommendation !== supplementProposal.recommendation) {
      conflicts.push(
        `Proposal ${supplementProposal.id}: ${parentProposal.recommendation} -> ${supplementProposal.recommendation}`,
      );
    }
  }
  return unique(conflicts);
}

function compareRecommendationEvidence(parentText: string, supplementText: string): string[] {
  const parentEvidence = extractRecommendationEvidenceByProposal(parentText);
  const supplementEvidence = extractRecommendationEvidenceByProposal(supplementText);
  const conflicts: string[] = [];

  for (const supplement of supplementEvidence) {
    const parent = parentEvidence.find((item) => item.proposalId === supplement.proposalId);
    if (parent && parent.recommendation !== supplement.recommendation) {
      conflicts.push(`Proposal ${supplement.proposalId}: ${parent.recommendation} -> ${supplement.recommendation}`);
    }
  }

  return unique(conflicts);
}

function extractRecommendationEvidenceByProposal(text: string): Array<{ proposalId: string; recommendation: string }> {
  const evidence: Array<{ proposalId: string; recommendation: string }> = [];
  const patterns: Array<{
    pattern: RegExp;
    recommendationIndex: number;
    proposalIndex: number;
  }> = [
    {
      pattern: /\b(?:Board|Board\s+of\s+Directors|Management)[^.\n]{0,180}\brecommends?[^.\n]{0,100}\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\b[^.\n]{0,140}\bProposal\s+(?:No\.?\s*)?([0-9A-Za-z]+)\b/gi,
      recommendationIndex: 1,
      proposalIndex: 2,
    },
    {
      pattern: /\bProposal\s+(?:No\.?\s*)?([0-9A-Za-z]+)\b[^.\n]{0,180}\b(?:Board|Board\s+of\s+Directors|Management)[^.\n]{0,100}\brecommends?[^.\n]{0,100}\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\b/gi,
      recommendationIndex: 2,
      proposalIndex: 1,
    },
  ];

  for (const { pattern, recommendationIndex, proposalIndex } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const proposalIdRaw = match[proposalIndex];
      const recommendationRaw = match[recommendationIndex];
      const proposalId = proposalIdRaw ? normalizeProposalId(proposalIdRaw) : null;
      if (proposalId && recommendationRaw) {
        evidence.push({ proposalId: proposalId.toUpperCase(), recommendation: recommendationRaw.toUpperCase() });
      }
    }
  }

  return uniqueBy(evidence, (item) => `${item.proposalId}:${item.recommendation}`);
}

function findAddedParagraphs(parentText: string, supplementText: string): string[] {
  const parentParagraphs = splitMeaningfulParagraphs(parentText);
  return splitMeaningfulParagraphs(supplementText)
    .filter((paragraph) => isSupplementChangeParagraph(paragraph))
    .filter((paragraph) => !parentParagraphs.some((parentParagraph) => areSimilarParagraphs(parentParagraph, paragraph)))
    .slice(0, 8);
}

function splitMeaningfulParagraphs(text: string): string[] {
  return normalizeFilingText(text)
    .split(/\n{2,}|\.\s+(?=[A-Z])/)
    .map((paragraph) => normalizeSpaces(paragraph))
    .filter((paragraph) => paragraph.length >= 40)
    .filter((paragraph) => !/^(table of contents|page\s+\d+|proxy card|for\s+against\s+abstain)$/i.test(paragraph));
}

function isSupplementChangeParagraph(paragraph: string): boolean {
  return /\b(?:supplement|amend|amended|revision|revised|update|updated|correction|corrected|change|changed|new proposal|additional proposal|meeting date|meeting time|meeting location|record date|board recommendation|withdrawn|withdraw|litigation|settlement|merger|fairness opinion|special committee|equity incentive plan|share reserve|reverse split|authorized shares|charter|by-?law|proxy contest|dissident|activist)\b/i.test(paragraph);
}

function areSimilarParagraphs(left: string, right: string): boolean {
  const leftNormalized = normalizeSpaces(left).toLowerCase();
  const rightNormalized = normalizeSpaces(right).toLowerCase();
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;

  const shorter = leftNormalized.length <= rightNormalized.length ? leftNormalized : rightNormalized;
  const longer = leftNormalized.length <= rightNormalized.length ? rightNormalized : leftNormalized;
  if (shorter.length >= 80 && longer.includes(shorter)) return true;

  const leftTokens = meaningfulTokens(leftNormalized);
  const rightTokens = meaningfulTokens(rightNormalized);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize < 8) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / smallerSize >= 0.82;
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3)
      .filter((token) => !/^(this|that|with|from|will|have|been|proxy|statement|shareholders|stockholders)$/.test(token)),
  );
}

function compareTableCaptions(parentHtml: string, supplementHtml: string): string[] {
  const parentCaptions = new Set(
    parseHtmlTables(parentHtml)
      .map((table) => normalizeProposalTitleForMatching(table.caption ?? ""))
      .filter(Boolean),
  );
  return unique(
    parseHtmlTables(supplementHtml)
      .map((table) => table.caption)
      .filter((caption): caption is string => Boolean(caption))
      .filter((caption) => !parentCaptions.has(normalizeProposalTitleForMatching(caption))),
  ).slice(0, 10);
}

function extractProposalExtraction(
  documents: ProxySourceDocument[],
  documentInventory: ProxyDocumentInventoryItem[],
  combinedText: string,
): { proposals: ProxyProposal[]; summary: ProxyProposalExtractionSummary } {
  const candidates: ProxyProposalExtractionCandidate[] = [];

  documents.forEach((document, documentIndex) => {
    if (!isTextLikeProxyDocument(document)) {
      return;
    }

    const documentClass = documentInventory[documentIndex]?.proxyClass ?? "unknown_proxy_related_material";
    const text = normalizeFilingText(document.body);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    lines.forEach((line, index) => {
      const parsed = parseProposalCandidateAt(lines, index);
      if (!parsed) {
        return;
      }

      const normalizedLine = normalizeSpaces(line);
      const sourceArea = classifyProposalSourceArea(lines, index, documentClass);
      const id = normalizeProposalId(parsed.id);
      const title = cleanProposalTitle(parsed.title);
      const sourceText = normalizeSpaces(parsed.sourceText || normalizedLine);
      const bodyText = extractProposalBodyText(lines, index);
      const proposalContext = normalizeSpaces([sourceText, bodyText].filter(Boolean).join(" "));
      const isShareholderProposal =
        parsed.isShareholderProposal || /\b(?:shareholder|stockholder)\s+proposal\b/i.test(proposalContext);

      if (!id || isNoisyProposalCandidate(id, title, sourceText)) {
        return;
      }

      const category = classifyProposalCategory(title, proposalContext, isShareholderProposal);
      const detailedCategory = classifyDetailedProposalCategory(title, proposalContext, isShareholderProposal);
      const sponsor = detectProposalSponsor(proposalContext, isShareholderProposal);
      const boardRecommendation = extractBoardRecommendationForProposal({
        id,
        title,
        category,
        detailedCategory,
        context: proposalContext,
        documentText: text,
      });
      const shareholderRecommendation = extractShareholderRecommendation(proposalContext);
      const voteMechanicsText = extractVoteMechanicsText(proposalContext);
      const confidence = sourceArea === "body" ? "high" : sourceArea === "toc" ? "low" : "medium";

      candidates.push({
        id: id.toUpperCase(),
        title,
        normalizedTitle: normalizeProposalTitleForMatching(title),
        sourceArea,
        documentClass,
        category,
        detailedCategory,
        sponsor,
        boardRecommendation,
        shareholderRecommendation,
        voteMechanicsText,
        sourceText,
        bodyText: bodyText ? trimBlockText(bodyText) : null,
        confidence,
        uncertain: sourceArea === "toc",
      });
    });
  });

  const dedupedCandidates = dedupeProposalCandidates(candidates);
  const proposals = dedupedCandidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    category: candidate.category,
    recommendation: recommendationForProposalFacts(candidate.boardRecommendation),
    sourceText: candidate.sourceText,
    isShareholderProposal: candidate.sponsor === "shareholder" || candidate.detailedCategory === "shareholder_proposal",
  }));
  const sourceCounts = countProposalCandidatesBySource(candidates);
  const recommendationConflicts = detectRecommendationConflicts(candidates);
  const countMismatch = hasProposalCountMismatch(sourceCounts);

  return {
    proposals,
    summary: {
      candidates,
      dedupedCount: proposals.length,
      sourceCounts,
      countMismatch,
      recommendationConflicts,
      generalVoteMechanics: extractGeneralVoteMechanics(combinedText),
      uncertain: countMismatch || recommendationConflicts.length > 0 || candidates.some((candidate) => candidate.uncertain),
    },
  };
}

function parseProposalCandidateAt(
  lines: string[],
  index: number,
): { id: string; title: string; isShareholderProposal: boolean; sourceText: string } | null {
  const line = normalizeSpaces(lines[index] ?? "");
  const headingOnly = line.match(/^((?:Shareholder|Stockholder)\s+)?(?:Proposal|Item|Matter)\s+(?:(?:No\.?|Number)\s*)?([0-9A-Za-z]+)$/i);
  const titleText = headingOnly ? collectMultilineProposalTitle(lines, index + 1) : "";
  if (headingOnly && titleText) {
    return {
      id: headingOnly[2],
      title: titleText,
      isShareholderProposal: Boolean(headingOnly[1]) || /\b(?:shareholder|stockholder)\s+proposal\b/i.test(titleText),
      sourceText: `${line} ${titleText}`,
    };
  }

  const direct = parseProposalCandidate(line);
  if (direct) {
    return {
      ...direct,
      sourceText: line,
    };
  }

  return null;
}

function collectMultilineProposalTitle(lines: string[], startIndex: number): string {
  const titleLines: string[] = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 4); index += 1) {
    const line = normalizeSpaces(lines[index] ?? "");
    if (!line) continue;
    if (
      parseProposalCandidate(line) ||
      isMajorNonProposalHeading(line) ||
      hasProxyCardVotingOptions(line) ||
      isRecommendationOrVoteMechanicsLine(line)
    ) {
      break;
    }
    titleLines.push(line);
    const title = normalizeSpaces(titleLines.join(" "));
    if (title.length >= 24 && !/\b(?:of|to|the|and|or|for|an?|with)$/i.test(title)) {
      break;
    }
  }
  return cleanString(titleLines.join(" ")) ?? "";
}

function isRecommendationOrVoteMechanicsLine(line: string): boolean {
  return /\b(?:Board|Management|proponent|shareholder|stockholder)[^.\n]{0,120}\brecommends?\b|\bvote\s+required\b|\bquorum\b|\babstentions?\b|\bbroker\s+non-votes?\b/i.test(line);
}

function classifyProposalSourceArea(
  lines: string[],
  index: number,
  documentClass: ProxyDocumentClass,
): ProxyProposalSourceArea {
  const currentLine = normalizeSpaces(lines[index] ?? "");
  if (/^(?:PROPOSAL|ITEM|MATTER)\b/.test(currentLine)) {
    return "body";
  }
  for (let cursor = index; cursor >= Math.max(0, index - 24); cursor -= 1) {
    const heading = normalizeSpaces(lines[cursor] ?? "");
    if (/\bproxy\s+card\b/i.test(heading)) return "proxy_card";
    if (/\bvoting\s+instruction\s+(?:form|card)\b/i.test(heading)) return "voting_instruction";
    if (/\b(?:proxy\s+statement|proposal\s+descriptions?|matters?\s+to\s+be\s+voted\s+on)\b/i.test(heading)) return "body";
    if (/\bnotice\s+of\s+(?:annual|special)\s+meeting\b|\bnotice\s+of\s+internet\s+availability\b/i.test(heading)) {
      return "notice";
    }
    if (/\btable\s+of\s+contents\b/i.test(heading)) return "toc";
  }
  if (documentClass === "proxy_card_only") return "proxy_card";
  if (documentClass === "voting_instruction_only") return "voting_instruction";
  if (documentClass === "notice_only") return "notice";
  if (documentClass === "additional_material" || documentClass === "supplemental_proxy_material") {
    return "body";
  }
  return "body";
}

function extractProposalBodyText(lines: string[], startIndex: number): string {
  const bodyLines: string[] = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 80); index += 1) {
    const line = normalizeSpaces(lines[index] ?? "");
    if (!line) continue;
    if (index > startIndex && (parseProposalCandidateAt(lines, index) || isProposalBoundaryHeading(line))) {
      break;
    }
    if (isLikelyPageHeaderOrFooter(line)) {
      continue;
    }
    bodyLines.push(line);
  }
  return normalizeSpaces(bodyLines.join(" ")).slice(0, 4000);
}

function isProposalBoundaryHeading(line: string): boolean {
  return (
    isMajorNonProposalHeading(line) ||
    /^(?:Proxy\s+Card|Voting\s+Instruction\s+Form|Appendix|Annex)\b/i.test(line)
  );
}

function isMajorNonProposalHeading(line: string): boolean {
  return /^(?:Table\s+of\s+Contents|Questions\s+and\s+Answers|Voting\s+Information|Corporate\s+Governance|Security\s+Ownership|Executive\s+Compensation|Compensation\s+Discussion\s+and\s+Analysis|Audit\s+Committee|Other\s+Matters)\b/i.test(line);
}

function isLikelyPageHeaderOrFooter(line: string): boolean {
  return /^-?\s*\d+\s*-?$/.test(line) || /^Page\s+\d+$/i.test(line);
}

function dedupeProposalCandidates(candidates: ProxyProposalExtractionCandidate[]): ProxyProposalExtractionCandidate[] {
  const groups: ProxyProposalExtractionCandidate[][] = [];

  for (const candidate of candidates) {
    const group = groups.find((existing) => existing.some((member) => areSameProposalCandidate(member, candidate)));
    if (group) {
      group.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups.map(selectBestProposalCandidate);
}

function areSameProposalCandidate(
  left: ProxyProposalExtractionCandidate,
  right: ProxyProposalExtractionCandidate,
): boolean {
  const leftNumber = canonicalProposalNumber(left.id);
  const rightNumber = canonicalProposalNumber(right.id);
  const categoryCompatible =
    left.detailedCategory === right.detailedCategory ||
    left.category === right.category ||
    left.detailedCategory === "other_unknown" ||
    right.detailedCategory === "other_unknown";
  const titleCompatible = areSimilarProposalTitles(left.normalizedTitle, right.normalizedTitle);

  if (leftNumber && rightNumber && leftNumber === rightNumber) {
    return categoryCompatible || titleCompatible;
  }
  return titleCompatible && categoryCompatible;
}

function selectBestProposalCandidate(candidates: ProxyProposalExtractionCandidate[]): ProxyProposalExtractionCandidate {
  return [...candidates].sort((a, b) => proposalCandidateScore(b) - proposalCandidateScore(a))[0] ?? candidates[0];
}

function proposalCandidateScore(candidate: ProxyProposalExtractionCandidate): number {
  let score = 0;
  if (candidate.sourceArea === "body") score += 8;
  if (candidate.sourceArea === "notice") score += 5;
  if (candidate.sourceArea === "proxy_card" || candidate.sourceArea === "voting_instruction") score += 3;
  if (candidate.sourceArea === "toc") score -= 4;
  if (candidate.boardRecommendation) score += 3;
  if (candidate.voteMechanicsText) score += 2;
  if (candidate.bodyText && candidate.bodyText.length > candidate.sourceText.length) score += 2;
  if (candidate.detailedCategory !== "other_unknown") score += 1;
  score += Math.min(candidate.title.length, 100) / 100;
  return score;
}

function countProposalCandidatesBySource(
  candidates: ProxyProposalExtractionCandidate[],
): ProxyProposalExtractionSummary["sourceCounts"] {
  const sourceCounts = {
    notice: 0,
    body: 0,
    proxy_card: 0,
    voting_instruction: 0,
    toc: 0,
    unknown: 0,
  };

  for (const sourceArea of Object.keys(sourceCounts) as ProxyProposalSourceArea[]) {
    sourceCounts[sourceArea] = dedupeProposalCandidates(
      candidates.filter((candidate) => candidate.sourceArea === sourceArea),
    ).length;
  }

  return sourceCounts;
}

function hasProposalCountMismatch(sourceCounts: ProxyProposalExtractionSummary["sourceCounts"]): boolean {
  const comparableCounts = [sourceCounts.notice, sourceCounts.body, sourceCounts.proxy_card + sourceCounts.voting_instruction]
    .filter((count) => count > 0);
  return comparableCounts.length >= 2 && new Set(comparableCounts).size > 1;
}

function detectRecommendationConflicts(
  candidates: ProxyProposalExtractionCandidate[],
): ProxyProposalExtractionSummary["recommendationConflicts"] {
  const groups = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.boardRecommendation) continue;
    const key = proposalConflictKey(candidate);
    const recommendations = groups.get(key) || new Set<string>();
    recommendations.add(candidate.boardRecommendation);
    groups.set(key, recommendations);
  }

  return [...groups.entries()]
    .filter(([, recommendations]) => recommendations.size > 1)
    .map(([proposalId, recommendations]) => ({
      proposalId,
      recommendations: [...recommendations].sort(),
    }));
}

function proposalConflictKey(candidate: ProxyProposalExtractionCandidate): string {
  return canonicalProposalNumber(candidate.id) || candidate.normalizedTitle || candidate.id;
}

function canonicalProposalNumber(value: string): string | null {
  const normalized = normalizeSpaces(value).toLowerCase();
  const words: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
  };
  if (/^\d{1,2}$/.test(normalized)) return normalized;
  return words[normalized] || null;
}

function normalizeProposalTitleForMatching(title: string): string {
  return normalizeSpaces(title)
    .toLowerCase()
    .replace(/\b(?:the|a|an|to|approve|approval|adopt|adoption|of|for)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areSimilarProposalTitles(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 12 && longer.includes(shorter);
}

function classifyDetailedProposalCategory(
  title: string,
  sourceText: string,
  isShareholderProposal: boolean,
): ProxyDetailedProposalCategory {
  const haystack = `${title} ${sourceText}`.toLowerCase();

  if (isShareholderProposal || /\b(?:shareholder|stockholder)\s+proposal\b/.test(haystack)) return "shareholder_proposal";
  if (/\bmerger|merger agreement|acquisition|business combination\b/.test(haystack)) return "merger_acquisition";
  if (/\basset sale|sale of substantially all assets|sale of assets\b/.test(haystack)) return "asset_sale";
  if (/\bliquidation|dissolution|wind[- ]?up\b/.test(haystack)) return "liquidation";
  if (/\breincorporat/.test(haystack)) return "reincorporation";
  if (/\brelated[- ]party|related person transaction|interested transaction\b/.test(haystack)) return "related_party_transaction";
  if (/\breverse\s+(?:stock\s+)?split\b/.test(haystack)) return "reverse_stock_split";
  if (/\bauthorized shares?|increase (?:the )?(?:number of )?authorized|share authorization\b/.test(haystack)) {
    return "authorized_share_increase";
  }
  if (/\bemployee stock purchase plan|espp\b/.test(haystack)) return "employee_stock_purchase_plan";
  if (/\bequity incentive plan|stock incentive plan|equity plan|incentive plan|repricing|evergreen\b/.test(haystack)) {
    return "equity_incentive_plan";
  }
  if (/\bcertificate of incorporation|articles of incorporation|charter amendment|amend(?:ment)?\s+(?:to|of)\s+(?:the\s+)?charter\b/.test(haystack)) {
    return "charter_amendment";
  }
  if (/\bby-?laws?|bylaw amendment|amend(?:ment)?\s+(?:to|of)\s+(?:the\s+)?by-?laws?\b/.test(haystack)) {
    return "bylaw_amendment";
  }
  if (/\bproxy access\b/.test(haystack)) return "proxy_access";
  if (/\bspecial meeting right|call special meetings?|right to call a special meeting\b/.test(haystack)) {
    return "special_meeting_right";
  }
  if (/\bwritten consent\b/.test(haystack)) return "written_consent_right";
  if (/\bclassified board|declassif/.test(haystack)) return "classified_board";
  if (/\bsupermajority\b/.test(haystack)) return "supermajority_vote";
  if (/\bofficer exculpation|exculpate officers?|limitation of liability for officers\b/.test(haystack)) {
    return "officer_exculpation";
  }
  if (/\badjournment proposal|adjourn(?:ment)?\b/.test(haystack)) return "adjournment";
  if (/\bsay-on-frequency|frequency of (?:future )?advisory votes?\b/.test(haystack)) return "say_on_frequency";
  if (/\bsay-on-pay|advisory vote to approve executive compensation|executive compensation\b/.test(haystack)) {
    return "say_on_pay";
  }
  if (/\bauditor|accounting firm|independent registered public accounting\b/.test(haystack)) return "auditor_ratification";
  if (/\belection|elect\b/.test(haystack) && /\bdirector|nominee|class [ivx]+\b/.test(haystack)) return "director_election";
  return "other_unknown";
}

function detectProposalSponsor(context: string, isShareholderProposal: boolean): ProxyProposalSponsor {
  if (
    isShareholderProposal ||
    /\b(?:shareholder|stockholder)\s+proposal\b|\bsubmitted\s+by\b|\bproponent\b|\bnon-management\s+proposal\b/i.test(context)
  ) {
    return "shareholder";
  }
  if (/\bdissident\b|\bnominees\s+of\b|\bparticipants\s+in\s+the\s+solicitation\b|\bnot\s+on\s+behalf\s+of\s+the\s+board\b/i.test(context)) {
    return "dissident";
  }
  if (/\b(?:our\s+)?board\s+(?:of\s+directors\s+)?(?:recommends|proposes|approved)|\bmanagement\s+recommends\b/i.test(context)) {
    return "management";
  }
  return "unknown";
}

function extractBoardRecommendationForProposal(input: {
  id: string;
  title: string;
  category: string;
  detailedCategory: ProxyDetailedProposalCategory;
  context: string;
  documentText: string;
}): ProxyProposalExtractionCandidate["boardRecommendation"] {
  const contextRecommendation = extractBoardRecommendation(input.context);
  if (contextRecommendation) return contextRecommendation;

  const idPattern = canonicalProposalNumber(input.id) || input.id;
  const escapedId = idPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const documentPatterns = [
    new RegExp(`(?:Board|Management)[^.\\n]{0,160}\\brecommends?[^.\\n]{0,80}\\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\\b[^.\\n]{0,120}\\bProposal\\s+(?:No\\.?\\s*)?${escapedId}\\b`, "i"),
    new RegExp(`\\bProposal\\s+(?:No\\.?\\s*)?${escapedId}\\b[^.\\n]{0,160}(?:Board|Management)[^.\\n]{0,80}\\brecommends?[^.\\n]{0,80}\\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\\b`, "i"),
  ];

  for (const pattern of documentPatterns) {
    const match = input.documentText.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase() as ProxyProposalExtractionCandidate["boardRecommendation"];
    }
  }

  if (
    input.detailedCategory === "director_election" &&
    /\bBoard[^.\n]{0,120}\brecommends?[^.\n]{0,80}\bFOR\b[^.\n]{0,80}\beach nominee\b/i.test(input.documentText)
  ) {
    return "FOR";
  }

  if (
    input.detailedCategory !== "shareholder_proposal" &&
    !/\b(?:shareholder|stockholder)\s+proposal\b/i.test(input.documentText) &&
    /\b(?:Board|Management)\s+(?:of\s+Directors\s+)?recommends[^.\n]{0,80}\bFOR\b[^.\n]{0,80}\ball proposals\b/i.test(input.documentText)
  ) {
    return "FOR";
  }

  if (input.detailedCategory === "merger_acquisition") {
    const mergerRecommendation = input.documentText.match(
      /\b(?:Board|Management)[^.\n]{0,160}\brecommends?[^.\n]{0,80}\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\b[^.\n]{0,160}\b(?:merger agreement|merger proposal|transaction)\b/i,
    );
    if (mergerRecommendation?.[1]) {
      return mergerRecommendation[1].toUpperCase() as ProxyProposalExtractionCandidate["boardRecommendation"];
    }
  }

  return null;
}

function extractBoardRecommendation(context: string): ProxyProposalExtractionCandidate["boardRecommendation"] {
  if (/\b(?:Board|Management)[^.]{0,120}\bmakes?\s+no\s+recommendation\b/i.test(context)) {
    return "NO_RECOMMENDATION";
  }
  const match = context.match(
    /\b(?:Our\s+)?(?:Board|Board\s+of\s+Directors|Management)[^.]{0,160}\brecommends?[^.]{0,80}\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\b/i,
  );
  return match?.[1] ? (match[1].toUpperCase() as ProxyProposalExtractionCandidate["boardRecommendation"]) : null;
}

function extractShareholderRecommendation(context: string): ProxyProposalExtractionCandidate["shareholderRecommendation"] {
  const match = context.match(
    /\b(?:shareholder|stockholder|proponent)[^.]{0,120}\brecommends?[^.]{0,80}\b(FOR|AGAINST|ABSTAIN|WITHHOLD)\b/i,
  );
  return match?.[1] ? (match[1].toUpperCase() as ProxyProposalExtractionCandidate["shareholderRecommendation"]) : null;
}

function recommendationForProposalFacts(
  recommendation: ProxyProposalExtractionCandidate["boardRecommendation"],
): ProxyProposal["recommendation"] {
  if (recommendation === "FOR" || recommendation === "AGAINST" || recommendation === "ABSTAIN" || recommendation === "WITHHOLD") {
    return recommendation;
  }
  return null;
}

function extractVoteMechanicsText(context: string): string | null {
  const matches = extractVoteMechanicsSentences(context);
  return matches.length ? trimBlockText(matches.join(" ")) : null;
}

function extractGeneralVoteMechanics(text: string): string[] {
  return extractVoteMechanicsSentences(text).slice(0, 8);
}

function extractVoteMechanicsSentences(text: string): string[] {
  const sentences = splitIntoSentences(text);
  return unique(
    sentences
      .filter((sentence) =>
        /\b(vote required|quorum|abstentions?|broker non-votes?|plurality|majority of votes cast|majority of shares outstanding|broker discretionary|record date|shares outstanding|votes cast)\b/i.test(sentence),
      )
      .map((sentence) => trimBlockText(sentence)),
  );
}

function splitIntoSentences(text: string): string[] {
  return normalizeSpaces(text)
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

function extractProposals(text: string): ProxyProposal[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const proposalsByKey = new Map<string, ProxyProposal>();

  lines.forEach((line, index) => {
    const normalizedLine = normalizeSpaces(line);
    const candidate = parseProposalCandidate(normalizedLine);
    if (!candidate) {
      return;
    }

    const sourceWindow = normalizeSpaces(lines.slice(index, index + 3).join(" "));
    const isShareholderProposal = candidate.isShareholderProposal || /\bshareholder\s+proposal\b/i.test(normalizedLine);
    const id = normalizeProposalId(candidate.id);
    const rawTitle = candidate.title;
    const title = cleanProposalTitle(rawTitle);
    const sourceText = normalizeSpaces(normalizedLine);

    if (!id || isNoisyProposalCandidate(id, title, sourceText)) {
      return;
    }

    const proposal = {
      id: id.toUpperCase(),
      title,
      category: classifyProposalCategory(title, normalizedLine, isShareholderProposal),
      recommendation: extractRecommendation(sourceWindow),
      sourceText,
      isShareholderProposal,
    };
    const key = `${proposal.id}:${proposal.title.toLowerCase()}`;
    if (!proposalsByKey.has(key)) {
      proposalsByKey.set(key, proposal);
    }
  });

  return collapseDuplicateProposals([...proposalsByKey.values()]);
}

function parseProposalCandidate(line: string): { id: string; title: string; isShareholderProposal: boolean } | null {
  const explicit = line.match(
    /^((?:Shareholder|Stockholder)\s+)?(?:Proposal|Item|Matter)\s+(?:(?:No\.?|Number)\s*)?([0-9A-Za-z]+)\s*[:.)-]?\s+(.+)$/i,
  );
  if (explicit) {
    return {
      id: explicit[2],
      title: explicit[3],
      isShareholderProposal: Boolean(explicit[1]),
    };
  }

  const embedded = line.match(
    /\b(Shareholder\s+)?Proposal\s+(?:No\.?\s*)?([0-9]+|[A-Z])\b\s*(?:[:.-]\s*)?((?:to\s+)?(?:approve|adopt|authorize|increase|amend|ratify|elect|approval|adoption|authorization|amendment|election)\b.{0,240})/i,
  );
  if (embedded) {
    const title = normalizeSpaces(embedded[3])
      .replace(/\s+(?:please\s+)?vote\s+(?:for|against)\b.*$/i, "")
      .replace(/\s+(?:we\s+urge|the\s+board\s+recommends)\b.*$/i, "");
    if (!isActionableEmbeddedProposalTitle(title)) {
      return null;
    }

    return {
      id: embedded[2],
      title,
      isShareholderProposal: Boolean(embedded[1]),
    };
  }

  const namedAuthorizedShareIncrease = line.match(
    /\b((?:authorized\s+share\s+increase|share\s+authorization)\s+proposal|proposal[^.\n]{0,180}\bincrease[^.\n]{0,120}\bauthorized\s+shares?[^.\n]{0,120})/i,
  );
  if (namedAuthorizedShareIncrease) {
    return {
      id: "authorized_share_increase",
      title: cleanString(namedAuthorizedShareIncrease[1]) ?? "Authorized share increase proposal",
      isShareholderProposal: false,
    };
  }

  const named = parseNamedProposalHeading(line);
  if (named) {
    return named;
  }

  return null;
}

function parseNamedProposalHeading(line: string): { id: string; title: string; isShareholderProposal: boolean } | null {
  const shareholderProposal = line.match(/^((?:Shareholder|Stockholder)\s+Proposal)\s*[:.-]?\s*(.*)$/i);
  if (shareholderProposal) {
    const suffix = cleanString(shareholderProposal[2]);
    return {
      id: "shareholder_proposal",
      title: suffix ? `${shareholderProposal[1]}: ${suffix}` : shareholderProposal[1],
      isShareholderProposal: true,
    };
  }

  const patterns: Array<{ id: string; pattern: RegExp; fallbackTitle: string }> = [
    {
      id: "election_of_directors",
      pattern: /^Election\s+of\s+Directors\b/i,
      fallbackTitle: "Election of Directors",
    },
    {
      id: "auditor_ratification",
      pattern: /^Ratification\s+of\s+Appointment\s+of\s+Independent\s+Registered\s+Public\s+Accounting\s+Firm\b/i,
      fallbackTitle: "Ratification of Appointment of Independent Registered Public Accounting Firm",
    },
    {
      id: "say_on_pay",
      pattern: /^(?:Advisory\s+Vote\s+to\s+Approve\s+Executive\s+Compensation|Say-on-Pay)\b/i,
      fallbackTitle: "Advisory Vote to Approve Executive Compensation",
    },
    {
      id: "say_on_frequency",
      pattern: /^Say-on-Frequency\b/i,
      fallbackTitle: "Say-on-Frequency",
    },
    {
      id: "equity_incentive_plan",
      pattern: /^Approval\s+of\s+(?:the\s+)?(?:\d{4}\s+)?(?:Equity|Stock)\s+Incentive\s+Plan\b/i,
      fallbackTitle: "Approval of Equity Incentive Plan",
    },
    {
      id: "certificate_amendment",
      pattern: /^Approval\s+of\s+Amendment\s+to\s+(?:the\s+)?Certificate\s+of\s+Incorporation\b/i,
      fallbackTitle: "Approval of Amendment to Certificate of Incorporation",
    },
    {
      id: "reverse_stock_split",
      pattern: /^Approval\s+of\s+(?:a\s+)?Reverse\s+Stock\s+Split\b/i,
      fallbackTitle: "Approval of Reverse Stock Split",
    },
    {
      id: "authorized_share_increase",
      pattern: /^Approval\s+of\s+(?:an\s+)?Increase\s+in\s+Authorized\s+Shares\b/i,
      fallbackTitle: "Approval of Increase in Authorized Shares",
    },
    {
      id: "merger_agreement",
      pattern: /^Approval\s+of\s+(?:the\s+)?Merger\s+Agreement\b/i,
      fallbackTitle: "Approval of Merger Agreement",
    },
  ];

  for (const { id, pattern, fallbackTitle } of patterns) {
    if (pattern.test(line)) {
      return {
        id,
        title: cleanString(line) ?? fallbackTitle,
        isShareholderProposal: false,
      };
    }
  }

  return null;
}

function isActionableEmbeddedProposalTitle(title: string): boolean {
  return /\b(authorized\s+shares?|increase\s+(?:the\s+)?(?:number\s+of\s+)?authorized|share\s+authority|reverse\s+stock\s+split|equity\s+incentive|stock\s+incentive|nasdaq|nyse|merger|business\s+combination|certificate\s+of\s+incorporation|articles\s+of\s+incorporation|share\s+issuance|issuance\s+of\s+shares|director|auditor|compensation)\b/i.test(title);
}

function normalizeProposalId(value: string): string | null {
  const normalized = normalizeSpaces(value).replace(/\.$/, "");
  const wordNumber = canonicalProposalNumber(normalized);
  if (wordNumber) {
    return wordNumber;
  }
  if (/^\d{4}$/.test(normalized) || (/^\d{3,}$/.test(normalized) && !/^[12]$/.test(normalized))) {
    return null;
  }
  return normalized || null;
}

function isNoisyProposalCandidate(id: string, title: string, sourceText: string): boolean {
  if (title.length < 8 || title.length > 260) {
    return true;
  }
  const haystack = `${id} ${title} ${sourceText}`;
  return (
    /\b(?:Suite|Boulevard|Avenue|Street|Expressway|Floor|Parkway|Road|Vanguard Blvd|Amphitheatre Parkway)\b/i.test(haystack) ||
    /\b(?:Proxy Statement|Annual Report to Stockholders|Summary Compensation Table|Pay Versus Performance|Option Exercises|Executive Compensation Highlights)\b/i.test(haystack) ||
    /\b(?:BY MAIL|BY TELEPHONE|BY INTERNET|available at|Please refer to footnote|page\s+\d+)\b/i.test(haystack) ||
    /^\d{3,}$/.test(id) ||
    /^\d{4}$/.test(id)
  );
}

function collapseDuplicateProposals(proposals: ProxyProposal[]): ProxyProposal[] {
  const byId = new Map<string, ProxyProposal>();
  for (const proposal of proposals) {
    const existing = byId.get(proposal.id);
    if (!existing || proposalQualityScore(proposal) > proposalQualityScore(existing)) {
      byId.set(proposal.id, proposal);
    }
  }
  return [...byId.values()];
}

function proposalQualityScore(proposal: ProxyProposal): number {
  let score = 0;
  if (/^Proposal\s+/i.test(proposal.sourceText)) {
    score += 3;
  }
  if (proposal.recommendation) {
    score += 2;
  }
  if (proposal.category !== "other") {
    score += 1;
  }
  score += Math.min(proposal.title.length, 120) / 120;
  return score;
}

function extractCoverFacts(text: string, secFormType: string | null): ProxyCoverFacts | null {
  const checkedBoxes = [
    ["preliminary_proxy_statement", "Preliminary Proxy Statement"],
    ["definitive_proxy_statement", "Definitive Proxy Statement"],
    ["definitive_additional_materials", "Definitive Additional Materials"],
    ["soliciting_material", "Soliciting Material"],
  ]
    .filter(([, label]) => hasCheckedLabel(text, label))
    .map(([value]) => value);

  const filedByRegistrant = hasCheckedLabel(text, "Filed by the Registrant");
  const filedByOtherThanRegistrant =
    hasCheckedLabel(text, "Filed by a Party other than the Registrant") ||
    hasCheckedLabel(text, "Filed by a party other than the Registrant");
  const amendmentMatch = text.match(/\(Amendment\s+No\.\s*([^)]+)\)/i);
  const filingPersons = extractFilingPersons(text, filedByOtherThanRegistrant);

  if (
    !checkedBoxes.length &&
    !filedByRegistrant &&
    !filedByOtherThanRegistrant &&
    !amendmentMatch &&
    !filingPersons.length
  ) {
    return null;
  }

  return {
    filedByRegistrant: filedByRegistrant || filedByOtherThanRegistrant ? filedByRegistrant : null,
    filedByOtherThanRegistrant: filedByRegistrant || filedByOtherThanRegistrant ? filedByOtherThanRegistrant : null,
    checkedBoxes,
    amendmentNumber: amendmentMatch ? normalizeSpaces(amendmentMatch[1]) : null,
    filingPersons,
  };
}

function hasCheckedLabel(text: string, label: string): boolean {
  const lines = text.split(/\r?\n/);
  const labelPattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i");

  return lines.some((line, index) => {
    const match = line.match(labelPattern);
    if (!match) {
      return false;
    }
    const labelIndex = match.index ?? 0;
    const beforeLabel = line.slice(Math.max(0, labelIndex - 12), labelIndex);
    const afterLabel = line.slice(labelIndex + match[0].length, labelIndex + match[0].length + 24);
    return (
      isCheckedMarker(beforeLabel) ||
      isCheckedMarker(afterLabel) ||
      isStandaloneCheckedMarker(lines[index - 1] ?? "") ||
      isStandaloneCheckedMarker(lines[index + 1] ?? "")
    );
  });
}

function isCheckedMarker(value: string): boolean {
  const trimmed = value.trim();
  return /☒|☑|þ|\[[xX]\]/.test(trimmed) || /^(x|X)$/.test(trimmed);
}

function isStandaloneCheckedMarker(value: string): boolean {
  return /^(☒|☑|þ|\[[xX]\]|x|X)$/.test(value.trim());
}

function extractFilingPersons(text: string, filedByOtherThanRegistrant: boolean): string[] {
  if (!filedByOtherThanRegistrant) {
    return [];
  }

  const match = text.match(/\(Name of Registrant as Specified[^)]*\)\s*([\s\S]{0,800}?)\(Name of Person\(s\) Filing Proxy Statement/i);
  if (!match) {
    return [];
  }

  return unique(
    match[1]
      .split(/\r?\n/)
      .map((line) => normalizeSpaces(line))
      .filter((line) => line && !/^(N\/A|_|-|Payment of Filing Fee)$/i.test(line))
      .slice(0, 20),
  );
}

function extractSupplementFacts(text: string): ProxySupplementFacts | null {
  const originalProxyDate = extractDateNear(text, [
    "proxy\\s+statement\\s+(?:filed\\s+with\\s+the\\s+securities\\s+and\\s+exchange\\s+commission\\s+on|dated)\\s+",
    "proxy\\s+statement,?\\s+notice\\s+of\\s+annual\\s+meeting\\s+of\\s+stockholders,?\\s+and\\s+proxy\\s+card,?\\s+each\\s+dated\\s+",
  ]);
  const hasAmendedNotice = /\bamended\s+notice\b/i.test(text);
  const hasAmendedProxyCard = /\bamended\s+proxy\s+card\b|\brevised\s+proxy\s+card\b/i.test(text);
  const affectedProposalIds = unique(
    [...text.matchAll(/\bProposal\s+([0-9A-Za-z]+)\b/gi)].map((match) => match[1].toUpperCase()),
  );
  const withdrawnNominees = extractWithdrawnNominees(text);
  const sourceText = firstMatchingSentence(text, [
    /[^.\n]*\bno\s+longer\s+(?:be\s+)?(?:a\s+director\s+)?nominee[^.\n]*\./i,
    /[^.\n]*\bno\s+longer\s+be\s+re-nominated[^.\n]*\./i,
    /[^.\n]*\bwithdrawn\s+its\s+nomination[^.\n]*\./i,
    /[^.\n]*\bproxy\s+statement\s+is\s+hereby\s+supplemented\s+and\s+amended[^.\n]*\./i,
  ]);
  const isSupplement =
    Boolean(sourceText) ||
    /\bsupplement\s+to\s+(?:the\s+)?(?:definitive\s+)?proxy\s+statement\b/i.test(text) ||
    /\bproxy\s+statement\s+is\s+hereby\s+supplemented\b/i.test(text) ||
    hasAmendedNotice ||
    hasAmendedProxyCard ||
    withdrawnNominees.length > 0;

  if (!isSupplement && !originalProxyDate && !hasAmendedNotice && !hasAmendedProxyCard && !withdrawnNominees.length) {
    return null;
  }

  return {
    isSupplement: true,
    originalProxyDate,
    hasAmendedNotice,
    hasAmendedProxyCard,
    affectedProposalIds,
    withdrawnNominees,
    sourceText,
  };
}

function extractWithdrawnNominees(text: string): string[] {
  const names = [
    ...text.matchAll(/\b(Mr\.|Ms\.|Dr\.)\s+([A-Z][A-Za-z.'-]+)\s+will\s+no\s+longer\s+be[^.\n]*nominee/gi),
    ...text.matchAll(/\b(Mr\.|Ms\.|Dr\.)\s+([A-Z][A-Za-z.'-]+)\s+will\s+no\s+longer\s+be\s+re-nominated/gi),
    ...text.matchAll(/\b(Mr\.|Ms\.|Dr\.)\s+([A-Z][A-Za-z.'-]+)'s\s+nomination[^.\n]*(?:removed|withdrawn|deleted)/gi),
  ].map((match) => `${match[1]} ${match[2]}`);

  return unique(names);
}

function extractContestedFacts(
  text: string,
  cover: ProxyCoverFacts | null,
  secFormType: string | null,
): ProxyContestedFacts | null {
  const proxyCardColors = unique(
    [...text.matchAll(/\b(WHITE|BLUE|GREEN|GOLD)\s+(?:proxy\s+card|voting\s+instruction\s+form)/gi)].map((match) =>
      match[1].toUpperCase(),
    ),
  );
  const dissidentGroups = unique(
    [...text.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+Group\b/g)]
      .map((match) => `${match[1]} Group`)
      .filter((name) => !/^The Group$/i.test(name)),
  ).slice(0, 10);
  const sourceText = firstMatchingSentence(text, [
    /[^.\n]*\bnot\s+endorse[^.\n]*(?:nominee|proposal)[^.\n]*\./i,
    /[^.\n]*\bsolicitation\s+is\s+being\s+made\s+by[^.\n]*\./i,
    /[^.\n]*\bproxy\s+card\s+from\s+(?:Trian|Blackwells|the\s+Trian\s+Group)[^.\n]*\./i,
  ]);
  const isContested = isContestedProxyMaterial(text, cover, secFormType);

  if (!isContested) {
    return null;
  }

  return {
    isContested: true,
    solicitationSource:
      cover?.filedByOtherThanRegistrant ||
      /\bDEFC14A\b|\bPREC14A\b/i.test(secFormType ?? "") ||
      /\bnot\s+on\s+behalf\s+of\s+the\s+board\s+of\s+directors\b/i.test(text) ||
      /\bTHIS\s+SOLICITATION\s+IS\s+BEING\s+MADE\s+BY\b/i.test(text)
        ? "third_party"
        : cover?.filedByRegistrant
          ? "registrant"
          : "unknown",
    proxyCardColors,
    dissidentGroups,
    dissidentNominees: extractNomineeList(text, /(?:Trian|Blackwells)\s+(?:Group\s+)?Nominees?.{0,80}?([A-Z][A-Za-z.'\s]+(?:and|,)[A-Z][A-Za-z.'\s]+)/i),
    opposedNominees: extractNomineeList(text, /Opposed\s+Company\s+Nominees?.{0,80}?([A-Z][A-Za-z.'\s]+(?:and|,)[A-Z][A-Za-z.'\s]+)/i),
    sourceText,
  };
}

function extractNomineeList(text: string, pattern: RegExp): string[] {
  const match = text.match(pattern);
  if (!match) {
    return [];
  }

  return unique(
    normalizeSpaces(match[1])
      .split(/\s+and\s+|,\s*/)
      .map((name) => name.trim())
      .filter((name) => /^[A-Z]/.test(name) && name.length <= 80),
  );
}

function extractReverseSplitFacts(
  text: string,
  proposals: ProxyProposal[],
): ProxyReverseSplitFacts | null {
  const reverseSplitProposal = proposals.find((proposal) => /\breverse\s+stock\s+split\b/i.test(proposal.title));
  const sourceText = buildReverseSplitSourceText(text, reverseSplitProposal?.sourceText ?? null);

  if (!sourceText) {
    return null;
  }

  const ratioText = extractReverseSplitRatio(sourceText ?? text);

  return {
    hasReverseSplitProposal: true,
    ratioText,
    authorizedSharesUnchanged: /\bwill\s+not\s+change\s+the\s+number\s+of\s+authorized\s+shares\b/i.test(text)
      ? true
      : null,
    parValueUnchanged: /\bwill\s+not\s+(?:increase|change)\s+the\s+par\s+value\b/i.test(text) ? true : null,
    listingComplianceMentioned: /\b(listing|delisting|Nasdaq|NYSE)\b/i.test(text),
    minimumBidMentioned: /\bminimum\s+bid\s+price\b/i.test(text),
    sourceText,
  };
}

function buildReverseSplitSourceText(text: string, proposalSourceText: string | null): string | null {
  const ratioEvidence = firstMatchingSentence(text, [
    /\b(?:approval|approve|implement|effect)[^.]{0,500}\breverse\s+stock\s+split[^.]{0,700}\b(?:one-for-\d+|1-for-\d+|\d+\s*:\s*\d+)[^.]{0,700}\./i,
    /\breverse\s+stock\s+split[^.]{0,700}\bratio\s+ranging[^.]{0,700}\./i,
  ]);
  const listingEvidence = firstMatchingSentence(text, [
    /\b(?:Without|If)[^.]{0,220}\bReverse\s+Stock\s+Split[^.]{0,600}\b(?:Nasdaq|NYSE|minimum\s+bid|delisting)[^.]{0,600}\./i,
    /\b(?:Nasdaq|NYSE)[^.]{0,600}\bminimum\s+bid\s+price[^.]{0,600}\./i,
  ]);
  const timingEvidence = firstMatchingSentence(text, [
    /\b(?:If|Assuming)[^.]{0,220}\bReverse\s+Stock\s+Split[^.]{0,700}\b(?:Certificate of Amendment|effective|file)[^.]{0,700}\./i,
    /\bCertificate of Amendment[^.]{0,700}\b(?:effective|file|Secretary of State|Delaware)[^.]{0,700}\./i,
    /\b(?:will|would)\s+be\s+effective[^.]{0,700}\b(?:Certificate of Amendment|Secretary of State|Delaware)[^.]{0,700}\./i,
  ]);

  const parts = [proposalSourceText, ratioEvidence, listingEvidence, timingEvidence]
    .map((value) => cleanString(value))
    .filter((value): value is string => Boolean(value));
  return parts.length ? trimBlockText(unique(parts).join(" ")) : null;
}

function extractReverseSplitRatio(text: string): string | null {
  const range = text.match(/\b(one-for-[a-z-]+|\d+\s*(?::|-for-)\s*\d+)\s+(?:and|to|through|-)\s+(one-for-[a-z-]+|\d+\s*(?::|-for-)\s*\d+)/i);
  if (range) {
    return `${normalizeSpaces(range[1])} to ${normalizeSpaces(range[2])}`;
  }

  const single = text.match(/\b(one-for-[a-z-]+|\d+\s*(?::|-for-)\s*\d+)\b/i);
  return single ? normalizeSpaces(single[1]) : null;
}

function extractNoticeOnlyFacts(text: string, secFormType: string | null): ProxyNoticeOnlyFacts | null {
  const notBallot = /\bthis\s+is\s+not\s+a\s+ballot\b/i.test(text);
  const isNoticeOnly = isLikelyNoticeOnlyMaterial(text, secFormType);

  if (!isNoticeOnly) {
    return null;
  }

  return {
    isNoticeOnly: true,
    proxyMaterialsUrl: extractUrlNear(text, /proxy\s+materials\s+are\s+available|available\s+for\s+review/i),
    votingUrl: extractUrlNear(text, /vote\s+your\s+proxy|vote\s+on\s+the\s+internet/i),
    notBallot,
    controlNumberMentioned: /\bcontrol\s+number\b/i.test(text),
    sourceText: firstMatchingSentence(text, [
      /[^.\n]*\bimportant\s+notice\s+regarding\s+the\s+availability\s+of\s+proxy\s+materials[^.\n]*\./i,
      /[^.\n]*\bthis\s+is\s+not\s+a\s+ballot[^.\n]*\./i,
    ]),
  };
}

function extractUrlNear(text: string, pattern: RegExp): string | null {
  const match = text.match(new RegExp(`(?:${pattern.source})[\\s\\S]{0,260}?(https?:\\/\\/[^\\s,;]+)`, "i"));
  return match?.[1] ? match[1].replace(/[.)]+$/, "") : null;
}

function extractPreliminaryFacts(
  text: string,
  secFormType: string | null,
  cover: ProxyCoverFacts | null,
): ProxyPreliminaryFacts | null {
  const isPreliminary =
    Boolean(secFormType && /^PRE/i.test(secFormType)) ||
    Boolean(cover?.checkedBoxes.includes("preliminary_proxy_statement")) ||
    /\bpreliminary\s+proxy\s+statement[-\u2014]?\s*subject\s+to\s+completion\b/i.test(text);
  const placeholderCount = isPreliminary ? countPreliminaryPlaceholders(text) : 0;

  if (!isPreliminary && placeholderCount === 0) {
    return null;
  }

  return {
    isPreliminary,
    placeholderCount,
    placeholderFields: placeholderCount > 0 ? inferPlaceholderFields(text) : [],
  };
}

function countPreliminaryPlaceholders(text: string): number {
  return [...text.matchAll(/\[\s*(?:\u2022|\u25cf|_+|\?+|date|time|record\s+date|meeting\s+date)?\s*\]|\b[A-Z][a-z]+\s+_+,\s+20\d{2}\b|\b[A-Z]{3,}\s*,\s*20\d{2}\b/gi)].length;
}

function inferPlaceholderFields(text: string): string[] {
  const fields: string[] = [];
  const placeholder = "\\[\\s*(?:\\u2022|\\u25cf|_+|\\?+|date|time|meeting\\s+date)?\\s*\\]";
  if (new RegExp(`\\bheld\\s+on\\s+${placeholder}|\\bto\\s+be\\s+held\\s+on\\s+${placeholder}`, "i").test(text)) {
    fields.push("meeting_date");
  }
  if (new RegExp(`\\bRecord\\s+Date[^.\\n]*${placeholder}|\\bclose\\s+of\\s+business\\s+on\\s+${placeholder}`, "i").test(text)) {
    fields.push("record_date");
  }
  if (new RegExp(`\\bdated\\s+${placeholder}|\\bmailed\\s+on\\s+or\\s+about\\s+${placeholder}`, "i").test(text)) {
    fields.push("mailing_date");
  }
  return unique(fields);
}

function cleanProposalTitle(rawTitle: string): string {
  return normalizeSpaces(rawTitle)
    .replace(/^to\s+approve\s+(?:an?\s+)?/i, "Approval of ")
    .replace(/^to\s+adopt\s+(?:an?\s+)?/i, "Adoption of ")
    .replace(/^to\s+authorize\s+(?:an?\s+)?/i, "Authorization of ")
    .replace(/\b(?:FOR|AGAINST|ABSTAIN|WITHHOLD|FOR\s+ALL|WITHHOLD\s+ALL|FOR\s+ALL\s+EXCEPT)\b(?:\s*[|/]\s*\b(?:FOR|AGAINST|ABSTAIN|WITHHOLD|FOR\s+ALL|WITHHOLD\s+ALL|FOR\s+ALL\s+EXCEPT)\b)+.*$/i, "")
    .replace(/\s+(?:The\s+)?Board(?:\s+of\s+Directors)?\s+(?:recommends|recommendation)\b.*$/i, "")
    .replace(/\s+Board\s+recommendation\s*:.*$/i, "")
    .replace(/\s+\d{1,3}$/i, "")
    .replace(/[.;]\s*$/, "");
}

function extractRecommendation(text: string): ProxyProposal["recommendation"] {
  const match = text.match(/\b(?:Board(?:\s+of\s+Directors)?\s+(?:recommends|recommendation)|recommends\s+that\s+shareholders\s+vote)\s*(?:a\s+vote\s+)?(?::\s*)?(FOR|AGAINST|ABSTAIN|WITHHOLD)\b/i);
  return match ? (match[1].toUpperCase() as ProxyProposal["recommendation"]) : null;
}

function classifyProposalCategory(
  title: string,
  sourceText: string,
  isShareholderProposal: boolean,
): string {
  const haystack = `${title} ${sourceText}`.toLowerCase();

  if (/\b(merger|merger agreement|acquisition|sale of the company|business combination|strategic transaction|asset sale|liquidation|dissolution)\b/.test(haystack)) {
    return "merger_or_transaction";
  }
  if (/\b(equity incentive plan|stock incentive plan|equity plan|employee stock purchase plan|espp|repricing|evergreen|reserve|additional shares|new shares)\b/.test(haystack)) {
    return "equity_plan";
  }
  if (/\b(reverse stock split|minimum bid|delisting|nasdaq compliance|nyse compliance|authorized shares?|increase (?:the )?(?:number of )?authorized|share authority|share issuance|issuance of shares|certificate of incorporation|articles of incorporation|charter|by-?laws?|reincorporat)\b/.test(haystack)) {
    return "listing_or_capital_structure";
  }
  if (/\b(litigation|regulatory|investigation|compliance|doj|sec investigation|antitrust|opioid|sanctions)\b/.test(haystack)) {
    return isShareholderProposal ? "legal_shareholder_proposal" : "legal_risk_vote";
  }
  if (/\b(declassify|classified board|independent chair|bylaw|board size|governance|poison pill)\b/.test(haystack)) {
    return "governance";
  }
  if (/\b(dividend|repurchase|buyback|return of capital)\b/.test(haystack)) {
    return "capital_return";
  }
  if (isShareholderProposal) {
    return "shareholder_proposal";
  }
  if (/\b(election|elect)\b.*\b(director|directors)\b/.test(haystack)) {
    return "director_election";
  }
  if (/\b(auditor|accounting firm|independent registered public accounting)\b/.test(haystack)) {
    return "auditor_ratification";
  }
  if (/\b(say-on-pay|executive compensation|compensation)\b/.test(haystack)) {
    return "compensation";
  }
  return "other";
}

function extractOwnershipFacts(text: string): ProxyParserOutput["facts"]["ownership"] {
  const matches = [
    ...text.matchAll(
      /([A-Z][A-Za-z.' -]{2,80}?)\s+(?:beneficially\s+owns|controls|has voting power over)\s+(?:approximately\s+)?(\d{1,3}(?:\.\d+)?)%/g,
    ),
  ];
  const best = matches
    .map((match) => ({
      holder: normalizeOwnershipHolder(match[1]),
      percent: Number(match[2]),
      sourceText: normalizeSpaces(match[0]),
    }))
    .filter((match) => Number.isFinite(match.percent))
    .sort((a, b) => b.percent - a.percent)[0];

  return {
    maxBeneficialOwnershipPercent: best?.percent ?? null,
    holder: best?.holder ?? null,
    sourceText: best?.sourceText ?? null,
  };
}

function normalizeOwnershipHolder(value: string): string {
  return normalizeSpaces(value)
    .replace(/^.*\bshows\s+/i, "")
    .replace(/^.*\breports\s+/i, "")
    .replace(/^.*\bthat\s+/i, "");
}

function extractDilutionFacts(proposals: ProxyProposal[]): ProxyParserOutput["facts"]["dilution"] {
  const equityPlanProposals = proposals.filter((proposal) => proposal.category === "equity_plan");
  const source = equityPlanProposals.map((proposal) => proposal.sourceText).join(" ");
  const sharesMatch = source.match(/\b(?:reserve|increase|add|authorize)\s+(?:up\s+to\s+)?([\d,]+)\s+(?:new\s+|additional\s+)?shares\b/i);
  const percentMatch = source.match(/(\d{1,3}(?:\.\d+)?)%\s+of\s+(?:shares\s+)?outstanding/i);

  return {
    hasEquityPlanVote: equityPlanProposals.length > 0,
    sharesRequested: sharesMatch ? Number(sharesMatch[1].replace(/,/g, "")) : null,
    percentOfOutstanding: percentMatch ? Number(percentMatch[1]) : null,
    proposalIds: equityPlanProposals.map((proposal) => proposal.id),
  };
}

function extractTransactionFacts(
  text: string,
  proposals: ProxyProposal[],
): ProxyParserOutput["facts"]["transaction"] {
  const transactionProposals = proposals.filter((proposal) => proposal.category === "merger_or_transaction");
  const hasMergerContext = transactionProposals.length > 0 || /\bmerger\s+agreement\b|\bbusiness\s+combination\b/i.test(text);
  const consideration = hasMergerContext ? extractMergerConsideration(text, transactionProposals) : null;
  const voteRequiredMatch = text.match(/Vote\s+required\s*:\s*([^.\n]+[.])/i);
  const agreementDate = extractDateNear(text, ["Agreement\\s+and\\s+Plan\\s+of\\s+Merger[^.\\n]{0,120}?dated\\s+as\\s+of\\s+"]);
  const premiumMatch = text.match(/(\d{1,3}(?:\.\d+)?)%\s+premium\s+to\s+the\s+closing\s+price/i);
  const partyMatch = text.match(/Agreement\s+and\s+Plan\s+of\s+Merger[^\n]*?\samong\s+([^\n]+)/i);

  return {
    hasTransactionVote: transactionProposals.length > 0,
    consideration,
    voteRequired: voteRequiredMatch ? normalizeSpaces(voteRequiredMatch[1]) : null,
    proposalIds: transactionProposals.map((proposal) => proposal.id),
    ...(agreementDate ? { agreementDate } : {}),
    ...(partyMatch ? { mergerParties: splitParties(partyMatch[1]) } : {}),
    ...(premiumMatch ? { premiumToLastClose: `${premiumMatch[1]}%` } : {}),
    ...(/\bappraisal\s+rights\b/i.test(text) ? { appraisalRightsMentioned: true } : {}),
    ...(/\bdelisted\b|\bderegistered\b|\bno\s+further\s+market\b/i.test(text) ? { delistingMentioned: true } : {}),
  };
}

function extractMergerConsideration(text: string, transactionProposals: ProxyProposal[]): string | null {
  const proposalText = transactionProposals.map((proposal) => proposal.sourceText).join(" ");
  const candidates = [
    ...text.matchAll(/\$\s?(\d+(?:\.\d+)?)\s+(?:in\s+cash\s+)?per\s+share/gi),
  ];

  for (const match of candidates) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0.01) {
      continue;
    }
    const start = Math.max(0, (match.index ?? 0) - 260);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 260);
    const window = text.slice(start, end);
    const source = `${window} ${proposalText}`;
    const hasPaymentContext =
      /\b(converted\s+into\s+the\s+right\s+to\s+receive|receive\s+cash|cash\s+in\s+an\s+amount\s+equal\s+to|merger\s+consideration|per\s+share\s+price|merger\s+agreement)\b/i.test(source);
    const isNonConsideration =
      /\b(par\s+value|exercise\s+price|closing\s+price|market\s+price|grant\s+date|fair\s+value|weighted-average)\b/i.test(window) &&
      !/\bconverted\s+into\s+the\s+right\s+to\s+receive\b/i.test(window);
    if (hasPaymentContext && !isNonConsideration) {
      return `$${match[1]} per share`;
    }
  }

  return null;
}

function extractLegalFacts(proposals: ProxyProposal[]): ProxyParserOutput["facts"]["legal"] {
  const legalProposals = proposals.filter((proposal) =>
    proposal.category === "legal_shareholder_proposal" || proposal.category === "legal_risk_vote"
  );

  return {
    hasLegalRiskProposal: legalProposals.length > 0,
    proposalIds: legalProposals.map((proposal) => proposal.id),
    topics: legalProposals.map((proposal) => proposal.title),
  };
}

function splitParties(value: string): string[] {
  return unique(
    normalizeSpaces(value)
      .replace(/\.$/, "")
      .replace(/\s+\(.*?\)/g, "")
      .replace(/,\s+Inc\./g, " Inc.")
      .split(/\s*,\s*|\s+and\s+/)
      .map((part) => part.trim())
      .filter((part) => part && !/^(a|an|the|among|dated)$/i.test(part))
      .slice(0, 8),
  );
}

function buildWarnings(input: {
  secFormType: string | null;
  proposals: ProxyProposal[];
  cover: ProxyCoverFacts | null;
  supplement: ProxySupplementFacts | null;
  contested: ProxyContestedFacts | null;
  noticeOnly: ProxyNoticeOnlyFacts | null;
  preliminary: ProxyPreliminaryFacts | null;
  proposalExtraction: ProxyProposalExtractionSummary;
  sectionSegmentation: ProxySectionSegmentationSummary;
  keyTableExtraction: ProxyKeyTableExtractionSummary;
  textCoverage: ProxyTextCoverageSummary;
  supplementalAnalysis: ProxySupplementalAnalysisSummary;
}): string[] {
  const warnings: string[] = [];
  if (!input.proposals.length && !input.noticeOnly && !input.supplement) {
    warnings.push("No proxy proposals were extracted from the filing text.");
  }
  if (input.secFormType && /^PRE/i.test(input.secFormType)) {
    warnings.push("Preliminary proxy filing; terms may change before the definitive proxy.");
  }
  if (input.preliminary?.placeholderCount) {
    warnings.push("Preliminary proxy contains placeholders; do not treat all dates or terms as final.");
  }
  if (input.supplement) {
    warnings.push("Supplement or amendment may need parent proxy context to identify all changed terms.");
  }
  if (input.contested?.solicitationSource === "third_party") {
    warnings.push("Proxy recommendations are from a soliciting party other than the registrant.");
  }
  if (input.noticeOnly) {
    warnings.push("Notice-only proxy material contains limited proposal detail.");
  }
  if (input.proposalExtraction.countMismatch) {
    warnings.push("Proxy proposal counts differ across notice, body, or proxy card sources; preserve all candidates and avoid administrative-only handling.");
  }
  if (input.proposalExtraction.recommendationConflicts.length) {
    warnings.push("Board recommendation text conflicts across proposal sources; do not force a single recommendation without review.");
  }
  warnings.push(...input.sectionSegmentation.warnings);
  warnings.push(...input.keyTableExtraction.warnings);
  warnings.push(...input.textCoverage.warnings);
  warnings.push(...input.supplementalAnalysis.warnings);
  return unique(warnings);
}

function buildSignals(input: {
  proposals: ProxyProposal[];
  ownership: ProxyParserOutput["facts"]["ownership"];
  routineProxy: boolean;
  supplement: ProxySupplementFacts | null;
  contested: ProxyContestedFacts | null;
  reverseSplit: ProxyReverseSplitFacts | null;
  noticeOnly: ProxyNoticeOnlyFacts | null;
}): ProxySignal[] {
  const signals: ProxySignal[] = [];

  for (const proposal of input.proposals) {
    if (hasIpoListingProposalSignal(proposal)) {
      signals.push(signal("ipo_or_new_listing_vote", "ipo_listing", "high", proposal));
    } else if (proposal.category === "merger_or_transaction") {
      signals.push(signal("strategic_transaction_vote", "strategic_transaction", "high", proposal));
    } else if (proposal.category === "equity_plan") {
      signals.push(signal("equity_plan_dilution_vote", "dilution_risk", "medium", proposal));
    } else if (proposal.category === "listing_or_capital_structure") {
      const eventType: ProxyEventType = /\b(delisting|minimum bid|nasdaq|nyse)\b/i.test(proposal.sourceText)
        ? "listing_risk"
        : "dilution_risk";
      signals.push(signal("listing_or_capital_structure_vote", eventType, "high", proposal));
    } else if (proposal.category === "legal_shareholder_proposal" || proposal.category === "legal_risk_vote") {
      signals.push(signal("legal_risk_shareholder_vote", "legal_risk", "medium", proposal));
    } else if (proposal.category === "governance") {
      signals.push(signal("governance_vote", "leadership_governance", "medium", proposal));
    } else if (proposal.category === "capital_return") {
      signals.push(signal("capital_return_vote", "capital_return", "medium", proposal));
    } else if (proposal.category === "shareholder_proposal") {
      signals.push(signal("shareholder_proposal_vote", "shareholder_vote", "medium", proposal));
    }
  }

  if (input.reverseSplit?.listingComplianceMentioned || input.reverseSplit?.minimumBidMentioned) {
    const reverseSplitProposal = input.proposals.find((proposal) =>
      proposal.category === "listing_or_capital_structure" && /\breverse\s+stock\s+split\b/i.test(proposal.title),
    );
    signals.push({
      name: "reverse_split_listing_compliance_vote",
      eventType: "listing_risk",
      severity: "high",
      evidence: input.reverseSplit.sourceText ?? "Reverse stock split proposal references exchange listing compliance.",
      proposalId: reverseSplitProposal?.id ?? null,
    });
  }

  if (input.contested) {
    signals.push({
      name: input.contested.solicitationSource === "third_party" ? "third_party_contested_proxy" : "contested_proxy",
      eventType: "leadership_governance",
      severity: "medium",
      evidence: input.contested.sourceText ?? "Contested proxy solicitation facts extracted from Schedule 14A material.",
      proposalId: null,
    });
  }

  if (input.supplement?.withdrawnNominees.length) {
    signals.push({
      name: "director_nominee_withdrawal",
      eventType: "leadership_governance",
      severity: "medium",
      evidence: input.supplement.sourceText ?? "Proxy supplement withdraws a director nominee.",
      proposalId: input.supplement.affectedProposalIds[0] ?? null,
    });
  }

  if (input.noticeOnly) {
    signals.push({
      name: "notice_only_proxy_material",
      eventType: "shareholder_vote",
      severity: "low",
      evidence: input.noticeOnly.sourceText ?? "Notice of internet availability of proxy materials.",
      proposalId: null,
    });
  }

  if (input.ownership.maxBeneficialOwnershipPercent !== null && input.ownership.maxBeneficialOwnershipPercent >= 20) {
    signals.push({
      name: input.ownership.maxBeneficialOwnershipPercent >= 50 ? "insider_control_ownership" : "elevated_insider_ownership",
      eventType: "insider_ownership",
      severity: input.ownership.maxBeneficialOwnershipPercent >= 50 ? "high" : "medium",
      evidence: input.ownership.sourceText ?? "Beneficial ownership percentage extracted from proxy.",
      proposalId: null,
    });
  }

  if (input.routineProxy) {
    signals.push({
      name: "routine_annual_proxy",
      eventType: "shareholder_vote",
      severity: "low",
      evidence: "Annual proxy contains only routine director, auditor, and compensation proposals.",
      proposalId: null,
    });
  }

  return signals;
}

function hasIpoListingProposalSignal(proposal: ProxyProposal): boolean {
  const text = `${proposal.title} ${proposal.sourceText}`;
  if (/\b(?:de-?SPAC|business\s+combination|redemption|liquidation|extension\s+vote|trust\s+account)\b/i.test(text)) {
    return false;
  }
  return (
    /\b(?:traditional\s+)?initial\s+public\s+offering\b|\bIPO\b/i.test(text) ||
    /\bSPAC\s+IPO\b|\bspecial\s+purpose\s+acquisition\s+company\s+IPO\b/i.test(text) ||
    /\bdirect\s+listing\b/i.test(text) ||
    /\bIPO\s+pricing\b|\bpriced\s+(?:its|the)\s+IPO\b/i.test(text) ||
    /\bfirst\s+trading\s+day\b|\bfirst\s+trading\s+date\b|\blisting\s+date\b/i.test(text) ||
    /\bregistration\s+statement\b[^.\n]{0,160}\b(?:effective|effectiveness)\b[^.\n]{0,120}\b(?:IPO|initial\s+public\s+offering|direct\s+listing|new\s+public\s+listing)\b/i.test(text)
  );
}

function signal(
  name: string,
  eventType: ProxyEventType,
  severity: ProxySignalSeverity,
  proposal: ProxyProposal,
): ProxySignal {
  return {
    name,
    eventType,
    severity,
    evidence: proposal.sourceText,
    proposalId: proposal.id,
  };
}

function isRoutineAnnualProxy(
  proxyType: string | null,
  proposals: ProxyProposal[],
  ownership: ProxyParserOutput["facts"]["ownership"],
  warnings: string[],
): boolean {
  return (
    proxyType === "annual" &&
    proposals.length > 0 &&
    warnings.length === 0 &&
    (ownership.maxBeneficialOwnershipPercent === null || ownership.maxBeneficialOwnershipPercent < 20) &&
    proposals.every((proposal) => ROUTINE_PROXY_CATEGORIES.has(proposal.category))
  );
}

function buildCalendarItems(
  companyName: string | null,
  proxyType: string | null,
  meetingDate: string | null,
  recordDate: string | null,
): ProxyCalendarItem[] {
  const items: ProxyCalendarItem[] = [];
  const company = companyName ?? "Company";

  if (meetingDate) {
    items.push({
      type: "shareholder_meeting",
      date: meetingDate,
      description: `${company} ${(proxyType ?? "shareholder").replace(/_/g, " ")} meeting`,
    });
  }
  if (recordDate) {
    items.push({
      type: "record_date",
      date: recordDate,
      description: "Record date for shareholder voting",
    });
  }

  return items;
}

function buildSummary(
  companyName: string | null,
  proxyType: string | null,
  proposalCount: number,
  meetingDate: string | null,
): string {
  const label = proxyType ? `${proxyType[0].toUpperCase()}${proxyType.slice(1)}`.replace(/_/g, " ") : "Proxy";
  const company = companyName ?? "unknown issuer";
  const proposalText = proposalCount === 1 ? "1 proposal" : `${proposalCount} proposals`;
  const meetingText = meetingDate ? ` for a meeting on ${meetingDate}` : "";

  return `${label} proxy for ${company} covering ${proposalText}${meetingText}.`;
}
