import { XMLParser } from "fast-xml-parser";
import { getServerEnv } from "@/lib/env";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_CURRENT_URL = `${SEC_BASE_URL}/cgi-bin/browse-edgar`;
const SEC_COMPANY_TICKERS_EXCHANGE_URL = `${SEC_BASE_URL}/files/company_tickers_exchange.json`;
const PARSER_VERSION = "sec_edgar_raw_parser_v1";
const TEXT_VERSION = "sec_text_clean_v1";
const DEFAULT_FORM_TYPES = ["8-K", "6-K"];
const MAX_DOCUMENT_TEXT_CHARS = 160_000;
const MAX_COMBINED_TEXT_CHARS = 500_000;

type FetchOptions = {
  formTypes?: string[];
  countPerForm?: number;
  limit?: number;
  includeDocuments?: boolean;
  attachmentLimit?: number;
};

export type SecDocument = {
  sequence: string | null;
  description: string | null;
  document: string | null;
  type: string | null;
  size: string | null;
  url: string | null;
  isPrimary: boolean;
  text: string | null;
  textCharCount: number;
  textTruncated: boolean;
  fetchStatus?: number;
  fetchError?: string;
};

export type SecParsedRawItem = {
  source_code: "sec_edgar";
  source_group: "filings";
  source_unique_id: string | null;
  source_url: string;
  title: string | null;
  published_at: string | null;
  fetched_at: string;
  body_text: string | null;
  analysis_text: string | null;
  dedupe_key: string;
  raw_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type SecRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: SecParsedRawItem[];
  diagnostics: {
    parserVersion: string;
    textVersion: string;
    requestedFormTypes: string[];
    feedsRequested: number;
    parsedFromFeeds: number;
    documentsRequested: number;
    documentsFetched: number;
    documentsFailed: number;
  };
  error?: string;
};

type FeedEntry = {
  title: string | null;
  updated: string | null;
  detailUrl: string | null;
  formType: string | null;
};

type FilingIdentity = {
  cik: string | null;
  cikPadded: string | null;
  accessionNumber: string | null;
  accessionNoDashes: string | null;
};

type TickerRow = {
  cik: string;
  ticker: string;
  exchange: string | null;
  name: string | null;
};

let tickerLookupPromise: Promise<Map<string, TickerRow[]>> | null = null;

