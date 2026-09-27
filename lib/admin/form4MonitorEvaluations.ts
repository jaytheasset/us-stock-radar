import "server-only";

import { supabaseSelect } from "@/lib/supabase";

type JsonObject = Record<string, unknown>;

export type Form4MonitorEvaluationAdminRecord = Readonly<{
  id: string;
  processingAttemptId: string;
  eventId: string;
  sourceExecutionId: string | null;
  monitorId: string;
  ownerUserId: string;
  alertId: string | null;
  evaluatedAt: string;
  evaluationStatus: string;
  evaluationReasonCode: string;
  notificationStatus: string;
  notificationReasonCode: string;
  notificationError: string | null;
  monitorSnapshot: JsonObject;
  filingSnapshot: JsonObject;
  evaluationSnapshot: JsonObject;
  linkedAlert: JsonObject | null;
}>;

export async function listForm4MonitorEvaluationAdminRecords(
  limit = 100,
): Promise<Form4MonitorEvaluationAdminRecord[]> {
  const result = await supabaseSelect("listing_monitor_evaluation_records", {
    select: "id,processing_attempt_id,event_id,source_execution_id,monitor_id,owner_user_id,alert_id,evaluated_at,evaluation_status,evaluation_reason_code,notification_status,notification_reason_code,notification_error,monitor_snapshot,filing_snapshot,evaluation_snapshot",
    monitor_kind: "eq.form4_insider_purchase",
    order: "evaluated_at.desc,created_at.desc",
    limit: String(Math.max(1, Math.min(limit, 250))),
  });
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(result.error || "Form 4 evaluation history read failed");
  }
  const records = result.data.flatMap(mapRecord);
  const alertIds = [...new Set(records.map((record) => record.alertId).filter(Boolean))] as string[];
  if (!alertIds.length) return records;
  const alerts = await supabaseSelect("user_alert_deliveries", {
    select: "id,user_id,alert_event_id,listing_monitor_id,title,ticker,category,source_label,delivery_status,created_at,listing_match_evidence",
    id: `in.(${alertIds.join(",")})`,
    limit: String(alertIds.length),
  });
  const byId = new Map(
    alerts.ok && Array.isArray(alerts.data)
      ? alerts.data.flatMap((row) => objectValue(row) ? [[stringValue(objectValue(row).id), objectValue(row)] as const] : [])
      : [],
  );
  return records.map((record) => ({
    ...record,
    linkedAlert: record.alertId ? byId.get(record.alertId) ?? null : null,
  }));
}

function mapRecord(value: unknown): Form4MonitorEvaluationAdminRecord[] {
  const row = objectValue(value);
  const id = stringValue(row.id);
  if (!id) return [];
  return [{
    id,
    processingAttemptId: stringValue(row.processing_attempt_id),
    eventId: stringValue(row.event_id),
    sourceExecutionId: nullableString(row.source_execution_id),
    monitorId: stringValue(row.monitor_id),
    ownerUserId: stringValue(row.owner_user_id),
    alertId: nullableString(row.alert_id),
    evaluatedAt: stringValue(row.evaluated_at),
    evaluationStatus: stringValue(row.evaluation_status),
    evaluationReasonCode: stringValue(row.evaluation_reason_code),
    notificationStatus: stringValue(row.notification_status),
    notificationReasonCode: stringValue(row.notification_reason_code),
    notificationError: nullableString(row.notification_error),
    monitorSnapshot: objectValue(row.monitor_snapshot),
    filingSnapshot: objectValue(row.filing_snapshot),
    evaluationSnapshot: objectValue(row.evaluation_snapshot),
    linkedAlert: null,
  }];
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}
