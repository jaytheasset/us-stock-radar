import type {
  SecFormAdapterAnalysisMode,
  SecFormAdapterDefinition,
  SecFormAdapterParseResult,
  SecFormAdapterRawItem,
} from "./secFormAdapter";

export type GenericSecFormAdapterResult<TKey extends string = string> = SecFormAdapterParseResult<TKey> & {
  hardParsers: Record<string, unknown>;
  s3Parsed: null;
  ownershipParsed: null;
};

export type CommonFormParserInput = ReturnType<typeof buildCommonFormParserInput>;

export function createGenericSecFormAdapter<TKey extends string>({
  key,
  parserGroup,
  forms,
  matches,
  parse,
  analysisMode = "generic_sec_analysis",
}: {
  key: TKey;
  parserGroup: string;
  forms: readonly string[];
  matches: (canonicalFormType: string) => boolean;
  parse: (input: CommonFormParserInput, rawItem: SecFormAdapterRawItem, formType: string | null) => unknown;
  analysisMode?: SecFormAdapterAnalysisMode;
}): SecFormAdapterDefinition<TKey, SecFormAdapterRawItem, GenericSecFormAdapterResult<TKey>> {
  return {
    key,
    parserGroup,
    forms,
    analysisMode,
    matches,
    parse: (rawItem, formType): GenericSecFormAdapterResult<TKey> => ({
      worker: {
        key,
        parserGroup,
        analysisMode,
      },
      hardParsers: {
        [parserGroup]: safelyRunFormParser(parserGroup, formType, () => parse(buildCommonFormParserInput(rawItem, formType), rawItem, formType)),
      },
      s3Parsed: null,
      ownershipParsed: null,
    }),
  };
}

export function safelyRunFormParser(parserGroup: string, formType: string | null, run: () => unknown) {
  try {
    return run();
  } catch (error) {
    return {
      parserVersion: "sec_form_parser_integration_error_v1",
      parserGroup,
      formType: stringValue(formType) || null,
      accessionNumber: null,
      isSupported: false,
      summary: null,
      facts: {},
      signals: [],
      calendarItems: [],
      warnings: [`Parser integration failed: ${error instanceof Error ? error.message : String(error)}`],
      raw: {
        parserIntegrationError: true,
      },
    };
  }
}

export function buildCommonFormParserInput(rawItem: SecFormAdapterRawItem, formType: string | null) {
  const rawPayload = toRecord(rawItem.raw_payload) || {};
  const metadata = toRecord(rawItem.metadata) || {};
  const bodyText = nullableString(rawItem.body_text);
  const analysisText = nullableString(rawItem.analysis_text);
  const attachments = buildParserAttachments(rawPayload);
  const filingText = buildParserFilingText(bodyText, analysisText, attachments);
  const primaryDocumentText = bodyText || analysisText || filingText || null;
  const accessionNumber =
    nullableString(rawPayload.accession_number) ||
    nullableString(rawPayload.accessionNumber) ||
    nullableString(metadata.accession_number) ||
    nullableString(rawItem.source_unique_id);
  const companyName =
    nullableString(rawPayload.company_name) ||
    nullableString(rawPayload.companyName) ||
    nullableString(metadata.company_name) ||
    nullableString(metadata.companyName) ||
    nullableString(metadata.issuer);
  const ticker =
    nullableString(rawPayload.ticker) ||
    nullableString(rawPayload.symbol) ||
    nullableString(metadata.ticker) ||
    nullableString(metadata.symbol);
  const exchange = nullableString(rawPayload.exchange) || nullableString(metadata.exchange);
  const marketContext = readParserMarketContext(rawPayload, metadata);
  const parentFilingContext =
    toRecord(rawPayload.parent_filing_context) ||
    toRecord(rawPayload.parentFilingContext) ||
    toRecord(metadata.parent_filing_context) ||
    toRecord(metadata.parentFilingContext);

  return {
    rawItemId: nullableString(rawItem.id),
    sourceUniqueId: nullableString(rawItem.source_unique_id),
    sourceUrl: nullableString(rawItem.source_url) || nullableString(rawPayload.detail_url) || nullableString(rawPayload.source_url),
    title: nullableString(rawItem.title),
    publishedAt: nullableString(rawItem.published_at),
    formType: stringValue(formType),
    accessionNumber,
    companyName,
    issuerName: companyName,
    primaryTicker: ticker,
    ticker,
    exchange,
    filedAt: nullableString(rawItem.published_at),
    primaryDocumentText,
    primaryDocumentType: stringValue(formType) || null,
    bodyText,
    analysisText,
    filingText,
    text: filingText,
    documents: recordArray(rawPayload.documents),
    attachment_texts: recordArray(rawPayload.attachment_texts),
    attachmentTexts: recordArray(rawPayload.attachment_texts),
    attachments,
    rawPayload: rawItem.raw_payload,
    metadata: rawItem.metadata,
    marketContext,
    market_context: marketContext,
    parentFilingContext,
  };
}

function buildParserAttachments(rawPayload: Record<string, unknown>) {
  return recordArray(rawPayload.attachment_texts).map((attachment, index) => {
    const type = nullableString(attachment.type) || nullableString(attachment.documentType);
    const description = nullableString(attachment.description);
    const filename = nullableString(attachment.filename) || nullableString(attachment.name);
    const label = filename || [type, description].filter(Boolean).join(" - ") || `attachment_${index + 1}`;
    return {
      name: label,
      filename: filename || undefined,
      type: type || undefined,
      documentType: type || undefined,
      description: description || undefined,
      url: nullableString(attachment.url) || undefined,
      text: stringValue(attachment.text),
      isPrimary: false,
    };
  });
}

function buildParserFilingText(bodyText: string | null, analysisText: string | null, attachments: Array<{ text: string }>) {
  const primaryText = bodyText || analysisText || "";
  const parts = [primaryText];
  for (const attachment of attachments) {
    if (attachment.text && !isAttachmentAlreadyIncluded(primaryText, attachment.text)) {
      parts.push(attachment.text);
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

function readParserMarketContext(rawPayload: Record<string, unknown>, metadata: Record<string, unknown>) {
  return (
    toRecord(rawPayload.market_context) ||
    toRecord(rawPayload.marketContext) ||
    toRecord(metadata.market_context) ||
    toRecord(metadata.marketContext) ||
    null
  );
}

function isAttachmentAlreadyIncluded(bodyText: string, attachmentText: string) {
  if (!bodyText || !attachmentText) return false;
  const normalizedBody = normalizeForInclusion(bodyText);
  const normalizedAttachment = normalizeForInclusion(attachmentText);
  if (!normalizedAttachment) return false;
  return normalizedBody.includes(normalizedAttachment.slice(0, Math.min(normalizedAttachment.length, 1000)));
}

function normalizeForInclusion(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function recordArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(toRecord(item)));
}

export function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
