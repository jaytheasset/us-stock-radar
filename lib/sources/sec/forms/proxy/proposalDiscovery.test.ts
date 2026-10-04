import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA,
  PROXY_ANALYSIS_HANDOFF_VERSION,
  PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
  buildProxyProposalDiscoveryGeminiRequest,
  buildProxyProposalDiscoveryPrompt,
  buildProxyProposalDiscoverySourcePackage,
  parseAndValidateProxyProposalDiscovery,
  runProxyProposalDiscoveryGemini,
  type ProxyAnalysisHandoffResult,
  type ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";
import { parseProxyFiling } from "./parser.ts";

const sourcePackage: ProxyProposalDiscoverySourcePackage = {
  provenance: { source_fingerprint: "source-fingerprint" },
  evidenceBlocks: [
    {
      id: "E1",
      blockType: "source_document",
      blockSequence: 0,
      text: "The annual meeting will be held on May 18, 2022.",
    },
    {
      id: "E2",
      blockType: "source_proposal",
      blockSequence: 1,
      text: "Proposal 1 — Election of the nine director nominees named in this proxy statement.",
    },
    {
      id: "E3",
      blockType: "source_proposal",
      blockSequence: 2,
      text: "Proposal 2 — Ratification of the independent registered public accounting firm.",
    },
  ],
};

function validResult(): ProxyAnalysisHandoffResult {
  return {
    version: PROXY_ANALYSIS_HANDOFF_VERSION,
    document_notes: [
      { text: "Annual meeting on May 18, 2022.", evidence: ["E1"] },
    ],
    candidates: [
      {
        title: "Election of the nine director nominees",
        claims: [
          { text: "Elect the nine director nominees named in the proxy statement.", evidence: ["E2"] },
        ],
      },
      {
        title: "Ratification of the independent registered public accounting firm",
        claims: [
          { text: "Ratify the appointment of the independent registered public accounting firm.", evidence: ["E3"] },
        ],
      },
    ],
  };
}

test("bounded free analysis passes without transformation", () => {
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(validResult()), sourcePackage);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, validResult());
});

test("Stage 2 fields and legacy unresolved output are rejected", () => {
  const value = validResult() as unknown as Record<string, unknown>;
  value.unresolved = [];
  const proposals = value.candidates as Array<Record<string, unknown>>;
  proposals[0].kind = "other";
  proposals[0].terms = [];
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("$.unresolved is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.candidates[0].kind is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.candidates[0].terms is not allowed")));
});

test("unknown and duplicate evidence IDs fail strict validation", () => {
  const value = validResult();
  value.candidates[0].claims[0].evidence = ["E99", "E99"];
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown evidence E99")));
  assert.ok(result.errors.some((error) => error.includes("duplicates evidence E99")));
});

test("duplicate JSON keys and wrapper text are not repaired or unwrapped", () => {
  const duplicate = JSON.stringify(validResult()).replace('"version":', '"version":"duplicate", "version":');
  assert.equal(parseAndValidateProxyProposalDiscovery(duplicate, sourcePackage).ok, false);
  assert.equal(
    parseAndValidateProxyProposalDiscovery(`result: ${JSON.stringify(validResult())}`, sourcePackage).ok,
    false,
  );
});

