import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
  type OwnershipContextAssertion,
} from "./ownershipStructuredContext.ts";
import {
  OWNERSHIP_CONTEXT_LLM_VERSION,
  mapOwnershipContextLlmDto,
} from "./ownershipStructuredContextAnalyzer.ts";
import {
  buildOwnershipSemanticVerifierInput,
  validateOwnershipSemanticVerifierOutput,
  verifyOwnershipSemanticAssertions,
} from "./ownershipSemanticVerifier.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;

test("current UWMC selection candidate builds exact neutral verifier inputs but remains canonically rejected before pipeline verification", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const rows = ["R1", "R2", "R3", "R4", "R5"].map((row) => ({
    row,
    owner_relations: [
      { owner: "O1", relation: "indirect", evidence: ["F3"] },
      { owner: "O2", relation: "indirect", evidence: ["F3"] },
    ],
  })) as Row[];
  for (const index of [0, 1, 3]) {
    rows[index].rule_10b5_1 = { applies: true, owner: "O2", evidence: ["F1"] };
  }
  rows[4].derivative_underlying_relation = { underlying: "S6", evidence: ["F5"] };
  const mapping = mapOwnershipContextLlmDto({
    candidate: { version: OWNERSHIP_CONTEXT_LLM_VERSION, rows },
    source: sourceFor(state),
    inventory: state.inventory,
  });
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  if (!mapping.ok) return;
  const canonical = validateOwnershipContextCandidate(mapping.value, state.inventory);
  assert.equal(canonical.ok, false, "wrong SFS indirect relations stop before the semantic verifier pipeline");

  const mappedRows = mapping.value.rows as Row[];
  const firstAssertions = mappedRows[0].assertions as OwnershipContextAssertion[];
  const matIndirect = firstAssertions.find((assertion) => assertion.fact === "ownership_relation"
    && assertion.owner_ref === "owner:form4:0:0")!;
  const sfsIndirect = firstAssertions.find((assertion) => assertion.fact === "ownership_relation"
    && assertion.owner_ref === "owner:form4:0:1")!;
  const matInput = verifierInput(state, 0, matIndirect);
  const sfsInput = verifierInput(state, 0, sfsIndirect);
  assert.equal(matInput.neutral_bindings.owner?.xml_name, "Mat Ishbia");
  assert.equal(sfsInput.neutral_bindings.owner?.xml_name, "SFS HOLDING CORP");
  assert.equal(sfsInput.subject_refs.footnote_ref, "footnote:F3");
  assert.match(sfsInput.evidence[0].exact_sec_evidence.footnote_xml || "", /SFS Corp/i);

  const sale10b51 = firstAssertions.find((assertion) => assertion.fact === "rule_10b5_1_applicability")!;
  const saleInput = verifierInput(state, 0, sale10b51);
  assert.equal(saleInput.subject_refs.footnote_ref, "footnote:F1");
  assert.match(saleInput.evidence[0].exact_sec_evidence.footnote_xml || "", /10b5-1/i);

  const conversionAssertions = (mappedRows[2].assertions as OwnershipContextAssertion[]);
  assert.equal(conversionAssertions.some((assertion) => assertion.fact === "rule_10b5_1_applicability"
    && assertion.status === "supported"), false, "F1 cannot spread from sale rows into a conversion row");
  const forgedConversion10b51: OwnershipContextAssertion = {
    fact: "rule_10b5_1_applicability",
    status: "supported",
    value: true,
    owner_ref: state.inventory.rows[2].ownerRefs[1],
    security_ref: state.inventory.rows[2].securityRef!,
    footnote_ref: "footnote:F1",
    evidence_refs: state.inventory.rows[2].evidenceRefs,
  };
  assert.throws(() => verifierInput(state, 2, forgedConversion10b51), /footnote_reference_invalid/);

  const derivative = (mappedRows[4].assertions as OwnershipContextAssertion[])
    .find((assertion) => assertion.fact === "derivative_underlying_relation")!;
  const derivativeInput = verifierInput(state, 4, derivative);
  assert.equal(derivativeInput.neutral_bindings.row_security?.xml_title, "UWM Paired Interests");
  assert.equal(derivativeInput.neutral_bindings.target_security?.xml_title, "Class A Common Stock");
});

