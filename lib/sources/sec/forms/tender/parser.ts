import {
  SEC_TENDER_PARSER_GROUP,
  SEC_TENDER_ROOM_FORM_TYPE,
  type SecTenderAttachmentText,
  type SecTenderArchiveSubmissionInput,
  type SecTenderDateField,
  type SecTenderDocumentSummary,
  type SecTenderField,
  type SecTenderLlmRelevance,
  type SecTenderMoneyField,
  type SecTenderNoiseCategory,
  type SecTenderNoiseProfile,
  type SecTenderParseInput,
  type SecTenderParserOutput,
  type SecTenderPriceField,
} from "./types";

export const SEC_TENDER_PARSER_VERSION = "sec_tender_parser_v1";

type SecTenderCase =
  | "issuer_tender_offer"
  | "third_party_tender_offer"
  | "going_private_13e3"
  | "schedule_cb_cross_border"
  | "tender_offer_communication"
  | "generic_tender_offer"
  | "unsupported";

type SecTenderRawDocument = {
  sequence?: unknown;
  seq?: unknown;
  type?: unknown;
  description?: unknown;
  filename?: unknown;
  document?: unknown;
  name?: unknown;
  url?: unknown;
  isPrimary?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
  fetchStatus?: unknown;
  fetchError?: unknown;
  text?: unknown;
};

type SecArchiveDocument = {
  sequence: number | null;
  type: string | null;
  filename: string | null;
  description: string | null;
  text: string;
};

type SecTenderAmendmentInfo = {
  is_amendment: boolean;
  amendment_number: SecTenderField<number> | null;
  parent_accession_number: string | null;
  limited_scope_signal_candidates: SecTenderField<string>[];
  material_change_candidates: SecTenderField<string>[];
  changed_heading_candidates: SecTenderField<string>[];
  amendment_classification: {
    type:
      | "initial_filing"
      | "amendment_uncertain"
      | "pre_commencement_communication_only"
      | "extension_only"
      | "tendered_shares_count_update_only"
      | "final_results_only"
      | "new_exhibit_only"
      | "substantive_amendment_likely";
    confidence: SecTenderField<string>["confidence"];
    evidence: string[];
    parser_only_candidate: boolean;
  };
  routine_no_change_candidate: {
    is_candidate: boolean;
    reason: string | null;
    source_evidence: string[];
    changed_terms_detected: string[];
  };
  amendment_excerpt: string | null;
};

type SecTenderCheckboxSignal = {
  checked: boolean | null;
  label: string;
  evidence: string;
};

type SecTenderHeadingSection = {
  key: string;
  heading: string;
  evidence: string;
};

type SecTenderCoverPageSignals = {
  checkbox_signals: Record<string, SecTenderCheckboxSignal | null>;
  subject_company: SecTenderField<string> | null;
  filing_persons: SecTenderField<string[]> | null;
  offerors: SecTenderField<string[]> | null;
  security_class: SecTenderField<string> | null;
  cusip: SecTenderField<string> | null;
  form_cb: {
    transaction_type: string | null;
    rule_signals: string[];
    foreign_issuer_or_jurisdiction: SecTenderField<string> | null;
    person_furnishing_form: SecTenderField<string> | null;
    home_jurisdiction_document_present: boolean;
    english_translation_or_summary_present: boolean;
    form_fx_present: boolean;
  };
  warnings: string[];
};

const DATE_TEXT =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";

export function parseSecTenderArchiveSubmission(input: SecTenderArchiveSubmissionInput): SecTenderParserOutput {
  return parseSecTenderFiling(buildSecTenderParseInputFromArchiveSubmission(input));
}

export function buildSecTenderParseInputFromArchiveSubmission(input: SecTenderArchiveSubmissionInput): SecTenderParseInput {
  const submissionText = stringValue(input.submissionText);
  const archiveDocuments = parseSecArchiveDocuments(submissionText);
  const header = parseSecArchiveHeader(submissionText);
  const formType = canonicalTenderFormType(header.formType) || readTenderFormTypeFromArchiveDocuments(archiveDocuments);
  const accessionNumber = nullableString(input.sourceUniqueId) || header.accessionNumber;
  const sourceBaseUrl = resolveArchiveBaseUrl(input.sourceUrl);
  const primaryDocument =
    archiveDocuments.find((document) => canonicalTenderFormType(document.type) === formType) ||
    archiveDocuments.find((document) => canonicalTenderFormType(document.type)) ||
    archiveDocuments[0] ||
    null;
  const documents = archiveDocuments.map((document): SecTenderRawDocument => {
    const filename = document.filename;
    return {
      sequence: document.sequence,
      type: document.type,
      description: document.description,
      document: filename,
      filename,
      url: sourceBaseUrl && filename ? `${sourceBaseUrl}${filename}` : null,
      isPrimary: document === primaryDocument,
      textCharCount: document.text.length,
      textTruncated: false,
      fetchStatus: null,
      fetchError: null,
    };
  });
  const attachmentTexts = archiveDocuments
    .filter((document) => document !== primaryDocument)
    .map((document): SecTenderAttachmentText => {
      return {
        type: document.type,
        description: document.description,
        text: document.text,
      };
    });
  const metadata = {
    ...(input.metadata || {}),
    form_type: formType,
    company_name: nullableString(input.companyName) || header.companyName,
    ticker: nullableString(input.ticker),
    exchange: nullableString(input.exchange),
    archive_document_count: archiveDocuments.length,
  };

  return {
    rawItemId: input.rawItemId,
    sourceUniqueId: accessionNumber,
    sourceUrl: input.sourceUrl,
    title: input.title || buildArchiveTitle(metadata.company_name, formType),
    publishedAt: input.publishedAt || header.filedAt,
    bodyText: primaryDocument?.text || submissionText,
    rawPayload: {
      accession_number: accessionNumber,
      form_type: formType,
      company_name: metadata.company_name,
      ticker: metadata.ticker,
      exchange: metadata.exchange,
      documents,
      attachment_texts: attachmentTexts,
      archive_header: header,
      archive_document_count: archiveDocuments.length,
      archive_source_url: input.sourceUrl || null,
    },
    metadata,
  };
}

