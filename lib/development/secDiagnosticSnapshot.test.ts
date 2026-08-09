import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSecDiagnosticSnapshot,
  parseSecDiagnosticFilters,
  SEC_DIAGNOSTIC_SCHEMA_VERSION,
} from "./secDiagnosticSnapshot.ts";

const room = {
  key: "ownership",
  label: "Ownership",
  forms: ["4", "4/A", "144", "144/A"],
};

const record = {
  event_id: "5c12efff-d839-4e72-b983-52990312aaf1",
  raw_item_id: "7b856257-4374-41e9-86a4-901f0d28f40f",
  accession_number: "0001921094-26-000731",
  ticker: "META",
  company_name: "Meta Platforms, Inc.",
  cik: "1326801",
  form_type: "144/A",
  title: "Amended proposed sale notice",
  filed_at: "2026-07-14T21:11:46.000Z",
  analyzed_at: "2026-08-09T13:32:15.512Z",
  analysis_status: "completed",
  analysis_exists: true,
  detail_url: "/filings/archive/5c12efff-d839-4e72-b983-52990312aaf1",
  collection_diagnostics: {
    collection_status: "collected",
    collected_at: "2026-07-14T21:12:00.000Z",
    event_observed_at: "2026-08-09T13:31:40.000Z",
    source_run_id: "72c348ab-4514-46c6-937e-af91298280e2",
    source_run_status: "completed",
    workflow_analysis_status: "completed",
    workflow_analysis_updated_at: "2026-08-09T13:32:16.000Z",
    repair_trace_record_id: "dbb137da-8b85-43ba-9fbf-06a983a39179",
  },
  validation_repair_trace: {
    availability: "available",
    attempted: true,
    status: "succeeded",
    analysis_run: {
      id: "095b80ef-1f3e-48b5-b31d-1aabf3bbb454",
      status: "completed",
      started_at: "2026-08-09T13:31:45.000Z",
      finished_at: "2026-08-09T13:32:15.512Z",
      provider: "must-not-leak",
    },
    initial_analysis: {
      parsed_result: {
        event_title: "Initial title",
        summary: "Initial summary",
        score: 42,
        internal_prompt: "must-not-leak",
      },
    },
    warnings: [{ code: "score_warning", description: "Token=private-value https://private.example/path" }],
    repair_prompt: { key: "sec_validation_repair", version: "v1", system: "must-not-leak" },
    source_selection: { source_block_ids: ["ownership-facts"] },
    applied_changes: [{ path: "/score", before: 42, after: 45 }],
    repair_analysis: { parsed_result: { event_title: "Final title", summary: "Final summary", score: 45 } },
  },
};

test("SEC diagnostic snapshot fixes the read-only schema and named data lineage", () => {
  const snapshot = buildSecDiagnosticSnapshot({
    room,
    records: [record],
    generatedAt: "2026-08-10T00:00:00.000Z",
  });

  assert.equal(snapshot.schema_version, SEC_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(snapshot.context.page, "/development/sec");
  assert.equal(snapshot.summary.result_count, 1);
  assert.deepEqual(snapshot.results[0]?.sources.map((source) => source.name), [
    "raw_items",
    "source_runs",
    "events",
    "event_analysis",
    "ai_runs",
    "ai_outputs.validation_repair_trace",
  ]);
  assert.equal(snapshot.results[0]?.cache.status, "not_used");
  assert.equal(snapshot.results[0]?.analysis.first_result.value?.score, 42);
  assert.equal(snapshot.results[0]?.analysis.correction.after?.score, 45);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /must-not-leak|private-value|private\.example/);
  assert.doesNotMatch(serialized, /internal_prompt|system|provider/);
  assert.match(serialized, /\[redacted\]/);
  assert.match(serialized, /\[redacted-url\]/);
});

test("SEC diagnostic filters are exact allowlisted identifiers", () => {
  assert.equal(parseSecDiagnosticFilters({ ticker: "meta" }).ok, true);
  assert.equal(parseSecDiagnosticFilters({ eventId: "not-a-uuid" }).ok, false);
  assert.equal(parseSecDiagnosticFilters({ ticker: "META;drop" }).ok, false);
  assert.equal(parseSecDiagnosticFilters({ accessionNumber: "0001921094-26-000731?x=1" }).ok, false);

  const snapshot = buildSecDiagnosticSnapshot({
    room,
    records: [record],
    filters: { ticker: "NVDA" },
  });
  assert.equal(snapshot.summary.status, "empty");
  assert.equal(snapshot.summary.result_count, 0);
});

test("missing collection and repair records stay explicit instead of inferred", () => {
  const snapshot = buildSecDiagnosticSnapshot({
    room,
    records: [{ ...record, collection_diagnostics: null, validation_repair_trace: { availability: "historical_missing" } }],
  });
  const result = snapshot.results[0];
  assert.equal(result?.status.collection, "unavailable");
  assert.equal(result?.status.background, "unknown");
  assert.equal(result?.analysis.first_result.availability, "record_missing");
  assert.equal(result?.analysis.correction.availability, "record_missing");
});