test("analysis semantics and unresolved placeholders are not adjudicated by the validator", () => {
  const value = validResult();
  value.document_notes[0].text = "Meeting date is [•], 2025. Conflicting statements remain unresolved.";
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("prompt permits compressed free analysis while keeping final FACT normalization out", () => {
  const prompt = buildProxyProposalDiscoveryPrompt(sourcePackage);
  const user = JSON.parse(prompt.user);
  assert.equal(user.contract.version, PROXY_ANALYSIS_HANDOFF_VERSION);
  assert.deepEqual(user.contract.response_schema, PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA);
  assert.equal(
    user.source_selection_note,
    "candidate windows selected mechanically for recall; inclusion does not imply that a proposal exists in the block",
  );
  assert.deepEqual(user.candidate_source_blocks, sourcePackage.evidenceBlocks.map(({ id, text }) => ({ id, text })));
  assert.match(prompt.system, /Discover every actual stockholder proposal/);
  assert.match(prompt.system, /presence does NOT mean they contain a proposal/);
  assert.match(prompt.system, /including director elections, auditor ratification, say-on-pay/);
  assert.match(prompt.system, /Never emit generic 'other business' language as a candidate/);
  assert.match(prompt.system, /Use your own judgment/);
  assert.match(prompt.system, /Prefer information that is specific to this matter over routine proxy mechanics/);
  assert.match(prompt.system, /Routine voting procedures, Board recommendations, and generic meeting mechanics/);
  assert.match(prompt.system, /Do not follow a filing-type-specific checklist, fixed FACT list, or preselected priority list/);
  assert.match(prompt.system, /Each claim is generic free analysis, not a FACT field/);
  assert.match(prompt.system, /no more than 10 claims per candidate/);
  assert.match(prompt.system, /zero proposals is a valid result/);
  assert.match(prompt.system, /do not reconstruct or import an omitted parent proposal list/);
  assert.match(prompt.system, /placeholder is not an actual meeting date; preserve its uncertainty/);
  assert.match(prompt.system, /Do not classify proposal type or emit fixed FACT fields/);
  assert.match(prompt.system, /Never calculate or infer missing information/);
  assert.doesNotMatch(prompt.system, /recall-only|summarize only/);
});

test("Call 1 package preserves discovery IDs, document identity, exact offsets and cues without semantic projections", () => {
  const parsed = parseProxyFiling({
    formType: "DEF 14A",
    accessionNumber: "0000000000-26-000001",
    filingText: "PROPOSAL 1\nElect the directors.\n" + "Proposal body text. ".repeat(300)
      + "\nADDITIONAL INFORMATION\n" + "Unrelated source text. ".repeat(2_000),
    attachments: [{ name: "proxy-card.htm", type: "DEFA14A", text: "PROPOSAL 2\nRatify the independent auditor." }],
  });
  const package1 = buildProxyProposalDiscoverySourcePackage(parsed);
  const package2 = buildProxyProposalDiscoverySourcePackage({
    accessionNumber: parsed.accessionNumber,
    raw: { secFormType: parsed.raw.secFormType, documentInventory: parsed.raw.documentInventory,
      discoveryBlocks: [...parsed.raw.discoveryBlocks].reverse() },
  });
  assert.deepEqual(package1, package2, "E IDs must be stable for the same source blocks independent of array order");
  assert.equal(package1.evidenceBlocks.length, parsed.raw.discoveryBlocks.length);
  assert.ok(package1.evidenceBlocks.reduce((sum, block) => sum + block.text.length, 0) < parsed.raw.combinedTextChars);
  for (const block of package1.evidenceBlocks) {
    const raw = parsed.raw.discoveryBlocks.find(candidate => candidate.id === block.discoveryBlockId)!;
    assert.equal(block.text, raw.text);
    assert.equal(block.source?.documentIndex, raw.sourceDocumentIndex);
    assert.equal(block.source?.startChar, raw.startChar);
    assert.equal(block.source?.endChar, raw.endChar);
    assert.deepEqual(block.source?.cues, raw.cues);
    assert.equal(block.documentId, `${parsed.accessionNumber}:D${raw.sourceDocumentIndex + 1}`);
  }
  const user = JSON.parse(buildProxyProposalDiscoveryPrompt(package1).user);
  assert.deepEqual(user.candidate_source_blocks, package1.evidenceBlocks.map(({ id, text }) => ({ id, text })));
  assert.ok(user.candidate_source_blocks.every(block => Object.keys(block).join(",") === "id,text"));
  assert.doesNotMatch(JSON.stringify(user), /discoveryBlocks|documentIndex|startChar|endChar|cues|signals|eventType|importantBlocks/);
});

test("title and claim string limits accept the boundary and reject overflow without truncating", () => {
  for (const [field, limit] of [["title", 200], ["document_claim", 600], ["candidate_claim", 600]] as const) {
    for (const extra of [0, 1]) {
      const value = validResult();
      const text = "a".repeat(limit + extra);
      if (field === "title") value.candidates[0].title = text;
      if (field === "document_claim") value.document_notes[0].text = text;
      if (field === "candidate_claim") value.candidates[0].claims[0].text = text;
      const serialized = JSON.stringify(value);
      const result = parseAndValidateProxyProposalDiscovery(serialized, sourcePackage);
      assert.equal(result.ok, extra === 0, field);
      if (extra === 0) assert.deepEqual(result.value, value);
      else assert.equal(result.value, null);
    }
  }
  const value = validResult();
  value.candidates[0].claims[0].text = "😀".repeat(600);
  assert.equal(parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage).ok, true);
});

test("generic handoff caps claims and per-claim evidence without capping candidate count", () => {
  const source = { evidenceBlocks: Array.from({ length: 6 }, (_, i) => ({
    id: `E${i + 1}`, blockType: "source", blockSequence: i, text: "Source text",
  })) };
  const value = validResult();
  value.candidates = Array.from({ length: 101 }, () => structuredClone(value.candidates[0]));
  value.candidates[0].claims = Array.from({ length: 10 }, () => ({
    text: "Distinct source-grounded claim.", evidence: ["E1", "E2", "E3", "E4"],
  }));
  value.document_notes = Array.from({ length: 5 }, () => ({ text: "Shared context.", evidence: ["E1"] }));
  assert.equal(parseAndValidateProxyProposalDiscovery(JSON.stringify(value), source).ok, true);
  value.candidates[0].claims.push({ text: "Too many claims.", evidence: ["E1"] });
  assert.match(parseAndValidateProxyProposalDiscovery(JSON.stringify(value), source).errors.join("; "), /1 to 10 claims/);
  value.candidates[0].claims.pop();
  value.candidates[0].claims[0].evidence.push("E5");
  assert.match(parseAndValidateProxyProposalDiscovery(JSON.stringify(value), source).errors.join("; "), /1 to 4 IDs/);
  assert.equal(Object.hasOwn(PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA.properties.candidates, "maxItems"), false);
});

test("every claim requires valid, non-duplicate source evidence", () => {
  const unknown = validResult();
  unknown.candidates[0].claims[0].evidence = ["E99"];
  assert.match(
    parseAndValidateProxyProposalDiscovery(JSON.stringify(unknown), sourcePackage).errors.join("; "),
    /unknown evidence E99/,
  );

  const emptyEvidence = validResult();
  emptyEvidence.candidates[0].claims[0].evidence = [];
  assert.match(
    parseAndValidateProxyProposalDiscovery(JSON.stringify(emptyEvidence), sourcePackage).errors.join("; "),
    /1 to 4 IDs/,
  );

  const duplicate = validResult();
  duplicate.document_notes[0].evidence = ["E1", "E1"];
  assert.match(
    parseAndValidateProxyProposalDiscovery(JSON.stringify(duplicate), sourcePackage).errors.join("; "),
    /duplicates evidence E1/,
  );
});

test("empty supplement handoff is valid; legacy output, missing wrappers, wrong types and fences fail", () => {
  const empty = { version: PROXY_ANALYSIS_HANDOFF_VERSION, document_notes: [], candidates: [] };
  assert.equal(parseAndValidateProxyProposalDiscovery(JSON.stringify(empty), sourcePackage).ok, true);
  for (const value of [
    { version: "proxy_proposal_discovery_v1", meeting: { type: "unclear", date: null, evidence: [] }, proposals: [] },
    { ...empty, version: "wrong" }, { ...empty, document_notes: null },
    { ...empty, candidates: {} }, { ...empty, document_notes: {} },
    { ...empty, candidates: [{ title: "X", claims: [] }] },
    { ...empty, candidates: [{ title: "X", claims: [{ text: "Text", evidence: [1] }] }] },
  ]) assert.equal(parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage).ok, false);
  assert.equal(parseAndValidateProxyProposalDiscovery("```json\n" + JSON.stringify(empty) + "\n```", sourcePackage).ok, false);
});

