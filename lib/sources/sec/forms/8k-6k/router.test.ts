import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applySec8k6kArchiveSafetyGate,
  applySec8k6kReverseSplitRouteGuard,
  buildSec8k6kArchiveAnalysis,
  buildSec8k6kPreviewDebug,
  normalizeSec8k6kRouterResult,
} from "../../../../ai/sec8k6kAnalysisAdapter";
import type { SecFilingAnalysisInput } from "../../../../prompts/secFilingAnalysis";
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
import { buildSecSourceBlockPromptInput } from "./sourceBlockPromptInput";
import { SEC_8K_6K_APPROVED_EVENT_TYPES, type Sec8k6kParseInput } from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k");
const fixture = readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "dilution-risk-8k.json"));
const parsed = parseSec8k6kFiling(fixture);

const introductoryNoteFixture: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-000002",
  title: "8-K - Merger Closing",
  bodyText: [
    "FORM 8-K",
    "Introductory Note",
    "The purchaser offered $57.00 per share in cash.",
    "Approximately 92.8% of the outstanding shares were tendered.",
    "Item 2.01 Completion of Acquisition or Disposition of Assets.",
    "The information in the Introductory Note is incorporated by reference.",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000002", form_type: "8-K" },
};
const introductoryNoteParsed = parseSec8k6kFiling(introductoryNoteFixture);
const introductoryNoteSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: introductoryNoteFixture as Record<string, unknown>,
  parserOutput: introductoryNoteParsed as unknown as Record<string, unknown>,
  fallbackText: introductoryNoteFixture.bodyText,
});
const introductoryNoteBlock = introductoryNoteSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "unnumbered_section" && block.label === "Introductory Note",
);
assert.ok(introductoryNoteBlock);
assert.equal(introductoryNoteBlock.origin, "parser.unnumbered_section");
assert.match(introductoryNoteBlock.text, /\$57\.00 per share/);
assert.match(introductoryNoteBlock.text, /92\.8%/);

const relatedContextSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: introductoryNoteFixture as Record<string, unknown>,
  parserOutput: introductoryNoteParsed as unknown as Record<string, unknown>,
  fallbackText: introductoryNoteFixture.bodyText,
  relatedFilingContexts: [
    {
      context_kind: "explicitly_referenced_analyzed_filing",
      accession_number: "0001104659-24-132544",
      form_type: "DEF 14A",
      filed_at: "2024-12-30",
      summary: "The proxy disclosed 643,039 Series C Warrants and 643,039 Series D Warrants.",
      score: 80,
      event_type: "dilution_risk",
      source_blocks: [
        {
          block_type: "proxy_source_block",
          label: "Proposal One warrant approval",
          text: "Stockholders approved the issuance of up to 16,203,804 shares underlying the Series C and Series D Warrants.",
          origin: "linked_filing.proxy_parser",
        },
      ],
    },
  ],
});
const relatedContextBlock = relatedContextSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "related_filing_context",
);
assert.ok(relatedContextBlock);
assert.equal(relatedContextBlock.origin, "integration.related_filing_context");
assert.equal(relatedContextBlock.source_ref, "DEF 14A 0001104659-24-132544");
assert.match(relatedContextBlock.text, /643,039 Series C Warrants/);
assert.doesNotMatch(relatedContextBlock.text, /dilution_risk/);
assert.doesNotMatch(relatedContextBlock.text, /"score"/);
assert.doesNotMatch(relatedContextBlock.text, /source_blocks/);
const relatedSourceBlock = relatedContextSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "related_filing_source_block",
);
assert.ok(relatedSourceBlock);
assert.equal(relatedSourceBlock.origin, "linked_filing.proxy_parser");
assert.equal(relatedSourceBlock.source_ref, "DEF 14A 0001104659-24-132544");
assert.match(relatedSourceBlock.text, /16,203,804 shares/);

const amendmentParentSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: introductoryNoteFixture as Record<string, unknown>,
  parserOutput: introductoryNoteParsed as unknown as Record<string, unknown>,
  fallbackText: introductoryNoteFixture.bodyText,
  parentFilingContext: {
    context_kind: "current_report_parent_filing",
    accession_number: "0001104659-24-100001",
    form_type: "8-K",
    filed_at: "2024-11-01",
    summary: "The original report announced a warrant amendment.",
    selected_source_snippets: ["Historical raw text must not enter the first analysis."],
    source_blocks: [
      {
        block_type: "item_section",
        label: "Item 1.01",
        item_number: "1.01",
        text: "The original agreement set the warrant exercise price at $5.00 per share.",
      },
    ],
  },
});
const amendmentParentContextBlock = amendmentParentSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "parent_filing_context",
);
assert.ok(amendmentParentContextBlock);
assert.doesNotMatch(amendmentParentContextBlock.text, /source_blocks/);
assert.doesNotMatch(amendmentParentContextBlock.text, /Historical raw text/);
const amendmentParentSourceBlock = amendmentParentSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "parent_filing_source_block",
);
assert.ok(amendmentParentSourceBlock);
assert.equal(amendmentParentSourceBlock.source_ref, "8-K 0001104659-24-100001");
assert.equal(amendmentParentSourceBlock.item_number, "1.01");
assert.match(amendmentParentSourceBlock.text, /exercise price at \$5\.00/);

const amendmentFirstPassSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: introductoryNoteFixture as Record<string, unknown>,
  parserOutput: introductoryNoteParsed as unknown as Record<string, unknown>,
  fallbackText: introductoryNoteFixture.bodyText,
  parentFilingContext: {
    context_kind: "current_report_parent_filing",
    accession_number: "0001104659-24-100001",
    form_type: "8-K",
    summary: "The original report announced a warrant amendment.",
    source_blocks: [
      {
        block_type: "item_section",
        label: "Item 1.01",
        item_number: "1.01",
        text: "The original agreement set the warrant exercise price at $5.00 per share.",
      },
    ],
  },
  includeAmendmentHistoricalSourceBlocks: false,
});
assert.ok(amendmentFirstPassSourceInput.cleaned_source_blocks.some(
  (block) => block.block_type === "parent_filing_context" && /original report announced/.test(block.text),
));
assert.equal(
  amendmentFirstPassSourceInput.cleaned_source_blocks.some(
    (block) => block.block_type === "parent_filing_source_block",
  ),
  false,
);

