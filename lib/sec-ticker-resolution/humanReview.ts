import "server-only";

import { createHash } from "node:crypto";
import { AdminApiError } from "@/lib/admin/errors";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  readSecTickerResolutionByDecisionId,
  type SecTickerResolutionReadResult,
  type SecTickerResolutionRepository,
} from "./persistence";

type Row = Record<string, unknown>;
type RepositoryResult = Readonly<{
  ok: boolean;
  status: number;
  data: unknown;
  count?: number | null;
  error?: string;
}>;

export const SEC_TICKER_HUMAN_ACTIONS = [
  "reviewed",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type SecTickerHumanAction = (typeof SEC_TICKER_HUMAN_ACTIONS)[number];

export type SecTickerHumanDecision = Readonly<{
  id: string;
  automaticDecisionId: string;
  automaticDecisionSha256: string;
  scopeKey: string;
  revision: number;
  action: SecTickerHumanAction;
  actorUserId: string;
  actorRole: string;
  reason: string;
  automaticSnapshot: Row;
  evidenceReferences: Row;
  previousHumanDecisionId: string | null;
  withdrawsHumanDecisionId: string | null;
  resultingEffectiveAction: "approved" | "rejected" | null;
  resultingEffectiveHumanDecisionId: string | null;
  requestId: string;
  auditLogId: string;
  createdAt: string;
}>;

export type SecTickerHumanReviewRepository = SecTickerResolutionRepository &
  Readonly<{
    rpc(functionName: string, payload: Row): Promise<RepositoryResult>;
    select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
  }>;

export type SecTickerEffectiveReadResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>
  | Readonly<{
      status: "available";
      selectedAutomaticDecisionId: string;
      currentAutomaticDecisionId: string;
      scopeKey: string;
      automatic:
        | Readonly<{
            status: "available";
            result: Extract<SecTickerResolutionReadResult, { status: "available" }>;
          }>
        | Readonly<{ status: "unavailable"; reason: string }>;
      history: readonly SecTickerHumanDecision[];
      latestHumanDecision: SecTickerHumanDecision | null;
      effective: Readonly<{
        disposition: "automatic" | "approved" | "rejected" | "pending_review";
        relationship: Row | null;
        humanDecisionId: string | null;
        reviewed: boolean;
        reconsiderationRequired: boolean;
      }>;
      availableActions: readonly SecTickerHumanAction[];
      approvalBlockedReason: string | null;
    }>;

const HUMAN_HISTORY_LIMIT = 250;
const AUTOMATIC_SCOPE_LIMIT = 1000;
const APPROVABLE_REASONS = new Set(["EFFECTIVE_DATE_CONFLICT"]);

export async function readEffectiveSecTickerResolutionByDecisionId(input: {
  decisionId: string;
  repository?: SecTickerHumanReviewRepository;
}): Promise<SecTickerEffectiveReadResult> {
  if (!isUuid(input.decisionId)) {
    return { status: "unavailable", reason: "invalid_decision_id" };
  }
  const repository = input.repository ?? (await defaultRepository());
  const selectedRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "*",
    id: `eq.${input.decisionId}`,
    limit: "1",
  });
  if (!selectedRead.ok) {
    return { status: "unavailable", reason: "decision_read_failed" };
  }
  const selected = rows(selectedRead.data)[0];
  if (!selected) return { status: "not_found" };
  if (stringValue(selected.id) !== input.decisionId) {
    return { status: "unavailable", reason: "decision_id_mismatch" };
  }

  const scopeKey = humanScopeKey(selected);
  if (!scopeKey) {
    return { status: "unavailable", reason: "automatic_scope_invalid" };
  }
  const automaticRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "*",
    issuer_cik: `eq.${stringValue(selected.issuer_cik)}`,
    resolution_type: `eq.${stringValue(selected.resolution_type)}`,
    method_version: `eq.${stringValue(selected.method_version)}`,
    order: "created_at.desc,id.desc",
    limit: String(AUTOMATIC_SCOPE_LIMIT),
  });
  if (!automaticRead.ok) {
    return { status: "unavailable", reason: "automatic_scope_read_failed" };
  }
  const automaticRows = rows(automaticRead.data);
  if (automaticRows.length >= AUTOMATIC_SCOPE_LIMIT) {
    return { status: "unavailable", reason: "automatic_scope_truncated" };
  }
  const scopedAutomaticRows = automaticRows.filter(
    (candidate) => humanScopeKey(candidate) === scopeKey,
  );
  const currentAutomatic = scopedAutomaticRows[0];
  if (!currentAutomatic) {
    return { status: "unavailable", reason: "automatic_scope_missing" };
  }

  const historyRead = await repository.select(
    "sec_ticker_resolution_human_decisions",
    {
      select: "*",
      scope_key: `eq.${scopeKey}`,
      order: "revision.asc",
      limit: String(HUMAN_HISTORY_LIMIT),
    },
  );
  if (!historyRead.ok) {
    return { status: "unavailable", reason: "human_decision_read_failed" };
  }
  const historyRows = rows(historyRead.data);
  if (historyRows.length >= HUMAN_HISTORY_LIMIT) {
    return { status: "unavailable", reason: "human_decision_history_truncated" };
  }
  const parsedHistory = parseAndValidateHistory({
    automaticRows: scopedAutomaticRows,
    rows: historyRows,
    scopeKey,
  });
  if (!parsedHistory.ok) {
    return { status: "unavailable", reason: parsedHistory.reason };
  }
  const history = parsedHistory.history;
  const latestHumanDecision = history.at(-1) ?? null;
  const currentAutomaticId = stringValue(currentAutomatic.id);
  const validatedAutomatic = await readSecTickerResolutionByDecisionId({
    decisionId: currentAutomaticId,
    repository,
  });
  const automatic =
    validatedAutomatic.status === "available"
      ? ({ status: "available", result: validatedAutomatic } as const)
      : ({
          status: "unavailable",
          reason:
            validatedAutomatic.status === "unavailable"
              ? validatedAutomatic.reason
              : "current_automatic_not_found",
        } as const);
  const effectiveHuman = latestHumanDecision?.resultingEffectiveAction ?? null;
  const decisiveHuman = effectiveHuman
    ? history.find(
        (item) => item.id === latestHumanDecision?.resultingEffectiveHumanDecisionId,
      ) ?? null
    : null;
  const revisionChanged = Boolean(
    latestHumanDecision &&
      latestHumanDecision.automaticDecisionId !== currentAutomaticId,
  );
  const reviewed = history.some((item) => item.action === "reviewed");

  if (effectiveHuman === "rejected" && decisiveHuman) {
    const actions =
      automatic.status === "available"
        ? [...availableActionsForAutomatic(automatic.result), "withdrawn" as const]
        : [];
    return {
      status: "available",
      selectedAutomaticDecisionId: input.decisionId,
      currentAutomaticDecisionId: currentAutomaticId,
      scopeKey,
      automatic,
      history,
      latestHumanDecision,
      effective: {
        disposition: "rejected",
        relationship: null,
        humanDecisionId: decisiveHuman.id,
        reviewed,
        reconsiderationRequired: revisionChanged || automatic.status === "unavailable",
      },
      availableActions: [...new Set(actions)],
      approvalBlockedReason: approvalBlockReason(
        automatic.status === "available" ? automatic.result : null,
      ),
    };
  }

  if (automatic.status === "unavailable") {
    return {
      status: "available",
      selectedAutomaticDecisionId: input.decisionId,
      currentAutomaticDecisionId: currentAutomaticId,
      scopeKey,
      automatic,
      history,
      latestHumanDecision,
      effective: {
        disposition: "pending_review",
        relationship: null,
        humanDecisionId: decisiveHuman?.id ?? null,
        reviewed,
        reconsiderationRequired: true,
      },
      availableActions: [],
      approvalBlockedReason:
        "Automatic source validation is unavailable. History remains visible, but no action or relationship is enabled.",
    };
  }

  const approvalBlock = approvalBlockReason(automatic.result);
  if (revisionChanged) {
    const actions = availableActionsForAutomatic(automatic.result);
    if (effectiveHuman) actions.push("withdrawn");
    return {
      status: "available",
      selectedAutomaticDecisionId: input.decisionId,
      currentAutomaticDecisionId: currentAutomaticId,
      scopeKey,
      automatic,
      history,
      latestHumanDecision,
      effective: {
        disposition: "pending_review",
        relationship: null,
        humanDecisionId: decisiveHuman?.id ?? null,
        reviewed,
        reconsiderationRequired: true,
      },
      availableActions: [...new Set(actions)],
      approvalBlockedReason: approvalBlock,
    };
  }
  if (effectiveHuman === "approved" && decisiveHuman) {
    if (
      decisiveHuman.automaticDecisionId !== currentAutomaticId ||
      approvalBlock
    ) {
      return {
        status: "unavailable",
        reason: "human_approval_revision_conflict_requires_reconsideration",
      };
    }
    return {
      status: "available",
      selectedAutomaticDecisionId: input.decisionId,
      currentAutomaticDecisionId: currentAutomaticId,
      scopeKey,
      automatic,
      history,
      latestHumanDecision,
      effective: {
        disposition: "approved",
        relationship: relationshipFrom(automatic.result),
        humanDecisionId: decisiveHuman.id,
        reviewed,
        reconsiderationRequired: false,
      },
      availableActions: ["approved", "rejected", "withdrawn"],
      approvalBlockedReason: null,
    };
  }

  const automaticState = stringValue(automatic.result.decision.resolution_state);
  const disposition = automaticState === "AUTO" ? "automatic" : "pending_review";
  const actions = availableActionsForAutomatic(automatic.result);
  return {
    status: "available",
    selectedAutomaticDecisionId: input.decisionId,
    currentAutomaticDecisionId: currentAutomaticId,
    scopeKey,
    automatic,
    history,
    latestHumanDecision,
    effective: {
      disposition,
      relationship:
        disposition === "automatic" ? relationshipFrom(automatic.result) : null,
      humanDecisionId: null,
      reviewed,
      reconsiderationRequired: false,
    },
    availableActions: actions,
    approvalBlockedReason: approvalBlock,
  };
}

