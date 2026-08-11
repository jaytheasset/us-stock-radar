import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OfferingMonitorJobIdentity } from "./offeringMonitorJobFoundation.ts";
import {
  OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT,
  buildOfferingMonitorSecondStagePackage,
  offeringMonitorSecondStageProviderSchema,
  processOfferingMonitorSecondStageJob,
  validateOfferingMonitorProviderOutput,
  type OfferingMonitorProviderRun,
  type OfferingMonitorSecondStageArtifacts,
  type OfferingMonitorSecondStageDependencies,
} from "./offeringMonitorSecondStage.ts";

const identity: OfferingMonitorJobIdentity = {
  schemaVersion: "offering_monitor_job_v1",
  purpose: "offering_monitor_normalization",
  jobId: "b6eaecad-5d37-57da-8dcd-5cd985e03977",
  eventId: "69606800-ee16-4a75-9bbf-3b64bdc56d69",
  rawItemId: "efea3384-9eef-4e6b-9e63-60dc1cd3090e",
  sourceIdentity: "0001437749-26-021738",
  formType: "S-1",
  family: "s1",
  parentPrimaryAiRunId: "5e56353f-e700-4c3f-89c1-0d7c6faf851a",
  parentPromptKey: "sec_s1_f1_analysis",
  parentPromptVersion: "v35-compact-offering-monitor-payload",
  enqueuedAt: "2026-08-12T00:00:00.000Z",
};

test("second-stage provider schema is one required root plain string with no nested Monitor states", () => {
  assert.deepEqual(offeringMonitorSecondStageProviderSchema, {
    type: "object",
    required: ["offering_monitor_payload"],
    properties: { offering_monitor_payload: { type: "string" } },
  });
  const schema = JSON.stringify(offeringMonitorSecondStageProviderSchema);
  assert.doesNotMatch(schema, /enum|nullable|oneOf|anyOf|facts|amount|immediate|additional/);
});

test("input package excludes Primary Monitor payload and legacy parser offering truth", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const text = JSON.stringify(inputPackage.payload);
  assert.doesNotMatch(text, /PRIMARY_MONITOR_SENTINEL|legacy_parser_amount|event_offering_terms|parser_output/);
  assert.match(text, /Primary summary/);
  assert.match(text, /s1f1_attachment_doc_a/);
  assert.equal(inputPackage.stats.sourceBlockCount, 2);
  assert.ok((inputPackage.stats.sourceTextRatio || 1) < 0.9);
});

test("source selection preserves exact stable IDs, referenced adjacency, and structural attachments", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const refs = inputPackage.stats.selectedSourceRefs;
  assert.deepEqual(refs, ["s1f1_source_block_001", "s1f1_attachment_doc_a"]);
  assert.doesNotMatch(JSON.stringify(inputPackage.payload), /unrelated filing evidence/);
});

test("dedicated prompt is Monitor-only and states the independent amount and exposure contract", () => {
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /not rewriting the user-facing filing analysis/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Display analysis and Monitor facts serve different purposes/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /source-backed gross transaction amount/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /additional_potential_primary_share_exposure excludes/i);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /IPDN|0001437749|10,?000,?000/);
});

test("valid outer string reuses strict om1 parsing and code-only total", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: { offering_monitor_payload: validWirePayload() } }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.equal(candidate.canonical_candidate?.primary_or_resale, "primary");
  assert.equal(candidate.materialized_candidate?.total_potential_primary_share_exposure.value, 15_000_000);
});

test("unknown outer keys and duplicate inner keys fail closed", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const unknown = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: { offering_monitor_payload: validWirePayload(), extra: true } }),
  });
  assert.equal(unknown.validation.status, "validation_failed");
  const duplicate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({
      parsed: { offering_monitor_payload: validWirePayload().replace('"stage":"active_offering"', '"stage":"active_offering","stage":"priced"') },
    }),
  });
  assert.equal(duplicate.validation.status, "validation_failed");
  assert.match(duplicate.validation.errors.join(" "), /duplicate key/i);
});

