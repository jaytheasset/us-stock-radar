import "server-only";

import { supabaseSelect } from "../supabase.ts";
import {
  mapSecFilingArtifactDatabaseRow,
  parseSecFilingXbrlArtifacts,
  validateCachedFilingXbrlCompleteness,
  type SecFilingXbrlDocumentSetResult,
} from "../sec-structured-data/filingXbrlContext.ts";
import {
  resolvePeriodicFinancials,
} from "../sec-structured-data/periodicFinancialResolver.ts";
import type {
  SecCompanyFactRow,
  SecFilingRow,
} from "../sec-structured-data/types.ts";
import {
  assertPeriodicFinancialMonitorAnalysisIdentity,
  buildPeriodicFinancialMonitorAnalysis,
  readPeriodicFinancialRawFilingIdentity,
  type PeriodicFinancialFilingIdentity,
} from "./periodicFinancialMonitor.ts";

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

export async function resolvePeriodicFinancialMonitorFromStoredSec(
  rawItem: Record<string, unknown>,
  expectedIdentity: PeriodicFinancialFilingIdentity,
) {
  const identity = readPeriodicFinancialRawFilingIdentity(rawItem, expectedIdentity.accession);
  if (identity.issuerCik !== expectedIdentity.issuerCik || identity.form !== expectedIdentity.form) {
    throw new Error("Periodic Financial Monitor stored source identity mismatch");
  }
  const [filings, companyFacts, filingXbrl] = await Promise.all([
    readIssuerFilings(identity.issuerCik),
    readAccessionCompanyFacts(identity.issuerCik, identity.accession),
    readAccessionFilingXbrl(identity.issuerCik, identity.accession),
  ]);
  const resolution = resolvePeriodicFinancials({
    issuerCik: identity.issuerCik,
    targetAccession: identity.accession,
    filings,
    companyFacts,
    filingXbrl,
  });
  const analysis = buildPeriodicFinancialMonitorAnalysis(resolution);
  assertPeriodicFinancialMonitorAnalysisIdentity(analysis, expectedIdentity);
  return analysis;
}

async function readIssuerFilings(issuerCik: string): Promise<SecFilingRow[]> {
  const result = await supabaseSelect("sec_filing_ledger", {
    issuer_cik: `eq.${issuerCik}`,
    form: "in.(10-Q,10-Q/A,10-K,10-K/A,20-F,20-F/A,40-F,40-F/A)",
    select: FILING_SELECT,
    order: "filed_date.desc,accession_number.desc",
    limit: "1000",
  });
  assertRead(result, "Periodic Financial filing-ledger read");
  return rows(result.data).map(mapFilingRow);
}

async function readAccessionCompanyFacts(
  issuerCik: string,
  accession: string,
): Promise<SecCompanyFactRow[]> {
  const result = await supabaseSelect("sec_company_facts", {
    issuer_cik: `eq.${issuerCik}`,
    filing_accession: `eq.${accession}`,
    concept: `in.(${PERIODIC_FINANCIAL_STANDARD_CONCEPTS.join(",")})`,
    select: FACT_SELECT,
    order: "source_fact_key.asc",
    limit: "1000",
  });
  assertRead(result, "Periodic Financial CompanyFacts read");
  return rows(result.data).map(mapCompanyFactRow);
}

async function readAccessionFilingXbrl(
  issuerCik: string,
  accession: string,
): Promise<SecFilingXbrlDocumentSetResult> {
  const result = await supabaseSelect("sec_structured_raw_sources", {
    cik: `eq.${issuerCik}`,
    source_kind: "eq.filing_xbrl",
    "payload->>accession": `eq.${accession}`,
    select: ARTIFACT_SELECT,
    order: "source_url.asc,content_hash.asc",
    limit: "100",
  });
  assertRead(result, "Periodic Financial filing-XBRL artifact read");
  const artifacts = rows(result.data).map(mapSecFilingArtifactDatabaseRow);

  const filings = await readExactFiling(accession);
  if (filings.length !== 1) {
    return unavailableXbrl("FILING_IDENTITY_INVALID", "target filing ledger identity is unavailable or ambiguous");
  }
  const completeness = validateCachedFilingXbrlCompleteness(filings[0]!, artifacts);
  if (completeness.status === "UNAVAILABLE") {
    return unavailableXbrl(completeness.reason, completeness.detail);
  }
  return parseSecFilingXbrlArtifacts(completeness.filingArtifacts);
}

async function readExactFiling(accession: string): Promise<SecFilingRow[]> {
  const result = await supabaseSelect("sec_filing_ledger", {
    accession_number: `eq.${accession}`,
    select: FILING_SELECT,
    limit: "2",
  });
  assertRead(result, "Periodic Financial exact filing read");
  return rows(result.data).map(mapFilingRow);
}

function unavailableXbrl(
  reason: Extract<SecFilingXbrlDocumentSetResult, { status: "UNAVAILABLE" }>["reason"],
  detail: string,
): SecFilingXbrlDocumentSetResult {
  return { status: "UNAVAILABLE", reason, detail, sources: [] };
}

function mapFilingRow(row: Record<string, unknown>): SecFilingRow {
  return {
    accessionNumber: text(row.accession_number),
    issuerCik: text(row.issuer_cik),
    form: text(row.form),
    filedDate: date(row.filed_date),
    acceptedAt: nullableTimestamp(row.accepted_at),
    reportDate: nullableDate(row.report_date),
    primaryDocument: nullableText(row.primary_document),
    isXbrl: nullableBoolean(row.is_xbrl),
    isInlineXbrl: nullableBoolean(row.is_inline_xbrl),
    sourceRawId: text(row.source_raw_id),
    sourceKind: "submissions",
    ingestedAt: timestamp(row.ingested_at),
  };
}

function mapCompanyFactRow(row: Record<string, unknown>): SecCompanyFactRow {
  return {
    sourceFactKey: text(row.source_fact_key),
    sourceFactPath: text(row.source_fact_path),
    issuerCik: text(row.issuer_cik),
    filingAccession: text(row.filing_accession),
    form: text(row.form),
    filedDate: date(row.filed_date),
    sourceRawId: text(row.source_raw_id),
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    taxonomy: text(row.taxonomy),
    concept: text(row.concept),
    unit: text(row.unit),
    valueKind: row.value_kind === "text" ? "text" : "numeric",
    valueNumeric: row.value_numeric === null ? null : text(row.value_numeric),
    valueText: nullableText(row.value_text),
    instantDate: nullableDate(row.instant_date),
    startDate: nullableDate(row.start_date),
    endDate: nullableDate(row.end_date),
    fiscalYear: row.fiscal_year === null ? null : Number(row.fiscal_year),
    fiscalPeriod: nullableText(row.fiscal_period),
    frame: nullableText(row.frame),
    ingestedAt: timestamp(row.ingested_at),
  };
}

function assertRead(result: { ok: boolean; status: number; error?: string }, label: string) {
  if (!result.ok) throw new Error(`${label} failed: ${result.error || result.status}`);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(record(row)))
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