export async function fetchSecEdgarRawItems(options: FetchOptions = {}): Promise<SecRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const formTypes = normalizeFormTypes(options.formTypes);
  const countPerForm = clampInt(options.countPerForm ?? 10, 1, 100);
  const limit = clampInt(options.limit ?? formTypes.length * countPerForm, 1, 100);
  const includeDocuments = options.includeDocuments ?? true;
  const attachmentLimit = clampInt(options.attachmentLimit ?? 6, 0, 20);
  const diagnostics = {
    parserVersion: PARSER_VERSION,
    textVersion: TEXT_VERSION,
    requestedFormTypes: formTypes,
    feedsRequested: 0,
    parsedFromFeeds: 0,
    documentsRequested: 0,
    documentsFetched: 0,
    documentsFailed: 0,
  };

  try {
    const feedEntries: FeedEntry[] = [];
    for (const formType of formTypes) {
      diagnostics.feedsRequested += 1;
      const feed = await fetchCurrentFeed(formType, countPerForm);
      if (!feed.ok) {
        return {
          ok: false,
          status: feed.status,
          fetchedAt,
          count: 0,
          items: [],
          diagnostics,
          error: feed.error || `SEC current feed failed for ${formType}`,
        };
      }
      feedEntries.push(...feed.entries);
    }

    const dedupedEntries = dedupeFeedEntries(feedEntries).slice(0, limit);
    diagnostics.parsedFromFeeds = feedEntries.length;
    const tickerLookup = await fetchTickerLookup();
    const items: SecParsedRawItem[] = [];

    for (const entry of dedupedEntries) {
      const detailUrl = entry.detailUrl;
      if (!detailUrl) continue;

      const identity = parseFilingIdentity(detailUrl);
      const tickerRows = identity.cik ? tickerLookup.get(identity.cik) || [] : [];
      const tickerRow = selectPrimaryTickerRow(tickerRows);
      const detail = includeDocuments
        ? await fetchFilingDetail({
            detailUrl,
            formType: entry.formType,
            attachmentLimit,
          })
        : {
            documents: [],
            documentsRequested: 0,
            documentsFetched: 0,
            documentsFailed: 0,
            companyName: null,
          };

      diagnostics.documentsRequested += detail.documentsRequested;
      diagnostics.documentsFetched += detail.documentsFetched;
      diagnostics.documentsFailed += detail.documentsFailed;

      const primary = detail.documents.find((document) => document.isPrimary) || detail.documents[0] || null;
      const bodyText = buildCombinedText(detail.documents);
      const companyName = detail.companyName || tickerRow?.name || readCompanyNameFromTitle(entry.title);
      const accessionNumber = identity.accessionNumber;
      const sourceUniqueId = accessionNumber || detailUrl;
      const formType = normalizeFormType(entry.formType) || primary?.type || null;

      items.push({
        source_code: "sec_edgar",
        source_group: "filings",
        source_unique_id: sourceUniqueId,
        source_url: detailUrl,
        title: buildFilingTitle({
          companyName,
          formType,
          accessionNumber,
          fallback: entry.title,
        }),
        published_at: entry.updated,
        fetched_at: fetchedAt,
        body_text: bodyText,
        analysis_text: bodyText,
        dedupe_key: `sec_edgar:${sourceUniqueId}`,
        raw_payload: {
          parser_version: PARSER_VERSION,
          text_version: TEXT_VERSION,
          form_type: formType,
          cik: identity.cik,
          cik_padded: identity.cikPadded,
          accession_number: accessionNumber,
          accession_no_dashes: identity.accessionNoDashes,
          company_name: companyName,
          ticker: tickerRow?.ticker || null,
          exchange: tickerRow?.exchange || null,
          tickers: tickerRows.map((row) => ({
            ticker: row.ticker,
            exchange: row.exchange,
          })),
          detail_url: detailUrl,
          primary_document_url: primary?.url || null,
          documents: detail.documents.map((document) => ({
            sequence: document.sequence,
            description: document.description,
            document: document.document,
            type: document.type,
            size: document.size,
            url: document.url,
            isPrimary: document.isPrimary,
            textCharCount: document.textCharCount,
            textTruncated: document.textTruncated,
            fetchStatus: document.fetchStatus || null,
            fetchError: document.fetchError || null,
          })),
          attachment_texts: detail.documents
            .filter((document) => !document.isPrimary && document.text)
            .map((document) => ({
              type: document.type,
              description: document.description,
              url: document.url,
              text: document.text,
            })),
          text_truncated: bodyText.length >= MAX_COMBINED_TEXT_CHARS,
        },
        metadata: {
          parser: "sec_edgar",
          form_type: formType,
          cik: identity.cik,
          accession_number: accessionNumber,
          ticker: tickerRow?.ticker || null,
          exchange: tickerRow?.exchange || null,
          company_name: companyName,
          primary_document_url: primary?.url || null,
          document_count: detail.documents.length,
        },
      });
    }

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: items.length,
      items,
      diagnostics,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics,
      error: error instanceof Error ? error.message : "SEC raw fetch failed",
    };
  }
}

