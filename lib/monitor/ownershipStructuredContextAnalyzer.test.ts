import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GeminiStructuredJsonRun } from "../ai/geminiStructuredJson.ts";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
  type OwnershipContextReferenceInventory,
} from "./ownershipStructuredContext.ts";
import {
  OWNERSHIP_CONTEXT_AI_PROMPT_KEY,
  OWNERSHIP_CONTEXT_AI_PROMPT_VERSION,
  OWNERSHIP_CONTEXT_LLM_VERSION,
  OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION,
  OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION,
  OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION,
  buildOwnershipContextAiTraceRows,
  buildOwnershipOneCallContextPrompt,
  buildOwnershipStructuredContextPrompt,
  mapOwnershipContextLlmDto,
  persistOwnershipOneCallContext,
  runOwnershipStructuredContextAnalysis,
  type OwnershipStructuredContextAnalyzerRepository,
} from "./ownershipStructuredContextAnalyzer.ts";
import { OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION } from "./ownershipNeutralSourceBlocks.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const outputId = "55555555-5555-4555-8555-555555555555";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;

test("prompt exposes only closed short choices while internal audit and canonical IDs stay server-only", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const baseline = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory });
  const corrupted = structuredClone(inventory) as unknown as OwnershipContextReferenceInventory;
  for (const row of corrupted.rows as unknown as Row[]) {
    row.direct = {
      transactionKind: "PARSER_KIND_MUST_NOT_LEAK",
      acquiredDisposedCode: "PARSER_AD_MUST_NOT_LEAK",
      directOrIndirectOwnership: "PARSER_RELATION_MUST_NOT_LEAK",
      is10b51: "PARSER_10B5_MUST_NOT_LEAK",
      allowedUnderlyingSecurityRefs: ["PARSER_UNDERLYING_MUST_NOT_LEAK"],
    };
    row.semantic_warnings = ["PARSER_WARNING_MUST_NOT_LEAK"];
    row.signals = ["PRIMARY_SIGNAL_MUST_NOT_LEAK"];
  }
  const afterCorruption = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory: corrupted });
  assert.deepEqual(afterCorruption, baseline, "parser semantic fields cannot influence the request");

  const user = JSON.parse(baseline.user) as Row;
  assert.deepEqual(Object.keys(user).sort(), [
    "accession_number", "choices", "form", "issuer_identity", "neutral_source_blocks", "output_contract", "output_example",
  ]);
  const serialized = JSON.stringify({ system: baseline.system, user });
  assert.equal(serialized.includes(String(state.rawItem.raw_payload.ownership_source_text)), false);
  assert.doesNotMatch(serialized, /<ownershipDocument|original_sec_ownership_xml/);
  assert.doesNotMatch(serialized,
    /ownership:(?:leaf|attribute|locator|xml-underlying|block)|(?:row|owner|security|evidence):form(?:4|144)|source_fingerprint|source_sha256/i);
  assert.doesNotMatch(serialized, /PARSER_(?:KIND|AD|RELATION|10B5|UNDERLYING|WARNING)_MUST_NOT_LEAK|PRIMARY_SIGNAL_MUST_NOT_LEAK/);
  assert.match(baseline.system, /Choose only the exact R, O, S, and F references/);
  assert.match(baseline.system, /server alone binds them to internal/);
  assert.deepEqual(user.output_contract, baseline.responseFormat.json_schema);
  assert.deepEqual(user.output_example, {
    note: "Empty-result shape only. output_contract and each row's available_fields are authoritative for every non-empty result.",
    version: OWNERSHIP_CONTEXT_LLM_VERSION,
    rows: [],
  });
  const choices = record(user.choices);
  assert.equal(choices.version, OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION);
  assert.deepEqual((choices.owners as Row[]).map((owner) => [owner.owner, owner.name]), [
    ["O1", "Mat Ishbia"], ["O2", "SFS HOLDING CORP"],
  ]);
  const choiceRows = choices.rows as Row[];
  assert.deepEqual(choiceRows.map((row) => row.row), ["R1", "R2", "R3", "R4", "R5"]);
  assert.deepEqual(choiceRows.map((row) => (row.securities as Row[])[0]?.security), ["S1", "S2", "S3", "S4", "S5"]);
  assert.deepEqual((choiceRows[4].securities as Row[]).map((security) => security.security), ["S5", "S6"]);
  assert.deepEqual(choiceRows[0].evidence, ["R1", "F1", "F2", "F3"]);
  assert.equal((choiceRows[0].available_fields as string[]).includes("owner_attribution"), false);
  assert.equal((choiceRows[0].available_fields as string[]).includes("rule_10b5_1"), true);
  assert.equal((choiceRows[0].available_fields as string[]).includes("footnote_scopes"), false);
  assert.equal((choiceRows[2].available_fields as string[]).includes("rule_10b5_1"), false);
  const sourceBlocks = record(user.neutral_source_blocks);
  assert.equal(sourceBlocks.version, OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION);
  assert.equal(record(sourceBlocks.coverage).complete, true);
  assert.equal(serialized.includes("632874"), true, "exact XML lexical values remain available");
});

