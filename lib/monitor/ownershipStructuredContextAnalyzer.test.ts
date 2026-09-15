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
  buildOwnershipStructuredContextResponseSchema,
  buildOwnershipContextAiTraceRows,
  buildOwnershipSemanticVerifierTraceRows,
  buildOwnershipStructuredContextPrompt,
  mapOwnershipContextLlmDto,
  runOwnershipStructuredContextAnalysis,
  type OwnershipStructuredContextAnalyzerRepository,
} from "./ownershipStructuredContextAnalyzer.ts";
import { routeOwnershipSemanticPrompt } from "./ownershipSemanticPrompts/router.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const outputId = "55555555-5555-4555-8555-555555555555";
const verifierRunId = "66666666-6666-4666-8666-666666666666";
const verifierOutputId = "77777777-7777-4777-8777-777777777777";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;

test("prompt contains only original XML, source identity, neutral refs, and the v1 output contract", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const baseline = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory });
  const corrupted = structuredClone(inventory) as unknown as Row;
  const rows = corrupted.rows as Row[];
  for (const row of rows) {
    row.direct = {
      transactionKind: "PARSER_KIND_MUST_NOT_LEAK",
      acquiredDisposedCode: "PARSER_AD_MUST_NOT_LEAK",
      directOrIndirectOwnership: "PARSER_RELATION_MUST_NOT_LEAK",
      is10b51: "PARSER_10B5_MUST_NOT_LEAK",
      allowedUnderlyingSecurityRefs: ["PARSER_UNDERLYING_MUST_NOT_LEAK"],
    };
    row.semantic_warnings = ["PARSER_WARNING_MUST_NOT_LEAK"];
    row.signals = ["PRIMARY_SIGNAL_MUST_NOT_LEAK"];
    row.linkedFootnoteRefs = [];
  }
  const corruptedSource = sourceFor(state);
  corruptedSource.reportingOwners = corruptedSource.reportingOwners.map((_owner, index) => ({
    cik: `PARSER_OWNER_CIK_MUST_NOT_LEAK_${index}`,
    name: `PARSER_OWNER_NAME_MUST_NOT_LEAK_${index}`,
  }));
  const afterCorruption = buildOwnershipStructuredContextPrompt({
    source: corruptedSource,
    inventory: corrupted as unknown as OwnershipContextReferenceInventory,
  });
  assert.deepEqual(afterCorruption, baseline, "parser semantic corruption cannot influence the LLM request");

  const user = JSON.parse(baseline.user) as Row;
  assert.deepEqual(Object.keys(user).sort(), [
    "accession_number", "form", "issuer_identity", "original_sec_ownership_xml",
    "output_contract", "output_example", "reference_inventory",
  ]);
  const serialized = JSON.stringify({ system: baseline.system, user });
  for (const forbidden of [
    "PARSER_KIND_MUST_NOT_LEAK", "PARSER_AD_MUST_NOT_LEAK", "PARSER_RELATION_MUST_NOT_LEAK",
    "PARSER_10B5_MUST_NOT_LEAK", "PARSER_UNDERLYING_MUST_NOT_LEAK",
    "PARSER_WARNING_MUST_NOT_LEAK", "PRIMARY_SIGNAL_MUST_NOT_LEAK",
    "PARSER_OWNER_CIK_MUST_NOT_LEAK", "PARSER_OWNER_NAME_MUST_NOT_LEAK",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.match(baseline.system, /output_contract; that contract is authoritative/);
  assert.match(baseline.system, /Every supported fact must include its contract-required typed value and at least one evidence_id/);
  assert.match(baseline.system, /Use only opaque references supplied for that row or its mechanically linked footnotes/);
  assert.match(baseline.system, /never copy locator or binding objects into output/);
  assert.match(baseline.system, /never return null/);
  assert.doesNotMatch(baseline.system, /Return exactly ownership_context_llm_v1 JSON/);
  assert.doesNotMatch(baseline.system, /owner_attribution uses owner_id/);
  assert.doesNotMatch(baseline.system, /derivative_underlying_relation uses target_security_id/);
  assert.doesNotMatch(baseline.system, /rule_10b5_1 uses applies/);
  assert.doesNotMatch(baseline.system, /amendment_effect uses effect/);
  assert.doesNotMatch(baseline.system, /every returned row, emit each of the seven/);
  assert.deepEqual(user.output_contract, baseline.responseFormat.json_schema);
  assert.deepEqual(user.output_example, {
    note: "Empty-result shape only. The supplied output_contract and each row's allowed_fact_fields are authoritative for every non-empty result.",
    version: "ownership_context_llm_v1",
    rows: [],
  });
  const referenceRows = record(user.reference_inventory).rows;
  assert.equal(record(user.reference_inventory).version, OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION);
  assert.ok(Array.isArray(referenceRows));
  assert.ok(Array.isArray(record((referenceRows as Row[])[0]).owner_ids));
  assert.ok(Array.isArray(record((referenceRows as Row[])[0]).evidence_ids));
  assert.equal(Object.hasOwn(record(user.reference_inventory), "event_ref"), false);
  assert.equal(Object.hasOwn(record(user.reference_inventory), "source_fingerprint"), false);
  assert.equal(serialized.includes("632874"), true, "numbers may appear only inside the allowed original XML");
  const schemaText = JSON.stringify(baseline.responseFormat.json_schema);
  assert.equal(schemaText.includes('"value"'), false);
  assert.equal(schemaText.includes('"assertions"'), false);
  assert.equal(schemaText.includes('"owner_id"'), true);
  assert.equal(schemaText.includes('"evidence_ids"'), true);
  assert.equal(schemaText.includes('"economic_direction"'), false);
  assert.match(baseline.system, /Subject, then Scope, then Evidence, then Relation/);
  assert.match(baseline.system, /P=open-market\/private purchase/);
});