test("verifier output contract cannot emit corrections, replacement owners, or invented evidence", () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const row = state.inventory.rows[0];
  const assertion: OwnershipContextAssertion = {
    fact: "ownership_relation",
    status: "supported",
    value: "direct",
    owner_ref: row.ownerRefs[0],
    evidence_refs: row.evidenceRefs,
  };
  const input = verifierInput(state, 0, assertion);
  assert.equal(validateOwnershipSemanticVerifierOutput({
    verdict: "supported", evidence_refs: row.evidenceRefs, short_reason: "The cited XML supports the candidate.",
  }, input).ok, true);
  assert.equal(validateOwnershipSemanticVerifierOutput({
    verdict: "supported", evidence_refs: row.evidenceRefs, short_reason: "Supported.", corrected_value: "indirect",
  }, input).ok, false);
  assert.equal(validateOwnershipSemanticVerifierOutput({
    verdict: "supported", evidence_refs: ["evidence:form4:0:999"], short_reason: "Invented evidence.",
  }, input).ok, false);
});

test("only verifier-supported target assertions remain eligible and original assertions are never rewritten", async () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const mapping = mapOwnershipContextLlmDto({
    candidate: {
      version: OWNERSHIP_CONTEXT_LLM_VERSION,
      rows: [{
        row: "R1",
        owner_relations: [{ owner: "O1", relation: "direct", evidence: ["R1"] }],
        derivative_underlying_relation: { underlying: "S2", evidence: ["R1"] },
      }],
    },
    source: sourceFor(state), inventory: state.inventory,
  });
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  if (!mapping.ok) return;
  const validated = validateOwnershipContextCandidate(mapping.value, state.inventory);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  if (!validated.ok) return;
  const original = structuredClone(validated.value);
  const result = await verifyOwnershipSemanticAssertions({
    candidate: validated.value,
    inventory: state.inventory,
    sourceXml: state.sourceXml,
    verifier: {
      name: "offline-stub",
      async verify(request) {
        const verdict = request.input.candidate_fact === "ownership_relation"
          ? "supported"
          : request.input.candidate_fact === "derivative_underlying_relation"
            ? "contradicted"
            : "insufficient";
        return {
          verdict,
          evidence_refs: verdict === "insufficient" ? [] : request.input.evidence.map((item) => item.evidence_ref),
          short_reason: `Offline ${verdict} stub.`,
        };
      },
    },
  });
  assert.deepEqual(validated.value, original, "verdict processing cannot mutate the original candidate");
  assert.equal(result.targetCount, 2);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.ineligibleCount, 1);
  const effective = result.effectiveCandidate.rows[0].assertions;
  assert.equal(effective.some((assertion) => assertion.fact === "ownership_relation"), true);
  assert.equal(effective.some((assertion) => assertion.fact === "derivative_underlying_relation"), false);
  assert.equal(effective.some((assertion) => assertion.fact === "footnote_scope"), false);
  assert.equal(effective.some((assertion) => assertion.fact === "owner_attribution"), false);
  assert.equal(effective.some((assertion) => assertion.status === "unresolved"), false);
});

