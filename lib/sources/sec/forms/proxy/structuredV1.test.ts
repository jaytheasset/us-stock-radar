import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_STRUCTURED_V1_PROVIDER_SCHEMA,
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  buildProxyStructuredV1GeminiRequest,
  buildProxyStructuredV1Prompt,
  buildProxyStructuredV1SourcePackage,
  parseAndValidateProxyStructuredV1,
  projectProxyStructuredV1SchemaForGemini,
  runProxyStructuredV1Gemini,
  type ProxyStructuredV1Result,
} from "./structuredV1.ts";

const sourcePackage = buildProxyStructuredV1SourcePackage([{
  documentId: "primary",
  sequence: 0,
  documentType: "DEF 14A",
  filename: "example.htm",
  url: "https://www.sec.gov/Archives/example.htm",
  html: "<html><body><p>Annual meeting on June 17, 2026.</p><p>Approve the 2026 Equity Plan.</p></body></html>",
}], { chunkChars: 500 });

function validResult(): ProxyStructuredV1Result {
  return {
    version: "proxy_structured_v1",
    source_fingerprint: sourcePackage.sourceFingerprint,
    meeting: { date: "2026-06-17", type: "annual", evidence: ["E1"] },
    proposals: [{
      kind: "equity_plan",
      action: "approve",
      subject: "2026 Equity Plan",
      terms: [],
      evidence: ["E1"],
    }],
    unresolved: [],
  };
}

test("valid output passes the closed Proxy Structured v1 contract", () => {
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(validResult()), sourcePackage);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), validResult());
});

test("invalid JSON fails", () => {
  const result = parseAndValidateProxyStructuredV1('{"version":', sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /invalid JSON value|unterminated/i);
});

test("duplicate keys fail before structural validation", () => {
  const source = JSON.stringify(validResult()).replace(
    '"version":"proxy_structured_v1"',
    '"version":"proxy_structured_v1","version":"proxy_structured_v1"',
  );
  const result = parseAndValidateProxyStructuredV1(source, sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /duplicate key "version"/i);
});

test("invalid enum fails", () => {
  const value = { ...validResult(), meeting: { ...validResult().meeting, type: "quarterly" } };
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /meeting\.type must be one of/i);
});

test("unknown evidence fails", () => {
  const value = { ...validResult(), meeting: { ...validResult().meeting, evidence: ["E999"] } };
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /unknown evidence E999/i);
});

test("missing required field fails", () => {
  const { unresolved: _removed, ...value } = validResult();
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /must contain exactly/i);
});

test("undeclared field fails", () => {
  const value = { ...validResult(), summary: "not in the contract" };
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /must contain exactly/i);
});

test("source fingerprint mismatch fails", () => {
  const value = { ...validResult(), source_fingerprint: "0".repeat(64) };
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /source_fingerprint must match/i);
});

