import type { OfferingMonitorJobIdentity } from "./offeringMonitorJobFoundation.ts";
import {
  promoteOfferingMonitorCanonical,
  readOfferingMonitorCanonical,
  validateOfferingMonitorCandidateForPromotion,
  type OfferingMonitorCanonicalReadResult,
  type OfferingMonitorPromotionResult,
} from "./offeringMonitorCanonicalPersistence.ts";
import {
  OFFERING_MONITOR_MATCHER_VERSION,
  evaluateOfferingMonitorEvent,
  type OfferingMonitorEventMatchResult,
} from "./offeringMonitorMatcher.ts";
import type { OfferingMonitorSecondStageResult } from "./offeringMonitorSecondStage.ts";

const EMPTY_CONDITION_SETS = Object.freeze([]);

export type OfferingMonitorProductionWiringResult =
  | {
      status: "not_promoted";
      reason: "second_stage_not_completed" | "invalid_candidate" | "candidate_not_applicable";
      matcherInvoked: false;
    }
  | {
      status: "promotion_blocked";
      promotionStatus: "stale" | "rejected";
      reason: string;
      matcherInvoked: false;
    }
  | {
      status: "reader_not_ready";
      promotionStatus: "saved" | "idempotent";
      reason: string;
      matcherInvoked: false;
    }
  | {
      status: "completed";
      promotionStatus: "saved" | "idempotent";
      matcherStatus: "invoked" | "replayed";
      matcherInvoked: boolean;
      canonicalSourceExecutionId: string;
      matcher: OfferingMonitorEventMatchResult;
    };

export type OfferingMonitorProductionWiringDependencies = {
  promoteCanonical(input: {
    eventId: string;
    sourceExecutionId: string;
  }): Promise<OfferingMonitorPromotionResult>;
  readCanonical(eventId: string): Promise<OfferingMonitorCanonicalReadResult>;
  evaluateMatcher(input: {
    eventId: string;
    canonical: Extract<OfferingMonitorCanonicalReadResult, { status: "available" }>;
  }): Promise<OfferingMonitorEventMatchResult>;
  readExecutionMetadata(identity: OfferingMonitorJobIdentity): Promise<Record<string, unknown>>;
  recordExecutionMetadata(
    identity: OfferingMonitorJobIdentity,
    metadata: Record<string, unknown>,
  ): Promise<void>;
};

const defaultDependencies: OfferingMonitorProductionWiringDependencies = {
  promoteCanonical: promoteOfferingMonitorCanonical,
  readCanonical: readOfferingMonitorCanonical,
  evaluateMatcher: ({ eventId, canonical }) => evaluateOfferingMonitorEvent(
    { eventId, conditionSets: EMPTY_CONDITION_SETS },
    { readCanonical: async () => canonical },
  ),
  readExecutionMetadata: readOfferingMonitorExecutionMetadata,
  recordExecutionMetadata: recordOfferingMonitorExecutionMetadata,
};

/**
 * Production-only continuation of one already-completed Stage 2 execution.
 * It never reads candidate, Primary, parser, or ai_runs facts as Matcher truth.
 */