const longSectionText = Array.from(
  { length: 54 },
  (_, index) => `Amendment paragraph ${index + 1}. The company describes the preferred stock terms and related holder rights in this original paragraph.`,
).join("\n\n");
const longSectionFixture: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-000003",
  title: "8-K - Long capital terms",
  bodyText: [
    "FORM 8-K",
    "Item 5.03 Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year.",
    longSectionText,
    "The Series B conversion price equals 85% of the lowest ten-day VWAP, subject to a 75% triggering-event adjustment.",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000003",
    form_type: "8-K",
    attachment_texts: [
      {
        type: "EX-4.2",
        filename: "long-warrant.htm",
        text: `${Array.from(
          { length: 90 },
          (_, index) => `Warrant paragraph ${index + 1}. This paragraph preserves the original agreement context and defined terms.`,
        ).join("\n\n")}\n\nThe warrant permits cashless exercise, has four exercise-price tiers, and expires seven years after issuance.`,
      },
    ],
  },
};
const longSectionParsed = parseSec8k6kFiling(longSectionFixture);
const longSectionSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: longSectionFixture as Record<string, unknown>,
  parserOutput: longSectionParsed as unknown as Record<string, unknown>,
  fallbackText: longSectionFixture.bodyText,
  maxBlockChars: 6_000,
});
const longItemBlocks = longSectionSourceInput.cleaned_source_blocks.filter((block) => block.item_number === "5.03");
const longExhibitBlocks = longSectionSourceInput.cleaned_source_blocks.filter(
  (block) => block.block_type === "attachment_source_block" && block.exhibit_number === "4.2",
);
assert.ok(longItemBlocks.length >= 2);
assert.ok(longExhibitBlocks.length >= 2);
assert.ok(longItemBlocks.every((block) => block.text.length <= 6_000));
assert.ok(longExhibitBlocks.every((block) => block.text.length <= 6_000));
assert.ok(longItemBlocks.some((block) => block.text.includes("85% of the lowest ten-day VWAP")));
assert.ok(longExhibitBlocks.some((block) => block.text.includes("cashless exercise")));
assert.deepEqual(
  longItemBlocks.map((block) => block.chunk_index),
  [...longItemBlocks].sort((left, right) => Number(left.chunk_index) - Number(right.chunk_index)).map((block) => block.chunk_index),
);
const rebuiltLongSectionSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: longSectionFixture as Record<string, unknown>,
  parserOutput: longSectionParsed as unknown as Record<string, unknown>,
  fallbackText: longSectionFixture.bodyText,
  maxBlockChars: 6_000,
});
assert.deepEqual(
  rebuiltLongSectionSourceInput.source_block_manifest.map((block) => block.block_id),
  longSectionSourceInput.source_block_manifest.map((block) => block.block_id),
);
const uncappedLongSectionSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: longSectionFixture as Record<string, unknown>,
  parserOutput: longSectionParsed as unknown as Record<string, unknown>,
  fallbackText: longSectionFixture.bodyText,
  maxBlockChars: 600,
});
assert.ok(
  uncappedLongSectionSourceInput.cleaned_source_blocks.filter(
    (block) => block.block_type === "attachment_source_block" && block.exhibit_number === "4.2",
  ).length > 12,
  "long current-filing exhibits must not be silently reduced to 12 representative chunks",
);
assert.equal(
  uncappedLongSectionSourceInput.cleaned_source_blocks.some((block) =>
    ["source_inventory", "attachment_inventory", "document_inventory", "parser_warnings"].includes(block.block_type),
  ),
  false,
);

const auditorChangeFixture: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-000004",
  title: "8-K - Change in certifying accountant",
  bodyText: [
    "FORM 8-K",
    "Item 4.01 Changes in Registrant's Certifying Accountant.",
    "The audit committee dismissed the former independent registered public accounting firm.",
    "Item 9.01 Financial Statements and Exhibits.",
    "Exhibit 16.1 Letter from the former auditor.",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000004",
    form_type: "8-K",
    attachment_texts: [
      {
        type: "EX-16.1",
        description: "Former auditor letter",
        filename: "exhibit-16.htm",
        text: "We have read the statements made under Item 4.01 and agree with the statements concerning our firm.",
      },
    ],
  },
};
const auditorChangeParsed = parseSec8k6kFiling(auditorChangeFixture);
const auditorChangeSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: auditorChangeFixture as Record<string, unknown>,
  parserOutput: auditorChangeParsed as unknown as Record<string, unknown>,
  fallbackText: auditorChangeFixture.bodyText,
});
const auditorLetterBlock = auditorChangeSourceInput.cleaned_source_blocks.find(
  (block) => block.block_type === "attachment_source_block" && block.exhibit_number === "16.1",
);
assert.ok(auditorLetterBlock);
assert.equal(auditorLetterBlock.document_type, "EX-16.1");
assert.equal(auditorLetterBlock.priority, 88);
assert.match(auditorLetterBlock.text, /agree with the statements concerning our firm/i);

