export const SEC_FORM25_PARSER_VERSION = "sec_form25_parser_v1";
export const SEC_FORM25_PARSER_GROUP = "form25";
export const SEC_FORM25_ROOM_FORM_TYPE = "Form 25 / 25-NSE";
export const SEC_FORM25_DISPLAY_PAYLOAD_VERSION = "sec_form25_listing_removal_v1";

export const SEC_FORM25_APPROVED_EVENT_TYPES = [
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

export const SEC_FORM25_DISPLAY_TYPE_VALUES = ["sec_form25_listing_removal", "generic", "candidate_special"] as const;

export type SecForm25ApprovedEventType = (typeof SEC_FORM25_APPROVED_EVENT_TYPES)[number];
export type SecForm25DisplayType = (typeof SEC_FORM25_DISPLAY_TYPE_VALUES)[number];
export type SecForm25Confidence = "high" | "medium" | "low";
export type SecForm25SourceFormType = "25" | "25-NSE" | "25/A" | "25-NSE/A" | null;

export type SecForm25SecurityCategory =
  | "common_stock"
  | "ordinary_shares"
  | "ads"
  | "units"
  | "warrants"
  | "debt"
  | "preferred"
  | "other_non_common"
  | "unknown";

export type SecForm25RemovalReasonCategory =
  | "matured_redeemed_retired"
  | "merger_completion"
  | "listing_standards_failure"
  | "voluntary_withdrawal"
  | "exchange_transfer_or_continued_listing"
  | "unknown";

export type SecForm25DeterministicCase =
  | "matured_redeemed_retired_non_common"
  | "merger_completion_removal"
  | "voluntary_withdrawal_continued_listing_or_transfer";

export type SecForm25AnalysisReason =
  | "common_equity_delisting_possible"
  | "ambiguous_units_or_ads"
  | "unclear_voluntary_withdrawal"
  | "missing_or_unclear_reason"
  | "listing_standards_failure"
  | "unsupported_or_unrecognized_form"
  | "security_title_not_found"
  | "archive_required_ticker_missing"
  | "archive_required_exchange_missing"
  | "archive_required_issuer_identity_missing"
  | "archive_required_source_missing";

export type SecForm25Field<T> = {
  value: T;
  evidence: string;
  source: string;
  confidence: SecForm25Confidence;
};

export type SecForm25DocumentSummary = {
  type: string | null;
  description: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_truncated: boolean;
  fetch_status: number | null;
  fetch_error: string | null;
};

export type SecForm25AttachmentSummary = {
  type: string | null;
  description: string | null;
  source: string;
  text_char_count: number;
  text_truncated: boolean;
  table_count: number;
};

export type SecForm25SourceInventory = {
  documents: SecForm25DocumentSummary[];
  attachments: SecForm25AttachmentSummary[];
  primary_text_char_count: number;
  source_text_char_count: number;
  table_counts: {
    primary: number;
    attachments: number;
    total: number;
  };
  truncation_notes: string[];
};

export type SecForm25EvidenceSnippet = {
  source: string;
  text: string;
};

export type SecForm25FilingMeaning = {
  deterministic: boolean;
  case: SecForm25DeterministicCase | null;
  reason: string | null;
  evidence: string[];
};

export type SecForm25RoutingFacts = {
  analysis_required: boolean;
  analysis_reasons: SecForm25AnalysisReason[];
  suggested_event_types: SecForm25ApprovedEventType[];
  router_required: boolean;
  event_type: SecForm25ApprovedEventType | null;
  display_type: SecForm25DisplayType | null;
  display_version: typeof SEC_FORM25_DISPLAY_PAYLOAD_VERSION | null;
  classification_source: "parser_deterministic" | "router_required" | "unsupported";
  classification_reason: string | null;
  classification_evidence: string[];
  analysis_llm_required: boolean;
};

export type SecForm25Facts = {
  parser_version: typeof SEC_FORM25_PARSER_VERSION;
  source_form_type: SecForm25SourceFormType;
  raw_item_id: string | null;
  source_url: string | null;
  filed_at: string | null;
  primary_ticker: SecForm25Field<string> | null;
  primary_ticker_exchange: SecForm25Field<string> | null;
  filing_date: SecForm25Field<string> | null;
  effectiveness_date: SecForm25Field<string> | null;
  file_number: SecForm25Field<string> | null;
  issuer_name: SecForm25Field<string> | null;
  subject_company_cik: SecForm25Field<string> | null;
  filed_by_name: SecForm25Field<string> | null;
  filed_by_cik: SecForm25Field<string> | null;
  exchange: SecForm25Field<string> | null;
  removed_security: SecForm25Field<string> | null;
  security_category: SecForm25Field<SecForm25SecurityCategory>;
  rule_provision: SecForm25Field<string> | null;
  removal_reason_text: SecForm25Field<string> | null;
  removal_reason_category: SecForm25Field<SecForm25RemovalReasonCategory>;
  common_equity_affected: SecForm25Field<boolean | null>;
  delisting_or_removal_date: SecForm25Field<string> | null;
  trading_suspension_date: SecForm25Field<string> | null;
  continued_listing_or_trading_venue: SecForm25Field<string> | null;
  successor_or_acquirer: SecForm25Field<string> | null;
  consideration_summary: SecForm25Field<string> | null;
  filing_meaning: SecForm25FilingMeaning;
  routing: SecForm25RoutingFacts;
  extracted_field_count: number;
};

export type SecForm25ParserOutput = {
  parserVersion: typeof SEC_FORM25_PARSER_VERSION;
  parserGroup: typeof SEC_FORM25_PARSER_GROUP;
  formType: typeof SEC_FORM25_ROOM_FORM_TYPE;
  accessionNumber: string | null;
  isSupported: boolean;
  summary: string | null;
  facts: SecForm25Facts;
  signals: string[];
  calendarItems: [];
  warnings: string[];
  raw: {
    sourceInventory: SecForm25SourceInventory;
    selectedEvidenceSnippets: SecForm25EvidenceSnippet[];
    selectedAttachmentSnippets: SecForm25EvidenceSnippet[];
    selectedTableSnippets: SecForm25EvidenceSnippet[];
  };
};

export type SecForm25ParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  rawPayload?: unknown;
  metadata?: unknown;
};

type SecDocumentPayload = {
  type?: unknown;
  description?: unknown;
  url?: unknown;
  isPrimary?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
  fetchStatus?: unknown;
  fetchError?: unknown;
};

type AttachmentTextPayload = {
  type?: unknown;
  description?: unknown;
  text?: unknown;
  textTruncated?: unknown;
  source?: unknown;
};

type SourceText = {
  source: string;
  type: string | null;
  description: string | null;
  text: string;
  text_truncated: boolean;
};

