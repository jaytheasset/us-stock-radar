import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS,
  PROXY_PROPOSAL_ROUTING_MODELS,
  runProxyProposalRouting,
} from "./proposalRouting.ts";
import type { ProxyProposalDiscoverySourcePackage } from "./proposalDiscovery.ts";

const sourcePackage: ProxyProposalDiscoverySourcePackage = {
  evidenceBlocks: [
    {
      id: "E1",
      blockType: "source_proposal",
      blockSequence: 0,
      text: "Proposal 1 asks stockholders to approve adjournment if more proxies are needed.",
    },
    {
      id: "E2",
      blockType: "source_document",
      blockSequence: 1,
      text: "The meeting was adjourned due to lack of quorum. This notice updates the quorum requirement.",
    },
    {
      id: "E3",
      blockType: "source_proposal",
      blockSequence: 2,
      text: "Proposal 2 asks stockholders to ratify the independent auditor.",
    },
  ],
};

const stage1Output = {
  version: "proxy_proposal_discovery_v1",
  meeting: { type: "special", date: null, evidence: ["E1"] },
  proposals: [
    {
      title: "Adjournment Proposal",
      action_summary: "Approve adjournment if additional proxies are needed.",
      evidence: ["E1"],
    },
    {
      title: "Special Meeting of Stockholders",
      action_summary: "The meeting was adjourned due to lack of quorum.",
      evidence: ["E2"],
    },
    {
      title: "Ratification of Independent Auditor",
      action_summary: "Ratify the independent auditor.",
      evidence: ["E3"],
    },
  ],
};

const stage2Output = {
  version: "proxy_proposal_classification_v1",
  items: [
    { proposal_id: "P1", is_proposal: true, category: "procedural" },
    { proposal_id: "P2", is_proposal: true, category: "procedural" },
    { proposal_id: "P3", is_proposal: true, category: "auditor" },
  ],
};

test("routes Stage 1 and Stage 2 to Flash Lite and only procedural items to Stage 2B", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const outputs = [
    geminiResponse(stage1Output, "gemini-2.5-flash-lite"),
    geminiResponse(stage2Output, "gemini-2.5-flash-lite"),
    geminiResponse({ proposal_id: "P1", is_ballot_proposal: true }, "gemini-3.5-flash"),
    geminiResponse({ proposal_id: "P2", is_ballot_proposal: false }, "gemini-3.5-flash"),
  ];
  const result = await runProxyProposalRouting({
    apiKey: "test-key",
    sourcePackage,
    formType: "DEFA14A",
    fetchImpl: createFetch(outputs, calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.stage2b.map((item) => item.proposal_id), ["P1", "P2"]);
  assert.deepEqual(result.finalProposals?.map((proposal) => [proposal.proposal_id, proposal.category]), [
    ["P1", "procedural"],
    ["P3", "auditor"],
  ]);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.url), [
    endpoint(PROXY_PROPOSAL_ROUTING_MODELS.stage1),
    endpoint(PROXY_PROPOSAL_ROUTING_MODELS.stage2),
    endpoint(PROXY_PROPOSAL_ROUTING_MODELS.stage2b),
    endpoint(PROXY_PROPOSAL_ROUTING_MODELS.stage2b),
  ]);
  assert.deepEqual(calls.map((call) => call.body.generationConfig.maxOutputTokens), [
    PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage1,
    PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage2,
    PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage2b,
    PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage2b,
  ]);
  assert.deepEqual(PROXY_PROPOSAL_ROUTING_MODELS, {
    stage1: "gemini-2.5-flash-lite",
    stage2: "gemini-2.5-flash-lite",
    stage2b: "gemini-3.5-flash",
  });
  assert.deepEqual(PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS, {
    stage1: 4096,
    stage2: 2048,
    stage2b: 1024,
  });
});

test("does not call Stage 2B when Stage 2 has no accepted procedural items", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const noProceduralStage2 = {
    ...stage2Output,
    items: [
      { proposal_id: "P1", is_proposal: true, category: "other" },
      { proposal_id: "P2", is_proposal: false, category: null },
      { proposal_id: "P3", is_proposal: true, category: "auditor" },
    ],
  };
  const result = await runProxyProposalRouting({
    apiKey: "test-key",
    sourcePackage,
    formType: "DEFA14A",
    fetchImpl: createFetch([
      geminiResponse(stage1Output, "gemini-2.5-flash-lite"),
      geminiResponse(noProceduralStage2, "gemini-2.5-flash-lite"),
    ], calls),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.stage2b, []);
  assert.deepEqual(result.finalProposals?.map((proposal) => proposal.proposal_id), ["P1", "P3"]);
});

test("stops after a Stage 1 provider failure without supplying fallback values", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const result = await runProxyProposalRouting({
    apiKey: "test-key",
    sourcePackage,
    formType: "DEFA14A",
    fetchImpl: createFetch([providerFailure("stage 1 failed")], calls),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.stage, "stage1");
  assert.equal(result.stage2, null);
  assert.deepEqual(result.stage2b, []);
  assert.equal(result.finalProposals, null);
  assert.equal(calls.length, 1);
});

test("stops after a Stage 2 provider failure without calling Stage 2B", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const result = await runProxyProposalRouting({
    apiKey: "test-key",
    sourcePackage,
    formType: "DEFA14A",
    fetchImpl: createFetch([
      geminiResponse(stage1Output, "gemini-2.5-flash-lite"),
      providerFailure("stage 2 failed"),
    ], calls),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.stage, "stage2");
  assert.deepEqual(result.stage2b, []);
  assert.equal(result.finalProposals, null);
  assert.equal(calls.length, 2);
});

test("does not emit final proposals when a required Stage 2B decision fails", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const oneProceduralStage2 = {
    ...stage2Output,
    items: [
      stage2Output.items[0],
      { proposal_id: "P2", is_proposal: false, category: null },
      stage2Output.items[2],
    ],
  };
  const result = await runProxyProposalRouting({
    apiKey: "test-key",
    sourcePackage,
    formType: "DEFA14A",
    fetchImpl: createFetch([
      geminiResponse(stage1Output, "gemini-2.5-flash-lite"),
      geminiResponse(oneProceduralStage2, "gemini-2.5-flash-lite"),
      maxTokensFailure(),
    ], calls),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.stage, "stage2b");
  assert.equal(result.finalProposals, null);
  assert.equal(calls.length, 3);
});

function createFetch(
  responses: Response[],
  calls: Array<{ url: string; body: any }>,
) {
  return (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Gemini request");
    return response;
  }) as typeof fetch;
}

function geminiResponse(output: unknown, modelVersion: string) {
  return new Response(JSON.stringify({
    responseId: `response-${Math.random()}`,
    modelVersion,
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(output) }] },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 25,
      totalTokenCount: 125,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function providerFailure(message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 500,
    statusText: "Internal Server Error",
    headers: { "Content-Type": "application/json" },
  });
}

function maxTokensFailure() {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function endpoint(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}
