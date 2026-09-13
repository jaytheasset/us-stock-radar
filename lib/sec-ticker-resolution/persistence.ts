import "server-only";

import {
  evaluateSecTickerResolution,
  SEC_TICKER_RESOLUTION_VERSION,
  validateStoredSecTickerResolution,
  type SecTickerResolutionEvaluation,
  type VerifiedSecCoverObservation,
  type VerifiedSecResolutionSource,
} from "./canonical.ts";
import {
  readSecCoverObservations,
  type SecCoverObservationReadResult,
  type SecCoverObservationRepository,
} from "../sec-cover-observations/persistence.ts";

type Row = Record<string, unknown>;
type RepositoryResult = Readonly<{ ok: boolean; status: number; data: unknown; count?: number | null; error?: string }>;

export type SecTickerResolutionRepository = SecCoverObservationRepository & Readonly<{
  rpc(functionName: string, payload: Row): Promise<RepositoryResult>;
  select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
}>;

export type SecTickerResolutionRequest = Readonly<{
  issuerCik: string;
  evidenceAccessionNumber: string;
  evidenceSourceSha256: string;
  beforeAccessionNumber: string;
  beforeSourceSha256: string;
  afterAccessionNumber: string;
  afterSourceSha256: string;
}>;

export type SecTickerResolutionReadResult =
  | Readonly<{
      status: "available";
      decision: Row;
      identity: Row | null;
      evidence: Row | null;
      evaluation: SecTickerResolutionEvaluation;
      sourceObservations: Readonly<{
        before: readonly VerifiedSecCoverObservation[];
        after: readonly VerifiedSecCoverObservation[];
      }>;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export const SEC_TICKER_RESOLUTION_LIST_LIMIT = 100;

export type SecTickerResolutionListResult =
  | Readonly<{
      status: "available";
      scope: Readonly<{
        scanned: number;
        limit: number;
        truncated: boolean;
      }>;
      counts: Readonly<Record<"AUTO" | "REVIEW" | "UNRESOLVED" | "unavailable", number>>;
      relationships: readonly Extract<SecTickerResolutionReadResult, { status: "available" }>[];
      unavailable: readonly Readonly<{ decisionId: string; reason: string }>[];
    }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export async function resolveAndPersistSecTickerChange(input: SecTickerResolutionRequest & {
  repository?: SecTickerResolutionRepository;
}) {
  const repository = input.repository ?? await defaultRepository();
  const loaded = await loadEvaluation(input, repository);
  if (!loaded.ok) return { status: "unavailable" as const, reason: loaded.reason };
  const evaluation = evaluateSecTickerResolution(loaded.input);
  const write = await repository.rpc("persist_sec_ticker_resolution", {
    p_identity: evaluation.identity,
    p_evidence: evaluation.evidence,
    p_decision: evaluation.decision,
  });
  if (!write.ok) {
    return { status: "unavailable" as const, reason: "resolution_persistence_failed" };
  }
  const response = record(write.data);
  if (!new Set(["inserted", "replayed"]).has(stringValue(response.status))
    || stringValue(response.decision_id) !== stringValue(evaluation.decision.id)
    || stringValue(response.resolution_state) !== evaluation.resolutionState) {
    return { status: "unavailable" as const, reason: "resolution_persistence_response_invalid" };
  }
  return {
    status: "available" as const,
    writeStatus: stringValue(response.status) as "inserted" | "replayed",
    decisionId: stringValue(evaluation.decision.id),
    resolutionState: evaluation.resolutionState,
    evaluation,
  };
}

export async function readCurrentSecTickerResolution(input: {
  issuerCik: string;
  evidenceAccessionNumber: string;
  beforeAccessionNumber: string;
  afterAccessionNumber: string;
  repository?: SecTickerResolutionRepository;
}): Promise<SecTickerResolutionReadResult> {
  const repository = input.repository ?? await defaultRepository();
  const decisionRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "*",
    issuer_cik: `eq.${input.issuerCik.padStart(10, "0")}`,
    evidence_accession_number: `eq.${input.evidenceAccessionNumber}`,
    before_accession_number: `eq.${input.beforeAccessionNumber}`,
    after_accession_number: `eq.${input.afterAccessionNumber}`,
    method_version: `eq.${SEC_TICKER_RESOLUTION_VERSION}`,
    order: "created_at.desc,id.desc",
    limit: "1",
  });
  if (!decisionRead.ok) return { status: "unavailable", reason: "decision_read_failed" };
  const decision = rows(decisionRead.data)[0];
  if (!decision) return { status: "not_found" };
  return readAndValidateDecision(decision, repository);
}

