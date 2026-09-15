import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { persistOwnershipStructuredContext, OwnershipContextValidationError } from "./ownershipContextPersistence.ts";
import { readCurrentOwnershipFacts } from "./ownershipMonitorPersistence.ts";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
  validateStoredOwnershipContextEnvelope,
} from "./ownershipStructuredContext.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;

test("ownership_context_v1 accepts bounded owner relations, explicit footnote scopes, and safe omissions", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  const candidate = contextCandidate(inventory, 0, [
    supported("owner_attribution", row.ownerRefs[0], row.evidenceRefs[0]),
    { ...supported("ownership_relation", "indirect", row.evidenceRefs[0]), owner_ref: row.ownerRefs[0], footnote_ref: "footnote:F3" },
    { ...supported("ownership_relation", "direct", row.evidenceRefs[0]), owner_ref: row.ownerRefs[1], footnote_ref: "footnote:F3" },
    supported("economic_direction", "other", row.evidenceRefs[0]),
    { ...supported("rule_10b5_1_applicability", true, row.evidenceRefs[0]), footnote_ref: "footnote:F1" },
    { ...supported("footnote_scope", "row", row.evidenceRefs[0]), footnote_ref: "footnote:F1" },
    { ...supported("footnote_scope", "owner", row.evidenceRefs[0]), owner_ref: row.ownerRefs[0], footnote_ref: "footnote:F3" },
    { fact: "amendment_effect", status: "unresolved", evidence_refs: [] },
  ]);
  const result = validateOwnershipContextCandidate(candidate, inventory);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.rows[0].assertions.filter((item) => item.fact === "ownership_relation").length, 2);
  assert.equal(result.value.rows[0].assertions.filter((item) => item.fact === "footnote_scope").length, 2);
  assert.equal(JSON.stringify(result.value).includes("632874"), false, "validated context stores no direct number");
  assert.equal(JSON.stringify(result.value).includes("UWMC"), false, "validated context stores no ticker");
  assert.equal(JSON.stringify(result.value).includes('"C"'), false, "validated context stores no transaction code");
});

test("unknown keys, direct-value injection, forged refs, unsupported evidence, and array enum coercion are rejected", () => {
  const state = canonicalState("form144-ambiguous-10b5-multiple-rows.json");
  const inventory = inventoryFor(state);
  const base = contextCandidate(inventory, 0, [supported("economic_direction", "sell", inventory.rows[0].evidenceRefs[0])]);
  const cases: Array<[string, unknown]> = [
    ["root direct field", { ...base, ticker: "AMBX" }],
    ["row direct field", { ...base, rows: [{ ...record(base.rows[0]), shares: 1000 }] }],
    ["assertion direct field", mutateAssertion(base, { transaction_code: "S" })],
    ["forged event", { ...base, event_ref: "event:99999999-9999-4999-8999-999999999999" }],
    ["forged row", { ...base, rows: [{ ...record(base.rows[0]), row_ref: "row:form144:99" }] }],
    ["forged evidence", mutateAssertion(base, { evidence_refs: ["evidence:form144:0:99"] })],
    ["supported without evidence", mutateAssertion(base, { evidence_refs: [] })],
    ["array enum", mutateAssertion(base, { value: ["sell"] })],
    ["numeric optional ref", mutateAssertion(base, { owner_ref: 1 })],
    ["null optional ref", mutateAssertion(base, { security_ref: null })],
    ["model validation flag", mutateAssertion(base, { validated: true })],
  ];
  for (const [label, candidate] of cases) {
    assert.equal(validateOwnershipContextCandidate(candidate, inventory).ok, false, label);
  }
});

