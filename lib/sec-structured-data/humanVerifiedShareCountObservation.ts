import { createHash } from "node:crypto";

import {
  validateDilutionRegistryOsPreview,
  type DilutionRegistryOsSourceBundle,
} from "../dilution-registry/osPreview.ts";
import { normalizeSecDocumentText } from "../dilution-registry/osPreviewSecFallback.ts";
import type { DilutionRegistryPayload } from "../dilution-registry/preview.ts";
import {
  createSecFilingDocumentArtifact,
  PostgresSecFilingXbrlArtifactRepository,
  type SecFilingXbrlArtifactRepository,
  type SecFilingXbrlRawArtifact,
} from "./filingXbrlContext.ts";
import {
  PostgresIssuerCommonClassUniverseRepository,
  readIssuerCommonClassUniverseAt,
  type IssuerCommonClassUniverseRepository,
  type IssuerCommonClassUniverseSnapshot,
} from "./issuerCommonClassUniverse.ts";
import {
  HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE,
  PostgresShareCountHistoryRepository,
  type HumanVerifiedShareCountHistoryObservation,
  type ShareCountHistoryRepository,
  type ShareCountHistorySqlClient,
} from "./shareCountHistory.ts";

export type HumanVerifiedShareCountApproval = {
  approverUserId: string;
  approvedAt: string;
};

export type HumanVerifiedSecFilingLedger = {
  issuerCik: string;
  accessionNumber: string;
  form: string;
  filedDate: string;
  acceptedAt: string;
  primaryDocument: string;
  sourceRawId: string;
};

export type HumanVerifiedShareCountWriteResult = {
  status: "INSERTED" | "REPLAY" | "REJECTED";
  inserted: number;
  deduped: number;
  verifierStatus: "Verified" | "Review" | "Not Verified";
  reasons: string[];
};

export type HumanVerifiedShareCountWriterDependencies = {
  artifactRepository: SecFilingXbrlArtifactRepository;
  historyRepository: ShareCountHistoryRepository;
  universeRepository: IssuerCommonClassUniverseRepository;
  readLedger: (accessionNumber: string) => Promise<HumanVerifiedSecFilingLedger | null>;
  readSourceBundle: (
    accessionNumber: string,
    context: { issuerCik: string; asOf: string; sourceForm: string; sourceRef: string },
  ) => Promise<DilutionRegistryOsSourceBundle>;
};

export function createPostgresHumanVerifiedShareCountWriter(input: {
  sqlClient: ShareCountHistorySqlClient;
  readSourceBundle: HumanVerifiedShareCountWriterDependencies["readSourceBundle"];
}) {
  const historyRepository = new PostgresShareCountHistoryRepository(input.sqlClient);
  return (writeInput: {
    payload: DilutionRegistryPayload;
    approval: HumanVerifiedShareCountApproval;
    ingestedAt: string;
  }) => writeHumanVerifiedShareCountObservation(writeInput, {
    artifactRepository: new PostgresSecFilingXbrlArtifactRepository(input.sqlClient),
    historyRepository,
    universeRepository: new PostgresIssuerCommonClassUniverseRepository(input.sqlClient),
    readLedger: (accessionNumber) => readExactFilingLedger(input.sqlClient, accessionNumber),
    readSourceBundle: input.readSourceBundle,
  });
}