export function parseSecForm25Filing(input: SecForm25ParseInput): SecForm25ParserOutput {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const documents = recordArray(rawPayload.documents) as SecDocumentPayload[];
  const attachmentPayloads = recordArray(rawPayload.attachment_texts) as AttachmentTextPayload[];
  const primaryText = compactText(stringValue(input.analysisText) || stringValue(input.bodyText));
  const attachmentSources = attachmentPayloads.map((item, index): SourceText => {
    const type = nullableString(item.type);
    const description = nullableString(item.description);
    return {
      source: nullableString(item.source) || formatAttachmentSource(type, description, index),
      type,
      description,
      text: compactText(stringValue(item.text)),
      text_truncated: Boolean(item.textTruncated),
    };
  });
  const sourceTexts: SourceText[] = [
    {
      source: "primary_filing_text",
      type: null,
      description: "Primary filing text",
      text: primaryText,
      text_truncated: false,
    },
    ...attachmentSources,
  ].filter((source) => Boolean(source.text));
  const filingText = compactText(sourceTexts.map((source) => source.text).join("\n\n"));
  const formType = resolveFormType({ documents, metadata, rawPayload, title: input.title, text: filingText });
  const isSupported = isForm25Family(formType);
  const accessionNumber =
    nullableString(rawPayload.accession_number) ||
    nullableString(metadata.accession_number) ||
    nullableString(input.sourceUniqueId) ||
    findTextValue(sourceTexts, /\bACCESSION NUMBER:\s*([0-9-]+)/i)?.value ||
    null;
  const sourceUrl =
    nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url) || firstDocumentUrl(documents);

  const filingDate =
    dateFieldFromValue(rawPayload.filing_date, "raw_payload.filing_date") ||
    dateFieldFromValue(input.publishedAt, "publishedAt") ||
    findDateField(sourceTexts, /\bFILED AS OF DATE:\s*(\d{8})\b/i, "filed_as_of_date");
  const effectivenessDate =
    dateFieldFromValue(rawPayload.effectiveness_date, "raw_payload.effectiveness_date") ||
    findDateField(sourceTexts, /\bEFFECTIVENESS DATE:\s*(\d{8})\b/i, "effectiveness_date");
  const fileNumber =
    stringFieldFromValue(rawPayload.file_number, "raw_payload.file_number") ||
    findXmlTagValue(sourceTexts, "fileNumber", "xml.file_number") ||
    findTextValue(sourceTexts, /\b(?:SEC FILE NUMBER|Commission File Number)\s*:?\s*([0-9-]+)/i);
  const issuerName =
    stringFieldFromValue(rawPayload.company_name, "raw_payload.company_name") ||
    stringFieldFromValue(metadata.company_name, "metadata.company_name") ||
    findXmlIssuerName(sourceTexts) ||
    findIssuerName(sourceTexts);
  const subjectCompanyCik =
    stringFieldFromValue(rawPayload.subject_company_cik, "raw_payload.subject_company_cik") ||
    stringFieldFromValue(metadata.cik, "metadata.cik") ||
    findXmlIssuerCik(sourceTexts) ||
    findTextValue(sourceTexts, /\bSUBJECT COMPANY:[\s\S]{0,260}?\bCENTRAL INDEX KEY:\s*([0-9]{1,10})/i);
  const primaryTicker = findPrimaryTicker({ rawPayload, metadata, sourceTexts });
  const primaryTickerExchange = findPrimaryTickerExchange({ rawPayload, metadata, primaryTicker });
  const filedByName =
    stringFieldFromValue(rawPayload.filed_by_name, "raw_payload.filed_by_name") ||
    findTextValue(sourceTexts, /\bFILED BY:[\s\S]{0,220}?\bCOMPANY CONFORMED NAME:\s*([^\n]+)/i);
  const filedByCik =
    stringFieldFromValue(rawPayload.filed_by_cik, "raw_payload.filed_by_cik") ||
    findTextValue(sourceTexts, /\bFILED BY:[\s\S]{0,260}?\bCENTRAL INDEX KEY:\s*([0-9]{1,10})/i);
  const exchange =
    stringFieldFromValue(rawPayload.form25_exchange, "raw_payload.form25_exchange") ||
    stringFieldFromValue(rawPayload.listing_exchange, "raw_payload.listing_exchange") ||
    stringFieldFromValue(rawPayload.removal_exchange, "raw_payload.removal_exchange") ||
    stringFieldFromValue(metadata.form25_exchange, "metadata.form25_exchange") ||
    stringFieldFromValue(metadata.listing_exchange, "metadata.listing_exchange") ||
    stringFieldFromValue(metadata.removal_exchange, "metadata.removal_exchange") ||
    findXmlExchangeName(sourceTexts) ||
    findExchange(sourceTexts, filedByName?.value || null) ||
    stringFieldFromValue(rawPayload.exchange, "raw_payload.exchange");
  const removedSecurity =
    stringFieldFromValue(rawPayload.security_title, "raw_payload.security_title") ||
    findXmlTagValue(sourceTexts, "descriptionClassSecurity", "xml.description_class_security") ||
    findRemovedSecurity(sourceTexts);
  const securityCategory = classifySecurity(removedSecurity);
  const commonEquityAffected = classifyCommonEquity(removedSecurity, securityCategory, filingText);
  const ruleProvision =
    stringFieldFromValue(rawPayload.rule_provision, "raw_payload.rule_provision") ||
    findXmlTagValue(sourceTexts, "ruleProvision", "xml.rule_provision") ||
    findRuleProvision(sourceTexts);
  const removalReasonText =
    stringFieldFromValue(rawPayload.removal_reason_text, "raw_payload.removal_reason_text") ||
    findRemovalReasonText(sourceTexts);
  const reasonTextForClassification = compactText(`${removalReasonText?.value || ""}\n\n${filingText.slice(0, 5000)}`);
  const removalReasonCategory = refineRemovalReasonCategory({
    initial: classifyRemovalReason(reasonTextForClassification, removalReasonText?.source || "combined_filing_text"),
    reasonText: reasonTextForClassification,
    ruleProvision,
  });
  const removalDate =
    dateFieldFromValue(rawPayload.delisting_or_removal_date, "raw_payload.delisting_or_removal_date") ||
    findRemovalDate(sourceTexts);
  const suspensionDate =
    dateFieldFromValue(rawPayload.trading_suspension_date, "raw_payload.trading_suspension_date") ||
    findSuspensionDate(sourceTexts);
  const continuedListingOrTradingVenue =
    stringFieldFromValue(rawPayload.continued_listing_or_trading_venue, "raw_payload.continued_listing_or_trading_venue") ||
    findContinuedListing(sourceTexts);
  const successorOrAcquirer =
    stringFieldFromValue(rawPayload.successor_or_acquirer, "raw_payload.successor_or_acquirer") ||
    findSuccessorOrAcquirer(sourceTexts);
  const considerationSummary =
    stringFieldFromValue(rawPayload.consideration_summary, "raw_payload.consideration_summary") ||
    findConsiderationSummary(sourceTexts);
  const filingMeaning = buildFilingMeaning({
    commonEquityAffected,
    considerationSummary,
    continuedListingOrTradingVenue,
    removalReasonCategory,
    removalReasonText,
    securityCategory,
    successorOrAcquirer,
  });
  const routing = buildRoutingFacts({
    commonEquityAffected,
    exchange,
    filingMeaning,
    issuerName,
    isSupported,
    primaryTicker,
    removalReasonCategory,
    removalReasonText,
    securityCategory,
    removedSecurity,
    sourceUrl,
    subjectCompanyCik,
  });
  const documentSummaries = documents.map(mapDocumentSummary);
  const attachmentSummaries = attachmentSources.map(mapAttachmentSummary);
  const sourceInventory = buildSourceInventory({
    attachments: attachmentSummaries,
    documents: documentSummaries,
    primaryText,
    sourceTexts,
  });
  const selectedAttachmentSnippets = selectAttachmentSnippets(attachmentSources);
  const selectedTableSnippets = selectTableSnippets(sourceTexts);
  const selectedEvidenceSnippets = selectEvidenceSnippets([
    issuerName,
    primaryTicker,
    primaryTickerExchange,
    exchange,
    removedSecurity,
    ruleProvision,
    removalReasonText,
    removalReasonCategory,
    commonEquityAffected,
    removalDate,
    suspensionDate,
    continuedListingOrTradingVenue,
    successorOrAcquirer,
    considerationSummary,
  ]);
  const extractedFieldCount = [
    filingDate,
    effectivenessDate,
    fileNumber,
    issuerName,
    subjectCompanyCik,
    primaryTicker,
    primaryTickerExchange,
    filedByName,
    filedByCik,
    exchange,
    removedSecurity,
    ruleProvision,
    removalReasonText,
    removalDate,
    suspensionDate,
    continuedListingOrTradingVenue,
    successorOrAcquirer,
    considerationSummary,
  ].filter(Boolean).length;
  const facts: SecForm25Facts = {
    parser_version: SEC_FORM25_PARSER_VERSION,
    source_form_type: formType,
    raw_item_id: nullableString(input.rawItemId),
    source_url: sourceUrl,
    filed_at: nullableString(input.publishedAt),
    primary_ticker: primaryTicker,
    primary_ticker_exchange: primaryTickerExchange,
    filing_date: filingDate,
    effectiveness_date: effectivenessDate,
    file_number: fileNumber,
    issuer_name: issuerName,
    subject_company_cik: subjectCompanyCik,
    filed_by_name: filedByName,
    filed_by_cik: filedByCik,
    exchange,
    removed_security: removedSecurity,
    security_category: securityCategory,
    rule_provision: ruleProvision,
    removal_reason_text: removalReasonText,
    removal_reason_category: removalReasonCategory,
    common_equity_affected: commonEquityAffected,
    delisting_or_removal_date: removalDate,
    trading_suspension_date: suspensionDate,
    continued_listing_or_trading_venue: continuedListingOrTradingVenue,
    successor_or_acquirer: successorOrAcquirer,
    consideration_summary: considerationSummary,
    filing_meaning: filingMeaning,
    routing,
    extracted_field_count: extractedFieldCount,
  };
  const warnings = buildWarnings({ facts, isSupported, sourceInventory });

  return {
    parserVersion: SEC_FORM25_PARSER_VERSION,
    parserGroup: SEC_FORM25_PARSER_GROUP,
    formType: SEC_FORM25_ROOM_FORM_TYPE,
    accessionNumber,
    isSupported,
    summary: buildSummary(facts),
    facts,
    signals: buildSignals(facts),
    calendarItems: [],
    warnings,
    raw: {
      sourceInventory,
      selectedEvidenceSnippets,
      selectedAttachmentSnippets,
      selectedTableSnippets,
    },
  };
}

