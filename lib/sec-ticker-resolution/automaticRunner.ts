import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { acquireIngestWorkflowLock, renewIngestWorkflowLock, releaseIngestWorkflowLock } from "../ingestWorkflowLock.ts";
import { discoverSecTickerAutomaticCandidates, SEC_TICKER_AUTOMATIC_PLANNER_VERSION, SEC_TICKER_AUTOMATIC_ISSUER_LIMIT,
  type AutomaticTriggerSource, type AutomaticCandidate, type AutomaticPlanStep } from "./automaticPlanner.ts";
import { readSecTickerResolutionByDecisionId, resolveAndPersistSecTickerChange, type SecTickerResolutionRepository } from "./persistence.ts";
import { readEffectiveSecTickerResolutionByDecisionId } from "./humanReview.ts";
import { SEC_TICKER_RESOLUTION_VERSION } from "./canonical.ts";

type Row = Record<string, unknown>;
export const SEC_TICKER_AUTOMATIC_RUNNER_VERSION = "sec-ticker-automatic-runner-v1";
type Input = { trigger: AutomaticTriggerSource; systemIdentifier: string; repository?: SecTickerResolutionRepository };
type Classification = "insert" | "replay" | "review-required" | "waiting" | "conflict" | "unavailable";
type Fingerprint = { table: string; query: Record<string, string>; count: number; sha256: string };
type Mutation = { table: string; id: string; action: "insert" | "replay"; rowSha256: string };
const TABLES = new Set(["sec_cover_observation_results", "sec_cover_security_observations", "sec_structured_raw_sources",
  "sec_ticker_resolution_decisions", "sec_ticker_resolution_human_decisions", "sec_ticker_security_identities", "sec_ticker_change_evidence", "sec_issuers", "ingest_workflow_locks"]);
const RPCS = new Set(["acquire_ingest_workflow_lock", "renew_ingest_workflow_lock", "release_ingest_workflow_lock", "persist_sec_ticker_resolution"]);
export class AutomaticRunnerError extends Error {
  readonly code: string;
  readonly classification: Classification;
  constructor(code: string, classification: Classification = "unavailable") { super(code); this.code = code; this.classification = classification; }
}
function fail(code: string, classification: Classification = "unavailable"): never { throw new AutomaticRunnerError(code, classification); }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v))) fail("invalid_repository_rows");
  return value as Row[];
};

export function parseAutomaticTriggerSource(value: unknown): AutomaticTriggerSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("trigger_input_invalid");
  const r = value as Row;
  if (Object.keys(r).sort().join() !== "accessionNumber,issuerCik,resultId,sourceSha256"
    || typeof r.issuerCik !== "string" || !/^\d{10}$/.test(r.issuerCik)
    || typeof r.accessionNumber !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(r.accessionNumber)
    || typeof r.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sourceSha256)
    || typeof r.resultId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(r.resultId)) fail("trigger_input_invalid");
  return { issuerCik: r.issuerCik, accessionNumber: r.accessionNumber, sourceSha256: r.sourceSha256, resultId: r.resultId };
}

/** A fail-closed boundary, also used around persistence and its exact reader. */
export function automaticRunnerRepository(repository: SecTickerResolutionRepository, allowRpc = false): SecTickerResolutionRepository {
  return {
    async select(table, query) {
      if (!TABLES.has(table)) fail("select_table_forbidden");
      return repository.select(table, query);
    },
    async rpc(name, payload) {
      if (!allowRpc || !RPCS.has(name)) fail("rpc_forbidden");
      return repository.rpc(name, payload);
    },
  };
}

