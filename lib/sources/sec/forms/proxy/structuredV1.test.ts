import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_STRUCTURED_V1_FUNCTION_NAME,
  PROXY_STRUCTURED_V1_FUNCTION_PARAMETERS,
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  buildProxyStructuredV1GeminiRequest,
  buildProxyStructuredV1Prompt,
  buildProxyStructuredV1SourcePackage,
  parseAndValidateProxyStructuredV1,
  parseProxyStructuredV1GeminiFunctionResponse,
  projectProxyStructuredV1SchemaForGeminiFunction,
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

test("function prompt keeps the semantic source payload without embedding a JSON output schema", () => {
  const prompt = buildProxyStructuredV1Prompt(sourcePackage);
  const user = JSON.parse(prompt.user);

  assert.match(prompt.system, new RegExp(`call ${PROXY_STRUCTURED_V1_FUNCTION_NAME} exactly once`));
  assert.deepEqual(Object.keys(user), ["contract", "source_manifest", "evidence_blocks"]);
  assert.deepEqual(user.contract, {
    version: "proxy_structured_v1",
    source_fingerprint: sourcePackage.sourceFingerprint,
  });
  assert.deepEqual(user.source_manifest, sourcePackage.documents);
  assert.deepEqual(user.evidence_blocks, sourcePackage.evidenceBlocks);
  assert.doesNotMatch(JSON.stringify(prompt), /responseSchema|responseJsonSchema|responseFormat|responseMimeType|response_schema/);
});

test("Gemini function parameter projection preserves nested shape and enums without mutating the canonical schema", () => {
  const canonicalBefore = JSON.stringify(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
  const projected = projectProxyStructuredV1SchemaForGeminiFunction(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA) as any;
  const canonical = PROXY_STRUCTURED_V1_RESPONSE_SCHEMA as any;

  assert.equal(JSON.stringify(PROXY_STRUCTURED_V1_RESPONSE_SCHEMA), canonicalBefore);
  assert.notEqual(projected, PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
  assert.equal(canonical.additionalProperties, false);
  assert.equal(projected.additionalProperties, undefined);
  assert.equal(canonical.properties.meeting.additionalProperties, false);
  assert.equal(projected.properties.meeting.additionalProperties, undefined);
  assert.equal(canonical.properties.meeting.properties.evidence.uniqueItems, true);
  assert.equal(canonical.properties.proposals.items.additionalProperties, false);
  assert.equal(projected.properties.proposals.items.additionalProperties, undefined);
  assert.equal(canonical.properties.proposals.items.properties.evidence.uniqueItems, true);
  assertNoUnsupportedFunctionKeywords(projected);

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
  assert.deepEqual(projected.properties.meeting.properties.date, {
    type: "string",
    format: "date",
    nullable: true,
  });
});

test("Gemini generateContent request uses only one forced function-calling transport", () => {
  const request = buildProxyStructuredV1GeminiRequest(sourcePackage, 4096) as any;

  assert.equal(request.tools.length, 1);
  assert.equal(request.tools[0].functionDeclarations.length, 1);
  assert.equal(request.tools[0].functionDeclarations[0].name, PROXY_STRUCTURED_V1_FUNCTION_NAME);
  assert.deepEqual(request.tools[0].functionDeclarations[0].parameters, PROXY_STRUCTURED_V1_FUNCTION_PARAMETERS);
  assert.deepEqual(request.toolConfig, {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [PROXY_STRUCTURED_V1_FUNCTION_NAME],
    },
  });
  assert.equal(request.generationConfig.maxOutputTokens, 4096);
  assert.equal(request.generationConfig.temperature, 0);
  assert.doesNotMatch(
    JSON.stringify(request),
    /responseSchema|responseJsonSchema|responseFormat|responseMimeType|APPLICATION_JSON/,
  );
});

test("function response parser accepts exactly one named call and uses raw args as the candidate", () => {
  const raw = JSON.stringify(functionResponse([{ functionCall: {
    name: PROXY_STRUCTURED_V1_FUNCTION_NAME,
    args: validResult(),
  } }]));
  const parsed = parseProxyStructuredV1GeminiFunctionResponse(raw);

  assert.equal(parsed.ok, true, parsed.errors.join("; "));
  assert.equal(parsed.functionCallCount, 1);
  assert.equal(parsed.functionCallName, PROXY_STRUCTURED_V1_FUNCTION_NAME);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.candidate)), validResult());
});