test("AGIG, VENU, and UWMC selection outputs map into the strict canonical validator", () => {
  const cases = [
    ["source-agig-form4-purchase.json", agigSelection],
    ["source-venu-form4-section16-derivative-gift.json", venuSelection],
    ["source-uwmc-form4-multi-owner-10b5-1-conversion.json", uwmcSelection],
  ] as const;
  for (const [filename, buildCandidate] of cases) {
    const state = canonicalState(filename);
    const inventory = inventoryFor(state);
    const mapping = mapOwnershipContextLlmDto({ candidate: buildCandidate(), source: sourceFor(state), inventory });
    assert.equal(mapping.ok, true, `${filename}: ${JSON.stringify(mapping)}`);
    if (!mapping.ok) continue;
    const validation = validateOwnershipContextCandidate(mapping.value, inventory);
    assert.equal(validation.ok, true, `${filename}: ${JSON.stringify(validation)}`);
    assert.equal(mapping.value.event_ref, inventory.eventRef);
    assert.equal(mapping.value.source_fingerprint, inventory.sourceFingerprint);
  }
});

test("multi-evidence selections are validated and deduplicated without changing Form 4 semantics", () => {
  const agig = canonicalState("source-agig-form4-purchase.json");
  const agigInventory = inventoryFor(agig);
  const agigMapping = mapOwnershipContextLlmDto({
    candidate: {
      version: OWNERSHIP_CONTEXT_LLM_VERSION,
      rows: [{
        row: "R1",
        owner_relations: [{ owner: "O1", relation: "direct", evidence: ["R1", "F1", "F1"] }],
      }],
    },
    source: sourceFor(agig),
    inventory: agigInventory,
  });
  assert.equal(agigMapping.ok, true, JSON.stringify(agigMapping));
  if (!agigMapping.ok) return;
  assert.equal(validateOwnershipContextCandidate(agigMapping.value, agigInventory).ok, true);
  const agigRows = agigMapping.value.rows as Row[];
  const agigAssertions = agigRows[0].assertions as Row[];
  const agigRelation = agigAssertions.find((assertion) => assertion.fact === "ownership_relation")!;
  assert.equal(agigRelation.footnote_ref, "footnote:F1");
  assert.equal((agigRelation.evidence_refs as string[]).length, 1);
  assert.equal(agigAssertions.some((assertion) => assertion.fact === "footnote_scope"), false);

  const venu = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const venuInventory = inventoryFor(venu);
  const venuMapping = mapOwnershipContextLlmDto({
    candidate: {
      version: OWNERSHIP_CONTEXT_LLM_VERSION,
      rows: [{
        row: "R1",
        derivative_underlying_relation: { underlying: "S2", evidence: ["R1", "F1", "R1"] },
      }],
    },
    source: sourceFor(venu),
    inventory: venuInventory,
  });
  assert.equal(venuMapping.ok, true, JSON.stringify(venuMapping));
  if (!venuMapping.ok) return;
  assert.equal(validateOwnershipContextCandidate(venuMapping.value, venuInventory).ok, true);
  const venuRows = venuMapping.value.rows as Row[];
  const venuAssertions = venuRows[0].assertions as Row[];
  const venuDerivative = venuAssertions.find((assertion) => assertion.fact === "derivative_underlying_relation")!;
  assert.equal(venuDerivative.footnote_ref, "footnote:F1");
  assert.equal(venuAssertions.some((assertion) => assertion.fact === "footnote_scope"), false);

  const uwmc = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const uwmcInventory = inventoryFor(uwmc);
  const uwmcCandidate = uwmcSelection();
  ((uwmcCandidate.rows as Row[])[4].derivative_underlying_relation as Row).evidence = ["R5", "F5", "F8", "F3", "F5"];
  const uwmcMapping = mapOwnershipContextLlmDto({ candidate: uwmcCandidate, source: sourceFor(uwmc), inventory: uwmcInventory });
  assert.equal(uwmcMapping.ok, true, JSON.stringify(uwmcMapping));
  if (!uwmcMapping.ok) return;
  assert.equal(validateOwnershipContextCandidate(uwmcMapping.value, uwmcInventory).ok, true);
  const uwmcRows = uwmcMapping.value.rows as Row[];
  const uwmcDerivative = (uwmcRows[4].assertions as Row[])
    .find((assertion) => assertion.fact === "derivative_underlying_relation")!;
  assert.equal(uwmcDerivative.value, "security:form4:underlying:4");
  assert.equal(Object.hasOwn(uwmcDerivative, "footnote_ref"), false,
    "multiple distinct supporting footnotes must not be collapsed to one arbitrary footnote");
  assert.deepEqual(uwmcDerivative.footnote_refs, ["footnote:F5", "footnote:F8", "footnote:F3"]);
});

