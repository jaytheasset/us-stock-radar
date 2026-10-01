import { supabaseSelect } from "../supabase.ts";
import { genericMonitorChildRepository } from "./genericMonitorChildSupabaseRepository.ts";
import { consumeListingMonitorAlertsForEvent } from "./listingMonitorAlertConsumer.ts";
import { buildNtLifecycleChildIdentity, GENERIC_MONITOR_CHILD_OUTPUT_TYPE,
  GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION, type GenericMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import { buildNtLifecycleFacts, NT_LIFECYCLE_VERSION, NT_LIFECYCLE_ANALYZER, NT_FORMS, NT_REPORT_FORMS,
  object, text, readNtLifecycleSource, type NtLifecycleFacts, type NtSource } from "./ntLifecycle.ts";

type Select = typeof supabaseSelect;
export type NtLifecycleReadResult = { status: "not_ready"; reason: string } | {
  status: "available"; eventId: string; rawItemId: string; sourceExecutionId: string;
  persistedAt: string; filedAt: string; facts: NtLifecycleFacts;
};

/** Paginate the existing SEC raw store; never fall back to a ticker/name search. */
export async function resolveNtLifecycle(raw: Record<string, unknown>, select: Select = supabaseSelect): Promise<NtLifecycleFacts> {
  const source = readNtLifecycleSource(raw);
  const candidates: NtSource[] = [];
  const rejected: string[] = [];
  const cik = source.issuerCik, shortCik = String(Number(cik));
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const rows = requireRows(await select("raw_items", {
      select: "*", source_code: "eq.sec_edgar",
      or: `(raw_payload->>cik.eq.${cik},raw_payload->>cik.eq.${shortCik},raw_payload->>issuer_cik.eq.${cik},raw_payload->>issuer_cik.eq.${shortCik},metadata->>cik.eq.${cik},metadata->>cik.eq.${shortCik})`,
      "raw_payload->>form_type": `in.(${[...NT_FORMS, ...NT_REPORT_FORMS].filter(s => s.replace(/^NT /, "").replace(/\/A$/, "") === source.reportForm).map(s => `"${s}"`).join(",")})`,
      order: "id.asc", limit: "200", offset: String(offset),
    }));
    for (const row of rows) {
      if (seen.has(text(row.id))) continue;
      seen.add(text(row.id));
      try { candidates.push(readNtLifecycleSource(row)); }
      catch { rejected.push(text(row.id)); }
    }
    if (rows.length < 200) break;
  }
  const facts = buildNtLifecycleFacts(source, candidates);
  return rejected.length ? { ...facts, reportFiled: null,
    followUp: { status: "unresolved", reason: `candidate_source_unavailable:${rejected.sort().join(",")}`, notice: null, report: null } } : facts;
}

export async function processNtLifecycleChild(identity: GenericMonitorChildIdentity) {
  if (identity.monitorAnalyzerKey !== NT_LIFECYCLE_ANALYZER || identity.analyzerContractVersion !== NT_LIFECYCLE_VERSION) throw new Error("Invalid NT child");
  if (!await genericMonitorChildRepository.claim(identity)) return {
    status: "duplicate", providerCalls: 0,
    alerts: await consumeListingMonitorAlertsForEvent({ eventId: identity.eventId }),
  };
  try {
    const parent = await genericMonitorChildRepository.loadExactParent(identity);
    if (parent.currentness.status !== "current") {
      await genericMonitorChildRepository.recordTerminal(identity, "stale");
      return { status: "stale", providerCalls: 0 };
    }
    const facts = await resolveNtLifecycle(parent.rawItem);
    // Preserve unresolved facts too. Reader revalidates both source and candidate evidence.
    await genericMonitorChildRepository.recordTerminal(identity, "succeeded_applicable", { outputPayload: facts });
    return { status: "succeeded_applicable", providerCalls: 0, followUp: facts.followUp.status,
      alerts: await consumeListingMonitorAlertsForEvent({ eventId: identity.eventId }) };
  } catch (error) {
    await genericMonitorChildRepository.recordTerminal(identity, "failed", { error });
    return { status: "failed", providerCalls: 0, error: error instanceof Error ? error.message : "NT processing failed" };
  }
}