async function fetchCurrentFeed(formType: string, count: number) {
  const url = new URL(SEC_CURRENT_URL);
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("type", formType);
  url.searchParams.set("owner", "include");
  url.searchParams.set("start", "0");
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");

  const response = await secFetch(url);
  const xml = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      entries: [] as FeedEntry[],
      error: response.statusText || `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    entries: parseCurrentFeed(xml, formType),
  };
}

function parseCurrentFeed(xml: string, formType: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const entries = arrayOf(parsed?.feed?.entry);

  return entries.map((entry) => {
    const link = Array.isArray(entry.link) ? entry.link[0] : entry.link;
    return {
      title: stringValue(entry.title) || null,
      updated: normalizeDateTime(entry.updated),
      detailUrl: absoluteSecUrl(stringValue(link?.href)),
      formType,
    };
  });
}

async function fetchFilingDetail({
  detailUrl,
  formType,
  attachmentLimit,
}: {
  detailUrl: string;
  formType: string | null;
  attachmentLimit: number;
}) {
  const response = await secFetch(detailUrl);
  const html = await response.text();
  if (!response.ok) {
    return {
      documents: [
        {
          sequence: null,
          description: null,
          document: null,
          type: formType,
          size: null,
          url: null,
          isPrimary: true,
          text: null,
          textCharCount: 0,
          textTruncated: false,
          fetchStatus: response.status,
          fetchError: response.statusText || `HTTP ${response.status}`,
        },
      ] as SecDocument[],
      documentsRequested: 0,
      documentsFetched: 0,
      documentsFailed: 1,
      companyName: null,
    };
  }

  const companyName = readCompanyNameFromDetailHtml(html);
  const documents = parseFilingDocuments(html, detailUrl, formType);
  const selectedDocuments = selectDocumentsForText(documents, attachmentLimit, formType);
  let documentsFetched = 0;
  let documentsFailed = 0;
  const documentsWithText: SecDocument[] = [];

  for (const document of documents) {
    if (!selectedDocuments.has(document.url || "")) {
      documentsWithText.push(document);
      continue;
    }

    if (!document.url) {
      documentsWithText.push(document);
      documentsFailed += 1;
      continue;
    }

    try {
      const documentResponse = await secFetch(document.url);
      const text = await documentResponse.text();
      if (!documentResponse.ok) {
        documentsFailed += 1;
        documentsWithText.push({
          ...document,
          fetchStatus: documentResponse.status,
          fetchError: documentResponse.statusText || `HTTP ${documentResponse.status}`,
        });
        continue;
      }

      const cleaned = cleanDocumentText(text);
      const truncated = cleaned.length > MAX_DOCUMENT_TEXT_CHARS;
      documentsFetched += 1;
      documentsWithText.push({
        ...document,
        text: truncated ? cleaned.slice(0, MAX_DOCUMENT_TEXT_CHARS) : cleaned,
        textCharCount: cleaned.length,
        textTruncated: truncated,
        fetchStatus: documentResponse.status,
      });
    } catch (error) {
      documentsFailed += 1;
      documentsWithText.push({
        ...document,
        fetchError: error instanceof Error ? error.message : "Document fetch failed",
      });
    }
  }

  return {
    documents: documentsWithText,
    documentsRequested: selectedDocuments.size,
    documentsFetched,
    documentsFailed,
    companyName,
  };
}

function parseFilingDocuments(html: string, detailUrl: string, formType: string | null): SecDocument[] {
  const table = extractFirst(
    html,
    /<table[^>]+summary=["']Document Format Files["'][^>]*>([\s\S]*?)<\/table>/i,
  );
  if (!table) return [];

  const documents: SecDocument[] = [];
  for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] || "";
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] || "");
    if (cells.length < 4) continue;

    const linkHref = extractFirst(cells[2], /<a[^>]+href=["']([^"']+)["'][^>]*>/i);
    const type = cleanInlineText(cells[3]) || null;
    const documentUrl = absoluteSecUrl(linkHref, detailUrl);
    const document: SecDocument = {
      sequence: cleanInlineText(cells[0]) || null,
      description: cleanInlineText(cells[1]) || null,
      document: cleanInlineText(cells[2]) || null,
      type,
      size: cleanInlineText(cells[4]) || null,
      url: documentUrl,
      isPrimary: false,
      text: null,
      textCharCount: 0,
      textTruncated: false,
    };
    documents.push(document);
  }

  const primaryIndex = documents.findIndex((document) => isPrimaryDocument(document, formType));
  if (primaryIndex >= 0) {
    documents[primaryIndex] = { ...documents[primaryIndex], isPrimary: true };
  } else if (documents[0]) {
    documents[0] = { ...documents[0], isPrimary: true };
  }

  return documents;
}

function selectDocumentsForText(documents: SecDocument[], attachmentLimit: number, formType: string | null) {
  const selected = new Set<string>();
  const primary = documents.find((document) => document.isPrimary);
  if (primary?.url) selected.add(primary.url);

  if (isS3FamilyForm(formType)) {
    for (const document of documents) {
      if (!document.url || document.isPrimary) continue;
      if (isFilingFeeTableDocument(document)) selected.add(document.url);
    }
  }

  let selectedAttachmentCount = 0;
  for (const document of documents) {
    if (selectedAttachmentCount >= attachmentLimit) break;
    if (!document.url || document.isPrimary) continue;
    if (selected.has(document.url)) continue;
    if (isInterestingAttachment(document)) {
      selected.add(document.url);
      selectedAttachmentCount += 1;
    }
  }

  return selected;
}

function isPrimaryDocument(document: SecDocument, formType: string | null) {
  const type = normalizeFormType(document.type);
  const form = normalizeFormType(formType);
  if (type && form && type === form) return true;
  if (!document.url) return false;
  return !/\.(xml|xsd|jpg|jpeg|gif|png)$/i.test(document.url);
}

function isInterestingAttachment(document: SecDocument) {
  const type = stringValue(document.type).toUpperCase();
  if (!type) return false;
  if (type.startsWith("EX-99")) return true;
  if (type.startsWith("EX-10")) return true;
  if (type.startsWith("EX-2")) return true;
  if (type.startsWith("EX-3")) return true;
  if (type.startsWith("EX-4")) return true;
  if (type.startsWith("EX-5")) return true;
  if (type.startsWith("EX-8")) return true;
  if (type.startsWith("EX-23")) return true;
  if (type.startsWith("EX-24")) return true;
  return false;
}

function isS3FamilyForm(formType: string | null) {
  return /^S-3(?:ASR|\/A)?$/i.test(normalizeFormType(formType));
}

function isFilingFeeTableDocument(document: SecDocument) {
  const label = `${stringValue(document.type)} ${stringValue(document.description)} ${stringValue(document.document)}`;
  return /\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(label);
}

function buildCombinedText(documents: SecDocument[]) {
  const sections = documents
    .filter((document) => document.text)
    .map((document) => {
      const type = document.type || "DOCUMENT";
      const description = document.description ? ` - ${document.description}` : "";
      return `### ${type}${description}\n${document.text}`;
    });

  const combined = sections.join("\n\n").trim();
  return combined.length > MAX_COMBINED_TEXT_CHARS ? combined.slice(0, MAX_COMBINED_TEXT_CHARS) : combined;
}

