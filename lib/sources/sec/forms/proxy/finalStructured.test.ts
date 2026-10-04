import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS,
  PROXY_CAPITAL_FACT_KEYS,
  PROXY_CAPITAL_CORE_KEYS,
  PROXY_CAPITAL_CHANGE_KEYS,
  PROXY_CAPITAL_SUPPORTING_KEYS,
  PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA,
  PROXY_FINAL_FACT_FIELDS,
  buildProxyFinalStructuredNativeSchema,
  buildProxyFinalStructuredGeminiRequest,
  buildProxyFinalStructuredInput,
  parseAndValidateProxyFinalStructured,
  validateProxyFinalStructured,
  runProxyFinalStructuredGemini,
  type ProxyCapitalFacts,
  type ProxyCapitalCanonicalCore,
} from "./finalStructured.ts";
import type {
  ProxyAnalysisHandoffResult,
  ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";

const stage1: ProxyAnalysisHandoffResult = {
  version: "proxy_analysis_handoff_v3",
  document_notes: [{ text: "A special meeting is scheduled for March 12, 2026.", evidence: ["E4"] }],
  candidates: [
    {
      title: "Reverse Stock Split Proposal",
      claims: [
        { text: "Approve a reverse stock split at a ratio selected by the Board.", evidence: ["E1"] },
        { text: "The Board may select a ratio between 1-for-10 and 1-for-20 or abandon it.", evidence: ["E2"] },
      ],
    },
    {
      title: "Other Business",
      claims: [{ text: "Transact any other business that may come before the meeting.", evidence: ["E3"] }],
    },
  ],
};

const filing = {
  form_type: "PRE 14A", accession_number: "0000000000-26-000010",
  filing_date: "2026-02-01", company_name: "Example Corp.", source_url: "https://www.sec.gov/example",
};

const sourcePackage: ProxyProposalDiscoverySourcePackage = {
  provenance: {
    accession_number: "0000000000-26-000010",
    filing_date: "2026-02-01",
    source_url: "https://www.sec.gov/example",
    issuer_identity: { company_name: "Example Corp." },
  },
  evidenceBlocks: [
    {
      id: "E1",
      blockType: "source_proposal",
      blockSequence: 0,
      text: "PROPOSAL 1\nREVERSE STOCK SPLIT PROPOSAL\nStockholders are asked to approve a reverse stock split.",
    },
    {
      id: "E2",
      blockType: "source_terms",
      blockSequence: 1,
      text: "The Board may choose a ratio from 1-for-10 to 1-for-20 and may abandon the amendment.",
    },
    {
      id: "E3",
      blockType: "source_proposal",
      blockSequence: 2,
      text: "PROPOSAL 2\nOTHER BUSINESS\nTransact any other business that may properly come before the meeting.",
    },
    {
      id: "E4",
      blockType: "source_document",
      blockSequence: 3,
      text: "This is generic meeting boilerplate and contains no separate ballot matter.",
    },
  ],
};

function capitalFacts(
  core: Partial<ProxyCapitalCanonicalCore> = {},
  supporting: ProxyCapitalFacts["supporting_details"] = {},
): ProxyCapitalFacts {
  return {
    canonical_core: {
      action: { value: "Approve a reverse stock split.", evidence: ["E1"] },
      proposal_status: null, changes: [], prior_completed_capital_actions: [],
      ...core,
    },
    supporting_details: supporting,
  };
}

function capitalOutput(capital: unknown) {
  return {
    version: "proxy_final_structured_v1",
    items: [
      { proposal_id: "P1", is_proposal: true, category: "capital_structure", capital_facts: capital },
      { proposal_id: "P2", is_proposal: false, category: null, facts: [], source_conflicts: [] },
    ],
  };
}

test("builds filing identity and a lossless v3 handoff without source text", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  assert.deepEqual(input, { filing, handoff: stage1 });
  const request = buildProxyFinalStructuredGeminiRequest(input, 16_384);
  const serialized = JSON.stringify(request);
  for (const block of sourcePackage.evidenceBlocks) {
    for (const sentence of block.text.split("\n").filter(text => text.length > 30)) {
      assert.equal(serialized.includes(sentence), false, sentence);
    }
  }
  assert.doesNotMatch(serialized, /sourcePackage|local_section|discoveryBlocks|evidence_blocks|raw_filing_text/);
  input.handoff.candidates[0].claims[0].evidence.push("E99");
  assert.deepEqual(stage1.candidates[0].claims[0].evidence, ["E1"]);
});