test("supported context saves trace before sanitized context without changing canonical numbers", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const candidate = candidateFor(inventory, 0, [
    supported("owner_attribution", inventory.rows[0].ownerRefs[0], inventory.rows[0].evidenceRefs[0]),
    supported("ownership_relation", "direct", inventory.rows[0].evidenceRefs[0]),
    unresolved("derivative_underlying_relation", inventory.rows[0].securityRef),
    unresolved("rule_10b5_1_applicability"),
    supported("footnote_scope", "row", inventory.rows[0].evidenceRefs[0]),
    unresolved("amendment_effect"),
  ]);
  const before = structuredClone(state.form4);
  const calls: string[] = [];
  const repository = repositoryFor(state, calls);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "fixture-key",
    model: "fixture-model",
    runPrompt: async () => {
      calls.push("provider");
      return providerRun(candidate);
    },
    semanticVerifier: {
      name: "offline-supported-stub",
      async verify(request) {
        return {
          verdict: "supported",
          evidence_refs: request.input.evidence.map((item) => item.evidence_ref),
          short_reason: "The cited SEC XML supports the unchanged candidate assertion.",
        };
      },
    },
    idFactory: idSequence(runId, outputId),
    now: timeSequence("2026-09-15T01:00:00.000Z", "2026-09-15T01:00:01.000Z"),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  assert.deepEqual(calls, ["provider", "ai_trace", "semantic_trace", "context"]);
  assert.deepEqual(state.form4, before, "the context sidecar cannot mutate direct parser rows");
  assert.equal(repository.state.aiTraces[0]?.runId, runId);
  assert.equal(repository.state.aiTraces[0]?.outputId, outputId);
  assert.equal(repository.state.semanticTraces.length, 1);
  assert.equal(record(repository.state.aiTraces[0]?.prompt).user, buildOwnershipStructuredContextPrompt({
    source: sourceFor(state), inventory,
  }).user);
  const traceRows = buildOwnershipContextAiTraceRows(
    repository.state.aiTraces[0] as unknown as Parameters<typeof buildOwnershipContextAiTraceRows>[0],
  );
  assert.equal(traceRows.run.prompt_key, "ownership_structured_context");
  assert.equal(traceRows.run.prompt_version, "ownership_context_llm_v1.3-required-supported-values");
  assert.equal(traceRows.run.metadata.semantic_prompt_route, "form4");
  assert.equal(traceRows.run.metadata.semantic_prompt_version, OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION);
  assert.equal(traceRows.run.metadata.purpose, "ownership_structured_context");
  assert.equal(traceRows.run.metadata.provider_contract_version, "ownership_context_llm_v1");
  assert.equal(traceRows.run.metadata.canonical_contract_version, "ownership_context_v1");
  assert.equal(traceRows.run.model, "fixture-model");
  assert.equal(traceRows.output.output_type, "ownership_context_v1");
  assert.equal(
    JSON.parse(traceRows.output.payload.request.user).original_sec_ownership_xml,
    state.rawItem.raw_payload.ownership_source_text,
  );
  assert.equal(traceRows.output.payload.output_text, JSON.stringify(candidate));
  assert.equal(traceRows.output.payload.request.semantic_prompt_route, "form4");
  const tracedPrompt = repository.state.aiTraces[0]?.prompt as unknown as {
    system: string;
    user: string;
    responseFormat: { json_schema: Row };
  };
  const tracedUser = JSON.parse(tracedPrompt.user) as Row;
  const semanticRules = repository.state.aiTraces[0]?.semanticPromptRules;
  assert.equal(traceRows.run.metadata.semantic_prompt_sha256, sha256Json(semanticRules));
  assert.equal(traceRows.run.metadata.wire_contract_version, OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION);
  assert.equal(traceRows.run.metadata.neutral_inventory_version, OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION);
  assert.equal(traceRows.run.metadata.wire_contract_sha256, sha256Json(tracedPrompt.responseFormat.json_schema));
  assert.equal(traceRows.run.metadata.neutral_inventory_sha256, sha256Json(tracedUser.reference_inventory));
  assert.equal(traceRows.run.metadata.final_prompt_sha256, sha256Json(tracedPrompt));
  assert.equal(traceRows.output.payload.request.semantic_prompt_sha256, traceRows.run.metadata.semantic_prompt_sha256);
  assert.equal(traceRows.output.payload.request.wire_contract_version, OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION);
  assert.equal(traceRows.output.payload.request.neutral_inventory_version, OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION);
  assert.equal(traceRows.output.payload.request.wire_contract_sha256, traceRows.run.metadata.wire_contract_sha256);
  assert.equal(traceRows.output.payload.request.neutral_inventory_sha256, traceRows.run.metadata.neutral_inventory_sha256);
  assert.equal(traceRows.output.payload.request.final_prompt_sha256, traceRows.run.metadata.final_prompt_sha256);
  assert.deepEqual(traceRows.output.payload.parsed_output, candidate);
  assert.equal(record(traceRows.output.payload.mapped_canonical_output).version, "ownership_context_v1");
  assert.deepEqual(traceRows.output.payload.mapping_errors, []);
  assert.equal(record(repository.state.contextWrites[0]?.aiRefs).run_id, verifierRunId);
  const verifierTrace = buildOwnershipSemanticVerifierTraceRows(repository.state.semanticTraces[0] as never);
  assert.equal(verifierTrace.run.prompt_key, "ownership_semantic_verifier");
  assert.equal(verifierTrace.run.prompt_version, "ownership_semantic_verifier_v1");
  assert.equal(verifierTrace.output.payload.purpose, "ownership_semantic_verifier");
  assert.deepEqual(verifierTrace.output.payload.original_structured_candidate, result.validated);
  assert.deepEqual(verifierTrace.output.payload.effective_contexts, record(repository.state.contextWrites[0]).contexts);
  assert.equal(JSON.stringify(repository.state.contextWrites[0]).includes("shares"), false);
  assert.equal(JSON.stringify(repository.state.contextWrites[0]).includes("transaction_code"), false);
});

