import "server-only";

import {
  readSc13FilingByAccession,
  type Sc13CanonicalReadResult,
  type Sc13CanonicalRepository,
} from "@/lib/sec-sc13-xml/persistence";
import {
  resolveSc13StoredLineage,
  type Sc13CurrentFieldKey,
  type Sc13LineageFiling,
} from "@/lib/sec-sc13-xml/lineage";

type Row = Record<string, unknown>;

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;

export type Sc13IssuerCurrentStateRead =
  | Readonly<{
      status: "available";
      issuerCik: string;
      historyComplete: true;
      history: readonly Extract<Sc13CanonicalReadResult, { status: "available" }>[];
      lineage: ReturnType<typeof resolveSc13StoredLineage>;
    }>
  | Readonly<{ status: "empty"; issuerCik: string; historyComplete: true }>
  | Readonly<{ status: "unavailable"; issuerCik: string | null; historyComplete: false; reason: string }>;

export async function readSc13IssuerCurrentState(
  issuerCik: string,
  options: { repository?: Sc13CanonicalRepository; maxPages?: number } = {},
): Promise<Sc13IssuerCurrentStateRead> {
  const normalizedIssuerCik = normalizeCik(issuerCik);
  if (!normalizedIssuerCik) {
    return { status: "unavailable", issuerCik: null, historyComplete: false, reason: "invalid_issuer_cik" };
  }
  const repository = options.repository ?? await defaultRepository();
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
  const filingRows: Row[] = [];
  let expectedCount: number | null = null;
  let complete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await repository.select("sec_sc13_filings", {
      select: "accession_number",
      issuer_cik: `eq.${normalizedIssuerCik}`,
      order: "accession_number.asc",
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (!result.ok) {
      return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_read_failed" };
    }
    if (!isRowArray(result.data)) {
      return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_response_invalid" };
    }
    if (result.count !== undefined && result.count !== null) {
      if (typeof result.count !== "number" || !Number.isInteger(result.count) || result.count < 0) {
        return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_count_invalid" };
      }
      if (expectedCount !== null && expectedCount !== result.count) {
        return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_count_changed" };
      }
      expectedCount = result.count;
    }
    const pageRows = result.data;
    filingRows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE || (expectedCount !== null && filingRows.length >= expectedCount)) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_page_limit_exceeded" };
  }
  if (expectedCount !== null && filingRows.length !== expectedCount) {
    return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_count_mismatch" };
  }
  if (filingRows.length === 0) return { status: "empty", issuerCik: normalizedIssuerCik, historyComplete: true };

  const accessions = filingRows.map((row) => stringValue(row.accession_number));
  if (accessions.some((accession) => !/^\d{10}-\d{2}-\d{6}$/.test(accession))) {
    return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_identity_invalid" };
  }
  if (new Set(accessions).size !== accessions.length) {
    return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_duplicate_accession" };
  }

  const history: Extract<Sc13CanonicalReadResult, { status: "available" }>[] = [];
  for (const accession of accessions) {
    const read = await readSc13FilingByAccession(accession, repository);
    if (read.status !== "available") {
      const reason = read.status === "unavailable" ? read.reason : "history_filing_disappeared";
      return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason };
    }
    if (stringValue(read.filing.issuer_cik) !== normalizedIssuerCik) {
      return { status: "unavailable", issuerCik: normalizedIssuerCik, historyComplete: false, reason: "history_issuer_mismatch" };
    }
    history.push(read);
  }
  const lineageInput = history.map(toLineageFiling);
  return {
    status: "available",
    issuerCik: normalizedIssuerCik,
    historyComplete: true,
    history,
    lineage: resolveSc13StoredLineage(lineageInput),
  };
}

function toLineageFiling(
  read: Extract<Sc13CanonicalReadResult, { status: "available" }>,
): Sc13LineageFiling {
  const filing = read.filing;
  return {
    accessionNumber: stringValue(filing.accession_number),
    formTypeRaw: stringValue(filing.form_type_raw),
    previousAccessionNumberRaw: nullableString(filing.previous_accession_number_raw),
    amendmentNumber: nullableInteger(filing.amendment_number),
    filedAt: nullableString(filing.filed_at),
    eventDate: stringValue(filing.event_date),
    headerFilerCik: stringValue(filing.header_filer_cik),
    issuerCik: stringValue(filing.issuer_cik),
    securityClassRaw: stringValue(filing.security_class_raw),
    cusipsRaw: stringArray(filing.cusips_raw),
    reporters: read.reporters.map((reporter) => ({
      reportingPersonIndex: Number(reporter.reporting_person_index),
      reportingPersonCik: nullableString(reporter.reporting_person_cik),
      reportingPersonNameRaw: stringValue(reporter.reporting_person_name_raw),
      values: currentValues(reporter),
    })),
  };
}

function currentValues(row: Row) {
  const source: Record<Sc13CurrentFieldKey, unknown> = {
    soleVotingPowerRaw: row.sole_voting_power_raw,
    sharedVotingPowerRaw: row.shared_voting_power_raw,
    soleDispositivePowerRaw: row.sole_dispositive_power_raw,
    sharedDispositivePowerRaw: row.shared_dispositive_power_raw,
    aggregateAmountOwnedRaw: row.aggregate_amount_owned_raw,
    percentOfClassRaw: row.percent_of_class_raw,
  };
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, nullableString(value)])) as Record<
    Sc13CurrentFieldKey,
    string | null
  >;
}

async function defaultRepository(): Promise<Sc13CanonicalRepository> {
  const supabase = await import("@/lib/supabase");
  return { rpc: supabase.supabaseRpc, select: supabase.supabaseSelect };
}

function normalizeCik(value: string) {
  const text = value.trim();
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every((item) => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}
