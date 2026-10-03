import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROPOSAL_CATEGORIES,
  PROXY_PROPOSAL_CLASSIFICATION_RESPONSE_SCHEMA,
  PROXY_PROPOSAL_CLASSIFICATION_VERSION,
  buildProxyProposalClassificationGeminiRequest,
  buildProxyProposalClassificationInput,
  buildProxyProposalClassificationPrompt,
  parseAndValidateProxyProposalClassification,
  runProxyProposalClassificationGemini,
  type ProxyProposalClassificationInput,
  type ProxyProposalClassificationResult,
} from "./proposalClassification.ts";
import type {
  ProxyProposalDiscoveryResult,
} from "./proposalDiscovery.ts";

const stage1: ProxyProposalDiscoveryResult = {
  version: "proxy_proposal_discovery_v1",
  meeting: {
    type: "annual",
    date: "2026-06-17",
    evidence: ["E1"],
  },
  proposals: [
    {
      title: "ELECTION OF DIRECTORS",
      action_summary: "Elect eight directors.",
      evidence: ["E2"],
    },
    {
      title: "Transact such other business as may properly come before the meeting",
      action_summary: "Transact such other business as may properly come before the meeting.",
      evidence: ["E3"],
    },
  ],
};

const input = buildProxyProposalClassificationInput(stage1);

function validResult(): ProxyProposalClassificationResult {
  return {
    version: PROXY_PROPOSAL_CLASSIFICATION_VERSION,
    items: [
      { proposal_id: "P1", is_proposal: true, category: "director_election" },
      { proposal_id: "P2", is_proposal: false, category: null },
    ],
  };
}

test("server assigns stable P IDs while excluding Stage 1 evidence refs and source text", () => {
  assert.deepEqual(input, {
    items: [
      {
        proposal_id: "P1",
        title: "ELECTION OF DIRECTORS",
        action_summary: "Elect eight directors.",
      },
      {
        proposal_id: "P2",
        title: "Transact such other business as may properly come before the meeting",
        action_summary: "Transact such other business as may properly come before the meeting.",
      },
    ],
  });
  assert.deepEqual(stage1.proposals.map((proposal) => proposal.evidence), [["E2"], ["E3"]]);
  assert.doesNotMatch(JSON.stringify(input), /"evidence"|E2|E3|Proposal 1\. Election/);
});

test("valid classification covers each input item exactly once", () => {
  const validation = parseAndValidateProxyProposalClassification(JSON.stringify(validResult()), input);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value, validResult());
});

test("missing, duplicate, and unknown proposal IDs fail strict validation", () => {
  const result = parseAndValidateProxyProposalClassification(JSON.stringify({
    version: PROXY_PROPOSAL_CLASSIFICATION_VERSION,
    items: [
      { proposal_id: "P1", is_proposal: true, category: "director_election" },
      { proposal_id: "P1", is_proposal: false, category: null },
      { proposal_id: "P99", is_proposal: true, category: "other" },
    ],
  }), input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("duplicates P1")));
  assert.ok(result.errors.some((error) => error.includes("unknown proposal P99")));
  assert.ok(result.errors.some((error) => error.includes("missing proposal P2")));
});

test("invalid categories and detail, lifecycle, or unresolved fields are rejected", () => {
  const result = parseAndValidateProxyProposalClassification(JSON.stringify({
    version: PROXY_PROPOSAL_CLASSIFICATION_VERSION,
    items: [
      { proposal_id: "P1", is_proposal: true, category: "reverse_split", terms: [] },
      { proposal_id: "P2", is_proposal: false, category: "procedural", lifecycle: "pending" },
    ],
    unresolved: [],
  }), input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("$.unresolved is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.items[0].terms is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.items[1].lifecycle is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("category must be one of")));
  assert.ok(result.errors.some((error) => error.includes("category must be null when is_proposal is false")));
});

test("duplicate keys and wrapper text are not repaired or unwrapped", () => {
  const duplicate = '{"version":"proxy_proposal_classification_v1","version":"proxy_proposal_classification_v1","items":[]}';
  assert.equal(parseAndValidateProxyProposalClassification(duplicate, input).ok, false);
  assert.equal(
    parseAndValidateProxyProposalClassification(`result: ${JSON.stringify(validResult())}`, input).ok,
    false,
  );
});

test("prompt contains the complete enum and keeps classification separate from extraction", () => {
  const prompt = buildProxyProposalClassificationPrompt(input);
  const user = JSON.parse(prompt.user);
  assert.equal(user.contract.version, PROXY_PROPOSAL_CLASSIFICATION_VERSION);
  assert.deepEqual(user.contract.response_schema, PROXY_PROPOSAL_CLASSIFICATION_RESPONSE_SCHEMA);
  assert.deepEqual(user.proposals, input.items);
  assert.deepEqual(PROXY_PROPOSAL_CATEGORIES, [
    "capital_structure",
    "equity_compensation",
    "transaction",
    "financing",
    "governance",
    "shareholder_proposal",
    "director_election",
    "auditor",
    "executive_compensation",
    "procedural",
    "other",
  ]);
  assert.match(prompt.system, /generic other-business boilerplate/i);
  assert.match(prompt.system, /actual stockholder proposal that does not accurately fit another category/);
  assert.match(prompt.system, /is_proposal=false and category=null/);
  assert.match(prompt.system, /Do not extract terms, decide lifecycle or completion, create unresolved output/);
  assert.doesNotMatch(prompt.user, /"evidence"|E2|E3|Proposal 1\. Election/);
});

test("Gemini request uses JSON Mode only", () => {
  const request = buildProxyProposalClassificationGeminiRequest(input, 2048) as Record<string, any>;
  assert.deepEqual(Object.keys(request), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(request.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 2048,
    temperature: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /responseSchema|responseJsonSchema|responseFormat|functionDeclarations|toolConfig|"tools"/,
  );
});

test("runner makes one direct request and validates one direct JSON output", async () => {
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
      candidatesTokenCount: 25,
      totalTokenCount: 125,
    },
  };
  const run = await runProxyProposalClassificationGemini({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    input,
    maxOutputTokens: 2048,
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
    buildProxyProposalClassificationGeminiRequest(input, 2048),
  );
  assert.equal(run.transportOk, true);
  assert.equal(run.validation.ok, true);
  assert.deepEqual(run.validation.value, validResult());
});

test("empty Stage 1 proposal lists produce an empty complete classification input", () => {
  const emptyStage1 = structuredClone(stage1);
  emptyStage1.proposals = [];
  const emptyInput: ProxyProposalClassificationInput = buildProxyProposalClassificationInput(emptyStage1);
  assert.deepEqual(emptyInput, { items: [] });
  assert.equal(parseAndValidateProxyProposalClassification(JSON.stringify({
    version: PROXY_PROPOSAL_CLASSIFICATION_VERSION,
    items: [],
  }), emptyInput).ok, true);
});