function availableActionsForAutomatic(
  automatic: Extract<SecTickerResolutionReadResult, { status: "available" }>,
) {
  const actions: SecTickerHumanAction[] = ["rejected"];
  if (stringValue(automatic.decision.resolution_state) === "AUTO") {
    actions.unshift("reviewed");
  }
  if (!approvalBlockReason(automatic)) actions.unshift("approved");
  return actions;
}

export async function applySecTickerResolutionHumanDecision(input: {
  actorUserId: string;
  automaticDecisionId: string;
  expectedAutomaticSha256: string;
  expectedRevision: number;
  action: unknown;
  reason: unknown;
  requestId: string;
  repository?: SecTickerHumanReviewRepository;
}) {
  const repository = input.repository ?? (await defaultRepository());
  const action = normalizeAction(input.action);
  const reason = stringValue(input.reason);
  if (!action) {
    throw new AdminApiError(
      "ADMIN_TICKER_ACTION_INVALID",
      "Choose a supported ticker-resolution review action.",
      400,
    );
  }
  if (reason.length < 4 || reason.length > 2000) {
    throw new AdminApiError(
      "ADMIN_TICKER_REASON_REQUIRED",
      "Enter a review reason between 4 and 2,000 characters.",
      400,
    );
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AdminApiError(
      "ADMIN_TICKER_EXPECTED_REVISION_REQUIRED",
      "Refresh the review before saving another decision.",
      409,
    );
  }
  if (!isUuid(input.actorUserId) || !isUuid(input.automaticDecisionId)) {
    throw new AdminApiError(
      "ADMIN_TICKER_AUTOMATIC_NOT_FOUND",
      "The automatic decision is unavailable.",
      404,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedAutomaticSha256)) {
    throw new AdminApiError(
      "ADMIN_TICKER_AUTOMATIC_REVISION_REQUIRED",
      "Refresh the review before saving another decision.",
      409,
    );
  }
  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > 240) {
    throw new AdminApiError(
      "ADMIN_TICKER_REQUEST_ID_REQUIRED",
      "A valid request identity is required.",
      400,
    );
  }

  // A known request key goes straight back to the database so an uncertain retry
  // can replay after the original write advanced the revision. New requests still
  // pass the complete product reader before the atomic database checks and write.
  const replayRead = await repository.select(
    "sec_ticker_resolution_human_decisions",
    {
      select: "id",
      request_id: `eq.${requestId}`,
      limit: "1",
    },
  );
  if (!replayRead.ok) {
    throw new AdminApiError(
      "ADMIN_TICKER_REVIEW_UNAVAILABLE",
      "The human review request history could not be validated.",
      503,
    );
  }
  if (rows(replayRead.data).length === 0) {
    const current = await readEffectiveSecTickerResolutionByDecisionId({
      decisionId: input.automaticDecisionId,
      repository,
    });
    if (current.status !== "available") {
      throw new AdminApiError(
        "ADMIN_TICKER_REVIEW_UNAVAILABLE",
        "The automatic decision or human review history could not be validated.",
        409,
      );
    }
    if (
      current.currentAutomaticDecisionId !== input.automaticDecisionId ||
      current.automatic.status !== "available" ||
      stringValue(current.automatic.result.decision.decision_sha256) !==
        input.expectedAutomaticSha256
    ) {
      throw new AdminApiError(
        "ADMIN_TICKER_AUTOMATIC_REVISION_CONFLICT",
        "The automatic evidence changed. Refresh and reconsider the decision.",
        409,
      );
    }
    if (!current.availableActions.includes(action)) {
      const code =
        action === "approved"
          ? "ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT"
          : action === "withdrawn"
            ? "ADMIN_TICKER_WITHDRAWAL_UNAVAILABLE"
            : "ADMIN_TICKER_ACTION_UNAVAILABLE";
      throw new AdminApiError(code, actionUnavailableMessage(code), 409);
    }
    if ((current.latestHumanDecision?.revision ?? 0) !== input.expectedRevision) {
      throw new AdminApiError(
        "ADMIN_TICKER_HUMAN_REVISION_CONFLICT",
        "Another administrator saved a decision. Refresh before trying again.",
        409,
      );
    }
  }

  const write = await repository.rpc(
    "admin_apply_sec_ticker_resolution_human_decision",
    {
      p_action: action,
      p_actor_user_id: input.actorUserId,
      p_automatic_decision_id: input.automaticDecisionId,
      p_expected_automatic_sha256: input.expectedAutomaticSha256,
      p_expected_revision: input.expectedRevision,
      p_reason: reason,
      p_request_id: requestId,
    },
  );
  if (!write.ok) {
    throw normalizeWriteError(write.error);
  }
  const response = record(write.data);
  if (
    !new Set(["inserted", "replayed"]).has(stringValue(response.status)) ||
    stringValue(response.automaticDecisionId) !== input.automaticDecisionId ||
    normalizeAction(response.action) !== action ||
    !isUuid(stringValue(response.humanDecisionId)) ||
    !isUuid(stringValue(response.auditLogId))
  ) {
    throw new AdminApiError(
      "ADMIN_TICKER_WRITE_RESPONSE_INVALID",
      "The review was not confirmed by the database.",
      503,
    );
  }
  return response;
}