test("provider boundary keeps the canonical contract in the prompt without exposing responseSchema", () => {
  const prompt = buildProxyStructuredV1Prompt(sourcePackage);
  const user = JSON.parse(prompt.user);

  assert.equal("responseSchema" in prompt, false);
  assert.deepEqual(prompt.responseFormat.json_schema, PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
  assert.deepEqual(prompt.providerResponseSchema, PROXY_STRUCTURED_V1_PROVIDER_SCHEMA);
  assert.deepEqual(user.contract.response_schema, PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
});

test("Gemini responseFormat projection keeps only documented keywords without mutating canonical shape", () => {
  const canonicalBefore = JSON.stringify(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
  const projected = projectProxyStructuredV1SchemaForGemini(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA) as any;
  const canonical = PROXY_STRUCTURED_V1_RESPONSE_SCHEMA as any;

  assert.equal(JSON.stringify(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA), canonicalBefore);
  assert.notEqual(projected, PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
  assert.equal(canonical.additionalProperties, false);
  assert.equal(projected.additionalProperties, false);
  assert.equal(canonical.properties.meeting.additionalProperties, false);
  assert.equal(projected.properties.meeting.additionalProperties, false);
  assert.equal(canonical.properties.meeting.properties.evidence.uniqueItems, true);
  assert.equal(canonical.properties.proposals.items.additionalProperties, false);
  assert.equal(projected.properties.proposals.items.additionalProperties, false);
  assert.equal(canonical.properties.proposals.items.properties.evidence.uniqueItems, true);
  assertNoUnsupportedProviderKeywords(projected);

  assert.deepEqual(Object.keys(projected.properties), Object.keys(canonical.properties));
  assert.deepEqual(projected.required, canonical.required);
  assert.deepEqual(projected.properties.meeting.required, canonical.properties.meeting.required);
  assert.deepEqual(
    Object.keys(projected.properties.meeting.properties),
    Object.keys(canonical.properties.meeting.properties),
  );
  assert.deepEqual(projected.properties.meeting.properties.type.enum, canonical.properties.meeting.properties.type.enum);
  assert.deepEqual(projected.properties.proposals.items.required, canonical.properties.proposals.items.required);
  assert.deepEqual(
    Object.keys(projected.properties.proposals.items.properties),
    Object.keys(canonical.properties.proposals.items.properties),
  );
  assert.deepEqual(
    projected.properties.proposals.items.properties.kind.enum,
    canonical.properties.proposals.items.properties.kind.enum,
  );
  assert.deepEqual(
    projected.properties.proposals.items.properties.action.enum,
    canonical.properties.proposals.items.properties.action.enum,
  );
  assert.deepEqual(
    projected.properties.meeting.properties.date.anyOf,
    canonical.properties.meeting.properties.date.anyOf,
  );
});

test("Gemini generateContent request uses only the latest responseFormat transport", () => {
  const request = buildProxyStructuredV1GeminiRequest(sourcePackage, 4096) as any;

  assert.equal(request.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
  assert.deepEqual(request.generationConfig.responseFormat.text.schema, PROXY_STRUCTURED_V1_PROVIDER_SCHEMA);
  assert.equal(request.generationConfig.maxOutputTokens, 4096);
  assert.equal(request.generationConfig.temperature, 0);
  assert.equal("responseSchema" in request.generationConfig, false);
  assert.equal("responseJsonSchema" in request.generationConfig, false);
  assert.equal("responseMimeType" in request.generationConfig, false);
});

test("Proxy Gemini runner sends the exact responseFormat request without changing the shared helper", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const run = await runProxyStructuredV1Gemini({
    apiKey: "test-key",
    model: "gemini-3.5-flash",
    sourcePackage,
    maxOutputTokens: 4096,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        responseId: "response-1",
        modelVersion: "gemini-3.5-flash",
        candidates: [{ content: { parts: [{ text: JSON.stringify(validResult()) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35 },
      }), { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal((requests[0]?.init?.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), buildProxyStructuredV1GeminiRequest(sourcePackage, 4096));
  assert.equal(run.ok, true);
  assert.equal(run.finishReason, "STOP");
  assert.equal(run.outputText, JSON.stringify(validResult()));
  assert.equal(run.usage?.thoughtsTokenCount, 5);
});

test("source package preserves document order and produces deterministic evidence and hashes", () => {
  const first = buildProxyStructuredV1SourcePackage([
    {
      documentId: "second",
      sequence: 2,
      documentType: "EX-99",
      filename: "second.htm",
      url: "https://www.sec.gov/second.htm",
      text: "Second source.",
    },
    {
      documentId: "first",
      sequence: 1,
      documentType: "DEF 14A",
      filename: "first.htm",
      url: "https://www.sec.gov/first.htm",
      html: "<p>First&nbsp;source.</p>",
    },
  ], { chunkChars: 500 });
  const second = buildProxyStructuredV1SourcePackage([
    {
      documentId: "first",
      sequence: 1,
      documentType: "DEF 14A",
      filename: "first.htm",
      url: "https://www.sec.gov/first.htm",
      html: "<p>First&nbsp;source.</p>",
    },
    {
      documentId: "second",
      sequence: 2,
      documentType: "EX-99",
      filename: "second.htm",
      url: "https://www.sec.gov/second.htm",
      text: "Second source.",
    },
  ], { chunkChars: 500 });

  assert.deepEqual(first, second);
  assert.deepEqual(first.documents.map((document) => document.documentId), ["first", "second"]);
  assert.deepEqual(first.evidenceBlocks.map((block) => [block.id, block.documentId, block.text]), [
    ["E1", "first", "First source."],
    ["E2", "second", "Second source."],
  ]);
  assert.match(first.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(first.packageFingerprint, /^[a-f0-9]{64}$/);
});

function assertNoUnsupportedProviderKeywords(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoUnsupportedProviderKeywords);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  assert.equal("uniqueItems" in record, false);
  assert.equal("pattern" in record, false);
  assert.equal("minLength" in record, false);
  assert.equal("maxLength" in record, false);
  Object.entries(record).forEach(([key, child]) => {
    if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
      Object.values(child).forEach(assertNoUnsupportedProviderKeywords);
      return;
    }
    assert.ok([
      "$ref", "additionalProperties", "anyOf", "description", "enum", "format", "items",
      "maximum", "maxItems", "minimum", "minItems", "prefixItems", "properties", "required",
      "title", "type",
    ].includes(key), `unsupported provider schema keyword: ${key}`);
    assertNoUnsupportedProviderKeywords(child);
  });
}
