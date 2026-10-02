import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
  buildProxyStructuredV1Prompt,
  buildProxyStructuredV1SourcePackage,
  parseAndValidateProxyStructuredV1,
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
  assert.deepEqual(user.contract.response_schema, PROXY_STRUCTURED_V1_RESPONSE_SCHEMA);
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
