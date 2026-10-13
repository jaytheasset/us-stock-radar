import type { Sc13IssuerCurrentStateRead } from "@/lib/sec-sc13-xml/currentState";
import type { Sc13CurrentField } from "@/lib/sec-sc13-xml/lineage";

export const STOCK_SC13_SOURCE = "SEC_SC13_STORED" as const;
export const STOCK_SC13_SCOPE = "complete_stored_history_not_sec_global" as const;

export type StockSc13FilingEvidence = Readonly<{
  accessionNumber: string;
  eventDate: string;
  filedAt: string | null;
  formType: string;
  sourceUrl: string;
}>;

export type StockSc13ReportedField =
  | Readonly<{
      evidence: StockSc13FilingEvidence;
      status: "available";
      valueRaw: string;
    }>
  | Readonly<{
      lastReported: Readonly<{
        evidence: StockSc13FilingEvidence;
        valueRaw: string;
      }> | null;
      reason: "current_filing_field_missing";
      status: "unresolved";
      valueRaw: null;
    }>;

export type StockSc13CurrentReporter = Readonly<{
  aggregateAmountOwned: StockSc13ReportedField;
  percentOfClass: StockSc13ReportedField;
  reportingPersonCik: string;
  reportingPersonName: string;
}>;

export type StockSc13HistoricalReporter = Readonly<{
  aggregateAmountOwnedRaw: string | null;
  percentOfClassRaw: string | null;
  reportingPersonCik: string | null;
  reportingPersonIndex: number;
  reportingPersonName: string;
}>;

export type StockSc13HistoricalFiling = StockSc13FilingEvidence & Readonly<{
  reporters: readonly StockSc13HistoricalReporter[];
}>;

export type StockSc13Position = Readonly<{
  issuerName?: string | null;
  currentReporters: readonly StockSc13CurrentReporter[];
  cusips: readonly string[];
  formFamily: "SCHEDULE 13D" | "SCHEDULE 13G";
  history: readonly StockSc13HistoricalFiling[];
  issueCodes: readonly string[];
  positionKey: string;
  securityClass: string;
  status: "available_stored_history" | "unresolved";
}>;

type StockSc13SnapshotBase = Readonly<{
  fetchedAt: string;
  gptDependency: false;
  source: typeof STOCK_SC13_SOURCE;
  symbol: string;
}>;

export type StockSc13OwnershipSnapshot =
  | (StockSc13SnapshotBase & Readonly<{
      historyComplete: true;
      issuerCik: string;
      positions: readonly StockSc13Position[];
      scope: typeof STOCK_SC13_SCOPE;
      secGlobalCompleteness: "not_verified";
      status: "available";
    }>)
  | (StockSc13SnapshotBase & Readonly<{
      historyComplete: true;
      issuerCik: string;
      positions: readonly [];
      scope: typeof STOCK_SC13_SCOPE;
      secGlobalCompleteness: "not_verified";
      status: "empty";
    }>)
  | (StockSc13SnapshotBase & Readonly<{
      historyComplete: false;
      issuerCik: string | null;
      positions: readonly [];
      reason: string;
      scope: typeof STOCK_SC13_SCOPE;
      secGlobalCompleteness: "not_verified";
      status: "unavailable";
    }>);

