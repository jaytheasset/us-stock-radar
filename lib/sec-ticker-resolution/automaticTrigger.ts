import "server-only";
import { randomUUID } from "node:crypto";
import { acquireIngestWorkflowLock, renewIngestWorkflowLock, releaseIngestWorkflowLock } from "../ingestWorkflowLock.ts";

import { readSecCoverObservations, type SecCoverObservationReadResult } from "../sec-cover-observations/persistence.ts";
import { SEC_TICKER_RESOLUTION_VERSION, type SecTickerResolutionEvaluation } from "./canonical.ts";
import { readEffectiveSecTickerResolutionByDecisionId } from "./humanReview.ts";
import {
  previewSecTickerChange,
  resolveAndPersistSecTickerChange,
  type SecTickerResolutionRequest,
  type SecTickerResolutionRepository,
} from "./persistence.ts";

type Row = Record<string, unknown>;
type Cover = Extract<SecCoverObservationReadResult, { status: "available" }>["results"][number];
type Candidate = { request: SecTickerResolutionRequest; evaluation: SecTickerResolutionEvaluation };
export const SEC_TICKER_AUTOMATIC_TRIGGER_VERSION = "sec-ticker-resolution-ingest-v1";
export const SEC_TICKER_AUTOMATIC_ISSUER_LIMIT = 100;
const LEASE_SECONDS = 300;

export type SecTickerAutomaticTriggerResult = {
  version: string;
  status: "completed" | "waiting" | "review_required" | "failed";
  reasons: string[];
  decisions: Array<{ decisionId: string; resolutionState: string; writeStatus: string }>;
};