export async function writeHumanVerifiedShareCountObservation(
  input: {
    payload: DilutionRegistryPayload;
    approval: HumanVerifiedShareCountApproval;
    ingestedAt: string;
  },
  dependencies: HumanVerifiedShareCountWriterDependencies,
): Promise<HumanVerifiedShareCountWriteResult> {
  validateApproval(input.approval, input.ingestedAt);
  const candidate = readOnlyCandidate(input.payload);
  if (!candidate) return rejected("Not Verified", ["Exactly one complete O/S observation is required."]);

  const ledger = await dependencies.readLedger(candidate.sourceAccession);
  if (!ledger || !ledgerIdentityMatches(ledger, candidate)) {
    return rejected("Not Verified", ["The exact SEC filing-ledger identity is unavailable or mismatched."]);
  }

  const universe = await readIssuerCommonClassUniverseAt({
    repository: dependencies.universeRepository,
    shareCountHistoryRepository: dependencies.historyRepository,
    cik: candidate.issuerCik,
    targetAt: ledger.acceptedAt,
  });
  if (universe.status !== "AVAILABLE") {
    if (universe.reason === "NO_UNIVERSE_SNAPSHOT_AVAILABLE") {
      const sourceBundle = await dependencies.readSourceBundle(candidate.sourceAccession, {
        issuerCik: candidate.issuerCik,
        asOf: candidate.asOf,
        sourceForm: candidate.sourceForm,
        sourceRef: candidate.sourceRef,
      });
      const verification = await validateDilutionRegistryOsPreview(input.payload, {
        readSourceBundle: async () => ({
          ...sourceBundle,
          classUniverseMode: null,
          classUniverse: null,
        }),
      });
      const result = verification[0];
      return rejected(
        result?.status ?? "Not Verified",
        result?.reasons ?? ["The server O/S verifier failed closed."],
      );
    }
    const status = universe.status === "AMBIGUOUS" ? "Review" : "Not Verified";
    return rejected(status, [`The common-class baseline is unavailable: ${universe.reason}.`]);
  }
  const snapshot = universe.selectedSnapshot;
  const snapshotReason = validateCompleteSingleSnapshot(snapshot, candidate);
  if (snapshotReason) return rejected("Review", [snapshotReason]);

  const sourceBundle = await dependencies.readSourceBundle(candidate.sourceAccession, {
    issuerCik: candidate.issuerCik,
    asOf: candidate.asOf,
    sourceForm: candidate.sourceForm,
    sourceRef: candidate.sourceRef,
  });
  const verifierBundle = bindSnapshot(sourceBundle, snapshot);
  const verification = await validateDilutionRegistryOsPreview(input.payload, {
    readSourceBundle: async () => verifierBundle,
  });
  const result = verification[0];
  if (!result || result.status !== "Verified") {
    return rejected(result?.status ?? "Not Verified", result?.reasons ?? ["The server O/S verifier failed closed."]);
  }

  const artifact = await resolveExactArtifact(candidate, verifierBundle, dependencies.artifactRepository);
  if (!artifact) {
    return rejected("Not Verified", ["The exact SEC primary-document artifact is unavailable or ambiguous."]);
  }

  const observation = buildObservation({
    approval: input.approval,
    artifact,
    candidate,
    ingestedAt: input.ingestedAt,
    ledger,
    snapshot,
    sourceCheck: result.sourceCheck,
  });
  const inserted = await dependencies.historyRepository.insertObservation(observation);
  return {
    status: inserted ? "INSERTED" : "REPLAY",
    inserted: inserted ? 1 : 0,
    deduped: inserted ? 0 : 1,
    verifierStatus: "Verified",
    reasons: [],
  };
}

export async function readExactFilingLedger(
  client: ShareCountHistorySqlClient,
  accessionNumber: string,
): Promise<HumanVerifiedSecFilingLedger | null> {
  if (!ACCESSION_PATTERN.test(accessionNumber)) throw new Error("invalid accession");
  const result = await client.query<Record<string, unknown>>(
    `select issuer_cik, accession_number, form, filed_date::text, accepted_at::text,
            primary_document, source_raw_id::text
       from public.sec_filing_ledger
      where accession_number = $1
      limit 2`,
    [accessionNumber],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0]!;
  const ledger = {
    issuerCik: text(row.issuer_cik),
    accessionNumber: text(row.accession_number),
    form: text(row.form),
    filedDate: text(row.filed_date),
    acceptedAt: timestamp(row.accepted_at),
    primaryDocument: text(row.primary_document),
    sourceRawId: text(row.source_raw_id),
  };
  if (!CIK_PATTERN.test(ledger.issuerCik)
    || !ACCESSION_PATTERN.test(ledger.accessionNumber)
    || !DATE_PATTERN.test(ledger.filedDate)
    || !TIMESTAMP_PATTERN.test(ledger.acceptedAt)
    || !UUID_PATTERN.test(ledger.sourceRawId)
    || !ledger.form
    || !ledger.primaryDocument) return null;
  return ledger;
}

type Candidate = {
  issuerCik: string;
  sharesOutstanding: string;
  asOf: string;
  securityClassTitle: string;
  sourceAccession: string;
  sourceForm: string;
  sourceRef: string;
  evidence: string;
};

function readOnlyCandidate(payload: DilutionRegistryPayload): Candidate | null {
  if (payload.os_observations?.length !== 1) return null;
  const issuer = record(payload.issuer);
  const row = record(payload.os_observations[0]);
  const candidate = {
    issuerCik: text(issuer?.issuer_cik ?? issuer?.cik),
    sharesOutstanding: text(row?.shares_outstanding),
    asOf: text(row?.as_of),
    securityClassTitle: text(row?.security_class_title),
    sourceAccession: text(row?.source_accession),
    sourceForm: text(row?.source_form),
    sourceRef: text(row?.source_ref),
    evidence: typeof row?.evidence === "string" ? row.evidence.trim() : "",
  };
  return CIK_PATTERN.test(candidate.issuerCik)
    && POSITIVE_INTEGER_PATTERN.test(candidate.sharesOutstanding)
    && DATE_PATTERN.test(candidate.asOf)
    && ACCESSION_PATTERN.test(candidate.sourceAccession)
    && candidate.securityClassTitle.length > 0
    && candidate.sourceForm.length > 0
    && candidate.sourceRef.length > 0
    && candidate.evidence.length > 0
    ? candidate
    : null;
}

