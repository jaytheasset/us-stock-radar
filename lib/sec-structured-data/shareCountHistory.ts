import { createHash } from "node:crypto";
import {OS_SNAPSHOT_HISTORY_SOURCE,validateOsSnapshotHistory} from './osSnapshotHistoryContract.ts';
import type {
  SecAuthoritativeOsDecision,
  SecAuthoritativeOsEligibleDecision,
} from "./authoritativeOsExtraction.ts";
import {
  CANONICAL_SECURITY_CLASS_ID_PATTERN,
  deriveAuthoritativeCanonicalSecurityClassIdentity,
  isSourceBackedCommonStockConcept,
} from "./shareCountSecurityIdentity.ts";
import type { IssuerCommonClassUniverseSnapshot } from "./issuerCommonClassUniverse.ts";

export const SHARE_COUNT_HISTORY_SOURCE_TYPE = "sec_authoritative_os" as const;
export const HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE =
  "sec_filing_text_human_verified" as const;
export const PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE =
  "sec_prospectus_text_authoritative_os" as const;
export const PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION =
  "prospectus-text-os-baseline-v1" as const;
export const PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON =
  "ELIGIBLE_FINAL_424B4_CURRENT_OS_SINGLE_COMMON_US_LISTING" as const;
export const SHARE_COUNT_HISTORY_SHARE_BASIS = "shares_outstanding:xbrli_shares" as const;
export const SHARE_COUNT_HISTORY_OBSERVATION_TYPE = "authoritative_xbrl" as const;
export const COMPLETE_MULTI_CLASS_OS_DECISION_VERSION =
  "authoritative-multi-class-os-extraction-v1" as const;
export const COMPLETE_MULTI_CLASS_OS_DECISION_REASON =
  "ELIGIBLE_COMPLETE_MULTI_COMMON_STOCK_CONTEXT" as const;

type ShareCountHistoryObservationCommon = {
  id?: string;
  observationType: "authoritative_xbrl" | "source_stated";
  issuerCik: string;
  sharesOutstanding: string;
  asOf: string;
  securityClassBasis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK" | "SOURCE_STATED_SECURITY_CLASS";
  securityClassIdentity: Record<string, unknown>;
  securityClassMetadata: Record<string, unknown>;
  canonicalSecurityClassId: string | null;
  canonicalSecurityClassKind: "common_stock" | null;
  canonicalSecurityClassStatus: "mapped" | "unavailable";
  canonicalSecurityClassProvenance: Record<string, unknown>;
  shareBasisIdentity: typeof SHARE_COUNT_HISTORY_SHARE_BASIS | "shares_outstanding:source_stated";
  shareBasisMetadata: Record<string, unknown>;
  accessionNumber: string;
  form: string;
  filingDocument: string;
  filedDate: string;
  acceptedAt: string | null;
  acceptedAtSource: "sec_filing_ledger" | "sec_raw_payload_acceptance" | "unavailable";
  acceptedAtProvenance: Record<string, unknown>;
  ingestedAt: string;
  sourceConceptNamespaceUri: string | null;
  sourceConceptLocalName:
    | "EntityCommonStockSharesOutstanding"
    | "CommonStockSharesOutstanding"
    | null;
  sourceFactKey: string;
  sourceContextRef: string;
  sourceArtifactId: string;
  filingLedgerRawSourceId: string | null;
  sourceFactIdentity: Record<string, unknown>;
  sourceContext: Record<string, unknown>;
  sourceDimensions: unknown[];
  sourceProvenance: Record<string, unknown>;
  sourceType:
    | typeof SHARE_COUNT_HISTORY_SOURCE_TYPE
    | "sec_filing_text_level2"
    | typeof HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE
    | typeof OS_SNAPSHOT_HISTORY_SOURCE
    | typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE;
  authoritativeStatus: "ELIGIBLE" | null;
  authoritativeDecisionVersion:
    | "authoritative-os-extraction-v1"
    | typeof COMPLETE_MULTI_CLASS_OS_DECISION_VERSION
    | typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION
    | null;
  authoritativeDecisionReason:
    | "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT"
    | "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT"
    | typeof COMPLETE_MULTI_CLASS_OS_DECISION_REASON
    | typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON
    | null;
  authoritativeDecisionLineage: Record<string, unknown> | null;
  sourceDocumentUrl: string;
  sourceContentHash: string;
  sourceEvidence: string | null;
  sourceAnalyzer: string | null;
  createdAt?: string;
};

export type AuthoritativeShareCountHistoryObservation = ShareCountHistoryObservationCommon & {
  observationType: typeof SHARE_COUNT_HISTORY_OBSERVATION_TYPE;
  securityClassBasis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK";
  shareBasisIdentity: typeof SHARE_COUNT_HISTORY_SHARE_BASIS;
  sourceConceptNamespaceUri: string;
  sourceConceptLocalName:
    | "EntityCommonStockSharesOutstanding"
    | "CommonStockSharesOutstanding";
  filingLedgerRawSourceId: string;
  sourceType: typeof SHARE_COUNT_HISTORY_SOURCE_TYPE;
  authoritativeStatus: "ELIGIBLE";
  authoritativeDecisionVersion:
    | "authoritative-os-extraction-v1"
    | typeof COMPLETE_MULTI_CLASS_OS_DECISION_VERSION;
  authoritativeDecisionReason:
    | "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT"
    | "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT"
    | typeof COMPLETE_MULTI_CLASS_OS_DECISION_REASON;
  authoritativeDecisionLineage: Record<string, unknown>;
  sourceEvidence: null;
  sourceAnalyzer: null;
  canonicalSecurityClassId: string;
  canonicalSecurityClassKind: "common_stock";
  canonicalSecurityClassStatus: "mapped";
  acceptedAt: string;
  acceptedAtSource: "sec_filing_ledger";
};

export type Level2ShareCountHistoryObservation = ShareCountHistoryObservationCommon & {
  observationType: "source_stated";
  securityClassBasis: "SOURCE_STATED_SECURITY_CLASS";
  shareBasisIdentity: "shares_outstanding:source_stated";
  sourceConceptNamespaceUri: null;
  sourceConceptLocalName: null;
  filingLedgerRawSourceId: null;
  sourceType: "sec_filing_text_level2";
  authoritativeStatus: null;
  authoritativeDecisionVersion: null;
  authoritativeDecisionReason: null;
  authoritativeDecisionLineage: null;
  sourceEvidence: string;
  sourceAnalyzer: string;
  acceptedAtSource: "sec_raw_payload_acceptance" | "unavailable";
};

export type HumanVerifiedShareCountHistoryObservation = ShareCountHistoryObservationCommon & {
  observationType: "source_stated";
  securityClassBasis: "SOURCE_STATED_SECURITY_CLASS";
  shareBasisIdentity: "shares_outstanding:source_stated";
  sourceConceptNamespaceUri: null;
  sourceConceptLocalName: null;
  filingLedgerRawSourceId: string;
  sourceType: typeof HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE;
  authoritativeStatus: null;
  authoritativeDecisionVersion: null;
  authoritativeDecisionReason: null;
  authoritativeDecisionLineage: null;
  sourceEvidence: string;
  sourceAnalyzer: null;
  canonicalSecurityClassId: string;
  canonicalSecurityClassKind: "common_stock";
  canonicalSecurityClassStatus: "mapped";
  acceptedAt: string;
  acceptedAtSource: "sec_filing_ledger";
};

export type ProspectusTextAuthoritativeShareCountHistoryObservation = ShareCountHistoryObservationCommon & {
  observationType: "source_stated";
  securityClassBasis: "SOURCE_STATED_SECURITY_CLASS";
  shareBasisIdentity: "shares_outstanding:source_stated";
  sourceConceptNamespaceUri: null;
  sourceConceptLocalName: null;
  filingLedgerRawSourceId: string;
  sourceType: typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE;
  authoritativeStatus: "ELIGIBLE";
  authoritativeDecisionVersion: typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION;
  authoritativeDecisionReason: typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON;
  authoritativeDecisionLineage: Record<string, unknown>;
  sourceEvidence: string;
  sourceAnalyzer: null;
  canonicalSecurityClassId: string;
  canonicalSecurityClassKind: "common_stock";
  canonicalSecurityClassStatus: "mapped";
  acceptedAt: string;
  acceptedAtSource: "sec_filing_ledger";
};

export type ShareCountHistoryObservation =
  | AuthoritativeShareCountHistoryObservation
  | Level2ShareCountHistoryObservation
  | HumanVerifiedShareCountHistoryObservation
  | ProspectusTextAuthoritativeShareCountHistoryObservation
  | SnapshotShareCountHistoryObservation;

export type SnapshotShareCountHistoryObservation = Omit<HumanVerifiedShareCountHistoryObservation,'sourceType'> & {
  sourceType: typeof OS_SNAPSHOT_HISTORY_SOURCE;
  /** Read-time database projection only; never persisted as proof of future validity. */
  sourcePublicationCurrent?: boolean;
};

export type ShareCountHistoryWriteResult = { inserted: number; deduped: number };

export type ShareCountHistoryReadFilter = {
  asOfFrom?: string;
  asOfTo?: string;
  securityClassCanonicalKey?: string;
  canonicalSecurityClassId?: string;
};

export interface ShareCountHistoryRepository {
  insertObservation(observation: ShareCountHistoryObservation): Promise<boolean>;
  readHistory(cik: string, filter?: ShareCountHistoryReadFilter): Promise<ShareCountHistoryObservation[]>;
}