export async function processOfferingMonitorProductionWiring(
  identity: OfferingMonitorJobIdentity,
  secondStage: OfferingMonitorSecondStageResult,
  dependencies: OfferingMonitorProductionWiringDependencies = defaultDependencies,
): Promise<OfferingMonitorProductionWiringResult> {
  if (secondStage.status !== "completed") {
    return { status: "not_promoted", reason: "second_stage_not_completed", matcherInvoked: false };
  }

  const candidateValidation = validateOfferingMonitorCandidateForPromotion(secondStage.candidate);
  if (!candidateValidation.ok) {
    return { status: "not_promoted", reason: "invalid_candidate", matcherInvoked: false };
  }
  if (candidateValidation.canonical.applicability !== "applicable") {
    const result = {
      status: "not_promoted" as const,
      reason: "candidate_not_applicable" as const,
      matcherInvoked: false as const,
    };
    await dependencies.recordExecutionMetadata(identity, {
      phase: "canonical_promotion_not_applicable",
      production_wiring_status: "not_applicable",
      diagnostic_candidate_only: true,
      canonical_persistence_changed: false,
      canonical_persistence_status: "not_applicable",
      canonical_reader_status: "not_run",
      offering_matcher_invoked: false,
    });
    return result;
  }

  const executionMetadata = await dependencies.readExecutionMetadata(identity);
  if (
    executionMetadata.production_wiring_status === "completed"
    && executionMetadata.offering_matcher_invoked === true
  ) {
    const replayCanonical = await dependencies.readCanonical(identity.eventId);
    const replayReason = canonicalIneligibilityReason(identity, replayCanonical);
    if (replayReason || replayCanonical.status !== "available") {
      return {
        status: "reader_not_ready",
        promotionStatus: "idempotent",
        reason: replayReason || "canonical_not_ready",
        matcherInvoked: false,
      };
    }
    return {
      status: "completed",
      promotionStatus: "idempotent",
      matcherStatus: "replayed",
      matcherInvoked: false,
      canonicalSourceExecutionId: replayCanonical.sourceExecutionId,
      matcher: emptyMatcherResult(identity.eventId),
    };
  }

  const promotion = await dependencies.promoteCanonical({
    eventId: identity.eventId,
    sourceExecutionId: identity.executionId,
  });
  if (promotion.status === "stale" || promotion.status === "rejected") {
    await dependencies.recordExecutionMetadata(identity, {
      phase: promotion.status === "stale" ? "canonical_promotion_stale" : "canonical_promotion_rejected",
      production_wiring_status: promotion.status,
      diagnostic_candidate_only: true,
      canonical_persistence_changed: false,
      canonical_persistence_status: promotion.status,
      canonical_persistence_reason: promotion.reason,
      canonical_reader_status: "not_run",
      offering_matcher_invoked: false,
    });
    return {
      status: "promotion_blocked",
      promotionStatus: promotion.status,
      reason: promotion.reason,
      matcherInvoked: false,
    };
  }

  const canonical = await dependencies.readCanonical(identity.eventId);
  const readerReason = canonicalIneligibilityReason(identity, canonical);
  if (readerReason || canonical.status !== "available") {
    await dependencies.recordExecutionMetadata(identity, {
      phase: "canonical_reader_not_ready",
      production_wiring_status: "reader_not_ready",
      diagnostic_candidate_only: false,
      canonical_persistence_changed: promotion.status === "saved",
      canonical_persistence_status: promotion.status,
      canonical_reader_status: canonical.status,
      canonical_reader_reason: readerReason || "canonical_not_ready",
      offering_matcher_invoked: false,
    });
    return {
      status: "reader_not_ready",
      promotionStatus: promotion.status,
      reason: readerReason || "canonical_not_ready",
      matcherInvoked: false,
    };
  }

  const matcher = await dependencies.evaluateMatcher({ eventId: identity.eventId, canonical });
  await dependencies.recordExecutionMetadata(identity, {
    phase: "production_wiring_completed",
    production_wiring_status: "completed",
    diagnostic_candidate_only: false,
    canonical_persistence_changed: promotion.status === "saved",
    canonical_persistence_status: promotion.status,
    canonical_source_execution_id: canonical.sourceExecutionId,
    canonical_reader_status: "available",
    offering_matcher_invoked: true,
    offering_matcher_version: matcher.version,
    offering_matcher_condition_set_count: 0,
    offering_matcher_evaluation_count: matcher.evaluations.length,
  });
  return {
    status: "completed",
    promotionStatus: promotion.status,
    matcherStatus: "invoked",
    matcherInvoked: true,
    canonicalSourceExecutionId: canonical.sourceExecutionId,
    matcher,
  };
}

function canonicalIneligibilityReason(
  identity: OfferingMonitorJobIdentity,
  canonical: OfferingMonitorCanonicalReadResult,
) {
  if (canonical.status !== "available") return canonical.reason;
  if (canonical.eventId !== identity.eventId) return "canonical_event_mismatch";
  if (canonical.rawItemId !== identity.rawItemId) return "canonical_raw_item_mismatch";
  if (canonical.parentPrimaryAiRunId !== identity.parentPrimaryAiRunId) return "canonical_parent_mismatch";
  if (canonical.sourceExecutionId !== identity.executionId) return "canonical_execution_mismatch";
  if (canonical.canonical.applicability !== "applicable") return "canonical_not_applicable";
  return "";
}

function emptyMatcherResult(eventId: string): OfferingMonitorEventMatchResult {
  return { version: OFFERING_MONITOR_MATCHER_VERSION, eventId, evaluations: [] };
}

async function readOfferingMonitorExecutionMetadata(identity: OfferingMonitorJobIdentity) {
  const { supabaseSelect } = await import("./supabase.ts");
  const result = await supabaseSelect("ai_runs", {
    select: "metadata",
    id: `eq.${identity.executionId}`,
    event_id: `eq.${identity.eventId}`,
    raw_item_id: `eq.${identity.rawItemId}`,
    prompt_key: "eq.offering_monitor_normalization_job",
    status: "eq.completed",
    limit: "1",
  });
  if (!result.ok) throw new Error(`Offering Monitor production metadata read failed: ${result.error || result.status}`);
  const row = Array.isArray(result.data) ? recordValue(result.data[0]) : null;
  if (!row) throw new Error("Offering Monitor production metadata lost exact execution authority");
  return recordValue(row.metadata) || {};
}

async function recordOfferingMonitorExecutionMetadata(
  identity: OfferingMonitorJobIdentity,
  metadata: Record<string, unknown>,
) {
  const current = await readOfferingMonitorExecutionMetadata(identity);
  const { supabaseUpdate } = await import("./supabase.ts");
  const result = await supabaseUpdate(
    "ai_runs",
    {
      id: `eq.${identity.executionId}`,
      event_id: `eq.${identity.eventId}`,
      raw_item_id: `eq.${identity.rawItemId}`,
      prompt_key: "eq.offering_monitor_normalization_job",
      status: "eq.completed",
    },
    { metadata: { ...current, ...metadata } },
  );
  if (!result.ok) throw new Error(`Offering Monitor production metadata update failed: ${result.error || result.status}`);
  if (!Array.isArray(result.data) || !result.data.length) {
    throw new Error("Offering Monitor production metadata update lost exact execution authority");
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
