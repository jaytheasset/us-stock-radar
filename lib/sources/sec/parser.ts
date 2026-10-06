import { XMLParser } from "fast-xml-parser";
import { getServerEnv } from "@/lib/env";
import {
  getSecFormFetchPlan,
  isSecTextFetchCandidate,
  matchesSecFormFetchRule,
} from "@/lib/sources/sec/forms/fetchPlanRegistry";
import {
  buildSecArchiveFilingUrls,
  buildSecArchiveIndexUrlFromMasterFilename,
} from "@/lib/sources/sec/archiveUrls";
import { decodeSecHtmlEntities } from "@/lib/sources/sec/htmlEntities";
import {
  extractPeriodicReportIngestEvidence,
  type PeriodicReportIngestSourceBlock,
  type PeriodicReportIngestXbrlFact,
} from "@/lib/sources/sec/forms/periodic-reports/ingestSourceExtract";
import { parseSc13StructuralXml } from "@/lib/sources/sec/forms/sc13/structuralParser";
import {
  selectSourceBackedSecTickerRow,
  type SecTickerSelectionRow,
} from "@/lib/sources/sec/sourceTickerSelection";
import { secFetch } from "./secFetch";
import { createTickerCatalogCache } from "./tickerCatalogCache.ts";
import { buildForm25IdentityEvidence, SEC_TICKER_CATALOG } from "../../sec-form25-identity/canonical";
import { captureForm25Document, FORM25_SOURCE_VERSION, type Form25OriginalDocument } from "./forms/form25/storedSource";
import { captureS8Document, isS8Form, S8_SOURCE_VERSION, type S8Document } from "../../sec-s8/directFacts";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_CURRENT_URL = `${SEC_BASE_URL}/cgi-bin/browse-edgar`;
const SEC_COMPANY_TICKERS_EXCHANGE_URL = `${SEC_BASE_URL}/files/company_tickers_exchange.json`;
const PARSER_VERSION = "sec_edgar_raw_parser_v1";
const TEXT_VERSION = "sec_text_clean_v1";
const DEFAULT_FORM_TYPES = ["8-K", "6-K"];
const MAX_DOCUMENT_TEXT_CHARS = 160_000;
const MAX_COMBINED_TEXT_CHARS = 500_000;
const MAX_OWNERSHIP_SOURCE_TEXT_CHARS = 500_000;
const MAX_SC13_SOURCE_TEXT_CHARS = 500_000;
const MAX_PRIMARY_DOCUMENT_HTML_CHARS = 2_000_000;

type FetchOptions = {
  formTypes?: string[];
  countPerForm?: number;
  limit?: number;
  includeDocuments?: boolean;
  attachmentLimit?: number;
  accessionNumber?: string;
  cik?: string;
  dateFrom?: string;
  dateTo?: string;
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
  rawText?: string | null;
  rawTextCharCount?: number;
  rawTextTruncated?: boolean;
  rawSourceFormat?: string | null;
  form25OriginalSource?: Form25OriginalDocument;
  s8OriginalSource?: S8Document;
  sc13RawText?: string | null;
  sc13RawTextCharCount?: number;
  sc13RawTextTruncated?: boolean;
  sc13RawSourceFormat?: string | null;
  sc13RawCaptureStatus?: "preserved" | "truncated" | "empty" | "invalid_format" | "fetch_failed" | "unsupported_response";
  sc13RawCaptureError?: string | null;
  rawHtml?: string | null;
  rawHtmlCharCount?: number;
  rawHtmlTruncated?: boolean;
  periodicReportCoreXbrlFacts?: PeriodicReportIngestXbrlFact[];
  periodicReportCoreSourceBlocks?: PeriodicReportIngestSourceBlock[];
  fetchStatus?: number;
  fetchError?: string;
  textExtractionStatus?: string | null;
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
    dateFrom?: string | null;
    dateTo?: string | null;
    afterDateFilter?: number;
    tickerCatalog?: { status: "available" | "unavailable"; error?: string };
  };
  error?: string;
};

export type SecCurrentFeedEntry = {
  title: string | null;
  updated: string | null;
  detailUrl: string | null;
  summary: string | null;
  formType: string | null;
  requestedFormType: string | null;
};

type FilingIdentity = {
  cik: string | null;
  cikPadded: string | null;
  accessionNumber: string | null;
  accessionNoDashes: string | null;
};

type TickerRow = SecTickerSelectionRow;

type TickerResolution = {
  rows: TickerRow[];
  primary: TickerRow | null;
  source:
    | "issuer_trading_symbol"
    | "issuer_trading_symbol_and_cik_sec"
    | "issuer_cik_sec"
    | "accession_cik_sec"
    | "cusip_fmp_verified"
    | "unresolved";
  confidence: "high" | "none";
  reason: string;
  cusip: string | null;
};

const tickerCatalogCache = createTickerCatalogCache(fetchTickerLookupInner);
const fmpCusipLookupCache = new Map<string, Promise<TickerRow[]>>();