export type ShareCountHistorySqlQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export interface ShareCountHistorySqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<ShareCountHistorySqlQueryResult<Row>>;
}

export async function writeAuthoritativeShareCountObservation(input: {
  repository: ShareCountHistoryRepository;
  decision: SecAuthoritativeOsDecision;
  ingestedAt: string;
}): Promise<ShareCountHistoryWriteResult> {
  if (input.decision.status !== "ELIGIBLE") {
    throw new Error(`share count history rejects authoritative status ${input.decision.status}`);
  }
  const observation = toShareCountHistoryObservation(input.decision, input.ingestedAt);
  const inserted = await input.repository.insertObservation(observation);
  return { inserted: inserted ? 1 : 0, deduped: inserted ? 0 : 1 };
}

export async function writeCompleteMultiClassShareCountObservations(input: {
  repository: ShareCountHistoryRepository;
  decision: SecAuthoritativeOsDecision;
  snapshot: IssuerCommonClassUniverseSnapshot;
  ingestedAt: string;
}): Promise<ShareCountHistoryWriteResult> {
  const observations = toCompleteMultiClassShareCountObservations(input);
  let inserted = 0;
  for (const observation of observations) {
    if (await input.repository.insertObservation(observation)) inserted += 1;
  }
  return { inserted, deduped: observations.length - inserted };
}

export function toCompleteMultiClassShareCountObservations(input: {
  decision: SecAuthoritativeOsDecision;
  snapshot: IssuerCommonClassUniverseSnapshot;
  ingestedAt: string;
}): AuthoritativeShareCountHistoryObservation[] {
  validateCompleteMultiClassSource(input);
  const { decision, snapshot } = input;
  const observations = snapshot.classEvidence.flatMap((evidence) =>
    evidence.sourceFacts.map((sourceFact) => {
      const filingFact = decision.filingFacts.find((fact) => fact.factKey === sourceFact.factKey)!;
      const dimension = filingFact.dimensions[0];
      if (!dimension || dimension.kind !== "explicit" || filingFact.unit?.kind !== "measure") {
        throw new Error("complete-multi class fact identity is unresolved");
      }
      const securityClassIdentity = {
        canonicalKey: `CLASS_SPECIFIC_COMMON_STOCK|${dimension.axis.namespaceUri}#${dimension.axis.localName}|${dimension.member.namespaceUri}#${dimension.member.localName}`,
        identity: { axis: structuredClone(dimension.axis), member: structuredClone(dimension.member) },
      };
      const canonicalSecurityClass = deriveAuthoritativeCanonicalSecurityClassIdentity({
        issuerCik: decision.issuerCik,
        basis: "CLASS_SPECIFIC_COMMON_STOCK",
        sourceCanonicalKey: securityClassIdentity.canonicalKey,
        sourceIdentity: structuredClone(securityClassIdentity.identity),
        sourceConcept: structuredClone(filingFact.concept),
        sourceFactKey: filingFact.factKey,
        sourceContextRef: filingFact.contextRef,
      });
      if (canonicalSecurityClass.status !== "mapped"
        || canonicalSecurityClass.canonicalSecurityClassId !== evidence.canonicalSecurityClassId
        || canonicalSecurityClass.canonicalSecurityClassKind !== "common_stock") {
        throw new Error("complete-multi canonical class identity mismatch");
      }
      const sourceConceptLocalName = filingFact.concept.localName;
      if (sourceConceptLocalName !== "CommonStockSharesOutstanding"
        && sourceConceptLocalName !== "EntityCommonStockSharesOutstanding") {
        throw new Error("complete-multi source concept is unsupported");
      }
      const candidateLineage = {
        issuerCik: decision.issuerCik,
        sharesOutstanding: filingFact.normalizedValue,
        asOf: snapshot.universeAsOf,
        accession: snapshot.sourceAccession,
        form: snapshot.sourceForm,
        filedDate: snapshot.sourceFiledDate,
        acceptedAt: snapshot.acceptedAt,
        taxonomy: decision.candidate.taxonomy,
        concept: decision.candidate.concept,
        unit: "shares",
        sourceKind: "filing_xbrl",
        contextKind: "filing_xbrl_explicit",
        discoveryBasis: "complete_multi_common_stock_filing_context",
        aggregateCompanyFactsCandidate: structuredClone(decision.candidate),
      };
      const observation: AuthoritativeShareCountHistoryObservation = {
        observationType: SHARE_COUNT_HISTORY_OBSERVATION_TYPE,
        issuerCik: decision.issuerCik,
        sharesOutstanding: filingFact.normalizedValue!,
        asOf: snapshot.universeAsOf,
        securityClassBasis: "CLASS_SPECIFIC_COMMON_STOCK",
        securityClassIdentity,
        securityClassMetadata: {
          evidenceFactKey: filingFact.factKey,
          contextRef: filingFact.contextRef,
          dimensions: structuredClone(filingFact.dimensions),
          completeUniverseSourceIdentityHash: snapshot.sourceIdentityHash,
        },
        canonicalSecurityClassId: canonicalSecurityClass.canonicalSecurityClassId,
        canonicalSecurityClassKind: canonicalSecurityClass.canonicalSecurityClassKind,
        canonicalSecurityClassStatus: canonicalSecurityClass.status,
        canonicalSecurityClassProvenance: canonicalSecurityClass.provenance,
        shareBasisIdentity: SHARE_COUNT_HISTORY_SHARE_BASIS,
        shareBasisMetadata: {
          measurement: "shares_outstanding",
          unit: structuredClone(filingFact.unit.measure),
          companyFactsAggregateValue: decision.candidate.sharesOutstanding,
          filingLexicalValue: filingFact.lexicalValue,
          decimals: filingFact.decimals,
          precision: filingFact.precision,
          scale: filingFact.scale,
          sign: filingFact.sign,
          inlineFormat: filingFact.inlineFormat,
        },
        accessionNumber: snapshot.sourceAccession,
        form: snapshot.sourceForm,
        filingDocument: filingFact.source.documentName,
        filedDate: snapshot.sourceFiledDate,
        acceptedAt: snapshot.acceptedAt,
        acceptedAtSource: "sec_filing_ledger",
        acceptedAtProvenance: {
          source: "sec_filing_ledger.accepted_at",
          accessionNumber: snapshot.sourceAccession,
          filingLedgerRawSourceId: decision.candidate.filingLedgerRawSourceId,
        },
        ingestedAt: new Date(input.ingestedAt).toISOString(),
        sourceConceptNamespaceUri: filingFact.concept.namespaceUri!,
        sourceConceptLocalName,
        sourceFactKey: filingFact.factKey,
        sourceContextRef: filingFact.contextRef,
        sourceArtifactId: filingFact.source.artifactId,
        filingLedgerRawSourceId: decision.candidate.filingLedgerRawSourceId,
        sourceFactIdentity: {
          factKey: filingFact.factKey,
          contextRef: filingFact.contextRef,
          accession: snapshot.sourceAccession,
          documentName: filingFact.source.documentName,
          artifactId: filingFact.source.artifactId,
          concept: {
            namespaceUri: filingFact.concept.namespaceUri,
            localName: filingFact.concept.localName,
          },
        },
        sourceContext: structuredClone(filingFact.context) as unknown as Record<string, unknown>,
        sourceDimensions: structuredClone(filingFact.dimensions),
        sourceProvenance: {
          companyFacts: structuredClone(decision.candidate.sourceFacts),
          filingLedgerRawSourceId: decision.candidate.filingLedgerRawSourceId,
          filingFactSource: structuredClone(filingFact.source),
          completeMultiClassUniverse: {
            snapshotVersion: snapshot.snapshotVersion,
            sourceIdentityHash: snapshot.sourceIdentityHash,
            requiredCanonicalSecurityClassIds: [...snapshot.requiredCanonicalSecurityClassIds],
            aggregateFactKeys: snapshot.aggregateEvidence.map((fact) => fact.factKey).sort(),
          },
        },
        sourceType: SHARE_COUNT_HISTORY_SOURCE_TYPE,
        authoritativeStatus: "ELIGIBLE",
        authoritativeDecisionVersion: COMPLETE_MULTI_CLASS_OS_DECISION_VERSION,
        authoritativeDecisionReason: COMPLETE_MULTI_CLASS_OS_DECISION_REASON,
        authoritativeDecisionLineage: {
          status: "ELIGIBLE",
          decisionVersion: COMPLETE_MULTI_CLASS_OS_DECISION_VERSION,
          reason: COMPLETE_MULTI_CLASS_OS_DECISION_REASON,
          candidate: candidateLineage,
          filingFacts: structuredClone(decision.filingFacts),
          parentDecision: {
            status: decision.status,
            reason: decision.reason,
            decisionVersion: decision.decisionVersion,
          },
          universe: {
            snapshotVersion: snapshot.snapshotVersion,
            sourceIdentityHash: snapshot.sourceIdentityHash,
            status: snapshot.status,
            reason: snapshot.reason,
            requiredCanonicalSecurityClassIds: [...snapshot.requiredCanonicalSecurityClassIds],
          },
        },
        sourceDocumentUrl: filingFact.source.sourceUrl,
        sourceContentHash: filingFact.source.contentHash,
        sourceEvidence: null,
        sourceAnalyzer: null,
      };
      validateObservation(observation);
      return observation;
    }));
  return observations.sort(compareHistory);
}

export async function readShareCountHistory(
  repository: ShareCountHistoryRepository,
  cik: string,
  filter: ShareCountHistoryReadFilter = {},
): Promise<ShareCountHistoryObservation[]> {
  validateCik(cik);
  validateReadFilter(filter);
  return repository.readHistory(cik, filter);
}