/** Official reader: exact current Primary, deterministic child identity and freshly validated SEC evidence. */
export async function readCurrentNtLifecycle(eventId: string, dependencies: {
  select?: Select; loadExactParent?: typeof genericMonitorChildRepository.loadExactParent;
} = {}): Promise<NtLifecycleReadResult> {
  const select = dependencies.select ?? supabaseSelect;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return unavailable("invalid_event_id");
    const events = requireRows(await select("events", { select: "id,raw_item_id", id: `eq.${eventId}`, limit: "2" }));
    if (events.length !== 1) return unavailable("event_not_found");
    const runs = requireRows(await select("ai_runs", { select: "*", event_id: `eq.${eventId}`,
      prompt_key: "eq.domain_monitor_child", "metadata->>monitor_analyzer_key": `eq.${NT_LIFECYCLE_ANALYZER}`,
      "metadata->>analyzer_contract_version": `eq.${NT_LIFECYCLE_VERSION}`,
      order: "started_at.desc.nullslast,id.desc", limit: "100" }));
    // A replacement Primary must never fall back to an old completed child.
    for (const run of runs) {
      const m = object(run.metadata);
      if (m.attempt_kind !== "automatic" || m.attempt_key !== "automatic") continue;
      const sourceFamily = m.source_family === "sec_nt" ? "sec_nt" : m.source_family === "sec_periodic_reports" ? "sec_periodic_reports" : null;
      if (!sourceFamily) return unavailable("source_family_invalid");
      const identity = buildNtLifecycleChildIdentity({ primary: {
        eventId, rawItemId: text(events[0].raw_item_id), sourceFamily, sourceGroup: "filings", sourceCode: "sec_edgar",
        sourceIdentity: text(m.source_identity), parentPrimaryAiRunId: text(m.parent_primary_ai_run_id),
        parentPromptKey: text(m.parent_prompt_key), parentPromptVersion: text(m.parent_prompt_version),
      }});
      if (identity.executionId !== run.id || m.execution_id !== run.id || m.event_id !== eventId
        || m.raw_item_id !== identity.rawItemId || m.analyzer_contract_version !== NT_LIFECYCLE_VERSION) return unavailable("child_identity_mismatch");
      const parent = await (dependencies.loadExactParent ?? genericMonitorChildRepository.loadExactParent)(identity);
      if (parent.currentness.status !== "current") continue;
      if (run.status !== "completed" || m.execution_state !== "succeeded_applicable") return unavailable("child_not_completed");
      const outputs = requireRows(await select("ai_outputs", { select: "*", ai_run_id: `eq.${identity.executionId}`,
        output_type: `eq.${GENERIC_MONITOR_CHILD_OUTPUT_TYPE}`, limit: "2" }));
      if (outputs.length !== 1) return unavailable("output_not_unique");
      const p = object(outputs[0].payload);
      if (outputs[0].event_id !== eventId || p.schema_version !== GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION
        || p.execution_id !== run.id || p.parent_primary_ai_run_id !== identity.parentPrimaryAiRunId
        || p.monitor_analyzer_key !== NT_LIFECYCLE_ANALYZER || p.analyzer_contract_version !== NT_LIFECYCLE_VERSION
        || p.result_classification !== "succeeded_applicable") return unavailable("output_contract_invalid");
      const facts = await resolveNtLifecycle(parent.rawItem, select);
      if (stable(p.analysis) !== stable(facts)) return unavailable("source_or_lifecycle_evidence_changed");
      if (!Number.isFinite(Date.parse(text(run.finished_at)))) return unavailable("persistence_date_invalid");
      return { status: "available", eventId, rawItemId: identity.rawItemId, sourceExecutionId: identity.executionId,
        persistedAt: text(run.finished_at), filedAt: facts.source.filedDate, facts };
    }
    return unavailable("current_nt_child_not_found");
  } catch (error) { return unavailable(error instanceof Error ? error.message : "reader_unavailable"); }
}
function unavailable(reason: string): NtLifecycleReadResult { return { status: "not_ready", reason }; }
function requireRows(r: Awaited<ReturnType<Select>>): Record<string, unknown>[] {
  if (!r.ok || !Array.isArray(r.data)) throw new Error("nt_source_reader_unavailable");
  return r.data.map(object);
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(object(v)).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
