import "server-only";

import {
  assertSecCoverCallerMatchesStored,
  buildSecCoverObservationPayload,
  buildSecCoverObservationPayloadFromStructuredArtifact,
  isSecCoverObservationRawItem,
  SecCoverObservationSourceError,
  validateSecCoverStoredPayload,
  type SecCoverObservationPayload,
  type SecCoverStructuredFilingIdentity,
} from "./canonical.ts";
import type { SecFilingXbrlRawArtifact } from "../sec-structured-data/filingXbrlContext.ts";

type Row = Record<string, unknown>;
type RepositoryResult = Readonly<{ ok: boolean; status: number; data: unknown; count?: number | null; error?: string }>;

export type SecCoverObservationRepository = Readonly<{
  rpc(functionName: string, payload: Row): Promise<RepositoryResult>;
  select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
}>;

export type SecCoverObservationReadResult =
  | Readonly<{
      status: "available";
      results: readonly Readonly<{
        result: Row;
        observations: readonly Row[];
        payload: SecCoverObservationPayload;
      }>[];
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export async function persistSecCoverObservationsForRawItem(input: {
  rawItemId: string;
  rawItem: Row;
  repository?: SecCoverObservationRepository;
}) {
  if (!isSecCoverObservationRawItem(input.rawItem)) return { status: "not_applicable" as const };
  const repository = input.repository ?? await defaultRepository();
  const storedResult = await repository.select("raw_items", {
    select: "*",
    id: `eq.${input.rawItemId}`,
    limit: "1",
  });
  if (!storedResult.ok) {
    throw new SecCoverObservationSourceError("stored_raw_read_failed", "SEC cover stored raw item could not be read");
  }
  const storedRawItem = rows(storedResult.data)[0];
  if (!storedRawItem) {
    throw new SecCoverObservationSourceError("stored_raw_not_found", "SEC cover stored raw item does not exist");
  }
  assertSecCoverCallerMatchesStored(input.rawItem, storedRawItem);
  const payload = buildSecCoverObservationPayload(input.rawItemId, storedRawItem);
  if (!payload) return { status: "not_applicable" as const };

  const result = await repository.rpc("persist_sec_cover_observation_result", {
    p_raw_item_id: input.rawItemId,
    p_source: payload.sourceRaw,
    p_result: payload.result,
    p_observations: payload.observations,
  });
  if (!result.ok) {
    throw new SecCoverObservationSourceError(
      "persistence_failed",
      `SEC cover observation persistence failed: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  const response = record(result.data);
  const writeStatus = stringValue(response.status);
  if (!new Set(["inserted", "replayed"]).has(writeStatus)
    || Number(response.observation_count) !== payload.observations.length
    || stringValue(response.result_id) !== payload.resultId) {
    throw new SecCoverObservationSourceError(
      "persistence_response_invalid",
      "SEC cover observation persistence returned an invalid result",
    );
  }
  return {
    status: "available" as const,
    writeStatus,
    resultId: payload.resultId,
    accessionNumber: payload.payload.identity.accessionNumber,
    issuerCik: payload.payload.identity.issuerCik,
    sourceSha256: payload.payload.source.sha256,
    extractionStatus: payload.payload.extractionStatus,
    observationCount: payload.observations.length,
  };
}

export async function persistSecCoverObservationsForStructuredArtifact(input: {
  filing: SecCoverStructuredFilingIdentity;
  artifact: SecFilingXbrlRawArtifact;
  artifactParserVersion?: string;
  repository?: SecCoverObservationRepository;
}) {
  const repository = input.repository ?? await defaultRepository();
  const payload = buildSecCoverObservationPayloadFromStructuredArtifact({
    filing: input.filing,
    artifact: input.artifact,
    artifactParserVersion: input.artifactParserVersion,
  });
  const result = await repository.rpc("persist_sec_cover_observation_result", {
    p_raw_item_id: null,
    p_source: payload.sourceRaw,
    p_result: payload.result,
    p_observations: payload.observations,
  });
  if (!result.ok) {
    throw new SecCoverObservationSourceError(
      "persistence_failed",
      `SEC structured cover observation persistence failed: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  const response = record(result.data);
  const writeStatus = stringValue(response.status);
  if (!new Set(["inserted", "replayed"]).has(writeStatus)
    || Number(response.observation_count) !== payload.observations.length
    || stringValue(response.result_id) !== payload.resultId) {
    throw new SecCoverObservationSourceError(
      "persistence_response_invalid",
      "SEC structured cover observation persistence returned an invalid result",
    );
  }
  return {
    status: "available" as const,
    writeStatus,
    resultId: payload.resultId,
    accessionNumber: payload.payload.identity.accessionNumber,
    issuerCik: payload.payload.identity.issuerCik,
    sourceSha256: payload.payload.source.sha256,
    extractionStatus: payload.payload.extractionStatus,
    observationCount: payload.observations.length,
  };
}

export async function recordSecCoverObservationPersistenceState(input: {
  rawItemId: string;
  state:
    | {
        status: "available";
        resultId: string;
        accessionNumber: string;
        issuerCik: string;
        sourceSha256: string | null;
        extractionStatus: string;
        observationCount: number;
        writeStatus: string;
        tickerResolution?: Record<string, unknown>;
      }
    | { status: "failed"; errorCode: string };
  repository?: SecCoverObservationRepository;
}) {
  const repository = input.repository ?? await defaultRepository();
  const state = input.state.status === "available"
    ? {
        status: "available",
        result_id: input.state.resultId,
        accession_number: input.state.accessionNumber,
        issuer_cik: input.state.issuerCik,
        source_sha256: input.state.sourceSha256,
        extraction_status: input.state.extractionStatus,
        observation_count: input.state.observationCount,
        write_status: input.state.writeStatus,
        storage_version: "sec_cover_security_observation_v1",
        recorded_at: new Date().toISOString(),
        ...(input.state.tickerResolution ? { ticker_resolution: input.state.tickerResolution } : {}),
      }
    : {
        status: "failed",
        error_code: input.state.errorCode,
        storage_version: "sec_cover_security_observation_v1",
        recorded_at: new Date().toISOString(),
      };
  const result = await repository.rpc("record_sec_cover_observation_persistence_state", {
    p_raw_item_id: input.rawItemId,
    p_state: state,
  });
  if (!result.ok) {
    throw new Error(`record SEC cover observation persistence state failed: ${result.error || `HTTP ${result.status}`}`);
  }
}

export async function readSecCoverObservations(input: {
  accessionNumber: string;
  sourceSha256?: string;
  contextRef?: string;
  limit?: number;
  repository?: SecCoverObservationRepository;
}): Promise<SecCoverObservationReadResult> {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(input.accessionNumber)) {
    return { status: "unavailable", reason: "invalid_accession" };
  }
  if (input.sourceSha256 && !/^[0-9a-f]{64}$/.test(input.sourceSha256)) {
    return { status: "unavailable", reason: "invalid_source_sha256" };
  }
  if (input.contextRef !== undefined && (!input.contextRef.trim() || input.contextRef.length > 512)) {
    return { status: "unavailable", reason: "invalid_context_ref" };
  }
  const repository = input.repository ?? await defaultRepository();
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const query: Record<string, string> = {
    select: "*",
    accession_number: `eq.${input.accessionNumber}`,
    order: "created_at.desc,id.desc",
    limit: String(limit),
  };
  if (input.sourceSha256) query.source_sha256 = `eq.${input.sourceSha256}`;
  const resultRead = await repository.select("sec_cover_observation_results", query);
  if (!resultRead.ok) return { status: "unavailable", reason: "result_read_failed" };
  const resultRows = rows(resultRead.data);
  if (resultRows.length === 0) return { status: "not_found" };

  const validated: Array<{
    result: Row;
    observations: readonly Row[];
    payload: SecCoverObservationPayload;
  }> = [];
  for (const result of resultRows) {
    const resultId = stringValue(result.id);
    const observationRead = await repository.select("sec_cover_security_observations", {
      select: "*",
      result_id: `eq.${resultId}`,
      order: "observation_index.asc",
      limit: "1000",
    });
    if (!observationRead.ok) return { status: "unavailable", reason: "observation_read_failed" };
    const allObservations = rows(observationRead.data);
    let rawSource: Row | null = null;
    const sourceRawId = stringValue(result.source_raw_id);
    if (sourceRawId) {
      const rawSourceRead = await repository.select("sec_structured_raw_sources", {
        select: "*",
        id: `eq.${sourceRawId}`,
        limit: "1",
      });
      if (!rawSourceRead.ok) return { status: "unavailable", reason: "raw_source_read_failed" };
      rawSource = rows(rawSourceRead.data)[0] ?? null;
    }
    const check = validateSecCoverStoredPayload({ result, observations: allObservations, rawSource });
    if (!check.ok) return { status: "unavailable", reason: check.reason };
    const observations = input.contextRef
      ? allObservations.filter((row) => stringValue(row.context_ref) === input.contextRef)
      : allObservations;
    if (input.contextRef && observations.length === 0) continue;
    validated.push({ result, observations, payload: check.payload });
  }
  return validated.length > 0 ? { status: "available", results: validated } : { status: "not_found" };
}

export function secCoverObservationFailureState(error: unknown) {
  return {
    status: "failed" as const,
    errorCode: error instanceof SecCoverObservationSourceError ? error.code : "unknown_failure",
  };
}

async function defaultRepository(): Promise<SecCoverObservationRepository> {
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