async function fetchTickerLookup(): Promise<Map<string, TickerRow[]>> {
  if (!tickerLookupPromise) {
    tickerLookupPromise = fetchTickerLookupInner().catch(() => new Map<string, TickerRow[]>());
  }
  const lookup = await tickerLookupPromise;
  return lookup;
}

async function fetchTickerLookupInner() {
  const response = await secFetch(SEC_COMPANY_TICKERS_EXCHANGE_URL);
  const data = await response.json().catch(() => null);
  const fields = Array.isArray(data?.fields) ? data.fields.map((field: unknown) => stringValue(field)) : [];
  const rows = Array.isArray(data?.data) ? data.data : [];
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const tickerIndex = fields.indexOf("ticker");
  const exchangeIndex = fields.indexOf("exchange");
  const lookup = new Map<string, TickerRow[]>();

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cik = normalizeCik(row[cikIndex]);
    const ticker = stringValue(row[tickerIndex]).toUpperCase();
    if (!cik || !ticker) continue;
    const tickerRow = {
      cik,
      ticker,
      exchange: stringValue(row[exchangeIndex]) || null,
      name: stringValue(row[nameIndex]) || null,
    };
    const existing = lookup.get(cik) || [];
    existing.push(tickerRow);
    lookup.set(cik, existing);
  }

  return lookup;
}

function selectPrimaryTickerRow(rows: TickerRow[]) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => tickerQualityScore(b.ticker) - tickerQualityScore(a.ticker));
  return sorted[0] || null;
}

function tickerQualityScore(ticker: string) {
  const value = ticker.toUpperCase();
  let score = 100;
  if (value.endsWith("W") || value.endsWith("WS") || value.endsWith("WT") || value.includes("WARRANT")) score -= 40;
  if (value.endsWith("U") || value.endsWith("UN")) score -= 25;
  if (value.endsWith("R") || value.endsWith("RT")) score -= 20;
  if (value.includes(".")) score -= 5;
  score -= Math.max(0, value.length - 4) * 3;
  return score;
}

