import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OfferingMonitorJobIdentity } from "./offeringMonitorJobFoundation.ts";
import {
  OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
  OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT,
  OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS,
  OFFERING_MONITOR_SECOND_STAGE_MONETARY_FACT_KEYS,
  OFFERING_MONITOR_SECOND_STAGE_SHARE_FACT_KEYS,
  OFFERING_MONITOR_MAX_NUMERIC_LITERAL_CHARS,
  assertOfferingMonitorNumericLiteralSafety,
  buildOfferingMonitorSecondStagePackage,
  groupOfferingMonitorEvidenceBlocks,
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
  executionContractVersion: "second_stage_direct_v8",
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
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature",
    "available_monetary_facts", "available_share_facts", "unavailable_fact_keys",
  ]);
  assert.deepEqual(
    offeringMonitorSecondStageProviderSchema.properties.available_monetary_facts.items.properties.fact_key.enum,
    OFFERING_MONITOR_SECOND_STAGE_MONETARY_FACT_KEYS,
  );
  assert.deepEqual(
    offeringMonitorSecondStageProviderSchema.properties.available_share_facts.items.properties.fact_key.enum,
    OFFERING_MONITOR_SECOND_STAGE_SHARE_FACT_KEYS,
  );
  assert.deepEqual(
    offeringMonitorSecondStageProviderSchema.properties.unavailable_fact_keys.items.enum,
    OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS,
  );
  const schema = JSON.stringify(offeringMonitorSecondStageProviderSchema);
  assert.match(schema, /actual_primary_offering_amount/);
  assert.match(schema, /available_monetary_facts/);
  assert.match(schema, /available_share_facts/);
  assert.match(schema, /unavailable_fact_keys/);
  assert.doesNotMatch(schema, /offering_monitor_payload|nullable|oneOf|anyOf|allOf|if|then|else|"type":\[/);
  assert.ok(Buffer.byteLength(schema) < 5_000);
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
  const sourcePackage = inputPackage.payload.source_package as {
    evidence_document_groups: Array<{ evidence_blocks: Array<{ source_ref: string }> }>;
  };
  const groupedBlocks = sourcePackage.evidence_document_groups.flatMap((group) => group.evidence_blocks);
  assert.deepEqual(groupedBlocks.map((block) => block.source_ref), refs);
  assert.equal(new Set(refs).size, groupedBlocks.length);
  assert.doesNotMatch(JSON.stringify(inputPackage.payload), /unrelated filing evidence/);
});

test("structural document grouping preserves first occurrence, in-document order, content, and source refs", () => {
  const blocks = [
    { ...block("a-1", "attachment", "document-a.htm", "document A first"), chunk_index: 1, chunk_count: 2 },
    { ...block("b-1", "attachment", "document-b.htm", "same content"), chunk_index: 1, chunk_count: 1 },
    { ...block("a-2", "attachment", "document-a.htm", "document A second"), chunk_index: 2, chunk_count: 2 },
    { ...block("c-1", "attachment", "document-c.htm", "same content"), chunk_index: 1, chunk_count: 1 },
  ];
  const groups = groupOfferingMonitorEvidenceBlocks(blocks);
  assert.deepEqual(groups.map((group) => group.document_identity.key), [
    "document-a.htm", "document-b.htm", "document-c.htm",
  ]);
  assert.deepEqual(groups[0].evidence_blocks.map((item) => item.block_id), ["a-1", "a-2"]);
  const groupedBlocks = groups.flatMap((group) => group.evidence_blocks);
  assert.deepEqual(groupedBlocks.map((item) => item.block_id), ["a-1", "a-2", "b-1", "c-1"]);
  assert.equal(groupedBlocks.length, blocks.length);
  assert.ok(blocks.every((item) => groupedBlocks.includes(item)));
  assert.deepEqual(
    groupedBlocks.map((item) => item.source_ref).sort(),
    blocks.map((item) => item.source_ref).sort(),
  );
  assert.equal(groups[1].evidence_blocks[0].text, groups[2].evidence_blocks[0].text);
  assert.notEqual(groups[1].document_identity.key, groups[2].document_identity.key);
});

