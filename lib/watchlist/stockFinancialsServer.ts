import "server-only";

import { supabaseSelect } from "../supabase.ts";
import {
  mapSecFilingArtifactDatabaseRow,
  parseSecFilingXbrlArtifacts,
  validateCachedFilingXbrlCompleteness,
  type SecFilingXbrlDocumentSetResult,
} from "../sec-structured-data/filingXbrlContext.ts";
import {
  resolvePeriodicFinancialHistory,
  type SecPeriodicFinancialHistoryFilingInput,
} from "../sec-structured-data/periodicFinancialHistory.ts";
import type {
  SecCompanyFactRow,
  SecFilingRow,
} from "../sec-structured-data/types.ts";
import {
  buildStockFinancialsSnapshot,
  buildUnavailableStockFinancialsSnapshot,
  type StockFinancialsSnapshot,
} from "./stockFinancials.ts";

const FILING_SELECT = [
  "accession_number", "issuer_cik", "form", "filed_date", "accepted_at",
  "report_date", "primary_document", "is_xbrl", "is_inline_xbrl",
  "source_raw_id", "source_kind", "ingested_at",
].join(",");

const FACT_SELECT = [
  "source_fact_key", "source_fact_path", "issuer_cik", "filing_accession",
  "form", "filed_date", "source_raw_id", "source_kind", "context_kind",
  "taxonomy", "concept", "unit", "value_kind", "value_numeric", "value_text",
  "instant_date", "start_date", "end_date", "fiscal_year", "fiscal_period",
  "frame", "ingested_at",
].join(",");

const ARTIFACT_SELECT = [
  "id", "cik", "source_url", "source_identity", "fetched_at", "content_hash",
  "raw_content_kind", "raw_content", "payload",
].join(",");

const PERIODIC_FINANCIAL_STANDARD_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue",
  "OperatingIncomeLoss", "ProfitLossFromOperatingActivities", "NetIncomeLoss", "ProfitLoss",
  "NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities",
  "CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents",
] as const;

const PERIODIC_FORMS = "in.(10-Q,10-Q/A,10-K,10-K/A,20-F,20-F/A,40-F,40-F/A)";
const QUARTERLY_INPUT_LIMIT = 8;
const ANNUAL_INPUT_LIMIT = 5;

export async function fetchStockFinancials(
  symbolValue: string,
  options: { now?: Date } = {},
): Promise<StockFinancialsSnapshot> {
  const symbol = normalizeSymbol(symbolValue);
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  if (!symbol) {
    return buildUnavailableStockFinancialsSnapshot({
      detail: "A valid stock symbol is required.",
      fetchedAt,
      reason: "INVALID_SYMBOL",
      symbol,
    });
  }

  const tickerRows = await selectRows("sec_issuer_ticker_observations", {
    limit: "2",
    order: "observed_at.desc,id.desc",
    select: "issuer_cik,ticker,observed_at",
    ticker: `eq.${symbol}`,
  });
  const issuerCiks = [...new Set(tickerRows.map((row) => readCik(row.issuer_cik)).filter(Boolean))];
  if (issuerCiks.length !== 1) {
    return buildUnavailableStockFinancialsSnapshot({
      detail: issuerCiks.length > 1
        ? "The ticker maps to more than one SEC issuer identity."
        : "No stored SEC issuer identity is available for this ticker.",
      fetchedAt,
      reason: issuerCiks.length > 1 ? "AMBIGUOUS_ISSUER_IDENTITY" : "ISSUER_IDENTITY_UNAVAILABLE",
      symbol,
    });
  }
  const issuerCik = issuerCiks[0]!;

  const [filingRows, factRows] = await Promise.all([
    selectRows("sec_filing_ledger", {
      form: PERIODIC_FORMS,
      issuer_cik: `eq.${issuerCik}`,
      limit: "1000",
      order: "filed_date.desc,accession_number.desc",
      select: FILING_SELECT,
    }),
    selectRows("sec_company_facts", {
      concept: `in.(${PERIODIC_FINANCIAL_STANDARD_CONCEPTS.join(",")})`,
      issuer_cik: `eq.${issuerCik}`,
      limit: "5000",
      order: "filed_date.desc,source_fact_key.asc",
      select: FACT_SELECT,
    }),
  ]);
  const filings = filingRows.map(mapFilingRow);
  const companyFacts = factRows.map(mapCompanyFactRow);
  const targets = selectHistoryTargets(filings);
  if (!targets.length) {
    return buildUnavailableStockFinancialsSnapshot({
      detail: "No stored 10-Q, 10-K, 20-F, or 40-F filing is available for this issuer.",
      fetchedAt,
      issuerCik,
      reason: "SEC_FILING_UNAVAILABLE",
      symbol,
    });
  }

  const filingInputs = await Promise.all(targets.map(readFilingInput));
  const history = resolvePeriodicFinancialHistory({
    companyFacts,
    filingInputs,
    filings,
    issuerCik,
  });
  return buildStockFinancialsSnapshot({ fetchedAt, history, symbol });
}

