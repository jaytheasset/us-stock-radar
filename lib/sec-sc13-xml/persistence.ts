import "server-only";

import {
  buildSc13CanonicalPayload,
  Sc13CanonicalSourceError,
  validateSc13CanonicalRead,
} from "@/lib/sec-sc13-xml/canonical";
import type { Sc13StructuralParseResult } from "@/lib/sources/sec/forms/sc13";

type Row = Record<string, unknown>;
type RepositoryResult = Readonly<{ ok: boolean; status: number; data: unknown; count?: number | null; error?: string }>;

export type Sc13CanonicalRepository = Readonly<{
  rpc(functionName: string, payload: Row): Promise<RepositoryResult>;
  select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
}>;

export type Sc13CanonicalReadResult =
  | Readonly<{
      status: "available";
      filing: Row;
      reporters: readonly Row[];
      structural: Sc13StructuralParseResult;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export async function persistSc13CanonicalXmlForRawItem(input: {
  rawItemId: string;
  rawItem: Row;
  repository?: Sc13CanonicalRepository;
}) {
  const payload = buildSc13CanonicalPayload(input.rawItemId, input.rawItem);
  if (!payload) return { status: "not_applicable" as const };
  const repository = input.repository ?? await defaultRepository();
  const result = await repository.rpc("persist_sec_sc13_filing", {
    p_raw_item_id: input.rawItemId,
    p_filing: payload.filing,
    p_reporters: payload.reporters,
  });
  if (!result.ok) {
    throw new Sc13CanonicalSourceError(
      "persistence_failed",
      `SC13 canonical persistence failed: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  const response = record(result.data);
  const status = response.status;
  if ((status !== "inserted" && status !== "replayed") || Number(response.reporter_count) !== payload.reporters.length) {
    throw new Sc13CanonicalSourceError("persistence_response_invalid", "SC13 canonical persistence returned an invalid result");
  }
  return {
    status: "available" as const,
    writeStatus: status,
    accessionNumber: payload.filing.accession_number as string,
    reporterCount: payload.reporters.length,
    sourceSha256: payload.filing.source_sha256 as string,
  };
}

export async function recordSc13CanonicalPersistenceState(input: {
  rawItemId: string;
  state:
    | { status: "available"; accessionNumber: string; reporterCount: number; sourceSha256: string; writeStatus: unknown }
    | { status: "failed"; errorCode: string; issueCodes: string[] };
  repository?: Sc13CanonicalRepository;
}) {
  const repository = input.repository ?? await defaultRepository();
  const state = input.state.status === "available"
    ? {
        status: "available",
        accession_number: input.state.accessionNumber,
        reporter_count: input.state.reporterCount,
        source_sha256: input.state.sourceSha256,
        write_status: input.state.writeStatus,
        storage_version: "sec_sc13_xml_v1",
        recorded_at: new Date().toISOString(),
      }
    : {
        status: "failed",
        error_code: input.state.errorCode,
        issue_codes: input.state.issueCodes,
        storage_version: "sec_sc13_xml_v1",
        recorded_at: new Date().toISOString(),
      };
  const result = await repository.rpc("record_sec_sc13_persistence_state", {
    p_raw_item_id: input.rawItemId,
    p_state: state,
  });
  if (!result.ok) {
    throw new Error(`record SC13 canonical persistence state failed: ${result.error || `HTTP ${result.status}`}`);
  }
}

export async function readSc13FilingByAccession(
  accessionNumber: string,
  repository?: Sc13CanonicalRepository,
): Promise<Sc13CanonicalReadResult> {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
    return { status: "unavailable", reason: "invalid_accession" };
  }
  const resolved = repository ?? await defaultRepository();
  const filingResult = await resolved.select("sec_sc13_filings", {
    select: "*",
    accession_number: `eq.${accessionNumber}`,
    limit: "1",
  });
  if (!filingResult.ok) return { status: "unavailable", reason: "filing_read_failed" };
  const filing = rows(filingResult.data)[0];
  if (!filing) return { status: "not_found" };
  return readAndValidateOne(filing, resolved);
}

export async function readSc13FilingHistoryByIssuer(
  issuerCik: string,
  options: { limit?: number; repository?: Sc13CanonicalRepository } = {},
): Promise<
  | { status: "available"; filings: readonly Extract<Sc13CanonicalReadResult, { status: "available" }>[] }
  | { status: "empty" }
  | { status: "unavailable"; reason: string }
> {
  const normalizedIssuerCik = normalizeCik(issuerCik);
  if (!normalizedIssuerCik) return { status: "unavailable", reason: "invalid_issuer_cik" };
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const resolved = options.repository ?? await defaultRepository();
  const filingResult = await resolved.select("sec_sc13_filings", {
    select: "*",
    issuer_cik: `eq.${normalizedIssuerCik}`,
    order: "filed_at.desc.nullslast,event_date.desc,accession_number.desc",
    limit: String(limit),
  });
  if (!filingResult.ok) return { status: "unavailable", reason: "history_read_failed" };
  const filings = rows(filingResult.data);
  if (filings.length === 0) return { status: "empty" };

  const accessionNumbers = filings.map((row) => stringValue(row.accession_number));
  if (accessionNumbers.some((accession) => !/^\d{10}-\d{2}-\d{6}$/.test(accession))) {
    return { status: "unavailable", reason: "history_identity_invalid" };
  }
  const reporterResult = await resolved.select("sec_sc13_reporting_persons", {
    select: "*",
    accession_number: `in.(${accessionNumbers.join(",")})`,
    order: "accession_number.asc,reporting_person_index.asc",
    limit: String(limit * 100),
  });
  if (!reporterResult.ok) return { status: "unavailable", reason: "history_reporter_read_failed" };
  const reporterGroups = new Map<string, Row[]>();
  for (const row of rows(reporterResult.data)) {
    const accession = stringValue(row.accession_number);
    const group = reporterGroups.get(accession) ?? [];
    group.push(row);
    reporterGroups.set(accession, group);
  }
  const available: Extract<Sc13CanonicalReadResult, { status: "available" }>[] = [];
  for (const filing of filings) {
    const accession = stringValue(filing.accession_number);
    const reporters = reporterGroups.get(accession) ?? [];
    const validation = validateSc13CanonicalRead(filing, reporters);
    if (!validation.ok) return { status: "unavailable", reason: validation.reason };
    available.push({ status: "available", filing, reporters, structural: validation.structural });
  }
  return { status: "available", filings: available };
}

export function sc13PersistenceFailureState(error: unknown) {
  if (error instanceof Sc13CanonicalSourceError) {
    return {
      status: "failed" as const,
      errorCode: error.code,
      issueCodes: error.issues.map((issue) => issue.code),
    };
  }
  return { status: "failed" as const, errorCode: "unknown_failure", issueCodes: [] };
}

async function readAndValidateOne(filing: Row, repository: Sc13CanonicalRepository): Promise<Sc13CanonicalReadResult> {
  const accessionNumber = stringValue(filing.accession_number);
  const reporterResult = await repository.select("sec_sc13_reporting_persons", {
    select: "*",
    accession_number: `eq.${accessionNumber}`,
    order: "reporting_person_index.asc",
    limit: "100",
  });
  if (!reporterResult.ok) return { status: "unavailable", reason: "reporter_read_failed" };
  const reporters = rows(reporterResult.data);
  const validation = validateSc13CanonicalRead(filing, reporters);
  if (!validation.ok) return { status: "unavailable", reason: validation.reason };
  return { status: "available", filing, reporters, structural: validation.structural };
}

async function defaultRepository(): Promise<Sc13CanonicalRepository> {
  const supabase = await import("@/lib/supabase");
  return {
    rpc: supabase.supabaseRpc,
    select: supabase.supabaseSelect,
  };
}

function normalizeCik(value: string) {
  const text = value.trim();
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
