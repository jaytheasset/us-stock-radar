import { createHash } from "node:crypto";
import type {
  SecAuthoritativeOsDecision,
  SecAuthoritativeOsEligibleDecision,
} from "./authoritativeOsExtraction.ts";

export const SHARE_COUNT_HISTORY_SOURCE_TYPE = "sec_authoritative_os" as const;
export const SHARE_COUNT_HISTORY_SHARE_BASIS = "shares_outstanding:xbrli_shares" as const;
export const SHARE_COUNT_HISTORY_OBSERVATION_TYPE = "authoritative_xbrl" as const;

type ShareCountHistoryObservationCommon = {
  id?: string;
  observationType: "authoritative_xbrl" | "source_stated";
  issuerCik: string;
  sharesOutstanding: string;
  asOf: string;
  securityClassBasis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK" | "SOURCE_STATED_SECURITY_CLASS";
  securityClassIdentity: Record<string, unknown>;
  securityClassMetadata: Record<string, unknown>;
  shareBasisIdentity: typeof SHARE_COUNT_HISTORY_SHARE_BASIS | "shares_outstanding:source_stated";
  shareBasisMetadata: Record<string, unknown>;
  accessionNumber: string;
  form: string;
  filingDocument: string;
  filedDate: string;
  acceptedAt: string;
  ingestedAt: string;
  sourceConceptNamespaceUri: string | null;
  sourceConceptLocalName: "EntityCommonStockSharesOutstanding" | null;
  sourceFactKey: string;
  sourceContextRef: string;
  sourceArtifactId: string;
  filingLedgerRawSourceId: string | null;
  sourceFactIdentity: Record<string, unknown>;
  sourceContext: Record<string, unknown>;
  sourceDimensions: unknown[];
  sourceProvenance: Record<string, unknown>;
  sourceType: typeof SHARE_COUNT_HISTORY_SOURCE_TYPE | "sec_filing_text_level2";
  authoritativeStatus: "ELIGIBLE" | null;
  authoritativeDecisionVersion: "authoritative-os-extraction-v1" | null;
  authoritativeDecisionReason:
    | "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT"
    | "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT"
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
  sourceConceptLocalName: "EntityCommonStockSharesOutstanding";
  filingLedgerRawSourceId: string;
  sourceType: typeof SHARE_COUNT_HISTORY_SOURCE_TYPE;
  authoritativeStatus: "ELIGIBLE";
  authoritativeDecisionVersion: "authoritative-os-extraction-v1";
  authoritativeDecisionReason:
    | "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT"
    | "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT";
  authoritativeDecisionLineage: Record<string, unknown>;
  sourceEvidence: null;
  sourceAnalyzer: null;
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
};

export type ShareCountHistoryObservation =
  | AuthoritativeShareCountHistoryObservation
  | Level2ShareCountHistoryObservation;

export type ShareCountHistoryWriteResult = { inserted: number; deduped: number };