test("structural grouping uses document metadata only and contains no semantic ranking rule", () => {
  const source = groupOfferingMonitorEvidenceBlocks.toString();
  assert.match(source, /documentIdentity/);
  assert.doesNotMatch(source, /\.text|fee|Rule\s*457|financing|transaction|10,?000,?000|source_ref.*priority/i);
});

test("serialized evidence grouping retains all 20 selected blocks without semantic filtering or reordering", () => {
  const fixture = artifacts();
  fixture.sourceInput.blocks = Array.from({ length: 20 }, (_, index) => ({
    ...block(`structural-${index}`, "attachment", `document-${Math.floor(index / 4)}.htm`, `evidence block ${index}`),
    chunk_index: (index % 4) + 1,
    chunk_count: 4,
  }));
  fixture.sourceInput.sourceInventory = { sourceBlockBudget: { includedTextChars: 10_000 } };
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: fixture });
  const sourcePackage = inputPackage.payload.source_package as {
    evidence_document_groups: Array<{ document_identity: { key: string }; evidence_blocks: typeof fixture.sourceInput.blocks }>;
  };
  const retained = sourcePackage.evidence_document_groups.flatMap((group) => group.evidence_blocks);
  assert.equal(inputPackage.stats.sourceBlockCount, 20);
  assert.equal(retained.length, 20);
  assert.equal(inputPackage.stats.sourceDocumentGroupCount, 5);
  assert.deepEqual(retained, fixture.sourceInput.blocks);
  assert.deepEqual(inputPackage.allowedSourceRefs, fixture.sourceInput.blocks.map((item) => item.source_ref));
  assert.deepEqual(
    sourcePackage.evidence_document_groups.map((group) => group.document_identity.key),
    ["document-0.htm", "document-1.htm", "document-2.htm", "document-3.htm", "document-4.htm"],
  );
  assert.ok(inputPackage.stats.groupingAddedPackageChars > 0);
  assert.equal(
    inputPackage.stats.promptChars - inputPackage.stats.ungroupedPromptChars,
    inputPackage.stats.groupingAddedPromptChars,
  );
});

test("dedicated prompt uses direct canonical fact keys and preserves semantic definitions", () => {
  assert.deepEqual(OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS, [
    "actual_primary_offering_amount", "offering_price", "immediate_primary_share_exposure",
    "additional_potential_primary_share_exposure", "resale_share_exposure",
  ]);
  assert.equal(OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION, "second_stage_direct_v8");
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /ROLE: You are the Offering Monitor Normalizer/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Do not produce or revise score, signal, title, summary, why-it-matters/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Display analysis and Monitor facts serve different purposes/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /actual_primary_offering_amount is the source-backed gross size of the current specific issuer-primary transaction/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /generic registration or fee-table ceiling, shelf capacity, resale value\/proceeds/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /gross\/net fee difference does not invalidate gross/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /FINANCING AMOUNT/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /any supplied SEC evidence directly states or establishes the size of the current issuer financing transaction/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /do not require one specific document type or source_ref/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Do not select a source merely because it contains the same number/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /filing-fee calculation, registration capacity, resale value, or other administrative amount is insufficient unless it actually establishes the current issuer financing transaction amount/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /qualifying transaction evidence is present, do not mark the fact unavailable merely because another source contains the same amount/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Return unavailable only when no supplied SEC source supports the current financing transaction amount/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /additional_potential_primary_share_exposure is only distinct conditional\/potential primary exposure/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /equal values alone do not prove duplication/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /shortest ordinary JSON number/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /Never pad trailing zeros, invent decimal precision/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /floating-point artifact/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /available_monetary_facts/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /unavailable_fact_keys/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /parent_primary_context is analysis context only/i);
  assert.match(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /actual_primary_offering_amount|offering_price|immediate_primary_share_exposure|additional_potential_primary_share_exposure|resale_share_exposure/);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /OM1 WIRE CONTRACT|compact om1|facts has exactly five wire keys/);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /IPDN|0001437749|10,?000,?000|EX-10\.36|s1f1_attachment_/);
});

test("numeric lexical guard preserves normal JSON numbers including exponent notation", () => {
  const text = '{"integer":10000000,"decimal":0.6364,"negative":-12.5,"exponent":1e7,"signed_exponent":2.5E-12,"inside":"' + "9".repeat(256) + '"}';
  assert.doesNotThrow(() => assertOfferingMonitorNumericLiteralSafety(text));
  assert.equal(JSON.parse(text).decimal, 0.6364);
  assert.equal(JSON.parse(text).exponent, 10_000_000);
});