test("uses JSON mode with the requested output budget", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const request = buildProxyFinalStructuredGeminiRequest(input, 16_384);

  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.maxOutputTokens, 16_384);
  assert.equal(request.generationConfig.temperature, 0);
  const system = request.systemInstruction.parts[0].text;
  assert.match(system, /Candidate titles may be used for identification and classification, but are not standalone evidence/);
  assert.match(system, /A Board voting recommendation is not proposal_status/);
  assert.match(system, /a request for stockholder approval that merely restates the action is not a distinct status/);
  assert.match(system, /If no other status is stated, use null/);
  assert.match(system, /only evidence IDs attached to the handoff claim or document_note that states the emitted value or conflict/);
  assert.match(system, /When the validated handoff explicitly preserves conflicting statements/);
  assert.match(system, /Do not discard a material handoff claim merely because it does not fit a dedicated field/);
  assert.match(system, /use other_material_fact for non-capital proposals or supporting_details\.other for capital_structure when necessary/);
  const payload = JSON.parse(request.contents[0].parts[0].text);
  assert.equal(payload.input.handoff.candidates.length, 2);
  const branches = payload.contract.response_schema.properties.items.items.anyOf;
  assert.deepEqual(branches[0].properties.capital_facts.required, [...PROXY_CAPITAL_FACT_KEYS]);
  assert.deepEqual(branches[0].properties.capital_facts.properties.canonical_core.required, [...PROXY_CAPITAL_CORE_KEYS]);
  assert.equal(Object.hasOwn(branches[0].properties.capital_facts.properties.supporting_details, "required"), false);
  assert.equal(branches[1].properties.facts.items.properties.value.maxLength, 500);
});

test("native schema keeps the simple envelope and enough capital shape to guide generation", () => {
  const native = buildProxyFinalStructuredNativeSchema() as any;
  assert.deepEqual(native.required, ["version", "items"]);
  assert.deepEqual(native.properties.version.enum, ["proxy_final_structured_v1"]);

  const item = native.properties.items.items;
  assert.equal(item.type, "object");
  assert.deepEqual(item.required, ["proposal_id", "is_proposal", "category"]);
  assert.deepEqual(Object.keys(item.properties), [
    "proposal_id", "is_proposal", "category", "facts", "source_conflicts", "capital_facts",
  ]);
  assert.deepEqual(item.properties.category, { type: ["string", "null"] });
  assert.equal(Object.hasOwn(item, "anyOf"), false);

  const fact = item.properties.facts.items;
  assert.deepEqual(fact.required, ["field", "value", "evidence"]);
  assert.deepEqual(fact.properties.field.enum, [...PROXY_FINAL_FACT_FIELDS]);
  assert.deepEqual(fact.properties.value, { type: "string" });
  assert.deepEqual(fact.properties.evidence, { type: "array", items: { type: "string" } });

  const capitalFacts = item.properties.capital_facts;
  assert.deepEqual(capitalFacts.required, ["canonical_core", "supporting_details"]);
  const core = capitalFacts.properties.canonical_core;
  assert.deepEqual(core.required, [...PROXY_CAPITAL_CORE_KEYS]);
  assert.deepEqual(core.properties.changes.items.required, [...PROXY_CAPITAL_CHANGE_KEYS]);
  assert.deepEqual(core.properties.action.type, ["object", "null"]);
  assert.deepEqual(core.properties.action.required, ["value", "evidence"]);
  assert.deepEqual(core.properties.prior_completed_capital_actions.items.required, ["value", "evidence"]);

  const supporting = capitalFacts.properties.supporting_details;
  assert.equal(Object.hasOwn(supporting, "required"), false);
  assert.deepEqual(Object.keys(supporting.properties), [...PROXY_CAPITAL_SUPPORTING_KEYS]);
  assert.deepEqual(supporting.properties.board_discretion.type, ["object", "null"]);
});

