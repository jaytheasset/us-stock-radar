import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA,
  PROXY_PROPOSAL_DISCOVERY_VERSION,
  buildProxyProposalDiscoveryGeminiRequest,
  buildProxyProposalDiscoveryPrompt,
  parseAndValidateProxyProposalDiscovery,
  runProxyProposalDiscoveryGemini,
  type ProxyProposalDiscoveryResult,
  type ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";

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

function validResult(): ProxyProposalDiscoveryResult {
  return {
    version: PROXY_PROPOSAL_DISCOVERY_VERSION,
    meeting: {
      type: "annual",
      date: "2022-05-18",
      evidence: ["E1"],
    },
    proposals: [
      {
        title: "Election of the nine director nominees",
        action_summary: "Elect the nine director nominees named in the proxy statement.",
        evidence: ["E2"],
      },
      {
        title: "Ratification of the independent registered public accounting firm",
        action_summary: "Ratify the appointment of the independent registered public accounting firm.",
        evidence: ["E3"],
      },
    ],
  };
}

test("valid output passes the closed recall-only Stage 1 contract", () => {
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(validResult()), sourcePackage);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, validResult());
});

test("Stage 2 fields and legacy unresolved output are rejected", () => {
  const value = validResult() as unknown as Record<string, unknown>;
  value.unresolved = [];
  const proposals = value.proposals as Array<Record<string, unknown>>;
  proposals[0].kind = "other";
  proposals[0].terms = [];
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("$.unresolved is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.proposals[0].kind is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("$.proposals[0].terms is not allowed")));
});

test("unknown and duplicate evidence IDs fail strict validation", () => {
  const value = validResult();
  value.proposals[0].evidence = ["E99", "E99"];
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown evidence E99")));
  assert.ok(result.errors.some((error) => error.includes("duplicates evidence E99")));
});

test("duplicate JSON keys and wrapper text are not repaired or unwrapped", () => {
  const duplicate = '{"version":"proxy_proposal_discovery_v1","version":"proxy_proposal_discovery_v1","meeting":{"type":"unclear","date":null,"evidence":[]},"proposals":[]}';
  assert.equal(parseAndValidateProxyProposalDiscovery(duplicate, sourcePackage).ok, false);
  assert.equal(
    parseAndValidateProxyProposalDiscovery(`result: ${JSON.stringify(validResult())}`, sourcePackage).ok,
    false,
  );
});

test("a placeholder cannot be emitted as a meeting date", () => {
  const value = validResult() as unknown as Record<string, unknown>;
  (value.meeting as Record<string, unknown>).date = "[•], 2025";
  const result = parseAndValidateProxyProposalDiscovery(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("real YYYY-MM-DD date or null")));
});

test("prompt makes recall the Stage 1 boundary and keeps Stage 2 out", () => {
  const prompt = buildProxyProposalDiscoveryPrompt(sourcePackage);
  const user = JSON.parse(prompt.user);
  assert.equal(user.contract.version, PROXY_PROPOSAL_DISCOVERY_VERSION);
  assert.deepEqual(user.contract.response_schema, PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA);
  assert.deepEqual(user.evidence_blocks, sourcePackage.evidenceBlocks);
  assert.match(prompt.system, /Discover every stockholder proposal/);
  assert.match(prompt.system, /including director elections, auditor ratification, say-on-pay/);
  assert.match(prompt.system, /Do not reconstruct or import an omitted parent proposal list/);
  assert.match(prompt.system, /placeholder is not an actual meeting date; use null/);
  assert.match(prompt.system, /Do not classify proposal type, create a kind or enum, structure terms, decide unresolved status/);
});

test("Gemini request uses JSON Mode only without provider schema, tools, or retries", () => {
  const request = buildProxyProposalDiscoveryGeminiRequest(sourcePackage, 4096) as Record<string, any>;
  assert.deepEqual(Object.keys(request), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(request.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
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
    maxOutputTokens: 4096,
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
    buildProxyProposalDiscoveryGeminiRequest(sourcePackage, 4096),
  );
  assert.equal(run.transportOk, true);
  assert.equal(run.validation.ok, true);
  assert.deepEqual(run.validation.value, validResult());
});