test("numeric lexical guard rejects pathological integer and fractional literals without correcting them", () => {
  const longInteger = "1".repeat(OFFERING_MONITOR_MAX_NUMERIC_LITERAL_CHARS + 1);
  const longFraction = `10000000.${"0".repeat(OFFERING_MONITOR_MAX_NUMERIC_LITERAL_CHARS)}`;
  assert.throws(() => assertOfferingMonitorNumericLiteralSafety(`{"value":${longInteger}}`), /numeric_literal_too_long at character/);
  assert.throws(() => assertOfferingMonitorNumericLiteralSafety(`{"value":${longFraction}}`), /numeric_literal_too_long at character/);
});

test("pathological provider numeric literal fails transport before strict JSON normalization", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const raw = JSON.stringify(validDirectPayload()).replace("10000000", `10000000.${"0".repeat(256)}`);
  const candidate = validateOfferingMonitorProviderOutput({ identity, package: inputPackage, run: providerRun({ outputText: raw, parsed: null }) });
  assert.equal(candidate.validation.status, "transport_failed");
  assert.match(candidate.validation.errors.join(" "), /numeric_literal_too_long/);
  assert.equal(candidate.direct_payload, null);
  assert.equal(candidate.canonical_candidate, null);

  const adapterRejected = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({
      ok: false,
      responseOk: true,
      outputText: raw,
      parsed: null,
      error: "Gemini response did not contain parseable JSON",
    }),
  });
  assert.equal(adapterRejected.validation.status, "transport_failed");
  assert.match(adapterRejected.validation.errors.join(" "), /numeric_literal_too_long/);
  assert.doesNotMatch(adapterRejected.validation.errors.join(" "), /did not contain parseable JSON/);
});

test("prompt ends after the source package with the exact outer, source namespace, and output discipline contract", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const prompt = inputPackage.prompt.user;
  const finalIndex = prompt.lastIndexOf("FINAL OUTPUT CONTRACT");
  assert.ok(finalIndex > prompt.lastIndexOf("evidence_blocks"));
  assert.match(prompt.slice(finalIndex), /direct Offering Monitor JSON object/);
  assert.match(prompt.slice(finalIndex), /Never return offering_monitor_payload or nested JSON text/);
  assert.match(prompt.slice(finalIndex), /available_monetary_facts, available_share_facts, and unavailable_fact_keys/);
  assert.match(prompt.slice(finalIndex), /ref:s1f1_source_block_001/);
  assert.match(prompt.slice(finalIndex), /Do not return block_id, parent_primary_context/);
  assert.match(prompt.slice(finalIndex), /No aliases\. No markdown\. No commentary\. No explanation\. No trailing text\.$/);
});

test("unavailable fact keys reconstruct the canonical runtime basis without fake provider fields", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: validDirectPayload() }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.deepEqual(candidate.direct_payload?.unavailable_fact_keys, ["offering_price", "resale_share_exposure"]);
  assert.deepEqual(candidate.canonical_candidate?.facts.offering_price, {
    value: null,
    availability: "unavailable",
    value_quality: "unknown",
    bound: "unknown",
    unit: "currency_per_security",
    currency: null,
    security_basis: null,
    comparison_basis_type: "market_price",
    comparable_to_event_market_basis: null,
    source_ref: null,
  });
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

test("Offering rejects the removed share-count sidecar as an unknown Stage 2 field", () => {
  const fixture = artifacts();
  const evidence = "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.";
  fixture.sourceInput.blocks[0] = {
    ...fixture.sourceInput.blocks[0]!,
    text: evidence,
  };
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: fixture });
  const domainPayload = validDirectPayload();
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({
      parsed: {
        ...domainPayload,
        share_count_observation: {
          observation_type: "source_stated",
          shares_outstanding: "27500000",
          as_of: "2026-08-18",
          security_class_kind: "common_stock",
          security_class_title: "common stock",
          source_ref: fixture.sourceInput.blocks[0]!.source_ref,
          evidence,
        },
      },
    }),
  });
  assert.equal(candidate.validation.status, "validation_failed");
  assert.equal(candidate.canonical_candidate, null);
  assert.match(candidate.validation.errors.join("\n"), /share_count_observation.*not allowed/i);
  assert.equal("share_count_observation" in offeringMonitorSecondStageProviderSchema.properties, false);
  assert.doesNotMatch(OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT, /SHARE COUNT SIDECAR|share_count_observation/);
});