test("UWMC maps two owner relations per row without any single-owner attribution", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const mapping = mapOwnershipContextLlmDto({ candidate: uwmcSelection(), source: sourceFor(state), inventory });
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  if (!mapping.ok) return;
  const rows = mapping.value.rows as Row[];
  for (const [index, row] of rows.entries()) {
    const assertions = row.assertions as Row[];
    assert.equal(assertions.some((assertion) => assertion.fact === "owner_attribution"), false);
    const relations = assertions.filter((assertion) => assertion.fact === "ownership_relation");
    assert.deepEqual(relations.map((relation) => [relation.owner_ref, relation.value]), [
      [`owner:form4:${index}:0`, "indirect"], [`owner:form4:${index}:1`, "direct"],
    ]);
    assert.equal(relations[0].footnote_ref, "footnote:F3");
  }
  const row3Direct = ((rows[2].assertions as Row[])
    .find((assertion) => assertion.fact === "ownership_relation" && assertion.owner_ref === "owner:form4:2:1"))!;
  assert.deepEqual(row3Direct.footnote_refs, ["footnote:F3", "footnote:F5"]);
  assert.equal(Object.hasOwn(row3Direct, "footnote_ref"), false);
  const row5Direct = ((rows[4].assertions as Row[])
    .find((assertion) => assertion.fact === "ownership_relation" && assertion.owner_ref === "owner:form4:4:1"))!;
  assert.deepEqual(row5Direct.footnote_refs, ["footnote:F3", "footnote:F5", "footnote:F8"]);
  const derivative = (rows[4].assertions as Row[]).find((assertion) => assertion.fact === "derivative_underlying_relation")!;
  assert.equal(derivative.security_ref, "security:form4:4");
  assert.equal(derivative.value, "security:form4:underlying:4");
  assert.deepEqual(derivative.footnote_refs, ["footnote:F5", "footnote:F8", "footnote:F3"]);
  const ruleRows = rows.flatMap((row, index) => (row.assertions as Row[])
    .filter((assertion) => assertion.fact === "rule_10b5_1_applicability")
    .map((assertion) => [index, assertion.owner_ref, assertion.footnote_ref]));
  assert.deepEqual(ruleRows, [[0, "owner:form4:0:1", "footnote:F1"], [1, "owner:form4:1:1", "footnote:F1"], [3, "owner:form4:3:1", "footnote:F1"]]);
});

