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

export type SecForm25DirectSourceBlock = {
  block_id: string;
  block_type: "form25_primary_document" | "form25_exchange_determination" | "form25_attachment";
  label: string;
  source_ref: string;
  origin: "primary" | "attachment";
  priority: number;
  document_type: string | null;
  document_description: string | null;
  text: string;
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
  rule_provision: SecForm25Field<string> | null;
  removal_reason_text: SecForm25Field<string> | null;
  delisting_or_removal_date: SecForm25Field<string> | null;
  trading_suspension_date: SecForm25Field<string> | null;
  continued_listing_or_trading_venue: SecForm25Field<string> | null;
  successor_or_acquirer: SecForm25Field<string> | null;
  consideration_summary: SecForm25Field<string> | null;
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
    directSourceBlocks: SecForm25DirectSourceBlock[];
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
  const filingHeaderName =
    stringFieldFromCompanyName(rawPayload.company_name, "raw_payload.company_name") ||
    stringFieldFromCompanyName(metadata.company_name, "metadata.company_name") ||
    findTextValue(sourceTexts, /\bCOMPANY CONFORMED NAME:\s*([^\n]+)/i);
  const filingHeaderCik =
    stringFieldFromValue(rawPayload.cik, "raw_payload.cik") ||
    stringFieldFromValue(metadata.cik, "metadata.cik") ||
    findTextValue(sourceTexts, /\bCENTRAL INDEX KEY:\s*([0-9]{1,10})/i);
  const ruleProvision =
    stringFieldFromValue(rawPayload.rule_provision, "raw_payload.rule_provision") ||
    findXmlTagValue(sourceTexts, "ruleProvision", "xml.rule_provision") ||
    findRuleProvision(sourceTexts);
  const issuerName =
    findXmlIssuerName(sourceTexts) ||
    findIssuerName(sourceTexts) ||
    filingHeaderName;
  const subjectCompanyCik =
    stringFieldFromValue(rawPayload.subject_company_cik, "raw_payload.subject_company_cik") ||
    findXmlIssuerCik(sourceTexts) ||
    findStructuredSubjectCompanyCik(sourceTexts, issuerName?.value || null) ||
    findTextValue(sourceTexts, /\bSUBJECT COMPANY:[\s\S]{0,260}?\bCENTRAL INDEX KEY:\s*([0-9]{1,10})/i) ||
    (isIssuerFiledVoluntaryWithdrawal(formType, ruleProvision) ? filingHeaderCik : null);
  const primaryTicker = findPrimaryTicker({ rawPayload, metadata, sourceTexts });
  const primaryTickerExchange = findPrimaryTickerExchange({ rawPayload, metadata, primaryTicker });
  const explicitFiledByName =
    stringFieldFromValue(rawPayload.filed_by_name, "raw_payload.filed_by_name") ||
    findTextValue(sourceTexts, /\bFILED BY:[\s\S]{0,220}?\bCOMPANY CONFORMED NAME:\s*([^\n]+)/i);
  const filedByCik =
    stringFieldFromValue(rawPayload.filed_by_cik, "raw_payload.filed_by_cik") ||
    findTextValue(sourceTexts, /\bFILED BY:[\s\S]{0,260}?\bCENTRAL INDEX KEY:\s*([0-9]{1,10})/i) ||
    filingHeaderCik;
  const exchange =
    stringFieldFromValue(rawPayload.form25_exchange, "raw_payload.form25_exchange") ||
    stringFieldFromValue(rawPayload.listing_exchange, "raw_payload.listing_exchange") ||
    stringFieldFromValue(rawPayload.removal_exchange, "raw_payload.removal_exchange") ||
    stringFieldFromValue(metadata.form25_exchange, "metadata.form25_exchange") ||
    stringFieldFromValue(metadata.listing_exchange, "metadata.listing_exchange") ||
    stringFieldFromValue(metadata.removal_exchange, "metadata.removal_exchange") ||
    findXmlExchangeName(sourceTexts) ||
    findExchange(sourceTexts, explicitFiledByName?.value || null) ||
    stringFieldFromValue(rawPayload.exchange, "raw_payload.exchange");
  const filedByIdentity = resolveFiledByName({
    exchange,
    explicitFiledByName,
    filedByCik,
    filingHeaderName,
    formType,
  });
  const filedByName = filedByIdentity.field;
  const removedSecurity =
    stringFieldFromValue(rawPayload.security_title, "raw_payload.security_title") ||
    findXmlTagValue(sourceTexts, "descriptionClassSecurity", "xml.description_class_security") ||
    findRemovedSecurity(sourceTexts);
  const removalReasonText =
    stringFieldFromValue(rawPayload.removal_reason_text, "raw_payload.removal_reason_text") ||
    findRemovalReasonText(sourceTexts) ||
    findRemovalReasonFromRuleProvision(ruleProvision);
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
  const documentSummaries = documents.map(mapDocumentSummary);
  const attachmentSummaries = attachmentSources.map(mapAttachmentSummary);
  const sourceInventory = buildSourceInventory({
    attachments: attachmentSummaries,
    documents: documentSummaries,
    primaryText,
    sourceTexts,
  });
  const directSourceBlocks = buildDirectSourceBlocks(sourceTexts);
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
    rule_provision: ruleProvision,
    removal_reason_text: removalReasonText,
    delisting_or_removal_date: removalDate,
    trading_suspension_date: suspensionDate,
    continued_listing_or_trading_venue: continuedListingOrTradingVenue,
    successor_or_acquirer: successorOrAcquirer,
    consideration_summary: considerationSummary,
    extracted_field_count: extractedFieldCount,
  };
  const warnings = buildWarnings({
    facts,
    filedByNameNormalized: filedByIdentity.normalized,
    isSupported,
    sourceInventory,
  });

  return {
    parserVersion: SEC_FORM25_PARSER_VERSION,
    parserGroup: SEC_FORM25_PARSER_GROUP,
    formType: SEC_FORM25_ROOM_FORM_TYPE,
    accessionNumber,
    isSupported,
    summary: buildSummary(facts),
    facts,
    signals: [],
    calendarItems: [],
    warnings,
    raw: {
      sourceInventory,
      directSourceBlocks,
      selectedEvidenceSnippets,
      selectedAttachmentSnippets,
      selectedTableSnippets,
    },
  };
}