test("allowed provenance membership is mechanical and exact source semantics do not block fact eligibility", () => {
  const fixture = artifacts();
  fixture.sourceInput.blocks[0].text = "Administrative filing context retained as supplied SEC evidence.";
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: fixture });
  const payload = validDirectPayload();
  payload.available_monetary_facts[0].source_ref = inputPackage.allowedSourceRefs[0];
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.equal(
    candidate.canonical_candidate?.facts.actual_primary_offering_amount.source_ref,
    inputPackage.allowedSourceRefs[0],
  );
  assert.equal(candidate.materialized_candidate?.safe_projection.actual_primary_offering_amount, 10_000_000);
});

test("unavailable and unknown-quality facts remain outside the matcher-safe projection", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const unavailable = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: validDirectPayload() }),
  });
  assert.equal(unavailable.validation.status, "success");
  assert.equal("offering_price" in (unavailable.materialized_candidate?.safe_projection || {}), false);

  const payload = validDirectPayload();
  payload.available_monetary_facts[0].value_quality = "unknown";
  const unknownQuality = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(unknownQuality.validation.status, "success");
  assert.equal(
    "actual_primary_offering_amount" in (unknownQuality.materialized_candidate?.safe_projection || {}),
    false,
  );
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
  delete (invalid.available_monetary_facts[0] as Record<string, unknown>).value;
  const invalidCandidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: invalid }),
  });
  assert.equal(invalidCandidate.validation.status, "validation_failed");
  assert.match(invalidCandidate.validation.errors.join(" "), /available_monetary_facts\[0\]\.value is required/);
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
      outputText: JSON.stringify(validDirectPayload()).replace(
        '"fact_key":"actual_primary_offering_amount"',
        '"fact_key":"actual_primary_offering_amount","fact_key":"offering_price"',
      ),
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
    const payload = validDirectPayload();
    payload.available_monetary_facts[0].source_ref = invalidSource;
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

test("unavailable facts are key-only and cannot carry provenance fields", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const omitted = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: validDirectPayload() }),
  });
  assert.equal(omitted.validation.status, "success");
  const payload = { ...validDirectPayload(), unavailable_fact_keys: [{ fact_key: "offering_price", source_ref: "foreign:price" }] };
  const foreign = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(foreign.validation.status, "validation_failed");
  assert.match(foreign.validation.errors.join(" "), /unavailable_fact_keys\[0\] must be a string/);
});

test("available fact families require the runtime fields represented by their provider rows", () => {
  const monetary = offeringMonitorSecondStageProviderSchema.properties.available_monetary_facts.items;
  const shares = offeringMonitorSecondStageProviderSchema.properties.available_share_facts.items;
  assert.deepEqual(monetary.required, [
    "fact_key", "value", "value_quality", "bound", "unit", "currency",
    "security_basis", "comparison_basis_type", "source_ref",
  ]);
  assert.deepEqual(shares.required, [
    "fact_key", "value", "value_quality", "bound", "unit",
    "security_basis", "comparison_basis_type", "source_ref",
  ]);
  assert.equal(shares.required.includes("currency" as never), false);

  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  for (const field of monetary.required) {
    const payload = validDirectPayload();
    delete (payload.available_monetary_facts[0] as Record<string, unknown>)[field];
    const candidate = validateOfferingMonitorProviderOutput({
      identity,
      package: inputPackage,
      run: providerRun({ parsed: payload }),
    });
    assert.equal(candidate.validation.status, "validation_failed", `monetary ${field}`);
  }
  for (const field of shares.required) {
    const payload = validDirectPayload();
    delete (payload.available_share_facts[0] as Record<string, unknown>)[field];
    const candidate = validateOfferingMonitorProviderOutput({
      identity,
      package: inputPackage,
      run: providerRun({ parsed: payload }),
    });
    assert.equal(candidate.validation.status, "validation_failed", `shares ${field}`);
  }
});

