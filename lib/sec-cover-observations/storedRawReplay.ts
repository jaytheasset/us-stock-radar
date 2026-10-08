import { createHash } from "node:crypto";
import {
  buildSecCoverObservationPayload,
  SecCoverObservationSourceError,
  type SecCoverPersistencePayload,
} from "./canonical.ts";
import {
  persistSecCoverObservationsForRawItem,
  readSecCoverObservations,
  type SecCoverObservationRepository,
} from "./persistence.ts";

type Row = Record<string, unknown>;
export const SEC_STORED_RAW_COVER_REPLAY_VERSION = "sec-stored-raw-cover-replay-v1";
export type StoredRawCoverTarget = Readonly<{
  rawItemId: string;
  accessionNumber: string;
  issuerCik: string;
  sourceSha256: string;
}>;
type Action = "insert" | "replay" | "conflict" | "unavailable";
type PlanItem = StoredRawCoverTarget & {
  action: Action; reason: string | null; rawFingerprint: string | null;
  sourceRawId: string | null; resultId: string | null;
  sourcePayloadHash: string | null; resultPayloadHash: string | null;
  resultRowHash: string | null; observationHash: string | null;
  observationCount: number | null; extractionStatus: string | null;
  contexts: Array<{
    contextRef: string; contextHash: string; observationKey: string;
    securityTitle: ReturnType<typeof field>; tradingSymbol: ReturnType<typeof field>; exchange: ReturnType<typeof field>;
  }>;
};
type Prepared = { raw: Row; payload: SecCoverPersistencePayload };
type ReplayInput = {
  targets: readonly StoredRawCoverTarget[];
  systemIdentifier: string;
  repository?: SecCoverObservationRepository;
};

export class StoredRawCoverReplayError extends Error {
  readonly code: string;
  readonly action: Action;
  constructor(code: string, action: Action = "unavailable") {
    super(code);
    this.code = code;
    this.action = action;
    this.name = "StoredRawCoverReplayError";
  }
}

export function parseStoredRawCoverTargets(value: unknown): StoredRawCoverTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail("exact_targets_required");
  const seen = new Set<string>();
  return value.map(value => {
    const row = object(value);
    const { rawItemId, accessionNumber, issuerCik, sourceSha256 } = row;
    if (typeof rawItemId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(rawItemId)
      || typeof accessionNumber !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)
      || typeof issuerCik !== "string" || !/^\d{10}$/.test(issuerCik) || issuerCik === "0000000000"
      || typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceSha256)) fail("target_identity_invalid");
    if (seen.has(rawItemId)) fail("duplicate_raw_item_target");
    seen.add(rawItemId);
    return { rawItemId, accessionNumber, issuerCik, sourceSha256 };
  }).sort((a, b) => a.rawItemId.localeCompare(b.rawItemId));
}

export async function planStoredRawCoverReplay(input: ReplayInput) {
  return (await prepare(input)).plan;
}