test("closed mapper rejects forged choices, internal IDs, wrong enums, extra fields, self-links, and subject mismatches", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const invalid: Array<[string, Row]> = [
    ["internal row", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "row:form4:0" }] }],
    ["internal owner", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "owner:form4:0:1", relation: "direct", evidence: ["F3"] }] }] }],
    ["forged footnote", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "O2", relation: "direct", evidence: ["F99"] }] }] }],
    ["multi evidence with forged footnote", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "O2", relation: "direct", evidence: ["F3", "F99"] }] }] }],
    ["wrong relation", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "O2", relation: "owned", evidence: ["F3"] }] }] }],
    ["extra field", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", score: 1 }] }],
    ["Form 4 footnote scope field", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "row" }] }] }],
    ["self link", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R5", derivative_underlying_relation: { underlying: "S5", evidence: ["F5"] } }] }],
    ["unlinked footnote", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R3", owner_relations: [{ owner: "O2", relation: "direct", evidence: ["F1"] }] }] }],
    ["multi evidence with unlinked footnote", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R3", owner_relations: [{ owner: "O2", relation: "direct", evidence: ["F3", "F1"] }] }] }],
    ["missing evidence", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "O2", relation: "direct", evidence: [] }] }] }],
    ["duplicate owner", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [
      { owner: "O2", relation: "direct", evidence: ["F3"] }, { owner: "O2", relation: "indirect", evidence: ["F3"] },
    ] }] }],
    ["false with owner", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", rule_10b5_1: { applies: false, owner: "O2", evidence: ["R1"] } }] }],
    ["row scope owner null", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "row", owner: null }] }] }],
    ["row scope forged redundant owner", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "row", owner: "O99" }] }] }],
    ["row scope forged supplemental evidence", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "row", evidence: ["F3", "F99"] }] }] }],
    ["security number", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "security", security: 1 }] }] }],
    ["owner scope with security", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "owner", owner: "O2", security: "S1" }] }] }],
    ["security scope with owner", { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", footnote_scopes: [{ footnote: "F3", scope: "security", security: "S1", owner: "O2" }] }] }],
  ];
  for (const [label, candidate] of invalid) {
    const mapping = mapOwnershipContextLlmDto({ candidate, source: sourceFor(state), inventory });
    assert.equal(mapping.ok, false, `${label}: ${JSON.stringify(mapping)}`);
  }
  const ambiguousInventory = structuredClone(inventory) as unknown as OwnershipContextReferenceInventory;
  (ambiguousInventory.rows[0] as unknown as Row).evidenceRefs = ["evidence:form4:0:0", "evidence:form4:0:1"];
  const ambiguous = mapOwnershipContextLlmDto({
    candidate: { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_relations: [{ owner: "O2", relation: "direct", evidence: ["F3"] }] }] },
    source: sourceFor(state), inventory: ambiguousInventory,
  });
  assert.equal(ambiguous.ok, false, "a non-unique canonical evidence binding is never chosen arbitrarily");
});

test("Form 144 fixtures expose no forced account attribution or inapplicable semantic choices", () => {
  for (const filename of ["source-amcor-form144-no-prior-sales.json", "source-walmart-form144-namespaced.json"]) {
    const state = canonicalState(filename);
    const inventory = inventoryFor(state);
    const prompt = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory });
    const text = JSON.stringify(prompt.responseFormat.json_schema);
    for (const forbidden of ["owner_attribution", "owner_relations", "rule_10b5_1", "derivative_underlying_relation", "footnote_scopes"]) {
      assert.equal(text.includes(`\"${forbidden}\"`), false, `${filename}: ${forbidden}`);
    }
    const empty = mapOwnershipContextLlmDto({ candidate: { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [] }, source: sourceFor(state), inventory });
    assert.equal(empty.ok, true, filename);
    const forced = mapOwnershipContextLlmDto({
      candidate: { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{ row: "R1", owner_attribution: { owner: "O1", evidence: ["R1"] } }] },
      source: sourceFor(state), inventory,
    });
    assert.equal(forced.ok, false, `${filename}: account attribution is not a wire field`);
  }
});

