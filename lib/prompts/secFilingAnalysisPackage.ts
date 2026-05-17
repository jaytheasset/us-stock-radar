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
    const type = nullableString(attachment.type) || "Exhibit";
    const description = nullableString(attachment.description);
    const label = description ? `${type} - ${description}` : type;
    pushSection(label, stringValue(attachment.text), Math.min(maxDocumentChars, Math.max(4_000, remaining)));
  }

  return sections;
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