async function prepare(input: ReplayInput) {
  const targets = parseStoredRawCoverTargets(input.targets);
  if (!/^\d+$/.test(input.systemIdentifier)) fail("system_identifier_invalid");
  const repository = await resolveRepository(input.repository);
  const queryOnly = readOnlyRepository(repository);
  const prepared = new Map<string, Prepared>();
  const items: PlanItem[] = [];
  for (const target of targets) {
    let rawFingerprint: string | null = null;
    let built: SecCoverPersistencePayload | null = null;
    let action: Action = "unavailable";
    let reason: string | null = null;
    try {
      const raws = await select(queryOnly, "raw_items", { id: `eq.${target.rawItemId}`, limit: "2" });
      if (!raws.length) fail("raw_not_found");
      if (raws.length !== 1) fail("raw_identity_ambiguous", "conflict");
      const raw = raws[0]!;
      rawFingerprint = digest(raw);
      const source = object(raw.raw_payload);
      if (raw.id !== target.rawItemId || raw.source_code !== "sec_edgar" || raw.source_group !== "filings"
        || raw.source_unique_id !== target.accessionNumber || source.accession_number !== target.accessionNumber) fail("raw_accession_mismatch", "conflict");
      if (typeof source.primary_document_html !== "string" || !source.primary_document_html) fail("source_bytes_missing");
      if (sha(source.primary_document_html) !== target.sourceSha256
        || (source.primary_document_sha256 !== undefined && source.primary_document_sha256 !== target.sourceSha256)) fail("source_sha_mismatch", "conflict");
      built = buildSecCoverObservationPayload(target.rawItemId, raw);
      if (!built) fail("raw_not_applicable");
      if (built.payload.identity.issuerCik !== target.issuerCik) fail("raw_cik_mismatch", "conflict");
      if (built.payload.source.status !== "available" || !built.sourceRaw) fail("complete_source_required", "conflict");
      action = await classify(queryOnly, built);
      prepared.set(target.rawItemId, { raw, payload: built });
    } catch (error) {
      action = error instanceof StoredRawCoverReplayError ? error.action : "unavailable";
      reason = error instanceof StoredRawCoverReplayError ? error.code : "cover_prepare_failed";
    }
    items.push({
      ...target, action, reason, rawFingerprint,
      sourceRawId: built?.sourceRaw?.id as string | undefined ?? null,
      resultId: built?.resultId ?? null,
      sourcePayloadHash: built?.sourceRaw ? digest(sourceComparable(built.sourceRaw)) : null,
      resultPayloadHash: built?.payloadSha256 ?? null,
      resultRowHash: built ? digest(built.result) : null,
      observationHash: built ? digest(built.observations) : null,
      observationCount: built?.observations.length ?? null,
      extractionStatus: built?.payload.extractionStatus ?? null,
      contexts: built?.payload.observations.map(o => ({
        contextRef: o.contextRef, contextHash: o.contextHash, observationKey: o.observationKey,
        securityTitle: field(o.securityTitle), tradingSymbol: field(o.tradingSymbol), exchange: field(o.exchange),
      })) ?? [],
    });
  }
  // Insert and fully verified replay express the same append intent. Keeping
  // those two equivalent permits an interrupted item-level apply to resume with
  // its original confirmation; conflicts/unavailable states never share it.
  const confirmation = {
    version: SEC_STORED_RAW_COVER_REPLAY_VERSION,
    systemIdentifier: input.systemIdentifier,
    items: items.map(({ action, ...item }) => ({ ...item, readiness: action === "insert" || action === "replay" ? "ready" : action })),
  };
  const plan = {
    version: SEC_STORED_RAW_COVER_REPLAY_VERSION,
    systemIdentifier: input.systemIdentifier,
    status: items.every(i => i.action === "insert" || i.action === "replay") ? "ready" as const : "blocked" as const,
    digest: digest(confirmation),
    counts: Object.fromEntries((["insert", "replay", "conflict", "unavailable"] as const).map(a => [a, items.filter(i => i.action === a).length])),
    items,
    atomicity: "one_raw_item" as const,
    downstreamTriggered: false,
  };
  return { plan, prepared, repository, targets };
}

async function classify(repository: SecCoverObservationRepository, built: SecCoverPersistencePayload): Promise<"insert" | "replay"> {
  // ID-only reads detect conflicting rows that a filtered accession reader
  // would correctly omit, but that would still collide during persistence.
  const result = await select(repository, "sec_cover_observation_results", { id: `eq.${built.resultId}`, limit: "2" });
  const sources = await select(repository, "sec_structured_raw_sources", { id: `eq.${built.sourceRaw!.id}`, limit: "2" });
  if (sources.length > 1 || (sources[0] && !matches(sourceComparable(sources[0]), sourceComparable(built.sourceRaw!)))) fail("stored_source_conflict", "conflict");
  if (!result.length) {
    const orphan = await select(repository, "sec_cover_security_observations", { result_id: `eq.${built.resultId}`, limit: "1" });
    if (orphan.length) fail("orphan_observations", "conflict");
    return "insert";
  }
  if (result.length !== 1 || !matches(result[0]!, built.result)) fail("stored_result_conflict", "conflict");
  const read = await readSecCoverObservations({
    accessionNumber: built.payload.identity.accessionNumber, resultId: built.resultId,
    sourceSha256: built.payload.source.sha256!, repository,
  });
  if (read.status === "unavailable") {
    if (read.reason.endsWith("read_failed")) fail("cover_read_failed");
    fail("stored_cover_incomplete_or_invalid", "conflict");
  }
  if (read.status !== "available" || read.results.length !== 1
    || digest(read.results[0]!.payload) !== built.payloadSha256) fail("stored_cover_conflict", "conflict");
  return "replay";
}

