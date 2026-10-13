import { evaluateSc13Monitor, evaluateSc13FilingReporters, type Sc13MonitorMatchEvidence, type Sc13MonitorMatchReasonCode, type Sc13MonitorMatchStatus } from "../sc13MonitorMatcher.ts";
import { readSc13IssuerCurrentState, type Sc13IssuerCurrentStateRead } from "../sec-sc13-xml/currentState.ts";
import {
  listActiveSc13MonitorsForConsumer,
  type Sc13Monitor,
  type Sc13MonitorDiagnostic,
  type Sc13MonitorListResult,
} from "./sc13MonitorPersistence.ts";

export const SC13_MONITOR_ALERT_CONSUMER_VERSION = "sc13_monitor_alert_consumer_v1" as const;
export type Sc13MonitorAlertWriteResult =
  | Readonly<{ status: "created" | "existing"; monitorId: string; alertId?: string }>
  | Readonly<{ status: "failed"; monitorId: string; error: string }>;

export type Sc13MonitorAlertConsumerDependencies = Readonly<{
  readCurrentState(issuerCik: string): Promise<Sc13IssuerCurrentStateRead>;
  listActiveMonitors(issuerCik: string): Promise<Sc13MonitorListResult>;
  createAlert(input: Readonly<{ monitor: Sc13Monitor; evidence: Sc13MonitorMatchEvidence; createdAt: string }>): Promise<Sc13MonitorAlertWriteResult>;
  now(): Date;
}>;

export type Sc13MonitorAlertConsumerResult = Readonly<{
  version: typeof SC13_MONITOR_ALERT_CONSUMER_VERSION;
  status: "completed" | "partial_failure" | "failed";
  issuerCik: string;
  readerStatus: Sc13IssuerCurrentStateRead["status"];
  readerReason?: string;
  monitorCount: number;
  diagnostics: readonly Sc13MonitorDiagnostic[];
  evaluations: readonly Readonly<{ monitorId: string; status: Sc13MonitorMatchStatus; reasonCode: Sc13MonitorMatchReasonCode }>[];
  writes: readonly Sc13MonitorAlertWriteResult[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
}>;

const defaultDependencies: Sc13MonitorAlertConsumerDependencies = {
  readCurrentState: readSc13IssuerCurrentState,
  listActiveMonitors: listActiveSc13MonitorsForConsumer,
  createAlert: createSc13MonitorAlert,
  now: () => new Date(),
};

/** Deterministic service consumer entry. It never invokes site analysis, an LLM, or an external sender. */
export async function consumeSc13MonitorAlertsForIssuer(
  input: Readonly<{ issuerCik: string; preloadedState?: Sc13IssuerCurrentStateRead; filingSource?: { accessionNumber: string; sourceSha256: string } }>,
  dependencies: Sc13MonitorAlertConsumerDependencies = defaultDependencies,
): Promise<Sc13MonitorAlertConsumerResult> {
  const monitors = await dependencies.listActiveMonitors(input.issuerCik);
  let state: Sc13IssuerCurrentStateRead;
  try {
    state = input.preloadedState || await dependencies.readCurrentState(input.issuerCik);
  } catch {
    state = { status: "unavailable", issuerCik: null, historyComplete: false, reason: "reader_unavailable" };
  }
  const evaluations = monitors.monitors.flatMap((monitor) => (monitor.target.reportingPersonScope === "all"
    ? evaluateSc13FilingReporters(state, monitor, input.filingSource) : [evaluateSc13Monitor(state, monitor)]).map((result) => ({ monitor, result })));
  const writes: Sc13MonitorAlertWriteResult[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.result.status !== "match" || !evaluation.result.evidence) continue;
    try {
      writes.push(await dependencies.createAlert({ monitor: evaluation.monitor, evidence: evaluation.result.evidence, createdAt: dependencies.now().toISOString() }));
    } catch (error) {
      writes.push({ status: "failed", monitorId: evaluation.monitor.id, error: message(error) });
    }
  }
  const createdCount = writes.filter((write) => write.status === "created").length;
  const existingCount = writes.filter((write) => write.status === "existing").length;
  const failedCount = writes.filter((write) => write.status === "failed").length;
  return {
    version: SC13_MONITOR_ALERT_CONSUMER_VERSION,
    status: state.status === "unavailable" ? "failed" : failedCount ? "partial_failure" : "completed",
    issuerCik: input.issuerCik,
    readerStatus: state.status,
    ...(state.status === "unavailable" ? { readerReason: state.reason } : {}),
    monitorCount: monitors.monitors.length,
    diagnostics: monitors.diagnostics,
    evaluations: evaluations.map(({ monitor, result }) => ({ monitorId: monitor.id, status: result.status, reasonCode: result.reasonCode })),
    writes, createdCount, existingCount, failedCount,
  };
}