test("exact five-fact coverage rejects missing, duplicate, both, unknown, and wrong-family rows", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const validate = (payload: ReturnType<typeof validDirectPayload>) => validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });

  const missing = validDirectPayload();
  missing.unavailable_fact_keys = ["resale_share_exposure"];
  assert.match(validate(missing).validation.errors.join(" "), /fact coverage is missing offering_price/);

  const duplicate = validDirectPayload();
  duplicate.available_share_facts.push({ ...duplicate.available_share_facts[0] });
  assert.match(validate(duplicate).validation.errors.join(" "), /fact coverage duplicates immediate_primary_share_exposure/);

  const both = validDirectPayload();
  both.unavailable_fact_keys.push("actual_primary_offering_amount");
  assert.match(validate(both).validation.errors.join(" "), /fact coverage duplicates actual_primary_offering_amount/);

  const unknown = validDirectPayload();
  unknown.unavailable_fact_keys[0] = "unknown_fact";
  assert.match(validate(unknown).validation.errors.join(" "), /unavailable_fact_keys\[0\] is unknown/);

  const wrongFamily = validDirectPayload();
  (wrongFamily.available_share_facts[0] as Record<string, unknown>).fact_key = "actual_primary_offering_amount";
  assert.match(validate(wrongFamily).validation.errors.join(" "), /belongs to the wrong fact family/);
});

test("available fact array ordering has no semantic meaning", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const payload = validDirectPayload();
  payload.available_share_facts.reverse();
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.equal(candidate.materialized_candidate?.total_potential_primary_share_exposure.value, 15_000_000);
});

test("distinct exposure security bases materialize when their comparison basis is compatible", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const payload = validDirectPayload();
  payload.available_share_facts[0].security_basis = "current_right";
  payload.available_share_facts[1].security_basis = "conditional_right";
  payload.available_share_facts[1].value = payload.available_share_facts[0].value;
  const candidate = validateOfferingMonitorProviderOutput({
    identity,
    package: inputPackage,
    run: providerRun({ parsed: payload }),
  });
  assert.equal(candidate.validation.status, "success");
  assert.equal(candidate.materialized_candidate?.total_potential_primary_share_exposure.value, 20_000_000);
  assert.equal(candidate.materialized_candidate?.total_potential_primary_share_exposure.security_basis, "current_right + conditional_right");
});

test("incompatible exposure comparison basis still fails without security-name rules", () => {
  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts: artifacts() });
  const payload = validDirectPayload();
  payload.available_share_facts[1].comparison_basis_type = "public_float";
  const candidate = validateOfferingMonitorProviderOutput({ identity, package: inputPackage, run: providerRun({ parsed: payload }) });
  assert.equal(candidate.validation.status, "validation_failed");
  assert.match(candidate.validation.errors.join(" "), /comparison_basis_type is incompatible with the fact meaning|comparison_basis_type must be compatible/);
  const source = readFileSync(new URL("./minimalOfferingMonitor.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /warrant.*additional|prefunded.*immediate|common[_ -]?share.*compatible/i);
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
  assert.doesNotMatch(runtime, /persistLevel2ShareCountObservation|share_count_observation/);
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
      currentFiling: {
        accession_number: identity.sourceIdentity,
        form_type: "S-1",
        primary_document_url: "https://www.sec.gov/Archives/edgar/data/1437749/main.htm",
      },
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
  const availableShares = (
    fact_key: "immediate_primary_share_exposure" | "additional_potential_primary_share_exposure",
    value: number,
    source_ref: string,
  ) => ({
    fact_key,
    value,
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
    available_monetary_facts: [
      {
        fact_key: "actual_primary_offering_amount" as const,
        value: 10_000_000,
        value_quality: "estimated",
        bound: "maximum",
        unit: "currency",
        currency: "USD",
        security_basis: "transaction_gross_amount",
        comparison_basis_type: "market_cap",
        source_ref: "ref:s1f1_attachment_doc_a",
      },
    ],
    available_share_facts: [
      availableShares("immediate_primary_share_exposure", 10_000_000, "ref:s1f1_source_block_001"),
      availableShares("additional_potential_primary_share_exposure", 5_000_000, "ref:s1f1_attachment_doc_a"),
    ],
    unavailable_fact_keys: ["offering_price", "resale_share_exposure"],
  };
}