test("all four retained fixture kinds traverse the final prompt builder and trace their semantic route", async () => {
  const cases = [
    ["source-agig-form4-purchase.json", "form4", /Table I non-derivative securities and Table II derivative securities/],
    ["form4a-correction-row-safety.json", "form4A", /Do not assume full replacement/],
    ["source-amcor-form144-no-prior-sales.json", "form144", /proposed-sale notice, not proof that a sale was executed/],
    ["source-globe-form144a-no-remarks.json", "form144A", /Never describe a Form 144\/A amendment as an executed sale/],
  ] as const;
  for (const [filename, route, semanticRule] of cases) {
    const state = canonicalState(filename);
    const inventory = inventoryFor(state);
    const repository = repositoryFor(state, []);
    let capturedPrompt: Row | null = null;
    const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
      repository,
      apiKey: "fixture-key",
      runPrompt: async (input) => {
        capturedPrompt = input.prompt as unknown as Row;
        const promptUser = JSON.parse(input.prompt.user) as Row;
        const referenceRows = record(promptUser.reference_inventory).rows as Row[];
        return providerRun({
          version: "ownership_context_llm_v1",
          rows: referenceRows.map((referenceRow) => {
            const output: Row = { row_id: referenceRow.row_id };
            for (const field of referenceRow.allowed_fact_fields as string[]) {
              const unresolvedFact = {
                status: "unresolved",
                evidence_ids: [],
                ...(field === "derivative_underlying_relation"
                  ? { source_security_id: referenceRow.security_id }
                  : {}),
              };
              output[field] = field === "owner_relations"
                ? [{ ...unresolvedFact, owner_id: (referenceRow.owner_ids as string[])[0] }]
                : field === "footnote_scopes"
                  ? [{ ...unresolvedFact, footnote_ref: (referenceRow.linked_footnote_refs as string[])[0] }]
                  : unresolvedFact;
            }
            return output;
          }),
        });
      },
      idFactory: idSequence(runId, outputId),
    });
    assert.equal(result.status, "stored", `${filename}: ${JSON.stringify(result)}`);
    const assertedPrompt = capturedPrompt as unknown as Row | null;
    assert.ok(assertedPrompt);
    assert.match(String(assertedPrompt.system), semanticRule, filename);
    const promptUser = JSON.parse(String(assertedPrompt.user)) as Row;
    assert.equal(promptUser.original_sec_ownership_xml, state.rawItem.raw_payload.ownership_source_text, filename);
    const schemaText = JSON.stringify(record(assertedPrompt.responseFormat).json_schema);
    assert.equal(schemaText.includes('"economic_direction"'), false, filename);
    assert.equal(schemaText.includes('"amendment_effect"'), route.endsWith("A"), filename);
    assert.equal(repository.state.aiTraces[0]?.semanticPromptRoute, route, filename);
    const trace = buildOwnershipContextAiTraceRows(repository.state.aiTraces[0] as never);
    assert.equal(trace.run.metadata.semantic_prompt_route, route, filename);
    assert.equal(trace.output.payload.request.semantic_prompt_route, route, filename);
  }
});

test("real SEC fixture provenance covers simple buy, multi-owner conversion/10b5 context, and derivative gift", async () => {
  const cases = [
    ["source-agig-form4-purchase.json", "402dcda63b1796299c8c652bfb49fed0ceb39573060e899cdc6ff1406461f11e"],
    ["source-uwmc-form4-multi-owner-10b5-1-conversion.json", "c0df4f51c3654fc1bd4c57aed7701cdcf5270c7b940a77fae976e65785f9ac25"],
    ["source-venu-form4-section16-derivative-gift.json", "c7216211d133a6dee7614ea62b9231ff18cb7b43ef238448a73a485416adfb76"],
  ] as const;
  for (const [filename, expectedFixtureSha] of cases) {
    const state = canonicalState(filename);
    assert.equal(state.fixtureSha256, expectedFixtureSha, filename);
    assert.equal(state.filingTextSha256, state.fixture.source.sha256, `${filename} preserved source SHA`);
    const inventory = inventoryFor(state);
    const candidate = candidateFor(inventory, 0, allUnresolved(inventory, 0));
    const repository = repositoryFor(state, []);
    const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
      repository,
      apiKey: "fixture-key",
      runPrompt: async () => providerRun(candidate),
      idFactory: idSequence(runId, outputId),
    });
    assert.equal(result.status, "stored", `${filename}: ${JSON.stringify(result)}`);
  }
});

test("five-fixture offline prompt gate keeps semantic rules frozen and makes the DTO contract authoritative", () => {
  const cases = [
    ["source-agig-form4-purchase.json", "form4"],
    ["source-venu-form4-section16-derivative-gift.json", "form4"],
    ["source-uwmc-form4-multi-owner-10b5-1-conversion.json", "form4"],
    ["source-amcor-form144-no-prior-sales.json", "form144"],
    ["source-walmart-form144-namespaced.json", "form144"],
  ] as const;
  const expectedSemanticHashes = {
    form4: "d9bee1450bc802ce060daf0c035a1eb117966863b21cd145875cfe48f3ad8b4e",
    form144: "74d7fa2d592e837274bfb9d12481011603ff3894287fdae38af1b088ee467ef3",
  } as const;

  for (const [filename, expectedRoute] of cases) {
    const state = canonicalState(filename);
    const inventory = inventoryFor(state);
    const routed = routeOwnershipSemanticPrompt({
      rawForm: state.formType,
      canonicalForm: inventory.form,
      isAmendment: inventory.isAmendment,
    });
    assert.equal(routed.ok, true, filename);
    if (!routed.ok) continue;
    assert.equal(routed.route.id, expectedRoute, filename);
    assert.equal(sha256Json(routed.route.systemRules), expectedSemanticHashes[expectedRoute], filename);

    const prompt = buildOwnershipStructuredContextPrompt({
      source: sourceFor(state),
      inventory,
      semanticPromptRoute: routed.route,
    });
    const user = JSON.parse(prompt.user) as Row;
    assert.deepEqual(user.output_contract, prompt.responseFormat.json_schema, filename);
    assert.deepEqual(record(user.output_example).rows, [], filename);
    assert.equal(JSON.stringify(user.output_example).includes("owner_relations"), false, filename);
    assert.doesNotMatch(prompt.system, /Return exactly ownership_context_llm_v1 JSON/, filename);
    assert.doesNotMatch(prompt.system, /owner_attribution uses owner_id/, filename);
    assert.doesNotMatch(prompt.system, /derivative_underlying_relation uses target_security_id/, filename);
    assert.doesNotMatch(prompt.system, /rule_10b5_1 uses applies/, filename);
    assert.doesNotMatch(prompt.system, /amendment_effect uses effect/, filename);

    const schemaProperties = record(prompt.responseFormat.json_schema.properties);
    const rowSchema = record(record(schemaProperties.rows).items);
    const rowProperties = record(rowSchema.properties);
    const referenceRows = record(user.reference_inventory).rows as Row[];
    for (const row of referenceRows) {
      for (const field of row.allowed_fact_fields as string[]) {
        assert.equal(Object.hasOwn(rowProperties, field), true, `${filename}: ${field}`);
      }
      const bindings = row.security_xml_bindings as Row[];
      const rowSecurity = bindings.find((binding) => binding.role === "row_security");
      for (const underlying of bindings.filter((binding) => binding.role === "underlying_security")) {
        assert.notEqual(underlying.security_id, rowSecurity?.security_id, `${filename}: underlying ref must be distinct`);
      }
      for (const linkedRef of row.linked_footnote_refs as string[]) {
        const footnotes = record(user.reference_inventory).footnotes as Row[];
        assert.equal(footnotes.some((footnote) => footnote.footnote_ref === linkedRef), true, `${filename}: ${linkedRef}`);
      }
    }
    if (expectedRoute === "form144") {
      assert.equal(Object.hasOwn(rowProperties, "owner_relations"), false, filename);
      assert.equal(Object.hasOwn(rowProperties, "derivative_underlying_relation"), false, filename);
      assert.equal(Object.hasOwn(rowProperties, "rule_10b5_1"), false, filename);
      assert.equal(Object.hasOwn(rowProperties, "footnote_scopes"), false, filename);
    }
  }
});