async function createSc13MonitorAlert(input: Readonly<{
  monitor: Sc13Monitor; evidence: Sc13MonitorMatchEvidence; createdAt: string;
}>): Promise<Sc13MonitorAlertWriteResult> {
  const { monitor, evidence } = input;
  const all = monitor.target.reportingPersonScope === "all";
  if (
    monitor.target.issuerCik !== evidence.issuerCik
    || (all ? evidence.reporterScope !== "all" : evidence.reporterScope === "all" || monitor.target.reportingPersonCik !== evidence.reportingPersonCik)
    || monitor.target.securityClass !== evidence.securityClass
    || !sameStrings(monitor.target.cusips, evidence.cusips)
    || evidence.conditions.length !== monitor.conditions.length
  ) return { status: "failed", monitorId: monitor.id, error: "SC13 Alert provenance identity mismatch" };
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: monitor.userId,
    alert_event_id: null,
    ticker: null,
    title: all ? "SC13 Monitor matched a reported filing value (not real-time ownership)" : "SC13 Monitor matched a latest saved filing value (not real-time ownership)",
    category: "insider_ownership",
    source_type: "other",
    source_label: "Schedule 13 Monitor",
    alert_lane: "sc13_monitor",
    severity: null,
    delivered_channels: [],
    delivery_status: "queued",
    delivered_at: input.createdAt,
    scheduled_for: null,
    sent_at: null,
    attempted_at: null,
    last_error: null,
    dedupe_key: null,
    sc13_monitor_id: monitor.id,
    alert_domain: "sc13",
    sc13_position_key: evidence.positionKey,
    sc13_root_accession: evidence.rootAccessionNumber,
    sc13_head_accession: evidence.headAccessionNumber,
    sc13_reporter_cik: evidence.reportingPersonCik,
    ...(evidence.reporterScope === "all" ? { sc13_reporter_index: evidence.reportingPersonIndex } : {}),
    sc13_security_class: evidence.securityClass,
    sc13_cusips: evidence.cusips,
    sc13_match_evidence: evidence,
  }, {
    onConflict: all ? "sc13_monitor_id,sc13_head_accession,sc13_reporter_index" : "sc13_monitor_id,sc13_root_accession,sc13_position_key,sc13_reporter_cik",
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  if (!result.ok) return { status: "failed", monitorId: monitor.id, error: result.error || `HTTP ${result.status}` };
  const row = Array.isArray(result.data) && record(result.data[0]) ? result.data[0] : undefined;
  return row ? { status: "created", monitorId: monitor.id, alertId: text(row.id) || undefined } : { status: "existing", monitorId: monitor.id };
}

export type Sc13MonitorAlertItem = Readonly<{
  id: string;
  monitorId: string;
  rootAccessionNumber: string | null;
  headAccessionNumber: string;
  reportingPersonCik: string | null;
  reportingPersonIndex?: number;
  securityClass: string;
  cusips: readonly string[];
  evidence: Sc13MonitorMatchEvidence;
  createdAt: string;
}>;
export type Sc13MonitorAlertReadRepository = Readonly<{
  list(input: Readonly<{ ownerId: string; monitorId?: string }>): Promise<Readonly<{ ok: boolean; status?: number; data: unknown; error?: string }>>;
}>;