export function buildStockSc13OwnershipSnapshot(input: {
  currentState: Sc13IssuerCurrentStateRead;
  fetchedAt?: string;
  symbol: string;
}): StockSc13OwnershipSnapshot {
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const base = {
    fetchedAt,
    gptDependency: false as const,
    scope: STOCK_SC13_SCOPE,
    secGlobalCompleteness: "not_verified" as const,
    source: STOCK_SC13_SOURCE,
    symbol: normalizeSymbol(input.symbol),
  };
  const state = input.currentState;
  if (state.status === "unavailable") {
    return {
      ...base,
      historyComplete: false,
      issuerCik: state.issuerCik,
      positions: [],
      reason: state.reason,
      status: "unavailable",
    };
  }
  if (state.status === "empty") {
    return {
      ...base,
      historyComplete: true,
      issuerCik: state.issuerCik,
      positions: [],
      status: "empty",
    };
  }

  const historyByAccession = new Map(
    state.history.map((read) => [text(read.filing.accession_number), read] as const),
  );
  const positions: StockSc13Position[] = [];
  for (const position of state.lineage.positions) {
    const history: StockSc13HistoricalFiling[] = [];
    for (const accessionNumber of position.orderedAccessions) {
      const read = historyByAccession.get(accessionNumber);
      if (!read) return unavailableProjection(base, state.issuerCik);
      const evidence = filingEvidence(read.filing);
      if (!evidence) return unavailableProjection(base, state.issuerCik);
      history.push({
        ...evidence,
        reporters: read.reporters.map((reporter) => ({
          aggregateAmountOwnedRaw: nullableText(reporter.aggregate_amount_owned_raw),
          percentOfClassRaw: nullableText(reporter.percent_of_class_raw),
          reportingPersonCik: nullableText(reporter.reporting_person_cik),
          reportingPersonIndex: integer(reporter.reporting_person_index),
          reportingPersonName: text(reporter.reporting_person_name_raw),
        })),
      });
    }

    const currentReporters: StockSc13CurrentReporter[] = [];
    for (const reporter of position.currentReporters) {
      const aggregateAmountOwned = reportedField(
        reporter.values.aggregateAmountOwnedRaw,
        historyByAccession,
      );
      const percentOfClass = reportedField(
        reporter.values.percentOfClassRaw,
        historyByAccession,
      );
      if (!aggregateAmountOwned || !percentOfClass) {
        return unavailableProjection(base, state.issuerCik);
      }
      currentReporters.push({
        aggregateAmountOwned,
        percentOfClass,
        reportingPersonCik: reporter.reportingPersonCik,
        reportingPersonName: reporter.reportingPersonNameRaw,
      });
    }

    positions.push({
      issuerName: position.headAccessionNumber ? nullableText(historyByAccession.get(position.headAccessionNumber)?.filing.issuer_name_raw) : null,
      currentReporters,
      cusips: position.cusipsRaw,
      formFamily: position.formFamily,
      history,
      issueCodes: position.issues,
      positionKey: position.positionKey,
      securityClass: position.securityClassRaw,
      status: position.status,
    });
  }

  return {
    ...base,
    historyComplete: true,
    issuerCik: state.issuerCik,
    positions,
    status: "available",
  };
}

function reportedField(
  field: Sc13CurrentField,
  historyByAccession: ReadonlyMap<string, Extract<Sc13IssuerCurrentStateRead, { status: "available" }>["history"][number]>,
): StockSc13ReportedField | null {
  if (field.status === "available") {
    const evidence = evidenceByAccession(field.sourceAccessionNumber, historyByAccession);
    return evidence ? { evidence, status: "available", valueRaw: field.valueRaw } : null;
  }
  const lastEvidence = field.lastReported
    ? evidenceByAccession(field.lastReported.sourceAccessionNumber, historyByAccession)
    : null;
  if (field.lastReported && !lastEvidence) return null;
  return {
    lastReported: field.lastReported && lastEvidence
      ? { evidence: lastEvidence, valueRaw: field.lastReported.valueRaw }
      : null,
    reason: field.reason,
    status: "unresolved",
    valueRaw: null,
  };
}

function evidenceByAccession(
  accessionNumber: string,
  historyByAccession: ReadonlyMap<string, Extract<Sc13IssuerCurrentStateRead, { status: "available" }>["history"][number]>,
) {
  const read = historyByAccession.get(accessionNumber);
  return read ? filingEvidence(read.filing) : null;
}

function filingEvidence(filing: Record<string, unknown>): StockSc13FilingEvidence | null {
  const accessionNumber = text(filing.accession_number);
  const eventDate = text(filing.event_date);
  const formType = text(filing.form_type_raw);
  const sourceUrl = safeSecArchiveUrl(filing.source_url);
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) || !eventDate || !formType || !sourceUrl) {
    return null;
  }
  return {
    accessionNumber,
    eventDate,
    filedAt: nullableText(filing.filed_at),
    formType,
    sourceUrl,
  };
}

function unavailableProjection(
  base: Omit<Extract<StockSc13OwnershipSnapshot, { status: "unavailable" }>, "historyComplete" | "issuerCik" | "positions" | "reason" | "status">,
  issuerCik: string,
): Extract<StockSc13OwnershipSnapshot, { status: "unavailable" }> {
  return {
    ...base,
    historyComplete: false,
    issuerCik,
    positions: [],
    reason: "reader_projection_invalid",
    status: "unavailable",
  };
}

function safeSecArchiveUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(?:www\.)?sec\.gov$/i.test(url.hostname)
      && url.pathname.startsWith("/Archives/edgar/data/")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : -1;
}