const workforceRestructuringFixture: Sec8k6kParseInput = {
  sourceUniqueId: "0001327811-25-000030",
  title: "Workday Announces Workforce Reduction and Restructuring Plan",
  bodyText: [
    "FORM 8-K",
    "Item 2.05 Costs Associated with Exit or Disposal Activities.",
    "The company announced a restructuring plan intended to prioritize investments and durable growth.",
    "The plan will eliminate approximately 1,750 positions, or 8.5% of the current workforce, and exit certain office space.",
    "The company expects $230 million to $270 million in charges, including severance and non-cash impairment charges.",
    "Item 2.06 Material Impairments.",
    "The office-space impairment charges described in Item 2.05 are incorporated by reference.",
    "Item 7.01 Regulation FD Disclosure.",
    "A note from the chief executive officer to employees regarding these actions is attached as Exhibit 99.1.",
  ].join("\n"),
  rawPayload: { accession_number: "0001327811-25-000030", form_type: "8-K" },
};
const workforceRestructuringParsed = parseSec8k6kFiling(workforceRestructuringFixture);
const workforceRestructuringSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: workforceRestructuringFixture as Record<string, unknown>,
  parserOutput: workforceRestructuringParsed as unknown as Record<string, unknown>,
  fallbackText: workforceRestructuringFixture.bodyText,
});
const workforceItem205 = workforceRestructuringSourceInput.cleaned_source_blocks.find((block) => block.item_number === "2.05");
const workforceItem206 = workforceRestructuringSourceInput.cleaned_source_blocks.find((block) => block.item_number === "2.06");
assert.ok(workforceItem205);
assert.ok(workforceItem206);
assert.match(workforceItem205.text, /1,750 positions/);
assert.match(workforceItem205.text, /\$230 million to \$270 million/);
assert.match(workforceItem206.text, /impairment charges/i);

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
assert.equal(sec8k6kRouterResponseSchema.required.includes("debug"), false);
assert.equal("debug" in sec8k6kRouterResponseSchema.properties, false);
assert.ok(sec8k6kRouterResponseSchema.properties.display_type.enum.includes("spac_transaction_status"));
assert.ok(sec8k6kRouterResponseSchema.properties.display_version.enum.includes("sec_8k_6k_spac_transaction_status_v1"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("display_version"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("ipo_kind"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("primary_route_candidate"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("route_candidates"));
assert.equal(sec8k6kRouterResponseSchema.required.includes("selected_source_block_ids"), false);
assert.equal("selected_source_block_ids" in sec8k6kRouterResponseSchema.properties, false);
assert.equal("selected_source_blocks_by_route" in sec8k6kRouterResponseSchema.properties, false);
assert.equal("source_blocks_used" in sec8k6kRouterResponseSchema.properties, false);
assert.ok(sec8k6kRouterResponseSchema.required.includes("filing_complexity"));
assert.ok(sec8k6kRouterResponseSchema.required.includes("archive_like_candidate"));
assert.equal("selected_source_block_ids" in sec8k6kRouterResponseSchema.properties.primary_route_candidate.properties, false);
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("operating_update"));
assert.ok(sec8k6kRouterSystemPrompt.includes("You are the SEC 8-K / 6-K route planner"));
assert.equal(sec8k6kRouterSystemPrompt.includes("not to write the final investment analysis"), false);
assert.ok(sec8k6kRouterSystemPrompt.includes("Use source-backed judgment to identify the strongest downstream analysis route"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use only current_filing and router_digest"));
assert.ok(sec8k6kRouterSystemPrompt.includes("source coverage may be incomplete"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Security-class removal boundary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("notes, preferred shares, warrants, units"));
assert.ok(sec8k6kRouterSystemPrompt.includes("For 8-K and 8-K/A, use the digest's Item numbers"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Choose display_type from the approved list only"));
assert.ok(sec8k6kRouterSystemPrompt.includes("primary_route_candidate"));
assert.ok(sec8k6kRouterSystemPrompt.includes("does not choose or filter the original source blocks"));
assert.ok(sec8k6kRouterSystemPrompt.includes("available Exhibit 16 or 16.1 auditor/accountant letters"));
assert.ok(sec8k6kRouterSystemPrompt.includes("when the digest identifies a letter"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Primary-route rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use the document hierarchy"));
assert.ok(sec8k6kRouterSystemPrompt.includes("excludes extracted dates, amounts, share counts"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Event semantics rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("choose the economic substance"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Operating-performance boundary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("A technical report or project-economics exhibit does not make product_update primary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Leadership boundary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("A workforce reduction"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Operating-versus-distress boundary"));
assert.ok(sec8k6kRouterSystemPrompt.includes("The word restructuring alone does not establish financial_risk"));
assert.ok(sec8k6kRouterSystemPrompt.includes("For Item 2.05 exit or disposal activities"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Dominance rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("share issuance is evidence"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Other rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("administrative, referential, corrective, housekeeping"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not use other merely because the filing seems low impact"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not classify a filing as other merely because it relates to a previously announced event"));
assert.ok(sec8k6kRouterSystemPrompt.includes("new source-backed status change"));
assert.ok(sec8k6kRouterSystemPrompt.includes("total voting rights, block listing return"));
assert.ok(sec8k6kRouterSystemPrompt.includes("employee plan share issuance without financing terms"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Independent-event rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("not a term, use of proceeds, condition, rationale, background fact, or consequence"));
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
assert.ok(sec8k6kRouterSystemPrompt.includes("Archive only when all of these are true"));
assert.ok(sec8k6kRouterSystemPrompt.includes("If uncertain, route to analysis"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Use spac_transaction_status only when the compact digest shows enough"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Do not use it for a plain blank-check IPO"));
assert.ok(sec8k6kRouterSystemPrompt.includes("score 0-49"));

const userPayload = JSON.parse(prompt.user) as {
  router_digest: {
    items: Array<{ item_number: string; title: string | null; summary: string; context_snippets: string[] }>;
    documents: Array<{ headline_or_summary: string }>;
    tables: Array<{ heading: string }>;
  };
};

assert.equal("cleaned_source_blocks" in (userPayload as unknown as Record<string, unknown>), false);
assert.ok(Array.isArray(userPayload.router_digest.items));
assert.ok(userPayload.router_digest.items.every((item) => item.context_snippets.length <= 2));
assert.ok(JSON.stringify(userPayload.router_digest).includes("registered direct offering"));
assert.equal("filing_package" in (userPayload as unknown as Record<string, unknown>), false);
assert.equal("parser_output" in (userPayload as unknown as Record<string, unknown>), false);
assert.equal(JSON.stringify(userPayload).includes("\"facts\""), false);
assert.equal(prompt.user.includes("\"bodyText\""), false);
assert.equal(prompt.user.includes("\"analysisText\""), false);
assert.equal(prompt.user.includes("\"rawPayload\""), false);
assert.equal(prompt.user.includes("\"attachment_texts\""), false);
assert.equal(prompt.user.includes("fixture_expected"), false);

const normalizedRouterResult = normalizeSec8k6kRouterResult({
  source_group: "filings",
  source_form_scope: "8-K / 6-K, 8-K/A / 6-K/A",
  event_type: "listing_risk",
  route_case: "listing_risk",
  score: 50,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  ipo_kind: null,
  analysis_needed: true,
  filing_complexity: "moderate",
  primary_route_candidate: {
    route_type: "listing_risk",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: ["secblk_item_section_301"],
    reason: "Item 3.01 exchange notice.",
  },
  route_candidates: [
    {
      route_type: "listing_risk",
      priority: "primary",
      confidence: "high",
      selected_source_block_ids: ["secblk_item_section_301"],
      reason: "Item 3.01 exchange notice.",
    },
    {
      route_type: "strategic_transaction",
      priority: "context",
      confidence: "low",
      selected_source_block_ids: ["secblk_attachment_headline_991"],
      reason: "Transaction context appears in exhibit headline.",
    },
  ],
  selected_source_block_ids: ["secblk_item_section_301"],
  selected_source_blocks_by_route: [],
  needs_parent_context: true,
  confidence: "high",
  routing_reason: "Needs full analysis.",
  archive_like_candidate: false,
  deterministic_possible: false,
  low_signal_reason: null,
  evidence: ["Item 3.01 exchange notice."],
  source_blocks_used: [],
  market_context_needed: true,
  market_context_reason: "Trading/listing status can affect current holders.",
  market_context_fields: ["price", "exchange", "market_cap"],
  debug: {
    parser_version: null,
    router_prompt_key: SEC_8K_6K_ROUTER_PROMPT_KEY,
    router_prompt_version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
  },
});
assert.equal(normalizedRouterResult.analysis_needed, true);
assert.equal(normalizedRouterResult.delivery_level, "feed");
assert.equal("selected_source_block_ids" in normalizedRouterResult, false);
assert.equal("source_blocks_used" in normalizedRouterResult, false);
assert.equal(normalizedRouterResult.parent_context_needed, true);

const unsafeArchiveRouterResult = normalizeSec8k6kRouterResult({
  event_type: "listing_risk",
  route_case: "listing_risk",
  score: 10,
  delivery_level: "archive",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: false,
  filing_complexity: "simple",
  primary_route_candidate: {
    route_type: "listing_risk",
    priority: "primary",
    confidence: "medium",
    selected_source_block_ids: ["secblk_item_section_301"],
    reason: "Potential listing issue.",
  },
  route_candidates: [
    {
      route_type: "listing_risk",
      priority: "primary",
      confidence: "medium",
      selected_source_block_ids: ["secblk_item_section_301"],
      reason: "Potential listing issue.",
    },
  ],
  selected_source_block_ids: ["secblk_item_section_301"],
  archive_like_candidate: false,
  deterministic_possible: false,
  needs_parent_context: false,
  market_context_needed: false,
});
assert.equal(unsafeArchiveRouterResult.analysis_needed, true);
assert.equal(unsafeArchiveRouterResult.score, 50);

const archiveSafetyInput = {
  filing_package: {
    company_name: "Archive Safety Corp.",
    form_type: "6-K",
    hard_parsers: {
      "8k-6k": {
        isSupported: true,
        warnings: ["exhibit_reference_document_match_failed"],
        facts: {
          companyName: "Archive Safety Corp.",
          secFormType: "6-K",
        },
      },
    },
  },
} as unknown as SecFilingAnalysisInput;
const safeArchiveRouterResult = normalizeSec8k6kRouterResult({
  event_type: "other",
  route_case: "other",
  score: 0,
  delivery_level: "archive",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: false,
  filing_complexity: "simple",
  route_candidates: [],
  archive_like_candidate: true,
  deterministic_possible: true,
  needs_parent_context: false,
  market_context_needed: false,
  evidence: ["Routine filing reference."],
});
const sourceIncompleteRouterResult = applySec8k6kArchiveSafetyGate(safeArchiveRouterResult, archiveSafetyInput);
assert.equal(sourceIncompleteRouterResult.analysis_needed, true);
assert.equal(sourceIncompleteRouterResult.delivery_level, "feed");
assert.equal(sourceIncompleteRouterResult.archive_safety_blocked, true);

const substantiveCueArchiveInput = {
  filing_package: {
    company_name: "Substantive Foreign Issuer",
    form_type: "6-K",
    hard_parsers: {
      "8k-6k": {
        isSupported: true,
        warnings: [],
        facts: {
          filingCues: [{ cueType: "financial_results", confidence: "medium" }],
        },
      },
    },
  },
} as unknown as SecFilingAnalysisInput;
const substantiveCueArchiveResult = applySec8k6kArchiveSafetyGate(
  safeArchiveRouterResult,
  substantiveCueArchiveInput,
);
assert.equal(substantiveCueArchiveResult.analysis_needed, true);
assert.match(JSON.stringify(substantiveCueArchiveResult.archive_safety_reasons), /financial_results/);

const compactArchiveInput = {
  filing_package: {
    company_name: "Compact Archive Corp.",
    form_type: "6-K",
    hard_parsers: {
      "8k-6k": {
        isSupported: true,
        warnings: [],
        facts: {
          companyName: "Compact Archive Corp.",
          secFormType: "6-K",
        },
      },
    },
  },
} as unknown as SecFilingAnalysisInput;
const compactArchiveAnalysis = buildSec8k6kArchiveAnalysis(compactArchiveInput, safeArchiveRouterResult);
assert.equal(compactArchiveAnalysis.ok, true);
if (compactArchiveAnalysis.ok) {
  assert.equal(compactArchiveAnalysis.analysis.analysis_runtime_source, "router_archive");
  assert.equal(compactArchiveAnalysis.analysis.why_it_matters, "");
  assert.deepEqual(compactArchiveAnalysis.analysis.key_evidence, []);
  assert.equal(
    compactArchiveAnalysis.analysis.archive_summary,
    "Compact Archive Corp. filed a 6-K current report. The original filing and attachments are available below for review.",
  );
}

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
assert.equal("cleaned_source_blocks" in earningsPayload, false);
assert.equal("source_block_manifest" in earningsPayload, false);
assert.equal("source_block_bundle" in earningsPayload, false);
assert.ok(earningsPayload.router_digest.items.length <= 12);
assert.ok(earningsPayload.router_digest.documents.length <= 12);
assert.ok(earningsPayload.router_digest.tables.length <= 8);
assert.ok(JSON.stringify(earningsPayload).length < 25_000);
assert.ok(hasSourceBlockText(earningsPayload, "Item 2.02"));
assert.ok(hasSourceBlockText(earningsPayload, "EX-99.1"));
assert.ok(hasSourceBlockText(earningsPayload, "Metric | Q1 FY27"));
assert.equal(hasSourceBlockText(earningsPayload, "Revenue | $81.6 billion"), false);
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
assert.equal(hasSourceBlockText(integrationStylePayload, "Revenue | $1.1 billion"), false);
assert.ok(integrationStylePayload.router_digest.items.some((item: Record<string, unknown>) => item.item_number === "2.02"));
assert.ok(integrationStylePayload.router_digest.documents.length >= 1);

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
assert.equal(sixKWrapperPayload.current_filing.form_type, "6-K");

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

const sixKSemanticHeadlinePayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100004-headline",
  title: "ForeignOperationsCo 6-K operating update",
  bodyText: "FORM 6-K\nAttached hereto as Exhibit 99.2.",
  rawPayload: {
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "6-K", isPrimary: true, textCharCount: 180 },
      { type: "EX-99.2", description: "EXHIBIT 99.2", filename: "ex992.htm", textCharCount: 2500, includedInParserText: true },
    ],
    attachment_texts: [
      {
        type: "EX-99.2",
        description: "EXHIBIT 99.2",
        text: [
          "EXHIBIT 99.2",
          "Lithium Producer Reports 2024 Production Results and 2025 Guidance",
          "Production reached 25,400 tonnes and 2025 guidance is 30,000 to 35,000 tonnes.",
        ].join("\n"),
      },
    ],
  },
});
const semanticHeadlineDocuments = sixKSemanticHeadlinePayload.router_digest.documents as Array<Record<string, unknown>>;
assert.ok(semanticHeadlineDocuments.some((document) => String(document.headline_or_summary || "").startsWith("Lithium Producer Reports 2024 Production Results and 2025 Guidance")));
assert.equal(semanticHeadlineDocuments.some((document) => document.headline_or_summary === "EXHIBIT 99.2"), false);

const sixKReverseSplitInput: Sec8k6kParseInput = {
  sourceUniqueId: "0001213900-25-124899",
  title: "Baiya International announces reverse stock split",
  bodyText: "FORM 6-K\nThe company furnished the attached press release as Exhibit 99.1.",
  rawPayload: {
    form_type: "6-K",
    company_name: "Baiya International Group Inc.",
    documents: [
      { type: "6-K", description: "6-K", isPrimary: true, textCharCount: 180 },
      { type: "EX-99.1", description: "EXHIBIT 99.1", filename: "ea0270226ex99-1_baiya.htm", textCharCount: 2600, includedInParserText: true },
    ],
    attachment_texts: [
      {
        type: "EX-99.1",
        description: "EXHIBIT 99.1",
        text: [
          "EXHIBIT 99.1",
          "Baiya International Announces 1-for-25 Reverse Stock Split",
          "The reverse stock split will become effective on December 29, 2025 to support compliance with Nasdaq's minimum bid price requirement.",
        ].join("\n"),
      },
    ],
  },
};
const sixKReverseSplitParsed = parseSec8k6kFiling(sixKReverseSplitInput);
const sixKReverseSplitPrompt = buildSec8k6kRouterPromptDraft({
  filing_package: sixKReverseSplitInput as Record<string, unknown>,
  parser_output: sixKReverseSplitParsed as unknown as Record<string, unknown>,
  filing_excerpt: sixKReverseSplitInput.bodyText,
});
const sixKReverseSplitPayload = JSON.parse(sixKReverseSplitPrompt.user) as Record<string, any>;
assert.match(JSON.stringify(sixKReverseSplitPayload.router_digest), /1-for-25 Reverse Stock Split/i);
assert.match(JSON.stringify(sixKReverseSplitPayload.router_digest), /effective on December 29, 2025/i);
const sixKReverseSplitAdapterInput = {
  filing_package: {
    ...sixKReverseSplitInput,
    form_type: "6-K",
    llm_text: sixKReverseSplitInput.bodyText,
    hard_parsers: { "8k-6k": sixKReverseSplitParsed },
  },
} as unknown as SecFilingAnalysisInput;
const guardedReverseSplitRoute = applySec8k6kReverseSplitRouteGuard(
  normalizeSec8k6kRouterResult({
    event_type: "operating_update",
    route_case: "sales_or_operating_update",
    score: 50,
    delivery_level: "feed",
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
    analysis_needed: true,
    filing_complexity: "simple",
    primary_route_candidate: {
      route_type: "operating_update",
      priority: "primary",
      confidence: "medium",
      reason: "Incorrect operating route.",
    },
    route_candidates: [],
    archive_like_candidate: false,
    deterministic_possible: false,
    needs_parent_context: false,
    market_context_needed: false,
  }),
  sixKReverseSplitAdapterInput,
  sixKReverseSplitPrompt.user,
);
assert.equal(guardedReverseSplitRoute.event_type, "dilution_risk");
assert.equal(guardedReverseSplitRoute.route_case, "dilution_or_offering");
assert.equal(guardedReverseSplitRoute.display_type, "capital_financing");
assert.equal(guardedReverseSplitRoute.analysis_needed, true);
assert.equal(guardedReverseSplitRoute.router_reverse_split_guard_applied, true);

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

const sixKBodyOnlyFdaPayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100005-fda",
  title: "Foreign issuer current report",
  bodyText: [
    "6-K - FORM 6-K",
    "UNITED STATES",
    "SECURITIES AND EXCHANGE COMMISSION",
    "Washington, D.C. 20549",
    "REPORT OF FOREIGN PRIVATE ISSUER",
    "PURSUANT TO RULE 13a-16 OR 15d-16",
    "Commission File Number 001-00000",
    "Example Pharma AG",
    "This cover-page text identifies the registrant and reporting period but does not describe the material event furnished in this report.",
    "This additional cover-page statement keeps the substantive announcement outside the first 420 characters used by the previous router digest.",
    "Example Pharma receives FDA approval for its new gene therapy",
    "The FDA approved the therapy for treatment of a rare disease and commercial launch is expected this quarter.",
  ].join("\n"),
  rawPayload: {
    form_type: "6-K",
    documents: [{ type: "6-K", description: "6-K", isPrimary: true, textCharCount: 1_200 }],
  },
});
assert.match(JSON.stringify(sixKBodyOnlyFdaPayload.router_digest), /receives FDA approval/i);
assert.doesNotMatch(JSON.stringify(sixKBodyOnlyFdaPayload.router_digest), /headline_or_summary":"6-K - FORM 6-K/i);

const sixKBodyOnlyLeadershipPayload = buildRouterPayload({
  sourceUniqueId: "0000000000-26-100005-leadership",
  title: "Foreign issuer current report",
  bodyText: [
    "FORM 6-K",
    "REPORT OF FOREIGN PRIVATE ISSUER",
    "PURSUANT TO RULE 13a-16 OR 15d-16",
    "Commission File Number 001-00001",
    "Example Industrials A/S",
    "For the month of July 2026",
    "Example Industrials appoints Jane Doe as Chief Executive Officer",
    "The board appointed Jane Doe as CEO effective August 1, 2026 as part of a management transition.",
  ].join("\n"),
  rawPayload: {
    form_type: "6-K",
    documents: [{ type: "6-K", description: "6-K", isPrimary: true, textCharCount: 900 }],
  },
});
assert.match(JSON.stringify(sixKBodyOnlyLeadershipPayload.router_digest), /appoints Jane Doe as Chief Executive Officer/i);

const sixKDirectBodyEarningsPayload = buildRouterPayload({
  sourceUniqueId: "0000353278-25-000005",
  title: "Novo Nordisk 6-K",
  bodyText: [
    "6-K - FORM 6-K",
    "Financial report for the period 1 January 2025 to 30 September 2025",
    "5 November 2025",
    "Novo Nordisk's sales increased by 12% in Danish kroner and by 15% at constant exchange rates.",
    "Sales within Diabetes and Obesity care increased by 14%.",
    "R&D: Wegovy was approved by the FDA and an acquisition was completed.",
  ].join("\n"),
  rawPayload: {
    form_type: "6-K",
    documents: [{ type: "6-K", description: "6-K", isPrimary: true, textCharCount: 1_400 }],
  },
});
const sixKEarningsOutline = sixKDirectBodyEarningsPayload.router_digest.documents.find(
  (document: Record<string, unknown>) => document.source_ref === "primary_filing",
);
assert.equal(sixKEarningsOutline?.title, "Financial report for the period 1 January 2025 to 30 September 2025");
assert.match(String(sixKEarningsOutline?.subtitle), /sales increased by 12%/i);
assert.notEqual(sixKEarningsOutline?.title, "R&D: Wegovy was approved by the FDA and an acquisition was completed.");

const sixKDirectBodyLeadershipPayload = buildRouterPayload({
  sourceUniqueId: "0001171843-25-004761",
  title: "Novo Nordisk 6-K",
  bodyText: [
    "FORM 6-K",
    "Maziar Mike Doustdar appointed as president and chief executive",
    "officer of Novo Nordisk",
    "Bagsvaerd, Denmark, 29 July 2025 - Novo Nordisk today announced that Maziar Mike Doustdar has been appointed as president and chief executive officer, effective 7 August 2025. Mike Doustdar succeeds Lars Fruergaard Jorgensen.",
  ].join("\n"),
  rawPayload: {
    form_type: "6-K",
    documents: [{ type: "6-K", description: "6-K", isPrimary: true, textCharCount: 1_000 }],
  },
});
const sixKLeadershipOutline = sixKDirectBodyLeadershipPayload.router_digest.documents.find(
  (document: Record<string, unknown>) => document.source_ref === "primary_filing",
);
assert.equal(
  sixKLeadershipOutline?.title,
  "Maziar Mike Doustdar appointed as president and chief executive officer of Novo Nordisk",
);
assert.match(String(sixKLeadershipOutline?.subtitle), /effective 7 August 2025/i);

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

const listingPayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "listing-risk-8k.json")));
const listingItemBlock = sourceBlocks(listingPayload).find((block) => block.item_number === "3.01");
assert.ok(listingItemBlock?.block_id?.startsWith("secblk_item_section_"));
assert.equal(listingItemBlock?.source_ref, "Item 3.01");
assert.equal(listingItemBlock?.origin, "parser.item_section");
assert.ok(Number(listingItemBlock?.priority) >= 95);
assertNoExtractedEvidenceBlocks(listingPayload);

const mergerPayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "strategic-transaction-8k.json")));
assert.ok(sourceBlocks(mergerPayload).some((block) => block.item_number === "2.01" && Number(block.priority) >= 95));

const votePayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "shareholder-vote-8k.json")));
assert.ok(sourceBlocks(votePayload).some((block) => block.item_number === "5.07" && Number(block.priority) >= 95));