function parseAndValidateHistory(input: {
  rows: Row[];
  automaticRows: Row[];
  scopeKey: string;
}):
  | { ok: true; history: SecTickerHumanDecision[] }
  | { ok: false; reason: string } {
  const automaticById = new Map(
    input.automaticRows.map((row) => [stringValue(row.id), row] as const),
  );
  const history: SecTickerHumanDecision[] = [];
  let prior: SecTickerHumanDecision | null = null;
  for (const row of input.rows) {
    const parsed = parseHumanDecision(row);
    if (!parsed || parsed.scopeKey !== input.scopeKey) {
      return { ok: false, reason: "human_decision_chain_invalid" };
    }
    if (
      parsed.revision !== history.length + 1 ||
      parsed.previousHumanDecisionId !== prior?.id &&
        !(parsed.revision === 1 && parsed.previousHumanDecisionId === null)
    ) {
      return { ok: false, reason: "human_decision_chain_invalid" };
    }
    const automatic = automaticById.get(parsed.automaticDecisionId);
    const snapshot = parsed.automaticSnapshot;
    if (
      !automatic ||
      parsed.automaticDecisionSha256 !== stringValue(automatic.decision_sha256) ||
      stringValue(snapshot.id) !== parsed.automaticDecisionId ||
      stringValue(snapshot.decisionSha256) !== parsed.automaticDecisionSha256 ||
      stableStringify(record(snapshot.decisionPayload)) !==
        stableStringify(record(automatic.decision_payload)) ||
      stableStringify(record(row.scope_payload)) !==
        stableStringify(humanScopePayload(automatic))
    ) {
      return { ok: false, reason: "human_decision_snapshot_invalid" };
    }
    if (parsed.action === "reviewed") {
      if (
        parsed.resultingEffectiveAction !==
          (prior?.resultingEffectiveAction ?? null) ||
        parsed.resultingEffectiveHumanDecisionId !==
          (prior?.resultingEffectiveHumanDecisionId ?? null)
      ) {
        return { ok: false, reason: "human_decision_chain_invalid" };
      }
    } else if (parsed.action === "withdrawn") {
      if (
        !prior?.resultingEffectiveHumanDecisionId ||
        parsed.withdrawsHumanDecisionId !==
          prior.resultingEffectiveHumanDecisionId ||
        parsed.resultingEffectiveAction !== null ||
        parsed.resultingEffectiveHumanDecisionId !== null
      ) {
        return { ok: false, reason: "human_decision_chain_invalid" };
      }
    } else if (
      parsed.resultingEffectiveAction !== parsed.action ||
      parsed.resultingEffectiveHumanDecisionId !== parsed.id
    ) {
      return { ok: false, reason: "human_decision_chain_invalid" };
    }
    history.push(parsed);
    prior = parsed;
  }
  return { ok: true, history };
}