test("schema is row-specific and contains only advertised choices", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const prompt = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory: inventoryFor(state) });
  const schema = prompt.responseFormat.json_schema as Row;
  assert.deepEqual(record(record(schema.properties).version), { type: "string", enum: [OWNERSHIP_CONTEXT_LLM_VERSION] });
  const rowItems = record(record(schema.properties).rows).items as Row;
  const rowSchemas = rowItems.anyOf as Row[];
  assert.equal(rowSchemas.length, 5);
  const r1 = rowSchemas.find((candidate) => (record(record(candidate.properties).row).enum as string[])[0] === "R1")!;
  const r3 = rowSchemas.find((candidate) => (record(record(candidate.properties).row).enum as string[])[0] === "R3")!;
  const r5 = rowSchemas.find((candidate) => (record(record(candidate.properties).row).enum as string[])[0] === "R5")!;
  assert.equal(Object.hasOwn(record(r1.properties), "owner_attribution"), false);
  assert.equal(Object.hasOwn(record(r1.properties), "rule_10b5_1"), true);
  assert.equal(Object.hasOwn(record(r3.properties), "rule_10b5_1"), false);
  assert.deepEqual(record(record(record(r5.properties).derivative_underlying_relation).properties).underlying,
    { type: "string", enum: ["S6"] });
  const r5DerivativeEvidence = record(record(record(record(r5.properties).derivative_underlying_relation).properties).evidence);
  assert.equal(r5DerivativeEvidence.minItems, 1);
  assert.equal(r5DerivativeEvidence.maxItems, 4);
  assert.equal(r5DerivativeEvidence.uniqueItems, true);
  assert.deepEqual(record(r5DerivativeEvidence.items).enum, ["R5", "F5", "F8", "F3"]);
  assert.equal(Object.hasOwn(record(r1.properties), "footnote_scopes"), false);
  const serialized = JSON.stringify(schema);
  assert.doesNotMatch(serialized, /status|evidence_ids|owner_id|security_id|row_id|target_security_id|source_security_id/);
  assert.doesNotMatch(serialized, /owner:form|security:form|row:form|evidence:form/);
});

test("default analysis persists mapped context without verifier and preserves direct rows", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const before = structuredClone(state.form4);
  const calls: string[] = [];
  const repository = repositoryFor(state, calls);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository, apiKey: "fixture-key", model: "fixture-model",
    runPrompt: async () => { calls.push("provider"); return providerRun(agigSelection()); },
    idFactory: idSequence(runId, outputId),
    now: timeSequence("2026-09-15T01:00:00.000Z", "2026-09-15T01:00:01.000Z"),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  if (result.status !== "stored" && result.status !== "replayed") return;
  assert.deepEqual(result.semanticVerification, { mode: "disabled", verified: false });
  assert.deepEqual(calls, ["provider", "ai_trace", "context"]);
  assert.deepEqual(state.form4, before);
  assert.equal(repository.state.semanticTraces.length, 0);
  assert.equal(JSON.stringify(repository.state.contextWrites[0]).includes("shares"), false);
  const trace = buildOwnershipContextAiTraceRows(repository.state.aiTraces[0] as never);
  assert.equal(trace.run.prompt_key, OWNERSHIP_CONTEXT_AI_PROMPT_KEY);
  assert.equal(trace.run.prompt_version, OWNERSHIP_CONTEXT_AI_PROMPT_VERSION);
  assert.equal(trace.run.metadata.provider_contract_version, OWNERSHIP_CONTEXT_LLM_VERSION);
  assert.equal(trace.run.metadata.wire_contract_version, OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION);
  assert.equal(trace.run.metadata.neutral_source_blocks_version, OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION);
  assert.equal(trace.run.metadata.neutral_inventory_version, OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION);
  assert.equal(trace.output.output_type, "ownership_context_v1");
  assert.deepEqual(trace.output.payload.mapping_errors, []);
  const tracedUser = JSON.parse(String(trace.output.payload.request.user)) as Row;
  assert.equal(trace.run.metadata.neutral_inventory_sha256, sha256Json(tracedUser.choices));
  assert.equal(trace.run.metadata.neutral_source_blocks_sha256, sha256Json(tracedUser.neutral_source_blocks));
});