export function toShareCountHistoryObservation(
  decision: SecAuthoritativeOsEligibleDecision,
  ingestedAt: string,
): AuthoritativeShareCountHistoryObservation {
  validateEligibleDecision(decision, ingestedAt);
  const value = decision.authoritative;
  const filingFact = decision.filingFacts.find((fact) => fact.factKey === value.factKey)!;
  if (filingFact.unit?.kind !== "measure") throw new Error("selected filing fact unit is unresolved");
  const securityClassIdentity = {
    canonicalKey: securityClassCanonicalKey(value.securityClass),
    identity: structuredClone(value.securityClass.identity),
  };
  const canonicalSecurityClass = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: value.issuerCik,
    basis: value.securityClass.basis,
    sourceCanonicalKey: String(securityClassIdentity.canonicalKey),
    sourceIdentity: structuredClone(value.securityClass.identity),
    ...(value.securityClass.basis === "CLASS_SPECIFIC_COMMON_STOCK" ? {
      sourceConcept: {
        namespaceUri: value.conceptNamespaceUri,
        localName: value.conceptLocalName,
      },
    } : {}),
    sourceFactKey: value.factKey,
    sourceContextRef: value.contextRef,
  } as Parameters<typeof deriveAuthoritativeCanonicalSecurityClassIdentity>[0]);
  if (canonicalSecurityClass.status !== "mapped"
    || !canonicalSecurityClass.canonicalSecurityClassId
    || canonicalSecurityClass.canonicalSecurityClassKind !== "common_stock") {
    throw new Error("authoritative security class cannot be assigned a canonical identity");
  }
  const observation: ShareCountHistoryObservation = {
    observationType: SHARE_COUNT_HISTORY_OBSERVATION_TYPE,
    issuerCik: value.issuerCik,
    sharesOutstanding: value.sharesOutstanding,
    asOf: value.asOf,
    securityClassBasis: value.securityClass.basis,
    securityClassIdentity,
    securityClassMetadata: {
      evidenceFactKey: value.securityClass.evidenceFactKey,
      contextRef: value.securityClass.contextRef,
      dimensions: structuredClone(value.securityClass.dimensions),
    },
    canonicalSecurityClassId: canonicalSecurityClass.canonicalSecurityClassId,
    canonicalSecurityClassKind: canonicalSecurityClass.canonicalSecurityClassKind,
    canonicalSecurityClassStatus: canonicalSecurityClass.status,
    canonicalSecurityClassProvenance: canonicalSecurityClass.provenance,
    shareBasisIdentity: SHARE_COUNT_HISTORY_SHARE_BASIS,
    shareBasisMetadata: {
      measurement: "shares_outstanding",
      unit: structuredClone(filingFact.unit!.measure),
      candidateUnit: decision.candidate.unit,
      companyFactsValue: decision.candidate.sharesOutstanding,
      filingLexicalValue: value.filingLexicalValue,
      decimals: filingFact.decimals,
      precision: filingFact.precision,
      scale: filingFact.scale,
      sign: filingFact.sign,
      inlineFormat: filingFact.inlineFormat,
    },
    accessionNumber: value.accession,
    form: value.form,
    filingDocument: value.filingDocument,
    filedDate: value.filedDate,
    acceptedAt: value.acceptedAt,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: {
      source: "sec_filing_ledger.accepted_at",
      accessionNumber: value.accession,
      filingLedgerRawSourceId: value.filingLedgerRawSourceId,
    },
    ingestedAt: new Date(ingestedAt).toISOString(),
    sourceConceptNamespaceUri: value.conceptNamespaceUri,
    sourceConceptLocalName: value.conceptLocalName,
    sourceFactKey: value.factKey,
    sourceContextRef: value.contextRef,
    sourceArtifactId: value.source.artifactId,
    filingLedgerRawSourceId: value.filingLedgerRawSourceId,
    sourceFactIdentity: {
      factKey: value.factKey,
      contextRef: value.contextRef,
      accession: value.accession,
      documentName: value.filingDocument,
      artifactId: value.source.artifactId,
      concept: {
        namespaceUri: value.conceptNamespaceUri,
        localName: value.conceptLocalName,
      },
    },
    sourceContext: structuredClone(value.context) as unknown as Record<string, unknown>,
    sourceDimensions: structuredClone(value.dimensions),
    sourceProvenance: {
      companyFacts: structuredClone(value.companyFactsProvenance),
      filingLedgerRawSourceId: value.filingLedgerRawSourceId,
      filingFactSource: structuredClone(value.source),
      tradingSecurityEvidence: structuredClone(value.tradingSecurityEvidence),
    },
    sourceType: SHARE_COUNT_HISTORY_SOURCE_TYPE,
    authoritativeStatus: "ELIGIBLE",
    authoritativeDecisionVersion: value.decisionVersion,
    authoritativeDecisionReason: value.decisionReason,
    authoritativeDecisionLineage: {
      status: decision.status,
      decisionVersion: decision.decisionVersion,
      reason: decision.reason,
      candidate: structuredClone(decision.candidate),
      filingFacts: structuredClone(decision.filingFacts),
      tradingSecurityFacts: structuredClone(decision.tradingSecurityFacts),
      tradingSecurityEvidence: structuredClone(value.tradingSecurityEvidence),
    },
    sourceDocumentUrl: value.source.sourceUrl,
    sourceContentHash: value.source.contentHash,
    sourceEvidence: null,
    sourceAnalyzer: null,
  };
  validateObservation(observation);
  return observation;
}

export class InMemoryShareCountHistoryRepository implements ShareCountHistoryRepository {
  private readonly observations = new Map<string, ShareCountHistoryObservation>();
  private nextId = 1;

  async insertObservation(observation: ShareCountHistoryObservation) {
    validateObservation(observation);
    const identity = canonicalSourceIdentity(observation);
    if (this.observations.has(identity)) return false;
    this.observations.set(identity, {
      ...structuredClone(observation),
      id: String(this.nextId++),
      createdAt: observation.createdAt ?? observation.ingestedAt,
    });
    return true;
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    validateCik(cik);
    validateReadFilter(filter);
    return [...this.observations.values()]
      .filter((row) => row.issuerCik === cik)
      .filter((row) => !filter.asOfFrom || row.asOf >= filter.asOfFrom)
      .filter((row) => !filter.asOfTo || row.asOf <= filter.asOfTo)
      .filter((row) => !filter.securityClassCanonicalKey
        || row.securityClassIdentity.canonicalKey === filter.securityClassCanonicalKey)
      .filter((row) => !filter.canonicalSecurityClassId
        || row.canonicalSecurityClassId === filter.canonicalSecurityClassId)
      .sort(compareHistory)
      .map((row) => structuredClone(row));
  }
}

export function toShareCountHistoryDatabaseRow(row: ShareCountHistoryObservation): Record<string, unknown> {
  validateObservation(row);
  return {
    observation_type: row.observationType,
    issuer_cik: row.issuerCik,
    shares_outstanding: row.sharesOutstanding,
    as_of: row.asOf,
    security_class_basis: row.securityClassBasis,
    security_class_identity: row.securityClassIdentity,
    security_class_metadata: row.securityClassMetadata,
    canonical_security_class_id: row.canonicalSecurityClassId,
    canonical_security_class_kind: row.canonicalSecurityClassKind,
    canonical_security_class_status: row.canonicalSecurityClassStatus,
    canonical_security_class_provenance: row.canonicalSecurityClassProvenance,
    share_basis_identity: row.shareBasisIdentity,
    share_basis_metadata: row.shareBasisMetadata,
    accession_number: row.accessionNumber,
    form: row.form,
    filing_document: row.filingDocument,
    filed_date: row.filedDate,
    accepted_at: row.acceptedAt,
    accepted_at_source: row.acceptedAtSource,
    accepted_at_provenance: row.acceptedAtProvenance,
    ingested_at: row.ingestedAt,
    source_concept_namespace_uri: row.sourceConceptNamespaceUri,
    source_concept_local_name: row.sourceConceptLocalName,
    source_fact_key: row.sourceFactKey,
    source_context_ref: row.sourceContextRef,
    source_artifact_id: row.sourceArtifactId,
    filing_ledger_raw_source_id: row.filingLedgerRawSourceId,
    source_fact_identity: row.sourceFactIdentity,
    source_context: row.sourceContext,
    source_dimensions: row.sourceDimensions,
    source_provenance: row.sourceProvenance,
    source_type: row.sourceType,
    authoritative_status: row.authoritativeStatus,
    authoritative_decision_version: row.authoritativeDecisionVersion,
    authoritative_decision_reason: row.authoritativeDecisionReason,
    authoritative_decision_lineage: row.authoritativeDecisionLineage,
    source_document_url: row.sourceDocumentUrl,
    source_content_hash: row.sourceContentHash,
    source_evidence: row.sourceEvidence,
    source_analyzer: row.sourceAnalyzer,
  };
}

export class PostgresShareCountHistoryRepository implements ShareCountHistoryRepository {
  private readonly client: ShareCountHistorySqlClient;

  constructor(client: ShareCountHistorySqlClient) {
    this.client = client;
  }