const sixKExhibitFixture = readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "six-k-exhibit-99-1.json"));
const sixKExhibitParsed = parseSec8k6kFiling(sixKExhibitFixture);
const sixKExhibitInput = buildSecSourceBlockPromptInput({
  filingPackage: sixKExhibitFixture as Record<string, unknown>,
  parserOutput: sixKExhibitParsed as unknown as Record<string, unknown>,
  fallbackText: sixKExhibitFixture.bodyText || null,
});
const sixKExhibitBlocks = sixKExhibitInput.cleaned_source_blocks;
const sixKExhibitBlock = sixKExhibitBlocks.find((block) => block.exhibit_number === "99.1" && block.block_type === "attachment_source_block");
assert.ok(sixKExhibitInput.source_block_bundle.mode === "analysis_deep");
assert.ok(Array.isArray(sixKExhibitInput.source_block_manifest));
assert.ok(sixKExhibitBlocks.every((block) => block.block_id && block.source_ref && block.origin && typeof block.priority === "number"));
assert.ok(sixKExhibitBlock?.block_id);
assert.equal(
  sixKExhibitBlocks.some((block) => block.block_type === "attachment_headline"),
  false,
  "attachment headline previews should not duplicate the complete attachment source block",
);

const deepBundle = buildSecSourceBlockPromptInput({
  filingPackage: sixKExhibitFixture as Record<string, unknown>,
  parserOutput: sixKExhibitParsed as unknown as Record<string, unknown>,
  fallbackText: sixKExhibitFixture.bodyText || null,
});
assert.equal(deepBundle.source_block_bundle.mode, "analysis_deep");
assert.equal(deepBundle.cleaned_source_blocks.length, deepBundle.source_block_manifest.length);
assert.equal(deepBundle.source_block_bundle.included_source_block_ids.length, deepBundle.source_block_manifest.length);
assert.ok(deepBundle.cleaned_source_blocks.some((block) => block.block_id === sixKExhibitBlock?.block_id));
assert.ok(deepBundle.cleaned_source_blocks.some((block) => block.block_type === "current_filing"));

const exchangeDelistingPayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "exchange-delisting-8k.json")));
const exchangeItem301 = findSourceBlock(exchangeDelistingPayload, { itemNumber: "3.01" });
const exchangeEx991 = findSourceBlock(exchangeDelistingPayload, { exhibitNumber: "99.1" });
assert.ok(exchangeItem301?.block_id, "exchange delisting Item 3.01 source block");
assert.ok(exchangeEx991?.block_id, "exchange delisting Exhibit 99.1 source block");
assert.ok(exchangeItem301.text.includes("Staff Delisting Determination"));
assert.ok(exchangeItem301.text.includes("Trading of the Company's common stock will be suspended"));
assert.ok(exchangeItem301.text.includes("Form 25-NSE"));
assert.ok(exchangeEx991.text.includes("Nasdaq Staff Delisting Determination"));
assertNoExtractedEvidenceBlocks(exchangeDelistingPayload);
const exchangeRouter = normalizeSec8k6kRouterResult({
  event_type: "listing_risk",
  route_case: "listing_risk",
  score: 72,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: true,
  filing_complexity: "moderate",
  primary_route_candidate: {
    route_type: "listing_risk",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: [exchangeItem301.block_id],
    reason: "Item 3.01 exchange delisting notice.",
  },
  route_candidates: [
    {
      route_type: "listing_risk",
      priority: "primary",
      confidence: "high",
      selected_source_block_ids: [exchangeItem301.block_id, exchangeEx991.block_id],
      reason: "Exchange notice and press release.",
    },
  ],
  selected_source_block_ids: [exchangeItem301.block_id],
  archive_like_candidate: false,
  deterministic_possible: false,
  needs_parent_context: true,
  market_context_needed: true,
});
assert.equal(exchangeRouter.analysis_needed, true);
assert.equal(exchangeRouter.primary_route_candidate.route_type, "listing_risk");
assert.equal("selected_source_block_ids" in exchangeRouter, false);
assert.equal(exchangeRouter.market_context_needed, true);
const exchangeDebug = buildSec8k6kPreviewDebug({
  routerResult: exchangeRouter,
  routerPromptUser: JSON.stringify(exchangeDelistingPayload),
  analysisSkipped: false,
});
assert.equal(exchangeDebug.router_result.primary_route_candidate?.route_type, "listing_risk");
assert.equal(exchangeDebug.analysis_source_blocks.length, 0);
assert.equal(exchangeDebug.analysis_source_bundle.included_block_count, 0);
assert.equal(JSON.stringify(exchangeDebug).includes(exchangeItem301.text), false);

const voluntaryDelistingPayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "voluntary-delisting-8k.json")));
const voluntaryItem801 = findSourceBlock(voluntaryDelistingPayload, { itemNumber: "8.01" });
const voluntaryEx991 = findSourceBlock(voluntaryDelistingPayload, { exhibitNumber: "99.1" });
assert.ok(voluntaryItem801?.text.includes("voluntary delisting"));
assert.ok(voluntaryEx991?.text.includes("voluntary NYSE delisting"));
const voluntaryRouter = normalizeSec8k6kRouterResult({
  event_type: "listing_risk",
  route_case: "voluntary_delisting",
  score: 76,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: true,
  filing_complexity: "moderate",
  primary_route_candidate: {
    route_type: "listing_risk",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: [voluntaryItem801.block_id, voluntaryEx991.block_id],
    reason: "Company decision to voluntarily delist common stock.",
  },
  route_candidates: [],
  selected_source_block_ids: [],
  archive_like_candidate: false,
  deterministic_possible: false,
  needs_parent_context: false,
  market_context_needed: true,
});
assert.equal(voluntaryRouter.analysis_needed, true);
assert.equal("selected_source_block_ids" in voluntaryRouter, false);

const mergerClosingPayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "merger-closing-delisting-8k.json")));
const mergerItem201 = findSourceBlock(mergerClosingPayload, { itemNumber: "2.01" });
const mergerItem301 = findSourceBlock(mergerClosingPayload, { itemNumber: "3.01" });
const mergerPressRelease = findSourceBlock(mergerClosingPayload, { exhibitNumber: "99.1" });
assert.ok(mergerItem201?.text.includes("completed its previously announced merger"));
assert.ok(mergerItem301?.text.includes("procedural and results from the completed merger"));
const mergerRouter = normalizeSec8k6kRouterResult({
  event_type: "strategic_transaction",
  route_case: "merger_closing",
  score: 70,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: true,
  filing_complexity: "moderate",
  primary_route_candidate: {
    route_type: "strategic_transaction",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: [mergerItem201.block_id, mergerPressRelease.block_id],
    reason: "Item 2.01 merger closing is the economic event.",
  },
  route_candidates: [
    {
      route_type: "listing_risk",
      priority: "context",
      confidence: "medium",
      selected_source_block_ids: [mergerItem301.block_id],
      reason: "Delisting is procedural context from completed merger.",
    },
  ],
  selected_source_block_ids: [],
  archive_like_candidate: false,
  deterministic_possible: false,
  needs_parent_context: false,
  market_context_needed: false,
});
assert.equal(mergerRouter.primary_route_candidate.route_type, "strategic_transaction");
assert.equal(mergerRouter.route_candidates[0].priority, "context");
assert.equal("selected_source_block_ids" in mergerRouter, false);