test("one-call selection binds to official rows and saves without another provider run", async () => {
  for (const [fixture, selection] of [
    ["source-agig-form4-purchase.json", agigSelection],
    ["source-uwmc-form4-multi-owner-10b5-1-conversion.json", uwmcSelection],
    ["source-amcor-form144-no-prior-sales.json", () => ({ version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [] })],
  ] as const) {
    const state = canonicalState(fixture);
    const before = structuredClone({ form4: state.form4, form144: state.form144 });
    const calls: string[] = [];
    const repository = repositoryFor(state, calls);
    const prepared = buildOwnershipOneCallContextPrompt(state.rawItem);
    const result = await persistOwnershipOneCallContext({
      eventId, rawItem: state.rawItem, candidate: selection(),
      promptSha256: prepared.promptSha256,
      aiRefs: { run_id: runId, output_id: outputId }, model: "gemini-3.5-flash",
    }, repository);
    assert.equal(result.status, "stored", `${fixture}: ${JSON.stringify(result)}`);
    assert.deepEqual(calls, ["context"], "one-call persistence must not invoke a provider or create another AI run");
    assert.deepEqual({ form4: state.form4, form144: state.form144 }, before);
    assert.equal(record(repository.state.contextWrites[0].aiRefs).run_id, runId);
    const stale = await persistOwnershipOneCallContext({
      eventId, rawItem: state.rawItem, candidate: selection(),
      promptSha256: "0".repeat(64),
      aiRefs: { run_id: runId, output_id: outputId }, model: "gemini-3.5-flash",
    }, repository);
    assert.equal(stale.status, "unavailable");
    assert.deepEqual(calls, ["context"]);
  }
});

test("provider and source failures remain trace-only or pre-provider failures", async () => {
  const failed = canonicalState("source-agig-form4-purchase.json");
  const failedRepository = repositoryFor(failed, []);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: failed.rawItem }, {
    repository: failedRepository, apiKey: "fixture-key",
    runPrompt: async () => providerRun(null, { ok: false, error: "fixture provider failure" }),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.equal(result.stage, "provider");
  assert.equal(failedRepository.state.aiTraces.length, 1);
  assert.equal(failedRepository.state.contextWrites.length, 0);

  const drift = canonicalState("source-agig-form4-purchase.json");
  drift.form4[0].reporting_owner_names = ["Parser-only owner"];
  let providerCalls = 0;
  const driftResult = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: drift.rawItem }, {
    repository: repositoryFor(drift, []), apiKey: "fixture-key",
    runPrompt: async () => { providerCalls += 1; return providerRun(null); },
  });
  assert.equal(driftResult.status, "unavailable");
  if (driftResult.status === "unavailable") assert.equal(driftResult.stage, "source");
  assert.equal(providerCalls, 0);
});

test("historical provider wire remains immutable evidence and cannot enter the new contract", () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const inventory = inventoryFor(state);
  const path = join(here, "fixtures/ownership-context-actual-provider-8f1939b5-venu.txt");
  const oldText = readFileSync(path, "utf8");
  const mapping = mapOwnershipContextLlmDto({ candidate: JSON.parse(oldText) as Row, source: sourceFor(state), inventory });
  assert.equal(mapping.ok, false);
  assert.equal(sha256(readFileSync(path, "utf8")), sha256(oldText));
});

test("Form 4 prompt and wire versions track the route-specific footnote-scope removal", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const prompt = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory: inventoryFor(state) });
  assert.match(prompt.system, /Subject, then Scope, then Evidence, then Relation/);
  assert.match(prompt.system, /Table I non-derivative securities and Table II derivative securities/);
  assert.match(prompt.system, /do not emit footnote_scopes/);
  assert.equal(JSON.stringify(prompt.responseFormat.json_schema).includes("footnote_scopes"), false);
  assert.equal(OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION, "ownership_context_semantic_v1.2-form4-no-footnote-scopes");
  assert.equal(OWNERSHIP_CONTEXT_AI_PROMPT_VERSION, "ownership_context_selection_v1.5-form4-no-footnote-scopes");
  assert.equal(OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION, "ownership_context_selection_wire_v4-form4-no-footnote-scopes");
  assert.equal(OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION, "ownership_context_selection_refs_v1");
  assert.equal(OWNERSHIP_CONTEXT_LLM_VERSION, "ownership_context_selection_v1");
});