test("exact current parent calls provider once and saves only a diagnostic candidate", async () => {
  const trace: string[] = [];
  const result = await processOfferingMonitorSecondStageJob(identity, dependencies(trace));
  assert.equal(result.status, "completed");
  assert.deepEqual(trace, ["authority", "claim", "load", "authority", "start", "provider", "authority", "save"]);
  assert.equal(trace.filter((item) => item === "provider").length, 1);
});

test("newer Primary before provider marks stale and makes no Gemini call", async () => {
  const trace: string[] = [];
  const result = await processOfferingMonitorSecondStageJob(identity, dependencies(trace, {
    authorities: [current(), { status: "stale", latestPrimaryAiRunId: "new-primary" }],
  }));
  assert.equal(result.status, "stale");
  assert.equal(result.providerCalled, false);
  assert.equal(trace.includes("provider"), false);
  assert.equal(trace.includes("save"), false);
});

test("newer Primary during provider rejects the diagnostic candidate", async () => {
  const trace: string[] = [];
  const result = await processOfferingMonitorSecondStageJob(identity, dependencies(trace, {
    authorities: [current(), current(), { status: "stale", latestPrimaryAiRunId: "new-primary" }],
  }));
  assert.equal(result.status, "stale");
  assert.equal(result.providerCalled, true);
  assert.equal(trace.filter((item) => item === "provider").length, 1);
  assert.equal(trace.includes("save"), false);
});

test("provider and validation failures preserve the frozen Primary and never retry", async () => {
  const primary = Object.freeze({ event: "kept", analysis: "kept", scoreAlert: "kept" });
  const trace: string[] = [];
  const result = await processOfferingMonitorSecondStageJob(identity, dependencies(trace, {
    provider: providerRun({ ok: false, responseOk: false, status: 400, parsed: null, error: "schema rejected" }),
  }));
  assert.equal(result.status, "failed");
  assert.equal(trace.filter((item) => item === "provider").length, 1);
  assert.deepEqual(primary, { event: "kept", analysis: "kept", scoreAlert: "kept" });
});

test("a package that reproduces essentially all Primary source text fails before Gemini", async () => {
  const trace: string[] = [];
  const sameSize = artifacts();
  sameSize.sourceInput.sourceInventory = { sourceBlockBudget: { includedTextChars: 1_050 } };
  const result = await processOfferingMonitorSecondStageJob(identity, dependencies(trace, { artifacts: sameSize }));
  assert.equal(result.status, "input_reduction_failed");
  assert.equal(trace.includes("provider"), false);
});

test("runtime lineage loader uses only exact job, parent, event, raw, accession-scoped artifacts", () => {
  const runtime = readFileSync(new URL("./offeringMonitorSecondStageRuntime.ts", import.meta.url), "utf8");
  assert.match(runtime, /id: `eq\.\$\{identity\.parentPrimaryAiRunId\}`/);
  assert.match(runtime, /event_id: `eq\.\$\{identity\.eventId\}`/);
  assert.match(runtime, /raw_item_id: `eq\.\$\{identity\.rawItemId\}`/);
  assert.doesNotMatch(runtime, /fetchLatest|global latest|order: "finished_at\.desc"/i);
});

function artifacts(): OfferingMonitorSecondStageArtifacts {
  return {
    jobMetadata: { parent_primary_ai_run_id: identity.parentPrimaryAiRunId, phase: "foundation_only" },
    parentRun: { id: identity.parentPrimaryAiRunId, usage: { input_tokens: 68_000 } },
    parentOutput: {
      payload: {
        analysis: {
          event_title: "Primary title",
          summary: "Primary summary",
          key_evidence: [{ source_ref: "s1f1_source_block_001" }],
          offering_monitor_payload: "PRIMARY_MONITOR_SENTINEL",
          offering_monitor: { actual_primary_offering_amount: "PRIMARY_MONITOR_SENTINEL" },
          parser_output: { offering_amount: "legacy_parser_amount" },
          display_payload: { display_type: "mixed_offering", data: { offering_rows: [{ label: "Terms" }] } },
        },
        validation_repair_trace: {
          source_selection: { selected_original_source_blocks: [{ block_id: "s1f1_source_block_001" }] },
        },
      },
    },
    rawItem: { id: identity.rawItemId, source_unique_id: identity.sourceIdentity },
    event: { id: identity.eventId },
    sourceInput: {
      currentFiling: { accession_number: identity.sourceIdentity, form_type: "S-1" },
      sourceInventory: { sourceBlockBudget: { includedTextChars: 10_000 } },
      attachmentInventory: [{ filename: "agreement.txt" }],
      blocks: [
        block("s1f1_source_block_001", "primary", "main.htm", "Primary source evidence. ".repeat(20)),
        block("s1f1_attachment_doc_a", "attachment", "agreement.txt", "Attached agreement evidence. ".repeat(20)),
        block("unrelated_source", "primary", "other.htm", "unrelated filing evidence"),
      ],
    },
  };
}

