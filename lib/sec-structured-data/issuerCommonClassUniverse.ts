import { createHash } from "node:crypto";

import {
  hasSingleAuthoritativeCommonStockClassDimension,
  type SecAuthoritativeOsDecision,
  type SecAuthoritativeOsFilingFactEvidence,
} from "./authoritativeOsExtraction.ts";
import {
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE,
  readShareCountHistory,
  type AuthoritativeShareCountHistoryObservation,
  type ProspectusTextAuthoritativeShareCountHistoryObservation,
  type ShareCountHistoryObservation,
  type ShareCountHistoryRepository,
  type ShareCountHistorySqlClient,
} from "./shareCountHistory.ts";
import {
  CANONICAL_SECURITY_CLASS_ID_PATTERN,
  deriveAuthoritativeCanonicalSecurityClassIdentity,
  isSourceBackedCommonStockConcept,
} from "./shareCountSecurityIdentity.ts";

export const ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS = [
  "issuer-common-class-universe-snapshot-v1",
  "issuer-common-class-universe-snapshot-v2",
  "issuer-common-class-universe-prospectus-text-v1",
] as const;
export type IssuerCommonClassUniverseVersion =
  (typeof ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS)[number];
export const ISSUER_COMMON_CLASS_UNIVERSE_VERSION =
  "issuer-common-class-universe-snapshot-v2" as const;

export const ISSUER_COMMON_CLASS_UNIVERSE_STATUSES = [
  "COMPLETE_SINGLE",
  "COMPLETE_MULTI",
  "INCOMPLETE",
  "AMBIGUOUS",
] as const;

export type IssuerCommonClassUniverseStatus =
  (typeof ISSUER_COMMON_CLASS_UNIVERSE_STATUSES)[number];

export type IssuerCommonClassUniverseReason =
  | "COMPLETE_SINGLE_COMMON_STOCK"
  | "COMPLETE_MULTI_COMMON_STOCK"
  | "FILING_CONTEXT_INCOMPLETE"
  | "SOURCE_PROVENANCE_INVALID"
  | "COMMON_CLASS_BREAKDOWN_INCOMPLETE"
  | "AGGREGATE_CLASS_SUM_MISMATCH"
  | "CLASS_FACT_CONFLICT"
  | "UNSUPPORTED_CLASS_MEMBER"
  | "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE"
  | "ADS_OR_ORDINARY_AMBIGUOUS";

export type IssuerCommonClassSourceFact = {
  factKey: string;
  concept?: SecAuthoritativeOsFilingFactEvidence["concept"];
  contextRef: string;
  sharesOutstanding: string;
  documentName: string;
  sourceUrl: string;
  contentHash: string;
  artifactId: string;
  dimensions: SecAuthoritativeOsFilingFactEvidence["dimensions"];
};

export type IssuerCommonClassEvidence = {
  canonicalSecurityClassId: string;
  sharesOutstanding: string;
  sourceFacts: IssuerCommonClassSourceFact[];
};

export type IssuerCommonClassExcludedEvidence = {
  reason: "NON_COMMON_OR_UNSUPPORTED_CLASS_MEMBER";
  factKey: string;
  contextRef: string;
  memberNamespaceUri: string | null;
  memberLocalName: string | null;
};

export type IssuerCommonClassUniverseSnapshot = {
  id: string | null;
  snapshotVersion: IssuerCommonClassUniverseVersion;
  issuerCik: string;
  universeAsOf: string;
  acceptedAt: string;
  sourceAccession: string;
  sourceForm: string;
  sourceFiledDate: string;
  sourceDocuments: string[];
  status: IssuerCommonClassUniverseStatus;
  reason: IssuerCommonClassUniverseReason;
  requiredCanonicalSecurityClassIds: string[];
  classEvidence: IssuerCommonClassEvidence[];
  aggregateEvidence: IssuerCommonClassSourceFact[];
  excludedEvidence: IssuerCommonClassExcludedEvidence[];
  completenessProvenance: Record<string, unknown>;
  sourceIdentityHash: string;
  createdAt: string | null;
};

export type IssuerCommonClassUniverseWriteResult = { inserted: number; deduped: number };

export type IssuerCommonClassUniverseReadFilter = {
  universeAsOfTo?: string;
  acceptedAtTo?: string;
};

export interface IssuerCommonClassUniverseRepository {
  insertSnapshot(snapshot: IssuerCommonClassUniverseSnapshot): Promise<boolean>;
  readSnapshots(
    cik: string,
    filter?: IssuerCommonClassUniverseReadFilter,
  ): Promise<IssuerCommonClassUniverseSnapshot[]>;
}

export type IssuerCommonClassUniverseAvailable = {
  status: "AVAILABLE";
  reason: "LATEST_COMPLETE_UNIVERSE_SELECTED";
  cik: string;
  targetAt: string;
  universeAsOf: string;
  acceptedAt: string;
  requiredCanonicalSecurityClassIds: string[];
  sourceAccession: string;
  selectedSnapshot: IssuerCommonClassUniverseSnapshot;
  supportingSnapshots: IssuerCommonClassUniverseSnapshot[];
  laterClassEvidence: ShareCountHistoryObservation[];
};

export type IssuerCommonClassUniverseNotAvailable = {
  status: "UNAVAILABLE" | "INCOMPLETE" | "AMBIGUOUS" | "CLASS_UNIVERSE_STALE";
  reason:
    | "UNIVERSE_REPOSITORY_READ_FAILED"
    | "NO_UNIVERSE_SNAPSHOT_AVAILABLE"
    | "LATEST_SNAPSHOT_INCOMPLETE"
    | "LATEST_SNAPSHOT_AMBIGUOUS"
    | "LATEST_SNAPSHOT_CONFLICT"
    | "LATER_CANONICAL_COMMON_CLASS_DISCOVERED"
    | "SHARE_COUNT_HISTORY_READ_FAILED";
  cik: string;
  targetAt: string;
  selectedSnapshot: IssuerCommonClassUniverseSnapshot | null;
  supportingSnapshots: IssuerCommonClassUniverseSnapshot[];
  laterClassEvidence: ShareCountHistoryObservation[];
};

export type IssuerCommonClassUniverseAt =
  | IssuerCommonClassUniverseAvailable
  | IssuerCommonClassUniverseNotAvailable;

export type UsablePeriodicOsBaseline = {
  status: "AVAILABLE";
  cik: string;
  asOf: string;
  acceptedAt: string;
  accession: string;
  form: "10-K" | "10-K/A" | "10-Q" | "10-Q/A" | "20-F" | "20-F/A" | "40-F" | "40-F/A";
  requiredCanonicalSecurityClassIds: string[];
  historyObservationCount: number;
};