test("owner-specific XML conflicts and invented derivative security relations fail closed", () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const inventory = inventoryFor(state);
  const derivativeRow = inventory.rows[0];
  assert.equal(validateOwnershipContextCandidate(
    contextCandidate(inventory, 0, [supported("economic_direction", "buy", derivativeRow.evidenceRefs[0])]),
    inventory,
  ).ok, false);
  assert.equal(validateOwnershipContextCandidate(
    contextCandidate(inventory, 0, [{
      ...supported("ownership_relation", "indirect", derivativeRow.evidenceRefs[0]),
      owner_ref: derivativeRow.ownerRefs[0],
    }]),
    inventory,
  ).ok, false);
  assert.equal(validateOwnershipContextCandidate(
    contextCandidate(inventory, 0, [{
      ...supported("derivative_underlying_relation", derivativeRow.securityRef!, derivativeRow.evidenceRefs[0]),
      security_ref: derivativeRow.securityRef!,
    }]),
    inventory,
  ).ok, false, "self-security is not the parser underlying security");
  assert.equal(validateOwnershipContextCandidate(
    contextCandidate(inventory, 0, [{
      ...supported("derivative_underlying_relation", derivativeRow.underlyingSecurityRefs[0], derivativeRow.evidenceRefs[0]),
      security_ref: derivativeRow.securityRef!,
    }]),
    inventory,
  ).ok, true, "explicit XML underlying element has an independent target ref");
});

test("neutral refs require the direct XML row binding and never follow stale calculation metadata", () => {
  const state = canonicalState("source-venu-form4-section16-derivative-gift.json");
  const row = state.form4[0];
  const withoutUnderlying = state.sourceXml.replace(
    /<(?:[A-Za-z_][\w.-]*:)?underlyingSecurity\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?underlyingSecurity>/i,
    "",
  );
  const noUnderlyingInventory = buildOwnershipContextReferenceInventory({
    eventId, form: "form4", isAmendment: false, sourceFingerprint: fingerprint,
    rows: state.form4, sourceXml: withoutUnderlying,
  });
  assert.deepEqual(noUnderlyingInventory.rows[0].underlyingSecurityRefs, []);

  const withoutRowFootnote = state.sourceXml.replace(/<(?:[A-Za-z_][\w.-]*:)?footnoteId\b[^>]*\bid=["']F1["'][^>]*\/>/i, "");
  const noLinkInventory = buildOwnershipContextReferenceInventory({
    eventId, form: "form4", isAmendment: false, sourceFingerprint: fingerprint,
    rows: [row], sourceXml: withoutRowFootnote,
  });
  assert.deepEqual(noLinkInventory.rows[0].linkedFootnoteRefs, []);
});

test("AGIG F1 and F2 remain independently source-bound to their own rows", () => {
  const inventory = inventoryFor(canonicalState("source-agig-form4-purchase.json"));
  const cases = [[0, "footnote:F1"], [1, "footnote:F2"]] as const;
  for (const [rowIndex, footnoteRef] of cases) {
    const row = inventory.rows[rowIndex];
    assert.ok(row.linkedFootnoteRefs.includes(footnoteRef), `${footnoteRef} inventory link`);
    assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, rowIndex, [{
      ...supported("footnote_scope", "row", row.evidenceRefs[0]),
      footnote_ref: footnoteRef,
    }]), inventory).ok, true, `${footnoteRef} row scope`);
  }
});

test("multi-owner relations require one explicit, non-negated, non-conflicting owner clause", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  const relation = (ownerIndex: number, value: "direct" | "indirect", footnoteRef = "footnote:F3") => ({
    ...supported("ownership_relation", value, row.evidenceRefs[0]),
    owner_ref: row.ownerRefs[ownerIndex],
    footnote_ref: footnoteRef,
  });
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [relation(0, "indirect")]), inventory).ok, true);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [relation(1, "direct")]), inventory).ok, true);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [relation(1, "indirect")]), inventory).ok, false, "SFS indirect is not supported");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [relation(0, "direct")]), inventory).ok, false, "same footnote cannot transfer SFS direct to Mat");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 2, [{
    ...relation(0, "indirect", "footnote:F1"),
    owner_ref: inventory.rows[2].ownerRefs[0],
    evidence_refs: [inventory.rows[2].evidenceRefs[0]],
  }]), inventory).ok, false, "a footnote linked only to another row cannot be reused");

  for (const text of [
    "The securities may be held directly by Alpha Owner.",
    "The securities are not held directly by Alpha Owner.",
    "Alpha Owner and direct ownership are referenced without an owner-bound relation clause.",
    "The securities are held directly by Alpha Owner and indirectly by Alpha Owner.",
  ]) {
    const guarded = relationInventory(text);
    const guardedRow = guarded.rows[0];
    assert.equal(validateOwnershipContextCandidate(contextCandidate(guarded, 0, [{
      ...supported("ownership_relation", "direct", guardedRow.evidenceRefs[0]),
      owner_ref: guardedRow.ownerRefs[0], footnote_ref: "footnote:F1",
    }]), guarded).ok, false, text);
  }
});