export function parseSecTenderFiling(input: SecTenderParseInput): SecTenderParserOutput {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const documents = recordArray(rawPayload.documents) as SecTenderRawDocument[];
  const attachmentTexts = readAttachmentTexts(input, rawPayload);
  const formType = resolveTenderFormType({
    documents,
    metadata,
    rawPayload,
    title: input.title,
  });
  const combinedText = compactText(stringValue(input.analysisText) || stringValue(input.bodyText));
  const primaryText = extractPrimaryText(combinedText, formType);
  const attachmentText = compactText(attachmentTexts.map((item) => stringValue(item.text)).join("\n\n"));
  const targetedAttachmentSourceBlocks = buildTargetedAttachmentSourceBlocks(attachmentTexts);
  const tenderText = compactText([stringValue(input.title), primaryText, attachmentText].filter(Boolean).join("\n\n"));
  const documentSummaries = documents.map((document) => mapDocumentSummary(document, formType));
  const attachmentSummaries = attachmentTexts.map((attachment, index) => mapAttachmentSummary(attachment, index, formType));
  const sourcePackage = buildSourcePackage({
    accessionNumber: nullableString(rawPayload.accession_number) || nullableString(input.sourceUniqueId),
    attachmentSummaries,
    targetedAttachmentSourceBlocks,
    attachmentText,
    combinedText,
    documentSummaries,
    formType,
    input,
    metadata,
    primaryText,
    rawPayload,
  });
  const coverPage = extractTenderCoverPageSignals(tenderText, formType, documentSummaries);
  const headingSections = extractTenderHeadingSections(tenderText);
  const tenderCase = classifyTenderCase(formType, tenderText, coverPage);
  const accessionNumber = nullableString(rawPayload.accession_number) || nullableString(input.sourceUniqueId);
  const isSupported = tenderCase !== "unsupported";
  const amendment = buildAmendmentInfo({
    coverPage,
    formType,
    headingSections,
    parentFilingContext: input.parentFilingContext,
    text: tenderText,
  });
  const issuer = readIssuer(rawPayload, metadata, tenderText, coverPage);
  const ticker = nullableString(rawPayload.ticker) || nullableString(metadata.ticker);
  const exchange = nullableString(rawPayload.exchange) || nullableString(metadata.exchange);
  const parsedTargetCompany = readCompanyField(tenderText, [
    /\n\s*([A-Z][A-Z0-9&.,' -]{2,120})\s*\n\s*\(Name of Subject Company/i,
    /\btarget company(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
    /\b(?:offer to purchase|tender offer for)[^.\n]{0,180}?(?:all of the outstanding|shares of)\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
    /\bSubject Company:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
  ]);
  const targetCompany = tenderCase === "issuer_tender_offer" ? null : getCoverPageString(coverPage, "subject_company") || parsedTargetCompany;
  const coverOfferors = getCoverPageStringArray(coverPage, "offerors");
  const partyExtraction = extractTenderParties(tenderText, coverPage, tenderCase);
  const offeror = coverOfferors[0] || partyExtraction.offeror?.value || null;
  const explicitTicker = findTickerSymbol(tenderText);
  const considerationType = findConsiderationType(tenderText, tenderCase);
  const cashPriceCandidates = findCashTenderPriceCandidates(tenderText);
  const cashPrice = cashPriceCandidates.primary;
  const exchangeRatio = findExchangeRatio(tenderText);
  const offerEconomics = buildOfferEconomics(tenderText, cashPriceCandidates, exchangeRatio, considerationType);
  const aggregateAmount = findMoneyField(tenderText, [
    /\b(?:aggregate purchase price|maximum aggregate purchase price|total consideration|aggregate value)\s+(?:(?:is|of|will be|representing|up to)\s+)*(?:approximately\s+)?(\$ ?\d[\d,.]*(?:\s*(?:million|billion|thousand))?)/i,
    /\bpurchase\s+up\s+to\s+(\$ ?\d[\d,.]*(?:\s*(?:million|billion|thousand))?)/i,
  ]);
  const sharesSought = findShareCountField(tenderText, [
    /\b(?:purchase|acquire|accept for payment)\s+(?:up to\s+)?(\d[\d,.]*\s+(?:shares|ordinary shares|common shares|common stock shares|ADSs|American Depositary Shares))/i,
    /\b(\d[\d,.]*\s+(?:shares|ordinary shares|common shares|common stock shares|ADSs|American Depositary Shares))\s+(?:are sought|sought in the offer)/i,
  ]);
  const percentSought = findPercentField(tenderText, [
    /\b(?:up to|approximately)\s+(\d+(?:\.\d+)?%)\s+of\s+(?:the\s+)?(?:outstanding|issued)/i,
    /\b(\d+(?:\.\d+)?%)\s+of\s+(?:the\s+)?(?:outstanding|issued)\s+(?:shares|common stock|ordinary shares)/i,
  ]);
  const tenderDates = extractTenderDates(tenderText);
  const expirationDate = tenderDates.expiration_date;
  const withdrawalDeadline = findDateField(tenderText, [
    new RegExp(`\\bwithdrawal rights?[\\s\\S]{0,220}?(${DATE_TEXT})`, "i"),
    new RegExp(`\\bmay withdraw[\\s\\S]{0,220}?until[\\s\\S]{0,120}?(${DATE_TEXT})`, "i"),
  ]);
  const proration = findSentenceField(tenderText, /\bprorat(?:e|ion|ed)\b/i);
  const boardRecommendation = findBoardRecommendation(tenderText);
  const premium = findPercentField(tenderText, [
    /\b(\d+(?:\.\d+)?%)\s+premium\b/i,
    /\bpremium\s+of\s+(\d+(?:\.\d+)?%)/i,
  ]);
  const tenderConditionSignals = extractTenderConditionSignals(tenderText);
  const financingCondition = tenderConditionSignals.financing_condition || tenderConditionSignals.no_financing_condition;
  const minimumCondition = tenderConditionSignals.minimum_tender_condition;
  const regulatoryCondition = tenderConditionSignals.regulatory_antitrust_condition || tenderConditionSignals.hsr_condition;
  const finalResults = extractFinalResults(tenderText);
  const schedule13e3Flags = extractSchedule13e3Flags(tenderText, headingSections);
  const legalRisk = findSentenceField(tenderText, /\b(?:litigation|lawsuit|injunction|appraisal rights|dissenters'? rights)\b/i);
  const goingPrivateSignal = coverPageCheckboxField(coverPage, "going_private_13e3") || findNarrativeSentenceField(tenderText, /\b(?:Rule 13e-3|Schedule 13E-3|going private|go private|take private)\b/i);
  const crossBorderSignal =
    coverPageCheckboxField(coverPage, "cross_border_issuer") ||
    coverPageCheckboxField(coverPage, "cross_border_third_party") ||
    findNarrativeSentenceField(tenderText, /\b(?:Schedule CB|cross-border|home jurisdiction|Tier I exemption|Tier II exemption)\b/i);
  const recommendation = findSentenceField(tenderText, /\b(?:recommends that stockholders|recommendation statement|Schedule 14D-9|board of directors recommends)\b/i);
  const conditions = [financingCondition, minimumCondition, regulatoryCondition].filter(Boolean);
  const marketContextRequirements = buildMarketContextRequirements({
    aggregateAmount,
    cashPrice,
    premium,
    tenderCase,
  });
  const routeHint = buildRouteHint({
    amendment,
    coverPage,
    legalRisk,
    tenderCase,
  });
  const parserOnlyRoutingHints = buildParserOnlyRoutingHints({
    amendment,
    coverPage,
    tenderCase,
  });
  const signals = buildSignals({
    amendment,
    cashPrice,
    expirationDate,
    goingPrivateSignal,
    marketContextRequirements,
    offeror,
    premium,
    tenderCase,
  });
  const calendarItems = buildCalendarItems({
    expirationDate,
    tenderCase,
    withdrawalDeadline,
  });
  const warnings = buildWarnings({
    amendment,
    coverPage,
    extractionWarnings: [
      ...partyExtraction.warnings,
      ...offerEconomics.warnings,
      ...tenderDates.warnings,
      ...finalResults.warnings,
    ],
    formType,
    isSupported,
    sourceWarnings: sourcePackage.fetch_warnings,
    tenderText,
  });

  return {
    parserVersion: SEC_TENDER_PARSER_VERSION,
    parserGroup: SEC_TENDER_PARSER_GROUP,
    formType: SEC_TENDER_ROOM_FORM_TYPE,
    accessionNumber,
    isSupported,
    summary: buildSummary({
      cashPrice,
      expirationDate,
      formType,
      issuer,
      targetCompany,
      tenderCase,
    }),
    facts: {
      sec_form_type: formType,
      tender_case: tenderCase,
      filed_at: nullableString(input.publishedAt),
      source_url: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
      issuer: issuer
        ? {
            name: issuer,
            ticker: ticker || explicitTicker?.value || null,
            exchange,
          }
        : null,
      target_company: targetCompany,
      offeror,
      offerors: coverOfferors,
      party_extraction: partyExtraction,
      subject_company: targetCompany || issuer,
      issuer_tender: tenderCase === "issuer_tender_offer",
      third_party_tender: tenderCase === "third_party_tender_offer",
      going_private: tenderCase === "going_private_13e3" || Boolean(goingPrivateSignal),
      cross_border: tenderCase === "schedule_cb_cross_border" || Boolean(crossBorderSignal),
      combined_schedule_to_13e3: Boolean(
        coverPage.checkbox_signals.going_private_13e3?.checked &&
          (tenderCase === "issuer_tender_offer" || tenderCase === "third_party_tender_offer" || /TO/i.test(formType || "")),
      ),
      tender_offer_communication: tenderCase === "tender_offer_communication",
      cover_page: coverPage,
      security_identifiers: {
        security_class: coverPage.security_class,
        cusip: coverPage.cusip,
        ticker_symbol: explicitTicker,
      },
      heading_sections: headingSections,
      special_factors_section_present: headingSections.some((section) => section.key === "special_factors"),
      fairness_section_present: headingSections.some((section) => section.key === "fairness_of_transaction"),
      reports_opinions_appraisals_section_present: headingSections.some((section) => section.key === "reports_opinions_appraisals"),
      consideration_type: considerationType,
      cash_price_per_share: cashPrice,
      exchange_ratio: exchangeRatio,
      offer_economics: offerEconomics,
      aggregate_purchase_price: aggregateAmount,
      shares_sought: sharesSought,
      percent_sought: percentSought,
      expiration_date: expirationDate,
      tender_dates: tenderDates,
      withdrawal_deadline: withdrawalDeadline,
      proration,
      premium_to_reference_price: premium,
      board_recommendation: boardRecommendation || recommendation,
      conditions,
      tender_condition_signals: tenderConditionSignals,
      final_results: finalResults,
      schedule_13e3_flags: schedule13e3Flags,
      legal_risk_signal: legalRisk,
      going_private_signal: goingPrivateSignal,
      cross_border_signal: crossBorderSignal,
      amendment,
      parser_only_routing_hints: parserOnlyRoutingHints,
      market_context_requirements: marketContextRequirements,
      route_hint: routeHint,
      source_documents: documentSummaries,
      source_attachments: attachmentSummaries,
      raw_data_audit: sourcePackage.raw_data_audit,
      source_noise: sourcePackage.source_noise,
      source_text: sourcePackage.text,
      documents: documentSummaries,
      extracted_field_count: countExtractedFields([
        formType,
        issuer,
        targetCompany,
        offeror,
        explicitTicker,
        considerationType,
        cashPrice,
        exchangeRatio,
        offerEconomics.cvr_or_contingent_value_right,
        offerEconomics.dutch_auction_range,
        aggregateAmount,
        sharesSought,
        percentSought,
        expirationDate,
        tenderDates.expiration_time,
        tenderDates.commencement_date,
        finalResults.shares_tendered,
        finalResults.shares_accepted_for_payment,
        withdrawalDeadline,
        proration,
        premium,
        boardRecommendation,
        recommendation,
        goingPrivateSignal,
        crossBorderSignal,
        legalRisk,
        ...conditions,
        ...amendment.limited_scope_signal_candidates,
        ...amendment.material_change_candidates,
      ]),
    },
    signals,
    calendarItems,
    warnings,
    raw: {
      input_form_type: formType,
      raw_item_id: nullableString(input.rawItemId),
      title: nullableString(input.title),
      source_package: sourcePackage,
      text_stats: {
        body_chars: stringValue(input.bodyText).length,
        analysis_chars: stringValue(input.analysisText).length,
        attachment_chars: attachmentText.length,
      },
    },
  };
}

function resolveTenderFormType({
  documents,
  metadata,
  rawPayload,
  title,
}: {
  documents: SecTenderRawDocument[];
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  title: unknown;
}) {
  return (
    readTenderFormTypeFromDocuments(documents) ||
    canonicalTenderFormType(nullableString(rawPayload.form_type)) ||
    canonicalTenderFormType(nullableString(metadata.form_type)) ||
    canonicalTenderFormType(readTenderFormTypeFromTitle(title)) ||
    null
  );
}

function readTenderFormTypeFromDocuments(documents: SecTenderRawDocument[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary) && canonicalTenderFormType(nullableString(document.type)));
  if (primary) return canonicalTenderFormType(nullableString(primary.type));
  const anyTenderDocument = documents.find((document) => canonicalTenderFormType(nullableString(document.type)));
  return anyTenderDocument ? canonicalTenderFormType(nullableString(anyTenderDocument.type)) : null;
}

function readTenderFormTypeFromArchiveDocuments(documents: SecArchiveDocument[]) {
  const document = documents.find((item) => canonicalTenderFormType(item.type));
  return document ? canonicalTenderFormType(document.type) : null;
}

function readTenderFormTypeFromTitle(value: unknown) {
  const text = stringValue(value);
  const match = text.match(/\b(SC\s+TO-[ITC](?:\/A)?|SC\s+TO(?:\/A)?|SC\s+13E-?3(?:\/A)?|CB(?:\/A)?|Schedule\s+TO-[ITC]|Schedule\s+13E-?3|Schedule\s+CB)\b/i);
  return match?.[1] || "";
}

function canonicalTenderFormType(value: string | null) {
  const normalized = stringValue(value)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/^SCHEDULE /, "SC ")
    .replace("13E-3", "13E3")
    .trim();
  const compact = normalized.replace(/\s+/g, "");

  if (/^SCTO-I\/A$/.test(compact)) return "SC TO-I/A";
  if (/^SCTO-T\/A$/.test(compact)) return "SC TO-T/A";
  if (/^SCTO-C\/A$/.test(compact)) return "SC TO-C/A";
  if (/^SCTO\/A$/.test(compact)) return "SC TO/A";
  if (/^SC13E3\/A$/.test(compact)) return "SC 13E3/A";
  if (/^CB\/A$/.test(compact)) return "CB/A";
  if (/^SCTO-I$/.test(compact)) return "SC TO-I";
  if (/^SCTO-T$/.test(compact)) return "SC TO-T";
  if (/^SCTO-C$/.test(compact)) return "SC TO-C";
  if (/^SCTO$/.test(compact)) return "SC TO";
  if (/^SC13E3$/.test(compact)) return "SC 13E3";
  if (/^CB$/.test(compact)) return "CB";
  return null;
}

function parseSecArchiveHeader(submissionText: string) {
  const headerText = submissionText.match(/<SEC-HEADER>([\s\S]*?)<\/SEC-HEADER>/i)?.[1] || submissionText.slice(0, 20_000);
  const filedAsOfDate = readHeaderValue(headerText, "FILED AS OF DATE");
  return {
    accessionNumber: readHeaderValue(headerText, "ACCESSION NUMBER"),
    formType: readHeaderValue(headerText, "CONFORMED SUBMISSION TYPE"),
    filedAt: normalizeArchiveFiledDate(filedAsOfDate),
    companyName: readHeaderValue(headerText, "COMPANY CONFORMED NAME"),
    cik: readHeaderValue(headerText, "CENTRAL INDEX KEY"),
    raw_excerpt: truncate(headerText, 2_000),
  };
}

function parseSecArchiveDocuments(submissionText: string): SecArchiveDocument[] {
  const documents: SecArchiveDocument[] = [];
  const documentPattern = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi;
  let match: RegExpExecArray | null;

  while ((match = documentPattern.exec(submissionText))) {
    const block = match[1] || "";
    documents.push({
      sequence: normalizeNumber(readArchiveTag(block, "SEQUENCE") || ""),
      type: readArchiveTag(block, "TYPE"),
      filename: readArchiveTag(block, "FILENAME"),
      description: readArchiveTag(block, "DESCRIPTION"),
      text: readArchiveText(block),
    });
  }

  return documents;
}

function readArchiveTag(block: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}>\\s*([^\\r\\n<]*)`, "i");
  return nullableString(block.match(pattern)?.[1]);
}

function readArchiveText(block: string) {
  const match = block.match(/<TEXT>([\s\S]*?)<\/TEXT>/i);
  return match?.[1]?.trim() || "";
}

function readHeaderValue(headerText: string, label: string) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}:\\s*(.+?)\\s*$`, "im");
  return nullableString(headerText.match(pattern)?.[1]);
}

function normalizeArchiveFiledDate(value: string | null) {
  const text = stringValue(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
}

function resolveArchiveBaseUrl(sourceUrl: string | null | undefined) {
  const value = nullableString(sourceUrl);
  if (!value) return null;
  if (value.endsWith("/")) return value;
  return value.replace(/\/[^/]*$/, "/");
}

function buildArchiveTitle(companyName: unknown, formType: string | null) {
  return compactText(`${stringValue(companyName) || "SEC filing"} ${formType || SEC_TENDER_ROOM_FORM_TYPE}`);
}

const checkedCheckboxPattern =
  /(?:\u2612|\u2611|\u2713|\u2714|\u00fe|\[[xX]\]|\([xX]\)|>\s*[xX]\s*<|\bchecked(?:\s*=\s*(?:"checked"|'checked'|checked|true))?\b|\u00e2\u0098[\u0091\u0092])/i;
const uncheckedCheckboxPattern = /(?:\u2610|\u25a1|\[\s*\]|\(\s*\)|<t[dh][^>]*>\s*(?:&nbsp;|\s)*<\/t[dh]>|\u00a8|\u00e2\u0098\u0090)/i;

function extractTenderCoverPageSignals(text: string, formType: string | null, documentSummaries: SecTenderDocumentSummary[] = []): SecTenderCoverPageSignals {
  const checkbox_signals: Record<string, SecTenderCheckboxSignal | null> = {
    pre_commencement_communication: readCheckboxSignal(
      text,
      "pre-commencement communication",
      /\bfiling relates solely to preliminary communications made before the commencement of a tender offer\b/i,
      true,
    ),
    third_party_tender: readCheckboxSignal(text, "third-party tender offer", /\bthird[- ]party tender offer subject to Rule 14d-1\b/i),
    issuer_tender: readCheckboxSignal(text, "issuer tender offer", /\bissuer tender offer subject to Rule 13e-4\b/i),
    going_private_13e3: readCheckboxSignal(text, "going-private Rule 13e-3 transaction", /\bgoing private transaction subject to Rule 13e-3\b/i),
    schedule_13d_amendment: readCheckboxSignal(text, "Schedule 13D amendment", /\bamendment to Schedule 13D under Rule 13d-2\b/i),
    final_amendment: readCheckboxSignal(text, "final amendment reporting tender results", /\bfinal amendment reporting the results of the tender offer\b/i, true),
    cross_border_issuer: readCheckboxSignal(text, "cross-border issuer tender offer", /\bRule 13e-4\(i\)\s*\(Cross-Border Issuer Tender Offer\)/i),
    cross_border_third_party: readCheckboxSignal(text, "cross-border third-party tender offer", /\bRule 14d-1\(d\)\s*\(Cross-Border Third-Party Tender Offer\)/i),
    cb_rule_13e4_issuer: readCheckboxSignal(text, "Form CB issuer tender offer rule", /\bRule\s+13e-4\(h\)\(8\)/i),
    cb_rule_14d1_third_party: readCheckboxSignal(text, "Form CB third-party tender offer rule", /\bRule\s+14d-1\(c\)/i),
    cb_rule_14e2_response: readCheckboxSignal(text, "Form CB subject company response rule", /\bRule\s+14e-2\(d\)/i),
    cb_rule_13e3_going_private: readCheckboxSignal(text, "Form CB going-private rule", /\bRule\s+13e-3\(g\)\(6\)/i),
    cb_rule_801_rights_offering: readCheckboxSignal(text, "Form CB rights offering rule", /\bRule\s+801\b/i),
    cb_rule_802_exchange_offer: readCheckboxSignal(text, "Form CB exchange offer rule", /\bRule\s+802\b/i),
  };
  const documents = inferDocumentPresenceFromText(text, documentSummaries);
  const formCbRuleSignals = Object.entries(checkbox_signals)
    .filter(([key, signal]) => key.startsWith("cb_rule_") && signal?.checked === true)
    .map(([, signal]) => signal?.label || "")
    .filter(Boolean);

  return {
    checkbox_signals,
    subject_company: readLabeledNameField(text, /\(Name of Subject Company(?:\s*\(Issuer\))?\)/i, "high"),
    filing_persons: readLabeledNamesField(text, /\(Name of Filing Persons?(?:\s*\([^)]*\))?\)/i, "medium"),
    offerors: readLabeledNamesField(text, /\(Name of Filing Persons?(?:\s*\(Offerors?\))?\)/i, "medium"),
    security_class: readSecurityClassField(text),
    cusip: readCusipField(text),
    form_cb: {
      transaction_type: classifyFormCbTransactionType(checkbox_signals, formType),
      rule_signals: formCbRuleSignals,
      foreign_issuer_or_jurisdiction: findNarrativeSentenceField(
        text,
        /\b(?:foreign private issuer|foreign issuer|home jurisdiction|incorporated under the laws of|jurisdiction (?:of|is)|country of incorporation)\b/i,
      ),
      person_furnishing_form: readLabeledNameField(text, /\(Name of Person\(s\) Furnishing Form\)/i, "medium"),
      home_jurisdiction_document_present: documents.home_jurisdiction_document_present,
      english_translation_or_summary_present: documents.english_translation_or_summary_present,
      form_fx_present: documents.form_fx_present,
    },
    warnings: buildCoverPageWarnings(checkbox_signals, formType),
  };
}

function readCheckboxSignal(text: string, label: string, pattern: RegExp, preferAfter = false): SecTenderCheckboxSignal | null {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return null;
  const sameLine = checkboxLineWindow(text, match.index, match.index + match[0].length);
  const beforeState = lastCheckboxState(sameLine.before);
  const afterState = firstCheckboxState(sameLine.after);
  let checked = preferAfter ? afterState ?? beforeState : beforeState ?? afterState;
  if (checked === null) {
    const near = checkboxNearWindow(text, match.index, match.index + match[0].length);
    const nearBeforeState = lastCheckboxState(near.before);
    const nearAfterState = firstCheckboxState(near.after);
    checked = preferAfter ? nearAfterState ?? nearBeforeState : nearBeforeState ?? nearAfterState;
  }
  return {
    checked,
    label,
    evidence: truncate(`${sameLine.before.slice(-80)} ${match[0]} ${sameLine.after.slice(0, 80)}`, 240),
  };
}

function checkboxLineWindow(text: string, start: number, end: number) {
  const lineStart = Math.max(
    text.lastIndexOf("\n", start - 1),
    text.lastIndexOf("|", start - 1),
    text.toLowerCase().lastIndexOf("<tr", start - 1),
    0,
  );
  const nextBreak = text.indexOf("\n", end);
  const nextPipe = text.indexOf("|", end);
  const nextRowEnd = text.toLowerCase().indexOf("</tr", end);
  const candidates = [nextBreak, nextPipe, nextRowEnd].filter((index) => index >= 0);
  const lineEnd = candidates.length ? Math.min(...candidates) : text.length;
  return {
    before: text.slice(Math.max(0, lineStart), start),
    after: text.slice(end, Math.min(text.length, lineEnd)),
  };
}

function checkboxNearWindow(text: string, start: number, end: number) {
  return {
    before: text.slice(Math.max(0, start - 80), start),
    after: text.slice(end, Math.min(text.length, end + 80)),
  };
}

function lastCheckboxState(text: string) {
  const states = checkboxStates(text);
  return states.length ? states[states.length - 1]?.checked ?? null : null;
}

function firstCheckboxState(text: string) {
  const states = checkboxStates(text);
  return states.length ? states[0]?.checked ?? null : null;
}

function checkboxStates(text: string) {
  const states: Array<{ index: number; checked: boolean }> = [];
  const pattern = new RegExp(`${checkedCheckboxPattern.source}|${uncheckedCheckboxPattern.source}`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const marker = match[0] || "";
    states.push({
      index: match.index,
      checked: checkedCheckboxPattern.test(marker),
    });
  }
  return states.sort((left, right) => left.index - right.index);
}

function buildCoverPageWarnings(checkboxSignals: Record<string, SecTenderCheckboxSignal | null>, formType: string | null) {
  const warnings: string[] = [];
  const meaningfulKeys = ["third_party_tender", "issuer_tender", "going_private_13e3", "pre_commencement_communication"];
  if (/TO/i.test(formType || "")) {
    for (const key of meaningfulKeys) {
      const signal = checkboxSignals[key];
      if (signal && signal.checked === null) warnings.push(`checkbox_state_uncertain:${key}`);
    }
  }
  return warnings;
}

function classifyFormCbTransactionType(checkboxSignals: Record<string, SecTenderCheckboxSignal | null>, formType: string | null) {
  if (!/^CB/i.test(formType || "")) return null;
  if (checkboxSignals.cb_rule_801_rights_offering?.checked) return "rights_offering";
  if (checkboxSignals.cb_rule_802_exchange_offer?.checked) return "exchange_offer_or_business_combination";
  if (checkboxSignals.cb_rule_13e4_issuer?.checked) return "issuer_tender_offer";
  if (checkboxSignals.cb_rule_14d1_third_party?.checked) return "third_party_tender_offer";
  if (checkboxSignals.cb_rule_14e2_response?.checked) return "subject_company_response";
  if (checkboxSignals.cb_rule_13e3_going_private?.checked) return "going_private_transaction";
  return null;
}

function inferDocumentPresenceFromText(text: string, documentSummaries: SecTenderDocumentSummary[] = []) {
  const hasRole = (role: string) => documentSummaries.some((document) => document.role === role);
  const hasClearDocumentSignal = (pattern: RegExp) =>
    documentSummaries.some((document) => pattern.test(`${document.type || ""} ${document.description || ""} ${document.filename || ""}`));
  return {
    home_jurisdiction_document_present:
      hasRole("home_jurisdiction_document") || /\b(?:home jurisdiction document|takeover bid circular|scheme booklet|rights offering circular)\b/i.test(text),
    english_translation_or_summary_present:
      hasRole("english_translation_or_summary") ||
      hasClearDocumentSignal(/\b(?:English translation|English summary)\b/i) ||
      /\b(?:English translation|English summary)\b/i.test(text),
    form_fx_present: hasRole("form_fx_related") || hasClearDocumentSignal(/\b(?:FORM F-X|F-X)\b/i),
  };
}

function getCoverPageString(coverPage: SecTenderCoverPageSignals, key: "subject_company" | "security_class" | "cusip") {
  return nullableString(coverPage[key]?.value);
}

function getCoverPageStringArray(coverPage: SecTenderCoverPageSignals, key: "filing_persons" | "offerors") {
  const value = coverPage[key]?.value;
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function coverPageCheckboxField(coverPage: SecTenderCoverPageSignals, key: string): SecTenderField<string> | null {
  const signal = coverPage.checkbox_signals[key];
  if (!signal?.checked) return null;
  return {
    value: signal.label,
    evidence: signal.evidence,
    confidence: "high",
  };
}

function checkboxEvidence(coverPage: SecTenderCoverPageSignals, key: string) {
  return coverPage.checkbox_signals[key]?.evidence || "";
}

function readLabeledNameField(text: string, labelPattern: RegExp, confidence: SecTenderField<string>["confidence"]): SecTenderField<string> | null {
  const names = readNamesBeforeLabel(text, labelPattern);
  if (!names.length) return null;
  return {
    value: names.join(" "),
    evidence: names.join("\n"),
    confidence,
  };
}

function readSecurityClassField(text: string): SecTenderField<string> | null {
  const names = readRawLinesBeforeLabel(text, /\(Title of Class of Securities\)/i);
  if (!names.length) return null;
  return {
    value: names.join(" "),
    evidence: names.join("\n"),
    confidence: "medium",
  };
}

function readCusipField(text: string): SecTenderField<string> | null {
  const fieldValue = readLabeledNameField(text, /\(CUSIP Number(?: of Class of Securities)?\)/i, "medium");
  const candidate = nullableString(fieldValue?.value)?.replace(/[^A-Za-z0-9]/g, "") || null;
  if (candidate && /^[A-Za-z0-9]{9}$/.test(candidate) && !/^\d{3}[-.]?\d{3}[-.]?\d{4}$/.test(fieldValue?.value || "")) {
    return {
      value: candidate,
      evidence: fieldValue?.evidence || candidate,
      confidence: "medium",
    };
  }
  const match = text.match(/\bCUSIP(?: Number)?(?: of Class of Securities)?\s*[:\-]?\s*([A-Za-z0-9]{3}[A-Za-z0-9]{3}[A-Za-z0-9]{3})\b/i);
  if (!match?.[1]) return null;
  return {
    value: match[1],
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function readLabeledNamesField(text: string, labelPattern: RegExp, confidence: SecTenderField<string>["confidence"]): SecTenderField<string[]> | null {
  const names = readNamesBeforeLabel(text, labelPattern);
  if (!names.length) return null;
  return {
    value: names,
    evidence: names.join("\n"),
    confidence,
  };
}

function readNamesBeforeLabel(text: string, labelPattern: RegExp) {
  return readRawLinesBeforeLabel(text, labelPattern).map(cleanCompanyName);
}

function readRawLinesBeforeLabel(text: string, labelPattern: RegExp) {
  const match = text.match(labelPattern);
  if (!match || match.index === undefined) return [];
  const before = text.slice(Math.max(0, match.index - 700), match.index);
  const lines = before
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
  const names: string[] = [];
  for (let index = lines.length - 1; index >= 0 && names.length < 4; index -= 1) {
    const line = lines[index] || "";
    if (isCoverPageNonNameLine(line)) {
      if (names.length) break;
      continue;
    }
    names.unshift(line);
  }
  return names.filter((name) => name.length >= 2);
}

function isCoverPageNonNameLine(line: string) {
  return (
    /^\|$/.test(line) ||
    /^[-–—]+$/.test(line) ||
    /^\(.+\)$/.test(line) ||
    /^UNITED STATES$/i.test(line) ||
    /^SECURITIES AND EXCHANGE COMMISSION$/i.test(line) ||
    /^Washington, D\.C\./i.test(line) ||
    /^SCHEDULE\b/i.test(line) ||
    /\bSC\s+(?:TO|13E-?3)\b/i.test(line) ||
    /\bfiles?\s+(?:SC|Schedule|CB)\b/i.test(line) ||
    /^Tender Offer Statement/i.test(line) ||
    /^of the Securities Exchange Act/i.test(line) ||
    /^Copies to:?$/i.test(line) ||
    /^Check\b/i.test(line) ||
    checkedCheckboxPattern.test(line) ||
    uncheckedCheckboxPattern.test(line) ||
    /\b(?:third-party tender offer|issuer tender offer|going private transaction|Rule 13e-4|Rule 14d-1)\b/i.test(line)
  );
}

const tenderHeadingDefinitions = [
  ["summary_term_sheet", "Summary Term Sheet", /\bSummary Term Sheet\b/i],
  ["terms_of_transaction", "Terms of the Transaction", /\b(?:Item\s+4\s*(?:\.|[-\u2014])?\s*)?Terms of (?:the )?Transaction\b/i],
  ["the_offer", "The Offer", /\b(?:The\s+)?Tender Offer\b|\bThe Offer\b/i],
  ["conditions_of_offer", "Conditions of the Offer", /\bConditions (?:of|to) (?:the )?(?:Tender )?Offer\b/i],
  ["source_and_amount_of_funds", "Source and Amount of Funds", /\bSource and Amount of Funds(?: or Other Consideration)?\b/i],
  ["purpose_of_transaction", "Purpose of the Transaction", /\bPurpose of (?:the )?(?:Transaction|Offer)\b/i],
  ["past_contacts_transactions", "Past Contacts, Transactions, Negotiations and Agreements", /\bPast Contacts, Transactions, Negotiations and Agreements\b/i],
  ["interests_in_securities", "Interests in Securities", /\bInterests in Securities\b/i],
  ["financial_statements", "Financial Statements", /\bFinancial Statements\b/i],
  ["special_factors", "Special Factors", /\bSpecial Factors\b/i],
  ["purpose_alternatives_reasons_effects", "Purpose, Alternatives, Reasons and Effects", /\bPurpose, Alternatives, Reasons and Effects\b/i],
  ["fairness_of_transaction", "Fairness of the Transaction", /\bFairness of (?:the )?(?:Going[- ]Private )?Transaction\b/i],
  ["reports_opinions_appraisals", "Reports, Opinions, Appraisals and Negotiations", /\bReports?, Opinions?, Appraisals? and Negotiations\b/i],
  ["recommendation_of_board", "Recommendation of the Board", /\bRecommendation of (?:the )?Board(?: of Directors)?\b/i],
  ["background_of_offer", "Background of the Offer", /\bBackground of (?:the )?Offer\b/i],
  ["reasons_for_recommendation", "Reasons for the Recommendation", /\bReasons for (?:the )?Recommendation\b/i],
  ["interests_of_directors", "Interests of Directors and Executive Officers", /\bInterests of (?:Certain Persons|Directors and Executive Officers)\b/i],
  ["exhibits", "Exhibits", /\bExhibits\b/i],
] as const;

function extractTenderHeadingSections(text: string): SecTenderHeadingSection[] {
  const sections: SecTenderHeadingSection[] = [];
  const seen = new Set<string>();
  for (const [key, heading, pattern] of tenderHeadingDefinitions) {
    const match = text.match(pattern);
    if (!match || match.index === undefined || seen.has(key)) continue;
    seen.add(key);
    sections.push({
      key,
      heading,
      evidence: extractHeadingEvidence(text, match.index),
    });
  }
  return sections;
}

function extractHeadingEvidence(text: string, startIndex: number) {
  const source = text.slice(startIndex, Math.min(text.length, startIndex + 1_200));
  const nextHeading = source.slice(80).search(/\n\s*(?:Item\s+\d+\.?|[A-Z][A-Za-z, /&-]{4,80})\s*\n/i);
  const end = nextHeading >= 0 ? 80 + nextHeading : Math.min(source.length, 700);
  return truncate(source.slice(0, end), 700);
}

function classifyTenderCase(formType: string | null, text: string, coverPage: SecTenderCoverPageSignals): SecTenderCase {
  const form = formType || "";
  if (/13E3/i.test(form)) return "going_private_13e3";
  if (/^CB/i.test(form)) return "schedule_cb_cross_border";
  if (/TO-C/i.test(form)) return "tender_offer_communication";
  if (/TO-I/i.test(form)) return "issuer_tender_offer";
  if (/TO-T/i.test(form)) return "third_party_tender_offer";
  if (coverPage.checkbox_signals.third_party_tender?.checked) return "third_party_tender_offer";
  if (coverPage.checkbox_signals.issuer_tender?.checked) return "issuer_tender_offer";
  if (coverPage.checkbox_signals.pre_commencement_communication?.checked) return "tender_offer_communication";
  if (coverPage.checkbox_signals.going_private_13e3?.checked) return "going_private_13e3";
  if (/\bthird[- ]party tender offer\b|\bofferor\b[\s\S]{0,220}\btarget company\b/i.test(text)) return "third_party_tender_offer";
  if (/\bissuer tender offer\b|\bself-tender\b|\bmodified Dutch auction\b/i.test(text)) return "issuer_tender_offer";
  if (findNarrativeSentenceField(text, /\b(?:Rule 13e-3|Schedule 13E-3|going private|go private|take private)\b/i)) {
    return "going_private_13e3";
  }
  if (findNarrativeSentenceField(text, /\b(?:Schedule CB|cross-border|home jurisdiction|Tier I exemption|Tier II exemption)\b/i)) {
    return "schedule_cb_cross_border";
  }
  if (/TO/i.test(form) || /\btender offer\b/i.test(text)) return "generic_tender_offer";
  return "unsupported";
}

function buildAmendmentInfo({
  coverPage,
  formType,
  headingSections,
  parentFilingContext,
  text,
}: {
  coverPage: SecTenderCoverPageSignals;
  formType: string | null;
  headingSections: SecTenderHeadingSection[];
  parentFilingContext?: Record<string, unknown> | null;
  text: string;
}): SecTenderAmendmentInfo {
  const isAmendment = Boolean(formType?.endsWith("/A")) || /\bAmendment\s+No\.?\s*\d+/i.test(text);
  const amendmentNumber = isAmendment ? findAmendmentNumber(text) : null;
  const amendmentExcerpt = isAmendment ? extractAmendmentExcerpt(text) : null;
  const scopedText = amendmentExcerpt || text;
  const limitedScopeSignals = isAmendment ? findLimitedScopeAmendmentSignals(scopedText) : [];
  const materialChangeSignals = isAmendment ? findMaterialAmendmentSignals(scopedText) : [];
  const changedHeadingCandidates = isAmendment ? findChangedHeadingSignals(scopedText, headingSections) : [];
  const classification = classifyAmendmentType({
    coverPage,
    formType,
    isAmendment,
    limitedScopeSignals,
    materialChangeSignals,
    scopedText,
  });
  const isRoutineNoChangeCandidate =
    isAmendment &&
    limitedScopeSignals.length > 0 &&
    materialChangeSignals.length === 0 &&
    /\b(?:no other changes|all other terms|terms of the offer remain unchanged|unchanged)\b/i.test(scopedText);

  return {
    is_amendment: isAmendment,
    amendment_number: amendmentNumber,
    parent_accession_number: nullableString(parentFilingContext?.accessionNumber) || nullableString(parentFilingContext?.accession_number),
    limited_scope_signal_candidates: limitedScopeSignals,
    material_change_candidates: materialChangeSignals,
    changed_heading_candidates: changedHeadingCandidates,
    amendment_classification: classification,
    routine_no_change_candidate: {
      is_candidate: isRoutineNoChangeCandidate,
      reason: isRoutineNoChangeCandidate
        ? "Amendment text limits the filing to administrative or exhibit-only changes and states the offer terms are unchanged."
        : null,
      source_evidence: limitedScopeSignals.map((signal) => signal.evidence),
      changed_terms_detected: materialChangeSignals.map((signal) => String(signal.value)),
    },
    amendment_excerpt: amendmentExcerpt,
  };
}

function findAmendmentNumber(text: string): SecTenderField<number> | null {
  const match = text.match(/\bAmendment\s+No\.?\s*(\d+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return {
    value: parsed,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "high",
  };
}

function findLimitedScopeAmendmentSignals(text: string) {
  return [
    field("exhibit_only", text, /\b(?:solely|only)\s+to\s+(?:add|file|furnish)[^.\n]{0,180}\bexhibit\b/i, "high"),
    field("signature_only", text, /\b(?:signature page|power of attorney|signatures?)\b/i, "medium"),
    field("no_other_changes", text, /\b(?:no other changes|all other terms[^.\n]{0,120}unchanged|terms of the offer remain unchanged)\b/i, "high"),
    field("typographical_correction", text, /\b(?:typographical|clerical|formatting)\s+(?:correction|change)\b/i, "medium"),
  ].filter(isTenderField);
}

function findMaterialAmendmentSignals(text: string) {
  return [
    field(
      "offer_price_change",
      text,
      /\b(?:(?:increase|decrease|raise|lower|amend)[^.\n]{0,160}\b(?:offer price|purchase price|consideration)|(?:offer price|purchase price|consideration)[^.\n]{0,160}\b(?:increased|decreased|raised|lowered|amended|changed))\b/i,
      "high",
    ),
    field("consideration_change", text, /\b(?:cash|stock|mixed)\s+consideration[^.\n]{0,160}\b(?:changed|revised|amended|increased|decreased)\b/i, "high"),
    field("expiration_extension", text, /\b(?:extend|extended|extension)[^.\n]{0,160}\b(?:expiration|tender offer|offer period)\b/i, "high"),
    field(
      "condition_change",
      text,
      /\b(?:(?:waive|waived|modify|modified|amend)[^.\n]{0,160}\b(?:condition|minimum tender|financing)|(?:condition|minimum tender|financing)[^.\n]{0,160}\b(?:waived|modified|amended|changed))\b/i,
      "medium",
    ),
    field("financing_change", text, /\b(?:financing|commitment letter|debt commitment|equity commitment)[^.\n]{0,180}\b(?:changed|revised|amended|terminated|failed|unavailable)\b/i, "medium"),
    field("recommendation_change", text, /\b(?:recommendation|board recommends?|special committee)[^.\n]{0,180}\b(?:changed|withdrawn|revised|amended|no longer)\b/i, "medium"),
    field("fairness_opinion_change", text, /\b(?:fairness opinion|financial advisor|opinion|presentation)[^.\n]{0,180}\b(?:added|updated|changed|revised|amended)\b/i, "medium"),
    field("transaction_agreement_change", text, /\b(?:merger agreement|transaction agreement|agreement and plan of merger)[^.\n]{0,180}\b(?:added|updated|changed|revised|amended|supplemented)\b/i, "medium"),
    field("conflict_or_special_committee_change", text, /\b(?:special committee|conflict|affiliate|rollover)[^.\n]{0,180}\b(?:changed|added|revised|amended)\b/i, "medium"),
    field("going_private_or_delisting_change", text, /\b(?:going private|delisting|deregistration|squeeze[- ]out|short[- ]form merger)[^.\n]{0,180}\b(?:changed|added|revised|amended|expected)\b/i, "medium"),
    field("shares_sought_change", text, /\b(?:increase|decrease|amend)[^.\n]{0,180}\b(?:shares sought|number of shares|aggregate purchase price)\b/i, "medium"),
    field("proration_change", text, /\b(?:proration|prorated)[^.\n]{0,160}\b(?:changed|amended|revised)\b/i, "medium"),
  ].filter(isTenderField);
}

function findChangedHeadingSignals(text: string, headingSections: SecTenderHeadingSection[]) {
  const signals: SecTenderField<string>[] = [];
  for (const section of headingSections) {
    const headingPattern = new RegExp(`\\b(?:amends?|supplements?|revises?|restat(?:e|es|ed)|delet(?:e|es|ed)|add(?:s|ed)?)\\b[\\s\\S]{0,220}\\b${escapeRegExp(section.heading)}\\b`, "i");
    const signal = field(section.key, text, headingPattern, "medium");
    if (signal) signals.push(signal);
  }
  return signals;
}

function classifyAmendmentType({
  coverPage,
  formType,
  isAmendment,
  limitedScopeSignals,
  materialChangeSignals,
  scopedText,
}: {
  coverPage: SecTenderCoverPageSignals;
  formType: string | null;
  isAmendment: boolean;
  limitedScopeSignals: SecTenderField<string>[];
  materialChangeSignals: SecTenderField<string>[];
  scopedText: string;
}): SecTenderAmendmentInfo["amendment_classification"] {
  const hasSubstantiveSignal = materialChangeSignals.length > 0 || hasSubstantiveAmendmentLanguage(scopedText);
  if (!isAmendment && (/TO-C/i.test(formType || "") || coverPage.checkbox_signals.pre_commencement_communication?.checked) && !hasSubstantiveSignal) {
    return amendmentClassification("pre_commencement_communication_only", "high", [
      checkboxEvidence(coverPage, "pre_commencement_communication") || `${formType || "Filing"} is a pre-commencement communication form.`,
    ], true);
  }
  if (!isAmendment) return amendmentClassification("initial_filing", "high", [], false);

  if ((coverPage.checkbox_signals.pre_commencement_communication?.checked || /\bpre[- ]commencement communication\b/i.test(scopedText)) && !hasSubstantiveSignal) {
    return amendmentClassification("pre_commencement_communication_only", "high", [
      checkboxEvidence(coverPage, "pre_commencement_communication") || pickEvidenceSentence(scopedText, scopedText.search(/pre[- ]commencement/i)),
    ], true);
  }

  const materialValues = materialChangeSignals.map((signal) => signal.value);
  const nonExtensionMaterial = materialValues.filter((value) => value !== "expiration_extension");
  if (materialValues.includes("expiration_extension") && nonExtensionMaterial.length === 0 && !hasSubstantiveAmendmentLanguage(scopedText)) {
    return amendmentClassification("extension_only", "high", materialChangeSignals.map((signal) => signal.evidence), true);
  }

  const finalResults = findFinalResultsSignal(scopedText, coverPage);
  if (finalResults && materialChangeSignals.length === 0) {
    return amendmentClassification("final_results_only", finalResults.confidence, [finalResults.evidence], true);
  }

  const tenderedSharesUpdate = findTenderedSharesUpdateSignal(scopedText);
  if (tenderedSharesUpdate && materialChangeSignals.length === 0) {
    return amendmentClassification("tendered_shares_count_update_only", tenderedSharesUpdate.confidence, [tenderedSharesUpdate.evidence], true);
  }

  const exhibitOnly = limitedScopeSignals.some((signal) => signal.value === "exhibit_only");
  if (exhibitOnly && materialChangeSignals.length === 0) {
    return amendmentClassification("new_exhibit_only", "medium", limitedScopeSignals.map((signal) => signal.evidence), true);
  }

  if (hasSubstantiveSignal) {
    return amendmentClassification("substantive_amendment_likely", "medium", materialChangeSignals.map((signal) => signal.evidence), false);
  }

  return amendmentClassification("amendment_uncertain", "low", [truncate(scopedText, 360)], false);
}

function amendmentClassification(
  type: SecTenderAmendmentInfo["amendment_classification"]["type"],
  confidence: SecTenderField<string>["confidence"],
  evidence: string[],
  parserOnlyCandidate: boolean,
): SecTenderAmendmentInfo["amendment_classification"] {
  return {
    type,
    confidence,
    evidence: evidence.filter(Boolean).slice(0, 4),
    parser_only_candidate: parserOnlyCandidate,
  };
}

function findFinalResultsSignal(text: string, coverPage: SecTenderCoverPageSignals) {
  if (coverPage.checkbox_signals.final_amendment?.checked) {
    return {
      value: "final_results_only",
      evidence: checkboxEvidence(coverPage, "final_amendment") || "Final amendment checkbox is checked.",
      confidence: "high" as const,
    };
  }
  return field(
    "final_results_only",
    text,
    /\b(?:final results?|expiration and results?|accepted for payment|tendered and not withdrawn|depositary has advised)\b/i,
    "high",
  );
}

function findTenderedSharesUpdateSignal(text: string) {
  return field(
    "tendered_shares_count_update_only",
    text,
    /\b(?:preliminary results?|approximately\s+\d[\d,]*\s+shares\s+(?:were\s+)?(?:validly\s+)?tendered|tendered and not withdrawn)\b/i,
    "medium",
  );
}

function hasSubstantiveAmendmentLanguage(text: string) {
  return /\b(?:offer price|purchase price|consideration|waiver|condition|financing|fairness opinion|special committee|going private|delisting|deregistration|squeeze[- ]out)\b/i.test(
    text,
  );
}

function buildRouteHint({
  amendment,
  coverPage,
  legalRisk,
  tenderCase,
}: {
  amendment: SecTenderAmendmentInfo;
  coverPage: SecTenderCoverPageSignals;
  legalRisk: SecTenderField<string> | null;
  tenderCase: SecTenderCase;
}) {
  if (amendment.amendment_classification.parser_only_candidate && amendment.amendment_classification.type === "pre_commencement_communication_only") {
    return {
      route_case: "tender_offer_communication",
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Pre-commencement tender communication is mechanically identified; analysis LLM still owns final handling.",
    };
  }
  if (amendment.material_change_candidates.length > 0 || amendment.amendment_classification.type === "substantive_amendment_likely") {
    return {
      route_case: "material_amendment",
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Amendment contains changed tender offer economics, timing, conditions, or substantive transaction terms.",
    };
  }
  if (amendment.routine_no_change_candidate.is_candidate && amendment.amendment_classification.parser_only_candidate) {
    return {
      route_case: "routine_amendment",
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: amendment.routine_no_change_candidate.reason,
    };
  }
  if (tenderCase === "issuer_tender_offer") {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Issuer tender offer detected; router must choose the event type and score from source-backed facts.",
    };
  }
  if (tenderCase === "going_private_13e3") {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Going-private or Schedule 13E-3 case detected; router must choose the event type and score from source-backed facts.",
    };
  }
  if (tenderCase === "third_party_tender_offer") {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Third-party tender offer detected; router must choose the event type and score from source-backed facts.",
    };
  }
  if (tenderCase === "schedule_cb_cross_border") {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Schedule CB cross-border case detected; router must choose the event type and score from source-backed facts.",
    };
  }
  if (coverPage.form_cb.transaction_type) {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: `Form CB cover-level transaction classification detected: ${coverPage.form_cb.transaction_type}.`,
    };
  }
  if (legalRisk) {
    return {
      route_case: tenderCase,
      analysis_bypass_candidate: false,
      router_must_decide_final_output: false,
      reason: "Legal-risk source text detected; router must decide whether legal risk is central or only supporting context.",
    };
  }
  return {
    route_case: tenderCase,
    analysis_bypass_candidate: false,
    router_must_decide_final_output: false,
    reason: "Tender-family filing is supported, but the investor impact needs routing context.",
  };
}

function buildParserOnlyRoutingHints({
  amendment,
  coverPage,
  tenderCase,
}: {
  amendment: SecTenderAmendmentInfo;
  coverPage: SecTenderCoverPageSignals;
  tenderCase: SecTenderCase;
}) {
  const safeCandidates: Array<Record<string, unknown>> = [];
  if (amendment.amendment_classification.parser_only_candidate) {
    safeCandidates.push({
      type: amendment.amendment_classification.type,
      confidence: amendment.amendment_classification.confidence,
      evidence: amendment.amendment_classification.evidence,
    });
  }
  if (tenderCase === "schedule_cb_cross_border" && coverPage.form_cb.transaction_type) {
    safeCandidates.push({
      type: "form_cb_cover_level_classification_only",
      confidence: "medium",
      evidence: coverPage.form_cb.rule_signals,
    });
  }
  return {
    safe_candidates: safeCandidates,
    analysis_bypass_candidate: false,
    note: "Parser-only hints identify filing posture for debugging; analysis LLM owns investor interpretation, display payload, scoring, and delivery.",
  };
}

function buildMarketContextRequirements({
  aggregateAmount,
  cashPrice,
  premium,
  tenderCase,
}: {
  aggregateAmount: SecTenderMoneyField | null;
  cashPrice: SecTenderPriceField | null;
  premium: SecTenderField<number> | null;
  tenderCase: SecTenderCase;
}) {
  if (tenderCase === "issuer_tender_offer" && (aggregateAmount || cashPrice)) {
    return {
      needed: true,
      reason: "Issuer tender offer size should be compared with market cap, shares outstanding, and public float.",
      fields: ["price", "market_cap", "shares_outstanding", "public_float", "volume", "avg_volume"],
    };
  }
  if ((tenderCase === "third_party_tender_offer" || tenderCase === "going_private_13e3") && (cashPrice || premium)) {
    return {
      needed: true,
      reason: "Tender consideration should be compared with recent trading price and premium to assess deal impact.",
      fields: ["price", "previous_close", "market_cap", "shares_outstanding"],
    };
  }
  return {
    needed: false,
    reason: null,
    fields: [],
  };
}

function buildSignals({
  amendment,
  cashPrice,
  expirationDate,
  goingPrivateSignal,
  marketContextRequirements,
  offeror,
  premium,
  tenderCase,
}: {
  amendment: SecTenderAmendmentInfo;
  cashPrice: SecTenderPriceField | null;
  expirationDate: SecTenderDateField | null;
  goingPrivateSignal: SecTenderField<string> | null;
  marketContextRequirements: Record<string, unknown>;
  offeror: string | null;
  premium: SecTenderField<number> | null;
  tenderCase: SecTenderCase;
}) {
  const signals: Array<Record<string, unknown>> = [];
  if (tenderCase !== "unsupported") {
    signals.push({
      type: "tender_family",
      value: tenderCase,
      confidence: tenderCase === "generic_tender_offer" ? "medium" : "high",
    });
  }
  if (cashPrice) {
    signals.push({
      type: "cash_consideration",
      value: cashPrice.value,
      evidence: cashPrice.evidence,
    });
  }
  if (premium) {
    signals.push({
      type: "premium",
      value: premium.value,
      evidence: premium.evidence,
    });
  }
  if (expirationDate) {
    signals.push({
      type: "deadline",
      value: expirationDate.value,
      evidence: expirationDate.evidence,
    });
  }
  if (goingPrivateSignal) {
    signals.push({
      type: "going_private",
      value: true,
      evidence: goingPrivateSignal.evidence,
    });
  }
  if (offeror) {
    signals.push({
      type: "offeror_present",
      value: offeror,
    });
  }
  if (amendment.routine_no_change_candidate.is_candidate) {
    signals.push({
      type: "routine_no_change_amendment_candidate",
      value: "routine_amendment_no_term_change",
      evidence: amendment.routine_no_change_candidate.reason,
    });
  }
  if (marketContextRequirements.needed) {
    signals.push({
      type: "market_context_needed",
      value: marketContextRequirements.fields,
      reason: marketContextRequirements.reason,
    });
  }
  return signals;
}

function buildCalendarItems({
  expirationDate,
  tenderCase,
  withdrawalDeadline,
}: {
  expirationDate: SecTenderDateField | null;
  tenderCase: SecTenderCase;
  withdrawalDeadline: SecTenderDateField | null;
}) {
  const items: Array<Record<string, unknown>> = [];
  if (expirationDate) {
    items.push({
      type: "tender_expiration",
      title: "Tender offer expiration",
      date: expirationDate.value.date,
      date_text: expirationDate.value.text,
      evidence: expirationDate.evidence,
      source_case: tenderCase,
    });
  }
  if (withdrawalDeadline) {
    items.push({
      type: "withdrawal_deadline",
      title: "Withdrawal rights deadline",
      date: withdrawalDeadline.value.date,
      date_text: withdrawalDeadline.value.text,
      evidence: withdrawalDeadline.evidence,
      source_case: tenderCase,
    });
  }
  return items;
}

function buildWarnings({
  amendment,
  coverPage,
  extractionWarnings,
  formType,
  isSupported,
  sourceWarnings,
  tenderText,
}: {
  amendment: SecTenderAmendmentInfo;
  coverPage: SecTenderCoverPageSignals;
  extractionWarnings?: string[];
  formType: string | null;
  isSupported: boolean;
  sourceWarnings: string[];
  tenderText: string;
}) {
  const warnings: string[] = [];
  if (!formType) warnings.push("form_type_not_found");
  if (!tenderText) warnings.push("no_text_available");
  if (!isSupported) warnings.push("not_tender_cb_13e3_family");
  warnings.push(...sourceWarnings);
  warnings.push(...coverPage.warnings);
  warnings.push(...(extractionWarnings || []));
  if (amendment.amendment_classification.type === "amendment_uncertain") warnings.push("amendment_classification_uncertain");
  return Array.from(new Set(warnings));
}

function buildSummary({
  cashPrice,
  expirationDate,
  formType,
  issuer,
  targetCompany,
  tenderCase,
}: {
  cashPrice: SecTenderPriceField | null;
  expirationDate: SecTenderDateField | null;
  formType: string | null;
  issuer: string | null;
  targetCompany: string | null;
  tenderCase: SecTenderCase;
}) {
  const subject = targetCompany || issuer || "the company";
  const price = cashPrice?.text ? ` at ${cashPrice.text} per share` : "";
  const deadline = expirationDate?.value.text ? ` expiring ${expirationDate.value.text}` : "";
  if (tenderCase === "unsupported") return null;
  return `${formType || SEC_TENDER_ROOM_FORM_TYPE} ${tenderCase.replace(/_/g, " ")} for ${subject}${price}${deadline}.`;
}

function readIssuer(rawPayload: Record<string, unknown>, metadata: Record<string, unknown>, text: string, coverPage?: SecTenderCoverPageSignals) {
  const rawName =
    nullableString(rawPayload.company_name) ||
    nullableString(rawPayload.issuer) ||
    nullableString(metadata.company_name) ||
    nullableString(metadata.issuer);
  if (rawName) return cleanCompanyName(rawName.replace(/\s*\((?:Subject|Issuer)\)\s*CIK\s*:.*$/i, ""));
  return (
    getCoverPageString(coverPage || emptyCoverPageSignals(), "subject_company") ||
    readCompanyField(text, [
      /\bIssuer:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
      /\n\s*([A-Z][A-Z0-9&.,' -]{2,120})\s*\n\s*\(Name of Subject Company/i,
      /\bExact name of subject company:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
      /\b(Name of Issuer)\s*[:|-]?\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
    ])
  );
}

function emptyCoverPageSignals(): SecTenderCoverPageSignals {
  return {
    checkbox_signals: {},
    subject_company: null,
    filing_persons: null,
    offerors: null,
    security_class: null,
    cusip: null,
    form_cb: {
      transaction_type: null,
      rule_signals: [],
      foreign_issuer_or_jurisdiction: null,
      person_furnishing_form: null,
      home_jurisdiction_document_present: false,
      english_translation_or_summary_present: false,
      form_fx_present: false,
    },
    warnings: [],
  };
}

function readCompanyField(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const captured = match?.[2] || match?.[1];
    if (captured) return cleanCompanyName(captured);
  }
  return null;
}

function cleanCompanyName(value: string) {
  return compactText(value)
    .replace(/\s+(?:common stock|ordinary shares|shares|ADSs|has commenced|commenced).*$/i, "")
    .replace(/\s+(?:at an?|for|representing|subject to)\s+.*$/i, "")
    .replace(/[.;,:\s]+$/g, "")
    .trim();
}

function extractTenderParties(text: string, coverPage: SecTenderCoverPageSignals, tenderCase: SecTenderCase) {
  const offeror =
    fieldFromCompanyPattern("offeror", text, /\b(?:offeror|bidder|purchaser)(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/i, "medium") ||
    fieldFromCompanyPattern("offeror", text, /\b([A-Z][A-Za-z0-9&.,' -]{2,100})\s+(?:has commenced|commenced) a tender offer/i, "medium");
  const parent = fieldFromCompanyPattern("parent", text, /(?:^|\n)\s*Parent\s*:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i, "medium");
  const mergerSub = fieldFromCompanyPattern("merger_sub", text, /(?:^|\n)\s*(?:Merger Sub|Purchaser)\s*:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i, "medium");
  const affiliate = fieldFromCompanyPattern("affiliate", text, /\baffiliate(?: filing person)?(?: is|:)?[ \t]+([A-Z][A-Za-z0-9&.,' -]{2,100})/i, "low");
  const ignoredAgents = findIgnoredAgentCandidates(text);
  const warnings: string[] = [];
  if (!offeror && tenderCase === "third_party_tender_offer" && ignoredAgents.length > 0) warnings.push("party_extraction_ambiguous_agent_not_offeror");
  if (offeror && ignoredAgents.some((agent) => sameCompanyName(agent.value, offeror.value))) warnings.push("party_extraction_agent_conflict");
  return {
    subject_company: coverPage.subject_company,
    issuer_or_subject: coverPage.subject_company,
    filing_persons: coverPage.filing_persons,
    offeror,
    parent,
    merger_sub: mergerSub,
    affiliate,
    person_furnishing_form: coverPage.form_cb.person_furnishing_form,
    ignored_agent_candidates: ignoredAgents,
    warnings,
  };
}

function fieldFromCompanyPattern(value: string, text: string, pattern: RegExp, confidence: SecTenderField<string>["confidence"]): SecTenderField<string> | null {
  const match = text.match(pattern);
  const captured = match?.[1];
  if (!captured) return null;
  const company = cleanCompanyName(captured);
  if (!company || isServiceProviderName(company)) return null;
  return {
    value: company,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence,
  };
}

function findIgnoredAgentCandidates(text: string) {
  const candidates: SecTenderField<string>[] = [];
  const patterns = [
    /\b(?:depositary|depository)(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/gi,
    /\binformation agent(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/gi,
    /\bdealer manager(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/gi,
    /\bfinancial advisor(?: is|:)?\s+([A-Z][A-Za-z0-9&.,' -]{2,100})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (!match[1]) continue;
      candidates.push({
        value: cleanCompanyName(match[1]),
        evidence: pickEvidenceSentence(text, match.index),
        confidence: "medium",
      });
    }
  }
  return candidates.slice(0, 6);
}

function isServiceProviderName(value: string) {
  return /\b(?:Depositary|Depository|Information Agent|Dealer Manager|Financial Advisor|Counsel|LLP|Law Firm|Transfer Agent)\b/i.test(value);
}

function sameCompanyName(left: string, right: string) {
  return compactText(left).toLowerCase() === compactText(right).toLowerCase();
}

function findTickerSymbol(text: string): SecTenderField<string> | null {
  const patterns = [
    /\b(?:trading symbol|ticker symbol|exchange symbol)\s*[:\-]?\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/i,
    /\b(?:NYSE|Nasdaq|NASDAQ|NYSE American)\s*[:\-]\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    return {
      value: match[1].toUpperCase(),
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findConsiderationType(text: string, tenderCase: SecTenderCase): SecTenderField<string> | null {
  if (/\b(?:cash plus|cash and stock|mixed consideration|cash election|stock election)\b/i.test(text)) {
    return field("mixed_cash_stock", text, /\b(?:cash plus|cash and stock|mixed consideration|cash election|stock election)\b/i, "high");
  }
  if (/\b(?:exchange offer|exchange ratio|for each share.*?share of|ADSs? for each)\b/i.test(text)) {
    return field("stock_or_security_exchange", text, /\b(?:exchange offer|exchange ratio|for each share.*?share of|ADSs? for each)\b/i, "high");
  }
  if (/\b(?:cash tender offer|in cash|cash price|net to the seller in cash)\b/i.test(text)) {
    return field("cash", text, /\b(?:cash tender offer|in cash|cash price|net to the seller in cash)\b/i, "high");
  }
  if (tenderCase === "issuer_tender_offer") {
    return field("cash", text, /\btender offer\b/i, "low");
  }
  return null;
}

function findCashTenderPrice(text: string) {
  return findCashTenderPriceCandidates(text).primary;
}

function findCashTenderPriceCandidates(text: string) {
  const candidates = findPriceCandidates(text, [
    {
      pattern: /\b(?:merger consideration|cash consideration|transaction consideration)\s+(?:is|of|to|equal to|will be)?\s*(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "transaction_consideration",
      confidence: "high" as const,
    },
    {
      pattern: /\bright\s+to\s+receive[\s\S]{0,120}?(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)\s+in\s+cash/i,
      context: "right_to_receive_cash",
      confidence: "high" as const,
    },
    {
      pattern: /\b(?:net to (?:the )?seller|net cash)[^.\n]{0,140}?(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "net_to_seller_cash",
      confidence: "high" as const,
    },
    {
      pattern: /\boffer price[\s\S]{0,160}\bto\s+(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "offer_price",
      confidence: "high" as const,
    },
    {
      pattern: /\b(?:offer price|purchase price|cash price|tender offer price)\s+(?:is|of|to|equal to|will be)?\s*(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "offer_price",
      confidence: "high" as const,
    },
    {
      pattern: /\bat a price\s+(?:equal to\s+)?(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "price_per_security",
      confidence: "medium" as const,
    },
    {
      pattern: /\b(?:net asset value|NAV)\s+per\s+Share\s+(?:was|is|of|equal to)\s+(\$ ?\d[\d,.]*)\s+per\s+Share/i,
      context: "nav_purchase_price",
      confidence: "medium" as const,
    },
    {
      pattern: /\b(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)[^.\n]{0,160}\b(?:in cash|net to the seller|tender offer|purchase price|offer price)\b/i,
      context: "price_per_security",
      confidence: "medium" as const,
    },
    {
      pattern: /\b(?:at a price of|for)\s+(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share|unit)/i,
      context: "price_per_security",
      confidence: "medium" as const,
    },
  ]);
  const validCandidates = candidates.filter((candidate) => !isOfferPriceNoise(candidate.evidence));
  return {
    primary: validCandidates[0] || null,
    candidates: validCandidates.slice(0, 5),
    conflicts: findConflictingPriceCandidates(validCandidates),
  };
}

function findPriceCandidates(
  text: string,
  patterns: Array<{ pattern: RegExp; context: string; confidence: SecTenderField<string>["confidence"] }>,
): SecTenderPriceField[] {
  const candidates: SecTenderPriceField[] = [];
  for (const item of patterns) {
    const pattern = new RegExp(item.pattern.source, item.pattern.flags.includes("g") ? item.pattern.flags : `${item.pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (!match[1]) continue;
      const valueText = match[1].trim();
      const evidence = pickEvidenceSentence(text, match.index || 0);
      candidates.push({
        value: {
          price: normalizePrice(valueText),
          currency: valueText.includes("$") ? "USD" : null,
        },
        text: valueText,
        evidence,
        confidence: item.confidence,
      });
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.value.price}:${candidate.evidence}`;
    if (candidate.value.price === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isOfferPriceNoise(evidence: string) {
  if (/\b(?:offer price|purchase price|tender offer price|net to the seller|right to receive|merger consideration|cash consideration|transaction consideration)\b/i.test(evidence)) {
    return false;
  }
  return /\b(?:filing fee|fee table|transaction valuation|source and amount of funds|debt commitment|equity commitment|financing commitment|fairness opinion|valuation range|selected companies|premium range|trading price|closing price|historical price|52-week)\b/i.test(evidence);
}

function findConflictingPriceCandidates(candidates: SecTenderPriceField[]) {
  const prices = new Set(candidates.map((candidate) => candidate.value.price).filter((price): price is number => price !== null));
  return prices.size > 1 ? candidates.slice(0, 5) : [];
}

function buildOfferEconomics(
  text: string,
  priceCandidates: ReturnType<typeof findCashTenderPriceCandidates>,
  exchangeRatio: SecTenderField<string> | null,
  considerationType: SecTenderField<string> | null,
) {
  const dutchAuctionRange = findDutchAuctionRange(text);
  const cvr = findSentenceField(text, /\b(?:CVR|contingent value right)\b/i);
  const mixedConsideration = findSentenceField(text, /\b(?:cash plus|cash and stock|mixed consideration|cash election|stock election)\b/i);
  const warnings: string[] = [];
  if (priceCandidates.conflicts.length > 0) warnings.push("conflicting_offer_price_candidates");
  return {
    cash_price_candidates: priceCandidates.candidates,
    conflicting_price_candidates: priceCandidates.conflicts,
    exchange_ratio: exchangeRatio,
    cvr_or_contingent_value_right: cvr,
    dutch_auction_range: dutchAuctionRange,
    mixed_consideration: mixedConsideration,
    consideration_basis: findConsiderationBasis(text),
    consideration_type: considerationType,
    warnings,
  };
}

function findDutchAuctionRange(text: string): SecTenderField<{ low: number | null; high: number | null; text: string }> | null {
  const match = text.match(/\b(?:Dutch auction|price range)[^.\n]{0,180}?(\$ ?\d[\d,.]*)\s+(?:to|and)\s+(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|unit)/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    value: {
      low: normalizePrice(match[1]),
      high: normalizePrice(match[2]),
      text: `${match[1]} to ${match[2]}`,
    },
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "high",
  };
}

function findConsiderationBasis(text: string) {
  return findSentenceField(text, /\bper\s+(?:share|ADS|ordinary share|common share|unit)\b/i);
}

function findCashTenderPriceLegacy(text: string) {
  return findPriceField(text, [
    /\b(?:merger consideration|cash consideration|transaction consideration)\s+(?:is|of|to|equal to|will be)?\s*(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)/i,
    /\bright\s+to\s+receive[\s\S]{0,120}?(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)\s+in\s+cash/i,
    /\boffer price[\s\S]{0,160}\bto\s+(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)/i,
    /\b(?:offer price|purchase price|cash price|tender offer price)\s+(?:is|of|to|equal to|will be)?\s*(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)/i,
    /\bat a price\s+(?:equal to\s+)?(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)/i,
    /\b(?:net asset value|NAV)\s+per\s+Share\s+(?:was|is|of|equal to)\s+(\$ ?\d[\d,.]*)\s+per\s+Share/i,
    /\b(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)[^.\n]{0,160}\b(?:in cash|net to the seller|tender offer|purchase price|offer price)\b/i,
    /\b(?:at a price of|for)\s+(\$ ?\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share|common share)/i,
  ]);
}

function findExchangeRatio(text: string): SecTenderField<string> | null {
  const patterns = [
    /\b(?:exchange ratio|receive)\s+(?:of\s+)?([0-9.]+\s+(?:of\s+a\s+)?(?:(?:[A-Z][A-Za-z0-9&.'-]*|plc|inc\.?|corp\.?|ordinary|common)\s+){0,10}(?:share|shares|ADSs?)[^.\n]{0,160}?for each[^.\n]{0,100}?(?:share|ADS|ordinary share|common share))/i,
    /\b(?:receive|be entitled to receive)\s+([0-9.]+\s+(?:of\s+a\s+)?(?:(?:[A-Z][A-Za-z0-9&.'-]*|plc|inc\.?|corp\.?|ordinary|common)\s+){0,10}(?:share|shares|ADSs?)[^.\n]{0,160}?(?:for|in exchange for)\s+each[^.\n]{0,100}?(?:share|ADS|ordinary share|common share))/i,
    /\b([0-9.]+\s+(?:of\s+a\s+)?(?:(?:[A-Z][A-Za-z0-9&.'-]*|plc|inc\.?|corp\.?|ordinary|common)\s+){0,10}(?:share|shares|ADSs?)[^.\n]{0,160}?(?:for|in exchange for)\s+each[^.\n]{0,100}?(?:share|ADS|ordinary share|common share))/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = compactText(match[1]);
    if (isExchangeRatioNoise(value)) continue;
    return {
      value,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function isExchangeRatioNoise(value: string) {
  const normalized = compactText(value);
  if (!/^\d+(?:\.\d+)?\b/.test(normalized)) return true;
  if (/\b(?:vote|voting|registered holder|holder of record|CVR|contingent value right)\b/i.test(normalized)) return true;
  return false;
}

function findBoardRecommendation(text: string): SecTenderField<string> | null {
  if (/\brecommends? that stockholders tender\b/i.test(text)) {
    return field("recommend_tender", text, /\brecommends? that stockholders tender\b/i, "high");
  }
  if (/\brecommends? that stockholders reject\b/i.test(text)) {
    return field("recommend_reject", text, /\brecommends? that stockholders reject\b/i, "high");
  }
  if (/\bno recommendation\b|\bexpresses no opinion\b/i.test(text)) {
    return field("no_recommendation", text, /\bno recommendation\b|\bexpresses no opinion\b/i, "high");
  }
  return null;
}

function findMoneyField(text: string, patterns: RegExp[]): SecTenderMoneyField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = match[1].trim();
    return {
      value: normalizeMoney(valueText),
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findPriceField(text: string, patterns: RegExp[]): SecTenderPriceField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = match[1].trim();
    return {
      value: {
        price: normalizePrice(valueText),
        currency: valueText.includes("$") ? "USD" : null,
      },
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findShareCountField(text: string, patterns: RegExp[]): SecTenderField<{ count: number | null; text: string }> | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = compactText(match[1]);
    return {
      value: {
        count: normalizeNumber(valueText),
        text: valueText,
      },
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findPercentField(text: string, patterns: RegExp[]): SecTenderField<number> | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace("%", ""));
    if (!Number.isFinite(value)) continue;
    return {
      value,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findDateField(text: string, patterns: RegExp[]): SecTenderDateField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = compactText(match[1]);
    return {
      value: {
        date: normalizeDateText(valueText),
        text: valueText,
      },
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function extractTenderDates(text: string) {
  const expiration = findDateTimeField(text, [
    new RegExp(`\\b(?:extended|extension)[\\s\\S]{0,260}?\\bto\\b[\\s\\S]{0,220}?\\bon\\s+(${DATE_TEXT})`, "i"),
    new RegExp(`\\b(?:will\\s+)?expire[\\s\\S]{0,260}?\\bon\\s+(${DATE_TEXT})`, "i"),
    new RegExp(`\\bexpires?\\s+(?:at[\\s\\S]{0,180}?\\bon\\s+)?(${DATE_TEXT})`, "i"),
    new RegExp(`\\b(?:offer|tender offer)\\s+(?:will\\s+)?expire[\\s\\S]{0,260}?(${DATE_TEXT})`, "i"),
    new RegExp(`\\bexpiration date(?: is|:)?[\\s\\S]{0,160}?(${DATE_TEXT})`, "i"),
  ]);
  const extension = findDateTimeField(text, [new RegExp(`\\b(?:extended|extension)[\\s\\S]{0,220}?\\bto\\b[\\s\\S]{0,180}?(${DATE_TEXT})`, "i")]);
  const commencement = findDateTimeField(text, [new RegExp(`\\b(?:commenced|commencement date|offer commenced)[\\s\\S]{0,180}?(${DATE_TEXT})`, "i")]);
  const acceptedPayment = findDateTimeField(text, [new RegExp(`\\b(?:accepted for payment|payment)[\\s\\S]{0,180}?(${DATE_TEXT})`, "i")]);
  const warnings: string[] = [];
  return {
    expiration_date: expiration?.date || null,
    expiration_time: expiration?.time || null,
    extension_date: extension?.date || null,
    extension_time: extension?.time || null,
    commencement_date: commencement?.date || null,
    acceptance_or_payment_date: acceptedPayment?.date || null,
    warnings,
  };
}

function findDateTimeField(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const evidence = pickEvidenceSentence(text, match.index || 0);
    if (isDateEvidenceNoise(evidence)) continue;
    const valueText = compactText(match[1]);
    return {
      date: {
        value: {
          date: normalizeDateText(valueText),
          text: valueText,
        },
        evidence,
        confidence: "medium" as const,
      },
      time: extractTimeField(evidence),
    };
  }
  return null;
}

function extractTimeField(evidence: string): SecTenderField<string> | null {
  const match = evidence.match(/\b(?:one minute after\s+)?(?:\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|AM|PM)|12:00\s+midnight)[^,.;\n]{0,80}?(?:Eastern Time|Eastern time|New York City time|Pacific Time|Central Time)?/i);
  if (!match?.[0]) return null;
  return {
    value: compactText(match[0]),
    evidence: truncate(evidence, 260),
    confidence: "medium",
  };
}

function isDateEvidenceNoise(evidence: string) {
  return /\b(?:signature|signed|dated as of|agreement dated|merger agreement dated|press release dated|filed with the SEC on)\b/i.test(evidence);
}

function findSentenceField(text: string, pattern: RegExp): SecTenderField<string> | null {
  const match = text.match(pattern);
  if (!match) return null;
  const evidence = pickEvidenceSentence(text, match.index || 0);
  return {
    value: evidence,
    evidence,
    confidence: "medium",
  };
}

function findNarrativeSentenceField(text: string, pattern: RegExp): SecTenderField<string> | null {
  const match = text.match(pattern);
  if (!match) return null;
  const evidence = pickEvidenceSentence(text, match.index || 0);
  if (isCoverCheckboxInstructionEvidence(evidence)) return null;
  return {
    value: evidence,
    evidence,
    confidence: "medium",
  };
}

function extractTenderConditionSignals(text: string) {
  const noFinancing = findSentenceField(text, /\b(?:not subject to|no)\s+(?:a\s+|any\s+)?financing condition\b/i);
  const financing = noFinancing ? null : findSentenceField(text, /\b(?:financing condition|subject to financing)\b/i);
  return {
    minimum_tender_condition: findSentenceField(text, /\b(?:minimum tender condition|minimum condition|majority of the outstanding)\b/i),
    majority_of_minority_condition: findSentenceField(text, /\b(?:majority of (?:the )?(?:minority|unaffiliated)|unaffiliated security holders)\b/i),
    financing_condition: financing,
    no_financing_condition: noFinancing,
    regulatory_antitrust_condition: findSentenceField(text, /\b(?:regulatory approval|antitrust approval|competition approval)\b/i),
    hsr_condition: findSentenceField(text, /\b(?:HSR Act|Hart-Scott-Rodino)\b/i),
    no_mae_condition: findSentenceField(text, /\b(?:material adverse effect|MAE)\b/i),
    condition_waiver: findActualConditionWaiver(text),
    condition_satisfaction: findSentenceField(text, /\b(?:minimum condition|financing condition|condition)[^.\n]{0,120}\b(?:has been satisfied|was satisfied|satisfied)\b/i),
    withdrawal_rights: findSentenceField(text, /\b(?:withdrawal rights|may withdraw|right to withdraw)\b/i),
    proration_or_oversubscription: findSentenceField(text, /\b(?:prorat(?:e|ion|ed)|oversubscri(?:bed|ption))\b/i),
    subsequent_offering_period: findSentenceField(text, /\bsubsequent offering period\b/i),
  };
}

function findActualConditionWaiver(text: string) {
  const pattern = /\b(?:waived|has waived|will waive)[^.\n]{0,140}\b(?:condition|minimum tender|financing)\b/i;
  const match = text.match(pattern);
  if (!match) return null;
  const matchedText = match[0] || "";
  if (/\b(?:may|could|right to|reserve(?:s)? the right to)\s+waive\b/i.test(matchedText)) return null;
  return {
    value: pickEvidenceSentence(text, match.index || 0),
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function extractFinalResults(text: string) {
  const sharesTendered = findShareCountField(text, [
    /\b(\d[\d,.]*\s+(?:ordinary shares|common shares|American Depositary Shares|ADSs|shares))[\s\S]{0,220}?tendered(?:\s+and\s+not\s+withdrawn)?\b/i,
    /\b(?:depositary has advised|preliminary results)[^.\n]{0,160}?(\d[\d,.]*\s+(?:shares|ordinary shares|common shares|ADSs|American Depositary Shares))\s+(?:were\s+)?(?:validly\s+)?tendered\b/i,
  ]);
  const accepted = findShareCountField(text, [
    /\b(?:accepted for payment|accepted)[^.\n]{0,160}?(\d[\d,.]*\s+(?:shares|ordinary shares|common shares|ADSs|American Depositary Shares))\b/i,
    /\b(\d[\d,.]*\s+(?:shares|ordinary shares|common shares|ADSs|American Depositary Shares))\s+(?:were\s+)?accepted for payment\b/i,
  ]);
  const percentTendered = findPercentField(text, [
    /\b(\d+(?:\.\d+)?%)\s+of\s+(?:the\s+)?(?:outstanding|issued)[^.\n]{0,100}?(?:were\s+)?(?:validly\s+)?tendered\b/i,
    /\btendered[^.\n]{0,120}?(\d+(?:\.\d+)?)%\s+of\s+(?:the\s+)?(?:outstanding|issued)\b/i,
  ]);
  const prorationFactor = findPercentField(text, [/\b(?:final\s+)?proration factor[^.\n]{0,80}?(\d+(?:\.\d+)?%)/i]);
  const completed = findSentenceField(text, /\b(?:offer expired|offer was completed|transaction was completed|merger was completed|short-form merger was completed)\b/i);
  const terminated = findSentenceField(text, /\boffer (?:was )?terminated\b/i);
  const warnings: string[] = [];
  return {
    shares_tendered: sharesTendered,
    percentage_tendered: percentTendered,
    shares_accepted_for_payment: accepted,
    final_proration_factor: prorationFactor,
    completed_or_expired: completed,
    terminated,
    warnings,
  };
}

function extractSchedule13e3Flags(text: string, headingSections: SecTenderHeadingSection[]) {
  const headingField = (key: string) => {
    const section = headingSections.find((item) => item.key === key);
    return section
      ? {
          value: true,
          evidence: section.evidence,
          confidence: "medium" as const,
        }
      : null;
  };
  return {
    special_factors: headingField("special_factors"),
    purpose_alternatives_reasons_effects: headingField("purpose_alternatives_reasons_effects"),
    fairness_of_transaction: headingField("fairness_of_transaction"),
    reports_opinions_appraisals: headingField("reports_opinions_appraisals"),
    unaffiliated_security_holders: findSentenceField(text, /\bunaffiliated security holders?\b/i),
    special_committee: findSentenceField(text, /\bspecial committee\b/i),
    majority_of_minority_condition: findSentenceField(text, /\bmajority of (?:the )?(?:minority|unaffiliated)\b/i),
    fairness_opinion: findSentenceField(text, /\bfairness opinion\b/i),
    source_and_amount_of_funds: headingField("source_and_amount_of_funds"),
    delisting_deregistration_going_private: findSentenceField(text, /\b(?:delist(?:ing)?|deregister|deregistration|going private|squeeze[- ]out)\b/i),
  };
}

function isCoverCheckboxInstructionEvidence(evidence: string) {
  return (
    /\bCheck the (?:appropriate|following) box/i.test(evidence) ||
    checkedCheckboxPattern.test(evidence) ||
    uncheckedCheckboxPattern.test(evidence) ||
    /\|\s*(?:issuer tender offer|third-party tender offer|going private transaction|Rule 13e-4|Rule 14d-1)/i.test(evidence)
  );
}

function field(
  value: string,
  text: string,
  pattern: RegExp,
  confidence: SecTenderField<string>["confidence"],
): SecTenderField<string> | null {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence,
  };
}

function isTenderField<T>(value: SecTenderField<T> | null): value is SecTenderField<T> {
  return value !== null;
}

function normalizeMoney(value: string) {
  const text = stringValue(value);
  const currency: "USD" | null = text.includes("$") ? "USD" : null;
  const match = text.match(/\$?\s*([\d,.]+)/);
  if (!match?.[1]) {
    return { amount: null, currency, scale: null };
  }
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) {
    return { amount: null, currency, scale: null };
  }
  const scale = readScale(text);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: base * multiplier,
    currency,
    scale,
  };
}

function normalizePrice(value: string) {
  const match = stringValue(value).match(/\$?\s*([\d,.]+)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumber(value: string) {
  const match = stringValue(value).match(/(\d[\d,.]*)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateText(value: string) {
  const parsed = Date.parse(`${value} UTC`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function readScale(value: string): SecTenderMoneyField["value"]["scale"] {
  if (/\bb(?:illion|n)?\b/i.test(value)) return "billion";
  if (/\bm(?:illion)?\b/i.test(value)) return "million";
  if (/\bthousand\b/i.test(value)) return "thousand";
  return "raw";
}

function extractAmendmentExcerpt(text: string) {
  const amendmentIndex = text.search(/\b(?:Amendment\s+No\.?\s*\d+|Explanatory Note|Introductory Statement)\b/i);
  if (amendmentIndex < 0) return truncate(text, 1_500);
  return truncate(text.slice(amendmentIndex, amendmentIndex + 2_500), 1_500);
}

function extractPrimaryText(combinedText: string, formType: string | null) {
  if (!combinedText || !formType) return combinedText;
  if (/^CB(?:\/A)?$/i.test(formType)) {
    const cbMatch = combinedText.match(/(?:^|\n)\s*(?:###\s*)?(?:FORM\s+)?CB(?:\/A)?\s*(?:\n|$)/i);
    if (!cbMatch || cbMatch.index === undefined) return combinedText;
    const next = combinedText.indexOf("\n\n### ", cbMatch.index + cbMatch[0].length);
    return compactText(next > cbMatch.index ? combinedText.slice(cbMatch.index, next) : combinedText.slice(cbMatch.index));
  }
  const escaped = escapeRegExp(formType.replace("13E3", "13E-3"));
  const headingPattern = new RegExp(`(?:^|\\n)\\s*(?:###\\s*)?${escaped}\\b`, "i");
  const match = combinedText.match(headingPattern);
  if (!match || match.index === undefined) return combinedText;
  const next = combinedText.indexOf("\n\n### ", match.index + match[0].length);
  return compactText(next > match.index ? combinedText.slice(match.index, next) : combinedText.slice(match.index));
}

function readAttachmentTexts(input: SecTenderParseInput, rawPayload: Record<string, unknown>) {
  if (Array.isArray(input.attachmentTexts)) return input.attachmentTexts;
  const rawAttachmentTexts = recordArray(rawPayload.attachment_texts);
  return rawAttachmentTexts.map((item): SecTenderAttachmentText => {
    return {
      type: nullableString(item.type),
      description: nullableString(item.description),
      text: nullableString(item.text),
    };
  });
}

function buildSourcePackage({
  accessionNumber,
  attachmentSummaries,
  targetedAttachmentSourceBlocks,
  attachmentText,
  combinedText,
  documentSummaries,
  formType,
  input,
  metadata,
  primaryText,
  rawPayload,
}: {
  accessionNumber: string | null;
  attachmentSummaries: Array<Record<string, unknown>>;
  targetedAttachmentSourceBlocks: Array<Record<string, unknown>>;
  attachmentText: string;
  combinedText: string;
  documentSummaries: SecTenderDocumentSummary[];
  formType: string | null;
  input: SecTenderParseInput;
  metadata: Record<string, unknown>;
  primaryText: string;
  rawPayload: Record<string, unknown>;
}) {
  const primaryDocuments = documentSummaries.filter((document) => document.is_primary || document.role === "primary_form");
  const exhibitDocuments = documentSummaries.filter((document) => document.role !== "primary_form" && document.role !== "graphic");
  const fetchWarnings = buildSourceFetchWarnings({
    attachmentCount: attachmentSummaries.length,
    documentSummaries,
    primaryText,
  });
  const sourceNoise = buildSourceNoiseSummary({
    attachmentSummaries,
    attachmentText,
    combinedText,
    documentSummaries,
    primaryText,
  });
  const rawDataAudit = buildRawDataAudit({
    attachmentSummaries,
    documentSummaries,
    fetchWarnings,
    primaryText,
    sourceNoise,
  });

  return {
    accession_number: accessionNumber,
    source_url: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
    form_type: formType,
    company_name:
      nullableString(rawPayload.company_name) ||
      nullableString(rawPayload.issuer) ||
      nullableString(metadata.company_name) ||
      nullableString(metadata.issuer),
    ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
    exchange: nullableString(rawPayload.exchange) || nullableString(metadata.exchange),
    documents: documentSummaries,
    document_counts: {
      total: documentSummaries.length,
      primary: primaryDocuments.length,
      exhibits: exhibitDocuments.length,
      graphics: documentSummaries.filter((document) => document.role === "graphic").length,
      with_text: documentSummaries.filter((document) => document.text_available).length,
      truncated: documentSummaries.filter((document) => document.text_truncated).length,
      fetch_errors: documentSummaries.filter((document) => Boolean(document.fetch_error)).length,
    },
    attachment_texts: attachmentSummaries,
    targeted_source_blocks: targetedAttachmentSourceBlocks,
    raw_data_audit: rawDataAudit,
    source_noise: sourceNoise,
    text: {
      body_chars: stringValue(input.bodyText).length,
      analysis_chars: stringValue(input.analysisText).length,
      primary_chars: primaryText.length,
      attachment_chars: attachmentText.length,
      combined_chars: combinedText.length,
      primary_excerpt: truncate(primaryText, 900) || null,
      attachment_excerpt: truncate(attachmentText, 900) || null,
    },
    fetch_warnings: fetchWarnings,
  };
}

function buildTargetedAttachmentSourceBlocks(attachmentTexts: SecTenderAttachmentText[]) {
  const patterns = [
    {
      label: "Unaffected / Reference Market Price",
      pattern:
        /\b(?:unaffected\s+(?:closing\s+)?price|last\s+full\s+(?:trading\s+day|day\s+of\s+trading)[\s\S]{0,500}(?:before|prior\s+to)[\s\S]{0,320}(?:public\s+announcement|announcement\s+of\s+the\s+(?:transaction|offer|merger)|merger\s+agreement)|closing\s+(?:sale\s+)?price[\s\S]{0,280}(?:before|prior\s+to)[\s\S]{0,280}(?:public\s+announcement|announcement\s+of\s+the\s+(?:transaction|offer|merger)))\b/i,
    },
  ];
  const blocks: Array<Record<string, unknown>> = [];
  for (const attachment of attachmentTexts.slice(0, 12)) {
    const text = compactText(stringValue(attachment.text));
    if (!text) continue;
    for (const target of patterns) {
      const match = target.pattern.exec(text);
      if (!match || match.index === undefined) continue;
      blocks.push({
        block_type: "tender_attachment_section",
        label: target.label,
        source: nullableString(attachment.description) || nullableString(attachment.type) || "Tender attachment",
        text: contextPreservingSourceWindow(text, match.index, match[0].length, 3_600),
      });
    }
  }
  return blocks.slice(0, 4);
}

function contextPreservingSourceWindow(text: string, matchIndex: number, matchLength: number, maxChars: number) {
  const preferredStart = Math.max(0, matchIndex - 1_100);
  const preferredEnd = Math.min(text.length, matchIndex + matchLength + 2_200);
  const paragraphStart = text.lastIndexOf("\n\n", preferredStart);
  const paragraphEnd = text.indexOf("\n\n", preferredEnd);
  const start = paragraphStart >= 0 ? paragraphStart + 2 : preferredStart;
  const end = paragraphEnd >= 0 ? paragraphEnd : preferredEnd;
  const candidate = text.slice(start, end);
  if (candidate.length <= maxChars) return compactText(candidate);

  const centeredStart = Math.max(0, matchIndex - Math.floor(maxChars * 0.4));
  const centeredEnd = Math.min(text.length, centeredStart + maxChars);
  const sentenceStart = Math.max(text.lastIndexOf(". ", centeredStart), text.lastIndexOf("\n", centeredStart));
  const sentenceEnd = text.indexOf(". ", centeredEnd);
  return compactText(text.slice(sentenceStart >= 0 ? sentenceStart + 2 : centeredStart, sentenceEnd >= 0 ? sentenceEnd + 1 : centeredEnd));
}

function buildSourceFetchWarnings({
  attachmentCount,
  documentSummaries,
  primaryText,
}: {
  attachmentCount: number;
  documentSummaries: SecTenderDocumentSummary[];
  primaryText: string;
}) {
  const warnings: string[] = [];
  if (documentSummaries.length === 0) warnings.push("no_document_inventory");
  if (!documentSummaries.some((document) => document.is_primary || document.role === "primary_form")) {
    warnings.push("primary_document_not_identified");
  }
  if (!primaryText) warnings.push("primary_text_not_available");
  if (documentSummaries.some((document) => document.text_truncated)) warnings.push("document_text_truncated");
  if (documentSummaries.some((document) => Boolean(document.fetch_error))) warnings.push("document_fetch_error");
  if (documentSummaries.some((document) => document.role !== "primary_form" && document.role !== "graphic") && attachmentCount === 0) {
    warnings.push("exhibits_present_without_attachment_text");
  }
  if (documentSummaries.some((document) => document.role === "filing_fee") && attachmentCount === 0) {
    warnings.push("filing_fee_document_present_without_attachment_text");
  }
  if (documentSummaries.some((document) => document.noise_flags.includes("ambiguous_document_role"))) {
    warnings.push("ambiguous_document_role");
  }
  return warnings;
}

function buildSourceNoiseSummary({
  attachmentSummaries,
  attachmentText,
  combinedText,
  documentSummaries,
  primaryText,
}: {
  attachmentSummaries: Array<Record<string, unknown>>;
  attachmentText: string;
  combinedText: string;
  documentSummaries: SecTenderDocumentSummary[];
  primaryText: string;
}) {
  const documentCountsByCategory = countByStringKey(documentSummaries, "noise_category");
  const documentCountsByRelevance = countByStringKey(documentSummaries, "llm_relevance");
  const attachmentCountsByCategory = countByStringKey(attachmentSummaries, "noise_category");
  const attachmentCountsByRelevance = countByStringKey(attachmentSummaries, "llm_relevance");
  const textNoise = buildTextNoiseCounts([primaryText, attachmentText].filter(Boolean).join("\n\n") || combinedText);
  const documentCount = documentSummaries.length;
  const graphicCount = documentCountsByCategory.graphic_asset || 0;
  const structuredCount = documentCountsByCategory.structured_data || 0;
  const filingFeeCount = documentCountsByCategory.filing_fee || 0;
  const genericExhibitCount = documentCountsByCategory.generic_exhibit || 0;
  const excludeCandidateCount = documentCountsByRelevance.exclude_candidate || 0;
  const flags = new Set<string>();

  if (graphicCount >= 10 || (documentCount > 0 && graphicCount / documentCount >= 0.4)) flags.add("graphic_asset_heavy");
  if (structuredCount > 0) flags.add("structured_data_present");
  if (filingFeeCount > 0) flags.add("filing_fee_present");
  if (genericExhibitCount >= 5) flags.add("generic_exhibit_heavy");
  if (documentCount >= 50) flags.add("large_document_inventory");
  if (excludeCandidateCount >= 10 || (documentCount > 0 && excludeCandidateCount / documentCount >= 0.4)) {
    flags.add("many_llm_exclude_candidates");
  }
  if (textNoise.html_tag_hits >= 5_000) flags.add("html_markup_heavy");
  if (textNoise.table_tag_hits >= 100) flags.add("table_markup_heavy");
  if (textNoise.inline_xbrl_hits > 0) flags.add("inline_xbrl_present");
  if (textNoise.script_tag_hits > 0) flags.add("script_tags_present");
  if (textNoise.forward_looking_hits > 0) flags.add("forward_looking_boilerplate_present");
  if (textNoise.no_offer_disclaimer_hits > 0) flags.add("no_offer_disclaimer_present");
  if (textNoise.incorporated_by_reference_hits > 0) flags.add("incorporated_by_reference_present");
  if (textNoise.filing_fee_table_hits > 0) flags.add("filing_fee_table_text_present");
  if (textNoise.fairness_or_banker_hits > 0) flags.add("fairness_or_banker_material_present");

  return {
    high_noise: flags.size > 0,
    flags: Array.from(flags).sort(),
    document_counts_by_noise_category: documentCountsByCategory,
    document_counts_by_llm_relevance: documentCountsByRelevance,
    attachment_counts_by_noise_category: attachmentCountsByCategory,
    attachment_counts_by_llm_relevance: attachmentCountsByRelevance,
    text_noise: textNoise,
    llm_guidance: {
      keep_raw_source_package: true,
      preferred_inputs: ["primary_form", "core", "supporting"],
      exclude_candidate_categories: ["graphic_asset", "structured_data"],
      review_before_excluding_categories: ["generic_exhibit"],
      low_priority_categories: ["filing_fee", "procedural_holder_form", "other"],
      note:
        "Noise classification is advisory. Keep raw source data available, prefer core/supporting text, and review generic exhibits before excluding them.",
    },
  };
}

function buildRawDataAudit({
  attachmentSummaries,
  documentSummaries,
  fetchWarnings,
  primaryText,
  sourceNoise,
}: {
  attachmentSummaries: Array<Record<string, unknown>>;
  documentSummaries: SecTenderDocumentSummary[];
  fetchWarnings: string[];
  primaryText: string;
  sourceNoise: Record<string, unknown>;
}) {
  const requiredChecks = [
    {
      key: "document_inventory",
      ok: documentSummaries.length > 0,
      evidence: `${documentSummaries.length} source document(s) inventoried.`,
    },
    {
      key: "primary_document",
      ok: documentSummaries.some((document) => document.is_primary || document.role === "primary_form"),
      evidence: documentSummaries.some((document) => document.is_primary || document.role === "primary_form")
        ? "Primary filing document identified."
        : "Primary filing document not identified.",
    },
    {
      key: "primary_text",
      ok: primaryText.length > 0,
      evidence: `${primaryText.length} primary text char(s) available.`,
    },
    {
      key: "exhibit_attachment_text",
      ok: !documentSummaries.some((document) => document.role !== "primary_form" && document.role !== "graphic") || attachmentSummaries.length > 0,
      evidence: `${attachmentSummaries.length} attachment text item(s) available for non-primary documents.`,
    },
  ];
  const missingRawData = requiredChecks.filter((check) => !check.ok).map((check) => check.key);
  const uselessRawDataCandidates = buildUselessRawDataCandidates(documentSummaries, sourceNoise);
  const reviewRawDataCandidates = buildReviewRawDataCandidates(documentSummaries, attachmentSummaries);
  const mustKeepRawData = buildMustKeepRawData(documentSummaries);

  return {
    status: missingRawData.length === 0 && fetchWarnings.length === 0 ? "raw_data_available" : "raw_data_incomplete_or_warned",
    required_checks: requiredChecks,
    missing_raw_data: missingRawData,
    fetch_warnings: fetchWarnings,
    must_keep_raw_data: mustKeepRawData,
    useless_raw_data_candidates: uselessRawDataCandidates,
    review_raw_data_candidates: reviewRawDataCandidates,
    parser_boundary:
      "Parser audit is limited to raw source availability, missing raw data, and noisy raw data candidates. Router and analysis LLM handle event routing and investor interpretation.",
  };
}

function buildMustKeepRawData(documentSummaries: SecTenderDocumentSummary[]) {
  const keepRoles = new Set([
    "primary_form",
    "offer_document",
    "home_jurisdiction_document",
    "proxy_statement",
    "recommendation_statement",
    "transaction_agreement",
    "financing_or_guaranty",
    "support_or_rollover_agreement",
    "fairness_or_presentation",
  ]);
  const keepDocuments = documentSummaries.filter((document) => keepRoles.has(document.role));
  const counts = keepDocuments.reduce<Record<string, number>>((acc, document) => {
    acc[document.role] = (acc[document.role] || 0) + 1;
    return acc;
  }, {});
  return {
    document_count: keepDocuments.length,
    roles_present: Object.keys(counts).sort(),
    counts_by_role: counts,
    documents: keepDocuments.map((document) => ({
      sequence: document.sequence,
      type: document.type,
      description: document.description,
      filename: document.filename,
      role: document.role,
      text_available: document.text_available,
      text_char_count: document.text_char_count,
    })),
  };
}

function buildUselessRawDataCandidates(documentSummaries: SecTenderDocumentSummary[], sourceNoise: Record<string, unknown>) {
  const uselessCategories = new Set(["graphic_asset", "structured_data", "filing_fee"]);
  const candidateDocuments = documentSummaries.filter((document) => uselessCategories.has(document.noise_category));
  const countsByCategory = candidateDocuments.reduce<Record<string, number>>((acc, document) => {
    acc[document.noise_category] = (acc[document.noise_category] || 0) + 1;
    return acc;
  }, {});
  return {
    document_count: candidateDocuments.length,
    counts_by_noise_category: countsByCategory,
    flags: Array.isArray(sourceNoise.flags) ? sourceNoise.flags : [],
    documents: candidateDocuments.slice(0, 50).map((document) => ({
      sequence: document.sequence,
      type: document.type,
      description: document.description,
      filename: document.filename,
      role: document.role,
      noise_category: document.noise_category,
      llm_relevance: document.llm_relevance,
      text_available: document.text_available,
      text_char_count: document.text_char_count,
    })),
    truncated: candidateDocuments.length > 50,
  };
}

function buildReviewRawDataCandidates(documentSummaries: SecTenderDocumentSummary[], attachmentSummaries: Array<Record<string, unknown>>) {
  const reviewDocuments = documentSummaries.filter((document) => {
    if (document.noise_category === "generic_exhibit") return true;
    return document.role === "other_exhibit" || document.role === "other";
  });
  const reviewAttachments = attachmentSummaries.filter((attachment) => {
    const category = nullableString(attachment.noise_category);
    const role = nullableString(attachment.role);
    const text = nullableString(attachment.text_excerpt) || "";
    if (category === "generic_exhibit" || role === "other_exhibit" || role === "other") return true;
    return isImportantRawTextCandidate(text);
  });
  const importantAttachmentCandidates = reviewAttachments.filter((attachment) =>
    isImportantRawTextCandidate(nullableString(attachment.text_excerpt) || ""),
  );

  return {
    document_count: reviewDocuments.length,
    attachment_count: reviewAttachments.length,
    important_attachment_candidate_count: importantAttachmentCandidates.length,
    reason:
      "Unclassified exhibits and attachments are review candidates, not discard candidates, because SEC exhibit labels can hide offer, fairness, agreement, or financing material.",
    documents: reviewDocuments.slice(0, 50).map((document) => ({
      sequence: document.sequence,
      type: document.type,
      description: document.description,
      filename: document.filename,
      role: document.role,
      noise_category: document.noise_category,
      llm_relevance: document.llm_relevance,
      text_available: document.text_available,
      text_char_count: document.text_char_count,
    })),
    attachments: reviewAttachments.slice(0, 50).map((attachment) => ({
      index: attachment.index,
      type: attachment.type,
      description: attachment.description,
      role: attachment.role,
      noise_category: attachment.noise_category,
      llm_relevance: attachment.llm_relevance,
      important_text_candidate: isImportantRawTextCandidate(nullableString(attachment.text_excerpt) || ""),
      text_char_count: attachment.text_char_count,
      text_excerpt: attachment.text_excerpt,
    })),
    truncated: reviewDocuments.length > 50 || reviewAttachments.length > 50,
  };
}

function isImportantRawTextCandidate(text: string) {
  return /\b(?:offer to purchase|offer to exchange|proxy statement|recommendation statement|fairness opinion|financial advisor|merger agreement|agreement and plan of merger|commitment letter|guaranty|guarantee|support agreement|voting agreement|rollover agreement)\b/i.test(
    text,
  );
}

function buildTextNoiseCounts(text: string) {
  return {
    html_tag_hits: countRegexMatches(text, /<\/?[a-z][^>]{0,120}>/gi),
    table_tag_hits: countRegexMatches(text, /<table\b/gi),
    inline_xbrl_hits: countRegexMatches(text, /\bix:/gi),
    style_attr_hits: countRegexMatches(text, /\bstyle\s*=/gi),
    script_tag_hits: countRegexMatches(text, /<script\b/gi),
    forward_looking_hits: countRegexMatches(text, /\bforward-looking statements?\b/gi),
    no_offer_disclaimer_hits: countRegexMatches(text, /\b(?:no offer|not an offer|solicitation)\b/gi),
    incorporated_by_reference_hits: countRegexMatches(text, /\bincorporated by reference\b/gi),
    filing_fee_table_hits: countRegexMatches(text, /\bcalculation of filing fee\b/gi),
    fairness_or_banker_hits: countRegexMatches(
      text,
      /\b(?:fairness opinion|financial advisor|Morgan Stanley|J\.P\. Morgan|Centerview|Goldman Sachs|Lazard)\b/gi,
    ),
  };
}

function countRegexMatches(text: string, pattern: RegExp) {
  const globalPattern = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  globalPattern.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(text))) {
    count += 1;
    if (match[0] === "") globalPattern.lastIndex += 1;
  }
  return count;
}

function countByStringKey(items: unknown[], key: string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const record = toRecord(item) || {};
    const value = nullableString(record[key]) || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function mapAttachmentSummary(attachment: SecTenderAttachmentText, index: number, formType: string | null) {
  const type = nullableString(attachment.type);
  const description = nullableString(attachment.description);
  const text = stringValue(attachment.text);
  const role = classifyTenderDocumentRole({
    type,
    description,
    filename: null,
    isPrimary: false,
    formType,
    text,
  });
  const noiseProfile = classifySourceNoise({
    type,
    description,
    filename: null,
    role,
    isPrimary: false,
    textCharCount: text.length,
    textAvailable: text.length > 0,
    textTruncated: false,
    fetchError: null,
  });
  return {
    index,
    type,
    description,
    role,
    noise_category: noiseProfile.category,
    llm_relevance: noiseProfile.llm_relevance,
    noise_flags: noiseProfile.flags,
    text_char_count: text.length,
    text_available: text.length > 0,
    text_excerpt: truncate(text, 700) || null,
  };
}

function mapDocumentSummary(document: SecTenderRawDocument, formType: string | null): SecTenderDocumentSummary {
  const type = nullableString(document.type);
  const description = nullableString(document.description);
  const filename = nullableString(document.filename) || nullableString(document.document) || nullableString(document.name);
  const textCharCount = numberValue(document.textCharCount);
  const isPrimary = Boolean(document.isPrimary);
  const text = nullableString(document.text);
  const role = classifyTenderDocumentRole({
    type,
    description,
    filename,
    isPrimary,
    formType,
    text,
  });
  const noiseProfile = classifySourceNoise({
    type,
    description,
    filename,
    role,
    isPrimary,
    textCharCount,
    textAvailable: textCharCount > 0,
    textTruncated: Boolean(document.textTruncated),
    fetchError: nullableString(document.fetchError),
  });
  return {
    sequence: numberValue(document.sequence) || numberValue(document.seq) || null,
    type,
    description,
    filename,
    role,
    noise_category: noiseProfile.category,
    llm_relevance: noiseProfile.llm_relevance,
    noise_flags: noiseProfile.flags,
    url_present: Boolean(nullableString(document.url)),
    is_primary: isPrimary,
    text_char_count: textCharCount,
    text_available: textCharCount > 0,
    text_truncated: Boolean(document.textTruncated),
    fetch_status: numberValue(document.fetchStatus) || null,
    fetch_error: nullableString(document.fetchError),
  };
}

function classifyTenderDocumentRole({
  description,
  filename,
  formType,
  isPrimary,
  text,
  type,
}: {
  description: string | null;
  filename: string | null;
  formType: string | null;
  isPrimary: boolean;
  text?: string | null;
  type: string | null;
}) {
  const metadataLabel = `${type || ""} ${description || ""} ${filename || ""}`;
  const firstPageLabel = truncate(text || "", 360);
  const label = `${metadataLabel} ${firstPageLabel}`;
  const metadataOrTitle = `${metadataLabel} ${firstPageTitle(firstPageLabel)}`;
  if (isPrimary || canonicalTenderFormType(type) || (formType && canonicalTenderFormType(type) === formType)) return "primary_form";
  if (/\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(metadataLabel)) return "filing_fee";
  if (/\b(?:GRAPHIC|\.jpe?g|\.png|\.gif|image_)\b/i.test(metadataLabel)) return "graphic";
  if (/\b(?:FORM F-X|APPOINTMENT OF AGENT FOR SERVICE OF PROCESS)\b/i.test(metadataOrTitle)) return "form_fx_related";
  if (/\b(?:ENGLISH TRANSLATION|ENGLISH SUMMARY)\b/i.test(metadataLabel)) return "english_translation_or_summary";
  if (/\bHOME JURISDICTION\b/i.test(metadataLabel)) return "home_jurisdiction_document";
  if (/\b(?:ENGLISH TRANSLATION|ENGLISH SUMMARY)\b/i.test(metadataOrTitle)) return "english_translation_or_summary";
  if (/\bHOME JURISDICTION\b/i.test(metadataOrTitle)) return "home_jurisdiction_document";
  if (/\b(?:SCHEDULE 14D-9|SOLICITATION\/RECOMMENDATION|RECOMMENDATION STATEMENT|TARGET RESPONSE|BOARD RECOMMENDATION)\b/i.test(metadataOrTitle)) {
    return "recommendation_statement";
  }
  if (/\b(?:MERGER AGREEMENT|AGREEMENT AND PLAN OF MERGER|TRANSACTION AGREEMENT|ARRANGEMENT AGREEMENT|IMPLEMENTATION AGREEMENT)\b/i.test(metadataOrTitle)) return "transaction_agreement";
  if (/\b(?:OFFER TO PURCHASE|OFFER TO EXCHANGE|PROSPECTUS|RIGHTS OFFERING|SUBSCRIPTION RIGHTS)\b/i.test(metadataLabel)) {
    return formType?.startsWith("CB") ? "home_jurisdiction_document" : "offer_document";
  }
  if (/\b(?:PRESS RELEASE|ANNOUNCEMENT)\b/i.test(metadataOrTitle)) return "press_release";
  if (/\b(?:OFFER TO PURCHASE|OFFER TO EXCHANGE|PROSPECTUS|RIGHTS OFFERING|SUBSCRIPTION RIGHTS)\b/i.test(metadataOrTitle)) {
    return formType?.startsWith("CB") ? "home_jurisdiction_document" : "offer_document";
  }
  if (/\bLETTER OF TRANSMITTAL\b/i.test(metadataOrTitle)) return "letter_of_transmittal";
  if (/\bNOTICE OF GUARANTEED DELIVERY\b/i.test(metadataOrTitle)) return "notice_of_guaranteed_delivery";
  if (/\b(?:NOTICE OF WITHDRAWAL|WITHDRAWAL FORM)\b/i.test(metadataOrTitle)) return "withdrawal_document";
  if (/\b(?:PROXY STATEMENT|INFORMATION STATEMENT)\b/i.test(metadataOrTitle)) return "proxy_statement";
  if (/\b(?:COMMITMENT LETTER|DEBT COMMITMENT|EQUITY COMMITMENT|GUARANTY|GUARANTEE)\b/i.test(metadataOrTitle)) {
    return "financing_or_guaranty";
  }
  if (/\b(?:DEALER MANAGER AGREEMENT|INFORMATION AGENT AGREEMENT|DEPOSITARY AGREEMENT)\b/i.test(metadataOrTitle)) return "dealer_manager_agreement";
  if (/\b(?:SUPPORT AGREEMENT|VOTING AGREEMENT|ROLLOVER|COOPERATION AGREEMENT)\b/i.test(metadataOrTitle)) return "support_or_rollover_agreement";
  if (/\b(?:FAIRNESS OPINION|OPINION OF|PRESENTATION OF|DISCUSSION MATERIALS|BANKER PRESENTATION|FINANCIAL ADVISOR PRESENTATION|MORGAN STANLEY|CENTERVIEW|J\.P\. MORGAN)\b/i.test(metadataOrTitle)) {
    return "fairness_or_presentation";
  }
  if (/^EX-/i.test(type || "") || /\bEXHIBIT\b/i.test(label)) return "other_exhibit";
  return "other";
}

function firstPageTitle(text: string) {
  return text
    .split(/\n| {2,}/)
    .map((line) => compactText(line))
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

function classifySourceNoise({
  description,
  fetchError,
  filename,
  isPrimary,
  role,
  textAvailable,
  textCharCount,
  textTruncated,
  type,
}: {
  description: string | null;
  fetchError: string | null;
  filename: string | null;
  isPrimary: boolean;
  role: string;
  textAvailable: boolean;
  textCharCount: number | null;
  textTruncated: boolean;
  type: string | null;
}): SecTenderNoiseProfile {
  const label = `${type || ""} ${description || ""} ${filename || ""}`;
  const flags = new Set<string>();
  if (!textAvailable) flags.add("no_text_available");
  if (textTruncated) flags.add("text_truncated");
  if (fetchError) flags.add("fetch_error");
  if ((textCharCount || 0) >= 1_000_000) flags.add("large_text_block");

  const structuredData = /\b(?:XML|JSON|ZIP)\b/i.test(type || "") || /\.(?:xml|json|zip)$/i.test(filename || "");
  if (structuredData) flags.add("structured_data_file");

  if (isPrimary || role === "primary_form") {
    return noiseProfile("core_filing", "core", flags, "Primary tender-family form.");
  }
  if (role === "graphic") {
    flags.add("graphic_or_image");
    return noiseProfile("graphic_asset", "exclude_candidate", flags, "Image or graphic asset, usually not useful as LLM text.");
  }
  if (structuredData) {
    return noiseProfile("structured_data", "exclude_candidate", flags, "Machine-readable archive artifact rather than narrative filing text.");
  }
  if (role === "filing_fee") {
    flags.add("filing_fee_table");
    return noiseProfile("filing_fee", "low", flags, "Filing fee table is procedural and usually not investor-interpretive.");
  }
  if (
    role === "offer_document" ||
    role === "home_jurisdiction_document" ||
    role === "english_translation_or_summary" ||
    role === "proxy_statement" ||
    role === "recommendation_statement"
  ) {
    return noiseProfile("offer_material", "core", flags, "Offer, proxy, recommendation, or home-jurisdiction document with core transaction terms.");
  }
  if (role === "transaction_agreement" || role === "financing_or_guaranty" || role === "support_or_rollover_agreement" || role === "dealer_manager_agreement") {
    return noiseProfile("transaction_material", "supporting", flags, "Transaction, financing, support, or rollover agreement with supporting deal context.");
  }
  if (role === "fairness_or_presentation") {
    flags.add("fairness_or_banker_context");
    return noiseProfile("fairness_material", "supporting", flags, "Fairness opinion or banker material can be useful but is often lengthy and repetitive.");
  }
  if (role === "letter_of_transmittal" || role === "notice_of_guaranteed_delivery" || role === "withdrawal_document") {
    flags.add("holder_mechanics");
    return noiseProfile("procedural_holder_form", "low", flags, "Holder instruction form, useful for mechanics but low priority for investor interpretation.");
  }
  if (role === "form_fx_related") {
    flags.add("service_of_process");
    return noiseProfile("procedural_holder_form", "low", flags, "Form F-X service-of-process material is procedural.");
  }
  if (role === "other_exhibit") {
    flags.add("unclassified_exhibit");
    if (/\b(?:offer|agreement|opinion|presentation|summary|circular|translation|commitment|recommendation|materials?)\b/i.test(label)) {
      flags.add("ambiguous_document_role");
    }
    return noiseProfile("generic_exhibit", "low", flags, "Exhibit not classified as core transaction material.");
  }
  return noiseProfile("other", "low", flags, "Unclassified document or attachment.");
}

function noiseProfile(
  category: SecTenderNoiseCategory,
  llmRelevance: SecTenderLlmRelevance,
  flags: Set<string>,
  reason: string,
): SecTenderNoiseProfile {
  return {
    category,
    llm_relevance: llmRelevance,
    flags: Array.from(flags).sort(),
    reason,
  };
}

function countExtractedFields(values: unknown[]) {
  return values.filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== "";
  }).length;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => compactText(value)).filter(Boolean)));
}

function pickEvidenceSentence(text: string, index: number) {
  const safeIndex = Math.max(0, index);
  const priorPeriod = text.lastIndexOf(".", safeIndex - 1);
  const priorBreak = text.lastIndexOf("\n", safeIndex - 1);
  const start = Math.max(0, priorPeriod, priorBreak);
  let end = text.indexOf(".", safeIndex + 1);
  if (end >= 0 && end - safeIndex < 60) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, safeIndex + 360);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 420);
}

function compactText(value: string) {
  return stringValue(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
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
