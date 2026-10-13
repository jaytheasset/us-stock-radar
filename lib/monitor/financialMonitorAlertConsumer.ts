import {
  evaluateFinancialMonitorConditions,
  type FinancialMonitorMatchReasonCode,
  type FinancialMonitorMatchStatus,
} from "../financialMonitorMatcher.ts";
import {
  readCurrentPeriodicFinancialFacts,
  type FinancialMonitorFactReadResult,
} from "./financialMonitorFacts.ts";
import {
  listActiveFinancialMonitorsForConsumer,
  type FinancialMonitorDiagnostic,
  type FinancialMonitorListResult,
} from "./financialMonitorPersistence.ts";
import { buildFinancialMonitorEvidence, readFinancialMonitorEvidence, type FinancialMonitorEvidence } from "./financialMonitorEvidence.ts";
import { readPeriodicFinancialRawFilingIdentity } from "./periodicFinancialMonitor.ts";

export const FINANCIAL_MONITOR_ALERT_CONSUMER_VERSION = "financial_monitor_alert_consumer_v1" as const;
export type FinancialMonitorAlertWriteResult =
  | Readonly<{ status: "created" | "existing"; monitorId: string; alertId?: string }>
  | Readonly<{ status: "failed"; monitorId: string; error: string }>;

export type FinancialMonitorAlertConsumerDependencies = Readonly<{
  readFacts(eventId: string): Promise<FinancialMonitorFactReadResult>;
  listActiveMonitors(): Promise<FinancialMonitorListResult>;
  createAlert(input: Readonly<{
    eventId: string; monitorId: string; userId: string; sourceExecutionId: string;
    accession: string; issuerCik: string; createdAt: string;
    evidence?: FinancialMonitorEvidence;
  }>): Promise<FinancialMonitorAlertWriteResult>;
  now(): Date;
}>;

export type FinancialMonitorAlertConsumerResult = Readonly<{
  version: typeof FINANCIAL_MONITOR_ALERT_CONSUMER_VERSION;
  status: "completed" | "partial_failure";
  eventId: string;
  readerStatus: FinancialMonitorFactReadResult["status"];
  readerReason?: string;
  monitorCount: number;
  diagnostics: readonly FinancialMonitorDiagnostic[];
  evaluations: readonly Readonly<{ monitorId: string; status: FinancialMonitorMatchStatus; reasonCode: FinancialMonitorMatchReasonCode }>[];
  writes: readonly FinancialMonitorAlertWriteResult[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
}>;

const defaultDependencies: FinancialMonitorAlertConsumerDependencies = {
  readFacts: readCurrentPeriodicFinancialFacts,
  listActiveMonitors: listActiveFinancialMonitorsForConsumer,
  createAlert: createFinancialMonitorAlert,
  now: () => new Date(),
};

export async function consumeFinancialMonitorAlertsForEvent(
  input: Readonly<{ eventId: string; preloadedFacts?: FinancialMonitorFactReadResult }>,
  dependencies: FinancialMonitorAlertConsumerDependencies = defaultDependencies,
): Promise<FinancialMonitorAlertConsumerResult> {
  const monitors = await dependencies.listActiveMonitors();
  let facts: FinancialMonitorFactReadResult;
  try { facts = input.preloadedFacts || await dependencies.readFacts(input.eventId); }
  catch { facts = { status: "not_ready", version: "financial_monitor_fact_reader_v1", reason: "reader_unavailable" }; }
  const evaluations = monitors.monitors.map((monitor) => ({
    monitor,
    result: evaluateFinancialMonitorConditions(facts, monitor.conditions, input.eventId),
  }));
  const writes: FinancialMonitorAlertWriteResult[] = [];
  const companyName = facts.status === "available" && evaluations.some(e => e.result.status === "match")
    ? await readFilingCompanyName(facts) : null;
  for (const evaluation of evaluations) {
    if (evaluation.result.status !== "match" || facts.status !== "available") continue;
    try {
      const createdAt = dependencies.now().toISOString();
      writes.push(await dependencies.createAlert({
        eventId: facts.eventId,
        monitorId: evaluation.monitor.id,
        userId: evaluation.monitor.userId,
        sourceExecutionId: facts.sourceExecutionId,
        accession: facts.accession,
        issuerCik: facts.issuerCik,
        createdAt,
        evidence: buildFinancialMonitorEvidence(facts, evaluation.monitor.conditions, createdAt, companyName),
      }));
    } catch (error) {
      writes.push({ status: "failed", monitorId: evaluation.monitor.id, error: message(error) });
    }
  }
  const createdCount = writes.filter((write) => write.status === "created").length;
  const existingCount = writes.filter((write) => write.status === "existing").length;
  const failedCount = writes.filter((write) => write.status === "failed").length;
  return {
    version: FINANCIAL_MONITOR_ALERT_CONSUMER_VERSION,
    status: failedCount ? "partial_failure" : "completed",
    eventId: input.eventId,
    readerStatus: facts.status,
    ...(facts.status === "not_ready" ? { readerReason: facts.reason } : {}),
    monitorCount: monitors.monitors.length,
    diagnostics: monitors.diagnostics,
    evaluations: evaluations.map(({ monitor, result }) => ({ monitorId: monitor.id, status: result.status, reasonCode: result.reasonCode })),
    writes, createdCount, existingCount, failedCount,
  };
}

export async function createFinancialMonitorAlert(input: Readonly<{
  eventId: string; monitorId: string; userId: string; sourceExecutionId: string;
  accession: string; issuerCik: string; createdAt: string;
  evidence?: FinancialMonitorEvidence;
}>): Promise<FinancialMonitorAlertWriteResult> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: input.userId,
    alert_event_id: input.eventId,
    ticker: null,
    title: "Financial monitor matched",
    category: "financial_risk",
    source_type: "other",
    source_label: "Financial Monitor",
    alert_lane: "financial_monitor",
    severity: null,
    delivered_channels: [],
    delivery_status: "queued",
    delivered_at: input.createdAt,
    scheduled_for: null,
    sent_at: null,
    attempted_at: null,
    last_error: null,
    dedupe_key: null,
    financial_monitor_id: input.monitorId,
    alert_domain: "financial",
    financial_source_execution_id: input.sourceExecutionId,
    financial_accession: input.accession,
    financial_issuer_cik: input.issuerCik,
    ...(input.evidence ? { financial_match_evidence: input.evidence } : {}),
  }, { onConflict: "financial_monitor_id,alert_event_id", prefer: "resolution=ignore-duplicates,return=representation" });
  if (!result.ok) return { status: "failed", monitorId: input.monitorId, error: result.error || `HTTP ${result.status}` };
  const row = Array.isArray(result.data) && record(result.data[0]) ? result.data[0] : undefined;
  return row ? { status: "created", monitorId: input.monitorId, alertId: text(row.id) || undefined } : { status: "existing", monitorId: input.monitorId };
}