const materialVotePayload = buildRouterPayload(readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "material-vote-results-8k.json")));
const materialVoteBlock = findSourceBlock(materialVotePayload, { itemNumber: "5.07" });
assert.ok(materialVoteBlock?.text.includes("32,000,000 shares"));
const materialVoteDigest = materialVotePayload.router_digest.items.find((item: Record<string, unknown>) => item.item_number === "5.07");
assert.ok(Array.isArray(materialVoteDigest?.context_snippets));
assert.ok(materialVoteDigest.context_snippets.some((snippet: string) => /issuance of up to 32,000,000 shares/i.test(snippet)));
assert.ok(materialVoteDigest.context_snippets.every((snippet: string) => snippet.length <= 753));
assertNoExtractedEvidenceBlocks(materialVotePayload);
const materialVoteRouter = normalizeSec8k6kRouterResult({
  event_type: "shareholder_vote",
  route_case: "material_vote_result",
  score: 68,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: true,
  filing_complexity: "moderate",
  primary_route_candidate: {
    route_type: "shareholder_vote",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: [materialVoteBlock.block_id],
    reason: "Item 5.07 material vote results.",
  },
  route_candidates: [],
  selected_source_block_ids: [],
  archive_like_candidate: false,
  deterministic_possible: false,
});
assert.equal(materialVoteRouter.primary_route_candidate.route_type, "shareholder_vote");
assert.equal("selected_source_block_ids" in materialVoteRouter, false);
assert.ok(sec8k6kRouterSystemPrompt.includes("Vote-subject rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("Reverse-split rule"));
assert.ok(sec8k6kRouterSystemPrompt.includes("vote approving a merger"));
assert.ok(sec8k6kRouterSystemPrompt.includes("vote approving a current or future share issuance"));
assert.ok(sec8k6kRouterSystemPrompt.includes("route_case debt_or_credit_financing"));
assert.ok(sec8k6kRouterSystemPrompt.includes("hypothetical default remedies"));
assert.ok(sec8k6kRouterResponseSchema.properties.route_case.enum.includes("debt_or_credit_financing"));

const complexFinancingFixture = readJson<Sec8k6kParseInput>(join(roomDir, "fixtures", "complex-financing-8k.json"));
const complexFinancingParsed = parseSec8k6kFiling(complexFinancingFixture);
const complexFinancingPayload = buildRouterPayload(complexFinancingFixture);
assert.equal(
  complexFinancingParsed.facts.filingCues.some((cue) => cue.cueType === "financial_distress_or_default"),
  false,
  "Item 2.03 without distress language must not create a financial-distress cue",
);
assert.equal(
  sourceBlocks(complexFinancingPayload).some((block) => /^Instrument Term Excerpts$/i.test(String(block.label || ""))),
  false,
  "derived instrument excerpts must not become LLM evidence blocks",
);
for (const itemNumber of ["1.01", "2.03", "3.02"]) {
  assert.ok(findSourceBlock(complexFinancingPayload, { itemNumber })?.block_id, `complex financing Item ${itemNumber}`);
}
for (const exhibitNumber of ["10.1", "10.2", "4.1"]) {
  assert.ok(findSourceBlock(complexFinancingPayload, { exhibitNumber })?.block_id, `complex financing Exhibit ${exhibitNumber}`);
}
const complexFinancingRouter = normalizeSec8k6kRouterResult({
  event_type: "dilution_risk",
  route_case: "financing_or_dilution",
  score: 78,
  delivery_level: "feed",
  display_type: "generic",
  display_version: "sec_8k_6k_generic_v1",
  analysis_needed: true,
  filing_complexity: "complex",
  primary_route_candidate: {
    route_type: "dilution_risk",
    priority: "primary",
    confidence: "high",
    selected_source_block_ids: [
      findSourceBlock(complexFinancingPayload, { itemNumber: "1.01" })!.block_id,
      findSourceBlock(complexFinancingPayload, { itemNumber: "2.03" })!.block_id,
      findSourceBlock(complexFinancingPayload, { itemNumber: "3.02" })!.block_id,
    ],
    reason: "Securities purchase agreement, convertible debt, and unregistered securities issuance.",
  },
  route_candidates: [],
  selected_source_block_ids: [],
  archive_like_candidate: false,
  deterministic_possible: false,
});
assert.equal(complexFinancingRouter.filing_complexity, "complex");
assert.equal(complexFinancingRouter.primary_route_candidate.route_type, "dilution_risk");
assert.equal("selected_source_block_ids" in complexFinancingRouter, false);

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
  const payload = JSON.parse(routerPrompt.user) as Record<string, any>;
  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage: input as Record<string, unknown>,
    parserOutput: parsedInput as unknown as Record<string, unknown>,
    fallbackText: filingExcerpt,
  });
  Object.defineProperty(payload, "__test_source_blocks", {
    value: sourceInput.cleaned_source_blocks,
    enumerable: false,
  });
  return payload;
}