function buildFilingMeaning({
  commonEquityAffected,
  considerationSummary,
  continuedListingOrTradingVenue,
  removalReasonCategory,
  removalReasonText,
  securityCategory,
  successorOrAcquirer,
}: {
  commonEquityAffected: SecForm25Field<boolean | null>;
  considerationSummary: SecForm25Field<string> | null;
  continuedListingOrTradingVenue: SecForm25Field<string> | null;
  removalReasonCategory: SecForm25Field<SecForm25RemovalReasonCategory>;
  removalReasonText: SecForm25Field<string> | null;
  securityCategory: SecForm25Field<SecForm25SecurityCategory>;
  successorOrAcquirer: SecForm25Field<string> | null;
}): SecForm25FilingMeaning {
  const evidence = [
    removalReasonText?.evidence,
    removalReasonCategory.evidence,
    considerationSummary?.evidence,
    continuedListingOrTradingVenue?.evidence,
    successorOrAcquirer?.evidence,
  ].filter((item): item is string => Boolean(item));

  if (
    removalReasonCategory.value === "matured_redeemed_retired" &&
    commonEquityAffected.value !== true &&
    !["ads", "units", "common_stock", "ordinary_shares", "unknown"].includes(securityCategory.value)
  ) {
    return {
      deterministic: true,
      case: "matured_redeemed_retired_non_common",
      reason: "The filing states the removed security matured, was redeemed, or was retired, and the security is not common equity.",
      evidence: evidence.slice(0, 3),
    };
  }

  if (removalReasonCategory.value === "merger_completion" && (successorOrAcquirer || considerationSummary || removalReasonText)) {
    return {
      deterministic: true,
      case: "merger_completion_removal",
      reason: "The filing states the removal follows completion or effectiveness of a merger.",
      evidence: evidence.slice(0, 3),
    };
  }

  if (
    (removalReasonCategory.value === "voluntary_withdrawal" ||
      removalReasonCategory.value === "exchange_transfer_or_continued_listing") &&
    continuedListingOrTradingVenue
  ) {
    return {
      deterministic: true,
      case: "voluntary_withdrawal_continued_listing_or_transfer",
      reason: "The filing states a voluntary withdrawal while another listing, trading venue, or transfer remains available.",
      evidence: evidence.slice(0, 3),
    };
  }

  return {
    deterministic: false,
    case: null,
    reason: null,
    evidence: evidence.slice(0, 3),
  };
}

function buildRoutingFacts({
  commonEquityAffected,
  exchange,
  filingMeaning,
  issuerName,
  isSupported,
  primaryTicker,
  removalReasonCategory,
  removalReasonText,
  removedSecurity,
  securityCategory,
  sourceUrl,
  subjectCompanyCik,
}: {
  commonEquityAffected: SecForm25Field<boolean | null>;
  exchange: SecForm25Field<string> | null;
  filingMeaning: SecForm25FilingMeaning;
  issuerName: SecForm25Field<string> | null;
  isSupported: boolean;
  primaryTicker: SecForm25Field<string> | null;
  removalReasonCategory: SecForm25Field<SecForm25RemovalReasonCategory>;
  removalReasonText: SecForm25Field<string> | null;
  removedSecurity: SecForm25Field<string> | null;
  securityCategory: SecForm25Field<SecForm25SecurityCategory>;
  sourceUrl: string | null;
  subjectCompanyCik: SecForm25Field<string> | null;
}): SecForm25RoutingFacts {
  const reasons = new Set<SecForm25AnalysisReason>();
  const ambiguityReasons = new Set<SecForm25AnalysisReason>();
  if (!isSupported) reasons.add("unsupported_or_unrecognized_form");
  if (!removedSecurity) reasons.add("security_title_not_found");
  if (removalReasonCategory.value === "unknown") reasons.add("missing_or_unclear_reason");
  if (!isSupported) ambiguityReasons.add("unsupported_or_unrecognized_form");
  if (!removedSecurity) ambiguityReasons.add("security_title_not_found");
  if (removalReasonCategory.value === "unknown") ambiguityReasons.add("missing_or_unclear_reason");

  if (filingMeaning.deterministic) {
    if (!primaryTicker) reasons.add("archive_required_ticker_missing");
    if (!exchange) reasons.add("archive_required_exchange_missing");
    if (!issuerName || !subjectCompanyCik) reasons.add("archive_required_issuer_identity_missing");
    if (!sourceUrl) reasons.add("archive_required_source_missing");
  }

  if (!filingMeaning.deterministic) {
    if (commonEquityAffected.value === true) reasons.add("common_equity_delisting_possible");
    if (securityCategory.value === "units" || securityCategory.value === "ads") {
      reasons.add("ambiguous_units_or_ads");
      ambiguityReasons.add("ambiguous_units_or_ads");
    }
    if (removalReasonCategory.value === "voluntary_withdrawal") {
      reasons.add("unclear_voluntary_withdrawal");
      ambiguityReasons.add("unclear_voluntary_withdrawal");
    }
    if (removalReasonCategory.value === "listing_standards_failure") {
      reasons.add("listing_standards_failure");
      if (commonEquityAffected.value !== true || !isPlainCommonEquityCategory(securityCategory.value)) {
        ambiguityReasons.add("listing_standards_failure");
      }
    }
  }

  const suggested = new Set<SecForm25ApprovedEventType>();
  if (removalReasonCategory.value === "merger_completion") suggested.add("strategic_transaction");
  if (removalReasonCategory.value === "listing_standards_failure" || reasons.has("common_equity_delisting_possible")) {
    suggested.add("listing_risk");
  }
  if (/bankruptcy|chapter 11|insolvenc|receivership/i.test(`${removalReasonText?.value || ""}`)) {
    suggested.add("financial_risk");
    suggested.add("legal_risk");
  }
  if (!suggested.size) suggested.add("other");

  const deterministic = classifyDeterministicRoute({
    commonEquityAffected,
    filingMeaning,
    removalReasonCategory,
    removalReasonText,
    removedSecurity,
    securityCategory,
  });
  const routerRequired = !deterministic.event_type || ambiguityReasons.size > 0;
  const displayType: SecForm25DisplayType | null = isSupported ? "sec_form25_listing_removal" : null;
  const displayVersion = isSupported ? SEC_FORM25_DISPLAY_PAYLOAD_VERSION : null;
  const classificationSource = !isSupported ? "unsupported" : routerRequired ? "router_required" : "parser_deterministic";

  return {
    analysis_required: reasons.size > 0,
    analysis_reasons: [...reasons],
    suggested_event_types: [...suggested],
    router_required: routerRequired,
    event_type: routerRequired ? null : deterministic.event_type,
    display_type: displayType,
    display_version: displayVersion,
    classification_source: classificationSource,
    classification_reason: routerRequired
      ? "Router/classifier required because security type, reason, or investor impact is ambiguous."
      : deterministic.reason,
    classification_evidence: deterministic.evidence,
    analysis_llm_required: routerRequired || deterministic.analysis_llm_required,
  };
}

