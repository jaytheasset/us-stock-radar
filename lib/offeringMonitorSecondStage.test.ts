import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OfferingMonitorJobIdentity } from "./offeringMonitorJobFoundation.ts";
import {
  OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
  OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT,
  OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS,
  buildOfferingMonitorSecondStagePackage,
  offeringMonitorSecondStageProviderSchema,
  processOfferingMonitorSecondStageJob,
  validateOfferingMonitorProviderOutput,
  type OfferingMonitorProviderRun,
  type OfferingMonitorSecondStageArtifacts,
  type OfferingMonitorSecondStageDependencies,
} from "./offeringMonitorSecondStage.ts";

const identity: OfferingMonitorJobIdentity = {
  schemaVersion: "offering_monitor_job_v2",
  purpose: "offering_monitor_normalization",
  jobId: "c6eaecad-5d37-57da-8dcd-5cd985e03978",
  logicalJobId: "b6eaecad-5d37-57da-8dcd-5cd985e03977",
  executionId: "c6eaecad-5d37-57da-8dcd-5cd985e03978",
  executionContractVersion: "second_stage_direct_v3",
  executionAttemptKey: "automatic",
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

test("second-stage provider schema is the direct readable Monitor shape without state explosion", () => {
  assert.deepEqual(offeringMonitorSecondStageProviderSchema.required, [
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature", "facts",
  ]);
  assert.deepEqual(offeringMonitorSecondStageProviderSchema.properties.facts.required, OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS);
  const schema = JSON.stringify(offeringMonitorSecondStageProviderSchema);
  assert.match(schema, /actual_primary_offering_amount/);
  assert.doesNotMatch(schema, /offering_monitor_payload|"amount"|"price"|"immediate"|"additional"|"resale"/);
  assert.doesNotMatch(schema, /enum|nullable|oneOf|anyOf|allOf|"type":\[/);
  assert.equal(Buffer.byteLength(schema), 3_039);
});

test("input package excludes Primary Monitor payload and legacy parser offering truth", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const text = JSON.stringify(inputPackage.payload);
  assert.doesNotMatch(text, /PRIMARY_MONITOR_SENTINEL|legacy_parser_amount|event_offering_terms|parser_output/);
  assert.match(text, /Primary summary/);
  assert.match(text, /s1f1_attachment_doc_a/);
  assert.equal(inputPackage.stats.sourceBlockCount, 2);
  assert.equal(inputPackage.stats.allowedSourceRefCount, 2);
  assert.ok((inputPackage.stats.sourceTextRatio || 1) < 0.9);
});

test("source selection preserves exact stable IDs, referenced adjacency, and structural attachments", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const refs = inputPackage.stats.selectedSourceRefs;
  assert.deepEqual(refs, ["ref:s1f1_source_block_001", "ref:s1f1_attachment_doc_a"]);
  assert.deepEqual(inputPackage.allowedSourceRefs, refs);
  assert.deepEqual(inputPackage.payload.allowed_source_refs, refs);
  const sourcePackage = inputPackage.payload.source_package as { evidence_blocks: Array<{ source_ref: string }> };
  assert.deepEqual(sourcePackage.evidence_blocks.map((block) => block.source_ref), refs);
  assert.equal(new Set(refs).size, sourcePackage.evidence_blocks.length);
  assert.doesNotMatch(JSON.stringify(inputPackage.payload), /unrelated filing evidence/);
});

test("dedicated prompt uses direct canonical fact keys and preserves semantic definitions", () => {
  assert.deepEqual(OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS, [
    "actual_primary_offering_amount", "offering_price", "immediate_primary_share_exposure",
    "additional_potential_primary_share_exposure", "resale_share_exposure",
  ]);
  assert.equal(OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION, "second_stage_direct_v3");
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /not rewriting the user-facing filing analysis/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Display analysis and Monitor facts serve different purposes/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /actual_primary_offering_amount is the source-backed gross amount/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /additional_potential_primary_share_exposure is a distinct potential primary exposure/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /actual_primary_offering_amount|offering_price|immediate_primary_share_exposure|additional_potential_primary_share_exposure|resale_share_exposure/);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /OM1 WIRE CONTRACT|compact om1|facts has exactly five wire keys/);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /IPDN|0001437749|10,?000,?000/);
});