export async function applyStoredRawCoverReplay(input: ReplayInput & { confirmedPlanDigest: string }) {
  if (!/^[a-f0-9]{64}$/.test(input.confirmedPlanDigest)) fail("plan_confirmation_required");
  const current = await prepare(input);
  if (current.plan.digest !== input.confirmedPlanDigest) fail("plan_digest_mismatch");
  if (current.plan.status !== "ready") fail("plan_not_ready");
  const items: Array<{
    rawItemId: string; status: "verified" | "failed_unconfirmed" | "not_attempted";
    writeStatus?: string; resultId?: string; reason?: string; rpcAttempted: boolean;
  }> = [];
  let stopped = false;
  for (const target of current.targets) {
    if (stopped) { items.push({ rawItemId: target.rawItemId, status: "not_attempted", rpcAttempted: false }); continue; }
    const prepared = current.prepared.get(target.rawItemId)!;
    const expectedRawHash = digest(prepared.raw);
    let rpcAttempted = false;
    const guarded: SecCoverObservationRepository = {
      async select(table, query) {
        const response = await readOnlyRepository(current.repository).select(table, query);
        if (table === "raw_items" && (rows(response.data).length !== 1 || digest(rows(response.data)[0]) !== expectedRawHash)) fail("raw_changed_before_persistence");
        return response;
      },
      async rpc(name, payload) {
        if (name !== "persist_sec_cover_observation_result"
          || payload.p_raw_item_id !== target.rawItemId
          || digest(payload.p_source) !== digest(prepared.payload.sourceRaw)
          || digest(payload.p_result) !== digest(prepared.payload.result)
          || digest(payload.p_observations) !== digest(prepared.payload.observations)) fail("unexpected_persistence_call");
        rpcAttempted = true;
        return current.repository.rpc(name, payload);
      },
    };
    try {
      const result = await persistSecCoverObservationsForRawItem({ rawItemId: target.rawItemId, rawItem: prepared.raw, repository: guarded });
      if (result.status !== "available" || result.resultId !== prepared.payload.resultId) fail("apply_response_invalid");
      if (await classify(readOnlyRepository(current.repository), prepared.payload) !== "replay") fail("post_apply_exact_read_failed");
      items.push({ rawItemId: target.rawItemId, status: "verified", writeStatus: result.writeStatus, resultId: result.resultId, rpcAttempted });
    } catch (error) {
      // A transport/response/read-back failure can follow a committed RPC. Do
      // not report rollback; the next full plan must resolve its exact state.
      const reason = error instanceof StoredRawCoverReplayError || error instanceof SecCoverObservationSourceError
        ? error.code : "persistence_or_readback_failed";
      items.push({ rawItemId: target.rawItemId, status: "failed_unconfirmed", reason, rpcAttempted });
      stopped = true;
    }
  }
  return { status: stopped ? "incomplete" : "complete", planDigest: current.plan.digest, atomicity: "one_raw_item", items, downstreamTriggered: false };
}

async function resolveRepository(repository?: SecCoverObservationRepository): Promise<SecCoverObservationRepository> {
  if (repository) return repository;
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
function readOnlyRepository(repository: SecCoverObservationRepository): SecCoverObservationRepository {
  return {
    async select(table, query) {
      if (!["raw_items", "sec_structured_raw_sources", "sec_cover_observation_results", "sec_cover_security_observations"].includes(table)) fail("unexpected_read_table");
      let result;
      try { result = await repository.select(table, query); } catch { fail("repository_read_failed"); }
      if (!result.ok) fail("repository_read_failed");
      rows(result.data);
      return result;
    },
    async rpc() { fail("plan_rpc_forbidden"); },
  };
}
async function select(repository: SecCoverObservationRepository, table: string, query: Record<string, string>) {
  const result = await repository.select(table, { select: "*", ...query });
  return rows(result.data);
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v))) fail("repository_read_malformed");
  return value as Row[];
}
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function sourceComparable(source: Row): Row {
  const { fetched_at: _fetched, ingested_at: _ingested, created_at: _created, ...rest } = source;
  return rest;
}
function matches(actual: Row, expected: Row) {
  return Object.keys(expected).every(key => key === "accepted_at" && expected[key] !== null
    ? new Date(String(actual[key])).getTime() === new Date(String(expected[key])).getTime()
    : stable(actual[key]) === stable(expected[key]));
}
function field(value: { status: string; rawLexicalValue: string | null; parsedTextValue: string | null }) {
  return { status: value.status, rawLexicalValue: value.rawLexicalValue, parsedTextValue: value.parsedTextValue };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Row)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function sha(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown) { return sha(stable(value)); }
function fail(code: string, action: Action = "unavailable"): never { throw new StoredRawCoverReplayError(code, action); }
