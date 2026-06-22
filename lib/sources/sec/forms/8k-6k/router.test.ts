import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSec8k6kFiling } from "./parser";
import {
  buildSec8k6kRouterPromptDraft,
  SEC_8K_6K_ROUTER_ACTION_VALUES,
  SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
  sec8k6kRouterResponseSchema,
  sec8k6kRouterSystemPrompt,
} from "./routerPrompt";
import { SEC_8K_6K_APPROVED_EVENT_TYPES, type Sec8k6kParseInput } from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k");
const fixture = readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "dilution-risk-8k.json"));
const parsed = parseSec8k6kFiling(fixture);

const prompt = buildSec8k6kRouterPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText?.slice(0, 1_000) || null,
});

assert.equal(prompt.key, SEC_8K_6K_ROUTER_PROMPT_KEY);
assert.equal(prompt.version, SEC_8K_6K_ROUTER_PROMPT_VERSION);
assert.equal(prompt.responseFormat.json_schema.name, "sec_8k_6k_router");
assert.equal(prompt.responseFormat.json_schema.strict, true);
assert.deepEqual(sec8k6kRouterResponseSchema.properties.event_type.enum, SEC_8K_6K_APPROVED_EVENT_TYPES);
assert.deepEqual(sec8k6kRouterResponseSchema.properties.delivery_level.enum, SEC_8K_6K_ROUTER_ACTION_VALUES);
assert.deepEqual(sec8k6kRouterResponseSchema.properties.display_version.enum, SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES);
assert.deepEqual(sec8k6kRouterResponseSchema.properties.debug.properties.router_prompt_key.enum, [
  SEC_8K_6K_ROUTER_PROMPT_KEY,
]);
assert.deepEqual(sec8k6kRouterResponseSchema.properties.debug.properties.router_prompt_version.enum, [
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
]);
assert.ok(sec8k6kRouterResponseSchema.properties.display_type.enum.includes("spac_transaction_status"));
assert.ok(sec8k6kRouterResponseSchema.properties.display_version.enum.includes("sec_8k_6k_spac_transaction_status_v1"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("display_version"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("ipo_kind"));
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(sec8k6kRouterSystemPrompt.includes("You are the SEC 8-K / 6-K router"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use only cleaned_source_blocks"));
assert.ok(sec8k6kRouterSystemPrompt.includes("source coverage may be incomplete"));
assert.ok(sec8k6kRouterSystemPrompt.includes("For 8-K and 8-K/A, use Item numbers"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Choose display_type from the approved list only"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Choose exactly one approved event_type"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Primary-event rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use the document hierarchy"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Event semantics rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("choose the economic substance"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Dominance rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("share issuance is evidence"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Other rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("administrative, referential, corrective, housekeeping"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not use other merely because the filing seems low impact"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not classify a filing as other merely because it relates to a previously announced event"));
assert.ok(sec8k6kRouterSystemPrompt.includes("new source-backed status change"));
assert.ok(sec8k6kRouterSystemPrompt.includes("total voting rights, block listing return"));
assert.ok(sec8k6kRouterSystemPrompt.includes("employee plan share issuance without financing terms"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Mechanical share count or denominator updates are not dilution_risk"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Insider ownership boundary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Share count, total voting rights, block listing"));
assert.ok(sec8k6kRouterSystemPrompt.includes("what changed in this filing"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Clinical rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Pipeline descriptions"));
assert.ok(sec8k6kRouterSystemPrompt.includes("IPO/SPAC rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Amendment rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("needs_parent_context true"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Router score is only an archive gate"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not use router delivery_level alert"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Archive only when source blocks clearly show routine administration"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use spac_transaction_status only when source blocks show enough"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not use it for a plain blank-check IPO"));
assert.ok(sec8k6kRouterSystemPrompt.includes("score 0-49"));

const userPayload = JSON.parse(prompt.user) as {
  cleaned_source_blocks: Array<{ block_type: string; text: string }>;
};

assert.ok(Array.isArray(userPayload.cleaned_source_blocks));
assert.ok(userPayload.cleaned_source_blocks.some((block) => block.text.includes("registered direct offering")));
assert.equal("filing_package" in (userPayload as unknown as Record<string, unknown>), false);
assert.equal("parser_output" in (userPayload as unknown as Record<string, unknown>), false);
assert.equal(JSON.stringify(userPayload).includes("\"facts\""), false);
assert.equal(prompt.user.includes("\"bodyText\""), false);
assert.equal(prompt.user.includes("\"analysisText\""), false);
assert.equal(prompt.user.includes("\"rawPayload\""), false);
assert.equal(prompt.user.includes("\"attachment_texts\""), false);
assert.equal(prompt.user.includes("fixture_expected"), false);

const longRawMarker = "FULL_RAW_MARKER_SHOULD_NOT_REACH_LLM";
const earningsInput: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-100001",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026100001/index.htm",
  title: "NVIDIA-like Item 2.02 earnings 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "The company furnished quarterly financial results in Exhibit 99.1.",
    "Item 9.01 Financial Statements and Exhibits",
    "99.1 Press Release",
    "99.2 CFO Commentary",
    "A".repeat(2_000),
    longRawMarker.repeat(80),
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-100001",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "8-K", isPrimary: true, textCharCount: 4_000, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "EX-99.1", filename: "q1fy27pr.htm", textCharCount: 30_000, includedInParserText: true, includedTextCharCount: 30_000, textExtractionStatus: "text_extracted" },
      { type: "GRAPHIC", description: "Logo", filename: "logo.jpg", textCharCount: 0, textExtractionStatus: "graphic_or_binary" },
    ],
    attachment_texts: [
      {
        type: "EX-99.1",
        description: "EX-99.1",
        filename: "q1fy27pr.htm",
        text: [
          "NVIDIA Announces Financial Results for First Quarter Fiscal 2027",
          "Metric | Q1 FY27 | Q4 FY26 | Q1 FY26",
          "Revenue | $81.6 billion | $44.1 billion | $26.0 billion",
          "Net income | $58.3 billion | $22.1 billion | $14.9 billion",
          "B".repeat(5_000),
          longRawMarker.repeat(80),
        ].join("\n"),
      },
    ],
  },
};
const earningsPayload = buildRouterPayload(earningsInput, `${earningsInput.bodyText}\n${longRawMarker.repeat(200)}`);
assert.ok(hasSourceBlockText(earningsPayload, "Item 2.02"));
assert.ok(hasSourceBlockText(earningsPayload, "EX-99.1"));
assert.ok(hasSourceBlockText(earningsPayload, "Revenue | $81.6 billion"));
assert.ok(hasSourceBlockText(earningsPayload, "graphic_or_binary_documents_present"));
assert.equal(JSON.stringify(earningsPayload).includes(longRawMarker), false);

const integrationStyleEarningsInput: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-100007",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026100007/index.htm",
  title: "ANF-like Item 2.02 earnings 8-K",
  bodyText: [
    "FORM 8-K",
    "Current report boilerplate ".repeat(180),
    "Item 2.02 Results of Operations and Financial Condition.",
    "The company issued a news release reporting unaudited financial results for the first quarter ended May 2, 2026.",
    "A copy of the Release is included as Exhibit 99.1.",
    "Item 9.01 Financial Statements and Exhibits.",
    "99.1 News release",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-100007",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "8-K", isPrimary: true, textCharCount: 4_000, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "EX-99.1", filename: "q1-earnings.htm", textCharCount: 29_000, textExtractionStatus: "text_extracted" },
    ],
  },
};
const integrationStyleParsed = parseSec8k6kFiling(integrationStyleEarningsInput);
const integrationStylePrompt = buildSec8k6kRouterPromptDraft({
  filing_package: {
    accession_number: "0000000000-26-100007",
    form_type: "8-K",
    company_name: "ANF-like Co.",
    primary_ticker: { ticker: "ANF" },
    llm_text: [
      "### Primary Filing Text",
      "FORM 8-K",
      "Current report boilerplate ".repeat(220),
      "### EX-99.1 - EX-99.1",
      "ANF-like Co. REPORTS FIRST QUARTER FISCAL 2026 RESULTS",
      "Record first quarter net sales of $1.1 billion, up 2% from last year.",
      "Revenue | $1.1 billion | $1.0 billion",
      "EPS | $1.47 | $1.59",
    ].join("\n"),
    documents: [
      { type: "8-K", description: "8-K", text_char_count: 4_000 },
      { type: "EX-99.1", description: "EX-99.1", filename: "q1-earnings.htm", text_char_count: 29_000 },
    ],
  },
  parser_output: integrationStyleParsed as unknown as Record<string, unknown>,
  filing_excerpt: [
    "### Primary Filing Text",
    "FORM 8-K",
    "Current report boilerplate ".repeat(220),
    "### EX-99.1 - EX-99.1",
    "ANF-like Co. REPORTS FIRST QUARTER FISCAL 2026 RESULTS",
    "Record first quarter net sales of $1.1 billion, up 2% from last year.",
    "Revenue | $1.1 billion | $1.0 billion",
    "EPS | $1.47 | $1.59",
  ].join("\n"),
});
const integrationStylePayload = JSON.parse(integrationStylePrompt.user) as Record<string, any>;
assert.ok(hasSourceBlockText(integrationStylePayload, "Item 2.02"));
assert.ok(hasSourceBlockText(integrationStylePayload, "REPORTS FIRST QUARTER FISCAL 2026 RESULTS"));
assert.ok(hasSourceBlockText(integrationStylePayload, "Revenue | $1.1 billion"));
assert.ok(sourceBlockTypes(integrationStylePayload).includes("item_section"));
assert.ok(sourceBlockTypes(integrationStylePayload).includes("source_document_section"));

const agreementInput: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-100002",
  title: "AgreementCo 8-K agreement",
  bodyText: [
    "Item 1.01 Entry into a Material Definitive Agreement",
    "AgreementCo entered into a new credit agreement filed as Exhibit 10.1.",
    "Item 9.01 Financial Statements and Exhibits",
    "10.1 Credit Agreement",
  ].join("\n"),
  rawPayload: {
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "8-K", isPrimary: true, textCharCount: 1_000 },
      { type: "EX-10.1", description: "Credit Agreement", filename: "ex10-1.htm", textCharCount: 8_000, includedInParserText: true },
    ],
    attachment_texts: [{ type: "EX-10.1", description: "Credit Agreement", text: "Credit Agreement among AgreementCo and lenders." }],
  },
};
const agreementPayload = buildRouterPayload(agreementInput);
assert.ok(hasSourceBlockText(agreementPayload, "Item 1.01"));
assert.ok(hasSourceBlockText(agreementPayload, "EX-10.1"));
assert.equal("parser_output" in agreementPayload, false);