export type UsableProspectusOsDiscoveryBoundary = {
  status: "AVAILABLE";
  boundaryKind: "new_listing_prospectus";
  cik: string;
  asOf: string;
  acceptedAt: string;
  accession: string;
  form: "424B4";
  requiredCanonicalSecurityClassIds: string[];
  historyObservationCount: number;
};

export type UsablePeriodicOsDiscoveryBoundary = UsablePeriodicOsBaseline & {
  boundaryKind: "periodic";
};

export type OsIncrementalDiscoveryBoundary =
  | UsablePeriodicOsDiscoveryBoundary
  | UsableProspectusOsDiscoveryBoundary;

export type OsIncrementalDiscoveryBoundaryReadResult =
  | OsIncrementalDiscoveryBoundary
  | PeriodicOsBaselineRequired
  | PeriodicOsBaselineReadFailed;

export type PeriodicOsBaselineRequired = {
  status: "BASELINE_REQUIRED";
  cik: string;
  reason: "NO_USABLE_PERIODIC_BASELINE";
};

export type PeriodicOsBaselineReadFailed = {
  status: "READ_FAILED";
  cik: string;
  reason: "UNIVERSE_REPOSITORY_READ_FAILED" | "SHARE_COUNT_HISTORY_READ_FAILED";
};

export type PeriodicOsBaselineReadResult =
  | UsablePeriodicOsBaseline
  | PeriodicOsBaselineRequired
  | PeriodicOsBaselineReadFailed;

export function deriveIssuerCommonClassUniverseSnapshot(
  decision: SecAuthoritativeOsDecision,
): IssuerCommonClassUniverseSnapshot {
  validateDecisionIdentity(decision);
  const facts = structuredClone(decision.filingFacts).sort(compareFilingFacts);
  const base = {
    issuerCik: decision.issuerCik,
    universeAsOf: decision.candidate.asOf,
    acceptedAt: new Date(decision.candidate.acceptedAt).toISOString(),
    sourceAccession: decision.candidate.accession,
    sourceForm: decision.candidate.form,
    sourceFiledDate: decision.candidate.filedDate,
    sourceDocuments: [...new Set(facts.map((fact) => fact.source.documentName))].sort(),
    aggregateEvidence: [] as IssuerCommonClassSourceFact[],
    excludedEvidence: [] as IssuerCommonClassExcludedEvidence[],
  };

  if (isForeignPeriodicForm(decision.candidate.form) && decision.status !== "ELIGIBLE") {
    return buildSnapshot(decision, base, "AMBIGUOUS", "ADS_OR_ORDINARY_AMBIGUOUS", [], []);
  }
  if (!isSupportedPeriodicForm(decision.candidate.form)
    || !isSupportedUniverseCandidateConcept(decision)) {
    return buildSnapshot(decision, base, "INCOMPLETE", "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE", [], []);
  }
  if (decision.reason === "FILING_CONTEXT_UNAVAILABLE"
    || decision.reason === "FILING_RELEVANT_FACT_REJECTED"
    || facts.length === 0) {
    return buildSnapshot(decision, base, "INCOMPLETE", "FILING_CONTEXT_INCOMPLETE", [], []);
  }
  if (!facts.every((fact) => validUniverseFact(fact, decision))) {
    return buildSnapshot(decision, base, "INCOMPLETE", "SOURCE_PROVENANCE_INVALID", [], []);
  }

  const aggregateFacts = facts.filter((fact) => fact.dimensions.length === 0);
  const supportedClassFacts = facts.filter(hasSingleAuthoritativeCommonStockClassDimension);
  const unsupportedFacts = facts.filter((fact) => fact.dimensions.length > 0
    && !hasSingleAuthoritativeCommonStockClassDimension(fact));
  const excludedEvidence = unsupportedFacts.map(toExcludedEvidence);
  const aggregateEvidence = aggregateFacts.map(toSourceFact);
  const nextBase = { ...base, aggregateEvidence, excludedEvidence };

  if (unsupportedFacts.length > 0) {
    return buildSnapshot(decision, nextBase, "INCOMPLETE", "UNSUPPORTED_CLASS_MEMBER", [], []);
  }

  if (aggregateFacts.length === 1 && supportedClassFacts.length === 0) {
    if (decision.status !== "ELIGIBLE"
      || decision.reason !== "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT") {
      return buildSnapshot(decision, nextBase, "INCOMPLETE", "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE", [], []);
    }
    const fact = aggregateFacts[0]!;
    const mapped = deriveAuthoritativeCanonicalSecurityClassIdentity({
      issuerCik: decision.issuerCik,
      basis: "SINGLE_COMMON_STOCK_CLASS",
      sourceCanonicalKey: "SINGLE_COMMON_STOCK_CLASS|dei:EntityCommonStockSharesOutstanding@required-context",
      sourceIdentity: "dei:EntityCommonStockSharesOutstanding@required-context",
      sourceFactKey: fact.factKey,
      sourceContextRef: fact.contextRef,
    });
    if (mapped.status !== "mapped" || !mapped.canonicalSecurityClassId) {
      return buildSnapshot(decision, nextBase, "INCOMPLETE", "SOURCE_PROVENANCE_INVALID", [], []);
    }
    const evidence: IssuerCommonClassEvidence[] = [{
      canonicalSecurityClassId: mapped.canonicalSecurityClassId,
      sharesOutstanding: fact.normalizedValue!,
      sourceFacts: [toSourceFact(fact)],
    }];
    return buildSnapshot(
      decision,
      nextBase,
      "COMPLETE_SINGLE",
      "COMPLETE_SINGLE_COMMON_STOCK",
      [mapped.canonicalSecurityClassId],
      evidence,
    );
  }

  if (aggregateFacts.length > 1 || supportedClassFacts.length < 2) {
    return buildSnapshot(decision, nextBase, "INCOMPLETE", "COMMON_CLASS_BREAKDOWN_INCOMPLETE", [], []);
  }
  if (aggregateFacts.length === 0
    && (decision.status !== "ELIGIBLE"
      || decision.reason !== "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT")) {
    return buildSnapshot(decision, nextBase, "INCOMPLETE", "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE", [], []);
  }
  if (aggregateFacts.length === 1
    && decision.reason !== "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION") {
    return buildSnapshot(decision, nextBase, "INCOMPLETE", "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE", [], []);
  }

  const grouped = groupClassFacts(decision.issuerCik, supportedClassFacts);
  if (grouped.status === "conflict") {
    return buildSnapshot(decision, nextBase, "AMBIGUOUS", "CLASS_FACT_CONFLICT", [], grouped.evidence);
  }
  if (grouped.status === "unavailable" || grouped.evidence.length < 2) {
    return buildSnapshot(decision, nextBase, "INCOMPLETE", "COMMON_CLASS_BREAKDOWN_INCOMPLETE", [], []);
  }
  if (aggregateFacts.length === 1) {
    const aggregate = BigInt(aggregateFacts[0]!.normalizedValue!);
    const classSum = grouped.evidence.reduce(
      (sum, evidence) => sum + BigInt(evidence.sharesOutstanding),
      BigInt(0),
    );
    if (aggregate !== classSum) {
      return buildSnapshot(decision, nextBase, "INCOMPLETE", "AGGREGATE_CLASS_SUM_MISMATCH", [], grouped.evidence);
    }
  }
  const requiredIds = grouped.evidence.map((evidence) => evidence.canonicalSecurityClassId).sort();
  return buildSnapshot(
    decision,
    nextBase,
    "COMPLETE_MULTI",
    "COMPLETE_MULTI_COMMON_STOCK",
    requiredIds,
    grouped.evidence,
  );
}