test("footnote scope identity is per linked footnote and Rule 10b5-1 true stays row-local", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  const duplicateScope = {
    ...supported("footnote_scope", "row", row.evidenceRefs[0]),
    footnote_ref: "footnote:F1",
  };
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [duplicateScope, duplicateScope]), inventory).ok, false);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("footnote_scope", "owner", row.evidenceRefs[0]),
    owner_ref: row.ownerRefs[1], footnote_ref: "footnote:F1",
  }]), inventory).ok, true, "F1 explicitly names SFS through the source-declared alias");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("footnote_scope", "owner", row.evidenceRefs[0]),
    owner_ref: row.ownerRefs[0], footnote_ref: "footnote:F1",
  }]), inventory).ok, false, "SFS plan footnote cannot be assigned Mat owner scope");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("footnote_scope", "security", row.evidenceRefs[0]),
    security_ref: row.securityRef!, footnote_ref: "footnote:F1",
  }]), inventory).ok, false, "security scope requires the linked footnote to name the row security");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 2, [{
    ...supported("footnote_scope", "row", inventory.rows[2].evidenceRefs[0]),
    footnote_ref: "footnote:F1",
  }]), inventory).ok, false, "footnote from another row is rejected");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("rule_10b5_1_applicability", true, row.evidenceRefs[0]), footnote_ref: "footnote:F1",
  }]), inventory).ok, true);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("rule_10b5_1_applicability", true, row.evidenceRefs[0]),
    owner_ref: row.ownerRefs[0], footnote_ref: "footnote:F1",
  }]), inventory).ok, false, "SFS plan cannot be spread to Mat through owner_ref");
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 2, [{
    ...supported("rule_10b5_1_applicability", true, inventory.rows[2].evidenceRefs[0]), footnote_ref: "footnote:F1",
  }]), inventory).ok, false, "filing-level true cannot spread to a conversion row without F1");
  const negated = relationInventory("The transaction was not pursuant to a Rule 10b5-1 plan.", true);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(negated, 0, [{
    ...supported("rule_10b5_1_applicability", true, negated.rows[0].evidenceRefs[0]), footnote_ref: "footnote:F1",
  }]), negated).ok, false);
});

test("Form 144 blocks unsupported D/I and unlinked footnote scope while keeping account attribution", () => {
  const state = canonicalState("source-amcor-form144-no-prior-sales.json");
  const inventory = inventoryFor(state);
  const row = inventory.rows[0];
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [
    supported("owner_attribution", row.ownerRefs[0], row.evidenceRefs[0]),
  ]), inventory).ok, true);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("ownership_relation", "direct", row.evidenceRefs[0]), owner_ref: row.ownerRefs[0],
  }]), inventory).ok, false);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(inventory, 0, [{
    ...supported("footnote_scope", "row", row.evidenceRefs[0]), footnote_ref: "footnote:F1",
  }]), inventory).ok, false);
});

test("empty rows and empty row facts validate as an explicit sidecar replacement", async () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const inventory = inventoryFor(state);
  const empty = {
    version: "ownership_context_v1", event_ref: inventory.eventRef, form: inventory.form,
    source_fingerprint: inventory.sourceFingerprint, rows: [],
  };
  assert.equal(validateOwnershipContextCandidate(empty, inventory).ok, true);
  const emptyRow = { ...empty, rows: [{ row_ref: inventory.rows[0].rowRef, assertions: [] }] };
  assert.equal(validateOwnershipContextCandidate(emptyRow, inventory).ok, true);
  const writes: Row[] = [];
  const repository = {
    ...snapshotRepository(state),
    async persistContext(input: Row) {
      writes.push(structuredClone(input));
      return { ok: true, status: 200, data: { status: "stored", updated_row_count: 1 } };
    },
  };
  await persistOwnershipStructuredContext({ eventId, candidate: emptyRow }, repository);
  assert.deepEqual(writes[0].contexts, [], "empty facts clear prior sidecar state rather than acting as a no-op");
});