function parseHumanDecision(row: Row): SecTickerHumanDecision | null {
  const action = normalizeAction(row.action);
  const resulting = stringValue(row.resulting_effective_action);
  const revision = numberValue(row.revision);
  if (
    !isUuid(stringValue(row.id)) ||
    !isUuid(stringValue(row.automatic_decision_id)) ||
    !/^[0-9a-f]{64}$/.test(stringValue(row.automatic_decision_sha256)) ||
    !/^[0-9a-f]{64}$/.test(stringValue(row.scope_key)) ||
    !action ||
    revision < 1 ||
    !isUuid(stringValue(row.actor_user_id)) ||
    !new Set(["super_admin", "operations"]).has(stringValue(row.actor_role)) ||
    stringValue(row.reason).length < 4 ||
    !isUuid(stringValue(row.audit_log_id))
  ) {
    return null;
  }
  if (resulting && resulting !== "approved" && resulting !== "rejected") {
    return null;
  }
  return {
    id: stringValue(row.id),
    automaticDecisionId: stringValue(row.automatic_decision_id),
    automaticDecisionSha256: stringValue(row.automatic_decision_sha256),
    scopeKey: stringValue(row.scope_key),
    revision,
    action,
    actorUserId: stringValue(row.actor_user_id),
    actorRole: stringValue(row.actor_role),
    reason: stringValuePreserve(row.reason),
    automaticSnapshot: record(row.automatic_snapshot),
    evidenceReferences: record(row.evidence_references),
    previousHumanDecisionId: nullableString(row.previous_human_decision_id),
    withdrawsHumanDecisionId: nullableString(row.withdraws_human_decision_id),
    resultingEffectiveAction: resulting
      ? (resulting as "approved" | "rejected")
      : null,
    resultingEffectiveHumanDecisionId: nullableString(
      row.resulting_effective_human_decision_id,
    ),
    requestId: stringValue(row.request_id),
    auditLogId: stringValue(row.audit_log_id),
    createdAt: stringValue(row.created_at),
  };
}

