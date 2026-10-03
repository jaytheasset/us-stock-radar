import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROCEDURAL_BALLOT_EVIDENCE_EXCERPT_MAX_CHARS,
  PROXY_PROCEDURAL_BALLOT_RESPONSE_SCHEMA,
  buildProxyProceduralBallotGeminiRequest,
  buildProxyProceduralBallotInputs,
  buildProxyProceduralBallotPrompt,
  parseAndValidateProxyProceduralBallot,
  runProxyProceduralBallotGemini,
  type ProxyProceduralBallotInput,
  type ProxyProceduralBallotResult,
} from "./proceduralBallotVerification.ts";
import type { ProxyProposalClassificationResult } from "./proposalClassification.ts";
import type {
  ProxyProposalDiscoveryResult,
  ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";

const stage1: ProxyProposalDiscoveryResult = {
  version: "proxy_proposal_discovery_v1",
  meeting: { type: "special", date: null, evidence: ["E1"] },
  proposals: [
    {
      title: "Adjournment Proposal",
      action_summary: "Approve adjournment if additional time is needed to solicit proxies.",
      evidence: ["E2", "E3"],
    },
    {
      title: "Special Meeting of Stockholders",
      action_summary: "The meeting was adjourned due to lack of quorum.",
      evidence: ["E4"],
    },
    {
      title: "Reverse Stock Split",
      action_summary: "Approve a reverse stock split.",
      evidence: ["E5"],
    },
  ],
};

const stage2: ProxyProposalClassificationResult = {
  version: "proxy_proposal_classification_v1",
  items: [
    { proposal_id: "P1", is_proposal: true, category: "procedural" },
    { proposal_id: "P2", is_proposal: true, category: "procedural" },
    { proposal_id: "P3", is_proposal: true, category: "capital_structure" },
  ],
};

const sourcePackage: ProxyProposalDiscoverySourcePackage = {
  evidenceBlocks: [
    { id: "E1", blockType: "source_document", blockSequence: 0, text: "Special meeting notice." },
    { id: "E2", blockType: "source_proposal", blockSequence: 1, text: "Proposal 2: Adjournment Proposal." },
    { id: "E3", blockType: "source_document", blockSequence: 2, text: "Stockholders may vote to adjourn the meeting." },
    { id: "E4", blockType: "source_document", blockSequence: 3, text: "The meeting was adjourned due to lack of quorum." },
    { id: "E5", blockType: "source_proposal", blockSequence: 4, text: "Proposal 1: Reverse Stock Split." },
    { id: "E6", blockType: "source_document", blockSequence: 5, text: "Uncited text must stay out." },
  ],
};

const inputs = buildProxyProceduralBallotInputs({
  stage1,
  stage2,
  sourcePackage,
  formType: "DEFA14A",
});

function validResult(input: ProxyProceduralBallotInput): ProxyProceduralBallotResult {
  return {
    proposal_id: input.proposal_id,
    is_ballot_proposal: input.proposal_id === "P1",
  };
}

test("builds Stage 2B inputs only for Stage 2 procedural items", () => {
  assert.deepEqual(inputs, [
    {
      proposal_id: "P1",
      title: "Adjournment Proposal",
      action_summary: "Approve adjournment if additional time is needed to solicit proxies.",
      evidence_excerpt: "Proposal 2: Adjournment Proposal.\n\nStockholders may vote to adjourn the meeting.",
      form_type: "DEFA14A",
    },
    {
      proposal_id: "P2",
      title: "Special Meeting of Stockholders",
      action_summary: "The meeting was adjourned due to lack of quorum.",
      evidence_excerpt: "The meeting was adjourned due to lack of quorum.",
      form_type: "DEFA14A",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(inputs), /E2|E3|E4|E5|E6|Uncited text/);
});

test("bounds Stage 2B evidence excerpts to 2,500 characters", () => {
  const longSource = structuredClone(sourcePackage);
  longSource.evidenceBlocks = [
    { id: "E2", blockType: "source_document", blockSequence: 0, text: `SOURCE_A_${"A".repeat(3_000)}` },
    { id: "E3", blockType: "source_document", blockSequence: 1, text: `SOURCE_B_${"B".repeat(3_000)}` },
    { id: "E4", blockType: "source_document", blockSequence: 2, text: "Completed adjournment." },
  ];
  const bounded = buildProxyProceduralBallotInputs({
    stage1,
    stage2,
    sourcePackage: longSource,
    formType: "DEFA14A",
  });
  const excerpt = bounded[0]?.evidence_excerpt || "";
  assert.equal(excerpt.length, PROXY_PROCEDURAL_BALLOT_EVIDENCE_EXCERPT_MAX_CHARS);
  assert.match(excerpt, /^SOURCE_A_/);
  assert.match(excerpt, /\n\nSOURCE_B_/);
});

test("rejects invalid procedural candidates and evidence references", () => {
  const invalidStage2 = structuredClone(stage2);
  invalidStage2.items[0] = { proposal_id: "P99", is_proposal: true, category: "procedural" };
  assert.throws(
    () => buildProxyProceduralBallotInputs({ stage1, stage2: invalidStage2, sourcePackage, formType: "DEFA14A" }),
    /unknown Stage 1 proposal P99/,
  );

  const invalidStage1 = structuredClone(stage1);
  invalidStage1.proposals[0].evidence = ["E99"];
  assert.throws(
    () => buildProxyProceduralBallotInputs({ stage1: invalidStage1, stage2, sourcePackage, formType: "DEFA14A" }),
    /references unknown Stage 1 evidence E99/,
  );
});

test("prompt limits Stage 2B to separate ballot-proposal verification", () => {
  const prompt = buildProxyProceduralBallotPrompt(inputs[0]);
  const user = JSON.parse(prompt.user);
  assert.deepEqual(user.contract.response_schema, PROXY_PROCEDURAL_BALLOT_RESPONSE_SCHEMA);
  assert.deepEqual(user.item, inputs[0]);
  assert.match(prompt.system, /separate proposal submitted to stockholders/i);
  assert.match(prompt.system, /generic other-business boilerplate/i);
  assert.match(prompt.system, /already occurred/i);
  assert.match(prompt.system, /meeting logistics/i);
  assert.match(prompt.system, /Do not classify category/i);
});

test("Gemini request uses JSON Mode without provider schema or tools", () => {
  const request = buildProxyProceduralBallotGeminiRequest(inputs[0], 256) as Record<string, any>;
  assert.deepEqual(Object.keys(request), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(request.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 256,
    temperature: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /responseSchema|responseJsonSchema|responseFormat|functionDeclarations|toolConfig|"tools"/,
  );
});

test("strict validation preserves the input proposal ID and boolean output", () => {
  const valid = validResult(inputs[0]);
  assert.deepEqual(
    parseAndValidateProxyProceduralBallot(JSON.stringify(valid), inputs[0]),
    { ok: true, value: valid, errors: [] },
  );
  assert.equal(parseAndValidateProxyProceduralBallot(
    JSON.stringify({ proposal_id: "P2", is_ballot_proposal: true }),
    inputs[0],
  ).ok, false);
  assert.equal(parseAndValidateProxyProceduralBallot(
    JSON.stringify({ ...valid, category: "procedural" }),
    inputs[0],
  ).ok, false);
  assert.equal(parseAndValidateProxyProceduralBallot(
    '{"proposal_id":"P1","proposal_id":"P1","is_ballot_proposal":true}',
    inputs[0],
  ).ok, false);
  assert.equal(parseAndValidateProxyProceduralBallot(
    `result: ${JSON.stringify(valid)}`,
    inputs[0],
  ).ok, false);
});

test("runner makes one direct request and validates one direct output", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = validResult(inputs[0]);
  const responseBody = {
    responseId: "response-1",
    modelVersion: "gemini-2.5-flash-lite",
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(result) }] },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120,
    },
  };
  const run = await runProxyProceduralBallotGemini({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    input: inputs[0],
    maxOutputTokens: 256,
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
    buildProxyProceduralBallotGeminiRequest(inputs[0], 256),
  );
  assert.equal(run.transportOk, true);
  assert.equal(run.validation.ok, true);
  assert.deepEqual(run.validation.value, result);
});

test("no procedural Stage 2 items produce no Stage 2B inputs", () => {
  const nonProcedural = structuredClone(stage2);
  nonProcedural.items = nonProcedural.items.map((item) => ({
    ...item,
    category: "other" as const,
  }));
  assert.deepEqual(buildProxyProceduralBallotInputs({
    stage1,
    stage2: nonProcedural,
    sourcePackage,
    formType: "DEFA14A",
  }), []);
});