async function secFetch(input: string | URL) {
  const env = getServerEnv();
  const userAgent = env.secUserAgent || "US-Stock-Radar/0.1 contact@example.com";

  return fetch(input, {
    cache: "no-store",
    headers: {
      "User-Agent": userAgent,
      Accept: "application/atom+xml, application/json, text/html, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });
}

function cleanDocumentText(input: string) {
  const withoutHidden = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ");

  const withBreaks = withoutHidden
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");

  return decodeHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readCompanyNameFromDetailHtml(html: string) {
  const companyInfo =
    extractFirst(html, /<span[^>]+class=["']companyName["'][^>]*>([\s\S]*?)<\/span>/i) ||
    extractFirst(html, /<div[^>]+class=["']companyInfo["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!companyInfo) return null;
  return cleanInlineText(companyInfo)
    .replace(/\s+CIK#?:.*$/i, "")
    .replace(/\s+\(Filer\).*$/i, "")
    .trim() || null;
}

function readCompanyNameFromTitle(title: string | null) {
  const text = stringValue(title);
  const match = text.match(/-\s+(.+?)\s+\(\d{10}\)/);
  return match?.[1]?.trim() || null;
}

function buildFilingTitle({
  companyName,
  formType,
  accessionNumber,
  fallback,
}: {
  companyName: string | null;
  formType: string | null;
  accessionNumber: string | null;
  fallback: string | null;
}) {
  if (companyName && formType) return `${companyName} files ${formType}`;
  if (fallback) return fallback;
  if (formType && accessionNumber) return `${formType} filing ${accessionNumber}`;
  return "SEC filing";
}

function parseFilingIdentity(detailUrl: string): FilingIdentity {
  const pathMatch = detailUrl.match(/\/Archives\/edgar\/data\/(\d+)\/(\d+)\//i);
  const cik = normalizeCik(pathMatch?.[1]);
  const accessionNoDashes = pathMatch?.[2] || null;
  const accessionFromFile = detailUrl.match(/\/([0-9]{10}-[0-9]{2}-[0-9]{6})-index\.htm/i)?.[1] || null;
  const accessionNumber =
    accessionFromFile ||
    (accessionNoDashes && accessionNoDashes.length >= 18
      ? `${accessionNoDashes.slice(0, 10)}-${accessionNoDashes.slice(10, 12)}-${accessionNoDashes.slice(12, 18)}`
      : null);

  return {
    cik,
    cikPadded: cik ? cik.padStart(10, "0") : null,
    accessionNumber,
    accessionNoDashes,
  };
}

function normalizeFormTypes(values: unknown) {
  const raw = Array.isArray(values) ? values : [];
  const formTypes = raw
    .flatMap((value) => stringValue(value).split(","))
    .map((value) => normalizeFormType(value))
    .filter(Boolean);
  return Array.from(new Set(formTypes.length ? formTypes : DEFAULT_FORM_TYPES));
}

function normalizeFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ");
}

function normalizeCik(value: unknown) {
  const text = stringValue(value).replace(/\D/g, "");
  if (!text) return null;
  return String(Number(text));
}

function normalizeDateTime(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dedupeFeedEntries(entries: FeedEntry[]) {
  const seen = new Set<string>();
  const deduped: FeedEntry[] = [];
  for (const entry of entries) {
    const key = entry.detailUrl || `${entry.title}:${entry.updated}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.sort((a, b) => stringValue(b.updated).localeCompare(stringValue(a.updated)));
}

function absoluteSecUrl(value: string | null, base?: string) {
  const href = stringValue(value);
  if (!href) return null;
  try {
    const url = new URL(href, base || SEC_BASE_URL);
    const inlineDocPath = url.pathname === "/ix" ? url.searchParams.get("doc") : null;
    if (inlineDocPath && inlineDocPath.startsWith("/Archives/")) {
      return new URL(inlineDocPath, SEC_BASE_URL).toString();
    }
    return url.toString();
  } catch {
    return null;
  }
}

function cleanInlineText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractFirst(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] || null;
}

function arrayOf<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