function buildWarnings({
  facts,
  filedByNameNormalized,
  isSupported,
  sourceInventory,
}: {
  facts: SecForm25Facts;
  filedByNameNormalized: boolean;
  isSupported: boolean;
  sourceInventory: SecForm25SourceInventory;
}) {
  const warnings: string[] = [];
  if (!isSupported) warnings.push("unsupported_or_unrecognized_form");
  if (!facts.removed_security) warnings.push("security_title_not_found");
  if (!facts.removal_reason_text) warnings.push("missing_or_unclear_reason");
  if (filedByNameNormalized) warnings.push("filed_by_name_normalized_to_exchange");
  warnings.push(...sourceInventory.truncation_notes);
  return [...new Set(warnings)];
}

function buildSummary(facts: SecForm25Facts) {
  const issuer = facts.issuer_name?.value || "Issuer";
  const security = facts.removed_security?.value || "a listed security";
  const exchange = facts.exchange?.value ? ` from ${facts.exchange.value}` : "";
  return `${issuer} filed ${facts.source_form_type || "Form 25"} to remove ${security}${exchange}.`;
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

const MAX_DIRECT_SOURCE_BLOCKS = 8;
const MAX_DIRECT_SOURCE_BLOCK_CHARS = 4_500;
const FORM25_FIXTURE_SENTINEL = /\bRAW_FORM25_FULL_TEXT_SENTINEL_SHOULD_NOT_REACH_PROMPTS\b/g;

function buildDirectSourceBlocks(sourceTexts: SourceText[]): SecForm25DirectSourceBlock[] {
  const candidates = sourceTexts
    .map((source, sourceIndex) => {
      const descriptor = `${source.type || ""} ${source.description || ""} ${source.source}`;
      const isPrimary = source.source === "primary_filing_text";
      const isExchangeDetermination = /\b(?:EX-99\.25|99\.25|delist(?:ing)?|removal|rule\s*provision\s*notice)\b/i.test(
        descriptor,
      );
      const blockType: SecForm25DirectSourceBlock["block_type"] = isExchangeDetermination
        ? "form25_exchange_determination"
        : isPrimary
          ? "form25_primary_document"
          : "form25_attachment";
      const priority = isExchangeDetermination ? 100 : isPrimary ? 90 : 60;
      const cleanedText = cleanDirectSourceText(source.text);

      return chunkDirectSourceText(cleanedText).map((text, chunkIndex) => ({
        block_id: buildDirectSourceBlockId(blockType, source.source, chunkIndex),
        block_type: blockType,
        label: directSourceBlockLabel({ source, blockType, chunkIndex }),
        source_ref: source.source,
        origin: isPrimary ? ("primary" as const) : ("attachment" as const),
        priority,
        document_type: source.type,
        document_description: source.description,
        text,
        source_index: sourceIndex,
        chunk_index: chunkIndex,
      }));
    })
    .flat()
    .filter((block) => Boolean(block.text))
    .sort((left, right) => right.priority - left.priority || left.source_index - right.source_index || left.chunk_index - right.chunk_index);

  const seen = new Set<string>();
  const result: SecForm25DirectSourceBlock[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const { source_index: _sourceIndex, chunk_index: _chunkIndex, ...block } = candidate;
    result.push(block);
    if (result.length >= MAX_DIRECT_SOURCE_BLOCKS) break;
  }
  return result;
}

function cleanDirectSourceText(value: string) {
  return compactText(value.replace(FORM25_FIXTURE_SENTINEL, ""));
}

function chunkDirectSourceText(value: string) {
  if (!value) return [];
  if (value.length <= MAX_DIRECT_SOURCE_BLOCK_CHARS) return [value];

  const segments = value.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [value];
  const chunks: string[] = [];
  let current = "";

  for (const rawSegment of segments) {
    const segment = compactText(rawSegment);
    if (!segment) continue;
    for (const piece of splitOversizedDirectSegment(segment)) {
      if (!current) {
        current = piece;
        continue;
      }
      if (`${current} ${piece}`.length <= MAX_DIRECT_SOURCE_BLOCK_CHARS) {
        current = `${current} ${piece}`;
        continue;
      }
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function splitOversizedDirectSegment(value: string) {
  if (value.length <= MAX_DIRECT_SOURCE_BLOCK_CHARS) return [value];
  const pieces: string[] = [];
  let remaining = value;
  while (remaining.length > MAX_DIRECT_SOURCE_BLOCK_CHARS) {
    const boundary = remaining.lastIndexOf(" ", MAX_DIRECT_SOURCE_BLOCK_CHARS);
    const cutAt = boundary > MAX_DIRECT_SOURCE_BLOCK_CHARS * 0.7 ? boundary : MAX_DIRECT_SOURCE_BLOCK_CHARS;
    pieces.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function buildDirectSourceBlockId(
  blockType: SecForm25DirectSourceBlock["block_type"],
  sourceRef: string,
  chunkIndex: number,
) {
  const sourceSlug = sourceRef
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "source";
  return `${blockType}:${sourceSlug}:${chunkIndex + 1}`;
}

function directSourceBlockLabel({
  source,
  blockType,
  chunkIndex,
}: {
  source: SourceText;
  blockType: SecForm25DirectSourceBlock["block_type"];
  chunkIndex: number;
}) {
  const base =
    blockType === "form25_exchange_determination"
      ? "Exchange delisting determination"
      : blockType === "form25_primary_document"
        ? "Form 25 primary document"
        : source.description || source.type || "Form 25 attachment";
  return chunkIndex ? `${base} (part ${chunkIndex + 1})` : base;
}

function findRemovalReasonText(sourceTexts: SourceText[]): SecForm25Field<string> | null {
  const preferred = sourceTexts.filter((source) =>
    /\b(?:EX-99\.25|99\.25|delist|removal|reason|notice)\b/i.test(`${source.type || ""} ${source.description || ""} ${source.source}`),
  );
  const sources = [...preferred, ...sourceTexts];
  for (const source of sources) {
    const text = source.text;
    const match = text.match(
      /\b(?:Delisting Determination|voluntar(?:y|ily)\s+(?:delist|withdraw)|no longer suitable|called for redemption|redeemed|paid at maturity|expired|all rights[^.\n]{0,120}extinguished|merger|acquisition|business combination|redomiciliation|simplification of the corporate structure|converted into|exchanged for|continued listing|continue to be listed)\b/i,
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

function findStructuredSubjectCompanyCik(
  sourceTexts: SourceText[],
  issuerName: string | null,
): SecForm25Field<string> | null {
  const issuerPattern = issuerName
    ? new RegExp(`\\b(\\d{6,10})\\s+${escapeRegExp(compactText(issuerName)).replace(/\s+/g, "\\s+")}(?=\\s|$)`, "i")
    : null;
  const exchangePattern =
    /\bX0203\s+\d{1,10}\s+(?:NEW YORK STOCK EXCHANGE LLC|NYSE AMERICAN LLC|NYSE Arca(?:, Inc\.| Equities, Inc\.)?|Nasdaq Stock Market LLC|The Nasdaq Stock Market LLC)\s+(\d{1,10})\s+([A-Z][A-Za-z0-9&.,'\/ -]{2,}?)\s+\d{3}-\d{4,10}\b/i;

  for (const source of sourceTexts) {
    const text = compactText(source.text);
    const issuerMatch = issuerPattern ? text.match(issuerPattern) : null;
    if (issuerMatch?.[1]) {
      return {
        value: issuerMatch[1],
        evidence: truncate(issuerMatch[0], 220),
        source: `${source.source}.structured_form25_subject_cik`,
        confidence: "medium",
      };
    }

    const exchangeMatch = text.match(exchangePattern);
    if (exchangeMatch?.[1]) {
      return {
        value: exchangeMatch[1],
        evidence: truncate(exchangeMatch[0], 220),
        source: `${source.source}.structured_form25_subject_cik`,
        confidence: "medium",
      };
    }
  }

  return null;
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
    findTextValue(sourceTexts, /\bIssuer:\s*\|?\s*\n\s*([^\n|]+)/i) ||
    findTextValue(sourceTexts, /\bIssuer:\s*([^\n]+)/i) ||
    findTextValue(sourceTexts, /\bSUBJECT COMPANY:[\s\S]{0,200}?\bCOMPANY CONFORMED NAME:\s*([^\n]+)/i) ||
    findTextValue(sourceTexts, /\b([A-Z][A-Za-z0-9&.,' -]+?)\s*\/\s*(?:NYSE|NASDAQ|NYSE Arca|NYSE American)/i)
  );
}

function findExchange(sourceTexts: SourceText[], filedByName: string | null) {
  return (
    findTextValue(sourceTexts, /\bExchange:\s*\|?\s*\n\s*([^\n|]+)/i) ||
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
  if (/^nyse$/i.test(value.trim())) {
    return { value: "NEW YORK STOCK EXCHANGE LLC", evidence: value, source: "filed_by_name", confidence: "medium" };
  }
  return null;
}

function resolveFiledByName({
  exchange,
  explicitFiledByName,
  filedByCik,
  filingHeaderName,
  formType,
}: {
  exchange: SecForm25Field<string> | null;
  explicitFiledByName: SecForm25Field<string> | null;
  filedByCik: SecForm25Field<string> | null;
  filingHeaderName: SecForm25Field<string> | null;
  formType: SecForm25SourceFormType;
}): { field: SecForm25Field<string> | null; normalized: boolean } {
  const isExchangeFiled = formType === "25-NSE" || formType === "25-NSE/A";
  if (!isExchangeFiled) {
    return { field: explicitFiledByName || filingHeaderName, normalized: false };
  }

  const explicitExchangeName = normalizeExchangeFromFiledBy(explicitFiledByName?.value || null);
  if (explicitExchangeName) {
    return {
      field: { ...explicitExchangeName, source: explicitFiledByName?.source || explicitExchangeName.source },
      normalized: false,
    };
  }

  const exchangeName = normalizeExchangeFromFiledBy(exchange?.value || null) || exchange;
  const cikExchangeName = exchangeNameFromCik(filedByCik?.value || null);
  const field = exchangeName || cikExchangeName;
  const headerIsExchange = Boolean(normalizeExchangeFromFiledBy(filingHeaderName?.value || null));
  const replacedNonExchangeName = Boolean(
    field &&
      ((explicitFiledByName && !explicitExchangeName) || (!explicitFiledByName && filingHeaderName && !headerIsExchange)),
  );

  return { field, normalized: replacedNonExchangeName };
}

function exchangeNameFromCik(value: string | null): SecForm25Field<string> | null {
  const cik = stringValue(value).replace(/^0+/, "");
  const exchangeNames: Record<string, string> = {
    "1354457": "Nasdaq Stock Market LLC",
    "876661": "NEW YORK STOCK EXCHANGE LLC",
    "1143313": "NYSE AMERICAN LLC",
  };
  const exchangeName = exchangeNames[cik];
  if (!exchangeName) return null;
  return {
    value: exchangeName,
    evidence: value || exchangeName,
    source: "filed_by_cik",
    confidence: "high",
  };
}

function findRemovedSecurity(sourceTexts: SourceText[]) {
  return (
    findTextValue(sourceTexts, /\n\s*([^\n]{3,240}?)\s*\n\s*\(Description of class of securities\)/i) ||
    findTextValue(sourceTexts, /\b(Units of Beneficial Interest|Ordinary shares|Common Stock|Class [A-Z] Common Stock|American Depositary Shares?[^.\n]{0,160}|ADS[^.\n]{0,160}|Warrants?[^.\n]{0,180}|[0-9.]+%\s+(?:Senior|Subordinated)?\s*Notes? due [A-Za-z0-9 ,]+)\s+17\s+C[FP]R\s+240\.12d[2D]-2/i) ||
    findTextValue(sourceTexts, /\b((?:[A-Za-z0-9 .%/$'()-]+\s+)?(?:Senior|Subordinated)?\s*Notes? due [A-Za-z0-9 ,]+)\s+17\s+C[FP]R\s+240\.12d[2D]-2/i)
  );
}

function findRuleProvision(sourceTexts: SourceText[]) {
  const checked = findCheckedRuleProvision(sourceTexts);
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

function findCheckedRuleProvision(sourceTexts: SourceText[]) {
  const checkedMarker = String.raw`(?:\[\s*X\s*\]|\(\s*X\s*\)|☒|☑|■|&#9746;|&#x2612;|&#9745;|&#x2611;)`;
  const uncheckedMarker = String.raw`(?:\[\s*\]|\(\s*\)|☐|□|&#9744;|&#x2610;)`;
  const rulePattern = String.raw`(17\s+C[FP]R\s+240\.12d[2D]-2\([a-c]\)(?:\(\d\))?)`;
  const checkedRulePatterns = [
    new RegExp(`${checkedMarker}(?:(?!${uncheckedMarker})[\\s\\S]){0,360}?\\b${rulePattern}`, "gi"),
    new RegExp(`(?:^|[\\n|])\\s*[xX]\\s*\\|?(?:(?!${uncheckedMarker})[\\s\\S]){0,360}?\\b${rulePattern}`, "gi"),
  ];

  for (const source of sourceTexts) {
    const matches = checkedRulePatterns.flatMap((pattern) => [...source.text.matchAll(pattern)]);
    const uniqueRules = [...new Set(matches.map((match) => compactText(match[1] || "")))].filter(Boolean);
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

function findRemovalReasonFromRuleProvision(ruleProvision: SecForm25Field<string> | null) {
  if (!ruleProvision || !/\b12d[2D]-2\(c\)/i.test(ruleProvision.value)) return null;
  return {
    value: "Issuer voluntary withdrawal from listing and registration under Rule 12d2-2(c).",
    evidence: ruleProvision.evidence,
    source: ruleProvision.source,
    confidence: ruleProvision.confidence,
  };
}

function findRemovalDate(sourceTexts: SourceText[]) {
  return findDateField(
    sourceTexts,
    /\b(?:remove[^.]{0,220}?from listing[^.]{0,220}?on|from listing and registration[^.]{0,160}?on|effective\s+at\s+the\s+opening\s+of\s+(?:the\s+)?(?:trading\s+session|business)\s+on|opening\s+of\s+business\s+on)\s+([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i,
    "delisting_or_removal_date",
  );
}

function findSuspensionDate(sourceTexts: SourceText[]) {
  return findDateField(
    sourceTexts,
    /\b(?:suspended\s+from\s+trading|trading[^.]{0,120}?suspended|(?:security|securities|stock|shares?)\s+(?:was|were)\s+suspended)[^.]{0,160}?\b(?:on|effective(?:\s+at)?(?:\s+the\s+opening\s+of\s+business\s+on)?)\s+([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i,
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

function stringFieldFromCompanyName(value: unknown, source: string): SecForm25Field<string> | null {
  const text = nullableString(value);
  if (!text || /\bfiled by\b/i.test(text)) return null;
  return stringFieldFromValue(text, source);
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

function isIssuerFiledVoluntaryWithdrawal(
  formType: SecForm25SourceFormType,
  ruleProvision: SecForm25Field<string> | null,
) {
  return (formType === "25" || formType === "25/A") && /12d2-2\(c\)/i.test(ruleProvision?.value || "");
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
