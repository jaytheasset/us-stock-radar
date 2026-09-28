import type { ListingMonitorMatchResult } from "../listingMonitorMatcher.ts";
import type { ListingMonitor } from "./listingMonitorPersistence.ts";

export const FORM4_MONITOR_EVALUATION_RECORD_VERSION =
  "form4_monitor_evaluation_record_v1" as const;

export type Form4NotificationOutcome = Readonly<{
  status: "created" | "existing" | "not_created" | "failed";
  reasonCode:
    | "alert_created"
    | "duplicate_alert_existing"
    | "evaluation_not_match"
    | "matching_lineage_unavailable"
    | "alert_write_failed";
  alertId?: string;
  error?: string;
}>;

export type Form4MonitorEvaluationRecordInput = Readonly<{
  processingAttemptId: string;
  eventId: string;
  sourceExecutionId?: string;
  evaluatedAt: string;
  monitor: ListingMonitor;
  result: ListingMonitorMatchResult;
  notification: Form4NotificationOutcome;
}>;

export type Form4MonitorEvaluationRecordWriteResult =
  | Readonly<{ status: "recorded"; recordId?: string }>
  | Readonly<{ status: "failed"; error: string }>;

export async function recordForm4MonitorEvaluation(
  input: Form4MonitorEvaluationRecordInput,
): Promise<Form4MonitorEvaluationRecordWriteResult> {
  const trace = input.result.form4PurchaseTrace;
  if (!trace || !input.monitor.form4PurchaseSettings) {
    return { status: "failed", error: "Form 4 evaluation trace is unavailable" };
  }
  const { supabaseUpsert } = await import("../supabase.ts");
  const result = await supabaseUpsert("listing_monitor_evaluation_records", {
    processing_attempt_id: input.processingAttemptId,
    event_id: input.eventId,
    source_execution_id: input.sourceExecutionId ?? null,
    monitor_id: input.monitor.id,
    owner_user_id: input.monitor.userId,
    alert_id: input.notification.alertId ?? null,
    monitor_kind: input.monitor.kind,
    evaluated_at: input.evaluatedAt,
    evaluation_status: input.result.status,
    evaluation_reason_code: input.result.reasonCode,
    notification_status: input.notification.status,
    notification_reason_code: input.notification.reasonCode,
    notification_error: input.notification.status === "failed"
      ? input.notification.error || "Alert write failed"
      : null,
    monitor_snapshot: {
      id: input.monitor.id,
      userId: input.monitor.userId,
      kind: input.monitor.kind,
      isActive: input.monitor.isActive,
      createdAt: input.monitor.createdAt,
      settings: input.monitor.form4PurchaseSettings,
      conditions: input.monitor.conditions,
    },
    filing_snapshot: trace.filing,
    evaluation_snapshot: {
      version: FORM4_MONITOR_EVALUATION_RECORD_VERSION,
      effectiveStatus: input.result.status,
      effectiveReasonCode: input.result.reasonCode,
      conditions: input.result.conditions,
      evidence: input.result.form4PurchaseEvidence ?? null,
      trace,
    },
  }, { prefer: "return=representation" });
  if (!result.ok) {
    return { status: "failed", error: result.error || `HTTP ${result.status}` };
  }
  const row = Array.isArray(result.data)
    ? result.data[0] as Record<string, unknown> | undefined
    : undefined;
  return {
    status: "recorded",
    ...(typeof row?.id === "string" ? { recordId: row.id } : {}),
  };
}