function ledgerIdentityMatches(ledger: HumanVerifiedSecFilingLedger, candidate: Candidate) {
  return ledger.issuerCik === candidate.issuerCik
    && ledger.accessionNumber === candidate.sourceAccession
    && ledger.form === candidate.sourceForm
    && ledger.primaryDocument === candidate.sourceRef;
}

function validateCompleteSingleSnapshot(snapshot: IssuerCommonClassUniverseSnapshot, candidate: Candidate) {
  const expectedClassId = `sc:v1:${candidate.issuerCik}:common_stock:single`;
  if (snapshot.status !== "COMPLETE_SINGLE"
    || snapshot.reason !== "COMPLETE_SINGLE_COMMON_STOCK"
    || snapshot.universeAsOf > candidate.asOf
    || snapshot.requiredCanonicalSecurityClassIds.length !== 1
    || snapshot.requiredCanonicalSecurityClassIds[0] !== expectedClassId
    || snapshot.classEvidence.length !== 1
    || snapshot.classEvidence[0]?.canonicalSecurityClassId !== expectedClassId) {
    return "The latest eligible baseline is not one exact mapped common-stock class at or before the observation date.";
  }
  return null;
}

function bindSnapshot(
  bundle: DilutionRegistryOsSourceBundle,
  snapshot: IssuerCommonClassUniverseSnapshot,
): DilutionRegistryOsSourceBundle {
  return {
    ...bundle,
    classUniverseMode: "issuer_reference",
    classUniverse: {
      issuer_cik: snapshot.issuerCik,
      source_accession: snapshot.sourceAccession,
      source_form: snapshot.sourceForm,
      universe_as_of: snapshot.universeAsOf,
      source_documents: [...snapshot.sourceDocuments],
      status: snapshot.status,
      reason: snapshot.reason,
      required_canonical_security_class_ids: [...snapshot.requiredCanonicalSecurityClassIds],
      class_evidence: structuredClone(snapshot.classEvidence),
    },
  };
}

async function resolveExactArtifact(
  candidate: Candidate,
  bundle: DilutionRegistryOsSourceBundle,
  repository: SecFilingXbrlArtifactRepository,
) {
  if (!bundle.ok || bundle.ledger?.primary_document !== candidate.sourceRef) return null;
  if (bundle.sourceMode === "official_sec_fallback") {
    const source = bundle.officialSecFallbackArtifact;
    if (!source) return null;
    const artifact = createSecFilingDocumentArtifact({
      issuerCik: candidate.issuerCik,
      accession: candidate.sourceAccession,
      documentName: candidate.sourceRef,
      sourceUrl: source.sourceUrl,
      rawContent: source.rawContent,
      fetchedAt: source.fetchedAt,
      contentType: source.contentType,
    });
    await repository.ingestArtifacts([artifact]);
    const stored = await repository.readArtifacts(candidate.issuerCik, candidate.sourceAccession);
    return stored.find((value) => value.id === artifact.id) ?? null;
  }
  if (bundle.sourceMode !== "stored") return null;
  const sourceDocument = bundle.documents.find((document) => document.source_ref === candidate.sourceRef);
  if (!sourceDocument) return null;
  const stored = await repository.readArtifacts(candidate.issuerCik, candidate.sourceAccession);
  const exact = stored.filter((artifact) => artifact.documentName === candidate.sourceRef
    && artifact.sourceUrl === sourceDocument.source_url
    && normalizeSecDocumentText(artifact.rawContent) === sourceDocument.text);
  return exact.length === 1 ? exact[0]! : null;
}

