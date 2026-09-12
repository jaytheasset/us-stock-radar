import "server-only";

import {
  readSection16FilingByAccession,
  type Section16CanonicalRepository,
} from "../sec-section16-xml/persistence.ts";
import { readSection16IssuerCurrentState } from "../sec-section16-xml/currentState.ts";
import type { Section16TransactionDecision } from "../sec-section16-xml/lineage.ts";
import type {
  Section16XmlField,
  Section16XmlForm,
  Section16XmlHolding,
  Section16XmlTransaction,
} from "../sources/sec/forms/section16Xml/parser.ts";

export const SECTION16_MONITOR_FACT_READER_VERSION = "section16_monitor_fact_reader_v1" as const;

export type Section16MonitorFactRow = Readonly<{
  accessionNumber: string;
  formType: Section16XmlForm;
  rowFamily: "holding" | "transaction";
  rowOrdinal: number;
  aggregationStatus: "included" | "excluded_confirmed_duplicate" | "preserved_filing_snapshot";
  fields: Readonly<Record<string, Section16XmlField | string>>;
}>;

export type Section16MonitorFactReadResult =
  | Readonly<{
      status: "available";
      version: typeof SECTION16_MONITOR_FACT_READER_VERSION;
      scope: "one_exact_saved_filing_with_complete_stored_history_duplicate_review";
      accessionNumber: string;
      issuerCik: string;
      formType: Section16XmlForm;
      sourceSha256: string;
      reportingOwnerCiks: readonly string[];
      rows: readonly Section16MonitorFactRow[];
      includedTransactionRowCount: number;
      excludedConfirmedDuplicateRowCount: number;
      holdingRowCount: number;
      matchedCountMeaning: "filing_rows_not_unique_trades";
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "not_ready"; reason: string }>;

/**
 * Reads and revalidates the canonical filing before exposing direct SEC values.
 * Filing lineage may be unresolved; only confirmed duplicate transaction rows
 * are excluded. Holdings are always filing snapshots and are never converted
 * into transactions or acquisition conclusions.
 */
export async function readSection16MonitorFacts(
  accessionNumber: string,
  repository?: Section16CanonicalRepository,
): Promise<Section16MonitorFactReadResult> {
  const filingRead = await readSection16FilingByAccession(accessionNumber, repository);
  if (filingRead.status === "not_found") return { status: "not_found" };
  if (filingRead.status !== "available") return { status: "not_ready", reason: filingRead.reason };

  const issuerCik = stringValue(filingRead.filing.issuer_cik);
  const currentState = await readSection16IssuerCurrentState(issuerCik, { repository });
  if (currentState.status !== "available") {
    return {
      status: "not_ready",
      reason: currentState.status === "unavailable" ? currentState.reason : "issuer_history_empty",
    };
  }
  const historyFiling = currentState.history.find((item) => stringValue(item.filing.accession_number) === accessionNumber);
  if (
    !historyFiling
    || stringValue(historyFiling.filing.source_sha256) !== stringValue(filingRead.filing.source_sha256)
    || stringValue(historyFiling.filing.raw_item_id) !== stringValue(filingRead.filing.raw_item_id)
  ) {
    return { status: "not_ready", reason: "history_filing_identity_mismatch" };
  }
  const lineage = currentState.lineage;
  const transactionDecision = new Map(
    lineage.transactions
      .filter((item) => item.accessionNumber === accessionNumber)
      .map((item) => [item.rowOrdinal, item]),
  );
  if (
    transactionDecision.size !== filingRead.parsed.transactions.length
    || filingRead.parsed.transactions.some((_, rowOrdinal) => !transactionDecision.has(rowOrdinal))
  ) {
    return { status: "not_ready", reason: "transaction_decision_missing" };
  }
  const holdingSnapshots = lineage.holdings.filter((item) => item.accessionNumber === accessionNumber);
  if (
    holdingSnapshots.length !== filingRead.parsed.holdings.length
    || filingRead.parsed.holdings.some((_, rowOrdinal) => !holdingSnapshots.some((item) => item.rowOrdinal === rowOrdinal))
  ) {
    return { status: "not_ready", reason: "holding_snapshot_missing" };
  }
  const transactions = filingRead.parsed.transactions.map((row, rowOrdinal) => (
    transactionFactRow(accessionNumber, filingRead.parsed.formType, row, rowOrdinal, transactionDecision.get(rowOrdinal))
  ));
  const holdings = filingRead.parsed.holdings.map((row, rowOrdinal) => (
    holdingFactRow(accessionNumber, filingRead.parsed.formType, row, rowOrdinal)
  ));
  const includedTransactions = transactions.filter((row) => row.aggregationStatus === "included");
  const reportingOwnerCiks = filingRead.parsed.reportingOwners
    .map((owner) => exactRaw(owner.cik))
    .filter((value): value is string => Boolean(value));

  return Object.freeze({
    status: "available" as const,
    version: SECTION16_MONITOR_FACT_READER_VERSION,
    scope: "one_exact_saved_filing_with_complete_stored_history_duplicate_review" as const,
    accessionNumber,
    issuerCik,
    formType: filingRead.parsed.formType,
    sourceSha256: stringValue(filingRead.filing.source_sha256),
    reportingOwnerCiks: Object.freeze(reportingOwnerCiks),
    rows: Object.freeze([...holdings, ...includedTransactions]),
    includedTransactionRowCount: includedTransactions.length,
    excludedConfirmedDuplicateRowCount: transactions.length - includedTransactions.length,
    holdingRowCount: holdings.length,
    matchedCountMeaning: "filing_rows_not_unique_trades" as const,
  });
}

