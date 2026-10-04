import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { PROXY_PROPOSAL_ROUTING_MAX_LLM_CALLS, PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS,
  PROXY_PROPOSAL_ROUTING_MODELS, runProxyProposalRouting } from "./proposalRouting.ts";
import { PROXY_ANALYSIS_HANDOFF_VERSION, type ProxyAnalysisHandoffResult } from "./proposalDiscovery.ts";

const secSentences = [
  "Stockholders are asked to approve adjournment if additional proxies are needed.",
  "The Annual Meeting of Stockholders will be held at the principal executive offices.",
  "Authorized common stock will be increased to 200,000,000 shares under the proposed certificate.",
  "This sentence is available only in the SEC source and was not selected by Call 1.",
];
const sourcePackage = {
  provenance: {
    accession_number: "0000000000-26-000010", filing_date: "2026-02-01",
    issuer_identity: { company_name: "Example Corp.", parser_semantics: secSentences[3] },
    source_url: "https://www.sec.gov/example", raw_filing_text: secSentences[3],
    primary_analysis: secSentences[3], discoveryBlocks: [{ text: secSentences[3] }],
  },
  evidenceBlocks: secSentences.map((text, index) => ({
    id: "E" + (index + 1), blockType: "source_proposal", blockSequence: index, text,
  })),
};
const handoff: ProxyAnalysisHandoffResult = {
  version: PROXY_ANALYSIS_HANDOFF_VERSION,
  document_notes: [{ text: "The document describes an annual meeting.", evidence: ["E2"] }],
  candidates: [
    { title: "Adjournment proposal", claims: [
      { text: "Approve adjournment to solicit more proxies.", evidence: ["E1", "E2"] },
      { text: "The adjournment is conditional on needing more votes.", evidence: ["E1"] },
    ] },
    { title: "Authorized share increase", claims: [
      { text: "Approve an increase in authorized common shares to 200 million.", evidence: ["E3"] },
    ] },
    { title: "Other business", claims: [
      { text: "Unspecified other business may come before the meeting.", evidence: ["E2"] },
    ] },
  ],
};
const normalized = {
  version: "proxy_final_structured_v1",
  items: [
    { proposal_id: "P1", is_proposal: true, category: "procedural",
      facts: [{ field: "action", value: "Approve conditional adjournment.", evidence: ["E1"] }], source_conflicts: [] },
    { proposal_id: "P2", is_proposal: true, category: "capital_structure", capital_facts: {
      canonical_core: {
        action: { value: "Approve an authorized share increase.", evidence: ["E3"] },
        proposal_status: null,
        changes: [{ scope: { value: "Common stock", evidence: ["E3"] }, reverse_split_ratio: null,
          authorized_shares_before: null, authorized_shares_after: { value: "200 million", evidence: ["E3"] } }],
        prior_completed_capital_actions: [],
      }, supporting_details: {},
    } },
    { proposal_id: "P3", is_proposal: false, category: null, facts: [], source_conflicts: [] },
  ],
};

// Any accidentally unmocked provider call fails locally; no API key or network is used.
const realFetch = globalThis.fetch;
let unexpectedNetworkCalls = 0;
before(() => {
  globalThis.fetch = async () => { unexpectedNetworkCalls++; throw new Error("Offline test forbids network"); };
});
after(() => { globalThis.fetch = realFetch; assert.equal(unexpectedNetworkCalls, 0); });

test("v3 routing sends exactly one source-free Call 2 request and preserves normalized FACTs", async () => {
  const beforeInput = JSON.stringify({ sourcePackage, handoff });
  const requests: Array<{ url: string; body: any }> = [];
  const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage, formType: "PRE 14A",
    fetchImpl: (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(url), body });
      return response(requests.length === 1 ? handoff : normalized);
    }) as typeof fetch });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.error, null);
  assert.equal(result.llmCallCount, 2);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /gemini-2\.5-flash-lite:generateContent$/);
  assert.match(requests[1].url, /gemini-3\.5-flash:generateContent$/);
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 8192);
  assert.equal(requests[1].body.generationConfig.maxOutputTokens, 16384);
  const call2 = JSON.parse(requests[1].body.contents[0].parts[0].text);
  assert.deepEqual(Object.keys(call2).sort(), ["contract", "input"]);
  assert.deepEqual(call2.input, {
    filing: { form_type: "PRE 14A", accession_number: "0000000000-26-000010", filing_date: "2026-02-01",
      company_name: "Example Corp.", source_url: "https://www.sec.gov/example" },
    handoff,
  });
  const serialized = JSON.stringify(requests[1].body);
  for (const sentence of secSentences) assert.equal(serialized.includes(sentence), false, sentence);
  assert.doesNotMatch(serialized, /sourcePackage|local_section|discoveryBlocks|evidence_blocks|raw_filing_text|primary_analysis|parser_semantics/);
  assert.deepEqual(result.call1.run.validation.value, handoff);
  assert.equal(JSON.stringify(result.call2?.run.validation.value), JSON.stringify(normalized));
  assert.deepEqual(result.finalProposals?.map(p => p.proposal_id), ["P1", "P2"]);
  assert.deepEqual(result.finalProposals?.[0].claims, handoff.candidates[0].claims);
  assert.deepEqual(result.finalProposals?.[0].evidence, ["E1", "E2"]);
  assert.equal(Object.hasOwn(result.finalProposals![0], "action_summary"), false);
  assert.deepEqual(result.finalProposals?.[1].category === "capital_structure" && result.finalProposals[1].capital_facts,
    normalized.items[1].capital_facts);
  assert.equal(JSON.stringify({ sourcePackage, handoff }), beforeInput);
  assert.equal(PROXY_PROPOSAL_ROUTING_MAX_LLM_CALLS, 2);
  assert.deepEqual(PROXY_PROPOSAL_ROUTING_MODELS, { call1: "gemini-2.5-flash-lite", call2: "gemini-3.5-flash" });
  assert.deepEqual(PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS, { call1: 8192, call2: 16384 });
});