export async function readSecTickerResolutionByDecisionId(input: {
  decisionId: string;
  repository?: SecTickerResolutionRepository;
}): Promise<SecTickerResolutionReadResult> {
  if (!isUuid(input.decisionId)) return { status: "unavailable", reason: "invalid_decision_id" };
  const repository = input.repository ?? await defaultRepository();
  const decisionRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "*",
    id: `eq.${input.decisionId}`,
    limit: "1",
  });
  if (!decisionRead.ok) return { status: "unavailable", reason: "decision_read_failed" };
  const decision = rows(decisionRead.data)[0];
  if (!decision) return { status: "not_found" };
  if (stringValue(decision.id) !== input.decisionId) {
    return { status: "unavailable", reason: "decision_id_mismatch" };
  }
  return readAndValidateDecision(decision, repository);
}

export async function listSecTickerResolutions(input: {
  state?: string;
  query?: string;
  limit?: number;
  repository?: SecTickerResolutionRepository;
} = {}): Promise<SecTickerResolutionListResult> {
  const state = normalizeResolutionState(input.state);
  if (input.state && !state) return { status: "unavailable", reason: "invalid_resolution_state" };
  const query = (input.query || "").trim().toUpperCase();
  if (query.length > 120) return { status: "unavailable", reason: "invalid_resolution_query" };
  const repository = input.repository ?? await defaultRepository();
  const limit = Math.max(1, Math.min(input.limit ?? SEC_TICKER_RESOLUTION_LIST_LIMIT, SEC_TICKER_RESOLUTION_LIST_LIMIT));
  const decisionRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "*",
    method_version: `eq.${SEC_TICKER_RESOLUTION_VERSION}`,
    order: "created_at.desc,id.desc",
    limit: String(limit),
  });
  if (!decisionRead.ok) return { status: "unavailable", reason: "decision_list_read_failed" };
  const decisions = rows(decisionRead.data);
  const validated: Array<Extract<SecTickerResolutionReadResult, { status: "available" }>> = [];
  const unavailable: Array<{ decisionId: string; reason: string }> = [];

  for (let offset = 0; offset < decisions.length; offset += 5) {
    const batch = decisions.slice(offset, offset + 5);
    const results = await Promise.all(batch.map((decision) => readAndValidateDecision(decision, repository)));
    results.forEach((result, index) => {
      if (result.status === "available") {
        validated.push(result);
      } else {
        unavailable.push({
          decisionId: stringValue(batch[index]?.id),
          reason: result.status === "unavailable" ? result.reason : "decision_not_found",
        });
      }
    });
  }

  const counts = {
    AUTO: validated.filter((item) => stringValue(item.decision.resolution_state) === "AUTO").length,
    REVIEW: validated.filter((item) => stringValue(item.decision.resolution_state) === "REVIEW").length,
    UNRESOLVED: validated.filter((item) => stringValue(item.decision.resolution_state) === "UNRESOLVED").length,
    unavailable: unavailable.length,
  };
  const relationships = validated.filter((item) => {
    if (state && stringValue(item.decision.resolution_state) !== state) return false;
    if (!query) return true;
    const relationship = record(record(item.decision.decision_payload).relationship);
    return [
      item.decision.id,
      item.decision.issuer_cik,
      item.decision.evidence_accession_number,
      item.decision.before_accession_number,
      item.decision.after_accession_number,
      relationship.oldTicker,
      relationship.newTicker,
    ].some((value) => stringValue(value).toUpperCase().includes(query));
  });
  return {
    status: "available",
    scope: { scanned: decisions.length, limit, truncated: decisions.length === limit },
    counts,
    relationships,
    unavailable,
  };
}