test("native schema omits deep provider constraints while leaving the full prompt contract unchanged", () => {
  const before = JSON.stringify(PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA);
  const native = buildProxyFinalStructuredNativeSchema();
  const serialized = JSON.stringify(native);

  for (const key of [
    "anyOf", "additionalProperties", "minItems", "maxItems", "pattern",
    "minLength", "maxLength", "uniqueItems", "const",
  ]) {
    assert.equal(serialized.includes('"' + key + '"'), false, key);
  }

  assert.match(before, /"anyOf"/);
  assert.match(before, /"additionalProperties"/);
  (native.required as string[]).push("not_in_contract");
  const properties = native.properties as Record<string, { enum?: string[] }>;
  properties.version.enum?.push("not_a_version");

  assert.equal(JSON.stringify(PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA), before);
  assert.notDeepEqual(buildProxyFinalStructuredNativeSchema(), native);
});
test("native request adds only responseFormat and retains the full prompt schema", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const request = buildProxyFinalStructuredGeminiRequest(input, 16_384);
  const { responseFormat, ...unchanged } = request.generationConfig;
  assert.deepEqual(unchanged, { responseMimeType: "application/json", maxOutputTokens: 16_384, temperature: 0 });
  assert.deepEqual(responseFormat, { text: { mimeType: "APPLICATION_JSON", schema: buildProxyFinalStructuredNativeSchema() } });
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).contract.response_schema, PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA);
});

test("native requests still reject provider, JSON and schema failures after exactly one fetch without repair", async () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const invalidSchema = capitalOutput(capitalFacts());
  invalidSchema.items[1].category = "governance";
  const cases = [
    { status: 400, text: null, providerPass: false, error: /native schema rejected/ },
    { status: 200, text: '{"field":"action":"Approve","evidence":["E1"]}', providerPass: true, error: /missing comma/ },
    { status: 200, text: JSON.stringify(invalidSchema), providerPass: true, error: /category must be null/ },
  ];
  for (const entry of cases) {
    let calls = 0;
    const run = await runProxyFinalStructuredGemini({
      apiKey: "offline", model: "gemini-3.5-flash", input, maxOutputTokens: 16_384,
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(calls, 1);
        assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
        assert.deepEqual(JSON.parse(String(init?.body)), buildProxyFinalStructuredGeminiRequest(input, 16_384));
        return new Response(JSON.stringify(entry.status === 400
          ? { error: { message: "native schema rejected" } }
          : { candidates: [{ finishReason: "STOP", content: { parts: [{ text: entry.text }] } }] }), { status: entry.status });
      },
    });
    assert.equal(calls, 1);
    assert.equal(run.transportOk, entry.providerPass);
    assert.equal(run.validation.ok, false);
    assert.equal(run.validation.value, null);
    assert.equal(run.outputText, entry.text);
    assert.match(entry.status === 400 ? run.error || "" : run.validation.errors.join("; "), entry.error);
  }
});

test("request serialization excludes runtime source fields even on otherwise typed inputs", () => {
  const sourceSentence = "This source-only sentence must never cross the Call 2 request boundary.";
  const input = {
    ...buildProxyFinalStructuredInput({ stage1, filing }),
    sourcePackage: { evidenceBlocks: [{ text: sourceSentence }] },
    local_section: { text: sourceSentence },
    raw_filing_text: sourceSentence,
    discoveryBlocks: [{ text: sourceSentence }],
    parser_semantic_output: sourceSentence,
    primary_analysis: sourceSentence,
    filing: { ...filing, raw_filing_text: sourceSentence },
  };
  const before = JSON.stringify(input);
  const request = buildProxyFinalStructuredGeminiRequest(input, 16_384);
  assert.equal(JSON.stringify(request).includes(sourceSentence), false);
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).input, { filing, handoff: stage1 });
  assert.equal(JSON.stringify(input), before);
});