const sixKWrapperInput: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-100003",
  title: "ForeignCo 6-K press release",
  bodyText: "FORM 6-K\nReport of Foreign Private Issuer\nThe information attached as Exhibit 99.1 is furnished herewith.",
  rawPayload: {
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "6-K", isPrimary: true, textCharCount: 220 },
      { type: "EX-99.1", description: "Press Release", filename: "ex991.htm", textCharCount: 3_000, includedInParserText: true },
    ],
    attachment_texts: [{ type: "EX-99.1", description: "Press Release", text: "ForeignCo announced a new commercial agreement with a utility customer." }],
  },
};
const sixKWrapperPayload = buildRouterPayload(sixKWrapperInput);
assert.ok(hasSourceBlockText(sixKWrapperPayload, "EX-99.1"));
assert.ok(hasSourceBlockText(sixKWrapperPayload, "commercial agreement"));
assert.ok(hasSourceBlockText(sixKWrapperPayload, "Report of Foreign Private Issuer"));

const sixKMultiplePayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100004",
  title: "ForeignCo 6-K multiple exhibits",
  bodyText: "FORM 6-K\nReport of Foreign Private Issuer\nAttached hereto as Exhibits 99.1 and 99.2.",
  rawPayload: {
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "6-K", isPrimary: true, textCharCount: 180 },
      { type: "EX-99.1", description: "Press Release", filename: "ex991.htm", textCharCount: 2_000, includedInParserText: true },
      { type: "EX-99.2", description: "Investor Presentation", filename: "ex992.htm", textCharCount: 2_500, includedInParserText: true },
    ],
    attachment_texts: [
      { type: "EX-99.1", description: "Press Release", text: "ForeignCo reported revenue of $20 million for the quarter." },
      { type: "EX-99.2", description: "Investor Presentation", text: "Investor presentation with business update and operating metrics." },
    ],
  },
});
assert.ok(hasSourceBlockText(sixKMultiplePayload, "EX-99.1"));
assert.ok(hasSourceBlockText(sixKMultiplePayload, "EX-99.2"));

const sixKPrimaryOnlyPayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100005",
  title: "ForeignCo 6-K primary-only update",
  bodyText: "FORM 6-K\nForeignCo announced revenue of $12 million and net income of $2 million for the quarter.",
  rawPayload: {
    form_type: "6-K",
    documents: [{ type: "6-K", description: "6-K", isPrimary: true, textCharCount: 500 }],
  },
});
assert.ok(hasSourceBlockText(sixKPrimaryOnlyPayload, "revenue of $12 million"));

const sixKBinaryPayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100006",
  title: "ForeignCo 6-K binary exhibit",
  bodyText: "FORM 6-K\nReport of Foreign Private Issuer\nA material update is attached as Exhibit 99.1.",
  rawPayload: {
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "6-K", isPrimary: true, textCharCount: 180 },
      { type: "EX-99.1", description: "Material PDF", filename: "update.pdf", textCharCount: 0, textExtractionStatus: "graphic_or_binary" },
    ],
  },
});
assert.ok(hasSourceBlockText(sixKBinaryPayload, "six_k_meaningful_exhibit_non_text"));
assert.ok(hasSourceBlockText(sixKBinaryPayload, "EX-99.1"));

console.log("sec 8k-6k router prompt fixture checks passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildRouterPayload(input: Sec8k6kParseInput, filingExcerpt = input.bodyText || null) {
  const parsedInput = parseSec8k6kFiling(input);
  const routerPrompt = buildSec8k6kRouterPromptDraft({
    filing_package: input as Record<string, unknown>,
    parser_output: parsedInput as unknown as Record<string, unknown>,
    filing_excerpt: filingExcerpt,
  });
  return JSON.parse(routerPrompt.user) as Record<string, any>;
}

function hasSourceBlockText(payload: Record<string, any>, text: string): boolean {
  return sourceBlockText(payload).includes(text);
}

function sourceBlockText(payload: Record<string, any>): string {
  const blocks = Array.isArray(payload.cleaned_source_blocks) ? payload.cleaned_source_blocks : [];
  return blocks.map((block: Record<string, unknown>) => String(block.text || "")).join("\n");
}

function sourceBlockTypes(payload: Record<string, any>): string[] {
  const blocks = Array.isArray(payload.cleaned_source_blocks) ? payload.cleaned_source_blocks : [];
  return blocks.map((block: Record<string, unknown>) => String(block.block_type || "")).filter(Boolean);
}
