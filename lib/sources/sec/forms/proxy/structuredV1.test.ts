import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyFiling } from "./parser.ts";
import {
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  bindProxyStructuredV1Snapshot,
  buildProxyStructuredV1GeminiRequest,
  buildProxyStructuredV1Prompt,
  buildProxyStructuredV1SourcePackage,
  parseAndValidateProxyStructuredV1,
  runProxyStructuredV1Gemini,
  type ProxyStructuredV1Result,
} from "./structuredV1.ts";

const parserOutput = parseProxyFiling({
  formType: "DEF 14A",
  accessionNumber: "0000000000-26-000001",
  companyName: "Example Corp.",
  primaryTicker: { ticker: "EXM", exchange: "Nasdaq" },
  filingText: [
    "NOTICE OF ANNUAL MEETING OF STOCKHOLDERS.",
    "The annual meeting will be held on June 17, 2026.",
    "Proposal 1: Approval of the 2026 Equity Incentive Plan.",
    "Stockholders are asked to approve the 2026 Equity Incentive Plan.",
  ].join(" "),
});

const sourcePackage = buildProxyStructuredV1SourcePackage(parserOutput, {
  cik: "0000000000",
  filingDate: "2026-04-23",
  sourceUrl: "https://www.sec.gov/Archives/example-index.htm",
  primaryDocumentUrl: "https://www.sec.gov/Archives/example.htm",
});

function validResult(): ProxyStructuredV1Result {
  return {
    version: "proxy_structured_v1",
    meeting: { date: "2026-06-17", type: "annual", evidence: ["E1"] },
    proposals: [{
      kind: "equity_plan",
      action: "approve",
      subject: "2026 Equity Incentive Plan",
      terms: [],
      evidence: ["E2"],
    }],
    unresolved: [],
  };
}

test("valid output passes the minimal closed Proxy Structured v1 contract", () => {
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

test("undeclared model field fails, including former server provenance", () => {
  const value = { ...validResult(), source_fingerprint: sourcePackage.provenance.source_fingerprint };
  const result = parseAndValidateProxyStructuredV1(JSON.stringify(value), sourcePackage);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /must contain exactly/i);
});

test("source package reuses Primary cleaned block order and text with neutral labels", () => {
  const second = buildProxyStructuredV1SourcePackage(parserOutput, {
    cik: "0000000000",
    filingDate: "2026-04-23",
    sourceUrl: "https://www.sec.gov/Archives/example-index.htm",
    primaryDocumentUrl: "https://www.sec.gov/Archives/example.htm",
  });

  assert.deepEqual(sourcePackage, second);
  assert.deepEqual(sourcePackage.evidenceBlocks.map((block) => block.id), ["E1", "E2"]);
  assert.deepEqual(sourcePackage.evidenceBlocks.map((block) => block.blockSequence), [0, 1]);
  assert.ok(sourcePackage.evidenceBlocks.every((block) => block.blockType === "proxy_source_block"));
  assert.ok(sourcePackage.evidenceBlocks.every((block) => !Object.hasOwn(block, "label")));
  assert.match(sourcePackage.provenance.source_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(sourcePackage.provenance.package_fingerprint, /^[a-f0-9]{64}$/);
});

test("parser-generated preliminary placeholder text is rejected as non-source evidence", () => {
  const synthetic = structuredClone(parserOutput);
  synthetic.raw.importantBlocks.push({
    kind: "preliminary_placeholder",
    label: "preliminary placeholders",
    text: "meeting date",
  });

  assert.throws(
    () => buildProxyStructuredV1SourcePackage(synthetic),
    /parser-generated preliminary_placeholder text as source evidence/,
  );
});

test("server-owned identity and fingerprints bind outside model facts", () => {
  const snapshot = bindProxyStructuredV1Snapshot(sourcePackage, validResult());

  assert.deepEqual(snapshot, {
    version: "proxy_structured_v1",
    provenance: sourcePackage.provenance,
    facts: validResult(),
  });
  assert.equal(snapshot.provenance.accession_number, "0000000000-26-000001");
  assert.equal(snapshot.provenance.sec_form_type, "DEF 14A");
  assert.equal(snapshot.provenance.filing_date, "2026-04-23");
  assert.equal(snapshot.provenance.issuer_identity.company_name, "Example Corp.");
  assert.equal(Object.hasOwn(snapshot.facts, "source_fingerprint"), false);
});

test("JSON mode prompt embeds only the minimal contract and neutral evidence package", () => {
  const prompt = buildProxyStructuredV1Prompt(sourcePackage);
  const user = JSON.parse(prompt.user);
  const serialized = JSON.stringify(prompt);

  assert.deepEqual(Object.keys(prompt), ["system", "user"]);
  assert.match(prompt.system, /Return one direct JSON object matching the closed schema/);
  assert.match(prompt.system, /do not add prose or markdown/);
  assert.match(prompt.system, /blockType is mechanical provenance/);
  assert.deepEqual(Object.keys(user), ["contract", "evidence_blocks"]);
  assert.deepEqual(user.contract, {
    version: "proxy_structured_v1",
    response_schema: PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  });
  assert.deepEqual(user.evidence_blocks, sourcePackage.evidenceBlocks);
  assert.doesNotMatch(serialized, /source_fingerprint|package_fingerprint|accession_number|company_name/);
  assert.doesNotMatch(serialized, /shareholder meeting date|equity or incentive plan update/);
  assert.doesNotMatch(serialized, /responseSchema|responseJsonSchema|responseFormat/);
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

function textResponse(outputs: string[], finishReason = "STOP") {
  return {
    candidates: [{
      content: { parts: outputs.map((text) => ({ text })) },
      finishReason,
    }],
  };
}