function buildObservation(input: {
  approval: HumanVerifiedShareCountApproval;
  artifact: SecFilingXbrlRawArtifact;
  candidate: Candidate;
  ingestedAt: string;
  ledger: HumanVerifiedSecFilingLedger;
  snapshot: IssuerCommonClassUniverseSnapshot;
  sourceCheck: string;
}): HumanVerifiedShareCountHistoryObservation {
  const { approval, artifact, candidate, ledger, snapshot } = input;
  const canonicalSecurityClassId = snapshot.requiredCanonicalSecurityClassIds[0]!;
  const titleHash = sha256(candidate.securityClassTitle);
  const sourceFactKey = sha256(stableJson({
    sourceType: HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE,
    issuerCik: candidate.issuerCik,
    accessionNumber: candidate.sourceAccession,
    filingDocument: candidate.sourceRef,
    sourceContentHash: artifact.contentHash,
    sharesOutstanding: candidate.sharesOutstanding,
    asOf: candidate.asOf,
    securityClassTitle: candidate.securityClassTitle,
    evidence: candidate.evidence,
  }));
  return {
    observationType: "source_stated",
    issuerCik: candidate.issuerCik,
    sharesOutstanding: candidate.sharesOutstanding,
    asOf: candidate.asOf,
    securityClassBasis: "SOURCE_STATED_SECURITY_CLASS",
    securityClassIdentity: {
      canonicalKey: `SOURCE_STATED_SECURITY_CLASS|${titleHash}`,
      identity: { title: candidate.securityClassTitle },
    },
    securityClassMetadata: {
      sourceRef: candidate.sourceRef,
      evidence: candidate.evidence,
      sourceDeclaredClassKind: "common_stock",
      canonicalSecurityClassId,
    },
    canonicalSecurityClassId,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: {
      method: "complete_single_common_stock_snapshot",
      sourceIdentityHash: snapshot.sourceIdentityHash,
      universeAsOf: snapshot.universeAsOf,
      sourceAccession: snapshot.sourceAccession,
      titleSimilarityUsed: false,
    },
    shareBasisIdentity: "shares_outstanding:source_stated",
    shareBasisMetadata: {
      measurement: "shares_outstanding",
      unit: { kind: "shares", representation: "positive_integer" },
    },
    accessionNumber: candidate.sourceAccession,
    form: candidate.sourceForm,
    filingDocument: candidate.sourceRef,
    filedDate: ledger.filedDate,
    acceptedAt: ledger.acceptedAt,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: {
      source: "sec_filing_ledger.accepted_at",
      accessionNumber: ledger.accessionNumber,
      filingLedgerRawSourceId: ledger.sourceRawId,
    },
    ingestedAt: new Date(input.ingestedAt).toISOString(),
    sourceConceptNamespaceUri: null,
    sourceConceptLocalName: null,
    sourceFactKey,
    sourceContextRef: candidate.sourceRef,
    sourceArtifactId: artifact.id,
    filingLedgerRawSourceId: ledger.sourceRawId,
    sourceFactIdentity: {
      factKey: sourceFactKey,
      sourceRef: candidate.sourceRef,
      accession: candidate.sourceAccession,
      documentName: candidate.sourceRef,
      artifactId: artifact.id,
      observationType: "source_stated",
    },
    sourceContext: {
      sourceRef: candidate.sourceRef,
      asOf: candidate.asOf,
      issuerCik: candidate.issuerCik,
    },
    sourceDimensions: [],
    sourceProvenance: {
      filingLedgerRawSourceId: ledger.sourceRawId,
      secArtifact: {
        artifactId: artifact.id,
        documentName: artifact.documentName,
        sourceUrl: artifact.sourceUrl,
        contentHash: artifact.contentHash,
        rawContentKind: artifact.rawContentKind,
      },
      approval: {
        approver_user_id: approval.approverUserId,
        approved_at: new Date(approval.approvedAt).toISOString(),
      },
      verifier: { status: "Verified", sourceCheck: input.sourceCheck },
      classUniverse: {
        status: snapshot.status,
        reason: snapshot.reason,
        sourceIdentityHash: snapshot.sourceIdentityHash,
        universeAsOf: snapshot.universeAsOf,
        sourceAccession: snapshot.sourceAccession,
        canonicalSecurityClassId,
        futureSnapshotUsed: false,
      },
    },
    sourceType: HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE,
    authoritativeStatus: null,
    authoritativeDecisionVersion: null,
    authoritativeDecisionReason: null,
    authoritativeDecisionLineage: null,
    sourceDocumentUrl: artifact.sourceUrl,
    sourceContentHash: artifact.contentHash,
    sourceEvidence: candidate.evidence,
    sourceAnalyzer: null,
  };
}

function validateApproval(approval: HumanVerifiedShareCountApproval, ingestedAt: string) {
  if (!UUID_PATTERN.test(approval.approverUserId)
    || !TIMESTAMP_PATTERN.test(approval.approvedAt)
    || Number.isNaN(new Date(approval.approvedAt).valueOf())
    || !TIMESTAMP_PATTERN.test(ingestedAt)
    || Number.isNaN(new Date(ingestedAt).valueOf())) {
    throw new Error("trusted human approval context is invalid");
  }
}

function rejected(
  verifierStatus: HumanVerifiedShareCountWriteResult["verifierStatus"],
  reasons: string[],
): HumanVerifiedShareCountWriteResult {
  return { status: "REJECTED", inserted: 0, deduped: 0, verifierStatus, reasons };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value: unknown) {
  const source = text(value);
  return source && !Number.isNaN(new Date(source).valueOf()) ? new Date(source).toISOString() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