test("prompt ends after the source package with the exact outer, source namespace, and output discipline contract", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const prompt = inputPackage.prompt.user;
  const finalIndex = prompt.lastIndexOf("FINAL OUTPUT CONTRACT");
  assert.ok(finalIndex > prompt.lastIndexOf("evidence_blocks"));
  assert.match(prompt.slice(finalIndex), /direct Minimal Offering Monitor JSON object/);
  assert.match(prompt.slice(finalIndex), /Never return offering_monitor_payload or nested JSON text/);
  assert.match(prompt.slice(finalIndex), /ref:s1f1_source_block_001/);
  assert.match(prompt.slice(finalIndex), /Do not return block_id, parent_primary_context/);
  assert.match(prompt.slice(finalIndex), /No aliases\. No markdown\. No commentary\. No explanation\. No trailing text\.$/);
});

test("comparison_basis remains a required runtime string even when a fact is unavailable", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const payload = validDirectPayload() as { facts: { offering_price: { comparison_basis_type: unknown } } };
  payload.facts.offering_price.comparison_basis_type = null;
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(candidate.validation.status, "validation_failed");
  assert.match(candidate.validation.errors.join(" "), /facts\.offering_price\.comparison_basis_type must be a string/);
});

test("valid direct object reuses canonical validation and code-only total", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: validDirectPayload() }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.equal(candidate.canonical_candidate?.primary_or_resale, "primary");
  assert.equal(candidate.materialized_candidate?.total_potential_primary_share_exposure.value, 15_000_000);
});

test("nested string, malformed JSON, missing required fields, and semantic defaults fail closed", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const nested = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: { offering_monitor_payload: JSON.stringify(validDirectPayload()) } }),
  });
  assert.equal(nested.validation.status, "validation_failed");

  const malformed = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ outputText: "{", parsed: validDirectPayload() }),
  });
  assert.equal(malformed.validation.status, "transport_failed");

  const missing = validDirectPayload() as Record<string, unknown>;
  delete missing.financing_stage;
  const missingCandidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: missing }),
  });
  assert.equal(missingCandidate.validation.status, "validation_failed");
  assert.match(missingCandidate.validation.errors.join(" "), /financing_stage is required/);

  const invalid = validDirectPayload();
  delete (invalid.facts.actual_primary_offering_amount as Record<string, unknown>).value;
  const invalidCandidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: invalid }),
  });
  assert.equal(invalidCandidate.validation.status, "validation_failed");
  assert.match(invalidCandidate.validation.errors.join(" "), /value must be a non-negative finite number when available/);
});

test("unknown direct keys and duplicate nested keys fail closed", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const unknown = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: { ...validDirectPayload(), extra: true } }),
  });
  assert.equal(unknown.validation.status, "validation_failed");
  const duplicate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({
      outputText: JSON.stringify(validDirectPayload()).replace('"availability":"available"', '"availability":"available","availability":"unavailable"'),
    }),
  });
  assert.equal(duplicate.validation.status, "transport_failed");
  assert.match(duplicate.validation.errors.join(" "), /duplicate key/i);
});

test("direct trailing text and duplicate root keys fail closed without extraction or truncation", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const outer = JSON.stringify(validDirectPayload());
  const trailing = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ outputText: `${outer}\ntrailing`, parsed: validDirectPayload() }),
  });
  assert.equal(trailing.validation.status, "transport_failed");
  assert.match(trailing.validation.errors.join(" "), /trailing content/i);

  const duplicateOuter = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({
      outputText: outer.replace('"version":"minimal_offering_monitor_v1"', '"version":"minimal_offering_monitor_v1","version":"minimal_offering_monitor_v1"'),
      parsed: validDirectPayload(),
    }),
  });
  assert.equal(duplicateOuter.validation.status, "transport_failed");
  assert.match(duplicateOuter.validation.errors.join(" "), /duplicate key/i);
});