function classifyDeterministicRoute({
  commonEquityAffected,
  filingMeaning,
  removalReasonCategory,
  removalReasonText,
  removedSecurity,
  securityCategory,
}: {
  commonEquityAffected: SecForm25Field<boolean | null>;
  filingMeaning: SecForm25FilingMeaning;
  removalReasonCategory: SecForm25Field<SecForm25RemovalReasonCategory>;
  removalReasonText: SecForm25Field<string> | null;
  removedSecurity: SecForm25Field<string> | null;
  securityCategory: SecForm25Field<SecForm25SecurityCategory>;
}): {
  event_type: SecForm25ApprovedEventType | null;
  reason: string | null;
  evidence: string[];
  analysis_llm_required: boolean;
} {
  const evidence = [
    ...filingMeaning.evidence,
    removalReasonText?.evidence,
    removalReasonCategory.evidence,
    removedSecurity?.evidence,
  ].filter((item): item is string => Boolean(item));
  const uniqueEvidence = [...new Set(evidence)].slice(0, 5);

  if (filingMeaning.case === "merger_completion_removal") {
    return {
      event_type: "strategic_transaction",
      reason: "Parser classified a completed merger removal from source-backed Form 25 facts.",
      evidence: uniqueEvidence,
      analysis_llm_required: false,
    };
  }

  if (
    filingMeaning.case === "matured_redeemed_retired_non_common" ||
    filingMeaning.case === "voluntary_withdrawal_continued_listing_or_transfer"
  ) {
    return {
      event_type: "other",
      reason: "Parser classified a deterministic low-impact Form 25 removal from source-backed facts.",
      evidence: uniqueEvidence,
      analysis_llm_required: false,
    };
  }

  if (
    commonEquityAffected.value === true &&
    isPlainCommonEquityCategory(securityCategory.value) &&
    removalReasonCategory.value === "listing_standards_failure"
  ) {
    return {
      event_type: "listing_risk",
      reason: "Parser classified a common-equity listing-standard delisting from source-backed Form 25 facts.",
      evidence: uniqueEvidence,
      analysis_llm_required: true,
    };
  }

  return {
    event_type: null,
    reason: null,
    evidence: uniqueEvidence,
    analysis_llm_required: true,
  };
}

function isPlainCommonEquityCategory(value: SecForm25SecurityCategory) {
  return value === "common_stock" || value === "ordinary_shares";
}

function buildWarnings({
  facts,
  isSupported,
  sourceInventory,
}: {
  facts: SecForm25Facts;
  isSupported: boolean;
  sourceInventory: SecForm25SourceInventory;
}) {
  const warnings: string[] = [];
  if (!isSupported) warnings.push("unsupported_or_unrecognized_form");
  if (!facts.removed_security) warnings.push("security_title_not_found");
  if (!facts.removal_reason_text || facts.removal_reason_category.value === "unknown") warnings.push("missing_or_unclear_reason");
  if (facts.routing.analysis_required) warnings.push(...facts.routing.analysis_reasons);
  warnings.push(...sourceInventory.truncation_notes);
  return [...new Set(warnings)];
}

function buildSummary(facts: SecForm25Facts) {
  const issuer = facts.issuer_name?.value || "Issuer";
  const security = facts.removed_security?.value || "a listed security";
  const exchange = facts.exchange?.value ? ` from ${facts.exchange.value}` : "";
  const reason = facts.removal_reason_category.value !== "unknown" ? `; raw reason category: ${facts.removal_reason_category.value}` : "";
  return `${issuer} filed ${facts.source_form_type || "Form 25"} to remove ${security}${exchange}${reason}.`;
}

function buildSignals(facts: SecForm25Facts) {
  const signals = new Set<string>();
  if (facts.filing_meaning.deterministic && facts.filing_meaning.case) signals.add(`deterministic:${facts.filing_meaning.case}`);
  if (facts.routing.event_type) signals.add(`event_type:${facts.routing.event_type}`);
  if (facts.routing.router_required) signals.add("router_required");
  if (!facts.routing.router_required && facts.routing.event_type) signals.add("parser_classified_event_type");
  if (facts.routing.analysis_required) signals.add("analysis_required");
  facts.routing.analysis_reasons.forEach((reason) => signals.add(reason));
  if (facts.common_equity_affected.value === true) signals.add("common_equity_affected");
  return [...signals];
}

function buildSourceInventory({
  attachments,
  documents,
  primaryText,
  sourceTexts,
}: {
  attachments: SecForm25AttachmentSummary[];
  documents: SecForm25DocumentSummary[];
  primaryText: string;
  sourceTexts: SourceText[];
}): SecForm25SourceInventory {
  const primaryTableCount = countTables(primaryText);
  const attachmentTableCount = attachments.reduce((sum, attachment) => sum + attachment.table_count, 0);
  const documentTruncationNotes = documents
    .filter((document) => document.text_truncated)
    .map((document) => `document_truncated:${formatDocumentLabel(document.type, document.description)}`);
  const attachmentTruncationNotes = attachments
    .filter((attachment) => attachment.text_truncated)
    .map((attachment) => `attachment_truncated:${attachment.source}`);

  return {
    documents,
    attachments,
    primary_text_char_count: primaryText.length,
    source_text_char_count: sourceTexts.reduce((sum, source) => sum + source.text.length, 0),
    table_counts: {
      primary: primaryTableCount,
      attachments: attachmentTableCount,
      total: primaryTableCount + attachmentTableCount,
    },
    truncation_notes: [...documentTruncationNotes, ...attachmentTruncationNotes],
  };
}

function mapDocumentSummary(document: SecDocumentPayload): SecForm25DocumentSummary {
  return {
    type: nullableString(document.type),
    description: nullableString(document.description),
    url_present: Boolean(nullableString(document.url)),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
    fetch_status: nullableNumber(document.fetchStatus),
    fetch_error: nullableString(document.fetchError),
  };
}

function mapAttachmentSummary(attachment: SourceText): SecForm25AttachmentSummary {
  return {
    type: attachment.type,
    description: attachment.description,
    source: attachment.source,
    text_char_count: attachment.text.length,
    text_truncated: attachment.text_truncated,
    table_count: countTables(attachment.text),
  };
}