test("provider JSON mode keeps the strict contract in trace without sending responseSchema", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const repository = repositoryFor(state, []);
  let providerRequest: Row | null = null;
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository, apiKey: "fixture-key",
    runPrompt: async (input) => { providerRequest = input as unknown as Row; return providerRun({ version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [] }); },
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  assert.ok(providerRequest);
  assert.equal(Object.hasOwn(providerRequest, "responseSchema"), false);
  const trace = buildOwnershipContextAiTraceRows(repository.state.aiTraces[0] as never);
  assert.equal(trace.output.payload.request.response_mode, "application/json");
  assert.equal(trace.output.payload.request.provider_response_schema, null);
  assert.deepEqual(trace.output.payload.request.response_format,
    buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory }).responseFormat);
});

test("SEC ingest keeps context sidecar before the unchanged matcher and exposes no delivery path", () => {
  const ingest = readFileSync(join(here, "../secFilingAnalysisIngest.ts"), "utf8");
  const analyzer = readFileSync(join(here, "ownershipStructuredContextAnalyzer.ts"), "utf8");
  const matcher = readFileSync(join(here, "../listingMonitorMatcher.ts"), "utf8");
  const successSidecar = ingest.indexOf("const ownershipStructuredContext = primaryPromptKey");
  const successMatcher = ingest.indexOf("const ownershipMonitorConditionExecution = primaryPromptKey");
  assert.ok(successSidecar >= 0 && successSidecar < successMatcher);
  assert.match(matcher, /provenance\.reporting_owner_scope === "filing_level_unattributed_owner_set"/);
  assert.match(matcher, /ownership_reporter_attribution_unavailable/);
  assert.equal(matcher.includes("owner_attribution"), false);
  assert.doesNotMatch(analyzer, /runAlertDelivery|sendTelegram|sendEmail|enqueueGenericMonitor|score\s*:/i);
});

function agigSelection(): Row {
  return { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [
    { row: "R1", owner_relations: [{ owner: "O1", relation: "direct", evidence: ["R1"] }] },
    { row: "R2", owner_relations: [{ owner: "O1", relation: "direct", evidence: ["R2"] }] },
  ] };
}

function venuSelection(): Row {
  return { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows: [{
    row: "R1", owner_relations: [{ owner: "O1", relation: "direct", evidence: ["R1"] }],
    derivative_underlying_relation: { underlying: "S2", evidence: ["R1"] },
  }] };
}

function uwmcSelection(): Row {
  const rows = ["R1", "R2", "R3", "R4", "R5"].map((row) => ({ row, owner_relations: [
    { owner: "O1", relation: "indirect", evidence: ["F3"] },
    { owner: "O2", relation: "direct", evidence: ["F3"] },
  ] })) as Row[];
  (rows[2].owner_relations as Row[])[1].evidence = ["F3", "F5"];
  (rows[4].owner_relations as Row[])[1].evidence = ["F3", "F5", "F8"];
  for (const index of [0, 1, 3]) rows[index].rule_10b5_1 = { applies: true, owner: "O2", evidence: ["F1"] };
  rows[4].derivative_underlying_relation = { underlying: "S6", evidence: ["R5", "F5", "F8", "F3"] };
  return { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows };
}

function canonicalState(filename: string) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row & { source: Row };
  const sourceText = String(fixture.filingText);
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const rawItem = { id: rawItemId, source_code: "sec_edgar", source_unique_id: accession, raw_payload: {
    form_type: formType, accession_number: accession, cik: issuerCik, ownership_issuer_cik: issuerCik,
    ticker, ...(ticker ? { ownership_issuer_trading_symbol: ticker } : {}), ownership_source_text: sourceText,
    ownership_source_url: String(fixture.source?.url || `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`),
    ownership_source_format: "ownership_xml", ownership_source_text_truncated: false,
  } };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
  return {
    formType, rawItem,
    event: { id: eventId, raw_item_id: rawItemId, source_code: "sec_edgar", source_group: "filings",
      event_type: "insider_ownership", metadata: { form_type: formType, accession_number: accession } },
    form4: structuredClone(built.form4Transactions), form144: structuredClone(built.form144ProposedSales),
  };
}