test("amendment_effect requires an amendment while ambiguous/conflict/unresolved remain valid statuses", () => {
  const base = canonicalState("form4-multi-owner-10b5-1-conversion.json");
  const baseInventory = inventoryFor(base);
  assert.equal(validateOwnershipContextCandidate(contextCandidate(baseInventory, 0, [
    supported("amendment_effect", "removes", baseInventory.rows[0].evidenceRefs[0]),
  ]), baseInventory).ok, false);

  const amendment = canonicalState("form4a-correction-row-safety.json");
  const amendmentInventory = inventoryFor(amendment);
  const assertions = [
    supported("amendment_effect", "removes", amendmentInventory.rows[0].evidenceRefs[0]),
    { fact: "economic_direction", status: "ambiguous", evidence_refs: amendmentInventory.rows[0].evidenceRefs },
    { fact: "ownership_relation", status: "conflict", evidence_refs: amendmentInventory.rows[0].evidenceRefs },
    { fact: "rule_10b5_1_applicability", status: "unresolved", evidence_refs: [] },
  ];
  assert.equal(validateOwnershipContextCandidate(
    contextCandidate(amendmentInventory, 0, assertions), amendmentInventory,
  ).ok, true);
});

test("official reader strips raw context_facts and isolates stale or malformed context from direct XML facts", async () => {
  const state = canonicalState("form4-multi-owner-10b5-1-conversion.json");
  const inventory = inventoryFor(state);
  const valid = envelope(inventory, 2, [{
    ...supported("derivative_underlying_relation", inventory.rows[2].underlyingSecurityRefs[0], inventory.rows[2].evidenceRefs[0]),
    security_ref: inventory.rows[2].securityRef!,
  }]);
  state.form4[2].context_facts = valid;
  const available = await readCurrentOwnershipFacts(eventId, snapshotRepository(state));
  assert.equal(available.status, "available");
  if (available.status !== "available") return;
  assert.equal(available.context?.status, "available");
  assert.equal(Object.hasOwn(available.rows[2], "context_facts"), false);
  assert.equal(available.rows[2].price_per_share, 0, "exact XML zero survives context projection");
  assert.equal(available.rows[2].transaction_value, null, "unavailable direct null survives context projection");

  const staleState = structuredClone(state);
  record(staleState.form4[2].context_facts).source_fingerprint = `ownership-context-v1:${"b".repeat(64)}`;
  const stale = await readCurrentOwnershipFacts(eventId, snapshotRepository(staleState));
  assert.equal(stale.status, "available");
  if (stale.status === "available") {
    assert.equal(stale.context?.status, "stale");
    assert.equal(stale.rows[2].price_per_share, 0);
  }

  const malformedState = structuredClone(state);
  record(malformedState.form4[2].context_facts).shares = 999;
  const malformed = await readCurrentOwnershipFacts(eventId, snapshotRepository(malformedState));
  assert.equal(malformed.status, "available");
  if (malformed.status === "available") {
    assert.equal(malformed.context?.status, "malformed");
    assert.equal(Object.hasOwn(malformed.rows[2], "context_facts"), false);
  }
});

test("snapshot failure falls back to canonical direct SELECTs with context ineligible", async () => {
  const state = canonicalState("form144-ambiguous-10b5-multiple-rows.json");
  const repository = snapshotRepository(state, { snapshotFails: true });
  const current = await readCurrentOwnershipFacts(eventId, repository);
  assert.equal(current.status, "available");
  if (current.status !== "available") return;
  assert.equal(current.rows.length, 2);
  assert.equal(current.context?.status, "unavailable");
  assert.equal(current.contextEligibility?.status, "ineligible");
});