test("source injection inside the closed v3 handoff is rejected rather than silently repaired", () => {
  const sourceText = "Private raw SEC passage outside the Call 1 handoff.";
  for (const invalid of [
    { ...stage1, raw_filing_text: sourceText },
    { ...stage1, candidates: [{ ...stage1.candidates[0], local_section: { text: sourceText } }] },
    { ...stage1, candidates: [{ title: "Candidate", claims: [
      { ...stage1.candidates[0].claims[0], sourcePackage: { text: sourceText } },
    ] }] },
    { ...stage1, document_notes: [{ ...stage1.document_notes[0], raw: sourceText }] },
  ]) {
    const before = JSON.stringify(invalid);
    assert.throws(() => buildProxyFinalStructuredGeminiRequest({ filing, handoff: invalid }, 16_384), /not allowed/);
    assert.equal(JSON.stringify(invalid), before);
  }
});

test("claims that quote SEC wording remain lossless; unselected source passages are excluded", () => {
  // Source/claim textual overlap is legal. Removing a quotation would alter validated Call 1 analysis.
  const quote = sourcePackage.evidenceBlocks[1].text;
  const quoted = structuredClone(stage1);
  quoted.candidates[0].claims[0].text = quote;
  const request = buildProxyFinalStructuredGeminiRequest(buildProxyFinalStructuredInput({ filing, stage1: quoted }), 16_384);
  const payload = JSON.parse(request.contents[0].parts[0].text);
  assert.deepEqual(payload.input.handoff, quoted);
  assert.equal(JSON.stringify(request).includes(sourcePackage.evidenceBlocks[3].text), false);
});

test("shared document-note evidence is available without adding source evidence or FACT values", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const output = capitalOutput(capitalFacts({ action: { value: "Model supplied action", evidence: ["E4"] } }));
  const before = JSON.stringify(output);
  assert.equal(validateProxyFinalStructured(output, input).ok, true);
  assert.equal(JSON.stringify(output), before);
});

test("invalid v3 structure fails without truncation, conversion, or value repair", () => {
  for (const invalid of [
    { ...stage1, version: "proxy_analysis_handoff_v2" },
    { ...stage1, candidates: [{ title: "Candidate", claims: [{ text: "x".repeat(601), evidence: ["E1"] }] }] },
    { ...stage1, candidates: [{ title: "Candidate", claims: [{ text: "Claim", evidence: ["E0"] }] }] },
    { ...stage1, candidates: [{ title: "Candidate", claims: [{ text: "Claim", evidence: ["E1", "E1"] }] }] },
  ]) {
    const before = JSON.stringify(invalid);
    assert.throws(() => buildProxyFinalStructuredInput({ filing, stage1: invalid as ProxyAnalysisHandoffResult }), /valid proxy_analysis_handoff_v3/);
    assert.equal(JSON.stringify(invalid), before);
  }
});

test("accepts legacy grounded facts and preserves a source conflict", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: true,
        category: "other",
        facts: [
          { field: "action", value: "Approve a reverse stock split.", evidence: ["E1"] },
          { field: "board_discretion", value: "The Board may select a ratio and abandon the amendment.", evidence: ["E2"] },
        ],
        source_conflicts: [
          { description: "The supplied passages state different possible upper ratios.", evidence: ["E1", "E2"] },
        ],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test("rejects omitted, reordered, or duplicated proposal IDs", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const item = (proposalId: string) => ({
    proposal_id: proposalId,
    is_proposal: false,
    category: null,
    facts: [],
    source_conflicts: [],
  });

  const missing = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [item("P1")],
  }, input);
  const reordered = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [item("P2"), item("P1")],
  }, input);
  const duplicated = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [item("P1"), item("P1")],
  }, input);

  assert.match(missing.errors.join("; "), /missing proposal P2/);
  assert.match(reordered.errors.join("; "), /preserve input order/);
  assert.match(duplicated.errors.join("; "), /duplicates P1/);
});