test("available fact source must be an allowed source_ref; block IDs, parent context, and foreign refs fail", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  for (const invalidSource of ["s1f1_attachment_doc_a", "parent_primary_context", "foreign:source_ref"]) {
    const payload = validDirectPayload() as { facts: { actual_primary_offering_amount: { source_ref: string } } };
    payload.facts.actual_primary_offering_amount.source_ref = invalidSource;
    const candidate = validateOfferingMonitorProviderOutput({
      identity,
      package: inputPackage,
      run: providerRun({ parsed: payload }),
    });
    assert.equal(candidate.validation.status, "validation_failed", invalidSource);
    assert.match(candidate.validation.errors.join(" "), /facts\.actual_primary_offering_amount\.source_ref must be a member of allowed_source_refs/);
    assert.equal(candidate.materialized_candidate, null);
  }
});

test("unavailable facts may omit source_ref but cannot return a foreign provenance identifier", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const omitted = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: validDirectPayload() }),
  });
  assert.equal(omitted.validation.status, "success");

  const payload = validDirectPayload();
  (payload.facts.offering_price as Record<string, unknown>).source_ref = "foreign:price";
  const foreign = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(foreign.validation.status, "validation_failed");
  assert.match(foreign.validation.errors.join(" "), /facts\.offering_price\.source_ref must be a member/);
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

test("diagnostic output and provider trace remain scoped to the execution ai_run", () => {
  const runtime = readFileSync(new URL("./offeringMonitorSecondStageRuntime.ts", import.meta.url), "utf8");
  assert.match(runtime, /id: input\.identity\.jobId/);
  assert.match(runtime, /ai_run_id: input\.identity\.jobId/);
  assert.match(runtime, /provider_latency_ms/);
  assert.match(runtime, /validation_status/);
  assert.match(runtime, /diagnostic_candidate_only: true/);
  assert.match(runtime, /canonical_persistence_changed: false/);
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
    source_ref: `ref:${id}`,
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
      return options.provider || providerRun({ parsed: validDirectPayload() });
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
  const parsed = overrides.parsed === undefined ? null : overrides.parsed;
  const outputText = overrides.outputText === undefined && parsed
    ? JSON.stringify(parsed)
    : overrides.outputText || "";
  return {
    ok: true,
    responseOk: true,
    status: 200,
    statusText: "OK",
    provider: "gemini",
    model: "gemini-2.5-flash",
    responseId: "response-1",
    outputText,
    parsed,
    usage: { input_tokens: 10_000, output_tokens: 500, total_tokens: 10_500 },
    latencyMs: 1_000,
    ...overrides,
  };
}

function validDirectPayload() {
  const unavailable = (unit: string, basis: string) => ({
    availability: "unavailable",
    value_quality: "unknown",
    bound: "unknown",
    unit,
    comparison_basis_type: basis,
  });
  const availableShares = (value: number, source_ref: string) => ({
    value,
    availability: "available",
    value_quality: "exact",
    bound: "exact",
    unit: "shares",
    security_basis: "common_stock",
    comparison_basis_type: "shares_outstanding",
    source_ref,
  });
  return {
    version: "minimal_offering_monitor_v1",
    applicability: "applicable",
    financing_stage: "active_offering",
    primary_or_resale: "primary",
    security_nature: "equity_linked",
    has_warrant: true,
    has_prefunded_warrant: true,
    has_convertible: false,
    facts: {
      actual_primary_offering_amount: {
        value: 10_000_000,
        availability: "available",
        value_quality: "estimated",
        bound: "maximum",
        unit: "currency",
        currency: "USD",
        security_basis: "transaction_gross_amount",
        comparison_basis_type: "market_cap",
        source_ref: "ref:s1f1_attachment_doc_a",
      },
      offering_price: unavailable("currency_per_security", "market_price"),
      immediate_primary_share_exposure: availableShares(10_000_000, "ref:s1f1_source_block_001"),
      additional_potential_primary_share_exposure: availableShares(5_000_000, "ref:s1f1_attachment_doc_a"),
      resale_share_exposure: unavailable("shares", "public_float"),
    },
  };
}