async function readFilingInput(
  filing: SecFilingRow,
): Promise<SecPeriodicFinancialHistoryFilingInput> {
  let filingXbrl: SecFilingXbrlDocumentSetResult;
  try {
    const rows = await selectRows("sec_structured_raw_sources", {
      cik: `eq.${filing.issuerCik}`,
      limit: "100",
      order: "source_url.asc,content_hash.asc",
      "payload->>accession": `eq.${filing.accessionNumber}`,
      select: ARTIFACT_SELECT,
      source_kind: "eq.filing_xbrl",
    });
    const artifacts = rows.map(mapSecFilingArtifactDatabaseRow);
    const completeness = validateCachedFilingXbrlCompleteness(filing, artifacts);
    filingXbrl = completeness.status === "AVAILABLE"
      ? parseSecFilingXbrlArtifacts(completeness.filingArtifacts)
      : {
          detail: completeness.detail,
          reason: completeness.reason,
          sources: [],
          status: "UNAVAILABLE",
        };
  } catch (error) {
    filingXbrl = {
      detail: error instanceof Error ? error.message : "Stored filing XBRL could not be read.",
      reason: "FILING_XBRL_PARSE_FAILED",
      sources: [],
      status: "UNAVAILABLE",
    };
  }
  return { filingXbrl, targetAccession: filing.accessionNumber };
}

function selectHistoryTargets(filings: readonly SecFilingRow[]) {
  const sorted = [...filings]
    .filter((filing) => filing.isXbrl !== false && Boolean(filing.reportDate))
    .sort(compareFilingsDesc);
  const quarterly = sorted.filter((filing) => baseForm(filing.form) === "10-Q")
    .slice(0, QUARTERLY_INPUT_LIMIT);
  const annual = sorted.filter((filing) => ["10-K", "20-F", "40-F"].includes(baseForm(filing.form)))
    .slice(0, ANNUAL_INPUT_LIMIT);
  return [...quarterly, ...annual].sort(compareFilingsDesc);
}

async function selectRows(table: string, search: Record<string, string>) {
  const result = await supabaseSelect(table, search);
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(`Unable to read ${table}: ${result.error || result.status}`);
  }
  return result.data.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

function mapFilingRow(row: Record<string, unknown>): SecFilingRow {
  return {
    accessionNumber: text(row.accession_number),
    acceptedAt: nullableTimestamp(row.accepted_at),
    filedDate: date(row.filed_date),
    form: text(row.form),
    ingestedAt: timestamp(row.ingested_at),
    isInlineXbrl: nullableBoolean(row.is_inline_xbrl),
    isXbrl: nullableBoolean(row.is_xbrl),
    issuerCik: text(row.issuer_cik),
    primaryDocument: nullableText(row.primary_document),
    reportDate: nullableDate(row.report_date),
    sourceKind: "submissions",
    sourceRawId: text(row.source_raw_id),
  };
}

function mapCompanyFactRow(row: Record<string, unknown>): SecCompanyFactRow {
  return {
    concept: text(row.concept),
    contextKind: "companyfacts_implicit",
    endDate: nullableDate(row.end_date),
    filedDate: date(row.filed_date),
    filingAccession: text(row.filing_accession),
    fiscalPeriod: nullableText(row.fiscal_period),
    fiscalYear: row.fiscal_year === null ? null : Number(row.fiscal_year),
    form: text(row.form),
    frame: nullableText(row.frame),
    ingestedAt: timestamp(row.ingested_at),
    instantDate: nullableDate(row.instant_date),
    issuerCik: text(row.issuer_cik),
    sourceFactKey: text(row.source_fact_key),
    sourceFactPath: text(row.source_fact_path),
    sourceKind: "companyfacts",
    sourceRawId: text(row.source_raw_id),
    startDate: nullableDate(row.start_date),
    taxonomy: text(row.taxonomy),
    unit: text(row.unit),
    valueKind: row.value_kind === "text" ? "text" : "numeric",
    valueNumeric: row.value_numeric === null ? null : text(row.value_numeric),
    valueText: nullableText(row.value_text),
  };
}

function compareFilingsDesc(left: SecFilingRow, right: SecFilingRow) {
  return (right.reportDate ?? "").localeCompare(left.reportDate ?? "")
    || right.filedDate.localeCompare(left.filedDate)
    || right.accessionNumber.localeCompare(left.accessionNumber);
}

function baseForm(form: string) {
  return form.toUpperCase().replace(/\s+/g, "").replace(/\/A$/, "");
}

function readCik(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  return digits && digits.length <= 10 ? digits.padStart(10, "0") : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function date(value: unknown) {
  const valueText = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) throw new Error("Stored SEC date is invalid");
  return valueText;
}

function nullableDate(value: unknown) {
  return value === null || value === undefined || value === "" ? null : date(value);
}

function timestamp(value: unknown) {
  const valueText = text(value);
  const parsed = Date.parse(valueText);
  if (!Number.isFinite(parsed)) throw new Error("Stored SEC timestamp is invalid");
  return new Date(parsed).toISOString();
}

function nullableTimestamp(value: unknown) {
  return value === null || value === undefined || value === "" ? null : timestamp(value);
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}
