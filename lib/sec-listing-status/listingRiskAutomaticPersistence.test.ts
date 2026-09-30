import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectListingRiskSourceEvent, persistListingRiskStatusAutomatically } from "./listingRiskAutomaticPersistence.ts";
import { scpxListingRiskReplay } from "./fixtures/listingRiskReplay.ts";
import { buildObservation, unattached, type HistoryItem } from "./observation.ts";
import { validateListingRiskEventFacts } from "../monitor/listingRiskFacts.ts";
import type { GenericMonitorChildIdentity } from "../monitor/genericMonitorChildExecution.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { processGenericMonitorChild } from "../monitor/genericMonitorChildRuntime.ts";
import { buildGenericMonitorChildIdentities } from "../monitor/genericMonitorChildExecution.ts";
const f = JSON.parse(readFileSync(new URL("./fixtures/follow-up.json", import.meta.url), "utf8"));
const scope = { issuerCik: "0001476963", securityTitle: "common stock", exchange: "NYSE American" };
const uid = (n: number) => `25000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function raw(after = false) {
  const s = f[after ? "scpx-after" : "scpx-before"];
  return { id: uid(after ? 2 : 1), source_code: "sec_edgar", source_unique_id: after ? "0001079973-24-001121" : "0001079973-24-000891", source_url: s.url,
    published_at: after ? "2024-07-30" : "2024-06-17", raw_payload: { cik: scope.issuerCik, form_type: "8-K", primary_document_url: s.url, primary_document_html: `<p>${s.quote}</p>` } };
}
function prior(): HistoryItem {
  const r = raw(), selected = selectListingRiskSourceEvent(r, scpxListingRiskReplay(false), scope, []);
  assert.ok(selected.event);
  return { id: uid(3), usable: true, reason: null, observation: buildObservation({ raw: r, scope: { ...scope }, asOf: "2024-06-17", sourceEvent: selected.event, attachment: unattached("fixture") }) };
}
test("real Scorpius excerpts select pending then only the linked withdrawal, not scheduled resumption", () => {
  const a = prior(), facts = scpxListingRiskReplay(true);
  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  const selected = selectListingRiskSourceEvent(raw(true), facts, scope, [a]);
  assert.equal(selected.event?.kind, "removal_decision_withdrawn");
  assert.equal(selected.event?.resolves?.observationId, a.id);
  assert.equal(selected.event?.date, "2024-07-29");
  assert.ok(selected.event?.quote.includes("expected to resume"));
});
test("unsupported, stale, wrong-scope and ambiguous prior events cannot authorize closure", () => {
  for (const variant of ["missing", "stale", "wrong-exchange", "wrong-class", "different-issue", "ambiguous"]) {
    const a = prior(); const history = variant === "missing" ? [] : [a];
    if (variant === "stale") a.usable = false;
    if (variant === "wrong-exchange") a.observation.scope!.exchange = "Nasdaq";
    if (variant === "wrong-class") a.observation.scope!.securityTitle = "preferred stock";
    if (variant === "different-issue") a.observation.sourceEvent!.issue = "Section 1007";
    if (variant === "ambiguous") { const b = structuredClone(a); b.id = uid(4); b.observation.sourceHash = "b".repeat(64); history.push(b); }
    assert.equal(selectListingRiskSourceEvent(raw(true), scpxListingRiskReplay(true), scope, history).event, null, variant);
  }
});
test("equal historical versions are one source event; selection is repeatable", () => {
  const a = prior(), b = structuredClone(a); b.id = uid(4);
  assert.deepEqual(selectListingRiskSourceEvent(raw(true), scpxListingRiskReplay(true), scope, [a, b]), selectListingRiskSourceEvent(raw(true), scpxListingRiskReplay(true), scope, [b, a]));
});
test("classification, missing evidence, scheduled dates and another filing's evidence cannot supply facts", () => {
  for (const variant of ["scheduled", "wrong-accession", "interpreted", "wrong-url", "unsupported-recovery", "appeal"]) {
    const facts = scpxListingRiskReplay(true), r = raw(true);
    if (variant === "scheduled") facts.dates.notice_date.date_status = "scheduled";
    if (variant === "wrong-accession") facts.sources[0].source_id = "0000000000-24-000000";
    if (variant === "interpreted") facts.fact_provenance.forEach(e => { e.origin = "domain_interpreted"; });
    if (variant === "wrong-url") facts.sources[0].source_url = "https://example.com";
    if (variant === "unsupported-recovery") r.raw_payload.primary_document_html = "<p>The Company regained compliance.</p>";
    if (variant === "appeal") { facts.classification.event_kind = "hearing_or_appeal_update"; facts.classification.event_outcome = "procedural"; }
    assert.equal(selectListingRiskSourceEvent(r, facts, scope, [prior()]).event, null, variant);
  }
});
test("automatic consumer rejects wrong execution before reading raw or writing history", async () => {
  const identity = { eventId: uid(10), rawItemId: uid(1), parentPrimaryAiRunId: uid(11), executionId: uid(12), sourceFamily: "sec_8k_6k", monitorAnalyzerKey: "listing_risk" } as GenericMonitorChildIdentity;
  const repository: SecTickerResolutionRepository = { select: async () => { throw Error("must not read raw"); }, rpc: async () => ({ ok: true, status: 200, data: {
    status: "available", event_id: identity.eventId, raw_item_id: identity.rawItemId, parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    source_execution_id: uid(13), monitor_analyzer_key: "listing_risk", analyzer_contract_version: "listing_risk_domain_analyzer_v11", fact_schema_version: "listing_risk_event_facts_v2", persisted_at: "2026-10-01T00:00:00Z", facts: scpxListingRiskReplay(false),
  } }) };
  const result = await persistListingRiskStatusAutomatically(identity, repository);
  assert.equal(result.status, "unavailable"); assert.equal("reason" in result && result.reason, "listing_risk_execution_changed");
});

test("actual child runtime orders typed commit before history; failure does not change Monitor behavior", async () => {
  for (const mode of ["success", "history-failure", "not-applicable", "stale", "news", "duplicate"] as const) {
    const news = mode === "news";
    const [identity] = buildGenericMonitorChildIdentities({ primary: {
      eventId: uid(10), rawItemId: uid(1), parentPrimaryAiRunId: uid(11), sourceFamily: news ? "news" : "sec_8k_6k",
      sourceGroup: news ? "news" : "filings", sourceCode: news ? "test" : "sec_edgar", sourceIdentity: String(raw().source_unique_id),
      parentPromptKey: news ? "news_event_analysis" : "sec_8k_6k_analysis_listing_financial_risk", parentPromptVersion: "test",
    }, monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "listing_risk" }] } });
    const order: string[] = [];
    const result = await processGenericMonitorChild(identity, {
      repository: {
        claim: async () => mode !== "duplicate", releaseForRetry: async () => true,
        recordTerminal: async (_id, state) => { order.push(state); return { recorded: true, jobId: identity.executionId, state }; },
        loadExactParent: async () => ({ aiRun: {}, aiOutput: {}, event: {}, rawItem: { ...raw(), body_text: f["scpx-before"].quote }, analysis: {}, currentness: { status: "current", latestPrimaryAiRunId: identity.parentPrimaryAiRunId } }),
      },
      runListingRiskAnalyzer: async () => ({ stage: "complete", result: mode === "not-applicable" ? { status: "not_applicable" } : { status: "applicable", facts: scpxListingRiskReplay(false) }, run: {} as never, repair: null, shareCountObservation: null, shareCountObservationErrors: [] }),
      persistListingRisk: async () => { order.push("typed"); return mode === "stale" ? { status: "stale", reason: "new_parent" } : { status: "saved", resultStatus: mode === "not-applicable" ? "not_applicable" : "applicable", eventId: identity.eventId, sourceExecutionId: identity.executionId }; },
      persistListingStatus: async () => { order.push("history"); if (mode === "history-failure") throw Error("history offline"); return { status: "not_applicable", eventId: identity.eventId, rawItemId: identity.rawItemId, sourceExecutionId: identity.executionId }; },
      consumeListingMonitorAlerts: async () => { order.push("monitor"); throw Error("test stub: no delivery"); },
    });
    if (mode === "duplicate") { assert.equal(result.status, "duplicate"); assert.equal(result.providerCalls, 0); assert.deepEqual(order, ["history"]); }
    else if (mode === "stale") assert.deepEqual(order, ["typed", "stale"]);
    else if (mode === "not-applicable") assert.deepEqual(order, ["typed", "succeeded_not_applicable"]);
    else assert.deepEqual(order, news ? ["typed", "succeeded_applicable", "monitor"] : ["typed", "succeeded_applicable", "history", "monitor"]);
    if (mode === "history-failure") { assert.equal(result.status, "succeeded_applicable"); assert.deepEqual("postPersistence" in result && result.postPersistence, { status: "failed", error: "history offline" }); }
  }
});