test("neutral map exposes only exact XML bindings for UWMC owners, row footnotes, and securities", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const prompt = buildOwnershipStructuredContextPrompt({ source: sourceFor(state), inventory: inventoryFor(state) });
  const user = JSON.parse(prompt.user) as Row;
  const neutral = record(user.reference_inventory);
  const rows = neutral.rows as Row[];
  const footnotes = neutral.footnotes as Row[];
  const f3 = footnotes.find((footnote) => footnote.footnote_ref === "footnote:F3");
  const exactF3 = state.rawItem.raw_payload.ownership_source_text.match(/<footnote id="F3">([\s\S]*?)<\/footnote>/)?.[1];
  assert.equal(f3?.xml_text_raw, exactF3);
  const f5 = footnotes.find((footnote) => footnote.footnote_ref === "footnote:F5");
  assert.match(String(f5?.xml_text_raw), /&quot;UWM LLC&quot;/, "raw entity spelling is preserved, not normalized");
  assert.deepEqual((rows[0].owner_xml_bindings as Row[]).map((binding) => [binding.xml_name, binding.xml_cik]), [
    ["Mat Ishbia", "0001841794"],
    ["SFS HOLDING CORP", "0001842002"],
  ]);
  assert.deepEqual(rows[0].linked_footnote_refs, ["footnote:F1", "footnote:F2", "footnote:F3"]);
  const derivativeBindings = rows[4].security_xml_bindings as Row[];
  assert.deepEqual(derivativeBindings.map((binding) => [binding.role, binding.xml_title_text_raw]), [
    ["row_security", "UWM Paired Interests"],
    ["underlying_security", "Class A Common Stock"],
  ]);
  assert.equal(JSON.stringify(neutral).includes("PARSER_KIND_MUST_NOT_LEAK"), false);
});

test("the unchanged VENU 8f1939b5 raw output maps and validates, while a self-link still fails", async () => {
  const rawOutput = readFileSync(
    join(here, "fixtures/ownership-context-actual-provider-8f1939b5-venu.txt"),
    "utf8",
  ).trimEnd();
  assert.equal(sha256(rawOutput), "3b6ed803ebf1079162225fbd2ef8b8a5ed7f55da187b115c4dfd4f410beb6223");
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const inventory = inventoryFor(state);
  const mapping = mapOwnershipContextLlmDto({
    candidate: JSON.parse(rawOutput), source: sourceFor(state), inventory,
  });
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  if (!mapping.ok) return;
  assert.equal(validateOwnershipContextCandidate(mapping.value, inventory).ok, true);
  const assertions = record((mapping.value.rows as Row[])[0]).assertions as Row[];
  const underlying = assertions.find((assertion) => assertion.fact === "derivative_underlying_relation");
  assert.deepEqual(underlying, {
    fact: "derivative_underlying_relation",
    status: "supported",
    value: "security:form4:underlying:0",
    security_ref: "security:form4:0",
    evidence_refs: ["evidence:form4:0:0"],
  });
  const selfLinked = structuredClone(mapping.value) as unknown as Row;
  const selfAssertions = record((selfLinked.rows as Row[])[0]).assertions as Row[];
  record(selfAssertions.find((assertion) => assertion.fact === "derivative_underlying_relation")).value = "security:form4:0";
  assert.equal(validateOwnershipContextCandidate(selfLinked, inventory).ok, false);

  const repository = repositoryFor(state, []);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "offline-regression-only",
    runPrompt: async () => providerRun(null, { ok: true, outputText: rawOutput }),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
});

test("the five checkpoint provider outputs remain byte-exact immutable regressions and still fail closed", async () => {
  const regressionPath = join(here, "fixtures/ownership-context-actual-provider-103b5b05.json");
  const regression = JSON.parse(readFileSync(regressionPath, "utf8")) as Row & {
    calls: Array<{
      fixture: string;
      accession: string;
      route: string;
      raw_output_sha256: string;
      raw_output_text: string;
    }>;
  };
  assert.equal(regression.checkpoint, "103b5b05ac5973339951dcd9e5d0533475e225e6");
  assert.equal(regression.source_ledger_sha256, "c76462d3f89b43d377807c912ccf470fe22fd094548f58da0d1d4cec0540c3a4");
  assert.equal(regression.calls.length, 5);
  const expectedStages = new Map<string, string>([
    ["source-agig-form4-purchase.json", "validation"],
    ["source-venu-form4-section16-derivative-gift.json", "provider"],
    ["source-uwmc-form4-multi-owner-10b5-1-conversion.json", "validation"],
    ["source-amcor-form144-no-prior-sales.json", "validation"],
    ["source-walmart-form144-namespaced.json", "validation"],
  ]);

  for (const actual of regression.calls) {
    assert.equal(sha256(actual.raw_output_text), actual.raw_output_sha256, `${actual.fixture}: raw output drift`);
    const state = canonicalState(actual.fixture);
    const repository = repositoryFor(state, []);
    const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
      repository,
      apiKey: "offline-regression-only",
      runPrompt: async () => providerRun(null, {
        ok: true,
        outputText: actual.raw_output_text,
      }),
      idFactory: idSequence(runId, outputId),
    });
    assert.equal(result.status, "unavailable", `${actual.fixture}: checkpoint output must not become PASS`);
    assert.equal(result.stage, expectedStages.get(actual.fixture), `${actual.fixture}: fail-closed stage drift`);
    assert.equal(repository.state.contextWrites.length, 0, `${actual.fixture}: rejected output cannot persist context`);
    assert.equal(repository.state.aiTraces.length, 1, `${actual.fixture}: rejected output remains auditable`);
  }
});

test("latest UWMC candidate maps unresolved facts without evidence but canonical wrong relations stop before verifier", async () => {
  const rawOutput = readFileSync(
    join(here, "fixtures/ownership-context-actual-provider-7fb5a99e-uwmc.txt"),
    "utf8",
  ).trimEnd();
  assert.equal(sha256(rawOutput), "94b788d6709c717f14962e69e297b790056a5e1ad40abad647817a4b0543f75f");
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const repository = repositoryFor(state, []);
  let verifierCalls = 0;
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "offline-regression-only",
    runPrompt: async () => providerRun(null, { ok: true, outputText: rawOutput }),
    semanticVerifier: {
      name: "must-not-run-before-canonical-validation",
      async verify() { verifierCalls += 1; return {}; },
    },
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.equal(result.stage, "validation");
  assert.equal(verifierCalls, 0);
  assert.equal(repository.state.semanticTraces.length, 0);
  assert.equal(repository.state.contextWrites.length, 0);
});

