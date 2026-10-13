import {
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE,
  readShareCountHistory,
  type ShareCountHistoryObservation,
  type ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import {OS_SNAPSHOT_HISTORY_SOURCE} from './osSnapshotHistoryContract.ts';

export const CLASS_SHARE_COUNT_RESOLVER_VERSION = "class-share-count-resolver-v1" as const;

export type ClassShareCountResolutionReason =
  | "LATEST_ELIGIBLE_AS_OF_RESOLVED"
  | "LATEST_ELIGIBLE_AS_OF_CORROBORATED"
  | "LATEST_ELIGIBLE_AS_OF_CONFLICT"
  | "NO_ELIGIBLE_OBSERVATION_AT_TARGET"
  | "HISTORY_READ_FAILED";

type ClassShareCountResolutionBase = {
  resolverVersion: typeof CLASS_SHARE_COUNT_RESOLVER_VERSION;
  cik: string;
  securityClassId: string;
  targetAt: string;
  supportingObservations: ShareCountHistoryObservation[];
  reason: ClassShareCountResolutionReason;
};

export type ClassShareCountResolved = ClassShareCountResolutionBase & {
  status: "RESOLVED";
  sharesOutstanding: string;
  asOf: string;
  ageDays: number;
  selectedObservation: ShareCountHistoryObservation;
  reason: "LATEST_ELIGIBLE_AS_OF_RESOLVED" | "LATEST_ELIGIBLE_AS_OF_CORROBORATED";
};

export type ClassShareCountConflict = ClassShareCountResolutionBase & {
  status: "CONFLICT";
  sharesOutstanding: null;
  asOf: string;
  ageDays: number;
  selectedObservation: null;
  reason: "LATEST_ELIGIBLE_AS_OF_CONFLICT";
};

export type ClassShareCountUnavailable = ClassShareCountResolutionBase & {
  status: "UNAVAILABLE";
  sharesOutstanding: null;
  asOf: null;
  ageDays: null;
  selectedObservation: null;
  reason: "NO_ELIGIBLE_OBSERVATION_AT_TARGET" | "HISTORY_READ_FAILED";
};

export type ClassShareCountResolution =
  | ClassShareCountResolved
  | ClassShareCountConflict
  | ClassShareCountUnavailable;

export async function resolveClassShareCountAt(input: {
  repository: ShareCountHistoryRepository;
  cik: string;
  securityClassId: string;
  targetAt: string;
}): Promise<ClassShareCountResolution> {
  validateInput(input.cik, input.securityClassId, input.targetAt);
  const targetAt = new Date(input.targetAt).toISOString();
  const targetTime = new Date(targetAt).valueOf();
  const targetDate = targetAt.slice(0, 10);

  let history: ShareCountHistoryObservation[];
  try {
    history = await readShareCountHistory(input.repository, input.cik, {
      asOfTo: targetDate,
      canonicalSecurityClassId: input.securityClassId,
    });
  } catch {
    return unavailable(input.cik, input.securityClassId, targetAt, "HISTORY_READ_FAILED");
  }

  const eligible = history
    .filter((row) => eligibleAt(row, input.cik, input.securityClassId, targetDate, targetTime))
    .sort(compareObservationIdentity);
  if (eligible.length === 0) {
    return unavailable(input.cik, input.securityClassId, targetAt, "NO_ELIGIBLE_OBSERVATION_AT_TARGET");
  }

  const latestAsOf = eligible.reduce((latest, row) => row.asOf > latest ? row.asOf : latest, eligible[0]!.asOf);
  const latest = eligible.filter((row) => row.asOf === latestAsOf).map((row) => structuredClone(row));
  const values = [...new Set(latest.map((row) => row.sharesOutstanding))];
  const ageDays = wholeDaysBetween(latestAsOf, targetTime);

  if (values.length !== 1) {
    return {
      resolverVersion: CLASS_SHARE_COUNT_RESOLVER_VERSION,
      status: "CONFLICT",
      cik: input.cik,
      securityClassId: input.securityClassId,
      sharesOutstanding: null,
      asOf: latestAsOf,
      targetAt,
      ageDays,
      selectedObservation: null,
      supportingObservations: latest,
      reason: "LATEST_ELIGIBLE_AS_OF_CONFLICT",
    };
  }

  const sourceTypes = new Set(latest.map((row) => row.sourceType));
  return {
    resolverVersion: CLASS_SHARE_COUNT_RESOLVER_VERSION,
    status: "RESOLVED",
    cik: input.cik,
    securityClassId: input.securityClassId,
    sharesOutstanding: values[0]!,
    asOf: latestAsOf,
    targetAt,
    ageDays,
    selectedObservation: structuredClone(latest[0]!),
    supportingObservations: latest,
    reason: sourceTypes.size > 1
      ? "LATEST_ELIGIBLE_AS_OF_CORROBORATED"
      : "LATEST_ELIGIBLE_AS_OF_RESOLVED",
  };
}

function eligibleAt(
  row: ShareCountHistoryObservation,
  cik: string,
  securityClassId: string,
  targetDate: string,
  targetTime: number,
) {
  if (row.issuerCik !== cik
    || row.canonicalSecurityClassStatus !== "mapped"
    || row.canonicalSecurityClassKind !== "common_stock"
    || row.canonicalSecurityClassId !== securityClassId
    || !POSITIVE_INTEGER_PATTERN.test(row.sharesOutstanding)
    || !validDate(row.asOf)
    || row.asOf > targetDate
    || row.acceptedAt === null
    || !validTimestamp(row.acceptedAt)
    || new Date(row.acceptedAt).valueOf() > targetTime) return false;
  if (row.sourceType === "sec_authoritative_os") {
    return row.acceptedAtSource === "sec_filing_ledger"
      && row.acceptedAtProvenance.source === "sec_filing_ledger.accepted_at";
  }
  if(row.sourceType===OS_SNAPSHOT_HISTORY_SOURCE){
    return row.sourcePublicationCurrent===true&&row.acceptedAtSource==='sec_filing_ledger'
      &&row.acceptedAtProvenance.source==='sec_filing_ledger.accepted_at';
  }
  if (row.sourceType === "sec_filing_text_human_verified") {
    const approval = record(row.sourceProvenance.approval);
    const artifact = record(row.sourceProvenance.secArtifact);
    const verifier = record(row.sourceProvenance.verifier);
    return row.acceptedAtSource === "sec_filing_ledger"
      && row.acceptedAtProvenance.source === "sec_filing_ledger.accepted_at"
      && UUID_PATTERN.test(row.filingLedgerRawSourceId)
      && row.sourceProvenance.filingLedgerRawSourceId === row.filingLedgerRawSourceId
      && UUID_PATTERN.test(String(approval?.approver_user_id ?? ""))
      && validTimestamp(String(approval?.approved_at ?? ""))
      && artifact?.artifactId === row.sourceArtifactId
      && artifact?.sourceUrl === row.sourceDocumentUrl
      && artifact?.contentHash === row.sourceContentHash
      && verifier?.status === "Verified";
  }
  if (row.sourceType === PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE) {
    const artifact = record(row.sourceProvenance.secArtifact);
    const verifier = record(row.sourceProvenance.verifier);
    const classUniverse = record(row.sourceProvenance.classUniverse);
    const listingBasis = record(row.sourceProvenance.listingBasis);
    return row.acceptedAtSource === "sec_filing_ledger"
      && row.acceptedAtProvenance.source === "sec_filing_ledger.accepted_at"
      && UUID_PATTERN.test(row.filingLedgerRawSourceId)
      && row.sourceProvenance.filingLedgerRawSourceId === row.filingLedgerRawSourceId
      && artifact?.artifactId === row.sourceArtifactId
      && artifact?.sourceUrl === row.sourceDocumentUrl
      && artifact?.contentHash === row.sourceContentHash
      && verifier?.status === "AutomaticallyVerified"
      && verifier?.version === PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION
      && classUniverse?.snapshotVersion === "issuer-common-class-universe-prospectus-text-v1"
      && classUniverse?.status === "COMPLETE_SINGLE"
      && classUniverse?.canonicalSecurityClassId === row.canonicalSecurityClassId
      && listingBasis?.status === "FINALIZED_US_EXCHANGE_TICKER";
  }
  return row.sourceType === "sec_filing_text_level2"
    && row.acceptedAtSource === "sec_raw_payload_acceptance"
    && row.acceptedAtProvenance.source === "raw_items.raw_payload.accepted_at";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unavailable(
  cik: string,
  securityClassId: string,
  targetAt: string,
  reason: ClassShareCountUnavailable["reason"],
): ClassShareCountUnavailable {
  return {
    resolverVersion: CLASS_SHARE_COUNT_RESOLVER_VERSION,
    status: "UNAVAILABLE",
    cik,
    securityClassId,
    sharesOutstanding: null,
    asOf: null,
    targetAt,
    ageDays: null,
    selectedObservation: null,
    supportingObservations: [],
    reason,
  };
}

function compareObservationIdentity(left: ShareCountHistoryObservation, right: ShareCountHistoryObservation) {
  return observationIdentity(left).localeCompare(observationIdentity(right));
}

function observationIdentity(row: ShareCountHistoryObservation) {
  return [row.sourceFactKey, row.sourceContextRef, row.sourceContentHash, row.accessionNumber,
    row.filingDocument, row.id ?? ""].join("|");
}

function wholeDaysBetween(asOf: string, targetTime: number) {
  return Math.floor((targetTime - new Date(`${asOf}T00:00:00.000Z`).valueOf()) / DAY_MS);
}

function validateInput(cik: string, securityClassId: string, targetAt: string) {
  if (!CIK_PATTERN.test(cik) || cik === "0000000000") throw new Error("invalid CIK");
  if (!CANONICAL_SECURITY_CLASS_ID_PATTERN.test(securityClassId)
    || !securityClassId.startsWith(`sc:v1:${cik}:common_stock:`)) {
    throw new Error("securityClassId must be an exact issuer-scoped canonical identity");
  }
  if (!TIMESTAMP_PATTERN.test(targetAt) || Number.isNaN(new Date(targetAt).valueOf())) {
    throw new Error("targetAt must be an exact timestamp with timezone");
  }
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(new Date(value).valueOf());
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const CIK_PATTERN = /^[0-9]{10}$/;
const CANONICAL_SECURITY_CLASS_ID_PATTERN = /^sc:v1:[0-9]{10}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