async function readAndValidateDecision(
  decision: Row,
  repository: SecTickerResolutionRepository,
): Promise<SecTickerResolutionReadResult> {
  const payload = record(decision.decision_payload);
  const savedInput = record(payload.input);
  const request: SecTickerResolutionRequest = {
    issuerCik: stringValue(decision.issuer_cik),
    evidenceAccessionNumber: stringValue(decision.evidence_accession_number),
    evidenceSourceSha256: stringValue(savedInput.sourceSha256),
    beforeAccessionNumber: stringValue(decision.before_accession_number),
    beforeSourceSha256: stringValue(savedInput.beforeSourceSha256),
    afterAccessionNumber: stringValue(decision.after_accession_number),
    afterSourceSha256: stringValue(savedInput.afterSourceSha256),
  };
  if (!request.evidenceSourceSha256 || !request.beforeSourceSha256 || !request.afterSourceSha256) {
    return { status: "unavailable", reason: "decision_source_refs_missing" };
  }
  const loaded = await loadEvaluation(request, repository);
  if (!loaded.ok) return { status: "unavailable", reason: loaded.reason };
  const evaluation = evaluateSecTickerResolution(loaded.input);
  const identityId = stringValue(decision.security_identity_id);
  const evidenceId = stringValue(decision.evidence_id);
  const [identityRead, evidenceRead] = await Promise.all([
    identityId
      ? repository.select("sec_ticker_security_identities", { select: "*", id: `eq.${identityId}`, limit: "1" })
      : Promise.resolve({ ok: true, status: 200, data: [] }),
    evidenceId
      ? repository.select("sec_ticker_change_evidence", { select: "*", id: `eq.${evidenceId}`, limit: "1" })
      : Promise.resolve({ ok: true, status: 200, data: [] }),
  ]);
  if (!identityRead.ok || !evidenceRead.ok) return { status: "unavailable", reason: "relationship_read_failed" };
  const identity = rows(identityRead.data)[0] ?? null;
  const evidence = rows(evidenceRead.data)[0] ?? null;
  const validation = validateStoredSecTickerResolution({
    evaluation,
    storedDecision: decision,
    storedIdentity: identity,
    storedEvidence: evidence,
  });
  if (!validation.ok) return { status: "unavailable", reason: validation.reason };
  return {
    status: "available",
    decision,
    identity,
    evidence,
    evaluation,
    sourceObservations: {
      before: loaded.input.beforeObservations,
      after: loaded.input.afterObservations,
    },
  };
}

async function loadEvaluation(
  input: SecTickerResolutionRequest,
  repository: SecTickerResolutionRepository,
): Promise<
  | { ok: true; input: Parameters<typeof evaluateSecTickerResolution>[0] }
  | { ok: false; reason: string }
> {
  const [sourceRead, beforeRead, afterRead] = await Promise.all([
    readExactCover(input.evidenceAccessionNumber, input.evidenceSourceSha256, repository),
    readExactCover(input.beforeAccessionNumber, input.beforeSourceSha256, repository),
    readExactCover(input.afterAccessionNumber, input.afterSourceSha256, repository),
  ]);
  if (!sourceRead.ok) return sourceRead;
  if (!beforeRead.ok) return beforeRead;
  if (!afterRead.ok) return afterRead;
  const latestChecks = await Promise.all([
    selectedSourceHasNoConflictingRevision(sourceRead.value, repository),
    selectedSourceHasNoConflictingRevision(beforeRead.value, repository),
    selectedSourceHasNoConflictingRevision(afterRead.value, repository),
  ]);
  if (latestChecks.some((check) => !check)) return { ok: false, reason: "source_revision_conflict_requires_review" };
  const sourcePayload = sourceRead.value.payload;
  const rawSourceId = sourcePayload.source.rawSourceId;
  if (!rawSourceId || !sourcePayload.source.url || !sourcePayload.source.documentName || !sourcePayload.source.sha256) {
    return { ok: false, reason: "evidence_source_unavailable" };
  }
  const rawRead = await repository.select("sec_structured_raw_sources", {
    select: "*",
    id: `eq.${rawSourceId}`,
    limit: "1",
  });
  if (!rawRead.ok) return { ok: false, reason: "evidence_raw_source_read_failed" };
  const raw = rows(rawRead.data)[0];
  if (!raw) return { ok: false, reason: "evidence_raw_source_missing" };
  const source: VerifiedSecResolutionSource = {
    resultId: stringValue(sourceRead.value.result.id),
    accessionNumber: sourcePayload.identity.accessionNumber,
    issuerCik: sourcePayload.identity.issuerCik,
    rawSourceId,
    url: sourcePayload.source.url,
    documentName: sourcePayload.source.documentName,
    sha256: sourcePayload.source.sha256,
    rawContent: stringValuePreserve(raw.raw_content),
  };
  return {
    ok: true,
    input: {
      issuerCik: input.issuerCik,
      evidenceAccessionNumber: input.evidenceAccessionNumber,
      beforeAccessionNumber: input.beforeAccessionNumber,
      beforeSourceSha256: input.beforeSourceSha256,
      afterAccessionNumber: input.afterAccessionNumber,
      afterSourceSha256: input.afterSourceSha256,
      source,
      beforeObservations: coverObservations(beforeRead.value),
      afterObservations: coverObservations(afterRead.value),
    },
  };
}