export async function writeIssuerCommonClassUniverseSnapshot(input: {
  repository: IssuerCommonClassUniverseRepository;
  decision: SecAuthoritativeOsDecision;
}): Promise<IssuerCommonClassUniverseWriteResult> {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(input.decision);
  const inserted = await input.repository.insertSnapshot(snapshot);
  return { inserted: inserted ? 1 : 0, deduped: inserted ? 0 : 1 };
}

export async function readIssuerCommonClassUniverseAt(input: {
  repository: IssuerCommonClassUniverseRepository;
  shareCountHistoryRepository: ShareCountHistoryRepository;
  cik: string;
  targetAt: string;
}): Promise<IssuerCommonClassUniverseAt> {
  validateCik(input.cik);
  validateTimestamp(input.targetAt, "targetAt");
  const normalizedInput = { cik: input.cik, targetAt: new Date(input.targetAt).toISOString() };
  const targetDate = normalizedInput.targetAt.slice(0, 10);
  let snapshots: IssuerCommonClassUniverseSnapshot[];
  try {
    snapshots = await input.repository.readSnapshots(input.cik, {
      universeAsOfTo: targetDate,
      acceptedAtTo: normalizedInput.targetAt,
    });
  } catch {
    return unavailableRead(normalizedInput, "UNAVAILABLE", "UNIVERSE_REPOSITORY_READ_FAILED");
  }
  const sourceEligible = snapshots
    .map((snapshot) => structuredClone(snapshot))
    .filter((snapshot) => snapshot.issuerCik === input.cik
      && snapshot.universeAsOf <= targetDate
      && new Date(snapshot.acceptedAt).valueOf() <= new Date(normalizedInput.targetAt).valueOf());
  for (const snapshot of sourceEligible) validateSnapshot(snapshot);
  const eligible = preferLatestSnapshotVersion(sourceEligible).sort(compareSnapshots);
  if (eligible.length === 0) {
    return unavailableRead(normalizedInput, "UNAVAILABLE", "NO_UNIVERSE_SNAPSHOT_AVAILABLE");
  }

  const latestAsOf = eligible.at(-1)!.universeAsOf;
  const sameAsOf = eligible.filter((snapshot) => snapshot.universeAsOf === latestAsOf);
  const latestAcceptedAt = sameAsOf.map((snapshot) => snapshot.acceptedAt).sort().at(-1)!;
  const frontier = sameAsOf
    .filter((snapshot) => snapshot.acceptedAt === latestAcceptedAt)
    .sort(compareSnapshots);
  const selected = frontier[0]!;
  if (!frontierEquivalent(frontier)) {
    return unavailableRead(normalizedInput, "AMBIGUOUS", "LATEST_SNAPSHOT_CONFLICT", selected, frontier);
  }
  if (selected.status === "INCOMPLETE") {
    return unavailableRead(normalizedInput, "INCOMPLETE", "LATEST_SNAPSHOT_INCOMPLETE", selected, frontier);
  }
  if (selected.status === "AMBIGUOUS") {
    return unavailableRead(normalizedInput, "AMBIGUOUS", "LATEST_SNAPSHOT_AMBIGUOUS", selected, frontier);
  }

  let history: ShareCountHistoryObservation[];
  try {
    history = await readShareCountHistory(input.shareCountHistoryRepository, input.cik, {
      asOfTo: targetDate,
    });
  } catch {
    return unavailableRead(normalizedInput, "UNAVAILABLE", "SHARE_COUNT_HISTORY_READ_FAILED", selected, frontier);
  }
  const required = new Set(selected.requiredCanonicalSecurityClassIds);
  const laterClassEvidence = history
    .filter((row) => row.canonicalSecurityClassStatus === "mapped"
      && row.canonicalSecurityClassKind === "common_stock"
      && row.canonicalSecurityClassId !== null
      && !required.has(row.canonicalSecurityClassId)
      && row.acceptedAt !== null
      && new Date(row.acceptedAt).valueOf() > new Date(selected.acceptedAt).valueOf()
      && new Date(row.acceptedAt).valueOf() <= new Date(normalizedInput.targetAt).valueOf()
      && row.asOf <= targetDate)
    .map((row) => structuredClone(row))
    .sort(compareHistory);
  if (laterClassEvidence.length > 0) {
    return unavailableRead(
      normalizedInput,
      "CLASS_UNIVERSE_STALE",
      "LATER_CANONICAL_COMMON_CLASS_DISCOVERED",
      selected,
      frontier,
      laterClassEvidence,
    );
  }
  return {
    status: "AVAILABLE",
    reason: "LATEST_COMPLETE_UNIVERSE_SELECTED",
    cik: input.cik,
    targetAt: normalizedInput.targetAt,
    universeAsOf: selected.universeAsOf,
    acceptedAt: selected.acceptedAt,
    requiredCanonicalSecurityClassIds: [...selected.requiredCanonicalSecurityClassIds],
    sourceAccession: selected.sourceAccession,
    selectedSnapshot: structuredClone(selected),
    supportingSnapshots: structuredClone(frontier),
    laterClassEvidence: [],
  };
}

