import { createHash } from "node:crypto";
import {
  readMonitorRoutingResult,
  type MonitorRoutingResult,
  type SupportedMonitorAnalyzerKey,
} from "./monitorRouting.ts";
import { LISTING_RISK_ANALYZER_PROMPT_VERSION } from "./listingRiskAnalyzer.ts";

export const GENERIC_MONITOR_CHILD_SCHEMA_VERSION = "generic_monitor_child_execution_v1";
export const GENERIC_MONITOR_CHILD_PURPOSE = "domain_monitor_child";
export const GENERIC_MONITOR_CHILD_PROMPT_KEY = "domain_monitor_child";
export const GENERIC_MONITOR_CHILD_OUTPUT_TYPE = "domain_monitor_child_execution_result";
export const GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION = "generic_monitor_child_execution_result_v1";
export const GENERIC_MONITOR_AUTOMATIC_ATTEMPT_KEY = "automatic";

export const GENERIC_MONITOR_ANALYZER_CONTRACTS = {
  listing_risk: LISTING_RISK_ANALYZER_PROMPT_VERSION,
} as const satisfies Record<SupportedMonitorAnalyzerKey, string>;

export const GENERIC_MONITOR_PRIMARY_PROMPT_KEYS = {
  news: ["news_event_analysis"],
  nasdaq_corporate_actions: ["nasdaq_corporate_action_analysis"],
  sec_8k_6k: [
    "sec_8k_6k_analysis_listing_financial_risk",
    "sec_8k_6k_analysis_financing_dilution_capital_structure",
    "sec_8k_6k_analysis_strategic_transaction",
    "sec_8k_6k_analysis_governance_vote_leadership",
    "sec_8k_6k_analysis_operating_legal_routine",
  ],
} as const;

export type GenericMonitorSourceFamily = keyof typeof GENERIC_MONITOR_PRIMARY_PROMPT_KEYS;

export type GenericMonitorPrimaryExecutionContext = {
  eventId: string;
  rawItemId: string;
  sourceFamily: GenericMonitorSourceFamily;
  sourceGroup: "news" | "filings";
  sourceCode: string;
  sourceIdentity: string;
  parentPrimaryAiRunId: string;
  parentPromptKey: string;
  parentPromptVersion: string;
};

export type GenericMonitorChildAttempt =
  | { kind: "automatic"; key: typeof GENERIC_MONITOR_AUTOMATIC_ATTEMPT_KEY }
  | { kind: "retry"; key: string };

export type GenericMonitorChildIdentity = GenericMonitorPrimaryExecutionContext & {
  schemaVersion: typeof GENERIC_MONITOR_CHILD_SCHEMA_VERSION;
  purpose: typeof GENERIC_MONITOR_CHILD_PURPOSE;
  jobId: string;
  logicalJobId: string;
  executionId: string;
  monitorAnalyzerKey: SupportedMonitorAnalyzerKey;
  analyzerContractVersion: string;
  attempt: GenericMonitorChildAttempt;
  reservedAt: string;
};

export type GenericMonitorChildExecutionState =
  | "reserved"
  | "running"
  | "succeeded_applicable"
  | "succeeded_not_applicable"
  | "failed"
  | "stale";

export type GenericMonitorChildTerminalState = Exclude<
  GenericMonitorChildExecutionState,
  "reserved" | "running"
>;

export type GenericMonitorParentCurrentness =
  | { status: "current"; latestPrimaryAiRunId: string }
  | { status: "stale"; latestPrimaryAiRunId: string }
  | { status: "missing"; latestPrimaryAiRunId: null };

export type GenericMonitorChildReservationRepository = {
  reserve(identity: GenericMonitorChildIdentity): Promise<{ reserved: boolean; jobId: string }>;
};

export function buildGenericMonitorChildIdentities(input: {
  primary: GenericMonitorPrimaryExecutionContext;
  monitorRouting: unknown;
  analyzerContractVersions?: Partial<Record<SupportedMonitorAnalyzerKey, string>>;
  attempt?: GenericMonitorChildAttempt;
  now?: string;
}): GenericMonitorChildIdentity[] {
  const routing = readMonitorRoutingResult(input.monitorRouting);
  if (!routing) throw new Error("Generic Monitor child routing must be validated before reservation");
  if (routing.monitor_routes.length === 0) return [];

  const primary = normalizePrimaryContext(input.primary);
  if (!isAuthorizedGenericMonitorPrimary(primary)) {
    throw new Error("Generic Monitor child source family is not mechanically authorized");
  }

  const attempt = normalizeAttempt(input.attempt);
  const reservedAt = normalizeTimestamp(input.now);
  return routing.monitor_routes.map((route) => {
    const analyzerContractVersion = normalizeIdentityText(
      input.analyzerContractVersions?.[route.monitor_analyzer_key]
        || GENERIC_MONITOR_ANALYZER_CONTRACTS[route.monitor_analyzer_key],
      "analyzer contract version",
    );
    const logicalJobId = deterministicGenericMonitorLogicalJobId({
      ...primary,
      monitorAnalyzerKey: route.monitor_analyzer_key,
      analyzerContractVersion,
    });
    const executionId = deterministicGenericMonitorExecutionId({ logicalJobId, attempt });
    return {
      schemaVersion: GENERIC_MONITOR_CHILD_SCHEMA_VERSION,
      purpose: GENERIC_MONITOR_CHILD_PURPOSE,
      jobId: executionId,
      logicalJobId,
      executionId,
      ...primary,
      monitorAnalyzerKey: route.monitor_analyzer_key,
      analyzerContractVersion,
      attempt,
      reservedAt,
    };
  });
}