function transactionFactRow(
  accessionNumber: string,
  formType: Section16XmlForm,
  row: Section16XmlTransaction,
  rowOrdinal: number,
  decision: Section16TransactionDecision | undefined,
): Section16MonitorFactRow {
  if (!decision) throw new Error("validated Section 16 transaction decision is missing");
  const aggregationStatus = decision.aggregationStatus;
  return Object.freeze({
    accessionNumber,
    formType,
    rowFamily: "transaction" as const,
    rowOrdinal,
    aggregationStatus,
    fields: Object.freeze({
      rowKind: row.rowKind,
      securityTitle: row.securityTitle,
      transactionCode: row.transactionCode,
      transactionDate: row.transactionDate,
      shares: row.shares,
      pricePerShare: row.pricePerShare,
      acquiredDisposedCode: row.acquiredDisposedCode,
      postTransactionShares: row.postTransactionShares,
      directOrIndirectOwnership: row.directOrIndirectOwnership,
      conversionOrExercisePrice: row.conversionOrExercisePrice,
      exerciseDate: row.exerciseDate,
      expirationDate: row.expirationDate,
      underlyingSecurityTitle: row.underlyingSecurityTitle,
      underlyingSecurityShares: row.underlyingSecurityShares,
    }),
  });
}

function holdingFactRow(
  accessionNumber: string,
  formType: Section16XmlForm,
  row: Section16XmlHolding,
  rowOrdinal: number,
): Section16MonitorFactRow {
  return Object.freeze({
    accessionNumber,
    formType,
    rowFamily: "holding" as const,
    rowOrdinal,
    aggregationStatus: "preserved_filing_snapshot" as const,
    fields: Object.freeze({
      rowKind: row.rowKind,
      securityTitle: row.securityTitle,
      amountOwned: row.amountOwned,
      directOrIndirectOwnership: row.directOrIndirectOwnership,
      conversionOrExercisePrice: row.conversionOrExercisePrice,
      exerciseDate: row.exerciseDate,
      expirationDate: row.expirationDate,
      underlyingSecurityTitle: row.underlyingSecurityTitle,
      underlyingSecurityShares: row.underlyingSecurityShares,
    }),
  });
}

function exactRaw(field: Section16XmlField) {
  return field.status === "exact" && typeof field.rawValue === "string" && field.rawValue.length > 0
    ? field.rawValue
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
