import { parseSecS3Filing } from "@/lib/sources/sec/s3Parser";

export const SEC_FILING_PACKAGE_VERSION = "sec_filing_package_v1";

export type SecFilingPackageOptions = {
  maxChars?: number;
  maxDocumentChars?: number;
};

type RawItemRow = {
  id?: unknown;
  source_code?: unknown;
  source_group?: unknown;
  source_unique_id?: unknown;
  source_url?: unknown;
  title?: unknown;
  published_at?: unknown;
  body_text?: unknown;
  analysis_text?: unknown;
  raw_payload?: unknown;
  metadata?: unknown;
};

type DocumentPayload = {
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
  url?: unknown;
  text?: unknown;
};

export function buildSecFilingAnalysisPackage(rawItem: RawItemRow, options: SecFilingPackageOptions = {}) {
  const rawPayload = toRecord(rawItem.raw_payload) || {};
  const metadata = toRecord(rawItem.metadata) || {};
  const documents = recordArray(rawPayload.documents) as DocumentPayload[];
  const attachmentTexts = recordArray(rawPayload.attachment_texts) as AttachmentTextPayload[];
  const bodyText = stringValue(rawItem.analysis_text) || stringValue(rawItem.body_text);
  const maxChars = clampInt(options.maxChars ?? 60_000, 10_000, 180_000);
  const maxDocumentChars = clampInt(options.maxDocumentChars ?? 24_000, 4_000, 80_000);

  const primaryDocumentUrl =
    nullableString(rawPayload.primary_document_url) ||
    nullableString(metadata.primary_document_url) ||
    documents.find((document) => Boolean(document.isPrimary))?.url ||
    null;
  const formType = nullableString(rawPayload.form_type) || nullableString(metadata.form_type);
  const hardParsers = buildHardParserFacts(rawItem, formType);
  const packageDocuments = documents.map((document) => ({
    type: nullableString(document.type),
    description: nullableString(document.description),
    url: nullableString(document.url),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
    fetch_status: numberValue(document.fetchStatus) || null,
    fetch_error: nullableString(document.fetchError),
  }));

  const sections = buildTextSections({
    bodyText,
    attachmentTexts,
    maxChars,
    maxDocumentChars,
  });
  const llmText = sections.map((section) => `### ${section.label}\n${section.text}`).join("\n\n").trim();

  return {
    package_version: SEC_FILING_PACKAGE_VERSION,
    source_group: "filings",
    source_code: "sec_edgar",
    raw_item_id: nullableString(rawItem.id),
    source_unique_id: nullableString(rawItem.source_unique_id),
    accession_number: nullableString(rawPayload.accession_number) || nullableString(rawItem.source_unique_id),
    cik: nullableString(rawPayload.cik) || nullableString(metadata.cik),
    company_name: nullableString(rawPayload.company_name) || nullableString(metadata.company_name),
    primary_ticker: {
      ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
      exchange: nullableString(rawPayload.exchange) || nullableString(metadata.exchange),
    },
    tickers: Array.isArray(rawPayload.tickers) ? rawPayload.tickers : [],
    form_type: formType,
    form_family: classifySecFormFamily(formType),
    hard_parsers: hardParsers,
    filed_at: nullableString(rawItem.published_at),
    title: nullableString(rawItem.title),
    filing_detail_url: nullableString(rawItem.source_url),
    primary_document_url: nullableString(primaryDocumentUrl),
    documents: packageDocuments,
    llm_text: llmText,
    package_stats: {
      max_chars: maxChars,
      max_document_chars: maxDocumentChars,
      source_body_chars: bodyText.length,
      included_chars: llmText.length,
      truncated: bodyText.length > maxDocumentChars || sections.some((section) => section.truncated),
      document_count: documents.length,
      attachment_text_count: attachmentTexts.length,
      included_sections: sections.map((section) => ({
        label: section.label,
        chars: section.text.length,
        truncated: section.truncated,
      })),
    },
  };
}

export function classifySecFormFamily(formType: string | null) {
  const form = stringValue(formType).toUpperCase();
  if (!form) return "unknown";
  if (form === "8-K" || form === "8-K/A") return "current_report";
  if (form === "6-K" || form === "6-K/A") return "foreign_current_report";
  if (form.startsWith("10-Q") || form.startsWith("10-K") || form.startsWith("20-F")) return "periodic_report";
  if (form.startsWith("S-") || form.startsWith("F-") || form.startsWith("424B")) return "registration_offering";
  if (form.includes("14A") || form.startsWith("SC 14")) return "proxy_shareholder";
  if (form === "4" || form === "4/A" || form === "3" || form === "5") return "ownership";
  if (form.startsWith("SC 13")) return "ownership";
  if (form.startsWith("SC TO") || form === "CB" || form === "CB/A") return "tender_offer";
  return "other";
}