export async function readLatestUsablePeriodicOsBaseline(input: {
  repository: IssuerCommonClassUniverseRepository;
  shareCountHistoryRepository: ShareCountHistoryRepository;
  cik: string;
  targetAt: string;
}): Promise<PeriodicOsBaselineReadResult> {
  validateCik(input.cik);
  validateTimestamp(input.targetAt, "targetAt");
  const targetAt = new Date(input.targetAt).toISOString();
  const targetDate = targetAt.slice(0, 10);
  let snapshots: IssuerCommonClassUniverseSnapshot[];
  try {
    snapshots = await input.repository.readSnapshots(input.cik, {
      universeAsOfTo: targetDate,
      acceptedAtTo: targetAt,
    });
  } catch {
    return {
      status: "READ_FAILED",
      cik: input.cik,
      reason: "UNIVERSE_REPOSITORY_READ_FAILED",
    };
  }

  const candidates = snapshots
    .filter((snapshot) => isSupportedPeriodicForm(snapshot.sourceForm)
      && (snapshot.status === "COMPLETE_SINGLE" || snapshot.status === "COMPLETE_MULTI")
      && snapshot.requiredCanonicalSecurityClassIds.length > 0)
    .sort(compareSnapshots)
    .reverse();

  for (const candidate of candidates) {
    const universe = await readIssuerCommonClassUniverseAt({
      repository: input.repository,
      shareCountHistoryRepository: input.shareCountHistoryRepository,
      cik: input.cik,
      targetAt: candidate.acceptedAt,
    });
    if (universe.reason === "UNIVERSE_REPOSITORY_READ_FAILED"
      || universe.reason === "SHARE_COUNT_HISTORY_READ_FAILED") {
      return {
        status: "READ_FAILED",
        cik: input.cik,
        reason: universe.reason,
      };
    }
    if (universe.status !== "AVAILABLE"
      || universe.sourceAccession !== candidate.sourceAccession
      || universe.universeAsOf !== candidate.universeAsOf
      || universe.acceptedAt !== candidate.acceptedAt) {
      continue;
    }

    let history: ShareCountHistoryObservation[];
    try {
      history = await readShareCountHistory(input.shareCountHistoryRepository, input.cik, {
        asOfFrom: candidate.universeAsOf,
        asOfTo: candidate.universeAsOf,
      });
    } catch {
      return {
        status: "READ_FAILED",
        cik: input.cik,
        reason: "SHARE_COUNT_HISTORY_READ_FAILED",
      };
    }
    const authoritative = history.filter((row): row is AuthoritativeShareCountHistoryObservation =>
      row.sourceType === "sec_authoritative_os"
      && row.observationType === "authoritative_xbrl"
      && row.authoritativeStatus === "ELIGIBLE"
      && row.canonicalSecurityClassStatus === "mapped"
      && row.canonicalSecurityClassKind === "common_stock"
      && row.canonicalSecurityClassId !== null
      && row.shareBasisIdentity === "shares_outstanding:xbrli_shares"
      && row.acceptedAtSource === "sec_filing_ledger"
      && row.acceptedAt === candidate.acceptedAt
      && row.asOf === candidate.universeAsOf
      && row.accessionNumber === candidate.sourceAccession
      && row.form === candidate.sourceForm);
    if (!hasCompleteAuthoritativeClassCoverage(
      authoritative,
      candidate.requiredCanonicalSecurityClassIds,
    )) {
      continue;
    }

    return {
      status: "AVAILABLE",
      cik: input.cik,
      asOf: candidate.universeAsOf,
      acceptedAt: candidate.acceptedAt,
      accession: candidate.sourceAccession,
      form: candidate.sourceForm as UsablePeriodicOsBaseline["form"],
      requiredCanonicalSecurityClassIds: [...candidate.requiredCanonicalSecurityClassIds].sort(),
      historyObservationCount: authoritative.length,
    };
  }

  return {
    status: "BASELINE_REQUIRED",
    cik: input.cik,
    reason: "NO_USABLE_PERIODIC_BASELINE",
  };
}

export async function readLatestUsableOsIncrementalBoundary(input: {
  repository: IssuerCommonClassUniverseRepository;
  shareCountHistoryRepository: ShareCountHistoryRepository;
  cik: string;
  targetAt: string;
}): Promise<OsIncrementalDiscoveryBoundaryReadResult> {
  const periodic = await readLatestUsablePeriodicOsBaseline(input);
  if (periodic.status !== "BASELINE_REQUIRED") {
    return periodic.status === "AVAILABLE"
      ? { ...periodic, boundaryKind: "periodic" }
      : periodic;
  }

  validateCik(input.cik);
  validateTimestamp(input.targetAt, "targetAt");
  const targetAt = new Date(input.targetAt).toISOString();
  let snapshots: IssuerCommonClassUniverseSnapshot[];
  try {
    snapshots = await input.repository.readSnapshots(input.cik, {
      universeAsOfTo: targetAt.slice(0, 10),
      acceptedAtTo: targetAt,
    });
  } catch {
    return { status: "READ_FAILED", cik: input.cik, reason: "UNIVERSE_REPOSITORY_READ_FAILED" };
  }

  const candidates = snapshots
    .filter((snapshot) =>
      snapshot.snapshotVersion === "issuer-common-class-universe-prospectus-text-v1"
      && snapshot.sourceForm === "424B4"
      && snapshot.status === "COMPLETE_SINGLE"
      && snapshot.requiredCanonicalSecurityClassIds.length === 1)
    .sort(compareSnapshots)
    .reverse();

  for (const candidate of candidates) {
    let history: ShareCountHistoryObservation[];
    try {
      history = await readShareCountHistory(input.shareCountHistoryRepository, input.cik, {
        asOfFrom: candidate.universeAsOf,
        asOfTo: candidate.universeAsOf,
      });
    } catch {
      return { status: "READ_FAILED", cik: input.cik, reason: "SHARE_COUNT_HISTORY_READ_FAILED" };
    }
    const authoritative = history.filter(
      (row): row is ProspectusTextAuthoritativeShareCountHistoryObservation =>
        row.sourceType === PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE
        && row.observationType === "source_stated"
        && row.authoritativeStatus === "ELIGIBLE"
        && row.canonicalSecurityClassStatus === "mapped"
        && row.canonicalSecurityClassKind === "common_stock"
        && row.canonicalSecurityClassId === candidate.requiredCanonicalSecurityClassIds[0]
        && row.acceptedAtSource === "sec_filing_ledger"
        && row.acceptedAt === candidate.acceptedAt
        && row.asOf === candidate.universeAsOf
        && row.accessionNumber === candidate.sourceAccession
        && row.form === "424B4",
    );
    if (authoritative.length !== 1) continue;
    return {
      status: "AVAILABLE",
      boundaryKind: "new_listing_prospectus",
      cik: input.cik,
      asOf: candidate.universeAsOf,
      acceptedAt: candidate.acceptedAt,
      accession: candidate.sourceAccession,
      form: "424B4",
      requiredCanonicalSecurityClassIds: [...candidate.requiredCanonicalSecurityClassIds],
      historyObservationCount: 1,
    };
  }

  return periodic;
}