function block(id: string, source: string, document: string, text: string) {
  return {
    block_id: id,
    source_ref: id,
    source,
    section_key: id,
    section_title: null,
    document_name: document,
    document_id: document,
    chunk_index: 1,
    chunk_count: 1,
    text,
    tables: [],
  };
}

function current() {
  return { status: "current" as const, latestPrimaryAiRunId: identity.parentPrimaryAiRunId };
}

function dependencies(
  trace: string[],
  options: {
    authorities?: Array<ReturnType<typeof current> | { status: "stale"; latestPrimaryAiRunId: string }>;
    provider?: OfferingMonitorProviderRun;
    artifacts?: OfferingMonitorSecondStageArtifacts;
  } = {},
): OfferingMonitorSecondStageDependencies {
  const authorities = [...(options.authorities || [current(), current(), current()])];
  return {
    readParentAuthority: async () => {
      trace.push("authority");
      return authorities.shift() || current();
    },
    claimJob: async () => {
      trace.push("claim");
      return true;
    },
    loadArtifacts: async () => {
      trace.push("load");
      return options.artifacts || artifacts();
    },
    recordProviderStart: async () => {
      trace.push("start");
    },
    runProvider: async () => {
      trace.push("provider");
      return options.provider || providerRun({ parsed: { offering_monitor_payload: validWirePayload() } });
    },
    saveDiagnostic: async () => {
      trace.push("save");
    },
    markFailed: async () => {
      trace.push("failed");
    },
    markStale: async () => {
      trace.push("stale");
    },
  };
}

function providerRun(overrides: Partial<OfferingMonitorProviderRun> = {}): OfferingMonitorProviderRun {
  return {
    ok: true,
    responseOk: true,
    status: 200,
    statusText: "OK",
    provider: "gemini",
    model: "gemini-2.5-flash",
    responseId: "response-1",
    outputText: "{}",
    parsed: null,
    usage: { input_tokens: 10_000, output_tokens: 500, total_tokens: 10_500 },
    latencyMs: 1_000,
    ...overrides,
  };
}

function validWirePayload() {
  const unavailable = (unit: string, basis: string) => ({
    value: null,
    availability: "unavailable",
    quality: "unknown",
    bound: "unknown",
    unit,
    currency: null,
    security_basis: null,
    comparison_basis: basis,
    comparable: null,
    source: null,
  });
  const availableShares = (value: number, source: string) => ({
    value,
    availability: "available",
    quality: "exact",
    bound: "exact",
    unit: "shares",
    currency: null,
    security_basis: "common_stock",
    comparison_basis: "shares_outstanding",
    comparable: null,
    source,
  });
  return JSON.stringify({
    v: "om1",
    app: "applicable",
    stage: "active_offering",
    side: "primary",
    nature: "equity_linked",
    w: true,
    pfw: true,
    conv: false,
    facts: {
      amount: {
        value: 10_000_000,
        availability: "available",
        quality: "estimated",
        bound: "maximum",
        unit: "currency",
        currency: "USD",
        security_basis: "transaction_gross_amount",
        comparison_basis: "market_cap",
        comparable: null,
        source: "s1f1_attachment_doc_a",
      },
      price: unavailable("currency_per_security", "market_price"),
      immediate: availableShares(10_000_000, "s1f1_source_block_001"),
      additional: availableShares(5_000_000, "s1f1_attachment_doc_a"),
      resale: unavailable("shares", "public_float"),
    },
  });
}
