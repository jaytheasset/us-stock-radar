import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSecDiagnosticSnapshot,
  getSecExactPersistedRecordStatus,
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
  assert.equal(snapshot.context.scope.status, "persisted_only");
  assert.deepEqual(snapshot.context.scope.excludes, ["pre_persist_execution"]);
  assert.equal(snapshot.summary.status, "available");
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
    records: [{
      ...record,
      analysis_exists: false,
      analysis_status: "record_missing",
      collection_diagnostics: null,
      validation_repair_trace: { availability: "historical_missing" },
    }],
  });
  const result = snapshot.results[0];
  assert.equal(snapshot.summary.status, "partial");
  assert.equal(result?.status.collection, "unavailable");
  assert.equal(result?.status.background, "unknown");
  assert.equal(result?.analysis.first_result.availability, "record_missing");
  assert.equal(result?.analysis.correction.availability, "record_missing");
  assert.equal(result?.sources.find((source) => source.name === "raw_items")?.status, "missing");
  assert.equal(result?.sources.find((source) => source.name === "event_analysis")?.status, "missing");
  assert.equal(result?.sources.find((source) => source.name === "ai_outputs.validation_repair_trace")?.status, "record_missing");
  assert.equal(result?.sources.some((source) => source.status === "read_unavailable"), false);
});

test("historically unrecorded optional repair traces do not degrade a complete persisted lineage", () => {
  const snapshot = buildSecDiagnosticSnapshot({
    room,
    records: [{
      ...record,
      validation_repair_trace: {
        availability: "historical_missing",
        analysis_run: record.validation_repair_trace.analysis_run,
      },
    }],
  });
  const result = snapshot.results[0];

  assert.equal(snapshot.summary.status, "available");
  assert.equal(result?.sources.find((source) => source.name === "ai_runs")?.status, "available");
  assert.equal(result?.sources.find((source) => source.name === "ai_outputs.validation_repair_trace")?.status, "record_missing");
  assert.equal(result?.analysis.first_result.availability, "record_missing");
  assert.equal(result?.analysis.validation.availability, "record_missing");
  assert.equal(result?.analysis.correction.availability, "record_missing");
});

test("secondary lineage read failures are partial and never historical record_missing", () => {
  const snapshot = buildSecDiagnosticSnapshot({
    room,
    records: [{
      ...record,
      analysis_exists: false,
      analysis_status: "read_unavailable",
      collection_diagnostics: {
        ...record.collection_diagnostics,
        collection_status: "read_unavailable",
        source_run_status: "read_unavailable",
        source_read_statuses: {
          raw_items: "read_failed",
          source_runs: "read_failed",
          event_analysis: "read_failed",
          ai_runs: "read_failed",
          ai_outputs: "read_failed",
        },
      },
      validation_repair_trace: {
        availability: "read_unavailable",
        message: "safe status only",
        private_error: "must-not-leak",
      },
    }],
  });
  const result = snapshot.results[0];

  assert.equal(snapshot.summary.status, "partial");
  assert.equal(result?.sources.find((source) => source.name === "raw_items")?.status, "read_unavailable");
  assert.equal(result?.sources.find((source) => source.name === "event_analysis")?.status, "read_unavailable");
  assert.equal(result?.sources.find((source) => source.name === "ai_outputs.validation_repair_trace")?.status, "read_unavailable");
  assert.equal(result?.analysis.first_result.availability, "read_unavailable");
  assert.equal(result?.analysis.validation.availability, "read_unavailable");
  assert.equal(result?.analysis.correction.availability, "read_unavailable");
  assert.equal(result?.analysis.correction.status, "read_unavailable");
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-leak|private_error/);
});

test("successful empty, exact not-found, and read failure remain distinct", () => {
  const empty = buildSecDiagnosticSnapshot({ room, records: [] });
  const notFound = buildSecDiagnosticSnapshot({
    room,
    records: [],
    filters: { eventId: "5c12efff-d839-4e72-b983-52990312aaf1" },
    read: { status: "ok", query: "exact_event" },
  });
  const failed = buildSecDiagnosticSnapshot({
    room,
    records: [record],
    read: { status: "read_failed", query: "recent" },
  });

  assert.equal(empty.summary.status, "empty");
  assert.equal(notFound.summary.status, "not_found");
  assert.equal(failed.summary.status, "read_failed");
  assert.equal(failed.summary.result_count, 0);
  assert.deepEqual(failed.results, []);
  assert.doesNotMatch(JSON.stringify(failed), /SUPABASE|must-not-leak/);
});

test("exact persisted-result checks preserve confirmed, not-found, and read-unavailable meanings", () => {
  const confirmed = buildSecDiagnosticSnapshot({
    room,
    records: [record],
    read: { status: "ok", query: "exact_event" },
  });
  const notFound = buildSecDiagnosticSnapshot({
    room,
    records: [],
    filters: { eventId: record.event_id },
    read: { status: "ok", query: "exact_event" },
  });
  const unavailable = buildSecDiagnosticSnapshot({
    room,
    records: [],
    filters: { eventId: record.event_id },
    read: { status: "read_failed", query: "exact_event" },
  });

  assert.equal(getSecExactPersistedRecordStatus(confirmed), "confirmed");
  assert.equal(getSecExactPersistedRecordStatus(notFound), "not_found");
  assert.equal(getSecExactPersistedRecordStatus(unavailable), "read_unavailable");
});