export class InMemoryIssuerCommonClassUniverseRepository
implements IssuerCommonClassUniverseRepository {
  private readonly snapshots = new Map<string, IssuerCommonClassUniverseSnapshot>();
  private nextId = 1;

  async insertSnapshot(snapshot: IssuerCommonClassUniverseSnapshot) {
    validateSnapshot(snapshot);
    if (this.snapshots.has(snapshot.sourceIdentityHash)) return false;
    this.snapshots.set(snapshot.sourceIdentityHash, {
      ...structuredClone(snapshot),
      id: String(this.nextId++),
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  async readSnapshots(cik: string, filter: IssuerCommonClassUniverseReadFilter = {}) {
    validateCik(cik);
    validateReadFilter(filter);
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.issuerCik === cik)
      .filter((snapshot) => !filter.universeAsOfTo || snapshot.universeAsOf <= filter.universeAsOfTo)
      .filter((snapshot) => !filter.acceptedAtTo
        || new Date(snapshot.acceptedAt).valueOf() <= new Date(filter.acceptedAtTo).valueOf())
      .map((snapshot) => structuredClone(snapshot))
      .sort(compareSnapshots);
  }
}

export class PostgresIssuerCommonClassUniverseRepository
implements IssuerCommonClassUniverseRepository {
  private readonly client: ShareCountHistorySqlClient;

  constructor(client: ShareCountHistorySqlClient) {
    this.client = client;
  }

  async insertSnapshot(snapshot: IssuerCommonClassUniverseSnapshot) {
    validateSnapshot(snapshot);
    const result = await this.client.query<{ id: string }>(
      `insert into public.issuer_common_class_universe_snapshots (
         snapshot_version, issuer_cik, universe_as_of, accepted_at,
         source_accession, source_form, source_filed_date, source_documents, status, reason,
         required_canonical_security_class_ids, class_evidence, aggregate_evidence,
         excluded_evidence, completeness_provenance, source_identity_hash
       ) values (
         $1, $2, $3::date, $4::timestamptz, $5, $6, $7::date, $8::text[], $9, $10,
         $11::text[], $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16
       )
       on conflict on constraint issuer_common_class_universe_source_unique do nothing
       returning id::text`,
      snapshotValues(snapshot),
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }

  async readSnapshots(cik: string, filter: IssuerCommonClassUniverseReadFilter = {}) {
    validateCik(cik);
    validateReadFilter(filter);
    const result = await this.client.query<Record<string, unknown>>(
      `select id::text, snapshot_version, issuer_cik, universe_as_of::text,
              accepted_at::text, source_accession, source_form, source_filed_date::text, source_documents,
              status, reason, required_canonical_security_class_ids, class_evidence,
              aggregate_evidence, excluded_evidence, completeness_provenance,
              source_identity_hash, created_at::text
       from public.issuer_common_class_universe_snapshots
       where issuer_cik = $1
         and ($2::date is null or universe_as_of <= $2::date)
         and ($3::timestamptz is null or accepted_at <= $3::timestamptz)
       order by universe_as_of, accepted_at, source_accession, source_identity_hash`,
      [cik, filter.universeAsOfTo ?? null, filter.acceptedAtTo ?? null],
    );
    return result.rows.map(mapIssuerCommonClassUniverseDatabaseRow);
  }
}

function groupClassFacts(
  issuerCik: string,
  facts: SecAuthoritativeOsFilingFactEvidence[],
): { status: "available" | "conflict" | "unavailable"; evidence: IssuerCommonClassEvidence[] } {
  const groups = new Map<string, SecAuthoritativeOsFilingFactEvidence[]>();
  for (const fact of facts) {
    const dimension = fact.dimensions[0];
    if (!dimension || dimension.kind !== "explicit") return { status: "unavailable", evidence: [] };
    const mapped = deriveAuthoritativeCanonicalSecurityClassIdentity({
      issuerCik,
      basis: "CLASS_SPECIFIC_COMMON_STOCK",
      sourceCanonicalKey: `CLASS_SPECIFIC_COMMON_STOCK|${qnameKey(dimension.axis)}|${qnameKey(dimension.member)}`,
      sourceIdentity: { axis: dimension.axis, member: dimension.member },
      sourceConcept: fact.concept,
      sourceFactKey: fact.factKey,
      sourceContextRef: fact.contextRef,
    });
    if (mapped.status !== "mapped" || !mapped.canonicalSecurityClassId) {
      return { status: "unavailable", evidence: [] };
    }
    const group = groups.get(mapped.canonicalSecurityClassId) ?? [];
    group.push(fact);
    groups.set(mapped.canonicalSecurityClassId, group);
  }
  const evidence = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, rows]) => {
    const values = [...new Set(rows.map((row) => row.normalizedValue!))];
    return {
      canonicalSecurityClassId: id,
      sharesOutstanding: values[0]!,
      sourceFacts: rows.map(toSourceFact).sort(compareSourceFacts),
      conflict: values.length > 1,
    };
  });
  return {
    status: evidence.some((row) => row.conflict) ? "conflict" : "available",
    evidence: evidence.map(({ conflict: _conflict, ...row }) => row),
  };
}