test("accepts any evidence ID present anywhere in the Call 2 handoff", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: true,
        category: "other",
        facts: [{ field: "action", value: "Approve a split.", evidence: ["E3"] }],
        source_conflicts: [],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, true);
});

test("rejects evidence IDs absent from the entire Call 2 handoff", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: true,
        category: "other",
        facts: [{ field: "action", value: "Approve a split.", evidence: ["E99"] }],
        source_conflicts: [],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("; "), /not present in the Call 2 handoff/);
});

test("accepts long FACT text below the validator safety ceiling", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: true,
        category: "other",
        facts: [{ field: "action", value: "x".repeat(5_000), evidence: ["E1"] }],
        source_conflicts: [],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, true);
});

test("retains only a generous abnormal-output ceiling for FACT text", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: true,
        category: "other",
        facts: [{
          field: "action",
          value: "x".repeat(PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS + 1),
          evidence: ["E1"],
        }],
        source_conflicts: [],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("; "), /32000 characters/);
});

test("requires empty category, facts, and conflicts for a rejected candidate", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = validateProxyFinalStructured({
    version: "proxy_final_structured_v1",
    items: [
      {
        proposal_id: "P1",
        is_proposal: false,
        category: "procedural",
        facts: [{ field: "action", value: "Not allowed.", evidence: ["E1"] }],
        source_conflicts: [{ description: "Not allowed.", evidence: ["E1"] }],
      },
      {
        proposal_id: "P2",
        is_proposal: false,
        category: null,
        facts: [],
        source_conflicts: [],
      },
    ],
  }, input);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("; "), /category must be null/);
  assert.match(validation.errors.join("; "), /facts must be empty/);
  assert.match(validation.errors.join("; "), /source_conflicts must be empty/);
});

test("rejects duplicate JSON keys instead of unwrapping or repairing", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const validation = parseAndValidateProxyFinalStructured(
    '{"version":"proxy_final_structured_v1","version":"proxy_final_structured_v1","items":[]}',
    input,
  );

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("; "), /duplicate key/);
});

test("accepts Core nulls and empty lists without requiring Supporting completeness", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const output = capitalOutput(capitalFacts({ action: null }));
  const validation = validateProxyFinalStructured(output, input);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value, output);
});

test("requires every capital key rather than supplying missing values", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  for (const key of PROXY_CAPITAL_FACT_KEYS) {
    const capital = { ...capitalFacts() } as Record<string, unknown>;
    delete capital[key];
    const validation = validateProxyFinalStructured(capitalOutput(capital), input);
    assert.equal(validation.ok, false, key);
    assert.match(validation.errors.join("; "), new RegExp(key));
    assert.equal(Object.hasOwn(capital, key), false);
  }
  for (const key of PROXY_CAPITAL_CORE_KEYS) {
    const capital = capitalFacts();
    delete (capital.canonical_core as Record<string, unknown>)[key];
    assert.equal(validateProxyFinalStructured(capitalOutput(capital), input).ok, false, key);
    assert.equal(Object.hasOwn(capital.canonical_core, key), false);
  }
  for (const key of PROXY_CAPITAL_CHANGE_KEYS) {
    const change: Record<string, unknown> = {
      scope: null, reverse_split_ratio: null, authorized_shares_before: null, authorized_shares_after: null,
    };
    delete change[key];
    const output = capitalOutput({ canonical_core: { ...capitalFacts().canonical_core, changes: [change] }, supporting_details: {} });
    assert.equal(validateProxyFinalStructured(output, input).ok, false, key);
    assert.equal(Object.hasOwn(change, key), false);
  }
});