async function prepare(input: Input) {
  const trigger = parseAutomaticTriggerSource(input.trigger);
  if (!/^\d+$/.test(input.systemIdentifier)) fail("system_identifier_invalid");
  const base = automaticRunnerRepository(input.repository ?? await defaultRepository());
  const fingerprints = new Map<string, Fingerprint>();
  const repository: SecTickerResolutionRepository = {
    async select(table, query) {
      const response = await base.select(table, query);
      if (response.ok) {
        const data = rows(response.data), sha256 = hash(data.map(stable).sort());
        const key = stable({ table, query });
        const previous = fingerprints.get(key);
        if (previous && previous.sha256 !== sha256) fail("scope_changed_during_plan", "conflict");
        fingerprints.set(key, { table, query, count: data.length, sha256 });
      }
      return response;
    },
    rpc: base.rpc,
  };
  let classification: Classification = "waiting";
  const reasons: string[] = [], details: string[] = [];
  const candidates: AutomaticCandidate[] = [], previews: ReturnType<typeof describeCandidate>[] = [];
  let runs: Extract<AutomaticPlanStep, { kind: "runs" }>["runs"] = [], boundaryCount = 0;
  const mutations: Mutation[] = [];
  try {
    for await (const step of discoverSecTickerAutomaticCandidates({ ...trigger, repository })) {
      if (step.kind === "runs") { runs = step.runs; boundaryCount = step.boundaryCount; }
      if (step.kind === "preview") previews.push(describeCandidate(step.candidate));
      if (step.kind === "selected") candidates.push(step.candidate);
      if (step.kind === "stop") {
        classification = step.status === "failed" ? "unavailable" : step.status === "review_required" ? "review-required" : "waiting";
        reasons.push(step.reason); if (step.detail) details.push(step.detail);
      }
    }
    // Fingerprint/validate the entire existing issuer decision scope, not just
    // matching symbols. Human readers own history selection and validation.
    const saved = await selectRows(repository, "sec_ticker_resolution_decisions", {
      issuer_cik: `eq.${trigger.issuerCik}`, method_version: `eq.${SEC_TICKER_RESOLUTION_VERSION}`,
      order: "created_at.asc,id.asc", limit: String(SEC_TICKER_AUTOMATIC_ISSUER_LIMIT + 1),
    });
    if (saved.length > SEC_TICKER_AUTOMATIC_ISSUER_LIMIT) fail("issuer_decision_scope_exceeded", "waiting");
    for (const row of saved) {
      const exact = await readSecTickerResolutionByDecisionId({ decisionId: String(row.id), repository });
      const effective = await readEffectiveSecTickerResolutionByDecisionId({ decisionId: String(row.id), repository });
      if (exact.status !== "available" || effective.status !== "available" || effective.automatic.status !== "available") fail("existing_decision_reader_unavailable");
    }
    // v1 executes one exact intent; ingest retains sequential multi-boundary
    // persistence. Never pretend a whole issuer batch has transaction isolation.
    if (candidates.length > 1) { classification = "review-required"; reasons.push("multiple_selected_candidates_require_review"); }
    if (!reasons.length && candidates.length === 1) {
      const issuer = await selectRows(repository, "sec_issuers", { cik: `eq.${trigger.issuerCik}`, limit: "2" });
      if (issuer.length > 1) fail("issuer_rows_conflict", "conflict");
      mutations.push({ table: "sec_issuers", id: trigger.issuerCik, action: issuer.length ? "replay" : "insert", rowSha256: hash({ cik: trigger.issuerCik }) });
      const candidate = candidates[0]!, ev = candidate.evaluation;
      for (const [table, expected, hashColumn] of [
        ["sec_ticker_security_identities", ev.identity, "identity_sha256"],
        ["sec_ticker_change_evidence", ev.evidence, "evidence_sha256"],
        ["sec_ticker_resolution_decisions", ev.decision, "decision_sha256"],
      ] as const) {
        if (!expected) continue;
        const byId = await selectRows(repository, table, { id: `eq.${expected.id}`, limit: "2" });
        const byHash = await selectRows(repository, table, { [hashColumn]: `eq.${expected[hashColumn]}`, limit: "2" });
        if (byId.length > 1 || byHash.length > 1 || (byId.length !== byHash.length)
          || (byId.length && (!matches(byId[0]!, expected) || !matches(byHash[0]!, expected)))) fail("stored_payload_conflict", "conflict");
        mutations.push({ table, id: String(expected.id), action: byId.length ? "replay" : "insert", rowSha256: hash(expected) });
      }
      const decision = mutations.find(m => m.table === "sec_ticker_resolution_decisions")!;
      if (decision.action === "replay") {
        const read = await readSecTickerResolutionByDecisionId({ decisionId: decision.id, repository });
        if (read.status !== "available" || hash(read.evaluation) !== hash(ev)) fail("exact_decision_replay_invalid", "conflict");
      }
      classification = decision.action;
    }
  } catch (error) {
    classification = error instanceof AutomaticRunnerError ? error.classification : "unavailable";
    reasons.push(error instanceof AutomaticRunnerError ? error.code : "automatic_plan_exception");
  }
  const inputs = [...fingerprints.values()].sort((a, b) => stable(a).localeCompare(stable(b)));
  const counts = Object.fromEntries(["sec_issuers", "sec_ticker_security_identities", "sec_ticker_change_evidence", "sec_ticker_resolution_decisions"].map(table => [table, {
    insert: mutations.filter(m => m.table === table && m.action === "insert").length,
    replay: mutations.filter(m => m.table === table && m.action === "replay").length,
  }]));
  const ready = classification === "insert" || classification === "replay";
  const receipt = {
    plannerVersion: SEC_TICKER_AUTOMATIC_PLANNER_VERSION, runnerVersion: SEC_TICKER_AUTOMATIC_RUNNER_VERSION,
    systemIdentifier: input.systemIdentifier, trigger, status: ready ? "ready" as const : "blocked" as const,
    classification, reasons, details, runs, boundaryCount, previews, selected: candidates.map(describeCandidate),
    inputFingerprints: inputs,
    issuerCoverScopeSha256: hash(inputs.filter(i => i.table.startsWith("sec_cover_") || i.table === "sec_structured_raw_sources")),
    existingDecisionHumanScopeSha256: hash(inputs.filter(i => ["sec_ticker_resolution_decisions", "sec_ticker_resolution_human_decisions"].includes(i.table))),
    expectedMutation: { executable: ready, rows: mutations, counts, lock: { table: "ingest_workflow_locks", key: `sec-ticker-resolution:${trigger.issuerCik}`, lifecycle: "acquire-renew-release", expectedFinalDelta: 0 }, auditInserts: 0 },
    atomicity: "one_decision_transaction_and_issuer_lease", downstreamTriggered: false,
  };
  return { receipt: { ...receipt, digest: hash(receipt) }, candidates };
}