function buildSnapshot(
  decision: SecAuthoritativeOsDecision,
  base: {
    issuerCik: string;
    universeAsOf: string;
    acceptedAt: string;
    sourceAccession: string;
    sourceForm: string;
    sourceFiledDate: string;
    sourceDocuments: string[];
    aggregateEvidence: IssuerCommonClassSourceFact[];
    excludedEvidence: IssuerCommonClassExcludedEvidence[];
  },
  status: IssuerCommonClassUniverseStatus,
  reason: IssuerCommonClassUniverseReason,
  requiredIds: string[],
  classEvidence: IssuerCommonClassEvidence[],
): IssuerCommonClassUniverseSnapshot {
  const requiredCanonicalSecurityClassIds = [...requiredIds].sort();
  const normalizedClassEvidence = structuredClone(classEvidence)
    .sort((left, right) => left.canonicalSecurityClassId.localeCompare(right.canonicalSecurityClassId));
  const completenessProvenance = {
    sourceContract: "authoritative-os-extraction-v1",
    filingSetContract: decision.reason === "FILING_CONTEXT_UNAVAILABLE"
      ? "filing_context_unavailable"
      : "complete_primary_ixds_validated_upstream",
    decisionStatus: decision.status,
    decisionReason: decision.reason,
    decisionVersion: decision.decisionVersion,
    filingLedgerRawSourceId: decision.candidate.filingLedgerRawSourceId,
    sourceFactKeys: decision.filingFacts.map((fact) => fact.factKey).sort(),
    sourceContextRefs: decision.filingFacts.map((fact) => fact.contextRef).sort(),
    historicalClassUnionUsed: false,
  };
  const hashPayload = {
    version: ISSUER_COMMON_CLASS_UNIVERSE_VERSION,
    issuerCik: base.issuerCik,
    universeAsOf: base.universeAsOf,
    acceptedAt: base.acceptedAt,
    sourceAccession: base.sourceAccession,
    sourceFiledDate: base.sourceFiledDate,
    status,
    reason,
    requiredCanonicalSecurityClassIds,
    facts: decision.filingFacts.map((fact) => ({
      factKey: fact.factKey,
      concept: fact.concept,
      contextRef: fact.contextRef,
      normalizedValue: fact.normalizedValue,
      documentName: fact.source.documentName,
      contentHash: fact.source.contentHash,
      dimensions: fact.dimensions,
    })).sort((left, right) => left.factKey.localeCompare(right.factKey)),
  };
  const snapshot: IssuerCommonClassUniverseSnapshot = {
    id: null,
    snapshotVersion: ISSUER_COMMON_CLASS_UNIVERSE_VERSION,
    ...base,
    status,
    reason,
    requiredCanonicalSecurityClassIds,
    classEvidence: normalizedClassEvidence,
    aggregateEvidence: structuredClone(base.aggregateEvidence).sort(compareSourceFacts),
    excludedEvidence: structuredClone(base.excludedEvidence).sort((left, right) =>
      left.factKey.localeCompare(right.factKey)),
    completenessProvenance,
    sourceIdentityHash: sha256(JSON.stringify(hashPayload)),
    createdAt: null,
  };
  validateSnapshot(snapshot);
  return snapshot;
}

function validUniverseFact(
  fact: SecAuthoritativeOsFilingFactEvidence,
  decision: SecAuthoritativeOsDecision,
) {
  return fact.normalizedValue !== null
    && POSITIVE_INTEGER_PATTERN.test(fact.normalizedValue)
    && HEX_64_PATTERN.test(fact.factKey)
    && nonEmpty(fact.contextRef)
    && fact.context.period.kind === "instant"
    && fact.context.period.instant === decision.candidate.asOf
    && isSourceBackedCommonStockConcept(fact.concept)
    && fact.concept.localName === decision.candidate.concept
    && fact.context.entityIdentifier.padStart(10, "0") === decision.issuerCik
    && JSON.stringify(fact.context.dimensions) === JSON.stringify(fact.dimensions)
    && fact.unit?.kind === "measure"
    && fact.unit.measure.namespaceUri === "http://www.xbrl.org/2003/instance"
    && fact.unit.measure.localName === "shares"
    && nonEmpty(fact.source.documentName)
    && nonEmpty(fact.source.sourceUrl)
    && HEX_64_PATTERN.test(fact.source.contentHash)
    && UUID_PATTERN.test(fact.source.artifactId)
    && fact.source.issuerCik === decision.issuerCik
    && fact.source.accession === decision.candidate.accession;
}

function toSourceFact(fact: SecAuthoritativeOsFilingFactEvidence): IssuerCommonClassSourceFact {
  return {
    factKey: fact.factKey,
    concept: structuredClone(fact.concept),
    contextRef: fact.contextRef,
    sharesOutstanding: fact.normalizedValue!,
    documentName: fact.source.documentName,
    sourceUrl: fact.source.sourceUrl,
    contentHash: fact.source.contentHash,
    artifactId: fact.source.artifactId,
    dimensions: structuredClone(fact.dimensions),
  };
}

function toExcludedEvidence(fact: SecAuthoritativeOsFilingFactEvidence): IssuerCommonClassExcludedEvidence {
  const dimension = fact.dimensions.length === 1 && fact.dimensions[0]?.kind === "explicit"
    ? fact.dimensions[0]
    : null;
  return {
    reason: "NON_COMMON_OR_UNSUPPORTED_CLASS_MEMBER",
    factKey: fact.factKey,
    contextRef: fact.contextRef,
    memberNamespaceUri: dimension?.member.namespaceUri ?? null,
    memberLocalName: dimension?.member.localName ?? null,
  };
}

function unavailableRead(
  input: { cik: string; targetAt: string },
  status: IssuerCommonClassUniverseNotAvailable["status"],
  reason: IssuerCommonClassUniverseNotAvailable["reason"],
  selectedSnapshot: IssuerCommonClassUniverseSnapshot | null = null,
  supportingSnapshots: IssuerCommonClassUniverseSnapshot[] = [],
  laterClassEvidence: ShareCountHistoryObservation[] = [],
): IssuerCommonClassUniverseNotAvailable {
  return {
    status,
    reason,
    cik: input.cik,
    targetAt: input.targetAt,
    selectedSnapshot: selectedSnapshot ? structuredClone(selectedSnapshot) : null,
    supportingSnapshots: structuredClone(supportingSnapshots),
    laterClassEvidence: structuredClone(laterClassEvidence),
  };
}

function frontierEquivalent(rows: IssuerCommonClassUniverseSnapshot[]) {
  const signatures = new Set(rows.map((row) => JSON.stringify({
    status: row.status,
    reason: row.reason,
    required: row.requiredCanonicalSecurityClassIds,
  })));
  return signatures.size === 1;
}

function preferLatestSnapshotVersion(rows: IssuerCommonClassUniverseSnapshot[]) {
  const latestBySource = new Map<string, number>();
  for (const row of rows) {
    const key = snapshotSourceKey(row);
    latestBySource.set(key, Math.max(latestBySource.get(key) ?? 0, snapshotVersionRank(row.snapshotVersion)));
  }
  return rows.filter((row) =>
    snapshotVersionRank(row.snapshotVersion) === latestBySource.get(snapshotSourceKey(row)));
}

function snapshotSourceKey(snapshot: IssuerCommonClassUniverseSnapshot) {
  return [
    snapshot.issuerCik,
    snapshot.universeAsOf,
    snapshot.acceptedAt,
    snapshot.sourceAccession,
  ].join("|");
}

function snapshotVersionRank(version: IssuerCommonClassUniverseVersion) {
  return ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS.indexOf(version) + 1;
}

function snapshotValues(snapshot: IssuerCommonClassUniverseSnapshot): unknown[] {
  return [
    snapshot.snapshotVersion,
    snapshot.issuerCik,
    snapshot.universeAsOf,
    snapshot.acceptedAt,
    snapshot.sourceAccession,
    snapshot.sourceForm,
    snapshot.sourceFiledDate,
    snapshot.sourceDocuments,
    snapshot.status,
    snapshot.reason,
    snapshot.requiredCanonicalSecurityClassIds,
    JSON.stringify(snapshot.classEvidence),
    JSON.stringify(snapshot.aggregateEvidence),
    JSON.stringify(snapshot.excludedEvidence),
    JSON.stringify(snapshot.completenessProvenance),
    snapshot.sourceIdentityHash,
  ];
}