test("invalid, unknown-evidence, injected-source, or legacy Call 1 output makes zero Call 2 calls", async () => {
  const invalidOutputs = [
    {}, { ...handoff, candidates: [{ title: "Missing fields" }] },
    { ...handoff, candidates: [{ title: "Unknown evidence", claims: [{ text: "Claim", evidence: ["E99"] }] }] },
    { ...handoff, sourcePackage },
    { ...handoff, candidates: [{ ...handoff.candidates[0], local_section: { text: secSentences[0] } }] },
    { version: "proxy_proposal_discovery_v1", meeting: { type: "unclear", date: null, evidence: [] }, proposals: [] },
    { ...handoff, version: "proxy_analysis_handoff_v2" },
  ];
  for (const output of invalidOutputs) {
    let calls = 0;
    const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage, formType: "DEF 14A",
      fetchImpl: (async () => { calls++; return response(output); }) as typeof fetch });
    assert.equal(result.ok, false);
    assert.equal(result.error?.stage, "call1");
    assert.equal(result.call2, null);
    assert.equal(result.finalProposals, null);
    assert.equal(result.llmCallCount, 1);
    assert.equal(calls, 1);
  }
});

test("Call 1 transport and JSON failures never retry, repair, or proceed to Call 2", async () => {
  const failures = [
    () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }),
    () => response(handoff, "MAX_TOKENS"),
    () => responseText("not JSON"),
    () => { throw new Error("offline simulated connection failure"); },
  ];
  for (const fail of failures) {
    let calls = 0;
    const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage, formType: "DEF 14A",
      fetchImpl: (async () => { calls++; return fail(); }) as typeof fetch });
    assert.equal(result.ok, false);
    assert.equal(result.error?.stage, "call1");
    assert.equal(result.call2, null);
    assert.equal(result.llmCallCount, 1);
    assert.equal(calls, 1);
  }
});

test("Call 2 failures stop after two requests without retry, repair, fallback, or redoing Call 1", async () => {
  const failures = [
    () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }),
    () => response(normalized, "MAX_TOKENS"),
    () => response({ version: "proxy_final_structured_v1", items: [] }),
    () => responseText("not JSON"),
    () => responseText('{"version":"proxy_final_structured_v1","version":"proxy_final_structured_v1","items":[]}'),
    () => response({ ...normalized, items: [{ ...normalized.items[0], facts: [
      { field: "action", value: "Cannot cite unused source evidence", evidence: ["E4"] },
    ] }, ...normalized.items.slice(1)] }),
    () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    () => { throw new Error("offline simulated connection failure"); },
  ];
  for (const fail of failures) {
    const models: string[] = [];
    const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage, formType: "DEF 14A",
      fetchImpl: (async url => { models.push(String(url)); return models.length === 1 ? response(handoff) : fail(); }) as typeof fetch });
    assert.equal(result.ok, false);
    assert.equal(result.error?.stage, "call2");
    assert.notEqual(result.call2, null);
    assert.equal(result.finalProposals, null);
    assert.equal(result.llmCallCount, 2);
    assert.equal(models.length, 2);
    assert.match(models[0], /gemini-2\.5-flash-lite/);
    assert.match(models[1], /gemini-3\.5-flash/);
  }
});

test("input boundary failure makes no Call 2 request", async () => {
  let calls = 0;
  const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage, formType: " ",
    fetchImpl: (async () => { calls++; return response(handoff); }) as typeof fetch });
  assert.equal(result.error?.stage, "call2");
  assert.match(result.error?.message || "", /form type/);
  assert.equal(result.call2, null);
  assert.equal(calls, 1);
});

test("empty v3 candidates remain empty and missing identity is not inferred from claims", async () => {
  let calls = 0;
  const empty = { version: PROXY_ANALYSIS_HANDOFF_VERSION, document_notes: [], candidates: [] };
  const result = await runProxyProposalRouting({ apiKey: "offline-test-key", sourcePackage: { evidenceBlocks: [] }, formType: "DEFA14A",
    fetchImpl: (async (_url, init) => {
      calls++;
      if (calls === 1) return response(empty);
      const payload = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text);
      assert.deepEqual(payload.input, { filing: {
        form_type: "DEFA14A", accession_number: null, filing_date: null, company_name: null, source_url: null,
      }, handoff: empty });
      return response({ version: "proxy_final_structured_v1", items: [] });
    }) as typeof fetch });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(result.finalProposals, []);
});

function response(output: unknown, finishReason = "STOP") {
  return responseText(JSON.stringify(output), finishReason);
}
function responseText(text: string, finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });
}