export async function reserveGenericMonitorChildren(input: {
  primary: GenericMonitorPrimaryExecutionContext;
  monitorRouting: MonitorRoutingResult | unknown;
  analyzerContractVersions?: Partial<Record<SupportedMonitorAnalyzerKey, string>>;
  attempt?: GenericMonitorChildAttempt;
  now?: string;
}, repository: GenericMonitorChildReservationRepository) {
  const identities = buildGenericMonitorChildIdentities(input);
  return Promise.all(identities.map((identity) => repository.reserve(identity)));
}

export function deterministicGenericMonitorLogicalJobId(input: GenericMonitorPrimaryExecutionContext & {
  monitorAnalyzerKey: SupportedMonitorAnalyzerKey;
  analyzerContractVersion: string;
}) {
  return deterministicUuid([
    GENERIC_MONITOR_CHILD_PURPOSE,
    "logical",
    input.eventId,
    input.rawItemId,
    input.sourceFamily,
    input.sourceGroup,
    input.sourceCode,
    input.sourceIdentity,
    input.parentPrimaryAiRunId,
    input.parentPromptKey,
    input.parentPromptVersion,
    input.monitorAnalyzerKey,
    input.analyzerContractVersion,
  ]);
}

export function deterministicGenericMonitorExecutionId(input: {
  logicalJobId: string;
  attempt: GenericMonitorChildAttempt;
}) {
  const logicalJobId = normalizeUuid(input.logicalJobId, "logical job id");
  const attempt = normalizeAttempt(input.attempt);
  return deterministicUuid([
    GENERIC_MONITOR_CHILD_PURPOSE,
    "execution",
    logicalJobId,
    attempt.kind,
    attempt.key,
  ]);
}

export function deterministicGenericMonitorOutputId(executionId: string) {
  return deterministicUuid([
    GENERIC_MONITOR_CHILD_PURPOSE,
    "terminal-output",
    normalizeUuid(executionId, "execution id"),
  ]);
}

export function isAuthorizedGenericMonitorPrimary(primary: GenericMonitorPrimaryExecutionContext) {
  const promptKeys = GENERIC_MONITOR_PRIMARY_PROMPT_KEYS[primary.sourceFamily];
  if (!(promptKeys as readonly string[]).includes(primary.parentPromptKey)) return false;

  if (primary.sourceFamily === "news") {
    return primary.sourceGroup === "news" && primary.sourceCode !== "nasdaq_corporate_actions";
  }
  if (primary.sourceFamily === "nasdaq_corporate_actions") {
    return primary.sourceGroup === "news" && primary.sourceCode === "nasdaq_corporate_actions";
  }
  return primary.sourceGroup === "filings" && primary.sourceCode === "sec_edgar";
}

export function databaseStatusForGenericMonitorState(state: GenericMonitorChildExecutionState) {
  if (state === "reserved") return "pending";
  if (state === "running") return "running";
  if (state === "failed") return "failed";
  if (state === "stale") return "stale";
  return "completed";
}

function normalizePrimaryContext(
  primary: GenericMonitorPrimaryExecutionContext,
): GenericMonitorPrimaryExecutionContext {
  return {
    ...primary,
    eventId: normalizeUuid(primary.eventId, "event id"),
    rawItemId: normalizeUuid(primary.rawItemId, "raw item id"),
    sourceCode: normalizeIdentityText(primary.sourceCode, "source code"),
    sourceIdentity: normalizeIdentityText(primary.sourceIdentity, "source identity"),
    parentPrimaryAiRunId: normalizeUuid(primary.parentPrimaryAiRunId, "parent Primary ai run id"),
    parentPromptKey: normalizeIdentityText(primary.parentPromptKey, "parent prompt key"),
    parentPromptVersion: normalizeIdentityText(primary.parentPromptVersion, "parent prompt version"),
  };
}

function normalizeAttempt(value: GenericMonitorChildAttempt | undefined): GenericMonitorChildAttempt {
  const attempt = value || { kind: "automatic", key: GENERIC_MONITOR_AUTOMATIC_ATTEMPT_KEY };
  if (attempt.kind === "automatic") {
    if (attempt.key !== GENERIC_MONITOR_AUTOMATIC_ATTEMPT_KEY) {
      throw new Error("Automatic Generic Monitor child attempt key must be automatic");
    }
    return attempt;
  }
  if (attempt.kind !== "retry" || !/^[A-Za-z0-9._:-]{1,80}$/.test(attempt.key)) {
    throw new Error("Generic Monitor child retry attempt is invalid");
  }
  return attempt;
}

function normalizeTimestamp(value: string | undefined) {
  const timestamp = value || new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Generic Monitor child reservation time is invalid");
  return timestamp;
}

function normalizeUuid(value: string, label: string) {
  const normalized = normalizeIdentityText(value, label).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`Generic Monitor child ${label} must be a UUID`);
  }
  return normalized;
}

function normalizeIdentityText(value: string, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 240) {
    throw new Error(`Generic Monitor child ${label} is invalid`);
  }
  return normalized;
}

function deterministicUuid(parts: readonly string[]) {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