export type ShareCountHistoryReadFilter = {
  asOfFrom?: string;
  asOfTo?: string;
  securityClassCanonicalKey?: string;
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
    share_basis_identity: row.shareBasisIdentity,
    share_basis_metadata: row.shareBasisMetadata,
    accession_number: row.accessionNumber,
    form: row.form,
    filing_document: row.filingDocument,
    filed_date: row.filedDate,
    accepted_at: row.acceptedAt,
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
         share_basis_metadata, accession_number, form, filing_document, filed_date,
         accepted_at, ingested_at, source_concept_namespace_uri,
         source_concept_local_name, source_fact_key, source_context_ref,
         source_artifact_id, filing_ledger_raw_source_id, source_fact_identity,
         source_context, source_dimensions, source_provenance,
         source_type, authoritative_status, authoritative_decision_version,
         authoritative_decision_reason, authoritative_decision_lineage,
         source_document_url, source_content_hash, source_evidence, source_analyzer
       ) values (
         $1, $2, $3::numeric, $4::date, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb,
         $10, $11, $12, $13::date, $14::timestamptz, $15::timestamptz, $16,
         $17, $18, $19, $20::uuid, $21::uuid, $22::jsonb, $23::jsonb,
         $24::jsonb, $25::jsonb, $26, $27, $28, $29, $30::jsonb, $31, $32,
         $33, $34
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
              share_basis_identity, share_basis_metadata, accession_number, form,
              filing_document, filed_date::text, accepted_at::text, ingested_at::text,
              source_concept_namespace_uri, source_concept_local_name, source_fact_key,
              source_context_ref, source_artifact_id::text, filing_ledger_raw_source_id::text,
              source_fact_identity, source_context, source_dimensions,
              source_provenance, source_type, authoritative_status,
              authoritative_decision_version, authoritative_decision_reason,
              authoritative_decision_lineage, source_document_url, source_content_hash,
              source_evidence, source_analyzer, created_at::text
       from public.share_count_history
       where issuer_cik = $1
         and ($2::date is null or as_of >= $2::date)
         and ($3::date is null or as_of <= $3::date)
         and ($4::text is null or security_class_identity ->> 'canonicalKey' = $4)
       order by as_of, accepted_at, accession_number, id`,
      [cik, filter.asOfFrom ?? null, filter.asOfTo ?? null, filter.securityClassCanonicalKey ?? null],
    );
    return result.rows.map(mapHistoryRow);
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
  validateTimestamp(row.acceptedAt, "acceptedAt");
  validateTimestamp(row.ingestedAt, "ingestedAt");
  if (!ACCESSION_PATTERN.test(row.accessionNumber) || !compact(row.form) || !compact(row.filingDocument)) throw new Error("filing identity is incomplete");
  if (!HEX_64_PATTERN.test(row.sourceFactKey) || !compact(row.sourceContextRef)
    || !UUID_PATTERN.test(row.sourceArtifactId) || !SEC_URL_PATTERN.test(row.sourceDocumentUrl)
    || !HEX_64_PATTERN.test(row.sourceContentHash) || !isRecord(row.sourceFactIdentity)
    || !isRecord(row.sourceContext) || !Array.isArray(row.sourceDimensions)
    || !isRecord(row.sourceProvenance)) throw new Error("source fact/provenance identity is incomplete");
  const classIdentity = row.securityClassIdentity.identity;
  if (!compact(String(row.securityClassIdentity.canonicalKey ?? ""))) throw new Error("security-class identity is incomplete");
  if (row.sourceType === "sec_filing_text_level2") {
    validateLevel2Observation(row);
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
    || row.authoritativeDecisionVersion !== "authoritative-os-extraction-v1") throw new Error("unsupported share-count source lineage");
  if (!DEI_NAMESPACE_PATTERN.test(row.sourceConceptNamespaceUri)
    || row.sourceConceptLocalName !== "EntityCommonStockSharesOutstanding"
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
}

function observationValues(row: ShareCountHistoryObservation) {
  return [
    row.observationType, row.issuerCik, row.sharesOutstanding, row.asOf, row.securityClassBasis,
    JSON.stringify(row.securityClassIdentity), JSON.stringify(row.securityClassMetadata),
    row.shareBasisIdentity, JSON.stringify(row.shareBasisMetadata), row.accessionNumber,
    row.form, row.filingDocument, row.filedDate, row.acceptedAt, row.ingestedAt,
    row.sourceConceptNamespaceUri, row.sourceConceptLocalName, row.sourceFactKey,
    row.sourceContextRef, row.sourceArtifactId, row.filingLedgerRawSourceId,
    JSON.stringify(row.sourceFactIdentity), JSON.stringify(row.sourceContext),
    JSON.stringify(row.sourceDimensions), JSON.stringify(row.sourceProvenance), row.sourceType,
    row.authoritativeStatus, row.authoritativeDecisionVersion, row.authoritativeDecisionReason,
    row.authoritativeDecisionLineage === null ? null : JSON.stringify(row.authoritativeDecisionLineage),
    row.sourceDocumentUrl, row.sourceContentHash, row.sourceEvidence, row.sourceAnalyzer,
  ];
}

function mapHistoryRow(row: Record<string, unknown>): ShareCountHistoryObservation {
  const mapped = {
    id: String(row.id), observationType: String(row.observation_type),
    issuerCik: String(row.issuer_cik), sharesOutstanding: String(row.shares_outstanding),
    asOf: String(row.as_of), securityClassBasis: String(row.security_class_basis) as ShareCountHistoryObservation["securityClassBasis"],
    securityClassIdentity: jsonRecord(row.security_class_identity), securityClassMetadata: jsonRecord(row.security_class_metadata),
    shareBasisIdentity: String(row.share_basis_identity),
    shareBasisMetadata: jsonRecord(row.share_basis_metadata), accessionNumber: String(row.accession_number),
    form: String(row.form), filingDocument: String(row.filing_document), filedDate: String(row.filed_date),
    acceptedAt: new Date(String(row.accepted_at)).toISOString(), ingestedAt: new Date(String(row.ingested_at)).toISOString(),
    sourceConceptNamespaceUri: nullableStoredString(row.source_concept_namespace_uri),
    sourceConceptLocalName: nullableStoredString(row.source_concept_local_name),
    sourceFactKey: String(row.source_fact_key), sourceContextRef: String(row.source_context_ref),
    sourceArtifactId: String(row.source_artifact_id),
    filingLedgerRawSourceId: nullableStoredString(row.filing_ledger_raw_source_id),
    sourceFactIdentity: jsonRecord(row.source_fact_identity), sourceContext: jsonRecord(row.source_context),
    sourceDimensions: jsonArray(row.source_dimensions), sourceProvenance: jsonRecord(row.source_provenance),
    sourceType: String(row.source_type),
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
  return [left.asOf, left.acceptedAt, left.accessionNumber, left.id ?? ""].join("|")
    .localeCompare([right.asOf, right.acceptedAt, right.accessionNumber, right.id ?? ""].join("|"));
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
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const DEI_NAMESPACE_PATTERN = /^https?:\/\/xbrl\.sec\.gov\/dei\/[0-9]{4}$/;
const SEC_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*sec\.gov\//;