test("provider errors, no response, truncation and invalid schema never trigger retry or repair", async () => {
  for (const outcome of ["http", "network", "max_tokens", "schema", "empty"]) {
    let calls = 0;
    const run = await runProxyProposalDiscoveryGemini({
      apiKey: "test-key", model: "gemini-2.5-flash-lite", sourcePackage,
      fetchImpl: (async () => {
        calls++;
        if (outcome === "network") throw new Error("No response");
        if (outcome === "http") return new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 });
        return new Response(JSON.stringify({ candidates: [{ finishReason: outcome === "max_tokens" ? "MAX_TOKENS" : "STOP",
          content: { parts: outcome === "empty" ? [] : [{ text: outcome === "schema" ? "{}" : JSON.stringify(validResult()) }] },
        }] }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    if (outcome === "schema") { assert.equal(run.transportOk, true); assert.equal(run.validation.ok, false); }
    else assert.equal(run.transportOk, false);
    if (outcome === "network") assert.equal(run.status, 0);
  }
});

test("parser prefers explicit numbered proposal headings over broad voting-area fallback", () => {
  const parsed = parseProxyFiling({
    formType: "DEF 14A",
    filingText: [
      "NOTICE OF ANNUAL MEETING OF STOCKHOLDERS",
      "The Annual Meeting will be held on June 17, 2026.",
      "PROPOSAL 1",
      "Election of Directors",
      "Stockholders are asked to elect eight directors.",
      "Unrelated narrative. ".repeat(300),
      "PROPOSAL 2",
      "Ratification of Independent Registered Public Accounting Firm",
      "Stockholders are asked to ratify the auditor.",
    ].join("\n"),
  });
  const cues = new Set(parsed.raw.discoveryBlocks.flatMap(block => block.cues));
  assert.ok(cues.has("numbered_proposal_heading"));
  assert.ok(!cues.has("voting_area_fallback"));
  assert.ok(!cues.has("short_document"));
  const source = parsed.raw.discoveryBlocks.map(block => block.text).join("\n");
  assert.match(source, /PROPOSAL 1/);
  assert.match(source, /PROPOSAL 2/);
});

test("parser supports ITEM or MATTER numbering when PROPOSAL headings are absent", () => {
  const parsed = parseProxyFiling({
    formType: "DEF 14A",
    filingText: [
      "NOTICE OF ANNUAL MEETING OF STOCKHOLDERS",
      "The Annual Meeting will be held on October 22, 2026.",
      "ITEM 1: Election of Directors",
      "Elect the director nominees.",
      "ITEM 2: Advisory Vote on Executive Compensation",
      "Approve executive compensation on an advisory basis.",
    ].join("\n"),
  });
  const cues = new Set(parsed.raw.discoveryBlocks.flatMap(block => block.cues));
  assert.ok(cues.has("numbered_item_or_matter_heading"));
  assert.ok(!cues.has("voting_area_fallback"));
});

test("general proxy without numbered headings falls back only to bounded voting areas", () => {
  const parsed = parseProxyFiling({
    formType: "DEF 14A",
    filingText: [
      "NOTICE OF ANNUAL MEETING OF STOCKHOLDERS",
      "The Annual Meeting will be held on October 22, 2026.",
      "Background narrative. ".repeat(300),
      "Matters to be Voted On",
      "1. Election of Directors",
      "2. Ratification of the independent auditor",
      "Closing narrative. ".repeat(300),
    ].join("\n"),
  });
  const cues = new Set(parsed.raw.discoveryBlocks.flatMap(block => block.cues));
  assert.ok(cues.has("voting_area_fallback"));
  assert.ok(!cues.has("numbered_proposal_heading"));
  assert.ok(!cues.has("numbered_item_or_matter_heading"));
  const total = parsed.raw.discoveryBlocks.reduce((sum, block) => sum + block.text.length, 0);
  assert.ok(total < parsed.raw.primaryTextChars, "fallback should not widen to the whole filing");
});

test("short DEFA14A supplement is not sent whole and may legitimately expose zero proposal blocks", () => {
  const parsed = parseProxyFiling({
    formType: "DEFA14A",
    filingText: [
      "DEFA14A",
      "SUPPLEMENT TO THE PROXY STATEMENT",
      "The Special Meeting will be held on April 11, 2025.",
      "Background administrative text. ".repeat(220),
      "On March 13, 2025, the Company filed a definitive proxy statement for the Special Meeting.",
      "This supplement does not change the proposals to be acted upon at the Special Meeting, which are described in the Proxy Statement.",
      "The Proxy Statement and Proxy Card remain in full force and effect.",
    ].join("\n"),
  });
  const cues = new Set(parsed.raw.discoveryBlocks.flatMap(block => block.cues));
  assert.ok(cues.has("supplement_parent_context") || cues.has("supplement_parent_reference"));
  assert.ok(!cues.has("supplement_explicit_proposal_reference"));
  assert.ok(!cues.has("short_document"));
  const total = parsed.raw.discoveryBlocks.reduce((sum, block) => sum + block.text.length, 0);
  assert.ok(total < parsed.raw.primaryTextChars, "supplement should not be passed as a whole short document");
});

test("DEFA14A explicit current proposal mention is preserved without reconstructing a parent list", () => {
  const parsed = parseProxyFiling({
    formType: "DEFA14A",
    filingText: [
      "DEFA14A",
      "The Annual Meeting will be held on May 28, 2026.",
      "An important proposal at this year's Annual Meeting is the request to increase our authorized share count.",
      "The Company encourages stockholders to submit their proxy votes.",
    ].join("\n"),
  });
  const cues = new Set(parsed.raw.discoveryBlocks.flatMap(block => block.cues));
  assert.ok(cues.has("supplement_explicit_proposal_reference"));
  const source = parsed.raw.discoveryBlocks.map(block => block.text).join("\n");
  assert.match(source, /important proposal/i);
  assert.match(source, /authorized share count/i);
});

test("missing or malformed discovery blocks cannot fall back to full raw or neutral evidence", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "PROPOSAL 1\nElect directors." });
  assert.equal(buildProxyProposalDiscoverySourcePackage({
    accessionNumber: parsed.accessionNumber,
    raw: { ...parsed.raw, discoveryBlocks: [] },
  }).evidenceBlocks.length, 0);
  assert.throws(() => buildProxyProposalDiscoverySourcePackage({
    accessionNumber: parsed.accessionNumber,
    raw: { ...parsed.raw, discoveryBlocks: undefined as any },
  }), /requires raw.discoveryBlocks/);
  assert.throws(() => buildProxyProposalDiscoverySourcePackage({
    accessionNumber: parsed.accessionNumber,
    raw: { ...parsed.raw, discoveryBlocks: [...parsed.raw.discoveryBlocks, ...parsed.raw.discoveryBlocks] },
  }), /Invalid Proxy discovery source block/);
  assert.throws(() => buildProxyProposalDiscoverySourcePackage({
    accessionNumber: parsed.accessionNumber,
    raw: { ...parsed.raw, discoveryBlocks: parsed.raw.discoveryBlocks.map(block => ({ ...block, endChar: block.endChar + 1 })) },
  }), /Invalid Proxy discovery source block/);
});

test("Gemini request uses JSON Mode only without provider schema, tools, or retries", () => {
  const request = buildProxyProposalDiscoveryGeminiRequest(sourcePackage) as Record<string, any>;
  assert.deepEqual(Object.keys(request), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(request.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    temperature: 0,
  });
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(serialized, /responseSchema|responseJsonSchema|responseFormat|functionDeclarations|toolConfig|"tools"/);
});

test("runner makes one direct request and validates its one direct JSON text", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responseBody = {
    responseId: "response-1",
    modelVersion: "gemini-2.5-flash-lite",
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(validResult()) }] },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    },
  };
  const run = await runProxyProposalDiscoveryGemini({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    sourcePackage,
    maxOutputTokens: PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
    fetchImpl: (async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
  );
  assert.deepEqual(
    JSON.parse(String(requests[0]?.init?.body)),
    buildProxyProposalDiscoveryGeminiRequest(sourcePackage),
  );
  assert.equal(run.transportOk, true);
  assert.equal(run.validation.ok, true);
  assert.deepEqual(run.validation.value, validResult());
});