test("function response parser rejects zero, multiple, wrong-name, and missing-args calls", () => {
  const cases = [
    {
      raw: JSON.stringify(functionResponse([{ text: JSON.stringify(validResult()) }])),
      error: /exactly one functionCall; received 0/,
    },
    {
      raw: JSON.stringify(functionResponse([
        { functionCall: { name: PROXY_STRUCTURED_V1_FUNCTION_NAME, args: validResult() } },
        { functionCall: { name: PROXY_STRUCTURED_V1_FUNCTION_NAME, args: validResult() } },
      ])),
      error: /exactly one functionCall; received 2/,
    },
    {
      raw: JSON.stringify(functionResponse([{ functionCall: { name: "other_function", args: validResult() } }])),
      error: /functionCall\.name must be submit_proxy_structured/,
    },
    {
      raw: JSON.stringify(functionResponse([{ functionCall: { name: PROXY_STRUCTURED_V1_FUNCTION_NAME } }])),
      error: /functionCall\.args is missing/,
    },
  ];

  for (const candidate of cases) {
    const parsed = parseProxyStructuredV1GeminiFunctionResponse(candidate.raw);
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join("; "), candidate.error);
    assert.equal(parsed.candidate, null);
  }
});

test("function response parser rejects duplicate keys in raw provider args", () => {
  const args = JSON.stringify(validResult()).replace(
    '"version":"proxy_structured_v1"',
    '"version":"proxy_structured_v1","version":"proxy_structured_v1"',
  );
  const raw = `{"candidates":[{"content":{"parts":[{"functionCall":{"name":"${PROXY_STRUCTURED_V1_FUNCTION_NAME}","args":${args}}}]},"finishReason":"STOP"}]}`;
  const parsed = parseProxyStructuredV1GeminiFunctionResponse(raw);

  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join("; "), /duplicate key "version"/);
});

test("Proxy Gemini runner sends the exact function request and validates unmodified args", async () => {
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
        candidates: [{ content: { parts: [{ functionCall: {
          name: PROXY_STRUCTURED_V1_FUNCTION_NAME,
          args: validResult(),
        } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35 },
      }), { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal((requests[0]?.init?.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), buildProxyStructuredV1GeminiRequest(sourcePackage, 4096));
  assert.equal(run.ok, true);
  assert.equal(run.transportOk, true);
  assert.equal(run.finishReason, "STOP");
  assert.equal(run.functionCallCount, 1);
  assert.equal(run.functionCallName, PROXY_STRUCTURED_V1_FUNCTION_NAME);
  assert.deepEqual(JSON.parse(JSON.stringify(run.candidate)), validResult());
  assert.equal(run.validation.ok, true, run.validation.errors.join("; "));
  assert.equal(run.usage?.thoughtsTokenCount, 5);
});

test("wrapper args remain a strict canonical failure without unwrapping", async () => {
  const run = await runProxyStructuredV1Gemini({
    apiKey: "test-key",
    model: "gemini-3.5-flash",
    sourcePackage,
    maxOutputTokens: 4096,
    fetchImpl: (async () => new Response(JSON.stringify(functionResponse([{ functionCall: {
      name: PROXY_STRUCTURED_V1_FUNCTION_NAME,
      args: { contract: validResult() },
    } }])), { status: 200, statusText: "OK" })) as typeof fetch,
  });

  assert.equal(run.transportOk, true);
  assert.deepEqual(JSON.parse(JSON.stringify(run.candidate)), { contract: validResult() });
  assert.equal(run.validation.ok, false);
  assert.match(run.validation.errors.join("; "), /must contain exactly/);
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

function functionResponse(parts: unknown[]) {
  return { candidates: [{ content: { parts }, finishReason: "STOP" }] };
}

function assertNoUnsupportedFunctionKeywords(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoUnsupportedFunctionKeywords);
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
      Object.values(child).forEach(assertNoUnsupportedFunctionKeywords);
      return;
    }
    assert.ok([
      "enum", "format", "items", "nullable", "properties", "required", "type",
    ].includes(key), `unsupported function parameter schema keyword: ${key}`);
    assertNoUnsupportedFunctionKeywords(child);
  });
}