function classifySecurity(removedSecurity: SecForm25Field<string> | null): SecForm25Field<SecForm25SecurityCategory> {
  const title = removedSecurity?.value || "";
  const lower = title.toLowerCase();
  let value: SecForm25SecurityCategory = "unknown";
  if (/\b(?:note|notes|debenture|debentures|bond|bonds|senior\s+notes|subordinated\s+notes)\b/i.test(lower)) value = "debt";
  else if (/\bwarrants?\b/i.test(lower)) value = "warrants";
  else if (/\bpreferred\b/i.test(lower)) value = "preferred";
  else if (/\b(?:american depositary|ads|adr)\b/i.test(lower)) value = "ads";
  else if (/\bordinary shares?\b/i.test(lower)) value = "ordinary_shares";
  else if (/\b(?:common stock|common shares?|class [a-z] common)\b/i.test(lower)) value = "common_stock";
  else if (/\bunits?\b/i.test(lower)) value = "units";
  else if (title) value = "other_non_common";

  return {
    value,
    evidence: removedSecurity?.evidence || "Security title was not found in the filing text.",
    source: removedSecurity?.source || "derived",
    confidence: value === "unknown" ? "low" : "high",
  };
}

function classifyCommonEquity(
  removedSecurity: SecForm25Field<string> | null,
  securityCategory: SecForm25Field<SecForm25SecurityCategory>,
  filingText: string,
): SecForm25Field<boolean | null> {
  const title = removedSecurity?.value || "";
  if (securityCategory.value !== "ads" && securityCategory.value !== "units" && hasStandaloneCommonEquityClass(title)) {
    return {
      value: true,
      evidence: removedSecurity?.evidence || title,
      source: removedSecurity?.source || "derived",
      confidence: "high",
    };
  }
  if (securityCategory.value === "common_stock" || securityCategory.value === "ordinary_shares") {
    return {
      value: true,
      evidence: removedSecurity?.evidence || title,
      source: removedSecurity?.source || "derived",
      confidence: "high",
    };
  }
  if (securityCategory.value === "ads") {
    const adsCommonMatch =
      title.match(/\b(?:representing|represents|each\s+representing)[^.\n]{0,120}\bcommon\b/i) ||
      filingText.match(/\b(?:ADS|American Depositary Shares?)[^.\n]{0,180}\b(?:representing|represents|each\s+representing)[^.\n]{0,180}\bcommon\b/i);
    return {
      value: adsCommonMatch ? true : null,
      evidence: adsCommonMatch
        ? pickEvidenceSentence(filingText, adsCommonMatch.index || 0)
        : removedSecurity?.evidence || title || "ADS security title found without enough underlying equity detail.",
      source: adsCommonMatch ? "combined_filing_text" : removedSecurity?.source || "derived",
      confidence: adsCommonMatch ? "medium" : "low",
    };
  }
  if (securityCategory.value === "units") {
    return {
      value: null,
      evidence: removedSecurity?.evidence || title || "Unit security title found without enough component detail.",
      source: removedSecurity?.source || "derived",
      confidence: "low",
    };
  }
  if (["debt", "warrants", "preferred", "other_non_common"].includes(securityCategory.value)) {
    return {
      value: false,
      evidence: removedSecurity?.evidence || title,
      source: removedSecurity?.source || "derived",
      confidence: securityCategory.value === "other_non_common" ? "medium" : "high",
    };
  }
  return {
    value: null,
    evidence: "Security class was not clear enough to determine whether common equity is affected.",
    source: "derived",
    confidence: "low",
  };
}

function hasStandaloneCommonEquityClass(title: string) {
  if (!/\b(?:common stock|common shares?|ordinary shares?)\b/i.test(title)) return false;
  const warrantOnlyUnderlying =
    /^\s*warrants?\b[\s\S]{0,260}\b(?:to purchase|exercisable for)\b[\s\S]{0,260}\b(?:common|ordinary)\b/i.test(title) &&
    !/[;]\s*(?:class\s+[a-z]\s+)?(?:common stock|common shares?|ordinary shares?)\b/i.test(title) &&
    !/^\s*(?:class\s+[a-z]\s+)?(?:common stock|common shares?|ordinary shares?)\b/i.test(title);
  return !warrantOnlyUnderlying;
}

function classifyRemovalReason(text: string, source: string): SecForm25Field<SecForm25RemovalReasonCategory> {
  const patterns: Array<[SecForm25RemovalReasonCategory, RegExp, SecForm25Confidence]> = [
    [
      "matured_redeemed_retired",
      /\b(?:called for redemption|redeemed|paid at maturity|maturity|retirement|retired|expired|all rights[^.\n]{0,120}extinguished|funds sufficient for the payment)\b/i,
      "high",
    ],
    [
      "merger_completion",
      /\b(?:merger|acquisition|business combination|redomiciliation|simplification of the corporate structure)[\s\S]{0,520}?\b(?:became effective|completed|consummated|closed|closing|exchanged for|converted into|will be converted|will receive)\b|\b(?:was|were|is|are|will be)?\s*(?:converted into|exchanged for)\b/i,
      "high",
    ],
    [
      "exchange_transfer_or_continued_listing",
      /\b(?:continue|continues|will continue)\s+(?:to be\s+)?(?:listed|trading)\b|\btransfer(?:red)?\s+(?:its\s+)?listing\b|\bprincipal listing exchange\b/i,
      "high",
    ],
    [
      "voluntary_withdrawal",
      /\b(?:voluntar(?:y|ily)\s+(?:delist|withdraw)|issuer has complied[^.\n]{0,160}voluntary withdrawal|withdraw(?:al)?\s+from\s+listing)\b/i,
      "medium",
    ],
    [
      "listing_standards_failure",
      /\b(?:no longer suitable|failed to cure|minimum bid|below \$?1\.00|continued listing standard|Listing Rule|Listed Company Manual|non-compliance|not appeal|did not appeal|delisting determination|chapter 11|bankrupt)\b/i,
      "high",
    ],
  ];

  for (const [value, pattern, confidence] of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        value,
        evidence: pickEvidenceSentence(text, match.index || 0),
        source,
        confidence,
      };
    }
  }

  return {
    value: "unknown",
    evidence: text ? truncate(text, 420) : "No removal reason text found.",
    source,
    confidence: "low",
  };
}

function refineRemovalReasonCategory({
  initial,
  reasonText,
  ruleProvision,
}: {
  initial: SecForm25Field<SecForm25RemovalReasonCategory>;
  reasonText: string;
  ruleProvision: SecForm25Field<string> | null;
}): SecForm25Field<SecForm25RemovalReasonCategory> {
  const rule = ruleProvision?.value || "";

  if (isRuleA1OrA2(rule) && initial.value === "unknown") {
    return reasonCategoryFromRule(
      "matured_redeemed_retired",
      ruleProvision,
      "Rule 12d2-2(a)(1)/(a)(2) states the class was called for redemption, matured, retired, redeemed, or paid.",
    );
  }

  if (isRuleA4(rule) && initial.value === "unknown") {
    return reasonCategoryFromRule(
      "matured_redeemed_retired",
      ruleProvision,
      "Rule 12d2-2(a)(4) states all rights pertaining to the class were extinguished.",
    );
  }

  if (isRuleA3(rule) && hasTransactionCompletionEvidence(reasonText)) {
    return {
      value: "merger_completion",
      evidence: pickEvidenceSentence(reasonText, reasonText.search(transactionCompletionPattern())),
      source: initial.value === "unknown" ? ruleProvision?.source || initial.source : initial.source,
      confidence: "high",
    };
  }

  return initial;
}

function reasonCategoryFromRule(
  value: SecForm25RemovalReasonCategory,
  ruleProvision: SecForm25Field<string> | null,
  fallbackEvidence: string,
): SecForm25Field<SecForm25RemovalReasonCategory> {
  return {
    value,
    evidence: ruleProvision?.evidence || fallbackEvidence,
    source: ruleProvision?.source || "rule_provision",
    confidence: "high",
  };
}