function approvalBlockReason(
  automatic: Extract<SecTickerResolutionReadResult, { status: "available" }> | null,
) {
  if (!automatic) return "Automatic evidence is unavailable.";
  const state = stringValue(automatic.decision.resolution_state);
  if (state !== "REVIEW" && state !== "UNRESOLVED") {
    return "AUTO decisions can be reviewed or rejected, but do not need manual approval.";
  }
  if (!automatic.identity || !automatic.evidence) {
    return "Approval is blocked: no single source-bound security identity and ticker-change evidence candidate exists.";
  }
  const reasons = stringArray(automatic.decision.rule_reasons);
  if (
    reasons.length !== 1 ||
    reasons.some((reason) => !APPROVABLE_REASONS.has(reason))
  ) {
    return "Approval is blocked: the automatic conflict is not safely overridable from the persisted evidence.";
  }
  return null;
}

function relationshipFrom(
  automatic: Extract<SecTickerResolutionReadResult, { status: "available" }>,
) {
  return record(record(automatic.decision.decision_payload).relationship);
}

function humanScopePayload(decision: Row): Row {
  return {
    issuerCik: stringValue(decision.issuer_cik),
    resolutionType: stringValue(decision.resolution_type),
    beforeAccessionNumber: stringValue(decision.before_accession_number),
    afterAccessionNumber: stringValue(decision.after_accession_number),
  };
}