export async function planSecTickerAutomatic(input: Input) { return (await prepare(input)).receipt; }

export async function applySecTickerAutomatic(input: Input & { confirmedPlanDigest: string }) {
  if (!/^[a-f0-9]{64}$/.test(input.confirmedPlanDigest)) fail("plan_digest_invalid", "conflict");
  const repository = automaticRunnerRepository(input.repository ?? await defaultRepository(), true);
  const initial = await prepare({ ...input, repository });
  // Even a syntactically valid wrong digest must perform zero lock RPCs.
  if (initial.receipt.digest !== input.confirmedPlanDigest) fail("plan_digest_mismatch", "conflict");
  if (initial.receipt.status !== "ready") fail("plan_not_ready", initial.receipt.classification);
  const lock = { lockKey: `sec-ticker-resolution:${input.trigger.issuerCik}`, lockOwner: randomUUID() };
  const result: { status: "complete" | "incomplete" | "waiting"; reasons: string[]; decisionId?: string; writeStatus?: string;
    verified: boolean; persistenceAttempted: boolean; lockReleased: boolean; planDigest: string; downstreamTriggered: false } = {
    status: "incomplete", reasons: [], verified: false, persistenceAttempted: false, lockReleased: false, planDigest: input.confirmedPlanDigest, downstreamTriggered: false,
  };
  let held = false;
  try {
    // Do not replace even an expired pre-existing lease row: a successful
    // runner's transient acquire/release must not erase someone else's state.
    const existingLock = await selectRows(repository, "ingest_workflow_locks", { lock_key: `eq.${lock.lockKey}`, limit: "1" });
    if (existingLock.length) { result.status = "waiting"; result.reasons.push("issuer_lock_row_preexisting"); return result; }
    const acquire = await acquireIngestWorkflowLock(lock, 300, repository);
    if (!acquire.ok) fail("issuer_lease_acquire_failed");
    if (!acquire.acquired) { result.status = "waiting"; result.reasons.push("issuer_resolution_busy_retry_on_replay"); return result; }
    held = true;
    const current = await prepare({ ...input, repository });
    if (current.receipt.digest !== input.confirmedPlanDigest || current.receipt.status !== "ready") fail("locked_plan_digest_mismatch", "conflict");
    const candidate = current.candidates[0]!;
    const expected = { p_identity: candidate.evaluation.identity, p_evidence: candidate.evaluation.evidence, p_decision: candidate.evaluation.decision };
    // Re-evaluation remains in the production persistence function. A drifted
    // evaluation can never be persisted under the confirmed payload/digest.
    const guarded: SecTickerResolutionRepository = { select: repository.select, async rpc(name, payload) {
      if (name !== "persist_sec_ticker_resolution" || hash(payload) !== hash(expected)) fail("unplanned_persistence_payload", "conflict");
      // Persistence itself rereads the selected pair. Also bind issuer-wide
      // revisions and human history right before the write, not just that pair.
      const finalPlan = await prepare({ ...input, repository });
      if (finalPlan.receipt.status !== "ready" || finalPlan.receipt.digest !== input.confirmedPlanDigest) fail("pre_persist_scope_drift", "conflict");
      const renew = await renewIngestWorkflowLock(lock, 300, repository);
      if (!renew.ok || !renew.renewed) fail("issuer_lease_lost");
      result.persistenceAttempted = true;
      return repository.rpc(name, payload);
    } };
    const persisted = await resolveAndPersistSecTickerChange({ ...candidate.request, repository: guarded });
    if (persisted.status !== "available") fail(persisted.reason);
    result.decisionId = persisted.decisionId; result.writeStatus = persisted.writeStatus;
    const exact = await readSecTickerResolutionByDecisionId({ decisionId: persisted.decisionId, repository });
    if (exact.status !== "available" || hash(exact.evaluation) !== hash(candidate.evaluation)) fail("post_persist_exact_reader_failed");
    result.verified = true; result.status = "complete";
  } catch (error) {
    result.reasons.push(error instanceof AutomaticRunnerError ? error.code : "automatic_apply_exception");
  } finally {
    if (held) {
      try { const released = await releaseIngestWorkflowLock(lock, repository); result.lockReleased = released.ok && released.released; } catch { /* reported below */ }
      if (!result.lockReleased) { result.status = "incomplete"; result.reasons.push("issuer_lease_release_failed"); }
    }
  }
  return result;
}