/** Discovery supplies source-bound inputs only; the existing engine owns every relationship rule. */
export async function runSecTickerResolutionAutomaticTrigger(input: {
  issuerCik: string;
  accessionNumber: string;
  sourceSha256: string | null;
  resultId: string;
  repository?: SecTickerResolutionRepository;
}): Promise<SecTickerAutomaticTriggerResult> {
  const result: SecTickerAutomaticTriggerResult = {
    version: SEC_TICKER_AUTOMATIC_TRIGGER_VERSION, status: "completed", reasons: [], decisions: [],
  };
  const stop = (status: SecTickerAutomaticTriggerResult["status"], reason: string) => {
    result.status = status;
    result.reasons.push(reason);
    return result;
  };
  let held: { repository: SecTickerResolutionRepository; lock: { lockKey: string; lockOwner: string } } | null = null;
  try {
    const repository = input.repository ?? await defaultRepository();
    const issuerCik = input.issuerCik;
    if (!/^\d{10}$/.test(issuerCik)) return stop("failed", "invalid_issuer_cik");
    const lock = { lockKey: `sec-ticker-resolution:${issuerCik}`, lockOwner: randomUUID() };
    const acquired = await acquireIngestWorkflowLock(lock, LEASE_SECONDS, repository);
    if (!acquired.ok) return stop("failed", "issuer_lease_acquire_failed");
    if (!acquired.acquired) return stop("waiting", "issuer_resolution_busy_retry_on_replay");
    held = { repository, lock };
    const list = await repository.select("sec_cover_observation_results", {
      select: "*", issuer_cik: `eq.${issuerCik}`, order: "accession_number.asc,id.asc",
      limit: String(SEC_TICKER_AUTOMATIC_ISSUER_LIMIT + 1),
    });
    if (!list.ok) return stop("failed", "cover_list_read_failed");
    const listed = rows(list.data);
    if (listed.length > SEC_TICKER_AUTOMATIC_ISSUER_LIMIT) return stop("waiting", "issuer_observation_scope_exceeded");
    const covers: Cover[] = [];
    for (const accession of [...new Set(listed.map(row => text(row.accession_number)))]) {
      const read = await readSecCoverObservations({ accessionNumber: accession, repository });
      if (read.status !== "available") return stop("failed", "cover_reader_unavailable");
      if (read.results.length !== 1) return stop("review_required", "multiple_source_revisions");
      const cover = read.results[0]!;
      if (cover.payload.identity.issuerCik !== issuerCik) return stop("failed", "cover_issuer_mismatch");
      if (!cover.payload.identity.acceptedAt || !Number.isFinite(Date.parse(cover.payload.identity.acceptedAt))) {
        return stop("waiting", "accepted_time_missing");
      }
      if (!cover.payload.source.sha256) return stop("waiting", "source_hash_missing");
      covers.push(cover);
    }
    if (!covers.some(cover => text(cover.result.id) === input.resultId
      && cover.payload.identity.accessionNumber === input.accessionNumber
      && cover.payload.source.sha256 === input.sourceSha256)) return stop("failed", "trigger_source_mismatch");
    covers.sort((a, b) => Date.parse(a.payload.identity.acceptedAt!) - Date.parse(b.payload.identity.acceptedAt!)
      || a.payload.identity.accessionNumber.localeCompare(b.payload.identity.accessionNumber));
    if (covers.length < 2) return stop("waiting", "observation_pair_missing");
    // Equal observed symbol sets are only discovery runs, never a security-continuity assertion.
    const runs: Cover[][] = [];
    for (const cover of covers) {
      const previous = runs.at(-1);
      if (previous && symbolSet(previous[0]!) === symbolSet(cover)) previous.push(cover);
      else runs.push([cover]);
    }
    for (let index = 1; index < runs.length; index += 1) {
      const beforeRun = runs[index - 1]!;
      const afterRun = runs[index]!;
      const requests = [
        ...afterRun.map(after => requestFor(issuerCik, beforeRun.at(-1)!, after, after)),
        ...beforeRun.map(before => requestFor(issuerCik, before, afterRun[0]!, before)),
      ];
      const candidates: Candidate[] = [];
      for (const request of requests) {
        const renewed = await renewIngestWorkflowLock(lock, LEASE_SECONDS, repository);
        if (!renewed.ok || !renewed.renewed) return stop("failed", "issuer_lease_lost");
        const preview = await previewSecTickerChange({ ...request, repository });
        if (preview.status !== "available") return stop("failed", preview.reason);
        candidates.push({ request, evaluation: preview.evaluation });
      }
      const supported = candidates.filter(candidate => candidate.evaluation.summary.sourceTextSpanSha256);
      const aligned = supported.filter(candidate => !candidate.evaluation.reasons.some(reason =>
        reason === "OLD_TICKER_CONFLICT" || reason === "NEW_TICKER_CONFLICT"));
      const relevant = aligned.length ? aligned : supported.length ? supported : [candidates[0]!];
      // Never prefer AUTO over an engine REVIEW for conflicting evidence or candidate identity.
      if (new Set(relevant.map(candidate => claimKey(candidate.evaluation))).size !== 1) {
        result.status = "review_required";
        result.reasons.push("discovery_claims_or_security_candidates_conflict");
        continue;
      }
      let selected = relevant[0]!;
      // Re-read immediately before persistence. Keeping the existing pair also keeps its Human scope.
      const saved = await repository.select("sec_ticker_resolution_decisions", {
        select: "*", issuer_cik: `eq.${issuerCik}`, method_version: `eq.${SEC_TICKER_RESOLUTION_VERSION}`,
        order: "created_at.asc,id.asc", limit: String(SEC_TICKER_AUTOMATIC_ISSUER_LIMIT + 1),
      });
      if (!saved.ok) return stop("failed", "existing_decision_read_failed");
      if (rows(saved.data).length > SEC_TICKER_AUTOMATIC_ISSUER_LIMIT) return stop("waiting", "issuer_decision_scope_exceeded");
      const anchors: Candidate[] = [];
      let conflictingScope = false;
      for (const row of rows(saved.data)) {
        const relationship = record(record(row.decision_payload).relationship);
        if (relationship.oldTicker !== selected.evaluation.summary.oldTicker
          || relationship.newTicker !== selected.evaluation.summary.newTicker) continue;
        const effective = await readEffectiveSecTickerResolutionByDecisionId({ decisionId: text(row.id), repository });
        if (effective.status !== "available" || effective.automatic.status !== "available") {
          return stop("failed", "existing_decision_reader_unavailable");
        }
        const automatic = effective.automatic.result;
        if (claimKey(automatic.evaluation) === claimKey(selected.evaluation)) {
          anchors.push({ request: savedRequest(automatic.decision), evaluation: automatic.evaluation });
        } else if (automatic.evaluation.summary.sourceTextSpanSha256 || effective.history.length > 0) {
          conflictingScope = true;
        }
      }
      if (conflictingScope || new Set(anchors.map(anchor => scopeKey(anchor.request))).size > 1) {
        result.status = "review_required";
        result.reasons.push("existing_claim_or_human_scope_requires_review");
        continue;
      }
      if (anchors.length) selected = anchors[0]!;
      const renewed = await renewIngestWorkflowLock(lock, LEASE_SECONDS, repository);
      if (!renewed.ok || !renewed.renewed) return stop("failed", "issuer_lease_lost");
      const persisted = await resolveAndPersistSecTickerChange({ ...selected.request, repository });
      if (persisted.status !== "available") return stop("failed", persisted.reason);
      result.decisions.push({ decisionId: persisted.decisionId, resolutionState: persisted.resolutionState, writeStatus: persisted.writeStatus });
    }
    if (!result.decisions.length && !result.reasons.length) return stop("waiting", "no_observed_symbol_boundary");
    return result;
  } catch {
    return stop("failed", "automatic_resolution_exception");
  } finally {
    if (held) {
      try {
        const released = await releaseIngestWorkflowLock(held.lock, held.repository);
        if (!released.ok || !released.released) stop("failed", "issuer_lease_release_failed");
      } catch { stop("failed", "issuer_lease_release_failed"); }
    }
  }
}