test("ambiguous, conflict, and unresolved statuses persist without values", async () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const inventory = inventoryFor(state);
  const candidate = candidateFor(inventory, 0, [
    { fact: "owner_attribution", status: "ambiguous", evidence_refs: [] },
    { fact: "ownership_relation", status: "conflict", evidence_refs: inventory.rows[0].evidenceRefs },
    unresolved("derivative_underlying_relation", inventory.rows[0].securityRef),
    unresolved("rule_10b5_1_applicability"),
    unresolved("footnote_scope"),
    unresolved("amendment_effect"),
  ]);
  const repository = repositoryFor(state, []);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository, apiKey: "fixture-key", runPrompt: async () => providerRun(candidate),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  assert.equal(JSON.stringify(repository.state.contextWrites[0]).includes('"value"'), false);
});

test("hallucinated references and stale fingerprints retain AI history but never reach context persistence", async () => {
  const forgedState = canonicalState("source-agig-form4-purchase.json");
  const forgedInventory = inventoryFor(forgedState);
  const forged = candidateFor(forgedInventory, 0, allUnresolved(forgedInventory, 0));
  record(record(forged.rows[0]).owner_attribution).evidence_ids = ["evidence:form4:0:999"];
  const forgedRepository = repositoryFor(forgedState, []);
  const forgedResult = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: forgedState.rawItem }, {
    repository: forgedRepository, apiKey: "fixture-key", runPrompt: async () => providerRun(forged),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(forgedResult.status, "unavailable");
  if (forgedResult.status === "unavailable") assert.equal(forgedResult.stage, "validation");
  assert.equal(forgedRepository.state.aiTraces.length, 1);
  assert.equal(forgedRepository.state.contextWrites.length, 0);
  const forgedTrace = buildOwnershipContextAiTraceRows(forgedRepository.state.aiTraces[0] as never);
  assert.equal(forgedTrace.output.payload.output_text, JSON.stringify(forged));
  assert.deepEqual(forgedTrace.output.payload.parsed_output, forged);
  assert.equal(record(forgedTrace.output.payload.mapped_canonical_output).version, "ownership_context_v1");
  assert.deepEqual(forgedTrace.output.payload.mapping_errors, []);

  const staleState = canonicalState("source-agig-form4-purchase.json");
  const staleInventory = inventoryFor(staleState);
  const staleRepository = repositoryFor(staleState, [], { fingerprintAfterFirstRead: `ownership-context-v1:${"b".repeat(64)}` });
  const staleResult = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: staleState.rawItem }, {
    repository: staleRepository, apiKey: "fixture-key",
    runPrompt: async () => providerRun(candidateFor(staleInventory, 0, allUnresolved(staleInventory, 0))),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(staleResult.status, "unavailable");
  if (staleResult.status === "unavailable") assert.equal(staleResult.stage, "persistence");
  assert.equal(staleRepository.state.aiTraces.length, 1);
  assert.equal(staleRepository.state.contextWrites.length, 0);
});

test("provider failure leaves direct facts and matcher inputs available with trace-only history", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const before = structuredClone(state.form4);
  const repository = repositoryFor(state, []);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "fixture-key",
    runPrompt: async () => providerRun(null, { ok: false, responseOk: false, status: 0, error: "timeout" }),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") assert.equal(result.stage, "provider");
  assert.deepEqual(state.form4, before);
  assert.equal(repository.state.aiTraces.length, 1);
  assert.equal(repository.state.contextWrites.length, 0);
});

test("Form 144 edgarSubmission and byte-exact outer whitespace remain valid source input", async () => {
  const state = canonicalState("form144-ambiguous-10b5-multiple-rows.json", { wrapWhitespace: true });
  const inventory = inventoryFor(state);
  const repository = repositoryFor(state, []);
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "fixture-key",
    runPrompt: async () => providerRun(candidateFor(inventory, 0, allUnresolved(inventory, 0))),
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  const prompt = repository.state.aiTraces[0]?.prompt as Row;
  const user = JSON.parse(String(prompt.user)) as Row;
  assert.equal(String(user.original_sec_ownership_xml).startsWith("  \n"), true);
  assert.equal(String(user.original_sec_ownership_xml).endsWith("\n  "), true);
});

test("invalid JSON, execution failure, and full-call timeout produce unavailable trace-only results", async () => {
  for (const mode of ["invalid_json", "exception", "timeout"] as const) {
    const state = canonicalState("source-agig-form4-purchase.json");
    const repository = repositoryFor(state, []);
    const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
      repository,
      apiKey: "fixture-key",
      timeoutMs: 5,
      runPrompt: mode === "invalid_json"
        ? async () => providerRun(null, {
            ok: false,
            responseOk: true,
            outputText: "{not-json",
            error: "Gemini response did not contain parseable JSON",
          })
        : mode === "exception"
        ? async () => { throw new Error("provider exploded"); }
        : async () => await new Promise<GeminiStructuredJsonRun>(() => undefined),
      idFactory: idSequence(runId, outputId),
    });
    assert.equal(result.status, "unavailable", mode);
    if (result.status === "unavailable") assert.equal(result.stage, "provider", mode);
    assert.equal(repository.state.aiTraces.length, 1, mode);
    assert.equal(repository.state.contextWrites.length, 0, mode);
  }
});

test("LLM DTO schema uses fixed typed fact fields without generic polymorphic values", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const schema = buildOwnershipStructuredContextResponseSchema(inventory);
  const rows = record(record(schema.properties).rows);
  assert.equal(rows.minItems, 0);
  assert.equal(rows.maxItems, inventory.rows.length);
  const rowProperties = record(record(rows.items).properties);
  assert.equal(Object.hasOwn(rowProperties, "assertions"), false);
  assert.equal(Object.hasOwn(rowProperties, "owner_attribution"), true);
  assert.equal(Object.hasOwn(rowProperties, "owner_relations"), true);
  assert.equal(Object.hasOwn(rowProperties, "footnote_scopes"), true);
  assert.equal(Object.hasOwn(rowProperties, "ownership_relation"), false);
  assert.equal(Object.hasOwn(rowProperties, "footnote_scope"), false);
  assert.equal(Object.hasOwn(rowProperties, "rule_10b5_1"), true);
  assert.equal(Object.hasOwn(rowProperties, "economic_direction"), false);
  assert.equal(Object.hasOwn(rowProperties, "amendment_effect"), false);
  assert.equal(JSON.stringify(schema).includes('"value"'), false);
  const ownerAttribution = record(rowProperties.owner_attribution);
  assert.match(JSON.stringify(ownerAttribution.allOf), /"required":\["owner_id"\]/);
  assert.match(JSON.stringify(ownerAttribution.allOf), /"minItems":1/);
  assert.deepEqual(record(schema.properties).version, { type: "string", enum: ["ownership_context_llm_v1"] });
});

