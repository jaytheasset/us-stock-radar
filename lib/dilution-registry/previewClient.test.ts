import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseDilutionRegistryJson as serverParse } from "./preview.ts";
import { parseDilutionRegistryJson as browserParse } from "./previewClient.ts";
import { createDilutionRegistryApplyRequestBody } from "./applyClient.ts";
import { createDilutionStoredSplitClauseBinding, dilutionContractSourceRef } from "./corporateActionAdjustment.ts";

function fixture(urlSuffix = "") {
  const url = `https://www.sec.gov/Archives/edgar/data/1/000000000124000001/contract.htm${urlSuffix}`;
  const raw = "11111111-1111-4111-8111-111111111111";
  const sourceRef = dilutionContractSourceRef(raw, url);
  return {
    issuer: { issuer_cik: "0000000001", ticker: "TEST" },
    instruments: [{ instrument_key: "issuer-note-a", name: "Note A" }],
    snapshots: [{ instrument_key: "issuer-note-a", status: "current" }],
    activities: [], totals: [],
    corporate_action_clause_bindings: [{
      instrument_key: "issuer-note-a", execution_id: `fse:v1:${"a".repeat(64)}`,
      canonical_security_class_id: "sc:v1:0000000001:common_stock:single",
      contract_accession: "0000000001-24-000001", contract_raw_item_id: raw,
      source_ref: sourceRef, source_document_url: url,
      field_adjustments: [{
        field: "remaining_units", operation: "multiply_by_split_ratio",
        evidence_identity: {
          version: "corporate_action_evidence_identity_v1", source_ref: sourceRef,
          range_start: 0, range_end: 6,
          source_content_hash: createHash("sha256").update("clause").digest("hex"), exact_source: true,
        },
      }],
    }],
  };
}

test("Web Crypto Preview equals synchronous server parsing and keeps exact source bytes", async () => {
  for (const suffix of ["", "?label=한글🛰", "?broken=\ud800", "#fragment"]) {
    const payload = fixture(suffix);
    const source = ` \r\n${JSON.stringify(payload)}\n`;
    const expected = serverParse(source);
    assert.equal(expected.ok, true);
    assert.deepEqual(await browserParse(source), expected);
    assert.equal(await createDilutionRegistryApplyRequestBody({ previewedSource: source, source }), source);
  }
  const input = fixture().corporate_action_clause_bindings[0]!;
  const stored = createDilutionStoredSplitClauseBinding("0000000001", input);
  const expectedIdentity = [
    "dilution-corporate-action-clause-binding-v1", "0000000001", "issuer-note-a",
    input.execution_id, input.canonical_security_class_id, input.contract_accession,
    input.contract_raw_item_id, input.source_ref, input.source_document_url,
    [{ field: "remaining_units", operation: "multiply_by_split_ratio", evidenceIdentity: input.field_adjustments[0]!.evidence_identity }],
  ];
  assert.equal(stored.bindingId, `dcab:v1:${createHash("sha256").update(JSON.stringify(expectedIdentity)).digest("hex")}`);
  assert.equal(stored.supersedesBindingId, null);
  assert.equal(dilutionContractSourceRef(input.contract_raw_item_id.toUpperCase(), input.source_document_url), input.source_ref);
});

test("browser and server both reject malformed bindings, URL hashes and dangling references", async () => {
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    (p) => { p.issuer.issuer_cik = "0000000000"; },
    (p) => { p.corporate_action_clause_bindings[0]!.instrument_key = "missing"; },
    (p) => { p.corporate_action_clause_bindings[0]!.execution_id = "invalid"; },
    (p) => { p.corporate_action_clause_bindings[0]!.canonical_security_class_id = "preferred"; },
    (p) => { p.corporate_action_clause_bindings[0]!.contract_accession = "0000000001-24-000002"; },
    (p) => { p.corporate_action_clause_bindings[0]!.contract_raw_item_id = "not-a-uuid"; },
    (p) => { p.corporate_action_clause_bindings[0]!.source_document_url += "?tampered=1"; },
    (p) => { const b = p.corporate_action_clause_bindings[0]!; b.source_ref = b.source_ref.slice(0, -1) + "x"; },
    (p) => { const b = p.corporate_action_clause_bindings[0]!; b.source_document_url = b.source_document_url.replace("data/1/", "data/2/"); b.source_ref = dilutionContractSourceRef(b.contract_raw_item_id, b.source_document_url); },
    (p) => { const b = p.corporate_action_clause_bindings[0]!; b.source_document_url = b.source_document_url.replace("www.sec.gov", "example.com"); b.source_ref = dilutionContractSourceRef(b.contract_raw_item_id, b.source_document_url); },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments = []; },
    (p) => { const b = p.corporate_action_clause_bindings[0]!; b.field_adjustments.push(structuredClone(b.field_adjustments[0]!)); },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.field = "unsupported"; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.operation = "divide_by_split_ratio"; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity.range_start = -1; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity.range_end = 0; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity.exact_source = false; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity.source_ref = "different"; },
    (p) => { p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity.source_content_hash = "bad-hash"; },
    (p) => { Object.assign(p.corporate_action_clause_bindings[0]!.field_adjustments[0]!.evidence_identity, { unexpected: true }); },
    (p) => { Object.assign(p.corporate_action_clause_bindings[0]!, { supersedes_binding_id: "bad" }); },
    (p) => { p.snapshots[0]!.instrument_key = "missing"; },
  ];
  for (const mutate of mutations) {
    const payload = fixture(); mutate(payload);
    const source = JSON.stringify(payload);
    const expected = serverParse(source);
    assert.equal(expected.ok, false, mutate.toString());
    assert.deepEqual(await browserParse(source), expected);
    await assert.rejects(createDilutionRegistryApplyRequestBody({ previewedSource: source, source }), /source is invalid/);
  }
});

test("missing Web Crypto never accepts a binding without checking its URL hash", async (t) => {
  t.mock.method(crypto.subtle, "digest", async () => { throw new Error("digest unavailable"); });
  assert.deepEqual(await browserParse(JSON.stringify(fixture())), {
    ok: false, errors: ["A Corporate Action clause binding is invalid."],
  });
  assert.equal((await browserParse('{"instruments":[],"snapshots":[],"activities":[],"totals":[]}')).ok, true);
});