function buildHardParserFacts(rawItem: RawItemRow, formType: string | null) {
  if (/^S-3(?:ASR|\/A)?$/i.test(stringValue(formType))) {
    const parsed = parseSecS3Filing({
      rawItemId: nullableString(rawItem.id),
      sourceUniqueId: nullableString(rawItem.source_unique_id),
      sourceUrl: nullableString(rawItem.source_url),
      title: nullableString(rawItem.title),
      publishedAt: nullableString(rawItem.published_at),
      bodyText: nullableString(rawItem.body_text),
      analysisText: nullableString(rawItem.analysis_text),
      rawPayload: rawItem.raw_payload,
      metadata: rawItem.metadata,
    });

    return {
      s3: {
        parser_version: parsed.parser_version,
        form_type: parsed.form_type,
        is_s3_family: parsed.is_s3_family,
        registration_statement_kind: parsed.registration_statement_kind?.value || null,
        registration_status: parsed.registration_status?.value || null,
        prospectus_status: parsed.prospectus_status?.value || null,
        primary_or_resale: parsed.primary_or_resale?.value || null,
        securities_registered: parsed.securities_registered.map((item) => item.value),
        shares_registered: parsed.shares_registered?.text || null,
        resale_share_count: parsed.resale_share_count?.text || null,
        current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
        selling_stockholders: {
          count: parsed.selling_stockholders.length,
          rows: parsed.selling_stockholders.map((holder) => ({
            holder_name: holder.holder_name,
            shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
            beneficially_owned_before: holder.beneficially_owned_before?.text || null,
            beneficially_owned_after: holder.beneficially_owned_after?.text || null,
            percent_after: holder.percent_after?.text || null,
          })),
        },
        fee_table: {
          present: parsed.fee_table.present,
          text_available: parsed.fee_table.text_available,
          row_count: parsed.fee_table.rows.length,
          total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
          net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
        },
        offering_terms: {
          registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
          offering_type: parsed.offering_terms.offering_type?.value || null,
          security_type: parsed.offering_terms.security_type?.value || null,
          primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
          offering_amount: parsed.offering_terms.offering_amount?.text || null,
          shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
          atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
          resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
          current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
          warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
          conversion_price: parsed.offering_terms.conversion_price?.text || null,
        },
        amendment: parsed.amendment.router_payload,
        needs_human_review: parsed.needs_human_review,
        review_reasons: parsed.review_reasons,
      },
    };
  }

  return {};
}
function buildTextSections({
  bodyText,
  attachmentTexts,
  maxChars,
  maxDocumentChars,
}: {
  bodyText: string;
  attachmentTexts: AttachmentTextPayload[];
  maxChars: number;
  maxDocumentChars: number;
}) {
  const sections: Array<{ label: string; text: string; truncated: boolean }> = [];
  let remaining = maxChars;

  const pushSection = (label: string, text: string, limit: number) => {
    if (!remaining || !text.trim()) return;
    const budget = Math.max(0, Math.min(remaining, limit));
    if (!budget) return;
    const cleaned = compactText(text);
    const truncated = cleaned.length > budget;
    const selected = truncated ? cleaned.slice(0, budget) : cleaned;
    sections.push({ label, text: selected.trim(), truncated });
    remaining -= selected.length;
  };

  pushSection("Primary Filing Text", bodyText, maxDocumentChars);

  for (const attachment of attachmentTexts) {
    if (remaining < 1_000) break;
    if (isAttachmentAlreadyIncluded(bodyText, stringValue(attachment.text))) continue;
    const type = nullableString(attachment.type) || "Exhibit";
    const description = nullableString(attachment.description);
    const label = description ? `${type} - ${description}` : type;
    pushSection(label, stringValue(attachment.text), Math.min(maxDocumentChars, Math.max(4_000, remaining)));
  }

  return sections;
}

function isAttachmentAlreadyIncluded(bodyText: string, attachmentText: string) {
  const body = compactComparableText(bodyText);
  const attachment = compactComparableText(attachmentText);
  if (!body || !attachment || attachment.length < 500) return false;
  return body.includes(attachment.slice(0, Math.min(1_000, attachment.length)));
}

function compactComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .split("\n")
    .filter((line) => !isXbrlNoiseLine(line))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function isXbrlNoiseLine(line: string) {
  const text = line.trim();
  if (!text) return false;
  if (/^(iso4217|xbrli|us-gaap|dei|srt|country|exch|stpr|naics):[A-Za-z0-9_.:-]+$/.test(text)) return true;
  if (/^(http|https):\/\/xbrl\./i.test(text)) return true;
  return false;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
