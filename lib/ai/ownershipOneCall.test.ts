import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildInputFromSecRawRow } from "./secFilingAnalysisPreview.ts";
import {
  buildOwnershipOneCallPrompt,
  validateOwnershipOneCallOutput,
  OWNERSHIP_ONE_CALL_MODEL,
} from "./ownershipOneCall.ts";

const fixtures = [
  ["AGIG", "source-agig-form4-purchase.json", "6a40bf3fdfcc1b92c0cefe0f955102f04ccf9049e1e63876bd0d5589e4243b26"],
  ["UWMC", "source-uwmc-form4-multi-owner-10b5-1-conversion.json", "3c21caf84afb076fdc0de374a7b98130ee27fc9c2d25265b12ecea975ef66036"],
  ["AMCOR", "source-amcor-form144-no-prior-sales.json", "6e3939139a5fac17cdd10523f6a0a1cbffea09e05683dd08f83736c756259541"],
] as const;

test("product one-call request is byte-identical to the frozen three-case experiment", () => {
  assert.equal(OWNERSHIP_ONE_CALL_MODEL, "gemini-3.5-flash");
  for (const [name, filename, expectedHash] of fixtures) {
    const fixture = JSON.parse(readFileSync(join(process.cwd(), "lib/sources/sec/forms/ownership/fixtures", filename), "utf8"));
    const xml = String(fixture.filingText);
    const issuerCik = xmlValue(xml, "issuerCik");
    const ticker = xmlValue(xml, "issuerTradingSymbol");
    const rawItem = {
      id: "33333333-3333-4333-8333-333333333333",
      source_code: "sec_edgar",
      source_unique_id: fixture.accessionNumber,
      source_url: fixture.source.url,
      raw_payload: {
        form_type: fixture.formType,
        accession_number: fixture.accessionNumber,
        cik: issuerCik,
        ownership_issuer_cik: issuerCik,
        ticker,
        ownership_issuer_trading_symbol: ticker,
        ownership_source_text: xml,
        ownership_source_url: fixture.source.url,
        ownership_source_format: "ownership_xml",
        ownership_source_text_truncated: false,
      },
    };
    const input = buildInputFromSecRawRow(rawItem);
    const request = buildOwnershipOneCallPrompt(input, rawItem);
    assert.equal(sha256(request.prompt.system + request.prompt.user), expectedHash, name);
    assert.deepEqual(Object.keys(request.prompt.responseFormat.json_schema.properties).sort(), ["primary", "structured"]);
    assert.equal(Object.hasOwn(request.primarySchema.properties, "parser_output"), false);
    assert.equal(validateOwnershipOneCallOutput({ primary: {}, structured: {} }, request).primary, null);
    assert.equal(validateOwnershipOneCallOutput({ primary: {}, structured: {}, extra: true }, request).structured, null);
  }
});

test("an invalid Structured branch does not discard a valid Primary branch", () => {
  const schemas = {
    primarySchema: {
      type: "object", additionalProperties: false, required: ["value"],
      properties: { value: { type: "string" } },
    },
    structuredSchema: {
      type: "object", additionalProperties: false, required: ["rows"],
      properties: { rows: { type: "array" } },
    },
  } as unknown as Pick<ReturnType<typeof buildOwnershipOneCallPrompt>, "primarySchema" | "structuredSchema">;
  const result = validateOwnershipOneCallOutput({ primary: { value: "source-backed" }, structured: { rows: "invalid" } }, schemas);
  assert.deepEqual(result.primary, { value: "source-backed" });
  assert.equal(result.structured, null);
  assert.ok(result.errors.some((error) => error.startsWith("structured ")));
});

function xmlValue(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return xml.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