export async function fetchSecEdgarRawItems(options: FetchOptions = {}): Promise<SecRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const requestedAccessionNumber = normalizeAccessionNumber(options.accessionNumber);
  const requestedCik = normalizeCik(options.cik);
  const dateFrom = normalizeDateOnly(options.dateFrom);
  const dateTo = normalizeDateOnly(options.dateTo);
  const formTypes = normalizeFormTypes(options.formTypes, requestedAccessionNumber ? [] : DEFAULT_FORM_TYPES);
  const countPerForm = clampInt(options.countPerForm ?? 10, 1, 100);
  const limit = requestedAccessionNumber ? 1 : clampInt(options.limit ?? formTypes.length * countPerForm, 1, 100);
  const includeDocuments = options.includeDocuments ?? true;
  const attachmentLimit = clampInt(options.attachmentLimit ?? 6, 0, 20);
  const diagnostics: SecRawFetchResult["diagnostics"] = {
    parserVersion: PARSER_VERSION,
    textVersion: TEXT_VERSION,
    requestedFormTypes: formTypes,
    feedsRequested: 0,
    parsedFromFeeds: 0,
    documentsRequested: 0,
    documentsFetched: 0,
    documentsFailed: 0,
    dateFrom,
    dateTo,
    afterDateFilter: 0,
  };

  try {
    const feedEntries: SecCurrentFeedEntry[] = [];
    if (requestedAccessionNumber) {
      diagnostics.feedsRequested += 1;
      const feed = await fetchSecCurrentFeedByAccession(requestedAccessionNumber, {
        cik: requestedCik,
      });
      if (!feed.ok || !feed.entry) {
        return {
          ok: false,
          status: feed.status,
          fetchedAt,
          count: 0,
          items: [],
          diagnostics,
          error: feed.error || `SEC accession lookup failed for ${requestedAccessionNumber}`,
        };
      }

      if (formTypes.length && feed.entry.formType && !formTypes.some((formType) => secFormTypesMatch(formType, feed.entry.formType))) {
        return {
          ok: false,
          status: 404,
          fetchedAt,
          count: 0,
          items: [],
          diagnostics,
          error: `SEC accession ${requestedAccessionNumber} is ${feed.entry.formType}, not one of requested forms ${formTypes.join(", ")}`,
        };
      }

      feedEntries.push(feed.entry);
    } else {
      for (const formType of formTypes) {
        diagnostics.feedsRequested += 1;
        const feed = await fetchSecCurrentFeed(formType, feedCountForForm(formType, countPerForm));
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
    }

    const dateFilteredEntries = filterFeedEntriesByDateRange(dedupeFeedEntries(feedEntries), dateFrom, dateTo);
    const dedupedEntries = dateFilteredEntries.slice(0, limit);
    diagnostics.parsedFromFeeds = feedEntries.length;
    diagnostics.afterDateFilter = dateFilteredEntries.length;
    // Catalog outages must not abort independent SEC document collection. This
    // empty local lookup is unavailable input, never a successful cached catalog.
    let tickerLookup = new Map<string, TickerRow[]>();
    let tickerCatalogAvailable = false;
    try {
      tickerLookup = await fetchTickerLookup();
      tickerCatalogAvailable = true;
      diagnostics.tickerCatalog = { status: "available" };
    } catch (error) {
      diagnostics.tickerCatalog = { status: "unavailable", error: error instanceof Error ? error.message : "SEC ticker catalog unavailable" };
    }
    const items: SecParsedRawItem[] = [];

    for (const entry of dedupedEntries) {
      const detailUrl = entry.detailUrl;
      if (!detailUrl) continue;

      const identity = parseFilingIdentity(detailUrl);
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
            filingDate: null,
            acceptedAt: null,
            acceptedAtSource: null,
            fileNumber: null,
            registrationNumber: null,
            secAct: null,
            filmNumber: null,
            sc13IndexProvenance: null,
          };

      diagnostics.documentsRequested += detail.documentsRequested;
      diagnostics.documentsFetched += detail.documentsFetched;
      diagnostics.documentsFailed += detail.documentsFailed;

      const primary = detail.documents.find((document) => document.isPrimary) || detail.documents[0] || null;
      const bodyText = buildCombinedText(detail.documents);
      if (includeDocuments && !bodyText) {
        const sourceFailure = summarizeDocumentSourceFailure(detailUrl, detail.documents);
        if (requestedAccessionNumber) {
          return {
            ok: false,
            status: sourceFailure.status,
            fetchedAt,
            count: 0,
            items: [],
            diagnostics,
            error: sourceFailure.message,
          };
        }
        continue;
      }
      const formType = chooseRawItemFormType(entry.formType, primary?.type);
      const ownershipSource =
        detail.documents.find((document) => document.rawSourceFormat === "ownership_xml") ||
        detail.documents.find((document) => document.rawText) ||
        null;
      const sc13Source = detail.documents.find((document) => document.sc13RawCaptureStatus) || null;
      const ownershipIssuer =
        (ownershipSource?.rawText ? readOwnershipIssuerIdentity(ownershipSource.rawText) : null) ||
        (isSchedule13FormType(formType) ? readSchedule13IssuerIdentity(primary, bodyText) : null);
      const tickerIssuer = isSchedule13FormType(formType)
        ? readVerifiedSchedule13TickerIssuer({
            source: sc13Source,
            formType,
            accessionNumber: identity.accessionNumber,
            indexProvenance: detail.sc13IndexProvenance,
          })
        : ownershipIssuer;
      const issuerCusips = extractIssuerCusips([ownershipSource?.rawText, primary?.rawHtml, primary?.rawText, primary?.text, bodyText]);
      const form25Identity = /^25(?:-NSE)?(?:\/A)?$/i.test(formType || "")
        ? buildForm25IdentityEvidence({ source_unique_id: identity.accessionNumber, source_url: detailUrl,
            title: entry.title, body_text: bodyText, analysis_text: bodyText,
            raw_payload: { form_type: formType, cik: identity.cik, company_name: detail.companyName,
              form25_index_subject_cik: detail.sc13IndexProvenance?.subjectCik,
              form25_index_subject_cik_count: detail.sc13IndexProvenance?.subjectCikCount,
              attachment_texts: detail.documents.filter(document => !document.isPrimary && document.text)
                .map(document => ({ type: document.type, text: document.text })) } },
            { rows: Array.from(tickerLookup.values()).flat().map(row => ({ ...row, source: SEC_TICKER_CATALOG })), available: tickerCatalogAvailable })
        : null;
      const tickerResolution: TickerResolution = form25Identity
        ? { rows: form25Identity.status === "AUTO" ? form25Identity.candidates.map(row => ({ ...row, name: form25Identity.issuerName })) : [],
            primary: form25Identity.status === "AUTO" ? { ...form25Identity.candidates[0]!, name: form25Identity.issuerName } : null,
            source: form25Identity.status === "AUTO" ? "issuer_cik_sec" : "unresolved", confidence: form25Identity.status === "AUTO" ? "high" : "none",
            reason: form25Identity.reason, cusip: null }
        : isSchedule13FormType(formType)
        ? resolveVerifiedSchedule13TickerRows(tickerLookup, tickerIssuer)
        : await resolveTrustedTickerRows({
            lookup: tickerLookup,
            formType,
            filerCik: identity.cik,
            issuer: tickerIssuer,
            cusips: issuerCusips,
          });
      if (!tickerCatalogAvailable && !form25Identity && tickerResolution.source === "unresolved") {
        tickerResolution.reason = "SEC ticker catalog unavailable; no current catalog match could be verified.";
      }
      const tickerRows = tickerResolution.rows;
      const tickerRow = tickerResolution.primary;
      const companyName = form25Identity?.issuerName || ownershipIssuer?.name || detail.companyName || tickerRow?.name || readCompanyNameFromTitle(entry.title);
      const accessionNumber = identity.accessionNumber;
      const sourceUniqueId = accessionNumber || detailUrl;

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
        published_at: detail.acceptedAt || entry.updated || detail.filingDate,
        fetched_at: fetchedAt,
        body_text: bodyText,
        analysis_text: bodyText,
        dedupe_key: `sec_edgar:${sourceUniqueId}`,
        raw_payload: {
          parser_version: PARSER_VERSION,
          text_version: TEXT_VERSION,
          form_type: formType,
          cik: form25Identity?.subjectCik || ownershipIssuer?.cik || identity.cik,
          cik_padded: (form25Identity?.subjectCik || ownershipIssuer?.cik || identity.cik)?.padStart(10, "0") || null,
          filer_cik: identity.cik,
          filer_cik_padded: identity.cikPadded,
          ownership_issuer_cik: ownershipIssuer?.cik || null,
          ownership_issuer_name: ownershipIssuer?.name || null,
          ownership_issuer_trading_symbol: ownershipIssuer?.ticker || null,
          accession_number: accessionNumber,
          accession_no_dashes: identity.accessionNoDashes,
          filing_date: detail.filingDate,
          accepted_at: isSection16XmlParserForm(formType) ? detail.acceptedAtSource : detail.acceptedAt,
          file_number: detail.fileNumber,
          registration_number: detail.registrationNumber,
          sec_act: detail.secAct,
          film_number: detail.filmNumber,
          company_name: companyName,
          ticker: tickerRow?.ticker || null,
          exchange: tickerRow?.exchange || null,
          ticker_resolution: {
            source: tickerResolution.source,
            confidence: tickerResolution.confidence,
            reason: tickerResolution.reason,
            cusip: tickerResolution.cusip,
          },
          ...(form25Identity ? { form25_ticker_identity: form25Identity,
            form25_exchange: form25Identity.exchange,
            form25_index_subject_cik: detail.sc13IndexProvenance?.subjectCik || null,
            form25_index_subject_cik_count: detail.sc13IndexProvenance?.subjectCikCount || 0 } : {}),
          issuer_cusips: issuerCusips,
          tickers: tickerRows.map((row) => ({
            ticker: row.ticker,
            exchange: row.exchange,
          })),
          detail_url: detailUrl,
          primary_document_url: primary?.url || null,
          primary_document_html: primary?.rawHtml || null,
          primary_document_html_char_count: primary?.rawHtmlCharCount || 0,
          primary_document_html_truncated: Boolean(primary?.rawHtmlTruncated),
          ...(isS8Form(formType) ? { s8_source: { version: S8_SOURCE_VERSION,
            documents: detail.documents.flatMap(document => document.s8OriginalSource ? [document.s8OriginalSource] : []) } } : {}),
          ...(/^(25|25-NSE)(\/A)?$/.test(formType || "") ? {
            form25_source: { version: FORM25_SOURCE_VERSION,
              documents: detail.documents.flatMap(document => document.form25OriginalSource ? [document.form25OriginalSource] : []) },
          } : {}),
          periodic_report_core_xbrl_facts: detail.documents.flatMap(
            (document) => document.periodicReportCoreXbrlFacts || [],
          ),
          periodic_report_core_source_blocks: detail.documents.flatMap(
            (document) => document.periodicReportCoreSourceBlocks || [],
          ),
          ownership_source_url: ownershipSource?.url || null,
          ownership_source_format: ownershipSource?.rawSourceFormat || null,
          ownership_source_text: ownershipSource?.rawText || null,
          ownership_source_text_char_count: ownershipSource?.rawTextCharCount || 0,
          ownership_source_text_truncated: Boolean(ownershipSource?.rawTextTruncated),
          sc13_source_url: sc13Source?.url || null,
          sc13_source_format: sc13Source?.sc13RawSourceFormat || null,
          sc13_source_text: sc13Source ? sc13Source.sc13RawText ?? null : null,
          sc13_source_text_char_count: sc13Source?.sc13RawTextCharCount || 0,
          sc13_source_text_truncated: Boolean(sc13Source?.sc13RawTextTruncated),
          sc13_source_capture_status: sc13Source?.sc13RawCaptureStatus || null,
          sc13_source_capture_error: sc13Source?.sc13RawCaptureError || null,
          sc13_index_subject_cik: detail.sc13IndexProvenance?.subjectCik || null,
          sc13_index_subject_cik_count: detail.sc13IndexProvenance?.subjectCikCount || 0,
          sc13_index_filed_by_ciks: detail.sc13IndexProvenance?.filedByCiks || [],
          sc13_index_canonical_xml_url: detail.sc13IndexProvenance?.canonicalXmlUrl || null,
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
            rawTextCharCount: document.rawTextCharCount || 0,
            rawTextTruncated: Boolean(document.rawTextTruncated),
            rawTextPreserved: Boolean(document.rawText),
            rawHtmlCharCount: document.rawHtmlCharCount || 0,
            rawHtmlTruncated: Boolean(document.rawHtmlTruncated),
            rawHtmlPreserved: Boolean(document.rawHtml),
            rawSourceFormat: document.rawSourceFormat || null,
            sc13RawTextCharCount: document.sc13RawTextCharCount || 0,
            sc13RawTextTruncated: Boolean(document.sc13RawTextTruncated),
            sc13RawTextPreserved: Boolean(document.sc13RawText),
            sc13RawSourceFormat: document.sc13RawSourceFormat || null,
            sc13RawCaptureStatus: document.sc13RawCaptureStatus || null,
            sc13RawCaptureError: document.sc13RawCaptureError || null,
            fetchStatus: document.fetchStatus || null,
            fetchError: document.fetchError || null,
            textExtractionStatus: document.textExtractionStatus || null,
          })),
          attachment_texts: detail.documents
            .filter((document) => !document.isPrimary && document.text)
            .map((document) => ({
              type: document.type,
              description: document.description,
              filename: document.document,
              url: document.url,
              text: document.text,
            })),
          text_truncated: bodyText.length >= MAX_COMBINED_TEXT_CHARS,
        },
        metadata: {
          parser: "sec_edgar",
          form_type: formType,
          cik: ownershipIssuer?.cik || identity.cik,
          filer_cik: identity.cik,
          ownership_issuer_cik: ownershipIssuer?.cik || null,
          accession_number: accessionNumber,
          file_number: detail.fileNumber,
          registration_number: detail.registrationNumber,
          sec_act: detail.secAct,
          film_number: detail.filmNumber,
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

export async function fetchSecCurrentFeed(formType: string, count: number) {
  return fetchSecCurrentFeedPage(formType, count, 0);
}

async function fetchSecCurrentFeedPage(formType: string, count: number, start: number) {
  const url = new URL(SEC_CURRENT_URL);
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("type", formType);
  url.searchParams.set("owner", secFeedOwnerModeForForm(formType));
  url.searchParams.set("start", String(Math.max(0, start)));
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");

  const response = await secFetch(url);
  const xml = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      entries: [] as SecCurrentFeedEntry[],
      error: response.statusText || `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    entries: parseCurrentFeed(xml, formType).filter((entry) => entry.formType === normalizeFormType(formType)),
  };
}

async function fetchSecCurrentFeedByAccession(accessionNumber: string, options: { cik?: string | null } = {}) {
  const normalized = normalizeAccessionNumber(accessionNumber);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: "Invalid SEC accession number.",
    };
  }

  if (normalizeCik(options.cik)) {
    const directArchive = await fetchSecAccessionFromArchivePath(normalized, options.cik);
    if (directArchive.ok && directArchive.entry) return directArchive;
  }

  return fetchSecAccessionFromFullIndex(normalized, options);
}

async function fetchSecAccessionFromFullIndex(accessionNumber: string, options: { cik?: string | null } = {}) {
  const year = yearFromAccessionNumber(accessionNumber);
  if (!year) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: `Cannot infer year from SEC accession ${accessionNumber}.`,
    };
  }

  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  let lastStatus = 404;
  let lastError = "";

  for (const quarter of quartersToSearch(year)) {
    const indexUrl = `${SEC_BASE_URL}/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`;
    try {
      const response = await secFetch(indexUrl);
      lastStatus = response.status;
      if (!response.ok) {
        lastError = response.statusText || `HTTP ${response.status}`;
        continue;
      }

      const indexText = await response.text();
      const line = indexText
        .split(/\r?\n/)
        .find((candidate) => candidate.includes(accessionNumber) || candidate.includes(accessionNoDashes));
      if (!line) continue;

      const parts = line.split("|");
      if (parts.length < 5) continue;
      const cik = normalizeCik(parts[0]);
      const company = stringValue(parts[1]) || null;
      const formType = normalizeFormType(parts[2]) || null;
      const filedDate = stringValue(parts[3]);
      const filename = stringValue(parts[4]);
      const detailUrl = buildSecArchiveIndexUrlFromMasterFilename(filename);
      if (!detailUrl) continue;

      return {
        ok: true,
        status: 200,
        entry: {
          title: company && formType ? `${formType} - ${company} (${cik?.padStart(10, "0") || cik || ""})` : null,
          updated: filedDate ? `${filedDate}T00:00:00.000Z` : null,
          detailUrl,
          summary: null,
          formType,
          requestedFormType: formType,
        } satisfies SecCurrentFeedEntry,
      };
    } catch (error) {
      lastStatus = 0;
      lastError = error instanceof Error ? error.message : "SEC full-index fetch failed";
    }
  }

  const archiveFallback = await fetchSecAccessionFromArchivePath(accessionNumber, options.cik);
  if (archiveFallback.ok && archiveFallback.entry) return archiveFallback;

  const currentFeedFallback = await fetchSecAccessionFromCurrentOwnershipFeeds(accessionNumber);
  if (currentFeedFallback.ok && currentFeedFallback.entry) return currentFeedFallback;

  return {
    ok: false,
    status: lastStatus,
    entry: null,
    error:
      currentFeedFallback.error ||
      archiveFallback.error ||
      lastError ||
      `SEC accession ${accessionNumber} was not found in ${year} full-index files.`,
  };
}

async function fetchSecAccessionFromCurrentOwnershipFeeds(accessionNumber: string) {
  const normalized = normalizeAccessionNumber(accessionNumber);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: "Invalid SEC accession number.",
    };
  }

  let lastStatus = 404;
  let lastError = "";

  for (const formType of ["4", "4/A", "144", "144/A"]) {
    for (const start of [0, 100, 200, 300, 400]) {
      try {
        const feed = await fetchSecCurrentFeedPage(formType, 100, start);
        lastStatus = feed.status;
        if (!feed.ok) {
          lastError = feed.error || `SEC current feed failed for ${formType}`;
          continue;
        }

        const entry = feed.entries.find((candidate) => {
          if (!candidate.detailUrl) return false;
          const identity = parseFilingIdentity(candidate.detailUrl);
          return identity.accessionNumber === normalized;
        });
        if (entry) {
          return {
            ok: true,
            status: 200,
            entry,
          };
        }
        if (feed.entries.length < 100) break;
      } catch (error) {
        lastStatus = 0;
        lastError = error instanceof Error ? error.message : "SEC current ownership feed fallback failed";
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    entry: null,
    error: lastError || `SEC accession ${normalized} was not found in current ownership feeds.`,
  };
}

async function fetchSecAccessionFromArchivePath(accessionNumber: string, cik?: string | null) {
  const normalized = normalizeAccessionNumber(accessionNumber);
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: "Invalid SEC accession number.",
    };
  }

  const filerCik = normalizeCik(cik) || normalizeCik(normalized.slice(0, 10));
  const accessionNoDashes = normalized.replace(/-/g, "");
  if (!filerCik || accessionNoDashes.length !== 18) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: `Cannot build SEC archive path for ${normalized}.`,
    };
  }

  const archiveUrls = buildSecArchiveFilingUrls(filerCik, normalized);
  if (!archiveUrls) {
    return {
      ok: false,
      status: 400,
      entry: null,
      error: `Cannot build SEC archive URLs for ${normalized}.`,
    };
  }

  try {
    const response = await secFetch(archiveUrls.indexJsonUrl);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        entry: null,
        error: response.statusText || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      status: 200,
      entry: {
        title: `SEC filing ${normalized}`,
        updated: null,
        detailUrl: archiveUrls.indexHtmlUrl,
        summary: null,
        formType: null,
        requestedFormType: null,
      } satisfies SecCurrentFeedEntry,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      entry: null,
      error: error instanceof Error ? error.message : "SEC archive accession fallback failed",
    };
  }
}

function yearFromAccessionNumber(accessionNumber: string) {
  const match = normalizeAccessionNumber(accessionNumber)?.match(/^\d{10}-(\d{2})-\d{6}$/);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function quartersToSearch(year: number) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const quarters = [1, 2, 3, 4];
  if (year !== currentYear) return quarters;
  return quarters.sort((a, b) => Math.abs(a - currentQuarter) - Math.abs(b - currentQuarter));
}

function parseCurrentFeed(xml: string, formType: string): SecCurrentFeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const entries = arrayOf(parsed?.feed?.entry);

  return entries.map((entry) => {
    const link = Array.isArray(entry.link) ? entry.link[0] : entry.link;
    const actualFormType = readCurrentFeedEntryFormType(entry) || normalizeFormType(formType) || null;
    return {
      title: stringValue(entry.title) || null,
      updated: normalizeDateTime(entry.updated),
      detailUrl: absoluteSecUrl(stringValue(link?.href)),
      summary: stringValue(entry.summary) || null,
      formType: actualFormType,
      requestedFormType: normalizeFormType(formType) || null,
    };
  });
}

function secFeedOwnerModeForForm(formType: string) {
  return isOwnershipIntegrationForm(formType) ? "only" : "include";
}

function feedCountForForm(formType: string, countPerForm: number) {
  return isOwnershipIntegrationForm(formType) ? Math.min(countPerForm * 10, 100) : countPerForm;
}

function readCurrentFeedEntryFormType(entry: Record<string, unknown>) {
  const categories = arrayOf(entry.category);
  for (const category of categories) {
    if (!isRecord(category)) continue;
    const label = stringValue(category.label).toLowerCase();
    const term = normalizeFormType(category.term);
    if (term && (!label || label === "form type")) return term;
  }

  const titlePrefix = stringValue(entry.title).match(/^\s*([A-Z0-9][A-Z0-9 /\-]*?(?:\/A)?)\s+-/i)?.[1];
  return normalizeFormType(titlePrefix) || null;
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
      filingDate: null,
      acceptedAt: null,
      acceptedAtSource: null,
      fileNumber: null,
      registrationNumber: null,
      secAct: null,
      filmNumber: null,
      sc13IndexProvenance: null,
    };
  }

  const companyName = readCompanyNameFromDetailHtml(html);
  const filingDate = readFilingDateFromDetailHtml(html);
  const acceptedAt = readAcceptedDateTimeFromDetailHtml(html);
  const acceptedAtSource = readAcceptedDateTimeSourceFromDetailHtml(html);
  const filingIndexMetadata = readFilingIndexMetadataFromDetailHtml(html);
  const documents = parseFilingDocuments(html, detailUrl, formType);
  const effectiveFormType = formType || inferPrimaryFormTypeFromDocuments(documents);
  const sc13IndexProvenance = readSc13IndexProvenanceFromDetailHtml(html, documents, effectiveFormType);
  const selectedDocuments = selectDocumentsForText(documents, attachmentLimit, effectiveFormType);
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

    const sc13CanonicalCandidate = isSc13CanonicalXmlDocumentCandidate(document, effectiveFormType);
    try {
      const documentResponse = await secFetch(document.url);
      if (!documentResponse.ok) {
        documentsFailed += 1;
        documentsWithText.push({
          ...document,
          fetchStatus: documentResponse.status,
          fetchError: documentResponse.statusText || `HTTP ${documentResponse.status}`,
          sc13RawCaptureStatus: sc13CanonicalCandidate ? "fetch_failed" : undefined,
          sc13RawCaptureError: sc13CanonicalCandidate
            ? documentResponse.statusText || `HTTP ${documentResponse.status}`
            : null,
        });
        continue;
      }

      const contentType = documentResponse.headers.get("content-type");
      if (!isSecTextDocumentResponse(document, contentType)) {
        documentsWithText.push({
          ...document,
          fetchStatus: documentResponse.status,
          textExtractionStatus: "not_extracted_binary_or_graphic",
          sc13RawCaptureStatus: sc13CanonicalCandidate ? "unsupported_response" : undefined,
          sc13RawCaptureError: sc13CanonicalCandidate
            ? `Unsupported content type: ${contentType || "unknown"}`
            : null,
        });
        continue;
      }

      const text = await documentResponse.text();

      const cleaned = cleanDocumentText(text);
      const retainAnalysisText = shouldRetainSecDocumentAnalysisText(
        document,
        effectiveFormType,
        cleaned,
      );
      const truncated = cleaned.length > MAX_DOCUMENT_TEXT_CHARS;
      const primaryRawHtml = buildPrimaryDocumentHtmlSource(document, text);
      const periodicReportEvidence = extractPeriodicReportIngestEvidence({
        cleanedText: cleaned,
        formType: effectiveFormType,
        html: text,
        isPrimary: document.isPrimary,
        isAnnualReportAttachment: isPeriodicAnnualReportAttachment(
          document,
          effectiveFormType,
          cleaned,
        ),
        isMachineReadableXbrl: isMachineReadableXbrlDocument(document),
        sourceDocument: document.document || document.url,
      });
      const rawOwnershipSource = buildOwnershipRawSource({
        document,
        formType: effectiveFormType,
        text,
      });
      const rawSc13Source = buildSc13RawSource({
        document,
        formType: effectiveFormType,
        text,
      });
      const retainDocumentAnalysisText = retainAnalysisText && !(sc13CanonicalCandidate && !document.isPrimary);
      documentsFetched += 1;
      documentsWithText.push({
        ...document,
        text: retainDocumentAnalysisText
          ? truncated ? cleaned.slice(0, MAX_DOCUMENT_TEXT_CHARS) : cleaned
          : null,
        textCharCount: cleaned.length,
        textTruncated: truncated,
        rawText: rawOwnershipSource?.text || null,
        rawTextCharCount: rawOwnershipSource?.charCount || 0,
        rawTextTruncated: Boolean(rawOwnershipSource?.truncated),
        rawSourceFormat: rawOwnershipSource?.format || null,
        form25OriginalSource: captureForm25Document(effectiveFormType, document, text),
        s8OriginalSource: captureS8Document(effectiveFormType, document, text),
        sc13RawText: rawSc13Source ? rawSc13Source.text : null,
        sc13RawTextCharCount: rawSc13Source?.charCount || 0,
        sc13RawTextTruncated: Boolean(rawSc13Source?.truncated),
        sc13RawSourceFormat: rawSc13Source?.format || null,
        sc13RawCaptureStatus: rawSc13Source?.captureStatus,
        sc13RawCaptureError: rawSc13Source?.captureError || null,
        rawHtml: primaryRawHtml?.html || null,
        rawHtmlCharCount: primaryRawHtml?.charCount || 0,
        rawHtmlTruncated: Boolean(primaryRawHtml?.truncated),
        periodicReportCoreXbrlFacts: periodicReportEvidence?.xbrlFacts || [],
        periodicReportCoreSourceBlocks: periodicReportEvidence?.sourceBlocks || [],
        fetchStatus: documentResponse.status,
        textExtractionStatus: sc13CanonicalCandidate && !document.isPrimary
          ? "canonical_sc13_xml_preserved_not_added_to_analysis_text"
          : retainAnalysisText
            ? "text_extracted"
            : "text_extracted_not_retained_unrelated_40f_exhibit",
      });
    } catch (error) {
      documentsFailed += 1;
      documentsWithText.push({
        ...document,
        fetchError: error instanceof Error ? error.message : "Document fetch failed",
        sc13RawCaptureStatus: sc13CanonicalCandidate ? "fetch_failed" : undefined,
        sc13RawCaptureError: sc13CanonicalCandidate
          ? error instanceof Error ? error.message : "Document fetch failed"
          : null,
      });
    }
  }

  return {
    documents: documentsWithText,
    documentsRequested: selectedDocuments.size,
    documentsFetched,
    documentsFailed,
    companyName,
    filingDate,
    acceptedAt,
    acceptedAtSource,
    fileNumber: filingIndexMetadata.fileNumber,
    registrationNumber: filingIndexMetadata.registrationNumber,
    secAct: filingIndexMetadata.secAct,
    filmNumber: filingIndexMetadata.filmNumber,
    sc13IndexProvenance,
  };
}

function readSc13IndexProvenanceFromDetailHtml(
  html: string,
  documents: SecDocument[],
  formType: string | null,
) {
  if (!isSchedule13FormType(formType) && !/^25(?:-NSE)?(?:\/A)?$/i.test(formType || "")) return null;
  const subjectCiks: string[] = [];
  const filedByCiks: string[] = [];
  for (const match of html.matchAll(/<span[^>]+class=["'][^"']*companyName[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)) {
    const block = match[1] || "";
    const cik = extractFirst(block, /[?&]CIK=(\d{1,10})\b/i);
    if (!cik) continue;
    if (/\(Subject\)/i.test(block)) subjectCiks.push(cik);
    if (/\(Filed by\)/i.test(block)) filedByCiks.push(cik);
  }
  const canonicalXmlUrl = documents.find((document) => isSc13CanonicalXmlDocumentCandidate(document, formType))?.url || null;
  return {
    subjectCik: subjectCiks.length === 1 ? subjectCiks[0]! : null,
    subjectCikCount: subjectCiks.length,
    filedByCiks: Array.from(new Set(filedByCiks)),
    canonicalXmlUrl,
  };
}

function parseFilingDocuments(html: string, detailUrl: string, formType: string | null): SecDocument[] {
  const documents: SecDocument[] = [];
  const seenUrls = new Set<string>();
  const tables = [...html.matchAll(
    /<table[^>]+summary=["'](?:Document Format Files|Data Files)["'][^>]*>([\s\S]*?)<\/table>/gi,
  )];

  for (const tableMatch of tables) {
    const table = tableMatch[1] || "";
    for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1] || "";
      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] || "");
      if (cells.length < 4) continue;

      const linkHref = extractFirst(cells[2], /<a[^>]+href=["']([^"']+)["'][^>]*>/i);
      const documentUrl = absoluteSecUrl(linkHref, detailUrl);
      if (!documentUrl || seenUrls.has(documentUrl)) continue;
      seenUrls.add(documentUrl);
      documents.push({
        sequence: cleanInlineText(cells[0]) || null,
        description: cleanInlineText(cells[1]) || null,
        document: cleanInlineText(cells[2]) || null,
        type: cleanInlineText(cells[3]) || null,
        size: cleanInlineText(cells[4]) || null,
        url: documentUrl,
        isPrimary: false,
        text: null,
        textCharCount: 0,
        textTruncated: false,
      });
    }
  }

  if (!documents.length) return [];

  const effectiveFormType = formType || inferPrimaryFormTypeFromDocuments(documents);
  const primaryIndex = documents.findIndex((document) => isPrimaryDocument(document, effectiveFormType));
  if (primaryIndex >= 0) {
    documents[primaryIndex] = { ...documents[primaryIndex], isPrimary: true };
  } else if (documents[0]) {
    documents[0] = { ...documents[0], isPrimary: true };
  }

  return documents;
}

function inferPrimaryFormTypeFromDocuments(documents: SecDocument[]) {
  const preferred = documents
    .map((document) => normalizeFormType(document.type))
    .find((type) => Boolean(type && !isCompleteSubmissionDocumentType(type)));
  return preferred || null;
}

function isCompleteSubmissionDocumentType(value: string | null) {
  const type = normalizeFormType(value);
  return !type || type === "XML" || type === "HTML" || type === "TXT" || type === "GRAPHIC";
}

function selectDocumentsForText(documents: SecDocument[], attachmentLimit: number, formType: string | null) {
  const selected = new Set<string>();
  const primary = documents.find((document) => document.isPrimary);
  if (primary?.url) selected.add(primary.url);
  const effectiveFormType = formType || inferPrimaryFormTypeFromDocuments(documents);
  const fetchPlan = getSecFormFetchPlan(effectiveFormType);

  if (isOwnershipXmlCaptureForm(effectiveFormType)) {
    for (const document of documents) {
      if (!document.url || selected.has(document.url)) continue;
      if (isOwnershipXmlDocumentCandidate(document)) selected.add(document.url);
    }
  }

  if (isSchedule13FormType(effectiveFormType)) {
    for (const document of documents) {
      if (!document.url || selected.has(document.url)) continue;
      if (isSc13CanonicalXmlDocumentCandidate(document, effectiveFormType)) selected.add(document.url);
    }
  }

  if (isOfferingFeeTableForm(effectiveFormType)) {
    for (const document of documents) {
      if (!document.url || document.isPrimary) continue;
      if (isFilingFeeTableDocument(document)) selected.add(document.url);
    }
  }

  if (isPeriodicReportForm(effectiveFormType)) {
    let xbrlDocumentCount = 0;
    for (const document of documents) {
      if (xbrlDocumentCount >= 3) break;
      if (!document.url || document.isPrimary) continue;
      if (selected.has(document.url)) continue;
      if (isMachineReadableXbrlDocument(document)) {
        selected.add(document.url);
        xbrlDocumentCount += 1;
      }
    }
  }

  if (fetchPlan) {
    for (const rule of fetchPlan.rules) {
      let matchedDocumentCount = 0;
      const maxDocuments = Math.max(1, rule.maxDocuments ?? fetchPlan.defaultAttachmentLimit);
      for (const document of documents) {
        if (matchedDocumentCount >= maxDocuments) break;
        if (!document.url || document.isPrimary) continue;
        if (selected.has(document.url)) continue;
        if (isSecTextFetchCandidate(document) && matchesSecFormFetchRule(document, rule)) {
          selected.add(document.url);
          matchedDocumentCount += 1;
        }
      }
    }
  }

  let selectedAttachmentCount = 0;
  for (const document of documents) {
    if (selectedAttachmentCount >= attachmentLimit) break;
    if (!document.url || document.isPrimary) continue;
    if (selected.has(document.url)) continue;
    if (isSecTextFetchCandidate(document) && isInterestingAttachment(document)) {
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
  return /^(?:S-3|F-3)(?:ASR|MEF|\/A)?$/i.test(normalizeFormType(formType));
}

function isSecTextDocumentResponse(document: SecDocument, contentType: string | null) {
  if (!isSecTextFetchCandidate(document)) return false;
  const normalized = stringValue(contentType).toLowerCase();
  if (!normalized) return true;
  if (/^(?:image|audio|video)\//.test(normalized)) return false;
  if (/\bapplication\/(?:pdf|zip|gzip|x-7z-compressed|x-rar-compressed|octet-stream)\b/.test(normalized)) {
    return false;
  }
  return !/^font\//.test(normalized);
}

function isPeriodicAnnualReportAttachment(
  document: SecDocument,
  formType: string | null,
  cleanedText = "",
) {
  const normalizedFormType = normalizeFormType(formType);
  const type = stringValue(document.type).toUpperCase();
  const label = `${document.description || ""} ${document.document || ""}`;
  if (/^40-F(?:\/A)?$/i.test(normalizedFormType)) {
    if (!/^EX-99(?:\.|$)/i.test(type)) return false;
    return isRelevant40FAnnualReportText(cleanedText) ||
      /annual information form|management'?s discussion and analysis|annual financial statements/i.test(label);
  }
  if (!/^20-F(?:\/A)?$/i.test(normalizedFormType)) return false;
  return type === "EX-15.1" || (
    type.startsWith("EX-15") && /annual report|financial statements/i.test(label)
  );
}

function shouldRetainSecDocumentAnalysisText(
  document: SecDocument,
  formType: string | null,
  cleanedText: string,
) {
  if (document.isPrimary || !/^40-F(?:\/A)?$/i.test(normalizeFormType(formType))) {
    return true;
  }
  const type = stringValue(document.type).toUpperCase();
  if (!/^EX-99(?:\.|$)/i.test(type)) return true;
  return isPeriodicAnnualReportAttachment(document, formType, cleanedText);
}

function isRelevant40FAnnualReportText(text: string) {
  const sample = text.slice(0, 1_000_000);
  const lead = sample.slice(0, 5_000);
  if (
    /\bMANAGEMENT.{0,24}RESPONSIBILITY FOR FINANCIAL STATEMENTS\b/i.test(lead) ||
    /\bTHE ACCOMPANYING CONSOLIDATED FINANCIAL STATEMENTS\b/i.test(lead)
  ) {
    return true;
  }
  if (
    /\bCONSENT OF (?:AN?\s+)?(?:INDEPENDENT|EXPERT)\b/i.test(lead) ||
    /\bCERTIFICATION (?:REQUIRED BY|PURSUANT TO)\b/i.test(lead) ||
    /\bMANAGEMENT['’]?S REPORT ON INTERNAL CONTROL OVER FINANCIAL REPORTING\b/i.test(lead)
  ) {
    return false;
  }
  return /\bANNUAL INFORMATION FORM\b/i.test(sample) ||
    /\bMANAGEMENT['’]?S DISCUSSION AND ANALYSIS OF (?:FINANCIAL CONDITION|FINANCIAL AND OPERATING RESULTS|OPERATIONS)\b/i.test(sample) ||
    /\b(?:AUDITED\s+)?(?:CONSOLIDATED\s+)?FINANCIAL STATEMENTS\b/i.test(sample);
}

function isOfferingFeeTableForm(formType: string | null) {
  const form = normalizeFormType(formType);
  return (
    isS3FamilyForm(form) ||
    /^(?:S-1|F-1|S-1\/A|F-1\/A|S-1MEF|F-1MEF|POS AM|S-8|S-8\/A|424B3|424B5|S-4|S-4\/A|F-4|F-4\/A)$/i.test(form)
  );
}

function isPeriodicReportForm(formType: string | null) {
  return /^(?:10-K|10-K\/A|10-Q|10-Q\/A|20-F|20-F\/A|40-F|40-F\/A)$/i.test(normalizeFormType(formType));
}

function isMachineReadableXbrlDocument(document: SecDocument) {
  const label = `${stringValue(document.type)} ${stringValue(document.description)} ${stringValue(document.document)} ${stringValue(document.url)}`;
  return /\bEX-101\b|INSTANCE\s+DOCUMENT|_htm\.xml\b|\.xml(?:$|[?#])/i.test(label);
}

function isOwnershipIntegrationForm(formType: string | null) {
  const form = normalizeFormType(formType);
  return form === "4" || form === "4/A" || form === "144" || form === "144/A";
}

function isOwnershipXmlCaptureForm(formType: string | null) {
  const form = normalizeFormType(formType);
  return form === "3"
    || form === "3/A"
    || form === "4"
    || form === "4/A"
    || form === "5"
    || form === "5/A"
    || form === "144"
    || form === "144/A";
}

function isSection16XmlParserForm(formType: string | null) {
  const form = normalizeFormType(formType);
  return form === "3" || form === "3/A" || form === "5" || form === "5/A";
}

function buildOwnershipRawSource({
  document,
  formType,
  text,
}: {
  document: SecDocument;
  formType: string | null;
  text: string;
}) {
  if (!isOwnershipXmlCaptureForm(formType)) return null;

  const format = detectOwnershipRawSourceFormat(document, text);
  if (!format) return null;

  const truncated = text.length > MAX_OWNERSHIP_SOURCE_TEXT_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_OWNERSHIP_SOURCE_TEXT_CHARS) : text,
    charCount: text.length,
    truncated,
    format,
  };
}

function buildSc13RawSource({
  document,
  formType,
  text,
}: {
  document: SecDocument;
  formType: string | null;
  text: string;
}) {
  if (!isSchedule13FormType(formType) || !isSc13CanonicalXmlDocumentCandidate(document, formType)) return null;
  const truncated = text.length > MAX_SC13_SOURCE_TEXT_CHARS;
  const hasSubmissionRoot = /<(?:[A-Za-z_][\w.-]*:)?edgarSubmission\b/i.test(text);
  const hasSupportedNamespace = /xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*["']http:\/\/www\.sec\.gov\/edgar\/schedule13(?:D|g)["']/i.test(text);
  const isRecognizedFormat = hasSubmissionRoot && hasSupportedNamespace;
  const captureStatus: NonNullable<SecDocument["sc13RawCaptureStatus"]> = !text.trim()
    ? "empty"
    : !isRecognizedFormat
      ? "invalid_format"
      : truncated
        ? "truncated"
        : "preserved";
  const captureError = captureStatus === "empty"
    ? "Canonical Schedule 13 response body was empty."
    : captureStatus === "invalid_format"
      ? "Canonical Schedule 13 response did not contain a supported edgarSubmission namespace."
      : captureStatus === "truncated"
        ? `Canonical Schedule 13 response exceeded ${MAX_SC13_SOURCE_TEXT_CHARS} characters.`
        : null;
  return {
    text: truncated ? text.slice(0, MAX_SC13_SOURCE_TEXT_CHARS) : text,
    charCount: text.length,
    truncated,
    format: isRecognizedFormat ? "sec_schedule_13_xml" : null,
    captureStatus,
    captureError,
  };
}

function isSc13CanonicalXmlDocumentCandidate(document: SecDocument, formType: string | null) {
  if (!isSchedule13FormType(formType)) return false;
  const documentName = stringValue(document.document);
  const url = stringValue(document.url);
  if (!/(?:^|\/)primary_doc\.xml(?:$|[?#])/i.test(documentName || url)) return false;
  const documentType = canonicalSecFormTypeForCompare(document.type);
  const expectedType = canonicalSecFormTypeForCompare(formType);
  return !documentType || documentType === expectedType;
}

function detectOwnershipRawSourceFormat(document: SecDocument, text: string) {
  if (/<(?:ownershipDocument|edgarSubmission)\b/i.test(text)) return "ownership_xml";

  if (isOwnershipXmlDocumentCandidate(document) && /^\s*(?:<\?xml|<XML>|<SEC-DOCUMENT\b)/i.test(text)) {
    return "raw_xml";
  }

  return null;
}

function isOwnershipXmlDocumentCandidate(document: SecDocument) {
  const documentName = stringValue(document.document);
  const url = stringValue(document.url);
  if (!/\.xml(?:$|[?#])/i.test(documentName || url)) return false;
  return !/\/xsl(?:F345|144)/i.test(url);
}

function isFilingFeeTableDocument(document: SecDocument) {
  const label = `${stringValue(document.type)} ${stringValue(document.description)} ${stringValue(document.document)}`;
  return /\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(label);
}

function buildPrimaryDocumentHtmlSource(document: SecDocument, text: string) {
  if (!document.isPrimary || !text.trim()) return null;
  if (!isHtmlLikeDocument(document, text)) return null;

  const truncated = text.length > MAX_PRIMARY_DOCUMENT_HTML_CHARS;
  return {
    html: truncated ? text.slice(0, MAX_PRIMARY_DOCUMENT_HTML_CHARS) : text,
    charCount: text.length,
    truncated,
  };
}

function isHtmlLikeDocument(document: SecDocument, text: string) {
  const label = `${stringValue(document.document)} ${stringValue(document.type)} ${stringValue(document.url)}`;
  return (
    /\.(?:htm|html)(?:$|[?#])/i.test(label) ||
    /^(?:HTML|HTM)$/i.test(normalizeFormType(document.type)) ||
    /<html[\s>]/i.test(text) ||
    /<body[\s>]/i.test(text) ||
    /<table[\s>]/i.test(text)
  );
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

function summarizeDocumentSourceFailure(detailUrl: string, documents: SecDocument[]) {
  const failedDocuments = documents.filter((document) => document.fetchError || document.fetchStatus);
  const status = failedDocuments.find((document) => document.fetchStatus)?.fetchStatus || 502;
  const reasons = Array.from(
    new Set(
      failedDocuments
        .map((document) => {
          const label = document.document || document.type || "filing document";
          const reason = document.fetchError || (document.fetchStatus ? `HTTP ${document.fetchStatus}` : "fetch failed");
          return `${label}: ${reason}`;
        })
        .filter(Boolean),
    ),
  ).slice(0, 3);
  const suffix = reasons.length ? ` (${reasons.join("; ")})` : "";

  return {
    status,
    message: `SEC filing source text could not be retrieved from ${detailUrl}${suffix}`,
  };
}

function readOwnershipIssuerIdentity(text: string) {
  const issuerInfoBlock = extractXmlBlock(text, "issuer") || extractXmlBlock(text, "issuerInfo") || text;
  const cik = normalizeCik(firstXmlValue(issuerInfoBlock, "issuerCik") || firstXmlValue(text, "issuerCik"));
  const ticker = normalizeTicker(firstXmlValue(issuerInfoBlock, "issuerTradingSymbol") || firstXmlValue(text, "issuerTradingSymbol"));
  const name =
    firstXmlValue(issuerInfoBlock, "issuerName") ||
    firstXmlValue(text, "issuerName") ||
    firstXmlValue(issuerInfoBlock, "nameOfIssuer") ||
    null;

  return cik || ticker || name ? { cik, ticker, name } : null;
}

function readSchedule13IssuerIdentity(primary: SecDocument | null, bodyText: string) {
  const rawSources = [
    stringValue(primary?.rawHtml),
    stringValue(primary?.rawText),
    stringValue(primary?.text),
    bodyText,
  ].filter(Boolean);
  const combined = rawSources.join("\n\n");
  const name = readSchedule13IssuerName(combined);
  const cik =
    normalizeCik(firstXmlValue(combined, "issuerCik")) ||
    normalizeCik(firstXmlValue(combined, "issuerCIK")) ||
    normalizeCik(firstXmlValue(combined, "cik"));
  const ticker =
    normalizeTicker(firstXmlValue(combined, "issuerTradingSymbol")) ||
    normalizeTicker(firstXmlValue(combined, "tradingSymbol"));

  return cik || ticker || name ? { cik, ticker, name } : null;
}

function readVerifiedSchedule13TickerIssuer({
  source,
  formType,
  accessionNumber,
  indexProvenance,
}: {
  source: SecDocument | null;
  formType: string | null;
  accessionNumber: string | null;
  indexProvenance: {
    subjectCik: string | null;
    subjectCikCount: number;
    filedByCiks: string[];
    canonicalXmlUrl: string | null;
  } | null;
}) {
  if (!source || source.sc13RawCaptureStatus !== "preserved" || !indexProvenance) return null;

  const structural = parseSc13StructuralXml({
    rawXml: source.sc13RawText,
    sourceFormat: source.sc13RawSourceFormat,
    sourceUrl: source.url,
    expectedAccessionNumber: accessionNumber,
    expectedFormType: formType,
    sourceTextCharCount: source.sc13RawTextCharCount,
    sourceTextTruncated: source.sc13RawTextTruncated,
    indexSubjectCik: indexProvenance.subjectCik,
    indexSubjectCikCount: indexProvenance.subjectCikCount,
    indexFiledByCiks: indexProvenance.filedByCiks,
    indexCanonicalXmlUrl: indexProvenance.canonicalXmlUrl,
  });
  if (structural.status !== "parsed" || !structural.filing || structural.provenance.indexStatus !== "verified") {
    return null;
  }

  const cik = normalizeCik(structural.filing.issuer.issuerCikRaw);
  return cik
    ? { cik, ticker: null, name: structural.filing.issuer.issuerNameRaw }
    : null;
}

function readSchedule13IssuerName(text: string) {
  const htmlName =
    extractFirst(
      text,
      /<div[^>]*>\s*([\s\S]{1,300}?)\s*<\/div>\s*<div[^>]*>\s*(?:<hr[^>]*>\s*)?\(Name\s+of\s+Issuer\)/i,
    ) ||
    extractFirst(
      text,
      /<span[^>]*>\s*([\s\S]{1,300}?)\s*<\/span>\s*<[^>]+>\s*(?:<hr[^>]*>\s*)?\(Name\s+of\s+Issuer\)/i,
    );
  const cleanedHtmlName = cleanSchedule13IssuerName(htmlName);
  if (cleanedHtmlName) return cleanedHtmlName;

  const cleanText = cleanDocumentText(text);
  const lines = cleanText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    if (!/\(Name\s+of\s+Issuer\)/i.test(lines[index])) continue;

    const sameLine = lines[index].replace(/\(Name\s+of\s+Issuer\)/i, "").replace(/\|/g, " ").trim();
    const sameLineName = cleanSchedule13IssuerName(sameLine);
    if (sameLineName) return sameLineName;

    for (let lookback = index - 1; lookback >= Math.max(0, index - 4); lookback -= 1) {
      const candidate = cleanSchedule13IssuerName(lines[lookback]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function cleanSchedule13IssuerName(value: string | null | undefined) {
  const cleaned = cleanInlineText(stringValue(value))
    .replace(/^\(?\s*Amendment\s+No\.?\s*\d+\s*\)?\s*/i, "")
    .replace(/\(Name\s+of\s+Issuer\)/gi, "")
    .replace(/\s+CIK\s*:?.*$/i, "")
    .replace(/\s+\((?:Subject|Issuer)\).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^(?:SCHEDULE\s+13[DG]|UNDER\s+THE\s+SECURITIES|SECURITIES\s+AND\s+EXCHANGE|WASHINGTON|CUSIP|TITLE\s+OF\s+CLASS)$/i.test(cleaned)) {
    return null;
  }
  if (cleaned.length < 3 || cleaned.length > 160) return null;
  return cleaned;
}

function resolveVerifiedSchedule13TickerRows(
  lookup: Map<string, TickerRow[]>,
  issuer: { cik: string | null; ticker: string | null; name: string | null } | null,
): TickerResolution {
  const issuerRows = issuer?.cik ? lookup.get(issuer.cik) || [] : [];
  if (issuerRows.length) {
    return {
      rows: issuerRows,
      primary: selectPrimaryTickerRow(issuerRows),
      source: "issuer_cik_sec",
      confidence: "high",
      reason: "Verified canonical Schedule 13 XML issuer CIK matched SEC company ticker table.",
      cusip: null,
    };
  }

  return {
    rows: [],
    primary: null,
    source: "unresolved",
    confidence: "none",
    reason: issuer?.cik
      ? "Verified canonical Schedule 13 XML issuer CIK did not match SEC company ticker table."
      : "Canonical Schedule 13 XML issuer provenance could not be verified; no alternate ticker identity was used.",
    cusip: null,
  };
}

async function resolveTrustedTickerRows({
  lookup,
  formType,
  filerCik,
  issuer,
  cusips,
}: {
  lookup: Map<string, TickerRow[]>;
  formType: string | null;
  filerCik: string | null;
  issuer: { cik: string | null; ticker: string | null; name: string | null } | null;
  cusips: string[];
}): Promise<TickerResolution> {
  const issuerTicker = normalizeTicker(issuer?.ticker);
  const issuerRows = issuer?.cik ? lookup.get(issuer.cik) || [] : [];
  const primaryCusip = cusips[0] || null;

  if (issuerTicker) {
    const exact = selectSourceBackedSecTickerRow(issuerRows, issuerTicker);
    if (exact) {
      return {
        rows: issuerRows,
        primary: exact,
        source: "issuer_trading_symbol_and_cik_sec",
        confidence: "high",
        reason:
          "Issuer trading symbol and CIK matched the SEC company ticker table.",
        cusip: primaryCusip,
      };
    }

    const row: TickerRow = {
      cik: issuer?.cik || "",
      ticker: issuerTicker,
      exchange: null,
      name: issuer?.name || null,
    };
    return {
      rows: [row],
      primary: row,
      source: "issuer_trading_symbol",
      confidence: "high",
      reason: "Issuer trading symbol was present in filing text.",
      cusip: primaryCusip,
    };
  }

  if (issuerRows.length) {
    const primary = selectPrimaryTickerRow(issuerRows);
    return {
      rows: issuerRows,
      primary,
      source: "issuer_cik_sec",
      confidence: "high",
      reason: "Issuer CIK matched SEC company ticker table.",
      cusip: primaryCusip,
    };
  }

  const fmpCusipRows = await resolveFmpCusipTickerRows(cusips, {
    issuerName: issuer?.name || null,
    issuerCik: issuer?.cik || filerCik,
  });
  if (fmpCusipRows.rows.length === 1 && fmpCusipRows.cusip) {
    const primary = fmpCusipRows.rows[0];
    return {
      rows: fmpCusipRows.rows,
      primary,
      source: "cusip_fmp_verified",
      confidence: "high",
      reason: "CUSIP exact match was verified by FMP search-cusip and profile data.",
      cusip: fmpCusipRows.cusip,
    };
  }

  if (isOwnershipIntegrationForm(formType)) {
    return {
      rows: [],
      primary: null,
      source: "unresolved",
      confidence: "none",
      reason: issuer?.cik
        ? "Issuer CIK did not match SEC company ticker table; issuer-name similarity fallback is disabled."
        : "No trusted issuer ticker or issuer CIK match was available; issuer-name similarity fallback is disabled.",
      cusip: primaryCusip,
    };
  }

  if (isSchedule13FormType(formType)) {
    return {
      rows: [],
      primary: null,
      source: "unresolved",
      confidence: "none",
      reason:
        "No trusted issuer ticker, issuer CIK, or verified CUSIP match was available; Schedule 13 accession CIK is not trusted as issuer ticker evidence.",
      cusip: primaryCusip,
    };
  }

  const filerRows = filerCik ? lookup.get(filerCik) || [] : [];
  if (filerRows.length) {
    const primary = selectPrimaryTickerRow(filerRows);
    return {
      rows: filerRows,
      primary,
      source: "accession_cik_sec",
      confidence: "high",
      reason: "SEC accession CIK matched SEC company ticker table.",
      cusip: primaryCusip,
    };
  }

  return {
    rows: [],
    primary: null,
    source: "unresolved",
    confidence: "none",
    reason: "No trusted ticker source was available.",
    cusip: primaryCusip,
  };
}

function extractIssuerCusips(values: Array<unknown>) {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const text = stringValue(value);
    if (!text) continue;
    for (const match of text.matchAll(/\bCUSIP(?:\s+(?:No\.?|Number))?[\s:|#-]*([A-Z0-9]{3,4}[\s-]?[A-Z0-9]{2,3}[\s-]?[A-Z0-9]{2,3})\b/gi)) {
      const cusip = normalizeCusip(match[1]);
      if (!cusip || seen.has(cusip)) continue;
      seen.add(cusip);
      found.push(cusip);
      if (found.length >= 4) return found;
    }
    for (const match of text.matchAll(/\(\s*CUSIP\s+Number(?:\s+of\s+Class\s+of\s+Securities)?\s*\)/gi)) {
      const beforeLabel = text.slice(Math.max(0, match.index - 160), match.index);
      const candidates = [...beforeLabel.matchAll(/\b[A-Z0-9]{9}\b/gi)].map((candidate) => candidate[0]);
      const cusip = normalizeCusip(candidates.at(-1));
      if (!cusip || seen.has(cusip)) continue;
      seen.add(cusip);
      found.push(cusip);
      if (found.length >= 4) return found;
    }
  }

  return found;
}

function normalizeCusip(value: unknown) {
  const cusip = stringValue(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{9}$/.test(cusip) ? cusip : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function resolveFmpCusipTickerRows(
  cusips: string[],
  context: { issuerName: string | null; issuerCik: string | null },
): Promise<{ rows: TickerRow[]; cusip: string | null }> {
  for (const cusip of cusips) {
    const rows = await fetchFmpCusipTickerRows(cusip, context);
    if (rows.length === 1) return { rows, cusip };
    if (rows.length > 1) return { rows: [], cusip };
  }
  return { rows: [], cusip: null };
}

function fetchFmpCusipTickerRows(cusip: string, context: { issuerName: string | null; issuerCik: string | null }) {
  const cacheKey = `${cusip}:${context.issuerCik || ""}:${context.issuerName || ""}`;
  if (!fmpCusipLookupCache.has(cacheKey)) {
    fmpCusipLookupCache.set(cacheKey, fetchFmpCusipTickerRowsInner(cusip, context));
  }
  return fmpCusipLookupCache.get(cacheKey)!;
}

async function fetchFmpCusipTickerRowsInner(cusip: string, context: { issuerName: string | null; issuerCik: string | null }) {
  const env = getServerEnv();
  if (!env.fmpApiKey) return [];

  const searchUrl = new URL("https://financialmodelingprep.com/stable/search-cusip");
  searchUrl.searchParams.set("cusip", cusip);
  searchUrl.searchParams.set("apikey", env.fmpApiKey);

  const searchResponse = await fetch(searchUrl, { cache: "no-store" }).catch(() => null);
  if (!searchResponse?.ok) return [];
  const searchData = await searchResponse.json().catch(() => null);
  if (!Array.isArray(searchData) || searchData.length !== 1) return [];

  const searchRecord = recordValue(searchData[0]);
  const symbol = normalizeTicker(searchRecord?.symbol);
  if (!symbol) return [];

  const profileUrl = new URL("https://financialmodelingprep.com/stable/profile");
  profileUrl.searchParams.set("symbol", symbol);
  profileUrl.searchParams.set("apikey", env.fmpApiKey);

  const profileResponse = await fetch(profileUrl, { cache: "no-store" }).catch(() => null);
  if (!profileResponse?.ok) return [];
  const profileData = await profileResponse.json().catch(() => null);
  const profile = Array.isArray(profileData) ? recordValue(profileData[0]) : null;
  if (!isFmpCusipTickerProfileTrusted(profile, cusip, context)) return [];

  return [
    {
      cik: normalizeCik(profile?.cik) || "",
      ticker: symbol,
      exchange: stringValue(profile?.exchange) || stringValue(profile?.exchangeShortName) || null,
      name: stringValue(profile?.companyName) || stringValue(searchRecord?.companyName) || null,
    },
  ];
}

function isFmpCusipTickerProfileTrusted(
  profile: Record<string, unknown> | null,
  cusip: string,
  context: { issuerName: string | null; issuerCik: string | null },
) {
  if (!profile) return false;
  const symbol = normalizeTicker(profile.symbol);
  if (!symbol) return false;

  const profileCusip = normalizeCusip(profile.cusip);
  const profileIsin = stringValue(profile.isin).toUpperCase();
  if (profileCusip !== cusip && !profileIsin.includes(cusip)) return false;

  const profileCik = normalizeCik(profile.cik);
  const issuerCik = normalizeCik(context.issuerCik);
  if (issuerCik && profileCik && issuerCik === profileCik) return true;

  const profileName = stringValue(profile.companyName);
  if (context.issuerName && profileName && companyNamesClearlyMatch(context.issuerName, profileName)) return true;

  return false;
}

function companyNamesClearlyMatch(left: string, right: string) {
  const leftTokens = companyNameMatchTokens(left);
  const rightTokens = companyNameMatchTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token));
  return overlap.length >= Math.min(2, leftTokens.length, rightTokens.length);
}

function companyNameMatchTokens(value: string) {
  return cleanInlineText(value)
    .toUpperCase()
    .replace(/\b(?:UNDER|SECURITIES|EXCHANGE|ACT|OF|1934|SCHEDULE|FORM|ISSUER|NAME)\b/g, " ")
    .replace(/\b(?:INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|LLC|LP|HOLDINGS?|GROUP)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function extractXmlBlock(text: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`, "i"));
  return match?.[0] || null;
}