test("LLM DTO mapper performs only trusted envelope binding, key moves, and typed structural conversion", () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  const dto = {
    version: "ownership_context_llm_v1",
    rows: [{
      row_id: row.rowRef,
      owner_attribution: { status: "supported", owner_id: row.ownerRefs[0], evidence_ids: [row.evidenceRefs[0]] },
      owner_relations: [{
        status: "supported", relation: "direct", owner_id: row.ownerRefs[0], evidence_ids: [row.evidenceRefs[0]],
      }],
      rule_10b5_1: { status: "supported", applies: false, evidence_ids: [row.evidenceRefs[0]] },
      footnote_scopes: [{
        status: "supported", scope: "row", footnote_ref: row.linkedFootnoteRefs[0], evidence_ids: [row.evidenceRefs[0]],
      }],
    }],
  };
  const mapping = mapOwnershipContextLlmDto({ candidate: dto, source: sourceFor(state), inventory });
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  if (!mapping.ok) return;
  assert.equal(mapping.value.version, "ownership_context_v1");
  assert.equal(mapping.value.event_ref, inventory.eventRef);
  assert.equal(mapping.value.form, inventory.form);
  assert.equal(mapping.value.source_fingerprint, inventory.sourceFingerprint);
  const assertions = record((mapping.value.rows as Row[])[0]).assertions as Row[];
  assert.deepEqual(assertions[0], {
    fact: "owner_attribution", status: "supported", value: row.ownerRefs[0], evidence_refs: [row.evidenceRefs[0]],
  });
  assert.deepEqual(assertions[2], {
    fact: "rule_10b5_1_applicability", status: "supported", value: false, evidence_refs: [row.evidenceRefs[0]],
  });
  assert.equal(JSON.stringify(mapping.value).includes("shares"), false);
  assert.equal(validateOwnershipContextCandidate(mapping.value, inventory).ok, true);
});

test("partial applicable DTO facts map, while wire errors, nonapplicable facts, forged refs, and semantic conflicts fail closed", () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  const partial = {
    version: "ownership_context_llm_v1",
    rows: [{
      row_id: row.rowRef,
      owner_attribution: { status: "unresolved" },
    }],
  };
  const partialMapping = mapOwnershipContextLlmDto({ candidate: partial, source: sourceFor(state), inventory });
  assert.equal(partialMapping.ok, true, JSON.stringify(partialMapping));
  if (partialMapping.ok) {
    assert.equal(validateOwnershipContextCandidate(partialMapping.value, inventory).ok, true);
    assert.deepEqual(record((partialMapping.value.rows as Row[])[0]).assertions, [{
      fact: "owner_attribution", status: "unresolved", evidence_refs: [],
    }]);
  }

  const missingSupportedOwner = {
    version: "ownership_context_llm_v1",
    rows: [{
      row_id: row.rowRef,
      owner_attribution: { status: "supported", evidence_ids: [row.evidenceRefs[0]] },
    }],
  };
  const missingSupportedOwnerMapping = mapOwnershipContextLlmDto({
    candidate: missingSupportedOwner, source: sourceFor(state), inventory,
  });
  assert.equal(missingSupportedOwnerMapping.ok, false);
  assert.match(missingSupportedOwnerMapping.errors.join("\n"), /owner_id is required when supported/);

  const invalidWire = structuredClone(partial) as Row;
  const invalidRow = (invalidWire.rows as Row[])[0];
  invalidRow.economic_direction = { status: "supported", direction: "buy", evidence_ids: [row.evidenceRefs[0]] };
  invalidRow.owner_relations = [{
    status: "supported", relation: "owned", owner_id: row.ownerRefs[0],
    evidence_ids: [{ evidence_id: row.evidenceRefs[0] }],
  }];
  invalidRow.derivative_underlying_relation = {
    status: "unresolved", source_security_id: row.securityRef, evidence_ids: [],
  };
  const invalidMapping = mapOwnershipContextLlmDto({ candidate: invalidWire, source: sourceFor(state), inventory });
  assert.equal(invalidMapping.ok, false);
  assert.match(invalidMapping.errors.join("\n"), /evidence_ids must contain only non-empty opaque ID strings/);
  assert.match(invalidMapping.errors.join("\n"), /economic_direction is not applicable/);
  assert.match(invalidMapping.errors.join("\n"), /relation is invalid/);
  assert.match(invalidMapping.errors.join("\n"), /derivative_underlying_relation is not applicable/);

  const forged = {
    version: "ownership_context_llm_v1",
    rows: [{
      row_id: row.rowRef,
      owner_attribution: { status: "supported", owner_id: "owner:form4:0:999", evidence_ids: [row.evidenceRefs[0]] },
    }],
  };
  const forgedMapping = mapOwnershipContextLlmDto({ candidate: forged, source: sourceFor(state), inventory });
  assert.equal(forgedMapping.ok, true, JSON.stringify(forgedMapping));
  if (forgedMapping.ok) assert.equal(validateOwnershipContextCandidate(forgedMapping.value, inventory).ok, false);

  const conflict = {
    version: "ownership_context_llm_v1",
    rows: [{
      row_id: row.rowRef,
      owner_relations: [{
        status: "supported", relation: "indirect", owner_id: row.ownerRefs[0], evidence_ids: [row.evidenceRefs[0]],
      }],
    }],
  };
  const conflictMapping = mapOwnershipContextLlmDto({ candidate: conflict, source: sourceFor(state), inventory });
  assert.equal(conflictMapping.ok, true, JSON.stringify(conflictMapping));
  if (conflictMapping.ok) assert.equal(validateOwnershipContextCandidate(conflictMapping.value, inventory).ok, false);
});

test("provider uses JSON mode without sending Gemini responseSchema while trace retains the strict prompt contract", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const candidate = candidateFor(inventory, 0, allUnresolved(inventory, 0));
  const repository = repositoryFor(state, []);
  let providerRequest: Row | null = null;
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository,
    apiKey: "fixture-key",
    runPrompt: async (input) => {
      providerRequest = input as unknown as Row;
      return providerRun(candidate);
    },
    idFactory: idSequence(runId, outputId),
  });
  assert.equal(result.status, "stored", JSON.stringify(result));
  assert.ok(providerRequest);
  assert.equal(Object.hasOwn(providerRequest, "responseSchema"), false);
  const traceRows = buildOwnershipContextAiTraceRows(repository.state.aiTraces[0] as never);
  const traceRequest = record(traceRows.output.payload.request);
  assert.equal(traceRequest.response_mode, "application/json");
  assert.equal(traceRequest.provider_response_schema, null);
  assert.deepEqual(traceRequest.response_format, buildOwnershipStructuredContextPrompt({
    source: sourceFor(state),
    inventory,
  }).responseFormat);
});