test("source drift and invalid AI lineage disable only context, never verified direct rows", async () => {
  const sourceDrift = canonicalState("form144-ambiguous-10b5-multiple-rows.json");
  const drifted = await readCurrentOwnershipFacts(eventId, snapshotRepository(sourceDrift, {
    contextFingerprint: { status: "not_ready", reason: "ownership_context_source_unavailable" },
  }));
  assert.equal(drifted.status, "available");
  if (drifted.status === "available") {
    assert.equal(drifted.context?.status, "unavailable");
    assert.equal(drifted.rows[0].securities_to_be_sold, 1000);
  }

  const invalidAi = canonicalState("form4a-correction-row-safety.json");
  const invalidAiInventory = inventoryFor(invalidAi);
  invalidAi.form4[0].context_facts = {
    ...envelope(invalidAiInventory, 0, [
      supported("amendment_effect", "removes", invalidAiInventory.rows[0].evidenceRefs[0]),
    ]),
    ai_refs: { run_id: eventId, output_id: rawItemId },
  };
  const invalid = await readCurrentOwnershipFacts(eventId, snapshotRepository(invalidAi, {
    contextFingerprint: {
      status: "available", form: "form4", source_fingerprint: fingerprint,
      context_ai_refs_valid: false,
    },
  }));
  assert.equal(invalid.status, "available");
  if (invalid.status === "available") {
    assert.equal(invalid.context?.status, "malformed");
    assert.equal(invalid.rows[0].shares, 400);
  }
});

test("server persistence writes only sanitized validated context and performs no write on invalid context", async () => {
  const state = canonicalState("form4a-correction-row-safety.json");
  const inventory = inventoryFor(state);
  const writes: Row[] = [];
  const repository = {
    ...snapshotRepository(state),
    async persistContext(input: Row) {
      writes.push(structuredClone(input));
      return { ok: true, status: 200, data: { status: "stored", updated_row_count: 1 } };
    },
  };
  const candidate = contextCandidate(inventory, 0, [
    supported("amendment_effect", "removes", inventory.rows[0].evidenceRefs[0]),
  ]);
  const saved = await persistOwnershipStructuredContext({ eventId, candidate }, repository);
  assert.equal(saved.status, "stored");
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(writes[0]).includes("raw_payload"), false);
  assert.equal(JSON.stringify(writes[0]).includes("transaction_code"), false);

  await assert.rejects(
    persistOwnershipStructuredContext({ eventId, candidate: { ...candidate, ticker: "CORR" } }, repository),
    OwnershipContextValidationError,
  );
  assert.equal(writes.length, 1, "invalid context never reaches the context-only RPC");
  await assert.rejects(
    persistOwnershipStructuredContext({
      eventId, candidate,
      aiRefs: { run_id: "forged", output_id: rawItemId },
    }, repository),
    OwnershipContextValidationError,
  );
});

test("stored envelope validation rejects stale fingerprints and forged AI refs", () => {
  const state = canonicalState("form144-ambiguous-10b5-multiple-rows.json");
  const inventory = inventoryFor(state);
  const valid = envelope(inventory, 0, [supported("economic_direction", "sell", inventory.rows[0].evidenceRefs[0])]);
  assert.equal(validateStoredOwnershipContextEnvelope({ value: valid, rowRef: inventory.rows[0].rowRef, inventory }).ok, true);
  assert.equal(validateStoredOwnershipContextEnvelope({
    value: { ...valid, source_fingerprint: `ownership-context-v1:${"f".repeat(64)}` },
    rowRef: inventory.rows[0].rowRef,
    inventory,
  }).ok, false);
  assert.equal(validateStoredOwnershipContextEnvelope({
    value: { ...valid, ai_refs: { run_id: eventId, output_id: "forged" } },
    rowRef: inventory.rows[0].rowRef,
    inventory,
  }).ok, false);
});