test("capital values validate global input evidence and the generous safety ceiling", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const accepted = validateProxyFinalStructured(capitalOutput(capitalFacts({
    action: { value: "x".repeat(5_000), evidence: ["E3"] },
  })), input);
  assert.equal(accepted.ok, true);
  for (const action of [
    { value: "Approve", evidence: [] },
    { value: "Approve", evidence: ["E99"] },
    { value: "x".repeat(PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS + 1), evidence: ["E1"] },
  ]) {
    assert.equal(validateProxyFinalStructured(capitalOutput(capitalFacts({ action })), input).ok, false);
  }
});

test("preserves disputed totals separately from undisputed class after quantities", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const capital = capitalFacts({
    changes: [
      { scope: { value: "all classes", evidence: ["E1"] }, reverse_split_ratio: null, authorized_shares_before: null, authorized_shares_after: null },
      { scope: { value: "Class A", evidence: ["E2"] }, reverse_split_ratio: null, authorized_shares_before: null, authorized_shares_after: { value: "[47,500,000]", evidence: ["E2"] } },
    ],
  }, {
    source_conflicts: [{ subject: "total authorized after", statements: [
      { value: "[167,500,000]", evidence: ["E1"] },
      { value: "[162,500,000]", evidence: ["E2"] },
    ] }],
  });
  const validation = validateProxyFinalStructured(capitalOutput(capital), input);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value?.items[0], capitalOutput(capital).items[0]);
  capital.supporting_details.source_conflicts![0].statements.pop();
  assert.equal(validateProxyFinalStructured(capitalOutput(capital), input).ok, false);
});

test("validates every supplied Supporting value without filling optional details", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const capital = capitalFacts({}, {
    board_discretion: { value: "Board may abandon", evidence: ["E2"] },
    authorized_shares_effects: [{ scope: null, statement: { value: "No change stated", evidence: ["E1"] } }],
    other: [],
  });
  assert.equal(validateProxyFinalStructured(capitalOutput(capital), input).ok, true);
  assert.equal(Object.hasOwn(capital.supporting_details, "execution_deadline"), false);
  capital.supporting_details.board_discretion!.evidence = [];
  assert.equal(validateProxyFinalStructured(capitalOutput(capital), input).ok, false);
  capital.supporting_details.board_discretion!.evidence = ["E99"];
  assert.equal(validateProxyFinalStructured(capitalOutput(capital), input).ok, false);
  assert.equal(validateProxyFinalStructured(capitalOutput({ ...capitalFacts(), supporting_details: { unexpected: [] } }), input).ok, false);
});

test("does not adjudicate conflicting Core values, calculate quantities, or repair a raw response", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const capital = capitalFacts({ changes: [{
    scope: null, reverse_split_ratio: { value: "1-for-20", evidence: ["E1"] },
    authorized_shares_before: null, authorized_shares_after: null,
  }] }, { source_conflicts: [{ subject: "ratio", statements: [
    { value: "1-for-10", evidence: ["E1"] }, { value: "1-for-20", evidence: ["E2"] },
  ] }] });
  const raw = capitalOutput(capital);
  const before = JSON.stringify(raw);
  const validation = validateProxyFinalStructured(raw, input);
  assert.equal(validation.ok, true); // Semantic contradiction belongs to the separate audit, not this validator.
  assert.equal(JSON.stringify(raw), before);
  assert.strictEqual(validation.value, raw);
});

test("rejects legacy bags on capital items and fixed capital output on non-capital items", () => {
  const input = buildProxyFinalStructuredInput({ stage1, filing });
  const output = capitalOutput(capitalFacts());
  assert.equal(validateProxyFinalStructured({ ...output, items: [
    { ...output.items[0], facts: [] }, output.items[1],
  ] }, input).ok, false);
  assert.equal(validateProxyFinalStructured({ ...output, items: [
    { ...output.items[0], category: "governance" }, output.items[1],
  ] }, input).ok, false);
});