test("synthetic owner or XML-row mapping drift stops before the provider", async () => {
  for (const drift of ["owner", "row"] as const) {
    const state = canonicalState("source-agig-form4-purchase.json");
    if (drift === "owner") {
      for (const row of state.form4) row.reporting_owner_names = ["Parser-only owner"];
    } else {
      const xml = state.rawItem.raw_payload.ownership_source_text;
      state.rawItem.raw_payload.ownership_source_text = xml.replace(
        /<nonDerivativeTransaction\b[^>]*>[\s\S]*?<\/nonDerivativeTransaction>/i,
        "",
      );
      const modifiedHash = sha256(state.rawItem.raw_payload.ownership_source_text);
      for (const row of state.form4) record(row.provenance).source_xml_sha256 = modifiedHash;
    }
    let providerCalls = 0;
    const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
      repository: repositoryFor(state, []),
      apiKey: "fixture-key",
      runPrompt: async () => {
        providerCalls += 1;
        return providerRun(null);
      },
    });
    assert.equal(result.status, "unavailable", drift);
    if (result.status === "unavailable") assert.equal(result.stage, "source", drift);
    assert.equal(providerCalls, 0, drift);
  }
});

test("raw amendment mismatch stops before the provider", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  state.rawItem.raw_payload.form_type = "4/A";
  let providerCalls = 0;
  const result = await runOwnershipStructuredContextAnalysis({ eventId, rawItem: state.rawItem }, {
    repository: repositoryFor(state, []),
    apiKey: "fixture-key",
    runPrompt: async () => {
      providerCalls += 1;
      return providerRun(null);
    },
  });
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.equal(result.stage, "source");
    assert.equal(result.reason, "ownership_semantic_prompt_amendment_mismatch");
  }
  assert.equal(providerCalls, 0);
});

test("AI trace namespace is separate from Primary and output lineage is ownership_context_v1", () => {
  assert.equal(OWNERSHIP_CONTEXT_AI_PROMPT_KEY, "ownership_structured_context");
  assert.equal(OWNERSHIP_CONTEXT_AI_PROMPT_VERSION, "ownership_context_llm_v1.3-required-supported-values");
  assert.equal(OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION, "ownership_context_semantic_v1.1-form-routing");
  assert.equal(OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION, "ownership_context_llm_wire_v1.1-required-supported-values");
  assert.equal(OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION, "ownership_context_neutral_inventory_v1.1-xml-bindings");
  assert.equal(OWNERSHIP_CONTEXT_LLM_VERSION, "ownership_context_llm_v1");
  assert.notEqual(OWNERSHIP_CONTEXT_AI_PROMPT_KEY, "sec_ownership_analysis");
});

test("SEC ingest runs the context sidecar before the unchanged ownership matcher and exposes no delivery path", () => {
  const ingest = readFileSync(join(here, "../secFilingAnalysisIngest.ts"), "utf8");
  const analyzer = readFileSync(join(here, "ownershipStructuredContextAnalyzer.ts"), "utf8");
  const successSidecar = ingest.indexOf("const ownershipStructuredContext = primaryPromptKey");
  const successMatcher = ingest.indexOf("const ownershipMonitorConditionExecution = primaryPromptKey");
  assert.ok(successSidecar >= 0 && successSidecar < successMatcher);
  assert.match(ingest, /ownershipStructuredContext,\s*ownershipMonitorConditionExecution,/);
  assert.doesNotMatch(analyzer, /runAlertDelivery|sendTelegram|sendEmail|enqueueGenericMonitor|score\s*:/i);
});

function canonicalState(filename: string, options: { wrapWhitespace?: boolean } = {}) {
  const fixturePath = join(fixtureRoot, filename);
  const fixtureText = readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureText) as Row & { source: Row };
  const fixtureSourceText = String(fixture.filingText);
  const sourceText = options.wrapWhitespace ? `  \n${fixtureSourceText}\n  ` : fixtureSourceText;
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const rawItem = {
    id: rawItemId,
    source_code: "sec_edgar",
    source_unique_id: accession,
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ticker,
      ...(ticker ? { ownership_issuer_trading_symbol: ticker } : {}),
      ownership_source_text: sourceText,
      ownership_source_url: String(fixture.source?.url || `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`),
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
  return {
    fixture,
    fixtureSha256: sha256(fixtureText),
    filingTextSha256: sha256(sourceText),
    formType,
    rawItem,
    event: {
      id: eventId,
      raw_item_id: rawItemId,
      source_code: "sec_edgar",
      source_group: "filings",
      event_type: "insider_ownership",
      metadata: { form_type: formType, accession_number: accession },
    },
    form4: structuredClone(built.form4Transactions),
    form144: structuredClone(built.form144ProposedSales),
  };
}

function sourceFor(state: ReturnType<typeof canonicalState>) {
  const payload = state.rawItem.raw_payload;
  return {
    xml: payload.ownership_source_text,
    form: payload.form_type,
    accessionNumber: payload.accession_number,
    issuerCik: String(payload.ownership_issuer_cik),
    issuerTradingSymbol: "ownership_issuer_trading_symbol" in payload
      ? payload.ownership_issuer_trading_symbol ?? null
      : null,
    issuerName: xmlValue(payload.ownership_source_text, "issuerName"),
    reportingOwners: xmlOwners(payload.ownership_source_text, state.form4.length ? "form4" : "form144"),
  };
}

function inventoryFor(state: ReturnType<typeof canonicalState>) {
  const form = state.form4.length ? "form4" as const : "form144" as const;
  return buildOwnershipContextReferenceInventory({
    eventId,
    form,
    isAmendment: state.formType.endsWith("/A"),
    sourceFingerprint: fingerprint,
    rows: form === "form4" ? state.form4 : state.form144,
    sourceXml: state.rawItem.raw_payload.ownership_source_text,
  });
}