function isRuleA1OrA2(rule: string) {
  return /12d2-2\(a\)\([12]\)/i.test(rule);
}

function isRuleA3(rule: string) {
  return /12d2-2\(a\)\(3\)/i.test(rule);
}

function isRuleA4(rule: string) {
  return /12d2-2\(a\)\(4\)/i.test(rule);
}

function transactionCompletionPattern() {
  return /\b(?:merger|acquisition|business combination|redomiciliation|simplification of the corporate structure)[\s\S]{0,520}?\b(?:became effective|completed|consummated|closed|closing|exchanged for|converted into|will be converted|will receive)\b|\b(?:was|were|is|are|will be)?\s*(?:converted into|exchanged for)\b/i;
}

function hasTransactionCompletionEvidence(text: string) {
  return transactionCompletionPattern().test(text);
}

function findRemovalReasonText(sourceTexts: SourceText[]): SecForm25Field<string> | null {
  const preferred = sourceTexts.filter((source) =>
    /\b(?:EX-99\.25|99\.25|delist|removal|reason|notice)\b/i.test(`${source.type || ""} ${source.description || ""} ${source.source}`),
  );
  const sources = [...preferred, ...sourceTexts];
  for (const source of sources) {
    const text = source.text;
    const match = text.match(
      /\b(?:NOTIFICATION OF THE REMOVAL FROM LISTING AND REGISTRATION OF THE STATED SECURITIES|Delisting Determination|voluntar(?:y|ily)\s+(?:delist|withdraw)|no longer suitable|called for redemption|redeemed|paid at maturity|expired|all rights[^.\n]{0,120}extinguished|merger|acquisition|business combination|redomiciliation|simplification of the corporate structure|converted into|exchanged for|continued listing|continue to be listed)\b/i,
    );
    if (!match) continue;
    const start = Math.max(0, (match.index || 0) - 80);
    const value = truncate(compactText(text.slice(start, start + 1600)), 1200);
    return {
      value,
      evidence: truncate(pickEvidenceSentence(text, match.index || 0), 420),
      source: source.source,
      confidence: source.source === "primary_filing_text" ? "medium" : "high",
    };
  }
  return null;
}

function findPrimaryTicker({
  rawPayload,
  metadata,
  sourceTexts,
}: {
  rawPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sourceTexts: SourceText[];
}) {
  return (
    tickerFieldFromValue(rawPayload.primary_ticker, "raw_payload.primary_ticker") ||
    tickerFieldFromValue(rawPayload.ticker, "raw_payload.ticker") ||
    tickerFieldFromValue(rawPayload.symbol, "raw_payload.symbol") ||
    tickerFieldFromValue(rawPayload.trading_symbol, "raw_payload.trading_symbol") ||
    tickerFieldFromValue(rawPayload.tradingSymbol, "raw_payload.tradingSymbol") ||
    tickerFieldFromValue(metadata.primary_ticker, "metadata.primary_ticker") ||
    tickerFieldFromValue(metadata.ticker, "metadata.ticker") ||
    tickerFieldFromValue(metadata.symbol, "metadata.symbol") ||
    tickerFieldFromValue(metadata.trading_symbol, "metadata.trading_symbol") ||
    tickerFieldFromValue(metadata.tradingSymbol, "metadata.tradingSymbol") ||
    findXmlTagValue(sourceTexts, "tradingSymbol", "xml.trading_symbol") ||
    findTextValue(sourceTexts, /\b(?:Ticker|Trading Symbol)\s*:?\s*([A-Z][A-Z0-9.\-]{0,14})\b/i)
  );
}

function findPrimaryTickerExchange({
  rawPayload,
  metadata,
  primaryTicker,
}: {
  rawPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  primaryTicker: SecForm25Field<string> | null;
}) {
  if (!primaryTicker) return null;
  return (
    tickerExchangeFieldFromValue(rawPayload.primary_ticker_exchange, "raw_payload.primary_ticker_exchange") ||
    tickerExchangeFieldFromValue(rawPayload.ticker_exchange, "raw_payload.ticker_exchange") ||
    tickerExchangeFieldFromValue(rawPayload.exchange, "raw_payload.exchange") ||
    tickerExchangeFieldFromValue(metadata.primary_ticker_exchange, "metadata.primary_ticker_exchange") ||
    tickerExchangeFieldFromValue(metadata.ticker_exchange, "metadata.ticker_exchange") ||
    tickerExchangeFieldFromValue(metadata.exchange, "metadata.exchange")
  );
}

function tickerFieldFromValue(value: unknown, source: string): SecForm25Field<string> | null {
  const directTicker = normalizeTicker(value);
  if (directTicker) {
    return {
      value: directTicker,
      evidence: stringValue(value) || directTicker,
      source,
      confidence: "high",
    };
  }

  const record = toRecord(value);
  if (record) {
    return (
      tickerFieldFromValue(record.ticker, `${source}.ticker`) ||
      tickerFieldFromValue(record.symbol, `${source}.symbol`) ||
      tickerFieldFromValue(record.value, `${source}.value`)
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const ticker = tickerFieldFromValue(item, `${source}[]`);
      if (ticker) return ticker;
    }
  }

  return null;
}

function tickerExchangeFieldFromValue(value: unknown, source: string): SecForm25Field<string> | null {
  const text = nullableString(value);
  if (!text) return null;
  return {
    value: text,
    evidence: text,
    source,
    confidence: "high",
  };
}

function findXmlTagValue(sourceTexts: SourceText[], tagName: string, sourceName: string): SecForm25Field<string> | null {
  const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i");
  for (const source of sourceTexts) {
    const match = source.text.match(pattern);
    if (!match) continue;
    const value = compactText(decodeHtmlEntities(match[1] || ""));
    if (!value) continue;
    return {
      value,
      evidence: value,
      source: `${source.source}.${sourceName}`,
      confidence: "high",
    };
  }
  return null;
}

function findXmlIssuerName(sourceTexts: SourceText[]) {
  return findXmlNestedTagValue(sourceTexts, "issuer", "entityName", "xml.issuer.entity_name");
}

function findXmlIssuerCik(sourceTexts: SourceText[]) {
  return findXmlNestedTagValue(sourceTexts, "issuer", "cik", "xml.issuer.cik");
}

function findXmlExchangeName(sourceTexts: SourceText[]) {
  return findXmlNestedTagValue(sourceTexts, "exchange", "entityName", "xml.exchange.entity_name");
}

function findXmlNestedTagValue(
  sourceTexts: SourceText[],
  parentTagName: string,
  childTagName: string,
  sourceName: string,
): SecForm25Field<string> | null {
  const pattern = new RegExp(`<${parentTagName}>[\\s\\S]*?<${childTagName}>\\s*([\\s\\S]*?)\\s*<\\/${childTagName}>`, "i");
  for (const source of sourceTexts) {
    const match = source.text.match(pattern);
    if (!match) continue;
    const value = compactText(decodeHtmlEntities(match[1] || ""));
    if (!value) continue;
    return {
      value,
      evidence: value,
      source: `${source.source}.${sourceName}`,
      confidence: "high",
    };
  }
  return null;
}

