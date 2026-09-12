import "server-only";

import {
  readSection16FilingByAccession,
  type Section16CanonicalReadResult,
  type Section16CanonicalRepository,
} from "@/lib/sec-section16-xml/persistence";
import {
  resolveSection16StoredLineage,
  type Section16LineageFiling,
} from "@/lib/sec-section16-xml/lineage";

type Row = Record<string, unknown>;

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;

export type Section16IssuerCurrentStateRead =
  | Readonly<{
      status: "available";
      issuerCik: string;
      historyComplete: true;
      historyScope: "complete_stored_history_not_sec_global";
      history: readonly Extract<Section16CanonicalReadResult, { status: "available" }>[];
      lineage: ReturnType<typeof resolveSection16StoredLineage>;
    }>
  | Readonly<{
      status: "empty";
      issuerCik: string;
      historyComplete: true;
      historyScope: "complete_stored_history_not_sec_global";
    }>
  | Readonly<{
      status: "unavailable";
      issuerCik: string | null;
      historyComplete: false;
      historyScope: "stored_history_incomplete";
      reason: string;
    }>;

export async function readSection16IssuerCurrentState(
  issuerCik: string,
  options: { repository?: Section16CanonicalRepository; maxPages?: number } = {},
): Promise<Section16IssuerCurrentStateRead> {
  const normalizedIssuerCik = normalizeCik(issuerCik);
  if (!normalizedIssuerCik) return unavailable(null, "invalid_issuer_cik");
  const repository = options.repository ?? await defaultRepository();
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
  const filingRows: Row[] = [];
  let expectedCount: number | null = null;
  let complete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await repository.select("sec_section16_filings", {
      select: "accession_number",
      issuer_cik: `eq.${normalizedIssuerCik}`,
      order: "accession_number.asc",
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (!result.ok) return unavailable(normalizedIssuerCik, "history_read_failed");
    if (!isRowArray(result.data)) return unavailable(normalizedIssuerCik, "history_response_invalid");
    if (result.count !== undefined && result.count !== null) {
      if (!Number.isInteger(result.count) || result.count < 0) return unavailable(normalizedIssuerCik, "history_count_invalid");
      if (expectedCount !== null && expectedCount !== result.count) return unavailable(normalizedIssuerCik, "history_count_changed");
      expectedCount = result.count;
    }
    filingRows.push(...result.data);
    if (result.data.length < PAGE_SIZE || (expectedCount !== null && filingRows.length >= expectedCount)) {
      complete = true;
      break;
    }
  }
  if (!complete) return unavailable(normalizedIssuerCik, "history_page_limit_exceeded");
  if (expectedCount !== null && filingRows.length !== expectedCount) return unavailable(normalizedIssuerCik, "history_count_mismatch");
  if (filingRows.length === 0) {
    return {
      status: "empty",
      issuerCik: normalizedIssuerCik,
      historyComplete: true,
      historyScope: "complete_stored_history_not_sec_global",
    };
  }

  const accessions = filingRows.map((row) => stringValue(row.accession_number));
  if (accessions.some((accession) => !/^\d{10}-\d{2}-\d{6}$/.test(accession))) {
    return unavailable(normalizedIssuerCik, "history_identity_invalid");
  }
  if (new Set(accessions).size !== accessions.length) return unavailable(normalizedIssuerCik, "history_duplicate_accession");

  const history: Extract<Section16CanonicalReadResult, { status: "available" }>[] = [];
  for (const accession of accessions) {
    const read = await readSection16FilingByAccession(accession, repository);
    if (read.status !== "available") {
      return unavailable(
        normalizedIssuerCik,
        read.status === "unavailable" ? read.reason : "history_filing_disappeared",
      );
    }
    if (stringValue(read.filing.issuer_cik) !== normalizedIssuerCik) {
      return unavailable(normalizedIssuerCik, "history_issuer_mismatch");
    }
    history.push(read);
  }

  const lineageInput: Section16LineageFiling[] = history.map((read) => ({
    accessionNumber: stringValue(read.filing.accession_number),
    parsed: read.parsed,
  }));
  return {
    status: "available",
    issuerCik: normalizedIssuerCik,
    historyComplete: true,
    historyScope: "complete_stored_history_not_sec_global",
    history,
    lineage: resolveSection16StoredLineage(lineageInput),
  };
}

function unavailable(issuerCik: string | null, reason: string): Section16IssuerCurrentStateRead {
  return { status: "unavailable", issuerCik, historyComplete: false, historyScope: "stored_history_incomplete", reason };
}

async function defaultRepository(): Promise<Section16CanonicalRepository> {
  const supabase = await import("@/lib/supabase");
  return { rpc: supabase.supabaseRpc, select: supabase.supabaseSelect };
}

function normalizeCik(value: string) {
  const text = value.trim();
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every((item) => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}
