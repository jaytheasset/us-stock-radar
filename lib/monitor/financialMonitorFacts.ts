import { supabaseSelect } from "../supabase.ts";
import {
  PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY,
  PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION,
  PERIODIC_FINANCIAL_MONITOR_SCHEMA_VERSION,
  assertPeriodicFinancialMonitorAnalysisIdentity,
  readPeriodicFinancialRawFilingIdentity,
  type PeriodicFinancialMonitorAnalysis,
} from "./periodicFinancialMonitor.ts";
import {
  GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,
  GENERIC_MONITOR_CHILD_OUTPUT_TYPE,
  GENERIC_MONITOR_CHILD_SCHEMA_VERSION,
} from "./genericMonitorChildExecution.ts";

export const FINANCIAL_MONITOR_FACT_READER_VERSION = "financial_monitor_fact_reader_v1" as const;

export type FinancialMonitorFactReadReason =
  | "event_not_found"
  | "event_identity_ambiguous"
  | "financial_output_not_ready"
  | "financial_output_ambiguous"
  | "financial_identity_mismatch"
  | "financial_payload_invalid"
  | "reader_unavailable";

export type FinancialMonitorFactReadResult =
  | Readonly<{
      status: "available";
      version: typeof FINANCIAL_MONITOR_FACT_READER_VERSION;
      eventId: string;
      rawItemId: string;
      sourceExecutionId: string;
      persistedAt: string;
      accession: string;
      issuerCik: string;
      form: string;
      analysis: PeriodicFinancialMonitorAnalysis;
    }>
  | Readonly<{
      status: "not_ready";
      version: typeof FINANCIAL_MONITOR_FACT_READER_VERSION;
      reason: FinancialMonitorFactReadReason;
    }>;

type QueryResult = Readonly<{ ok: boolean; status?: number; data: unknown; error?: string }>;
export type FinancialMonitorFactRepository = Readonly<{
  readEvent(eventId: string): Promise<QueryResult>;
  readRuns(eventId: string): Promise<QueryResult>;
  readOutputs(executionId: string): Promise<QueryResult>;
  readRawItem(rawItemId: string): Promise<QueryResult>;
}>;

export async function readCurrentPeriodicFinancialFacts(
  eventId: string,
  repository?: FinancialMonitorFactRepository,
): Promise<FinancialMonitorFactReadResult> {
  if (!UUID_PATTERN.test(eventId)) return notReady("event_not_found");
  const resolved = repository || defaultRepository;
  try {
    const eventRows = requireRows(await resolved.readEvent(eventId));
    if (eventRows.length === 0) return notReady("event_not_found");
    if (eventRows.length !== 1) return notReady("event_identity_ambiguous");
    const rawItemId = uuid(eventRows[0]!.raw_item_id);
    if (!rawItemId) return notReady("event_identity_ambiguous");

    const runRows = requireRows(await resolved.readRuns(eventId));
    if (runRows.length === 0) return notReady("financial_output_not_ready");
    if (runRows.length !== 1) return notReady("financial_output_ambiguous");
    const run = runRows[0]!;
    const executionId = uuid(run.id);
    const metadata = record(run.metadata);
    if (
      !executionId
      || run.status !== "completed"
      || metadata?.child_schema_version !== GENERIC_MONITOR_CHILD_SCHEMA_VERSION
      || metadata?.monitor_analyzer_key !== PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY
      || metadata?.analyzer_contract_version !== PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION
      || metadata?.execution_id !== executionId
      || metadata?.event_id !== eventId
      || metadata?.raw_item_id !== rawItemId
    ) return notReady("financial_identity_mismatch");

    const outputRows = requireRows(await resolved.readOutputs(executionId));
    if (outputRows.length === 0) return notReady("financial_output_not_ready");
    if (outputRows.length !== 1) return notReady("financial_output_ambiguous");
    const output = outputRows[0]!;
    const payload = record(output.payload);
    const analysis = record(payload?.analysis) as PeriodicFinancialMonitorAnalysis | null;
    if (
      output.ai_run_id !== executionId
      || output.event_id !== eventId
      || output.output_type !== GENERIC_MONITOR_CHILD_OUTPUT_TYPE
      || payload?.schema_version !== GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION
      || payload?.execution_id !== executionId
      || payload?.monitor_analyzer_key !== PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY
      || payload?.result_classification !== "succeeded_applicable"
      || !analysis
      || analysis.schemaVersion !== PERIODIC_FINANCIAL_MONITOR_SCHEMA_VERSION
      || analysis.analyzerKey !== PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY
      || analysis.analyzerContractVersion !== PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION
      || analysis.gptDependency !== false
      || analysis.currentness?.status !== "CURRENT"
    ) return notReady("financial_payload_invalid");

    const rawRows = requireRows(await resolved.readRawItem(rawItemId));
    if (rawRows.length !== 1 || rawRows[0]!.id !== rawItemId) return notReady("event_identity_ambiguous");
    const expected = readPeriodicFinancialRawFilingIdentity(rawRows[0]!, text(metadata.source_identity));
    assertPeriodicFinancialMonitorAnalysisIdentity(analysis, expected);
    const persistedAt = timestamp(run.finished_at);
    if (!persistedAt) return notReady("financial_payload_invalid");
    return {
      status: "available",
      version: FINANCIAL_MONITOR_FACT_READER_VERSION,
      eventId,
      rawItemId,
      sourceExecutionId: executionId,
      persistedAt,
      accession: expected.accession,
      issuerCik: expected.issuerCik,
      form: expected.form,
      analysis,
    };
  } catch {
    return notReady("reader_unavailable");
  }
}

const defaultRepository: FinancialMonitorFactRepository = {
  readEvent: (eventId) => supabaseSelect("events", { select: "id,raw_item_id", id: `eq.${eventId}`, limit: "2" }),
  readRuns: (eventId) => supabaseSelect("ai_runs", {
    select: "id,event_id,raw_item_id,status,finished_at,metadata",
    event_id: `eq.${eventId}`,
    prompt_key: "eq.domain_monitor_child",
    "metadata->>monitor_analyzer_key": `eq.${PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY}`,
    status: "eq.completed",
    order: "finished_at.desc,id.desc",
    limit: "2",
  }),
  readOutputs: (executionId) => supabaseSelect("ai_outputs", {
    select: "id,ai_run_id,event_id,output_type,payload",
    ai_run_id: `eq.${executionId}`,
    output_type: `eq.${GENERIC_MONITOR_CHILD_OUTPUT_TYPE}`,
    limit: "2",
  }),
  readRawItem: (rawItemId) => supabaseSelect("raw_items", {
    select: "id,source_unique_id,raw_payload,metadata",
    id: `eq.${rawItemId}`,
    limit: "2",
  }),
};

function requireRows(result: QueryResult) {
  if (!result.ok) throw new Error(result.error || `HTTP ${result.status || 0}`);
  return Array.isArray(result.data) ? result.data.filter(record) : [];
}
function notReady(reason: FinancialMonitorFactReadReason): FinancialMonitorFactReadResult {
  return { status: "not_ready", version: FINANCIAL_MONITOR_FACT_READER_VERSION, reason };
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function uuid(value: unknown) { const candidate = text(value); return UUID_PATTERN.test(candidate) ? candidate : ""; }
function timestamp(value: unknown) { const candidate = text(value); return Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : ""; }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