function sourceFor(state: ReturnType<typeof canonicalState>) {
  const payload = state.rawItem.raw_payload;
  return {
    xml: payload.ownership_source_text, form: payload.form_type, accessionNumber: payload.accession_number,
    issuerCik: String(payload.ownership_issuer_cik),
    issuerTradingSymbol: "ownership_issuer_trading_symbol" in payload ? payload.ownership_issuer_trading_symbol ?? null : null,
    issuerName: xmlValue(payload.ownership_source_text, "issuerName"),
    reportingOwners: xmlOwners(payload.ownership_source_text, state.form4.length ? "form4" : "form144"),
  };
}

function inventoryFor(state: ReturnType<typeof canonicalState>) {
  const form = state.form4.length ? "form4" as const : "form144" as const;
  return buildOwnershipContextReferenceInventory({ eventId, form, isAmendment: state.formType.endsWith("/A"),
    sourceFingerprint: fingerprint, rows: form === "form4" ? state.form4 : state.form144,
    sourceXml: state.rawItem.raw_payload.ownership_source_text });
}

function repositoryFor(state: ReturnType<typeof canonicalState>, calls: string[]) {
  const repository: OwnershipStructuredContextAnalyzerRepository & {
    state: { aiTraces: Row[]; semanticTraces: Row[]; contextWrites: Row[] };
  } = {
    state: { aiTraces: [], semanticTraces: [], contextWrites: [] },
    async readContextSnapshot() { return { ok: true, status: 200, data: {
      event: state.event, form4_rows: state.form4, form144_rows: state.form144,
      ownership_source_text: state.rawItem.raw_payload.ownership_source_text,
      context_fingerprint: { status: "available", form: state.form4.length ? "form4" : "form144",
        source_fingerprint: fingerprint, context_ai_refs_valid: true }, context_semantic_verifier_refs_valid: false,
    } }; },
    async select() { return { ok: false, status: 500, data: null, error: "snapshot expected" }; },
    async persistAiTrace(input) { calls.push("ai_trace"); repository.state.aiTraces.push(structuredClone(input) as unknown as Row); },
    async persistSemanticVerifierTrace(input) { calls.push("semantic_trace"); repository.state.semanticTraces.push(structuredClone(input) as unknown as Row); },
    async persistContext(input) { calls.push("context"); repository.state.contextWrites.push(structuredClone(input) as unknown as Row);
      return { ok: true, status: 200, data: { status: "stored", updated_row_count: input.contexts.length } }; },
  };
  return repository;
}

function providerRun(parsed: Row | null, overrides: Partial<GeminiStructuredJsonRun> = {}): GeminiStructuredJsonRun {
  return { ok: Boolean(parsed), responseOk: true, status: 200, statusText: "OK", model: "fixture-model",
    responseId: "fixture-response", outputText: parsed ? JSON.stringify(parsed) : "", parsed,
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, body: null, ...overrides };
}
function idSequence(...values: string[]) { let index = 0; return () => values[index++] ?? "77777777-7777-4777-8777-777777777777"; }
function timeSequence(...values: string[]) { let index = 0; return () => values[index++] ?? values.at(-1)!; }
function xmlValue(sourceText: string, localName: string) { const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null; }
function xmlOwners(sourceText: string, form: "form4" | "form144") {
  if (form === "form144") { const name = xmlValue(sourceText, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold"); return name ? [{ cik: null, name }] : []; }
  return Array.from(sourceText.matchAll(/<reportingOwner\b[^>]*>([\s\S]*?)<\/reportingOwner>/gi))
    .map((match) => ({ cik: xmlValue(match[1] || "", "rptOwnerCik"), name: xmlValue(match[1] || "", "rptOwnerName") || "" }))
    .filter((owner) => Boolean(owner.name));
}
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sha256Json(value: unknown) { return sha256(JSON.stringify(value)); }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