export type FinancialMonitorAlertItem = Readonly<{
  id: string; monitorId: string; eventId: string; accession: string; issuerCik: string; createdAt: string;
  display: ReturnType<typeof readFinancialMonitorEvidence>;
}>;
export type FinancialMonitorAlertReadRepository = Readonly<{
  list(input: Readonly<{ ownerId: string; monitorId?: string }>): Promise<Readonly<{ ok: boolean; status?: number; data: unknown; error?: string }>>;
}>;

export async function listFinancialMonitorAlertsForOwner(
  input: Readonly<{ ownerId: string; monitorId?: string }>,
  repository?: FinancialMonitorAlertReadRepository,
): Promise<readonly FinancialMonitorAlertItem[]> {
  const ownerId = requireUuid(input.ownerId);
  const monitorId = input.monitorId ? requireUuid(input.monitorId) : undefined;
  const resolved = repository || await resolveAlertRepository();
  const result = await resolved.list({ ownerId, ...(monitorId ? { monitorId } : {}) });
  if (!result.ok) throw new Error(result.error || `HTTP ${result.status || 0}`);
  return (Array.isArray(result.data) ? result.data.filter(record) : []).flatMap((row) => {
    const id = text(row.id), rowMonitorId = text(row.financial_monitor_id), eventId = text(row.alert_event_id);
    const accession = text(row.financial_accession), issuerCik = text(row.financial_issuer_cik), createdAt = text(row.created_at);
    return UUID_PATTERN.test(id) && UUID_PATTERN.test(rowMonitorId) && UUID_PATTERN.test(eventId)
      && /^\d{10}-\d{2}-\d{6}$/.test(accession) && /^\d{10}$/.test(issuerCik) && Number.isFinite(Date.parse(createdAt))
      ? [{ id, monitorId: rowMonitorId, eventId, accession, issuerCik, createdAt,
        display: readFinancialMonitorEvidence(row.financial_match_evidence, { eventId, accession, issuerCik, sourceExecutionId: text(row.financial_source_execution_id) }) }]
      : [];
  });
}

async function resolveAlertRepository(): Promise<FinancialMonitorAlertReadRepository> {
  const supabase = await import("../supabase.ts");
  return { list: ({ ownerId, monitorId }) => supabase.supabaseSelect("user_alert_deliveries", {
    select: "id,alert_event_id,financial_monitor_id,financial_accession,financial_issuer_cik,created_at,financial_match_evidence,financial_source_execution_id",
    user_id: `eq.${ownerId}`, alert_domain: "eq.financial", alert_lane: "eq.financial_monitor",
    ...(monitorId ? { financial_monitor_id: `eq.${monitorId}` } : {}), order: "delivered_at.desc,id.desc", limit: "100",
  }) };
}

async function readFilingCompanyName(facts: Extract<FinancialMonitorFactReadResult, { status: "available" }>): Promise<string | null> {
  try {
    const { supabaseSelect } = await import("../supabase.ts");
    const r = await supabaseSelect("raw_items", { id: `eq.${facts.rawItemId}`, select: "id,source_unique_id,raw_payload,metadata", limit: "1" });
    const raw = r.ok && Array.isArray(r.data) && record(r.data[0]) ? r.data[0] : null;
    if (!raw) return null;
    const identity = readPeriodicFinancialRawFilingIdentity(raw, facts.accession);
    const payload = record(raw.raw_payload) ? raw.raw_payload : null;
    return identity.issuerCik === facts.issuerCik && identity.form === facts.form && text(payload?.company_name) ? text(payload?.company_name) : null;
  } catch { return null; }
}

function requireUuid(value: string) { const normalized = text(value); if (!UUID_PATTERN.test(normalized)) throw new Error("UUID required"); return normalized; }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Financial Monitor Alert write failed"; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