test("unconfigured, failed, and invalid verifier outcomes fail closed per assertion while simple Form 144 attribution is not verified", async () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const row = state.inventory.rows[0];
  const candidate = validatedCandidate(state, [{
    fact: "ownership_relation",
    status: "supported",
    value: "direct",
    owner_ref: row.ownerRefs[0],
    evidence_refs: row.evidenceRefs,
  }]);
  const unconfigured = await verifyOwnershipSemanticAssertions({
    candidate, inventory: state.inventory, sourceXml: state.sourceXml,
  });
  assert.equal(unconfigured.eligibleCount, 0);
  assert.equal(unconfigured.records[0].reason, "ownership_semantic_verifier_unconfigured");
  const failed = await verifyOwnershipSemanticAssertions({
    candidate, inventory: state.inventory, sourceXml: state.sourceXml,
    verifier: { name: "failed-stub", async verify() { throw new Error("offline failure"); } },
  });
  assert.equal(failed.records[0].reason, "ownership_semantic_verifier_failed");
  const invalid = await verifyOwnershipSemanticAssertions({
    candidate, inventory: state.inventory, sourceXml: state.sourceXml,
    verifier: { name: "invalid-stub", async verify() { return { verdict: "supported" }; } },
  });
  assert.equal(invalid.records[0].reason, "ownership_semantic_verifier_output_invalid");

  const form144 = canonicalState("source-amcor-form144-no-prior-sales.json");
  const form144Row = form144.inventory.rows[0];
  let calls = 0;
  const account = validatedCandidate(form144, [{
    fact: "owner_attribution", status: "supported", value: form144Row.ownerRefs[0],
    evidence_refs: form144Row.evidenceRefs,
  }]);
  const skipped = await verifyOwnershipSemanticAssertions({
    candidate: account, inventory: form144.inventory, sourceXml: form144.sourceXml,
    verifier: { name: "must-not-run", async verify() { calls += 1; return {}; } },
  });
  assert.equal(calls, 0);
  assert.equal(skipped.targetCount, 0);
  assert.equal(skipped.effectiveCandidate.rows[0].assertions.length, 1);
});

function verifierInput(
  state: ReturnType<typeof canonicalState>,
  rowIndex: number,
  assertion: OwnershipContextAssertion,
) {
  return buildOwnershipSemanticVerifierInput({
    form: state.inventory.form,
    sourceXml: state.sourceXml,
    inventory: state.inventory,
    rowRef: state.inventory.rows[rowIndex].rowRef,
    assertion,
  });
}

function validatedCandidate(state: ReturnType<typeof canonicalState>, assertions: OwnershipContextAssertion[]) {
  const candidate = {
    version: "ownership_context_v1",
    event_ref: state.inventory.eventRef,
    form: state.inventory.form,
    source_fingerprint: state.inventory.sourceFingerprint,
    rows: state.inventory.rows.map((row, index) => ({ row_ref: row.rowRef, assertions: index === 0 ? assertions : [] })),
  };
  const validation = validateOwnershipContextCandidate(candidate, state.inventory);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  if (!validation.ok) throw new Error("test candidate invalid");
  return validation.value;
}

function canonicalState(filename: string) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const sourceXml = String(fixture.filingText);
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const form = formType.toUpperCase().startsWith("144") ? "form144" as const : "form4" as const;
  const rawItem = {
    id: rawItemId,
    source_unique_id: accession,
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      cik: xmlValue(sourceXml, "issuerCik"),
      ownership_issuer_cik: xmlValue(sourceXml, "issuerCik"),
      ticker: xmlValue(sourceXml, "issuerTradingSymbol"),
      ownership_issuer_trading_symbol: xmlValue(sourceXml, "issuerTradingSymbol"),
      ownership_source_text: sourceXml,
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({
    eventId, rawItem, symbol: xmlValue(sourceXml, "issuerTradingSymbol"),
  });
  const rows = form === "form4" ? built.form4Transactions : built.form144ProposedSales;
  const inventory = buildOwnershipContextReferenceInventory({
    eventId,
    form,
    isAmendment: formType.endsWith("/A"),
    sourceFingerprint: fingerprint,
    rows,
    sourceXml,
  });
  return { sourceXml, formType, rawItem, rows, inventory };
}

function sourceFor(state: ReturnType<typeof canonicalState>) {
  return {
    xml: state.sourceXml,
    form: state.formType,
    reportingOwners: state.inventory.sourceReportingOwnerNames.map((name) => ({ cik: null, name })),
  };
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*(?:<(?:[A-Za-z_][\\w.-]*:)?value\\b[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/(?:[A-Za-z_][\\w.-]*:)?value>)?\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}