function canonicalState(filename: string) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const sourceText = String(fixture.filingText);
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const rawItem = {
    id: rawItemId,
    source_unique_id: accession,
    raw_payload: {
      form_type: formType, accession_number: accession, cik: issuerCik,
      ownership_issuer_cik: issuerCik, ticker,
      ...(ticker ? { ownership_issuer_trading_symbol: ticker } : {}),
      ownership_source_text: sourceText,
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`,
      ownership_source_format: "ownership_xml", ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
  return {
    formType,
    sourceXml: sourceText,
    event: {
      id: eventId, raw_item_id: rawItemId, source_code: "sec_edgar", source_group: "filings",
      event_type: "insider_ownership", metadata: { form_type: formType, accession_number: accession },
    },
    form4: structuredClone(built.form4Transactions),
    form144: structuredClone(built.form144ProposedSales),
  };
}

function inventoryFor(state: ReturnType<typeof canonicalState>) {
  const form = state.form4.length ? "form4" as const : "form144" as const;
  return buildOwnershipContextReferenceInventory({
    eventId, form, isAmendment: state.formType.endsWith("/A"), sourceFingerprint: fingerprint,
    rows: form === "form4" ? state.form4 : state.form144,
    sourceXml: state.sourceXml,
  });
}

function contextCandidate(
  inventory: ReturnType<typeof inventoryFor>,
  rowIndex: number,
  assertions: readonly Row[],
) {
  return {
    version: "ownership_context_v1", event_ref: inventory.eventRef, form: inventory.form,
    source_fingerprint: inventory.sourceFingerprint,
    rows: [{ row_ref: inventory.rows[rowIndex].rowRef, assertions }],
  };
}

function supported(fact: string, value: unknown, evidenceRef: string): Row {
  return { fact, status: "supported", value, evidence_refs: [evidenceRef] };
}

function relationInventory(footnoteText: string, filingRule10b51 = false) {
  const sourceXml = `<ownershipDocument><aff10b5One>${filingRule10b51 ? "1" : "0"}</aff10b5One><reportingOwner><rptOwnerName>Alpha Owner</rptOwnerName></reportingOwner><reportingOwner><rptOwnerName>Beta Owner</rptOwnerName></reportingOwner><footnotes><footnote id="F1">${footnoteText}</footnote></footnotes><nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common</value></securityTitle><ownershipNature><directOrIndirectOwnership><value>D</value><footnoteId id="F1"/></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
  return buildOwnershipContextReferenceInventory({
    eventId,
    form: "form4",
    isAmendment: false,
    sourceFingerprint: fingerprint,
    sourceXml,
    rows: [{
      transaction_index: 0,
      security_title: "Common",
      reporting_owner_names: ["Alpha Owner", "Beta Owner"],
      evidence: ["<nonDerivativeTransaction>...</nonDerivativeTransaction>"],
      direct_or_indirect_ownership: "D",
      transaction_kind: "non_derivative",
      acquired_disposed_code: "A",
      is_10b5_1: null,
      calculation_basis: { footnote_ids: ["F1"], underlying_security_title: null },
    }],
  });
}

function envelope(inventory: ReturnType<typeof inventoryFor>, rowIndex: number, assertions: readonly Row[]) {
  return {
    version: "ownership_context_v1",
    source_fingerprint: inventory.sourceFingerprint,
    assertions,
  };
}

function mutateAssertion(candidate: ReturnType<typeof contextCandidate>, patch: Row) {
  const clone = structuredClone(candidate) as unknown as Row;
  const rows = clone.rows as Row[];
  const assertions = rows[0].assertions as Row[];
  assertions[0] = { ...assertions[0], ...patch };
  return clone;
}

function snapshotRepository(
  state: ReturnType<typeof canonicalState>,
  options: { snapshotFails?: boolean; contextFingerprint?: Row } = {},
) {
  return {
    async readContextSnapshot() {
      if (options.snapshotFails) return { ok: false, status: 404, data: null, error: "missing RPC" };
      return {
        ok: true, status: 200,
        data: {
          event: state.event, form4_rows: state.form4, form144_rows: state.form144,
          ownership_source_text: state.sourceXml,
          context_fingerprint: options.contextFingerprint ?? {
            status: "available", form: state.form4.length ? "form4" : "form144",
            source_fingerprint: fingerprint, context_ai_refs_valid: true,
          },
        },
      };
    },
    async select(table: string) {
      if (table === "events") return { ok: true, status: 200, data: [state.event] };
      if (table === "event_form4_transactions") return { ok: true, status: 200, data: state.form4 };
      if (table === "event_form144_proposed_sales") return { ok: true, status: 200, data: state.form144 };
      return { ok: false, status: 404, data: null, error: "unexpected table" };
    },
  };
}

function xmlValue(sourceText: string, localName: string) {
  return sourceText.match(new RegExp(`<${localName}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${localName}>`, "i"))?.[1]?.trim() ?? null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