function describeCandidate({ request, evaluation: e }: AutomaticCandidate) {
  const payload = e.decision.decision_payload as Row;
  const refs = payload.input as Row;
  return { request, resolutionState: e.resolutionState, reasons: e.reasons, ...e.summary,
    evidenceSource: { accessionNumber: request.evidenceAccessionNumber, resultId: e.decision.source_result_id, sourceSha256: request.evidenceSourceSha256 },
    beforeSource: { accessionNumber: request.beforeAccessionNumber, resultId: refs.beforeResultId, sourceSha256: request.beforeSourceSha256 },
    afterSource: { accessionNumber: request.afterAccessionNumber, resultId: refs.afterResultId, sourceSha256: request.afterSourceSha256 },
    identityId: e.identity?.id ?? null, identityPayloadSha256: e.identity?.identity_sha256 ?? null,
    evidenceId: e.evidence?.id ?? null, evidencePayloadSha256: e.evidence?.evidence_sha256 ?? null,
    decisionId: e.decision.id, decisionPayloadSha256: e.decision.decision_sha256, evaluationSha256: hash(e) };
}
async function selectRows(repository: SecTickerResolutionRepository, table: string, query: Record<string, string>) {
  const response = await repository.select(table, { select: "*", ...query });
  if (!response.ok) fail("plan_scope_read_failed");
  return rows(response.data);
}
function matches(actual: Row, expected: Row) { return Object.keys(expected).every(key => stable(actual[key]) === stable(expected[key])); }
async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