  async insertObservation(observation: ShareCountHistoryObservation) {
    validateObservation(observation);
    const result = await this.client.query<{ id: string }>(
       `insert into public.share_count_history (
         observation_type, issuer_cik, shares_outstanding, as_of, security_class_basis,
         security_class_identity, security_class_metadata, share_basis_identity,
         canonical_security_class_id, canonical_security_class_kind,
         canonical_security_class_status, canonical_security_class_provenance,
         share_basis_metadata, accession_number, form, filing_document, filed_date,
         accepted_at, accepted_at_source, accepted_at_provenance, ingested_at,
         source_concept_namespace_uri,
         source_concept_local_name, source_fact_key, source_context_ref,
         source_artifact_id, filing_ledger_raw_source_id, source_fact_identity,
         source_context, source_dimensions, source_provenance,
         source_type, authoritative_status, authoritative_decision_version,
         authoritative_decision_reason, authoritative_decision_lineage,
         source_document_url, source_content_hash, source_evidence, source_analyzer
       ) values (
         $1, $2, $3::numeric, $4::date, $5, $6::jsonb, $7::jsonb, $8,
         $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17::date,
         $18::timestamptz, $19, $20::jsonb, $21::timestamptz, $22, $23,
         $24, $25, $26::uuid, $27::uuid, $28::jsonb, $29::jsonb,
         $30::jsonb, $31::jsonb, $32, $33, $34, $35, $36::jsonb, $37, $38,
         $39, $40
       )
       on conflict on constraint share_count_history_canonical_source_unique do nothing
       returning id::text`,
      observationValues(observation),
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    validateCik(cik);
    validateReadFilter(filter);
    const result = await this.client.query<Record<string, unknown>>(
       `select id::text, observation_type, issuer_cik, shares_outstanding::text, as_of::text,
              security_class_basis, security_class_identity, security_class_metadata,
              canonical_security_class_id, canonical_security_class_kind,
              canonical_security_class_status, canonical_security_class_provenance,
              share_basis_identity, share_basis_metadata, accession_number, form,
              filing_document, filed_date::text, accepted_at::text, accepted_at_source,
              accepted_at_provenance, ingested_at::text,
              source_concept_namespace_uri, source_concept_local_name, source_fact_key,
              source_context_ref, source_artifact_id::text, filing_ledger_raw_source_id::text,
              source_fact_identity, source_context, source_dimensions,
              source_provenance, source_type, authoritative_status,
              authoritative_decision_version, authoritative_decision_reason,
              authoritative_decision_lineage, source_document_url, source_content_hash,
              source_evidence, source_analyzer, created_at::text, snapshot_publication_valid
       from public.share_count_history_eligible
       where issuer_cik = $1
         and ($2::date is null or as_of >= $2::date)
         and ($3::date is null or as_of <= $3::date)
         and ($4::text is null or security_class_identity ->> 'canonicalKey' = $4)
         and ($5::text is null or canonical_security_class_id = $5)
       order by as_of, accepted_at, accession_number, id`,
      [cik, filter.asOfFrom ?? null, filter.asOfTo ?? null,
        filter.securityClassCanonicalKey ?? null, filter.canonicalSecurityClassId ?? null],
    );
    return result.rows.map(mapShareCountHistoryDatabaseRow);
  }
}

function validateCompleteMultiClassSource(input: {
  decision: SecAuthoritativeOsDecision;
  snapshot: IssuerCommonClassUniverseSnapshot;
  ingestedAt: string;
}) {
  const { decision, snapshot } = input;
  validateTimestamp(input.ingestedAt, "ingestedAt");
  if (snapshot.snapshotVersion !== "issuer-common-class-universe-snapshot-v2"
    || snapshot.status !== "COMPLETE_MULTI"
    || snapshot.reason !== "COMPLETE_MULTI_COMMON_STOCK"
    || decision.status !== "REQUIRES_FURTHER_CONTEXT"
    || decision.reason !== "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION"
    || decision.candidate.taxonomy !== "us-gaap"
    || decision.candidate.concept !== "CommonStockSharesOutstanding") {
    throw new Error("complete-multi authoritative source contract is unavailable");
  }
  if (decision.issuerCik !== snapshot.issuerCik
    || decision.candidate.issuerCik !== snapshot.issuerCik
    || decision.candidate.asOf !== snapshot.universeAsOf
    || decision.candidate.accession !== snapshot.sourceAccession
    || decision.candidate.form !== snapshot.sourceForm
    || decision.candidate.filedDate !== snapshot.sourceFiledDate
    || new Date(decision.candidate.acceptedAt).toISOString() !== snapshot.acceptedAt) {
    throw new Error("complete-multi filing identity lineage mismatch");
  }
  if (!UUID_PATTERN.test(decision.candidate.filingLedgerRawSourceId)
    || decision.candidate.sourceFacts.length === 0
    || decision.candidate.sourceFacts.some((source) => !HEX_64_PATTERN.test(source.sourceFactKey)
      || !compact(source.sourceFactPath) || !UUID_PATTERN.test(source.sourceRawId))) {
    throw new Error("complete-multi CompanyFacts/filing ledger anchor is incomplete");
  }
  if (snapshot.requiredCanonicalSecurityClassIds.length < 2
    || snapshot.classEvidence.length !== snapshot.requiredCanonicalSecurityClassIds.length
    || snapshot.aggregateEvidence.length !== 1
    || snapshot.aggregateEvidence[0]?.sharesOutstanding !== decision.candidate.sharesOutstanding) {
    throw new Error("complete-multi universe evidence is incomplete");
  }
  const classSum = snapshot.classEvidence.reduce(
    (sum, evidence) => sum + BigInt(evidence.sharesOutstanding),
    BigInt(0),
  );
  if (classSum !== BigInt(decision.candidate.sharesOutstanding)) {
    throw new Error("complete-multi aggregate corroboration mismatch");
  }
  const evidenceIds = snapshot.classEvidence.map((evidence) => evidence.canonicalSecurityClassId).sort();
  if (evidenceIds.join("|") !== [...snapshot.requiredCanonicalSecurityClassIds].sort().join("|")
    || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error("complete-multi required class coverage mismatch");
  }
  for (const evidence of snapshot.classEvidence) {
    if (!POSITIVE_INTEGER_PATTERN.test(evidence.sharesOutstanding) || evidence.sourceFacts.length === 0) {
      throw new Error("complete-multi class value is invalid");
    }
    for (const sourceFact of evidence.sourceFacts) {
      const fact = decision.filingFacts.find((candidate) => candidate.factKey === sourceFact.factKey);
      if (!fact || fact.normalizedValue !== evidence.sharesOutstanding
        || fact.contextRef !== sourceFact.contextRef
        || fact.context.period.kind !== "instant"
        || fact.context.period.instant !== snapshot.universeAsOf
        || fact.concept.namespaceUri !== sourceFact.concept?.namespaceUri
        || fact.concept.localName !== sourceFact.concept?.localName
        || !isSourceBackedCommonStockConcept(fact.concept)
        || fact.dimensions.length !== 1
        || fact.dimensions[0]?.kind !== "explicit"
        || fact.unit?.kind !== "measure"
        || fact.unit.measure.namespaceUri !== "http://www.xbrl.org/2003/instance"
        || fact.unit.measure.localName !== "shares") {
        throw new Error("complete-multi source fact lineage is incomplete");
      }
    }
  }
}

function validateEligibleDecision(decision: SecAuthoritativeOsEligibleDecision, ingestedAt: string) {
  const value = decision.authoritative;
  validateTimestamp(ingestedAt, "ingestedAt");
  if (decision.status !== "ELIGIBLE" || value.decisionVersion !== decision.decisionVersion
    || value.decisionReason !== decision.reason) throw new Error("incomplete authoritative decision lineage");
  validateCik(value.issuerCik);
  if (decision.issuerCik !== value.issuerCik || decision.candidate.issuerCik !== value.issuerCik) {
    throw new Error("authoritative issuer lineage mismatch");
  }
  if (!POSITIVE_INTEGER_PATTERN.test(value.sharesOutstanding)
    || value.sharesOutstanding !== decision.candidate.sharesOutstanding) {
    throw new Error("sharesOutstanding must be the exact positive CompanyFacts integer");
  }
  validateDate(value.asOf, "asOf");
  validateDate(value.filedDate, "filedDate");
  validateTimestamp(value.acceptedAt, "acceptedAt");
  if (value.asOf !== decision.candidate.asOf || value.accession !== decision.candidate.accession
    || value.form !== decision.candidate.form || value.filedDate !== decision.candidate.filedDate
    || value.acceptedAt !== decision.candidate.acceptedAt) throw new Error("filing identity lineage mismatch");
  if (!ACCESSION_PATTERN.test(value.accession) || !compact(value.form) || !compact(value.filingDocument)) {
    throw new Error("filing identity is incomplete");
  }
  if (value.taxonomy !== "dei" || value.concept !== "EntityCommonStockSharesOutstanding"
    || value.conceptLocalName !== "EntityCommonStockSharesOutstanding"
    || !DEI_NAMESPACE_PATTERN.test(value.conceptNamespaceUri)) throw new Error("source concept identity is unresolved");
  if (FOREIGN_PERIODIC_FORMS.has(value.form)) {
    validateForeignTradingSecurityEvidence(decision);
  } else if (value.tradingSecurityEvidence !== null) {
    throw new Error("domestic authoritative O/S cannot carry foreign trading-security evidence");
  }
  if (!HEX_64_PATTERN.test(value.factKey) || value.context.id !== value.contextRef
    || value.context.period.kind !== "instant" || value.context.period.instant !== value.asOf) {
    throw new Error("fact/context identity is incomplete");
  }
  if (normalizeCik(value.context.entityIdentifier) !== value.issuerCik
    || !/^https?:\/\/www\.sec\.gov\/CIK$/i.test(value.context.entityScheme)) {
    throw new Error("filing context issuer identity mismatch");
  }
  if (!UUID_PATTERN.test(value.source.artifactId) || value.source.issuerCik !== value.issuerCik
    || value.source.accession !== value.accession || value.source.documentName !== value.filingDocument
    || !SEC_URL_PATTERN.test(value.source.sourceUrl) || !HEX_64_PATTERN.test(value.source.contentHash)
    || !TIMESTAMP_PATTERN.test(value.source.fetchedAt)
    || !["authoritative_http_body", "injected_exact_body"].includes(value.source.rawContentKind)) {
    throw new Error("filing XBRL source lineage is incomplete");
  }
  validateTimestamp(value.source.fetchedAt, "source.fetchedAt");
  if (!UUID_PATTERN.test(value.filingLedgerRawSourceId) || value.companyFactsProvenance.length === 0
    || value.companyFactsProvenance.some((source) => !HEX_64_PATTERN.test(source.sourceFactKey)
      || !compact(source.sourceFactPath) || !UUID_PATTERN.test(source.sourceRawId))) {
    throw new Error("CompanyFacts/filing ledger provenance is incomplete");
  }
  const filingFact = decision.filingFacts.find((fact) => fact.factKey === value.factKey);
  if (!filingFact || filingFact.contextRef !== value.contextRef
    || filingFact.normalizedValue !== value.sharesOutstanding
    || filingFact.lexicalValue !== value.filingLexicalValue
    || filingFact.source.artifactId !== value.source.artifactId
    || filingFact.unit?.kind !== "measure"
    || filingFact.unit.measure.namespaceUri !== "http://www.xbrl.org/2003/instance"
    || filingFact.unit.measure.localName !== "shares") throw new Error("selected filing fact lineage is incomplete");
  validateSecurityClass(value.securityClass, value.dimensions, value.factKey, value.contextRef);
}

function validateForeignTradingSecurityEvidence(decision: SecAuthoritativeOsEligibleDecision) {
  const value = decision.authoritative;
  const evidence = value.tradingSecurityEvidence;
  if (!evidence || evidence.evidenceVersion !== "us-listed-foreign-os-evidence-v1"
    || evidence.linkedOsFactKey !== value.factKey
    || evidence.linkedOsContextRef !== value.contextRef
    || decision.tradingSecurityFacts.length !== 3) {
    throw new Error("foreign trading-security evidence is incomplete");
  }
  const expectedConcepts = new Map([
    ["Security12bTitle", evidence.securityTitle],
    ["TradingSymbol", evidence.tradingSymbol],
    ["SecurityExchangeName", evidence.exchangeName],
  ]);
  const contextRefs = new Set<string>();
  for (const [concept, fact] of expectedConcepts) {
    const decisionFact = decision.tradingSecurityFacts.find((item) => item.factKey === fact.factKey);
    if (!decisionFact || decisionFact.concept.localName !== concept
      || stableJson(decisionFact) !== stableJson(fact)
      || !HEX_64_PATTERN.test(fact.factKey)
      || !fact.valueText || !compact(fact.valueText)
      || fact.unitRef !== null || fact.isNil
      || normalizeCik(fact.context.entityIdentifier) !== value.issuerCik
      || !/^https?:\/\/www\.sec\.gov\/CIK$/i.test(fact.context.entityScheme)
      || fact.source.issuerCik !== value.issuerCik
      || fact.source.accession !== value.accession
      || stableJson(fact.dimensions) !== stableJson(value.dimensions)
      || fact.context.period.kind !== "duration"
      || fact.context.period.endDate !== value.asOf) {
      throw new Error("foreign trading-security fact lineage is incomplete");
    }
    contextRefs.add(`${fact.source.artifactId}|${fact.contextRef}`);
  }
  if (contextRefs.size !== 1) throw new Error("foreign trading-security class linkage is ambiguous");
}

function validateSecurityClass(
  securityClass: SecAuthoritativeOsEligibleDecision["authoritative"]["securityClass"],
  dimensions: SecAuthoritativeOsEligibleDecision["authoritative"]["dimensions"],
  factKey: string,
  contextRef: string,
) {
  if (securityClass.evidenceFactKey !== factKey || securityClass.contextRef !== contextRef
    || stableJson(securityClass.dimensions) !== stableJson(dimensions)) {
    throw new Error("security-class evidence lineage mismatch");
  }
  if (securityClass.basis === "SINGLE_COMMON_STOCK_CLASS") {
    if (securityClass.identity !== "dei:EntityCommonStockSharesOutstanding@required-context"
      || dimensions.length !== 0) throw new Error("single-class identity is unresolved");
    return;
  }
  if (dimensions.length !== 1 || dimensions[0]?.kind !== "explicit"
    || stableJson(securityClass.identity.axis) !== stableJson(dimensions[0].axis)
    || stableJson(securityClass.identity.member) !== stableJson(dimensions[0].member)
    || !qnameResolved(securityClass.identity.axis) || !qnameResolved(securityClass.identity.member)) {
    throw new Error("class-specific identity is unresolved");
  }
}

function validateObservation(row: ShareCountHistoryObservation) {
  validateCik(row.issuerCik);
  if (!POSITIVE_INTEGER_PATTERN.test(row.sharesOutstanding)) throw new Error("sharesOutstanding must be positive integer");
  validateDate(row.asOf, "asOf");
  validateDate(row.filedDate, "filedDate");
  if (row.acceptedAt === null) {
    if (row.acceptedAtSource !== "unavailable") throw new Error("acceptedAt source requires a timestamp");
  } else {
    validateTimestamp(row.acceptedAt, "acceptedAt");
    if (row.acceptedAtSource === "unavailable") throw new Error("untrusted acceptedAt cannot be stored");
  }
  if (!isRecord(row.acceptedAtProvenance)) throw new Error("acceptedAt provenance is incomplete");
  const expectedAcceptedAtProvenanceSource = row.acceptedAtSource === "sec_filing_ledger"
    ? "sec_filing_ledger.accepted_at"
    : row.acceptedAtSource === "sec_raw_payload_acceptance"
      ? "raw_items.raw_payload.accepted_at"
      : "unavailable";
  if (row.acceptedAtProvenance.source !== expectedAcceptedAtProvenanceSource
    || (row.acceptedAtSource === "unavailable" && !compact(String(row.acceptedAtProvenance.reason ?? "")))) {
    throw new Error("acceptedAt provenance source is invalid");
  }
  validateTimestamp(row.ingestedAt, "ingestedAt");
  if (!ACCESSION_PATTERN.test(row.accessionNumber) || !compact(row.form) || !compact(row.filingDocument)) throw new Error("filing identity is incomplete");
  if (!HEX_64_PATTERN.test(row.sourceFactKey) || !compact(row.sourceContextRef)
    || !UUID_PATTERN.test(row.sourceArtifactId) || !SEC_URL_PATTERN.test(row.sourceDocumentUrl)
    || !HEX_64_PATTERN.test(row.sourceContentHash) || !isRecord(row.sourceFactIdentity)
    || !isRecord(row.sourceContext) || !Array.isArray(row.sourceDimensions)
    || !isRecord(row.sourceProvenance)) throw new Error("source fact/provenance identity is incomplete");
  const classIdentity = row.securityClassIdentity.identity;
  if (!compact(String(row.securityClassIdentity.canonicalKey ?? ""))) throw new Error("security-class identity is incomplete");
  validateCanonicalSecurityClass(row);
  if(row.sourceType===OS_SNAPSHOT_HISTORY_SOURCE){validateOsSnapshotHistory(row);return;}
  if (row.sourceType === "sec_filing_text_level2") {
    validateLevel2Observation(row);
    return;
  }
  if (row.sourceType === HUMAN_VERIFIED_SHARE_COUNT_HISTORY_SOURCE_TYPE) {
    validateHumanVerifiedObservation(row);
    return;
  }
  if (row.sourceType === PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE) {
    validateProspectusTextAuthoritativeObservation(row);
    return;
  }
  if (row.observationType !== SHARE_COUNT_HISTORY_OBSERVATION_TYPE) {
    throw new Error("authoritative observation type is invalid");
  }
  if (row.securityClassBasis === "SINGLE_COMMON_STOCK_CLASS") {
    if (classIdentity !== "dei:EntityCommonStockSharesOutstanding@required-context" || row.sourceDimensions.length !== 0) {
      throw new Error("single security-class identity is unresolved");
    }
    if (row.securityClassIdentity.canonicalKey !== `SINGLE_COMMON_STOCK_CLASS|${classIdentity}`) {
      throw new Error("single security-class canonical identity mismatch");
    }
  } else if (row.securityClassBasis === "CLASS_SPECIFIC_COMMON_STOCK") {
    if (!isRecord(classIdentity) || !isRecord(classIdentity.axis) || !isRecord(classIdentity.member)
      || !compact(String(classIdentity.axis.namespaceUri ?? "")) || !compact(String(classIdentity.axis.localName ?? ""))
      || !compact(String(classIdentity.member.namespaceUri ?? "")) || !compact(String(classIdentity.member.localName ?? ""))
      || row.sourceDimensions.length !== 1) throw new Error("class-specific security identity is unresolved");
    const expectedKey = `CLASS_SPECIFIC_COMMON_STOCK|${String(classIdentity.axis.namespaceUri)}#${String(classIdentity.axis.localName)}|${String(classIdentity.member.namespaceUri)}#${String(classIdentity.member.localName)}`;
    if (row.securityClassIdentity.canonicalKey !== expectedKey) throw new Error("class-specific canonical identity mismatch");
  } else {
    throw new Error("unsupported security-class basis");
  }
  if (row.shareBasisIdentity !== SHARE_COUNT_HISTORY_SHARE_BASIS
    || row.shareBasisMetadata.measurement !== "shares_outstanding"
    || !isRecord(row.shareBasisMetadata.unit)
    || row.shareBasisMetadata.unit.namespaceUri !== "http://www.xbrl.org/2003/instance"
    || row.shareBasisMetadata.unit.localName !== "shares") throw new Error("share basis is unresolved");
  if (!isRecord(row.securityClassMetadata)
    || row.securityClassMetadata.evidenceFactKey !== row.sourceFactKey
    || row.securityClassMetadata.contextRef !== row.sourceContextRef
    || stableJson(row.securityClassMetadata.dimensions) !== stableJson(row.sourceDimensions)) {
    throw new Error("security-class metadata lineage mismatch");
  }
  if (row.sourceType !== SHARE_COUNT_HISTORY_SOURCE_TYPE || row.authoritativeStatus !== "ELIGIBLE"
    || (row.authoritativeDecisionVersion !== "authoritative-os-extraction-v1"
      && row.authoritativeDecisionVersion !== COMPLETE_MULTI_CLASS_OS_DECISION_VERSION)
    || row.acceptedAtSource !== "sec_filing_ledger" || row.acceptedAt === null) {
    throw new Error("unsupported share-count source lineage");
  }
  if (!isSourceBackedCommonStockConcept({
    namespaceUri: row.sourceConceptNamespaceUri,
    localName: row.sourceConceptLocalName ?? "",
  })
    || !row.filingLedgerRawSourceId || !UUID_PATTERN.test(row.filingLedgerRawSourceId)
    || row.sourceEvidence !== null || row.sourceAnalyzer !== null) {
    throw new Error("source fact/provenance identity is incomplete");
  }
  if (!isRecord(row.authoritativeDecisionLineage)) throw new Error("structured provenance is incomplete");
  if (row.sourceFactIdentity.factKey !== row.sourceFactKey
    || row.sourceFactIdentity.contextRef !== row.sourceContextRef
    || row.sourceFactIdentity.accession !== row.accessionNumber
    || row.sourceFactIdentity.documentName !== row.filingDocument
    || row.sourceFactIdentity.artifactId !== row.sourceArtifactId
    || row.sourceContext.id !== row.sourceContextRef
    || !isRecord(row.sourceContext.period)
    || row.sourceContext.period.kind !== "instant"
    || row.sourceContext.period.instant !== row.asOf
    || row.sourceContext.entityIdentifier !== row.issuerCik
    || stableJson(row.sourceContext.dimensions) !== stableJson(row.sourceDimensions)) {
    throw new Error("fact/context lineage mismatch");
  }
  const companyFacts = row.sourceProvenance.companyFacts;
  const filingFactSource = row.sourceProvenance.filingFactSource;
  if (!Array.isArray(companyFacts) || companyFacts.length === 0
    || row.sourceProvenance.filingLedgerRawSourceId !== row.filingLedgerRawSourceId
    || !isRecord(filingFactSource) || filingFactSource.artifactId !== row.sourceArtifactId
    || filingFactSource.sourceUrl !== row.sourceDocumentUrl
    || filingFactSource.contentHash !== row.sourceContentHash) throw new Error("source provenance is incomplete");
  if (row.authoritativeDecisionLineage.status !== "ELIGIBLE"
    || row.authoritativeDecisionLineage.decisionVersion !== row.authoritativeDecisionVersion
    || row.authoritativeDecisionLineage.reason !== row.authoritativeDecisionReason
    || !isRecord(row.authoritativeDecisionLineage.candidate)
    || row.authoritativeDecisionLineage.candidate.issuerCik !== row.issuerCik
    || row.authoritativeDecisionLineage.candidate.sharesOutstanding !== row.sharesOutstanding
    || row.authoritativeDecisionLineage.candidate.asOf !== row.asOf
    || row.authoritativeDecisionLineage.candidate.accession !== row.accessionNumber
    || row.authoritativeDecisionLineage.candidate.form !== row.form
    || row.authoritativeDecisionLineage.candidate.filedDate !== row.filedDate
    || !Array.isArray(row.authoritativeDecisionLineage.filingFacts)
    || row.authoritativeDecisionLineage.filingFacts.length === 0) throw new Error("authoritative lineage is incomplete");
  if (FOREIGN_PERIODIC_FORMS.has(row.form)) {
    const sourceTrading = row.sourceProvenance.tradingSecurityEvidence;
    const lineageTrading = row.authoritativeDecisionLineage.tradingSecurityEvidence;
    const lineageTradingFacts = row.authoritativeDecisionLineage.tradingSecurityFacts;
    if (!isRecord(sourceTrading)
      || sourceTrading.evidenceVersion !== "us-listed-foreign-os-evidence-v1"
      || !isRecord(lineageTrading)
      || stableJson(sourceTrading) !== stableJson(lineageTrading)
      || !Array.isArray(lineageTradingFacts)
      || lineageTradingFacts.length !== 3) {
      throw new Error("foreign trading-security lineage is incomplete");
    }
  }
  const v1 = row.authoritativeDecisionVersion === "authoritative-os-extraction-v1"
    && (row.authoritativeDecisionReason === "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT"
      || row.authoritativeDecisionReason === "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT")
    && row.sourceConceptLocalName === "EntityCommonStockSharesOutstanding"
    && DEI_NAMESPACE_PATTERN.test(row.sourceConceptNamespaceUri);
  const completeMultiUniverse = row.sourceProvenance.completeMultiClassUniverse;
  const lineageUniverse = row.authoritativeDecisionLineage.universe;
  const lineageParent = row.authoritativeDecisionLineage.parentDecision;
  const completeMulti = row.authoritativeDecisionVersion === COMPLETE_MULTI_CLASS_OS_DECISION_VERSION
    && row.authoritativeDecisionReason === COMPLETE_MULTI_CLASS_OS_DECISION_REASON
    && row.securityClassBasis === "CLASS_SPECIFIC_COMMON_STOCK"
    && isRecord(completeMultiUniverse)
    && completeMultiUniverse.snapshotVersion === "issuer-common-class-universe-snapshot-v2"
    && completeMultiUniverse.sourceIdentityHash === row.securityClassMetadata.completeUniverseSourceIdentityHash
    && Array.isArray(completeMultiUniverse.requiredCanonicalSecurityClassIds)
    && completeMultiUniverse.requiredCanonicalSecurityClassIds.includes(row.canonicalSecurityClassId)
    && isRecord(lineageUniverse)
    && lineageUniverse.snapshotVersion === completeMultiUniverse.snapshotVersion
    && lineageUniverse.sourceIdentityHash === completeMultiUniverse.sourceIdentityHash
    && lineageUniverse.status === "COMPLETE_MULTI"
    && lineageUniverse.reason === "COMPLETE_MULTI_COMMON_STOCK"
    && isRecord(lineageParent)
    && lineageParent.status === "REQUIRES_FURTHER_CONTEXT"
    && lineageParent.reason === "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION"
    && lineageParent.decisionVersion === "authoritative-os-extraction-v1";
  if (!v1 && !completeMulti) throw new Error("authoritative decision contract is unsupported");
}

function validateHumanVerifiedObservation(row: HumanVerifiedShareCountHistoryObservation) {
  if (row.observationType !== "source_stated"
    || row.securityClassBasis !== "SOURCE_STATED_SECURITY_CLASS"
    || row.shareBasisIdentity !== "shares_outstanding:source_stated"
    || row.sourceConceptNamespaceUri !== null
    || row.sourceConceptLocalName !== null
    || row.authoritativeStatus !== null
    || row.authoritativeDecisionVersion !== null
    || row.authoritativeDecisionReason !== null
    || row.authoritativeDecisionLineage !== null
    || row.acceptedAtSource !== "sec_filing_ledger"
    || row.acceptedAt === null
    || !row.filingLedgerRawSourceId
    || !UUID_PATTERN.test(row.filingLedgerRawSourceId)
    || row.sourceAnalyzer !== null) {
    throw new Error("unsupported human-verified share-count source lineage");
  }
  const identity = row.securityClassIdentity.identity;
  if (!isRecord(identity) || !compact(String(identity.title ?? ""))
    || row.securityClassIdentity.canonicalKey !== `SOURCE_STATED_SECURITY_CLASS|${sha256(String(identity.title))}`) {
    throw new Error("human-verified security-class identity is incomplete");
  }
  if (!isRecord(row.securityClassMetadata)
    || row.securityClassMetadata.sourceRef !== row.sourceContextRef
    || row.securityClassMetadata.evidence !== row.sourceEvidence
    || row.securityClassMetadata.sourceDeclaredClassKind !== "common_stock"
    || row.securityClassMetadata.canonicalSecurityClassId !== row.canonicalSecurityClassId
    || row.sourceDimensions.length !== 0) {
    throw new Error("human-verified security-class metadata lineage is incomplete");
  }
  if (row.shareBasisMetadata.measurement !== "shares_outstanding"
    || !isRecord(row.shareBasisMetadata.unit)
    || row.shareBasisMetadata.unit.kind !== "shares"
    || row.shareBasisMetadata.unit.representation !== "positive_integer") {
    throw new Error("human-verified share basis is unresolved");
  }
  if (row.sourceFactIdentity.factKey !== row.sourceFactKey
    || row.sourceFactIdentity.sourceRef !== row.sourceContextRef
    || row.sourceFactIdentity.accession !== row.accessionNumber
    || row.sourceFactIdentity.documentName !== row.filingDocument
    || row.sourceFactIdentity.artifactId !== row.sourceArtifactId
    || row.sourceFactIdentity.observationType !== "source_stated"
    || row.sourceContext.sourceRef !== row.sourceContextRef
    || row.sourceContext.asOf !== row.asOf
    || row.sourceContext.issuerCik !== row.issuerCik) {
    throw new Error("human-verified fact/context lineage mismatch");
  }
  const approval = row.sourceProvenance.approval;
  const artifact = row.sourceProvenance.secArtifact;
  const verifier = row.sourceProvenance.verifier;
  const classUniverse = row.sourceProvenance.classUniverse;
  if (!compact(row.sourceEvidence) || row.sourceEvidence.length > 600
    || !isRecord(approval)
    || !UUID_PATTERN.test(String(approval.approver_user_id ?? ""))
    || !TIMESTAMP_PATTERN.test(String(approval.approved_at ?? ""))
    || Number.isNaN(new Date(String(approval.approved_at)).valueOf())
    || row.sourceProvenance.filingLedgerRawSourceId !== row.filingLedgerRawSourceId
    || !isRecord(artifact)
    || artifact.artifactId !== row.sourceArtifactId
    || artifact.documentName !== row.filingDocument
    || artifact.sourceUrl !== row.sourceDocumentUrl
    || artifact.contentHash !== row.sourceContentHash
    || !isRecord(verifier)
    || verifier.status !== "Verified"
    || !compact(String(verifier.sourceCheck ?? ""))
    || !isRecord(classUniverse)
    || classUniverse.status !== "COMPLETE_SINGLE"
    || classUniverse.reason !== "COMPLETE_SINGLE_COMMON_STOCK"
    || classUniverse.canonicalSecurityClassId !== row.canonicalSecurityClassId
    || String(classUniverse.universeAsOf ?? "") > row.asOf) {
    throw new Error("human-verified source provenance is incomplete");
  }
}

function validateProspectusTextAuthoritativeObservation(
  row: ProspectusTextAuthoritativeShareCountHistoryObservation,
) {
  if (row.observationType !== "source_stated"
    || row.securityClassBasis !== "SOURCE_STATED_SECURITY_CLASS"
    || row.shareBasisIdentity !== "shares_outstanding:source_stated"
    || row.sourceConceptNamespaceUri !== null
    || row.sourceConceptLocalName !== null
    || row.authoritativeStatus !== "ELIGIBLE"
    || row.authoritativeDecisionVersion !== PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION
    || row.authoritativeDecisionReason !== PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON
    || !isRecord(row.authoritativeDecisionLineage)
    || row.acceptedAtSource !== "sec_filing_ledger"
    || row.acceptedAt === null
    || !UUID_PATTERN.test(row.filingLedgerRawSourceId)
    || row.sourceAnalyzer !== null) {
    throw new Error("unsupported automatic prospectus share-count source lineage");
  }
  const identity = row.securityClassIdentity.identity;
  if (!isRecord(identity) || identity.title !== "Common Stock"
    || row.securityClassIdentity.canonicalKey !== `SOURCE_STATED_SECURITY_CLASS|${sha256("Common Stock")}`) {
    throw new Error("automatic prospectus security-class identity is incomplete");
  }
  if (!isRecord(row.securityClassMetadata)
    || row.securityClassMetadata.sourceRef !== row.sourceContextRef
    || row.securityClassMetadata.evidence !== row.sourceEvidence
    || row.securityClassMetadata.sourceDeclaredClassKind !== "common_stock"
    || row.securityClassMetadata.canonicalSecurityClassId !== row.canonicalSecurityClassId
    || row.sourceDimensions.length !== 0) {
    throw new Error("automatic prospectus security-class metadata lineage is incomplete");
  }
  if (row.shareBasisMetadata.measurement !== "shares_outstanding"
    || !isRecord(row.shareBasisMetadata.unit)
    || row.shareBasisMetadata.unit.kind !== "shares"
    || row.shareBasisMetadata.unit.representation !== "positive_integer") {
    throw new Error("automatic prospectus share basis is unresolved");
  }
  if (row.sourceFactIdentity.factKey !== row.sourceFactKey
    || row.sourceFactIdentity.sourceRef !== row.sourceContextRef
    || row.sourceFactIdentity.accession !== row.accessionNumber
    || row.sourceFactIdentity.documentName !== row.filingDocument
    || row.sourceFactIdentity.artifactId !== row.sourceArtifactId
    || row.sourceFactIdentity.observationType !== "source_stated"
    || row.sourceContext.sourceRef !== row.sourceContextRef
    || row.sourceContext.asOf !== row.asOf
    || row.sourceContext.issuerCik !== row.issuerCik) {
    throw new Error("automatic prospectus fact/context lineage mismatch");
  }
  const artifact = row.sourceProvenance.secArtifact;
  const verifier = row.sourceProvenance.verifier;
  const classUniverse = row.sourceProvenance.classUniverse;
  const listingBasis = row.sourceProvenance.listingBasis;
  if (!compact(row.sourceEvidence) || row.sourceEvidence.length > 600
    || row.sourceProvenance.filingLedgerRawSourceId !== row.filingLedgerRawSourceId
    || !isRecord(artifact)
    || artifact.artifactId !== row.sourceArtifactId
    || artifact.documentName !== row.filingDocument
    || artifact.sourceUrl !== row.sourceDocumentUrl
    || artifact.contentHash !== row.sourceContentHash
    || !isRecord(verifier)
    || verifier.status !== "AutomaticallyVerified"
    || verifier.version !== PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION
    || !isRecord(classUniverse)
    || classUniverse.snapshotVersion !== "issuer-common-class-universe-prospectus-text-v1"
    || classUniverse.status !== "COMPLETE_SINGLE"
    || classUniverse.reason !== "COMPLETE_SINGLE_COMMON_STOCK"
    || classUniverse.canonicalSecurityClassId !== row.canonicalSecurityClassId
    || classUniverse.universeAsOf !== row.asOf
    || !isRecord(listingBasis)
    || listingBasis.status !== "FINALIZED_US_EXCHANGE_TICKER"
    || !compact(String(listingBasis.exchange ?? ""))
    || !compact(String(listingBasis.ticker ?? ""))) {
    throw new Error("automatic prospectus source provenance is incomplete");
  }
  if (row.authoritativeDecisionLineage.status !== "ELIGIBLE"
    || row.authoritativeDecisionLineage.decisionVersion !== row.authoritativeDecisionVersion
    || row.authoritativeDecisionLineage.reason !== row.authoritativeDecisionReason
    || row.authoritativeDecisionLineage.issuerCik !== row.issuerCik
    || row.authoritativeDecisionLineage.sharesOutstanding !== row.sharesOutstanding
    || row.authoritativeDecisionLineage.asOf !== row.asOf
    || row.authoritativeDecisionLineage.accession !== row.accessionNumber
    || row.authoritativeDecisionLineage.form !== "424B4") {
    throw new Error("automatic prospectus authoritative lineage is incomplete");
  }
}

function validateLevel2Observation(row: Level2ShareCountHistoryObservation) {
  if (row.observationType !== "source_stated"
    || row.securityClassBasis !== "SOURCE_STATED_SECURITY_CLASS"
    || row.shareBasisIdentity !== "shares_outstanding:source_stated"
    || row.sourceConceptNamespaceUri !== null
    || row.sourceConceptLocalName !== null
    || row.filingLedgerRawSourceId !== null
    || row.authoritativeStatus !== null
    || row.authoritativeDecisionVersion !== null
    || row.authoritativeDecisionReason !== null
    || row.authoritativeDecisionLineage !== null) {
    throw new Error("unsupported Level 2 share-count source lineage");
  }
  if (row.acceptedAtSource !== "sec_raw_payload_acceptance" && row.acceptedAtSource !== "unavailable") {
    throw new Error("Level 2 acceptedAt source is invalid");
  }
  const identity = row.securityClassIdentity.identity;
  if (!isRecord(identity) || !compact(String(identity.title ?? ""))
    || row.securityClassIdentity.canonicalKey !== `SOURCE_STATED_SECURITY_CLASS|${sha256(String(identity.title))}`) {
    throw new Error("Level 2 security-class identity is incomplete");
  }
  if (!isRecord(row.securityClassMetadata)
    || row.securityClassMetadata.sourceRef !== row.sourceContextRef
    || row.securityClassMetadata.evidence !== row.sourceEvidence
    || row.sourceDimensions.length !== 0) {
    throw new Error("Level 2 security-class metadata lineage is incomplete");
  }
  if (row.shareBasisMetadata.measurement !== "shares_outstanding"
    || !isRecord(row.shareBasisMetadata.unit)
    || row.shareBasisMetadata.unit.kind !== "shares"
    || row.shareBasisMetadata.unit.representation !== "positive_integer") {
    throw new Error("Level 2 share basis is unresolved");
  }
  if (row.sourceFactIdentity.factKey !== row.sourceFactKey
    || row.sourceFactIdentity.sourceRef !== row.sourceContextRef
    || row.sourceFactIdentity.accession !== row.accessionNumber
    || row.sourceFactIdentity.documentName !== row.filingDocument
    || row.sourceFactIdentity.observationType !== "source_stated"
    || row.sourceContext.sourceRef !== row.sourceContextRef
    || row.sourceContext.asOf !== row.asOf
    || row.sourceContext.issuerCik !== row.issuerCik) {
    throw new Error("Level 2 fact/context lineage mismatch");
  }
  if (!compact(row.sourceEvidence) || row.sourceEvidence.length > 600
    || !compact(row.sourceAnalyzer) || row.sourceAnalyzer.length > 120
    || row.sourceProvenance.rawItemId !== row.sourceArtifactId
    || row.sourceProvenance.sourceRef !== row.sourceContextRef
    || row.sourceProvenance.analyzerKey !== row.sourceAnalyzer
    || !UUID_PATTERN.test(String(row.sourceProvenance.eventId ?? ""))
    || !UUID_PATTERN.test(String(row.sourceProvenance.parentPrimaryAiRunId ?? ""))
    || !UUID_PATTERN.test(String(row.sourceProvenance.sourceExecutionId ?? ""))) {
    throw new Error("Level 2 source provenance is incomplete");
  }
}

function validateReadFilter(filter: ShareCountHistoryReadFilter) {
  if (filter.asOfFrom) validateDate(filter.asOfFrom, "asOfFrom");
  if (filter.asOfTo) validateDate(filter.asOfTo, "asOfTo");
  if (filter.asOfFrom && filter.asOfTo && filter.asOfFrom > filter.asOfTo) throw new Error("invalid as-of range");
  if (filter.securityClassCanonicalKey !== undefined && !compact(filter.securityClassCanonicalKey)) {
    throw new Error("securityClassCanonicalKey must be non-empty");
  }
  if (filter.canonicalSecurityClassId !== undefined && !CANONICAL_SECURITY_CLASS_ID_PATTERN.test(filter.canonicalSecurityClassId)) {
    throw new Error("canonicalSecurityClassId is invalid");
  }
}

function observationValues(row: ShareCountHistoryObservation) {
  return [
    row.observationType, row.issuerCik, row.sharesOutstanding, row.asOf, row.securityClassBasis,
    JSON.stringify(row.securityClassIdentity), JSON.stringify(row.securityClassMetadata),
    row.shareBasisIdentity, row.canonicalSecurityClassId, row.canonicalSecurityClassKind,
    row.canonicalSecurityClassStatus, JSON.stringify(row.canonicalSecurityClassProvenance),
    JSON.stringify(row.shareBasisMetadata), row.accessionNumber,
    row.form, row.filingDocument, row.filedDate, row.acceptedAt, row.acceptedAtSource,
    JSON.stringify(row.acceptedAtProvenance), row.ingestedAt,
    row.sourceConceptNamespaceUri, row.sourceConceptLocalName, row.sourceFactKey,
    row.sourceContextRef, row.sourceArtifactId, row.filingLedgerRawSourceId,
    JSON.stringify(row.sourceFactIdentity), JSON.stringify(row.sourceContext),
    JSON.stringify(row.sourceDimensions), JSON.stringify(row.sourceProvenance), row.sourceType,
    row.authoritativeStatus, row.authoritativeDecisionVersion, row.authoritativeDecisionReason,
    row.authoritativeDecisionLineage === null ? null : JSON.stringify(row.authoritativeDecisionLineage),
    row.sourceDocumentUrl, row.sourceContentHash, row.sourceEvidence, row.sourceAnalyzer,
  ];
}

export function mapShareCountHistoryDatabaseRow(
  row: Record<string, unknown>,
): ShareCountHistoryObservation {
  const mapped = {
    id: String(row.id), observationType: String(row.observation_type),
    issuerCik: String(row.issuer_cik), sharesOutstanding: String(row.shares_outstanding),
    asOf: String(row.as_of), securityClassBasis: String(row.security_class_basis) as ShareCountHistoryObservation["securityClassBasis"],
    securityClassIdentity: jsonRecord(row.security_class_identity), securityClassMetadata: jsonRecord(row.security_class_metadata),
    canonicalSecurityClassId: nullableStoredString(row.canonical_security_class_id),
    canonicalSecurityClassKind: nullableStoredString(row.canonical_security_class_kind),
    canonicalSecurityClassStatus: String(row.canonical_security_class_status),
    canonicalSecurityClassProvenance: jsonRecord(row.canonical_security_class_provenance),
    shareBasisIdentity: String(row.share_basis_identity),
    shareBasisMetadata: jsonRecord(row.share_basis_metadata), accessionNumber: String(row.accession_number),
    form: String(row.form), filingDocument: String(row.filing_document), filedDate: String(row.filed_date),
    acceptedAt: row.accepted_at === null || row.accepted_at === undefined
      ? null : new Date(String(row.accepted_at)).toISOString(),
    acceptedAtSource: String(row.accepted_at_source),
    acceptedAtProvenance: jsonRecord(row.accepted_at_provenance),
    ingestedAt: new Date(String(row.ingested_at)).toISOString(),
    sourceConceptNamespaceUri: nullableStoredString(row.source_concept_namespace_uri),
    sourceConceptLocalName: nullableStoredString(row.source_concept_local_name),
    sourceFactKey: String(row.source_fact_key), sourceContextRef: String(row.source_context_ref),
    sourceArtifactId: String(row.source_artifact_id),
    filingLedgerRawSourceId: nullableStoredString(row.filing_ledger_raw_source_id),
    sourceFactIdentity: jsonRecord(row.source_fact_identity), sourceContext: jsonRecord(row.source_context),
    sourceDimensions: jsonArray(row.source_dimensions), sourceProvenance: jsonRecord(row.source_provenance),
    sourceType: String(row.source_type),
    ...(row.source_type===OS_SNAPSHOT_HISTORY_SOURCE?{sourcePublicationCurrent:row.snapshot_publication_valid===true}:{}),
    authoritativeStatus: nullableStoredString(row.authoritative_status),
    authoritativeDecisionVersion: nullableStoredString(row.authoritative_decision_version),
    authoritativeDecisionReason: nullableStoredString(row.authoritative_decision_reason),
    authoritativeDecisionLineage: nullableJsonRecord(row.authoritative_decision_lineage),
    sourceDocumentUrl: String(row.source_document_url), sourceContentHash: String(row.source_content_hash),
    sourceEvidence: nullableStoredString(row.source_evidence),
    sourceAnalyzer: nullableStoredString(row.source_analyzer),
    createdAt: new Date(String(row.created_at)).toISOString(),
  } as ShareCountHistoryObservation;
  validateObservation(mapped);
  return mapped;
}

function securityClassCanonicalKey(value: SecAuthoritativeOsEligibleDecision["authoritative"]["securityClass"]) {
  if (value.basis === "SINGLE_COMMON_STOCK_CLASS") return `${value.basis}|${value.identity}`;
  return `${value.basis}|${qnameKey(value.identity.axis)}|${qnameKey(value.identity.member)}`;
}

function qnameKey(value: { namespaceUri: string | null; localName: string }) {
  return `${value.namespaceUri ?? ""}#${value.localName}`;
}

function qnameResolved(value: { namespaceUri: string | null; localName: string }) {
  return Boolean(compact(value.namespaceUri ?? "") && compact(value.localName));
}

function canonicalSourceIdentity(row: ShareCountHistoryObservation) {
  return [row.sourceType, row.issuerCik, row.accessionNumber, row.filingDocument,
    row.sourceContentHash, row.sourceFactKey, row.sourceContextRef].join("|");
}

function compareHistory(left: ShareCountHistoryObservation, right: ShareCountHistoryObservation) {
  return [left.asOf, left.acceptedAt ?? "9999-12-31T23:59:59.999Z", left.accessionNumber, left.id ?? ""].join("|")
    .localeCompare([right.asOf, right.acceptedAt ?? "9999-12-31T23:59:59.999Z", right.accessionNumber, right.id ?? ""].join("|"));
}

function validateCanonicalSecurityClass(row: ShareCountHistoryObservation) {
  if (!isRecord(row.canonicalSecurityClassProvenance)) {
    throw new Error("canonical security-class provenance is incomplete");
  }
  if (row.canonicalSecurityClassStatus === "mapped") {
    if (row.canonicalSecurityClassKind !== "common_stock"
      || !row.canonicalSecurityClassId
      || !CANONICAL_SECURITY_CLASS_ID_PATTERN.test(row.canonicalSecurityClassId)
      || !row.canonicalSecurityClassId.startsWith(`sc:v1:${row.issuerCik}:common_stock:`)) {
      throw new Error("canonical security-class mapping is invalid");
    }
    return;
  }
  if (row.canonicalSecurityClassStatus !== "unavailable"
    || row.canonicalSecurityClassId !== null
    || row.canonicalSecurityClassKind !== null) {
    throw new Error("unavailable canonical security class must remain unmapped");
  }
}

function validateCik(value: string) {
  if (!CIK_PATTERN.test(value) || value === "0000000000") throw new Error("invalid CIK");
}

function validateDate(value: string, field: string) {
  if (!DATE_PATTERN.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} is invalid`);
}

function validateTimestamp(value: string, field: string) {
  if (!TIMESTAMP_PATTERN.test(value) || Number.isNaN(new Date(value).valueOf())) throw new Error(`${field} is invalid`);
}

function normalizeCik(value: string) {
  return value.replace(/^0+/, "").padStart(10, "0");
}

function compact(value: string) {
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function jsonRecord(value: unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)) throw new Error("stored JSON object is invalid");
  return parsed;
}

function jsonArray(value: unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("stored JSON array is invalid");
  return parsed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nullableJsonRecord(value: unknown) {
  return value === null || value === undefined ? null : jsonRecord(value);
}

function nullableStoredString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const FOREIGN_PERIODIC_FORMS = new Set(["20-F", "20-F/A", "40-F", "40-F/A"]);
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const DEI_NAMESPACE_PATTERN = /^https?:\/\/xbrl\.sec\.gov\/dei\/[0-9]{4}$/;
const SEC_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*sec\.gov\//;