export function mapIssuerCommonClassUniverseDatabaseRow(
  row: Record<string, unknown>,
): IssuerCommonClassUniverseSnapshot {
  const snapshot: IssuerCommonClassUniverseSnapshot = {
    id: String(row.id),
    snapshotVersion: String(row.snapshot_version) as IssuerCommonClassUniverseVersion,
    issuerCik: String(row.issuer_cik),
    universeAsOf: String(row.universe_as_of),
    acceptedAt: new Date(String(row.accepted_at)).toISOString(),
    sourceAccession: String(row.source_accession),
    sourceForm: String(row.source_form),
    sourceFiledDate: String(row.source_filed_date),
    sourceDocuments: stringArray(row.source_documents),
    status: String(row.status) as IssuerCommonClassUniverseStatus,
    reason: String(row.reason) as IssuerCommonClassUniverseReason,
    requiredCanonicalSecurityClassIds: stringArray(row.required_canonical_security_class_ids),
    classEvidence: jsonArray(row.class_evidence) as IssuerCommonClassEvidence[],
    aggregateEvidence: jsonArray(row.aggregate_evidence) as IssuerCommonClassSourceFact[],
    excludedEvidence: jsonArray(row.excluded_evidence) as IssuerCommonClassExcludedEvidence[],
    completenessProvenance: jsonRecord(row.completeness_provenance),
    sourceIdentityHash: String(row.source_identity_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
  validateSnapshot(snapshot);
  return snapshot;
}

function validateSnapshot(snapshot: IssuerCommonClassUniverseSnapshot) {
  validateCik(snapshot.issuerCik);
  validateDate(snapshot.universeAsOf, "universeAsOf");
  validateTimestamp(snapshot.acceptedAt, "acceptedAt");
  validateDate(snapshot.sourceFiledDate, "sourceFiledDate");
  if (!ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS.includes(snapshot.snapshotVersion)
    || !ISSUER_COMMON_CLASS_UNIVERSE_STATUSES.includes(snapshot.status)
    || !ACCESSION_PATTERN.test(snapshot.sourceAccession)
    || !nonEmpty(snapshot.sourceForm)
    || snapshot.sourceDocuments.some((documentName) => !nonEmpty(documentName))
    || !HEX_64_PATTERN.test(snapshot.sourceIdentityHash)
    || !Array.isArray(snapshot.classEvidence)
    || !Array.isArray(snapshot.aggregateEvidence)
    || !Array.isArray(snapshot.excludedEvidence)
    || !isRecord(snapshot.completenessProvenance)) {
    throw new Error("issuer common-class universe snapshot is malformed");
  }
  if (!validStatusReason(snapshot.status, snapshot.reason)) {
    throw new Error("snapshot status/reason contract is invalid");
  }
  const ids = snapshot.requiredCanonicalSecurityClassIds;
  if ([...ids].sort().join("|") !== ids.join("|")
    || new Set(ids).size !== ids.length
    || ids.some((id) => !CANONICAL_SECURITY_CLASS_ID_PATTERN.test(id)
      || !id.startsWith(`sc:v1:${snapshot.issuerCik}:common_stock:`))) {
    throw new Error("required canonical security-class IDs are invalid");
  }
  if (snapshot.status === "COMPLETE_SINGLE"
    && (ids.length !== 1 || !ids[0]!.endsWith(":single"))) {
    throw new Error("complete-single snapshot must contain the exact single class");
  }
  if (snapshot.status === "COMPLETE_MULTI"
    && (ids.length < 2 || ids.some((id) => id.endsWith(":single")))) {
    throw new Error("complete-multi snapshot must contain at least two class-specific IDs");
  }
  if ((snapshot.status === "INCOMPLETE" || snapshot.status === "AMBIGUOUS") && ids.length !== 0) {
    throw new Error("non-complete snapshot cannot expose required classes");
  }
  if ((snapshot.status === "COMPLETE_SINGLE" || snapshot.status === "COMPLETE_MULTI")
    && (snapshot.sourceDocuments.length === 0 || snapshot.classEvidence.length !== ids.length
      || snapshot.classEvidence.map((evidence) => evidence.canonicalSecurityClassId).sort().join("|")
        !== ids.join("|")
      || snapshot.classEvidence.some((evidence) => !ids.includes(evidence.canonicalSecurityClassId)
        || !POSITIVE_INTEGER_PATTERN.test(evidence.sharesOutstanding)
        || evidence.sourceFacts.length === 0
        || evidence.sourceFacts.some((sourceFact) => !validStoredSourceFact(sourceFact, snapshot.snapshotVersion))))) {
    throw new Error("complete snapshot evidence is incomplete");
  }
  if (snapshot.aggregateEvidence.some((sourceFact) => !validStoredSourceFact(sourceFact, snapshot.snapshotVersion))
    || snapshot.excludedEvidence.some((evidence) => evidence.reason !== "NON_COMMON_OR_UNSUPPORTED_CLASS_MEMBER"
      || !HEX_64_PATTERN.test(evidence.factKey)
      || !nonEmpty(evidence.contextRef))
    || snapshot.completenessProvenance.historicalClassUnionUsed !== false) {
    throw new Error("snapshot provenance is malformed");
  }
  if (snapshot.snapshotVersion === "issuer-common-class-universe-prospectus-text-v1") {
    const listingBasis = snapshot.completenessProvenance.listingBasis;
    const classBasisEvidence = snapshot.completenessProvenance.classBasisEvidence;
    if (snapshot.sourceForm !== "424B4"
      || snapshot.status !== "COMPLETE_SINGLE"
      || snapshot.reason !== "COMPLETE_SINGLE_COMMON_STOCK"
      || snapshot.sourceDocuments.length !== 1
      || snapshot.classEvidence.length !== 1
      || snapshot.classEvidence[0]?.sourceFacts.length !== 1
      || snapshot.aggregateEvidence.length !== 0
      || snapshot.excludedEvidence.length !== 0
      || snapshot.completenessProvenance.sourceContract !== "prospectus-text-os-baseline-v1"
      || snapshot.completenessProvenance.sourceType !== PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE
      || snapshot.completenessProvenance.evidenceBasis !== "complete_primary_prospectus_text"
      || snapshot.completenessProvenance.finalForm !== "424B4"
      || snapshot.completenessProvenance.automaticVerifierStatus !== "AutomaticallyVerified"
      || !isRecord(listingBasis)
      || listingBasis.status !== "FINALIZED_US_EXCHANGE_TICKER"
      || !isRecord(classBasisEvidence)
      || classBasisEvidence.status !== "COMPLETE_SINGLE") {
      throw new Error("prospectus-text universe provenance is incomplete");
    }
  }
  if (snapshot.createdAt !== null) validateTimestamp(snapshot.createdAt, "createdAt");
}

function validateDecisionIdentity(decision: SecAuthoritativeOsDecision) {
  validateCik(decision.issuerCik);
  if (decision.candidate.issuerCik !== decision.issuerCik) throw new Error("decision issuer identity mismatch");
  validateDate(decision.candidate.asOf, "candidate.asOf");
  validateTimestamp(decision.candidate.acceptedAt, "candidate.acceptedAt");
  if (!ACCESSION_PATTERN.test(decision.candidate.accession)) throw new Error("candidate accession is invalid");
  if (!UUID_PATTERN.test(decision.candidate.filingLedgerRawSourceId)) {
    throw new Error("candidate filing-ledger provenance is invalid");
  }
}

function validStoredSourceFact(
  fact: IssuerCommonClassSourceFact,
  snapshotVersion: IssuerCommonClassUniverseVersion,
) {
  return HEX_64_PATTERN.test(fact.factKey)
    && nonEmpty(fact.contextRef)
    && POSITIVE_INTEGER_PATTERN.test(fact.sharesOutstanding)
    && nonEmpty(fact.documentName)
    && nonEmpty(fact.sourceUrl)
    && HEX_64_PATTERN.test(fact.contentHash)
    && UUID_PATTERN.test(fact.artifactId)
    && Array.isArray(fact.dimensions)
    && (snapshotVersion === "issuer-common-class-universe-snapshot-v1"
      || snapshotVersion === "issuer-common-class-universe-prospectus-text-v1"
      || (fact.concept !== undefined && isSourceBackedCommonStockConcept(fact.concept)));
}

function validStatusReason(
  status: IssuerCommonClassUniverseStatus,
  reason: IssuerCommonClassUniverseReason,
) {
  if (status === "COMPLETE_SINGLE") return reason === "COMPLETE_SINGLE_COMMON_STOCK";
  if (status === "COMPLETE_MULTI") return reason === "COMPLETE_MULTI_COMMON_STOCK";
  if (status === "AMBIGUOUS") {
    return reason === "ADS_OR_ORDINARY_AMBIGUOUS" || reason === "CLASS_FACT_CONFLICT";
  }
  return ![
    "COMPLETE_SINGLE_COMMON_STOCK",
    "COMPLETE_MULTI_COMMON_STOCK",
    "ADS_OR_ORDINARY_AMBIGUOUS",
    "CLASS_FACT_CONFLICT",
  ].includes(reason);
}

function validateReadFilter(filter: IssuerCommonClassUniverseReadFilter) {
  if (filter.universeAsOfTo) validateDate(filter.universeAsOfTo, "universeAsOfTo");
  if (filter.acceptedAtTo) validateTimestamp(filter.acceptedAtTo, "acceptedAtTo");
}

function validateCik(cik: string) {
  if (!CIK_PATTERN.test(cik) || cik === "0000000000") throw new Error("invalid CIK");
}

function validateDate(value: string, field: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} is invalid`);
}

function validateTimestamp(value: string, field: string) {
  if (!TIMESTAMP_PATTERN.test(value) || Number.isNaN(new Date(value).valueOf())) {
    throw new Error(`${field} is invalid`);
  }
}

function compareFilingFacts(
  left: SecAuthoritativeOsFilingFactEvidence,
  right: SecAuthoritativeOsFilingFactEvidence,
) {
  return left.factKey.localeCompare(right.factKey) || left.contextRef.localeCompare(right.contextRef);
}

function compareSourceFacts(left: IssuerCommonClassSourceFact, right: IssuerCommonClassSourceFact) {
  return left.factKey.localeCompare(right.factKey) || left.contextRef.localeCompare(right.contextRef);
}

function compareSnapshots(left: IssuerCommonClassUniverseSnapshot, right: IssuerCommonClassUniverseSnapshot) {
  return [left.universeAsOf, left.acceptedAt, left.sourceAccession, left.sourceIdentityHash].join("|")
    .localeCompare([right.universeAsOf, right.acceptedAt, right.sourceAccession, right.sourceIdentityHash].join("|"));
}

function compareHistory(left: ShareCountHistoryObservation, right: ShareCountHistoryObservation) {
  return [left.acceptedAt ?? "", left.asOf, left.canonicalSecurityClassId ?? "", left.sourceFactKey].join("|")
    .localeCompare([right.acceptedAt ?? "", right.asOf, right.canonicalSecurityClassId ?? "", right.sourceFactKey].join("|"));
}

function qnameKey(value: { namespaceUri: string | null; localName: string }) {
  return `${value.namespaceUri ?? ""}#${value.localName}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("stored string array is invalid");
  }
  return [...value];
}

