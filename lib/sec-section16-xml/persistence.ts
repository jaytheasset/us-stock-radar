import "server-only";

import {
  assertSection16CallerMatchesStored,
  buildSection16CanonicalPayload,
  isSection16XmlRawItem,
  Section16CanonicalSourceError,
  validateSection16CanonicalRead,
  type Section16CanonicalStoredRows,
} from "@/lib/sec-section16-xml/canonical";
import type { Section16XmlParserOutput } from "@/lib/sources/sec/forms/section16Xml";

type Row = Record<string, unknown>;
type RepositoryResult = Readonly<{ ok: boolean; status: number; data: unknown; count?: number | null; error?: string }>;

export type Section16CanonicalRepository = Readonly<{
  rpc(functionName: string, payload: Row): Promise<RepositoryResult>;
  select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
}>;

export type Section16CanonicalReadResult =
  | Readonly<{
      status: "available";
      filing: Row;
      reportingOwners: readonly Row[];
      transactions: readonly Row[];
      holdings: readonly Row[];
      footnotes: readonly Row[];
      signatures: readonly Row[];
      parsed: Section16XmlParserOutput;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export async function persistSection16CanonicalXmlForRawItem(input: {
  rawItemId: string;
  rawItem: Row;
  repository?: Section16CanonicalRepository;
}) {
  if (!isSection16XmlRawItem(input.rawItem)) return { status: "not_applicable" as const };
  const repository = input.repository ?? await defaultRepository();
  const storedResult = await repository.select("raw_items", {
    select: "*",
    id: `eq.${input.rawItemId}`,
    limit: "1",
  });
  if (!storedResult.ok) {
    throw new Section16CanonicalSourceError("stored_raw_read_failed", "Section 16 stored raw item could not be read");
  }
  const storedRawItem = rows(storedResult.data)[0];
  if (!storedRawItem) {
    throw new Section16CanonicalSourceError("stored_raw_not_found", "Section 16 stored raw item does not exist");
  }
  assertSection16CallerMatchesStored(input.rawItem, storedRawItem);
  const payload = buildSection16CanonicalPayload(input.rawItemId, storedRawItem);
  if (!payload) return { status: "not_applicable" as const };

  const result = await repository.rpc("persist_sec_section16_filing", {
    p_raw_item_id: input.rawItemId,
    p_filing: payload.filing,
    p_reporting_owners: payload.reportingOwners,
    p_transactions: payload.transactions,
    p_holdings: payload.holdings,
    p_footnotes: payload.footnotes,
    p_signatures: payload.signatures,
  });
  if (!result.ok) {
    throw new Section16CanonicalSourceError(
      "persistence_failed",
      `Section 16 canonical persistence failed: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  const response = record(result.data);
  const writeStatus = response.status;
  if (
    (writeStatus !== "inserted" && writeStatus !== "replayed")
    || Number(response.reporting_owner_count) !== payload.reportingOwners.length
    || Number(response.transaction_count) !== payload.transactions.length
    || Number(response.holding_count) !== payload.holdings.length
    || Number(response.footnote_count) !== payload.footnotes.length
    || Number(response.signature_count) !== payload.signatures.length
  ) {
    throw new Section16CanonicalSourceError(
      "persistence_response_invalid",
      "Section 16 canonical persistence returned an invalid result",
    );
  }
  return {
    status: "available" as const,
    writeStatus,
    accessionNumber: payload.parsed.source.accessionNumber,
    issuerCik: stringValue(payload.filing.issuer_cik),
    formType: payload.parsed.formType,
    sourceSha256: stringValue(payload.filing.source_sha256),
    reportingOwnerCount: payload.reportingOwners.length,
    transactionCount: payload.transactions.length,
    holdingCount: payload.holdings.length,
    footnoteCount: payload.footnotes.length,
    signatureCount: payload.signatures.length,
  };
}

export async function recordSection16CanonicalPersistenceState(input: {
  rawItemId: string;
  state:
    | {
        status: "available";
        accessionNumber: string;
        issuerCik: string;
        formType: string;
        sourceSha256: string;
        reportingOwnerCount: number;
        transactionCount: number;
        holdingCount: number;
        footnoteCount: number;
        signatureCount: number;
        writeStatus: unknown;
      }
    | { status: "failed"; errorCode: string };
  repository?: Section16CanonicalRepository;
}) {
  const repository = input.repository ?? await defaultRepository();
  const state = input.state.status === "available"
    ? {
        status: "available",
        accession_number: input.state.accessionNumber,
        issuer_cik: input.state.issuerCik,
        form_type: input.state.formType,
        source_sha256: input.state.sourceSha256,
        reporting_owner_count: input.state.reportingOwnerCount,
        transaction_count: input.state.transactionCount,
        holding_count: input.state.holdingCount,
        footnote_count: input.state.footnoteCount,
        signature_count: input.state.signatureCount,
        write_status: input.state.writeStatus,
        storage_version: "sec_section16_xml_v1",
        recorded_at: new Date().toISOString(),
      }
    : {
        status: "failed",
        error_code: input.state.errorCode,
        storage_version: "sec_section16_xml_v1",
        recorded_at: new Date().toISOString(),
      };
  const result = await repository.rpc("record_sec_section16_persistence_state", {
    p_raw_item_id: input.rawItemId,
    p_state: state,
  });
  if (!result.ok) {
    throw new Error(`record Section 16 canonical persistence state failed: ${result.error || `HTTP ${result.status}`}`);
  }
}

export async function readSection16FilingByAccession(
  accessionNumber: string,
  repository?: Section16CanonicalRepository,
): Promise<Section16CanonicalReadResult> {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
    return { status: "unavailable", reason: "invalid_accession" };
  }
  const resolved = repository ?? await defaultRepository();
  const filingResult = await resolved.select("sec_section16_filings", {
    select: "*",
    accession_number: `eq.${accessionNumber}`,
    limit: "1",
  });
  if (!filingResult.ok) return { status: "unavailable", reason: "filing_read_failed" };
  const filing = rows(filingResult.data)[0];
  if (!filing) return { status: "not_found" };
  return readAndValidateOne(filing, resolved);
}

export async function readSection16FilingHistoryByIssuer(
  issuerCik: string,
  options: { limit?: number; repository?: Section16CanonicalRepository } = {},
): Promise<
  | { status: "available"; filings: readonly Extract<Section16CanonicalReadResult, { status: "available" }>[] }
  | { status: "empty" }
  | { status: "unavailable"; reason: string }
> {
  const normalizedIssuerCik = normalizeCik(issuerCik);
  if (!normalizedIssuerCik) return { status: "unavailable", reason: "invalid_issuer_cik" };
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const resolved = options.repository ?? await defaultRepository();
  const filingResult = await resolved.select("sec_section16_filings", {
    select: "*",
    issuer_cik: `eq.${normalizedIssuerCik}`,
    order: "accepted_at_raw.desc.nullslast,filing_date_raw.desc.nullslast,accession_number.desc",
    limit: String(limit),
  });
  if (!filingResult.ok) return { status: "unavailable", reason: "history_read_failed" };
  const filings = rows(filingResult.data);
  if (filings.length === 0) return { status: "empty" };
  const available: Extract<Section16CanonicalReadResult, { status: "available" }>[] = [];
  for (const filing of filings) {
    const readback = await readAndValidateOne(filing, resolved);
    if (readback.status !== "available") {
      return { status: "unavailable", reason: readback.status === "unavailable" ? readback.reason : "history_child_missing" };
    }
    available.push(readback);
  }
  return { status: "available", filings: available };
}

export function section16PersistenceFailureState(error: unknown) {
  return {
    status: "failed" as const,
    errorCode: error instanceof Section16CanonicalSourceError ? error.code : "unknown_failure",
  };
}

async function readAndValidateOne(
  filing: Row,
  repository: Section16CanonicalRepository,
): Promise<Section16CanonicalReadResult> {
  const accessionNumber = stringValue(filing.accession_number);
  const specs: Array<[keyof Omit<Section16CanonicalStoredRows, "filing">, string, string, string]> = [
    ["reportingOwners", "sec_section16_reporting_owners", "reporting_owner_index.asc", "100"],
    ["transactions", "sec_section16_transactions", "row_ordinal.asc", "1000"],
    ["holdings", "sec_section16_holdings", "row_ordinal.asc", "1000"],
    ["footnotes", "sec_section16_footnotes", "footnote_index.asc", "1000"],
    ["signatures", "sec_section16_signatures", "signature_index.asc", "100"],
  ];
  const childRows: Record<string, Row[]> = {};
  for (const [key, table, order, limit] of specs) {
    const result = await repository.select(table, {
      select: "*",
      accession_number: `eq.${accessionNumber}`,
      order,
      limit,
    });
    if (!result.ok) return { status: "unavailable", reason: `${key}_read_failed` };
    childRows[key] = rows(result.data);
  }
  const storedRows: Section16CanonicalStoredRows = {
    filing,
    reportingOwners: childRows.reportingOwners ?? [],
    transactions: childRows.transactions ?? [],
    holdings: childRows.holdings ?? [],
    footnotes: childRows.footnotes ?? [],
    signatures: childRows.signatures ?? [],
  };
  const validation = validateSection16CanonicalRead(storedRows);
  if (!validation.ok) return { status: "unavailable", reason: validation.reason };
  return { status: "available", ...storedRows, parsed: validation.parsed };
}

async function defaultRepository(): Promise<Section16CanonicalRepository> {
  const supabase = await import("@/lib/supabase");
  return { rpc: supabase.supabaseRpc, select: supabase.supabaseSelect };
}

function normalizeCik(value: string) {
  const text = value.trim();
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