function repositoryFor(
  state: ReturnType<typeof canonicalState>,
  calls: string[],
  options: { fingerprintAfterFirstRead?: string; semanticVerifierRefsValid?: boolean } = {},
) {
  let snapshotReads = 0;
  const repository: OwnershipStructuredContextAnalyzerRepository & {
    state: { aiTraces: Row[]; semanticTraces: Row[]; contextWrites: Row[] };
  } = {
    state: { aiTraces: [], semanticTraces: [], contextWrites: [] },
    async readContextSnapshot() {
      snapshotReads += 1;
      return {
        ok: true,
        status: 200,
        data: {
          event: state.event,
          form4_rows: state.form4,
          form144_rows: state.form144,
          ownership_source_text: state.rawItem.raw_payload.ownership_source_text,
          context_fingerprint: {
            status: "available",
            form: state.form4.length ? "form4" : "form144",
            source_fingerprint: snapshotReads > 1 && options.fingerprintAfterFirstRead
              ? options.fingerprintAfterFirstRead
              : fingerprint,
            context_ai_refs_valid: true,
          },
          context_semantic_verifier_refs_valid: options.semanticVerifierRefsValid ?? true,
        },
      };
    },
    async select() {
      return { ok: false, status: 500, data: null, error: "snapshot expected" };
    },
    async persistAiTrace(input) {
      calls.push("ai_trace");
      repository.state.aiTraces.push(structuredClone(input) as unknown as Row);
    },
    async persistSemanticVerifierTrace(input) {
      calls.push("semantic_trace");
      repository.state.semanticTraces.push(structuredClone(input) as unknown as Row);
    },
    async persistContext(input) {
      calls.push("context");
      repository.state.contextWrites.push(structuredClone(input) as unknown as Row);
      return { ok: true, status: 200, data: { status: "stored", updated_row_count: input.contexts.length } };
    },
  };
  return repository;
}

function candidateFor(inventory: OwnershipContextReferenceInventory, rowIndex: number, assertions: Row[]) {
  return {
    version: "ownership_context_llm_v1",
    rows: inventory.rows.map((row, index) => ({
      row_id: row.rowRef,
      ...llmFactsForTest(
        index === rowIndex ? assertions : allUnresolved(inventory, index),
        inventory,
        index,
      ),
    })),
  };
}

function llmFactsForTest(
  assertions: Row[],
  inventory: OwnershipContextReferenceInventory,
  rowIndex: number,
) {
  const row = inventory.rows[rowIndex];
  const output: Row = {};
  for (const assertion of assertions) {
    const fact = String(assertion.fact);
    if (fact === "derivative_underlying_relation" && row.direct.transactionKind !== "derivative") continue;
    if (fact === "rule_10b5_1_applicability"
      && row.direct.is10b51 === null
      && inventory.filingRule10b51 === null) continue;
    if (fact === "footnote_scope" && assertion.status !== "supported") continue;
    if (fact === "amendment_effect" && !inventory.isAmendment) continue;
    const base: Row = { status: assertion.status, evidence_ids: assertion.evidence_refs };
    if (assertion.footnote_ref) base.footnote_ref = assertion.footnote_ref;
    if (fact === "owner_attribution") {
      if (Object.hasOwn(assertion, "value")) base.owner_id = assertion.value;
      output.owner_attribution = base;
    } else if (fact === "ownership_relation") {
      if (Object.hasOwn(assertion, "value")) base.relation = assertion.value;
      base.owner_id = assertion.owner_ref ?? row.ownerRefs[0];
      output.owner_relations = [...(Array.isArray(output.owner_relations) ? output.owner_relations : []), base];
    } else if (fact === "economic_direction") {
      if (Object.hasOwn(assertion, "value")) base.direction = assertion.value;
      if (assertion.security_ref) base.security_id = assertion.security_ref;
      output.economic_direction = base;
    } else if (fact === "derivative_underlying_relation") {
      if (Object.hasOwn(assertion, "value")) base.target_security_id = assertion.value;
      if (assertion.security_ref) base.source_security_id = assertion.security_ref;
      output.derivative_underlying_relation = base;
    } else if (fact === "rule_10b5_1_applicability") {
      if (Object.hasOwn(assertion, "value")) base.applies = assertion.value;
      if (assertion.owner_ref) base.owner_id = assertion.owner_ref;
      if (assertion.security_ref) base.security_id = assertion.security_ref;
      output.rule_10b5_1 = base;
    } else if (fact === "footnote_scope") {
      if (Object.hasOwn(assertion, "value")) base.scope = assertion.value;
      base.footnote_ref = assertion.footnote_ref ?? row.linkedFootnoteRefs[0];
      if (assertion.owner_ref) base.owner_id = assertion.owner_ref;
      if (assertion.security_ref) base.security_id = assertion.security_ref;
      output.footnote_scopes = [...(Array.isArray(output.footnote_scopes) ? output.footnote_scopes : []), base];
    } else if (fact === "amendment_effect") {
      if (Object.hasOwn(assertion, "value")) base.effect = assertion.value;
      output.amendment_effect = base;
    }
  }
  return output;
}

function allUnresolved(inventory: OwnershipContextReferenceInventory, rowIndex: number) {
  void inventory;
  void rowIndex;
  return [unresolved("owner_attribution")];
}

function unresolved(fact: string, securityRef: string | null = null): Row {
  return {
    fact,
    status: "unresolved",
    ...(securityRef ? { security_ref: securityRef } : {}),
    evidence_refs: [],
  };
}

function supported(fact: string, value: unknown, evidenceRef: string): Row {
  return { fact, status: "supported", value, evidence_refs: [evidenceRef] };
}

function providerRun(parsed: Row | null, overrides: Partial<GeminiStructuredJsonRun> = {}): GeminiStructuredJsonRun {
  return {
    ok: Boolean(parsed),
    responseOk: true,
    status: 200,
    statusText: "OK",
    model: "fixture-model",
    responseId: "fixture-response",
    outputText: parsed ? JSON.stringify(parsed) : "",
    parsed,
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    body: null,
    ...overrides,
  };
}

function idSequence(...values: string[]) {
  let index = 0;
  const fallback = [verifierRunId, verifierOutputId];
  return () => {
    const current = index++;
    return values[current] ?? fallback[current - values.length] ?? verifierOutputId;
  };
}

function timeSequence(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? values.at(-1)!;
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}

function xmlOwners(sourceText: string, form: "form4" | "form144") {
  if (form === "form144") {
    const name = xmlValue(sourceText, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold");
    return name ? [{ cik: null, name }] : [];
  }
  return Array.from(sourceText.matchAll(/<reportingOwner\b[^>]*>([\s\S]*?)<\/reportingOwner>/gi))
    .map((match) => ({
      cik: xmlValue(match[1] || "", "rptOwnerCik"),
      name: xmlValue(match[1] || "", "rptOwnerName") || "",
    }))
    .filter((owner) => Boolean(owner.name));
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Json(value: unknown) {
  return sha256(JSON.stringify(value));
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