export async function listSc13MonitorAlertsForOwner(
  input: Readonly<{ ownerId: string; monitorId?: string }>,
  repository?: Sc13MonitorAlertReadRepository,
): Promise<readonly Sc13MonitorAlertItem[]> {
  const ownerId = requireUuid(input.ownerId), monitorId = input.monitorId ? requireUuid(input.monitorId) : undefined;
  const resolved = repository || await resolveAlertRepository();
  const result = await resolved.list({ ownerId, ...(monitorId ? { monitorId } : {}) });
  if (!result.ok) throw new Error(result.error || `HTTP ${result.status || 0}`);
  return (Array.isArray(result.data) ? result.data.filter(record) : []).flatMap((row) => {
    const id = text(row.id), rowMonitorId = text(row.sc13_monitor_id), root = text(row.sc13_root_accession);
    const head = text(row.sc13_head_accession), reporter = text(row.sc13_reporter_cik), securityClass = text(row.sc13_security_class);
    const cusips = stringArray(row.sc13_cusips), createdAt = text(row.created_at), evidence = parseEvidence(row.sc13_match_evidence);
    const all = evidence?.reporterScope === "all";
    const validIdentity = all ? row.sc13_root_accession === null && (row.sc13_reporter_cik === null || /^\d{10}$/.test(reporter))
      && Number.isInteger(row.sc13_reporter_index) && Number(row.sc13_reporter_index) >= 0 && row.sc13_reporter_index === evidence.reportingPersonIndex
      : ACCESSION_PATTERN.test(root) && /^\d{10}$/.test(reporter) && row.sc13_reporter_index == null;
    return UUID_PATTERN.test(id) && UUID_PATTERN.test(rowMonitorId) && validIdentity && ACCESSION_PATTERN.test(head)
      && securityClass.length > 0 && cusips.length > 0 && evidence && Number.isFinite(Date.parse(createdAt))
      ? [{ id, monitorId: rowMonitorId, rootAccessionNumber: all ? null : root, headAccessionNumber: head, reportingPersonCik: row.sc13_reporter_cik === null ? null : reporter,
        ...(all ? { reportingPersonIndex: Number(row.sc13_reporter_index) } : {}), securityClass, cusips, evidence, createdAt }]
      : [];
  });
}

async function resolveAlertRepository(): Promise<Sc13MonitorAlertReadRepository> {
  const supabase = await import("../supabase.ts");
  return { list: ({ ownerId, monitorId }) => supabase.supabaseSelect("user_alert_deliveries", {
    select: "id,sc13_monitor_id,sc13_root_accession,sc13_head_accession,sc13_reporter_cik,sc13_reporter_index,sc13_security_class,sc13_cusips,sc13_match_evidence,created_at",
    user_id: `eq.${ownerId}`, alert_domain: "eq.sc13", alert_lane: "eq.sc13_monitor",
    ...(monitorId ? { sc13_monitor_id: `eq.${monitorId}` } : {}), order: "delivered_at.desc,id.desc", limit: "100",
  }) };
}

function parseEvidence(value: unknown): Sc13MonitorMatchEvidence | null {
  if (!record(value)) return null;
  if (value.reporterScope === "all" ? value.scope !== "single_stored_filing" || value.meaning !== "reported_filing_value_not_realtime_ownership"
    : value.scope !== "complete_stored_history_not_sec_global" || value.meaning !== "latest_saved_filing_value_not_realtime_ownership") return null;
  if (!Array.isArray(value.conditions) || value.conditions.length === 0) return null;
  return value as Sc13MonitorMatchEvidence;
}
function requireUuid(value: string) { const normalized = text(value); if (!UUID_PATTERN.test(normalized)) throw new Error("UUID required"); return normalized; }
function sameStrings(left: readonly string[], right: readonly string[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "SC13 Monitor Alert write failed"; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