function hasSourceBlockText(payload: Record<string, any>, text: string): boolean {
  return sourceBlockText(payload).includes(text);
}

function sourceBlockText(payload: Record<string, any>): string {
  return JSON.stringify(payload.router_digest || {});
}

function sourceBlockTypes(payload: Record<string, any>): string[] {
  const blocks = Array.isArray(payload.__test_source_blocks) ? payload.__test_source_blocks : [];
  return blocks.map((block: Record<string, unknown>) => String(block.block_type || "")).filter(Boolean);
}

function sourceBlocks(payload: Record<string, any>): Array<Record<string, any>> {
  return Array.isArray(payload.__test_source_blocks) ? payload.__test_source_blocks : [];
}

function findSourceBlock(payload: Record<string, any>, options: { itemNumber?: string; exhibitNumber?: string }) {
  return sourceBlocks(payload).find((block) => {
    if (options.itemNumber && block.item_number === options.itemNumber) return true;
    if (options.exhibitNumber && block.exhibit_number === options.exhibitNumber) return true;
    return false;
  });
}

function assertNoExtractedEvidenceBlocks(payload: Record<string, any>) {
  const forbidden = new Set([
    "source_value_evidence",
    "source_evidence",
    "date_evidence",
    "money_evidence",
    "share_count_evidence",
    "keyword_evidence",
  ]);
  assert.deepEqual(sourceBlockTypes(payload).filter((type) => forbidden.has(type)), []);
}
