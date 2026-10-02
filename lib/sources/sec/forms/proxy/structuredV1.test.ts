import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  buildProxyStructuredV1GeminiRequest,
  buildProxyStructuredV1Prompt,
  buildProxyStructuredV1SourcePackage,
  parseAndValidateProxyStructuredV1,
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

test("JSON mode prompt embeds the canonical response schema in the source-neutral contract", () => {
  const prompt = buildProxyStructuredV1Prompt(sourcePackage);
  const user = JSON.parse(prompt.user);

  assert.deepEqual(Object.keys(prompt), ["system", "user"]);
  assert.match(prompt.system, /Return one direct JSON object matching the closed schema/);
  assert.match(prompt.system, /do not add prose or markdown/);
  assert.deepEqual(Object.keys(user), ["contract", "source_manifest", "evidence_blocks"]);
  assert.deepEqual(user.contract, {
    version: "proxy_structured_v1",
    source_fingerprint: sourcePackage.sourceFingerprint,
    response_schema: PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  });
  assert.deepEqual(user.source_manifest, sourcePackage.documents);
  assert.deepEqual(user.evidence_blocks, sourcePackage.evidenceBlocks);
  assert.doesNotMatch(JSON.stringify(prompt), /responseSchema|responseJsonSchema|responseFormat/);
});

test("Gemini generateContent request uses JSON mode without provider schema or tools", () => {
  const request = buildProxyStructuredV1GeminiRequest(sourcePackage, 4096) as any;

  assert.deepEqual(Object.keys(request), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(request.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
    temperature: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /responseSchema|responseJsonSchema|responseFormat|"tools"|toolConfig|functionDeclarations/,
  );
});

test("Proxy Gemini runner sends one JSON mode request and validates the exact direct text", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const outputText = `\n${JSON.stringify(validResult())}\n`;
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
        candidates: [{ content: { parts: [{ text: outputText }] }, finishReason: "STOP" }],
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
  assert.equal(run.outputTextCount, 1);
  assert.equal(run.outputText, outputText);
  assert.equal(run.validation.ok, true, run.validation.errors.join("; "));
  assert.deepEqual(JSON.parse(JSON.stringify(run.validation.value)), validResult());
  assert.equal(run.usage?.thoughtsTokenCount, 5);
});

test("wrapper text remains a strict canonical failure without unwrapping", async () => {
  const outputText = JSON.stringify({ contract: validResult() });
  const run = await runProxyStructuredV1Gemini({
    apiKey: "test-key",
    model: "gemini-3.5-flash",
    sourcePackage,
    maxOutputTokens: 4096,
    fetchImpl: (async () => new Response(JSON.stringify(textResponse([outputText])), {
      status: 200,
      statusText: "OK",
    })) as typeof fetch,
  });

  assert.equal(run.transportOk, true);
  assert.equal(run.outputText, outputText);
  assert.equal(run.validation.ok, false);
  assert.match(run.validation.errors.join("; "), /must contain exactly/);
});

test("runner preserves duplicate keys in direct text for strict parser rejection", async () => {
  const outputText = JSON.stringify(validResult()).replace(
    '"version":"proxy_structured_v1"',
    '"version":"proxy_structured_v1","version":"proxy_structured_v1"',
  );
  const run = await runProxyStructuredV1Gemini({
    apiKey: "test-key",
    model: "gemini-3.5-flash",
    sourcePackage,
    maxOutputTokens: 4096,
    fetchImpl: (async () => new Response(JSON.stringify(textResponse([outputText])), {
      status: 200,
      statusText: "OK",
    })) as typeof fetch,
  });

  assert.equal(run.transportOk, true);
  assert.equal(run.outputText, outputText);
  assert.equal(run.validation.ok, false);
  assert.match(run.validation.errors.join("; "), /duplicate key "version"/);
});

test("runner rejects multiple non-empty text outputs at the transport boundary", async () => {
  const run = await runProxyStructuredV1Gemini({
    apiKey: "test-key",
    model: "gemini-3.5-flash",
    sourcePackage,
    maxOutputTokens: 4096,
    fetchImpl: (async () => new Response(JSON.stringify(textResponse([
      JSON.stringify(validResult()),
      JSON.stringify(validResult()),
    ], "MAX_TOKENS")), { status: 200, statusText: "OK" })) as typeof fetch,
  });

  assert.equal(run.transportOk, false);
  assert.equal(run.finishReason, "MAX_TOKENS");
  assert.equal(run.outputTextCount, 2);
  assert.equal(run.outputText, null);
  assert.match(run.error || "", /generation stopped: MAX_TOKENS/);
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

function textResponse(outputs: string[], finishReason = "STOP") {
  return {
    candidates: [{
      content: { parts: outputs.map((text) => ({ text })) },
      finishReason,
    }],
  };
}