function jsonArray(value: unknown): unknown[] {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("stored JSON array is invalid"); }
  }
  if (!Array.isArray(value)) throw new Error("stored JSON array is invalid");
  return structuredClone(value);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("stored JSON object is invalid"); }
  }
  if (!isRecord(value)) throw new Error("stored JSON object is invalid");
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupportedPeriodicForm(form: string) {
  return ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(form);
}

function isSupportedUniverseCandidateConcept(decision: SecAuthoritativeOsDecision) {
  return (decision.candidate.taxonomy === "dei"
      && decision.candidate.concept === "EntityCommonStockSharesOutstanding")
    || (decision.candidate.taxonomy === "us-gaap"
      && decision.candidate.concept === "CommonStockSharesOutstanding");
}

function isForeignPeriodicForm(form: string) {
  return ["20-F", "20-F/A", "40-F", "40-F/A"].includes(form);
}

function hasCompleteAuthoritativeClassCoverage(
  observations: readonly AuthoritativeShareCountHistoryObservation[],
  requiredCanonicalSecurityClassIds: readonly string[],
) {
  const required = new Set(requiredCanonicalSecurityClassIds);
  if (required.size !== requiredCanonicalSecurityClassIds.length) return false;
  const byClass = new Map<string, Set<string>>();
  for (const observation of observations) {
    const classId = observation.canonicalSecurityClassId;
    if (!required.has(classId)) continue;
    const values = byClass.get(classId) ?? new Set<string>();
    values.add(observation.sharesOutstanding);
    byClass.set(classId, values);
  }
  return [...required].every((classId) => byClass.get(classId)?.size === 1);
}

const CIK_PATTERN = /^[0-9]{10}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