async function selectedSourceHasNoConflictingRevision(
  selected: AvailableCoverResult,
  repository: SecTickerResolutionRepository,
) {
  const result = await repository.select("sec_cover_observation_results", {
    select: "id,source_kind,source_url,source_document,source_sha256,created_at",
    accession_number: `eq.${selected.payload.identity.accessionNumber}`,
    order: "created_at.desc,id.desc",
    limit: "1000",
  });
  if (!result.ok) return false;
  const revisions = rows(result.data);
  if (revisions.length >= 1000) return false;
  const selectedResult = selected.result;
  return revisions.every((row) =>
    stringValue(row.source_kind) !== stringValue(selectedResult.source_kind)
    || stringValue(row.source_url) !== stringValue(selectedResult.source_url)
    || stringValue(row.source_document) !== stringValue(selectedResult.source_document)
    || stringValue(row.source_sha256) === stringValue(selectedResult.source_sha256));
}

async function readExactCover(
  accessionNumber: string,
  sourceSha256: string,
  repository: SecTickerResolutionRepository,
): Promise<
  | { ok: true; value: AvailableCoverResult }
  | { ok: false; reason: string }
> {
  const read = await readSecCoverObservations({ accessionNumber, sourceSha256, repository });
  if (read.status !== "available") {
    return { ok: false, reason: read.status === "not_found" ? "cover_result_not_found" : read.reason };
  }
  if (read.results.length !== 1) return { ok: false, reason: "cover_result_ambiguous" };
  return { ok: true, value: read.results[0]! };
}

type AvailableCoverResult = Extract<SecCoverObservationReadResult, { status: "available" }>["results"][number];

function coverObservations(value: AvailableCoverResult): VerifiedSecCoverObservation[] {
  return value.payload.observations.map((observation) => ({
    resultId: stringValue(value.result.id),
    observationKey: observation.observationKey,
    accessionNumber: value.payload.identity.accessionNumber,
    issuerCik: value.payload.identity.issuerCik,
    acceptedAt: value.payload.identity.acceptedAt,
    sourceRawId: value.payload.source.rawSourceId,
    sourceUrl: value.payload.source.url,
    sourceDocument: value.payload.source.documentName,
    sourceSha256: value.payload.source.sha256,
    contextRef: observation.contextRef,
    dimensions: observation.context.dimensions as readonly Row[],
    securityTitleStatus: observation.securityTitle.status,
    securityTitle: observation.securityTitle.parsedTextValue,
    tradingSymbolStatus: observation.tradingSymbol.status,
    tradingSymbol: observation.tradingSymbol.parsedTextValue,
    exchangeStatus: observation.exchange.status,
    exchange: observation.exchange.parsedTextValue,
  }));
}

async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const supabase = await import("../supabase.ts");
  return { rpc: supabase.supabaseRpc, select: supabase.supabaseSelect };
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuePreserve(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeResolutionState(value: unknown) {
  const normalized = stringValue(value).toUpperCase();
  return new Set(["AUTO", "REVIEW", "UNRESOLVED"]).has(normalized)
    ? normalized as "AUTO" | "REVIEW" | "UNRESOLVED"
    : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