function firstXmlValue(text: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? cleanInlineText(match[1]) : null;
}

export async function fetchTickerLookup(fresh = false): Promise<Map<string, TickerRow[]>> {
  return tickerCatalogCache.get(fresh);
}

async function fetchTickerLookupInner() {
  const response = await secFetch(SEC_COMPANY_TICKERS_EXCHANGE_URL);
  if (!response.ok) throw new Error(`SEC ticker catalog HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.fields) || !data.fields.every((field: unknown) => typeof field === "string" && field.trim()) ||
      !Array.isArray(data.data) || !data.data.length) throw new Error("SEC ticker catalog invalid schema");
  const fields: string[] = data.fields.map((field: string) => stringValue(field));
  const rows: unknown[] = data.data;
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const tickerIndex = fields.indexOf("ticker");
  const exchangeIndex = fields.indexOf("exchange");
  if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].some((index) => index < 0) || new Set(fields).size !== fields.length) {
    throw new Error("SEC ticker catalog invalid fields");
  }
  const lookup = new Map<string, TickerRow[]>();

  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== fields.length ||
        !((typeof row[cikIndex] === "number" && Number.isSafeInteger(row[cikIndex]) && row[cikIndex] > 0 && row[cikIndex] <= 9_999_999_999) ||
          (typeof row[cikIndex] === "string" && /^\d{1,10}$/.test(row[cikIndex].trim()) && Number(row[cikIndex]) > 0)) ||
        typeof row[tickerIndex] !== "string" || !row[tickerIndex].trim() ||
        ![nameIndex, exchangeIndex].every((index) => row[index] === null || typeof row[index] === "string")) {
      throw new Error("SEC ticker catalog invalid row");
    }
    const cik = normalizeCik(row[cikIndex]);
    const ticker = stringValue(row[tickerIndex]).toUpperCase();
    if (!cik || !ticker) throw new Error("SEC ticker catalog invalid identity");
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

  return decodeSecHtmlEntities(withBreaks)
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

function readFilingDateFromDetailHtml(html: string) {
  const match = html.match(
    /<div[^>]+class=["']infoHead["'][^>]*>\s*Filing Date\s*<\/div>\s*<div[^>]+class=["']info["'][^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*<\/div>/i,
  );
  return normalizeDateOnly(match?.[1]);
}

function readAcceptedDateTimeFromDetailHtml(html: string) {
  const sourceValue = readAcceptedDateTimeSourceFromDetailHtml(html);
  if (!sourceValue) return null;
  const [datePart, timePart] = sourceValue.split(" ");
  return parseSecEasternDateTime(datePart, timePart);
}

function readAcceptedDateTimeSourceFromDetailHtml(html: string) {
  const match = html.match(
    /<div[^>]+class=["']infoHead["'][^>]*>\s*Accepted\s*<\/div>\s*<div[^>]+class=["']info["'][^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([0-9]{2}:[0-9]{2}:[0-9]{2})\s*<\/div>/i,
  );
  return match?.[1] && match?.[2] ? `${match[1]} ${match[2]}` : null;
}

function parseSecEasternDateTime(datePart: unknown, timePart: unknown) {
  const date = normalizeDateOnly(datePart);
  const time = stringValue(timePart);
  const match = date && time.match(/^([0-9]{2}):([0-9]{2}):([0-9]{2})$/);
  if (!date || !match) return null;
  const [year, month, day] = date.split("-").map(Number);
  const hour = Number(match[1]);
  const offset = isNewYorkDaylightTime(year, month, day, hour) ? "-04:00" : "-05:00";
  const parsed = new Date(`${date}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isNewYorkDaylightTime(year: number, month: number, day: number, hour: number) {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  const dstStartDay = nthWeekdayOfMonth(year, 3, 0, 2);
  const dstEndDay = nthWeekdayOfMonth(year, 11, 0, 1);
  if (month === 3) return day > dstStartDay || (day === dstStartDay && hour >= 2);
  return day < dstEndDay || (day === dstEndDay && hour < 2);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstWeekdayDate = 1 + ((weekday - firstDay + 7) % 7);
  return firstWeekdayDate + (occurrence - 1) * 7;
}

function readFilingIndexMetadataFromDetailHtml(html: string) {
  const companyInfo = extractFirst(html, /<div[^>]+class=["']companyInfo["'][^>]*>([\s\S]*?)<\/div>/i) || "";
  const text = cleanInlineText(companyInfo || html);
  const fileNumber = normalizeSecFileNumber(extractFirst(text, /\bFile\s+No\.?\s*:\s*([0-9]{1,3}-[A-Z0-9-]+)/i));
  const secAct = extractFirst(text, /\bAct\s*:\s*([0-9A-Z-]+)/i)?.toUpperCase() || null;
  const filmNumber = extractFirst(text, /\bFilm\s+No\.?\s*:\s*([0-9A-Z-]+)/i)?.toUpperCase() || null;

  return {
    fileNumber,
    registrationNumber: fileNumber && /^333-\d+/i.test(fileNumber) ? fileNumber : null,
    secAct,
    filmNumber,
  };
}

function normalizeSecFileNumber(value: unknown) {
  const text = stringValue(value).toUpperCase().replace(/\s+/g, "");
  return /^[0-9]{1,3}-[A-Z0-9-]+$/.test(text) ? text : null;
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
  const pathMatch =
    detailUrl.match(/\/Archives\/edgar\/data\/(\d+)\/(\d+)\//i) ||
    detailUrl.match(/\/Archives\/edgar\/data\/(\d+)\/([0-9]{10}-[0-9]{2}-[0-9]{6})-index\.html?/i);
  const cik = normalizeCik(pathMatch?.[1]);
  const accessionNoDashes = pathMatch?.[2]?.replace(/-/g, "") || null;
  const accessionFromFile = detailUrl.match(/\/([0-9]{10}-[0-9]{2}-[0-9]{6})-index\.html?/i)?.[1] || null;
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

function normalizeFormTypes(values: unknown, fallback: string[] = DEFAULT_FORM_TYPES) {
  const raw = Array.isArray(values) ? values : [];
  const formTypes = raw
    .flatMap((value) => stringValue(value).split(","))
    .map((value) => normalizeFormType(value))
    .filter(Boolean);
  return Array.from(new Set(formTypes.length ? formTypes : fallback));
}

function normalizeFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ");
}

function chooseRawItemFormType(entryFormType: unknown, primaryDocumentType: unknown) {
  const entryForm = normalizeFormType(entryFormType) || null;
  const primaryForm = normalizeFormType(primaryDocumentType) || null;
  if (!entryForm) return primaryForm;
  if (!primaryForm) return entryForm;
  if (entryForm === primaryForm) return entryForm;

  const entryBase = entryForm.replace(/\/A$/, "");
  const primaryBase = primaryForm.replace(/\/A$/, "");
  if (primaryForm.endsWith("/A") && entryBase === primaryBase) {
    return primaryForm;
  }

  return entryForm;
}

function secFormTypesMatch(requested: unknown, actual: unknown) {
  const requestedForm = canonicalSecFormTypeForCompare(requested);
  const actualForm = canonicalSecFormTypeForCompare(actual);
  return Boolean(requestedForm && actualForm && requestedForm === actualForm);
}

function isSchedule13FormType(value: unknown) {
  const form = canonicalSecFormTypeForCompare(value);
  return form === "SCHEDULE 13D" || form === "SCHEDULE 13D/A" || form === "SCHEDULE 13G" || form === "SCHEDULE 13G/A";
}

function canonicalSecFormTypeForCompare(value: unknown) {
  const form = normalizeFormType(value);
  if (/^SC 13D\/A$/.test(form)) return "SCHEDULE 13D/A";
  if (/^SC 13D$/.test(form)) return "SCHEDULE 13D";
  if (/^SC 13G\/A$/.test(form)) return "SCHEDULE 13G/A";
  if (/^SC 13G$/.test(form)) return "SCHEDULE 13G";
  return form;
}

function normalizeAccessionNumber(value: unknown) {
  const text = stringValue(value);
  const dashed = text.match(/\b(\d{10})-(\d{2})-(\d{6})\b/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  const compact = text.replace(/\D/g, "");
  if (compact.length !== 18) return null;
  return `${compact.slice(0, 10)}-${compact.slice(10, 12)}-${compact.slice(12, 18)}`;
}

function normalizeCik(value: unknown) {
  const text = stringValue(value).replace(/\D/g, "");
  if (!text) return null;
  return String(Number(text));
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) ? ticker : null;
}

function normalizeDateTime(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDateOnly(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function filterFeedEntriesByDateRange(
  entries: SecCurrentFeedEntry[],
  dateFrom: string | null,
  dateTo: string | null,
) {
  if (!dateFrom && !dateTo) return entries;
  return entries.filter((entry) => {
    const date = normalizeDateTime(entry.updated)?.slice(0, 10);
    if (!date) return false;
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    return true;
  });
}

function dedupeFeedEntries(entries: SecCurrentFeedEntry[]) {
  const seen = new Set<string>();
  const deduped: SecCurrentFeedEntry[] = [];
  for (const entry of entries) {
    const accessionNumber = parseFilingIdentity(entry.detailUrl || "").accessionNumber;
    const key = accessionNumber || entry.detailUrl || `${entry.title}:${entry.updated}`;
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
  return decodeSecHtmlEntities(value)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