function humanScopeKey(decision: Row) {
  const scope = humanScopePayload(decision);
  const issuerCik = stringValue(scope.issuerCik);
  const resolutionType = stringValue(scope.resolutionType);
  const before = stringValue(scope.beforeAccessionNumber);
  const after = stringValue(scope.afterAccessionNumber);
  if (!issuerCik || !resolutionType || !before || !after) return null;
  return createHash("sha256")
    .update([issuerCik, resolutionType, before, after].join("\u001f"), "utf8")
    .digest("hex");
}

async function defaultRepository(): Promise<SecTickerHumanReviewRepository> {
  return { rpc: supabaseRpc, select: supabaseSelect };
}

function normalizeWriteError(error: unknown) {
  const message = stringValue(error);
  const known = [
    "ADMIN_PERMISSION_REQUIRED",
    "ADMIN_TICKER_ACTION_INVALID",
    "ADMIN_TICKER_ACTION_UNAVAILABLE",
    "ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT",
    "ADMIN_TICKER_AUTOMATIC_NOT_FOUND",
    "ADMIN_TICKER_AUTOMATIC_REVISION_CONFLICT",
    "ADMIN_TICKER_EXPECTED_REVISION_REQUIRED",
    "ADMIN_TICKER_HUMAN_REVISION_CONFLICT",
    "ADMIN_TICKER_IDEMPOTENCY_CONFLICT",
    "ADMIN_TICKER_REASON_REQUIRED",
    "ADMIN_TICKER_REQUEST_ID_REQUIRED",
    "ADMIN_TICKER_SOURCE_REVISION_CONFLICT",
    "ADMIN_TICKER_WITHDRAWAL_UNAVAILABLE",
  ].find((code) => message.includes(code));
  if (!known) {
    return new AdminApiError(
      "ADMIN_TICKER_WRITE_FAILED",
      "The decision and audit record were not saved.",
      503,
    );
  }
  const status = known === "ADMIN_PERMISSION_REQUIRED" ? 403 :
    known.endsWith("NOT_FOUND") ? 404 :
      known.includes("REVISION") || known.includes("CONFLICT") || known.includes("UNAVAILABLE") || known.includes("INSUFFICIENT")
        ? 409
        : 400;
  return new AdminApiError(known, actionUnavailableMessage(known), status);
}

function actionUnavailableMessage(code: string) {
  const messages: Record<string, string> = {
    ADMIN_PERMISSION_REQUIRED: "Your administrator role does not allow this action.",
    ADMIN_TICKER_ACTION_INVALID: "Choose a supported ticker-resolution review action.",
    ADMIN_TICKER_ACTION_UNAVAILABLE: "That action is not safe for this automatic state.",
    ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT:
      "Approval is blocked because the automatic decision has no eligible source-bound candidate.",
    ADMIN_TICKER_AUTOMATIC_NOT_FOUND: "The automatic decision is unavailable.",
    ADMIN_TICKER_AUTOMATIC_REVISION_CONFLICT:
      "The automatic evidence changed. Refresh and reconsider the decision.",
    ADMIN_TICKER_EXPECTED_REVISION_REQUIRED:
      "Refresh the review before saving another decision.",
    ADMIN_TICKER_HUMAN_REVISION_CONFLICT:
      "Another administrator saved a decision. Refresh before trying again.",
    ADMIN_TICKER_IDEMPOTENCY_CONFLICT:
      "That request identity was already used for different review data.",
    ADMIN_TICKER_REASON_REQUIRED:
      "Enter a review reason between 4 and 2,000 characters.",
    ADMIN_TICKER_REQUEST_ID_REQUIRED: "A valid request identity is required.",
    ADMIN_TICKER_SOURCE_REVISION_CONFLICT:
      "The source revision changed. Refresh and reconsider the decision.",
    ADMIN_TICKER_WITHDRAWAL_UNAVAILABLE:
      "There is no current approval or rejection to withdraw.",
  };
  return messages[code] || "The ticker-resolution review could not be saved.";
}

function normalizeAction(value: unknown): SecTickerHumanAction | null {
  const normalized = stringValue(value).toLowerCase();
  return SEC_TICKER_HUMAN_ACTIONS.includes(
    normalized as SecTickerHumanAction,
  )
    ? (normalized as SecTickerHumanAction)
    : null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuePreserve(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function numberValue(value: unknown) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : -1;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const row = value as Row;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(row[key])}`)
    .join(",")}}`;
}