function findIssuerName(sourceTexts: SourceText[]) {
  return (
    findTextValue(sourceTexts, /\bIssuer:\s*([^\n]+)/i) ||
    findTextValue(sourceTexts, /\bSUBJECT COMPANY:[\s\S]{0,200}?\bCOMPANY CONFORMED NAME:\s*([^\n]+)/i) ||
    findTextValue(sourceTexts, /\b([A-Z][A-Za-z0-9&.,' -]+?)\s*\/\s*(?:NYSE|NASDAQ|NYSE Arca|NYSE American)/i)
  );
}

function findExchange(sourceTexts: SourceText[], filedByName: string | null) {
  return (
    findTextValue(sourceTexts, /\bExchange:\s*([^\n]+)/i) ||
    normalizeExchangeFromFiledBy(filedByName) ||
    findTextValue(sourceTexts, /\b(?:NEW YORK STOCK EXCHANGE LLC|NYSE AMERICAN LLC|NYSE Arca(?:, Inc\.| Equities, Inc\.)?|Nasdaq Stock Market LLC|The Nasdaq Stock Market LLC)\b/i)
  );
}

function normalizeExchangeFromFiledBy(value: string | null): SecForm25Field<string> | null {
  if (!value) return null;
  if (/new york stock exchange/i.test(value)) {
    return { value: "NEW YORK STOCK EXCHANGE LLC", evidence: value, source: "filed_by_name", confidence: "medium" };
  }
  if (/nasdaq/i.test(value)) {
    return { value: "Nasdaq Stock Market LLC", evidence: value, source: "filed_by_name", confidence: "medium" };
  }
  if (/nyse american/i.test(value)) {
    return { value: "NYSE AMERICAN LLC", evidence: value, source: "filed_by_name", confidence: "medium" };
  }
  return null;
}

function findRemovedSecurity(sourceTexts: SourceText[]) {
  return (
    findTextValue(sourceTexts, /\n\s*([^\n]{3,240}?)\s*\n\s*\(Description of class of securities\)/i) ||
    findTextValue(sourceTexts, /\b(Units of Beneficial Interest|Ordinary shares|Common Stock|Class [A-Z] Common Stock|American Depositary Shares?[^.\n]{0,160}|ADS[^.\n]{0,160}|Warrants?[^.\n]{0,180}|[0-9.]+%\s+(?:Senior|Subordinated)?\s*Notes? due [A-Za-z0-9 ,]+)\s+17\s+C[FP]R\s+240\.12d[2D]-2/i) ||
    findTextValue(sourceTexts, /\b((?:[A-Za-z0-9 .%/$'()-]+\s+)?(?:Senior|Subordinated)?\s*Notes? due [A-Za-z0-9 ,]+)\s+17\s+C[FP]R\s+240\.12d[2D]-2/i)
  );
}

function findRuleProvision(sourceTexts: SourceText[]) {
  const checked = findTextValue(sourceTexts, /\[\s*X\s*\]\s*(17\s+C[FP]R\s+240\.12d[2D]-2\([a-c]\)(?:\(\d\))?)/i);
  if (checked) return checked;

  const rawStructuredSources = sourceTexts.filter((source) =>
    /\b(?:primary_doc\.xml|\.txt|raw|structured|complete submission)\b/i.test(
      `${source.type || ""} ${source.description || ""} ${source.source}`,
    ),
  );
  const rawSingleRule = findSingleRuleProvision(rawStructuredSources);
  if (rawSingleRule) return rawSingleRule;

  const anySingleRule = findSingleRuleProvision(sourceTexts);
  if (anySingleRule) return anySingleRule;

  return (
    findTextValue(sourceTexts, /\b(17\s+C[FP]R\s+240\.12d[2D]-2\([a-c]\)(?:\(\d\))?)\b(?![\s\S]{0,120}\b17\s+C[FP]R\s+240\.12d[2D]-2\([a-c]\))/i) ||
    findTextValue(sourceTexts, /\bPursuant to\s+(17\s+C[FP]R\s+240\.12d[2D]-2\([bc]\))/i)
  );
}

function findSingleRuleProvision(sourceTexts: SourceText[]) {
  const rulePattern = /\b17\s+C[FP]R\s+240\.12d[2D]-2\([a-c]\)(?:\(\d\))?/gi;
  for (const source of sourceTexts) {
    const matches = [...source.text.matchAll(rulePattern)];
    const uniqueRules = [...new Set(matches.map((match) => compactText(match[0])))];
    if (uniqueRules.length !== 1) continue;
    return {
      value: uniqueRules[0],
      evidence: pickEvidenceSentence(source.text, matches[0]?.index || 0),
      source: source.source,
      confidence: "high" as const,
    };
  }
  return null;
}

function findRemovalDate(sourceTexts: SourceText[]) {
  return findDateField(
    sourceTexts,
    /\b(?:remove[^.\n]{0,220}?from listing[^.\n]{0,220}?on|from listing and registration[^.\n]{0,160}?on|effective at the opening of the trading session on|opening of business on)\s+([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i,
    "delisting_or_removal_date",
  );
}

function findSuspensionDate(sourceTexts: SourceText[]) {
  return findDateField(
    sourceTexts,
    /\b(?:suspended from trading|trading[^.\n]{0,120}?suspended|securities were suspended)[^.\n]{0,160}?\b(?:on|effective(?: at)?(?: the opening of business on)?)\s+([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i,
    "trading_suspension_date",
  );
}

function findContinuedListing(sourceTexts: SourceText[]) {
  return (
    findTextValue(sourceTexts, /\b((?:The\s+)?[A-Za-z0-9 .,'-]+?\s+(?:continue|continues|will continue)\s+to\s+be\s+listed\s+on\s+(?:the\s+)?[A-Za-z0-9 .,'&-]+)\b/i) ||
    findTextValue(sourceTexts, /\b((?:The\s+)?[A-Za-z0-9 .,'-]+?\s+will continue trading\s+(?:on|in)\s+(?:the\s+)?(?:over-the-counter|OTC)[A-Za-z0-9 .,'&-]*)\b/i) ||
    findTextValue(sourceTexts, /\b((?:transfer|transferred|will transfer)[^.\n]{0,160}listing[^.\n]{0,160})\b/i)
  );
}

function findSuccessorOrAcquirer(sourceTexts: SourceText[]) {
  return (
    findTextValue(sourceTexts, /\bmerger between\s+([A-Z][A-Za-z0-9 .,&'-]+?)\s+and\s+([A-Z][A-Za-z0-9 .,&'-]+?)\s+became effective/i, (match) =>
      compactText(`${match[1]} / ${match[2]}`),
    ) ||
    findTextValue(sourceTexts, /\bexchanged for\s+[0-9.]+\s+shares? of\s+([A-Z][A-Za-z0-9 .,&'-]+? Common Stock)\b/i) ||
    findTextValue(sourceTexts, /\b(?:acquired by|merged with)\s+([A-Z][A-Za-z0-9 .,&'-]+)/i)
  );
}

function findConsiderationSummary(sourceTexts: SourceText[]) {
  return (
    findSentenceValue(sourceTexts, /\bEach share[^.\n]{0,260}\b(?:exchanged for|converted into)[^.\n]{0,260}\./i) ||
    findSentenceValue(sourceTexts, /\b(?:right to receive|merger consideration)[^.\n]{0,260}\./i)
  );
}

function findDateField(sourceTexts: SourceText[], pattern: RegExp, sourceName: string): SecForm25Field<string> | null {
  for (const source of sourceTexts) {
    const match = source.text.match(pattern);
    const raw = match?.[1];
    if (!raw) continue;
    const normalized = normalizeDate(raw);
    if (!normalized) continue;
    return {
      value: normalized,
      evidence: pickEvidenceSentence(source.text, match.index || 0),
      source: `${source.source}:${sourceName}`,
      confidence: "high",
    };
  }
  return null;
}

function findTextValue(
  sourceTexts: SourceText[],
  pattern: RegExp,
  transform?: (match: RegExpMatchArray) => string,
): SecForm25Field<string> | null {
  for (const source of sourceTexts) {
    const match = source.text.match(pattern);
    if (!match) continue;
    const value = cleanExtractedTextValue(transform ? transform(match) : match[1] || match[0]);
    if (!value) continue;
    return {
      value,
      evidence: pickEvidenceSentence(source.text, match.index || 0),
      source: source.source,
      confidence: "high",
    };
  }
  return null;
}

function findSentenceValue(sourceTexts: SourceText[], pattern: RegExp): SecForm25Field<string> | null {
  for (const source of sourceTexts) {
    const match = source.text.match(pattern);
    if (!match) continue;
    const value = pickEvidenceSentence(source.text, match.index || 0);
    return {
      value,
      evidence: value,
      source: source.source,
      confidence: "high",
    };
  }
  return null;
}

function stringFieldFromValue(value: unknown, source: string): SecForm25Field<string> | null {
  const text = nullableString(value);
  return text
    ? {
        value: text,
        evidence: text,
        source,
        confidence: "high",
      }
    : null;
}

function dateFieldFromValue(value: unknown, source: string): SecForm25Field<string> | null {
  const normalized = normalizeDate(stringValue(value));
  return normalized
    ? {
        value: normalized,
        evidence: stringValue(value),
        source,
        confidence: "high",
      }
    : null;
}

function selectEvidenceSnippets(fields: Array<SecForm25Field<unknown> | null>): SecForm25EvidenceSnippet[] {
  const snippets = fields
    .filter((field): field is SecForm25Field<unknown> => Boolean(field?.evidence))
    .map((field) => ({
      source: field.source,
      text: truncate(field.evidence, 420),
    }));
  return uniqueSnippets(snippets).slice(0, 12);
}

function selectAttachmentSnippets(attachments: SourceText[]): SecForm25EvidenceSnippet[] {
  return uniqueSnippets(
    attachments
      .map((attachment) => {
        const match = attachment.text.match(
          /\b(?:remove|delist|listing|registration|redeemed|maturity|merger|suspended|voluntary|continued listing|no longer suitable)\b/i,
        );
        if (!match) return null;
        return {
          source: attachment.source,
          text: truncate(pickEvidenceSentence(attachment.text, match.index || 0), 420),
        };
      })
      .filter((item): item is SecForm25EvidenceSnippet => Boolean(item)),
  ).slice(0, 8);
}

function selectTableSnippets(sourceTexts: SourceText[]): SecForm25EvidenceSnippet[] {
  const snippets: SecForm25EvidenceSnippet[] = [];
  for (const source of sourceTexts) {
    const htmlMatches = [...source.text.matchAll(/<table[\s\S]{0,1500}?<\/table>/gi)];
    for (const match of htmlMatches.slice(0, 2)) {
      snippets.push({ source: source.source, text: truncate(stripTags(match[0]), 420) });
    }
    const lines = source.text.split("\n");
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (lines[index].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
        snippets.push({ source: source.source, text: truncate(lines.slice(index, index + 5).join("\n"), 420) });
      }
    }
  }
  return uniqueSnippets(snippets).slice(0, 6);
}

function uniqueSnippets(snippets: SecForm25EvidenceSnippet[]) {
  const seen = new Set<string>();
  return snippets.filter((snippet) => {
    const key = `${snippet.source}:${snippet.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveFormType({
  documents,
  metadata,
  rawPayload,
  text,
  title,
}: {
  documents: SecDocumentPayload[];
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  text: string;
  title: unknown;
}): SecForm25SourceFormType {
  return (
    canonicalForm25(nullableString(rawPayload.form_type)) ||
    canonicalForm25(nullableString(metadata.form_type)) ||
    canonicalForm25(readFormTypeFromDocuments(documents)) ||
    canonicalForm25(stringValue(title).match(/\b(25-NSE\/A|25-NSE|25\/A|Form 25|25)\b/i)?.[1] || "") ||
    canonicalForm25(text.match(/\bCONFORMED SUBMISSION TYPE:\s*(25-NSE\/A|25-NSE|25\/A|25)\b/i)?.[1] || "") ||
    canonicalForm25(text.match(/\bFORM\s+25\b/i)?.[0] || "") ||
    null
  );
}

function readFormTypeFromDocuments(documents: SecDocumentPayload[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary) && canonicalForm25(nullableString(document.type)));
  if (primary) return nullableString(primary.type);
  const anyForm25 = documents.find((document) => canonicalForm25(nullableString(document.type)));
  return nullableString(anyForm25?.type);
}

function canonicalForm25(value: string | null): SecForm25SourceFormType {
  const form = stringValue(value).toUpperCase().replace(/\s+/g, "");
  if (form === "FORM25" || form === "25") return "25";
  if (form === "25-NSE") return "25-NSE";
  if (form === "25/A") return "25/A";
  if (form === "25-NSE/A") return "25-NSE/A";
  return null;
}

function isForm25Family(value: SecForm25SourceFormType) {
  return value === "25" || value === "25-NSE" || value === "25/A" || value === "25-NSE/A";
}

function formatAttachmentSource(type: string | null, description: string | null, index: number) {
  const label = compactText([type, description].filter(Boolean).join(" "));
  return label ? `attachment_${index + 1}:${label}` : `attachment_${index + 1}`;
}

function formatDocumentLabel(type: string | null, description: string | null) {
  return compactText([type, description].filter(Boolean).join(" ")) || "unknown_document";
}

function countTables(text: string) {
  const htmlTables = (text.match(/<table\b/gi) || []).length;
  const lines = text.split("\n");
  let markdownTables = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) markdownTables += 1;
  }
  return htmlTables + markdownTables;
}

function stripTags(value: string) {
  return compactText(value.replace(/<[^>]+>/g, " "));
}

function normalizeDate(value: string) {
  const text = stringValue(value).replace(/,/g, ",").trim();
  if (!text) return null;
  const ymd = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i);
  if (named) {
    const month = monthNumber(named[1]);
    const day = named[2].padStart(2, "0");
    return month ? `${named[3]}-${month}-${day}` : null;
  }
  return null;
}

function monthNumber(value: string) {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const index = months.indexOf(value.toLowerCase());
  return index >= 0 ? String(index + 1).padStart(2, "0") : null;
}

function pickEvidenceSentence(text: string, index: number) {
  const normalized = compactText(text);
  if (!normalized) return "";
  const safeIndex = Math.max(0, Math.min(index, normalized.length - 1));
  const beforePeriod = normalized.lastIndexOf(".", safeIndex - 1);
  const beforeNewline = normalized.lastIndexOf("\n", safeIndex - 1);
  const start = Math.max(0, beforePeriod, beforeNewline);
  let end = normalized.indexOf(".", safeIndex + 1);
  const newlineEnd = normalized.indexOf("\n", safeIndex + 1);
  if (newlineEnd >= 0 && (end < 0 || newlineEnd < end)) end = newlineEnd;
  if (end < 0 || end - start < 60) end = Math.min(normalized.length, safeIndex + 360);
  else end += 1;
  return truncate(normalized.slice(start > 0 ? start + 1 : start, end), 420);
}

function compactText(value: string) {
  return stringValue(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return stringValue(value)
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanExtractedTextValue(value: string) {
  const text = compactText(value)
    .replace(/^\|+\s*/, "")
    .replace(/\s*\|+$/g, "")
    .trim();
  return /[A-Za-z0-9]/.test(text) ? text : "";
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function firstDocumentUrl(documents: SecDocumentPayload[]) {
  for (const document of documents) {
    const url = nullableString(document.url);
    if (url) return url;
  }
  return null;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function normalizeTicker(value: unknown) {
  const text = stringValue(value).toUpperCase();
  if (!text) return null;
  const cleaned = text
    .replace(/^(?:NYSE|NASDAQ|NYSE\s+AMERICAN|NYSE\s+ARCA|AMEX)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
  return /^[A-Z][A-Z0-9.\-]{0,14}$/.test(cleaned) ? cleaned : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function nullableNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed || null;
}