function requestFor(issuerCik: string, before: Cover, after: Cover, evidence: Cover): SecTickerResolutionRequest {
  return {
    issuerCik,
    evidenceAccessionNumber: evidence.payload.identity.accessionNumber,
    evidenceSourceSha256: evidence.payload.source.sha256!,
    beforeAccessionNumber: before.payload.identity.accessionNumber,
    beforeSourceSha256: before.payload.source.sha256!,
    afterAccessionNumber: after.payload.identity.accessionNumber,
    afterSourceSha256: after.payload.source.sha256!,
  };
}

function savedRequest(row: Row): SecTickerResolutionRequest {
  const input = record(record(row.decision_payload).input);
  return {
    issuerCik: text(row.issuer_cik), evidenceAccessionNumber: text(row.evidence_accession_number),
    evidenceSourceSha256: text(input.sourceSha256), beforeAccessionNumber: text(row.before_accession_number),
    beforeSourceSha256: text(input.beforeSourceSha256), afterAccessionNumber: text(row.after_accession_number),
    afterSourceSha256: text(input.afterSourceSha256),
  };
}

function symbolSet(cover: Cover) {
  return JSON.stringify([...new Set(cover.payload.observations.map(observation =>
    JSON.stringify([observation.tradingSymbol.status, observation.tradingSymbol.parsedTextValue])))].sort());
}

function claimKey(evaluation: SecTickerResolutionEvaluation) {
  const identity = record(evaluation.identity?.identity_payload);
  const security = (value: unknown) => {
    const row = record(value);
    return [row.securityTitle ?? null, row.exchange ?? null, row.dimensions ?? null];
  };
  const { sourceTextSpanSha256: _span, ...summary } = evaluation.summary;
  return JSON.stringify([evaluation.resolutionState, evaluation.reasons, summary,
    security(identity.before), security(identity.after)]);
}

function scopeKey(request: SecTickerResolutionRequest) {
  return `${request.beforeAccessionNumber}/${request.afterAccessionNumber}`;
}
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(record) : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const supabase = await import("../supabase.ts");
  return { select: supabase.supabaseSelect, rpc: supabase.supabaseRpc };
}
