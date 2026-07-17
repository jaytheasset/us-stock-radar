import assert from "node:assert/strict";
import type { SecForm25ParserOutput } from "./parser";
import { inspectSecForm25ValidationRepairIssues } from "./validationRepair";

const field = (value: string) => ({ value, evidence: value, source: "fixture", confidence: "high" as const });

const parserOutput: SecForm25ParserOutput = {
  parserVersion: "sec_form25_parser_v1",
  parserGroup: "form25",
  formType: "Form 25 / 25-NSE",
  accessionNumber: "0001354457-25-000634",
  isSupported: true,
  summary: null,
  facts: {
    parser_version: "sec_form25_parser_v1",
    source_form_type: "25-NSE",
    raw_item_id: null,
    source_url: null,
    filed_at: null,
    primary_ticker: null,
    primary_ticker_exchange: null,
    filing_date: field("2025-07-10"),
    effectiveness_date: field("2025-07-21"),
    file_number: null,
    issuer_name: field("T2 Biosystems, Inc."),
    subject_company_cik: field("0001492674"),
    filed_by_name: field("Nasdaq Stock Market LLC"),
    filed_by_cik: field("0001354457"),
    exchange: field("Nasdaq Stock Market LLC"),
    removed_security: field("Common Stock"),
    rule_provision: field("12d2-2(b)"),
    removal_reason_text: field("Nasdaq determined the company no longer qualified for listing."),
    delisting_or_removal_date: field("2025-07-21"),
    trading_suspension_date: field("2025-02-12"),
    continued_listing_or_trading_venue: null,
    successor_or_acquirer: null,
    consideration_summary: null,
    extracted_field_count: 10,
  },
  signals: [],
  calendarItems: [],
  warnings: [],
  raw: {
    sourceInventory: {
      documents: [],
      attachments: [],
      primary_text_char_count: 0,
      source_text_char_count: 0,
      table_counts: { primary: 0, attachments: 0, total: 0 },
      truncation_notes: [],
    },
    directSourceBlocks: [
      {
        block_id: "form25-date-role-1",
        source_ref: "fixture",
        origin: "fixture",
        priority: 100,
        block_type: "form25_exchange_determination",
        document_type: "25-NSE",
        label: "Exchange determination",
        text:
          "Trading was suspended on February 12, 2025. Formal removal from listing is effective at the opening of trading on July 21, 2025.",
      },
    ],
    selectedEvidenceSnippets: [],
    selectedAttachmentSnippets: [],
    selectedTableSnippets: [],
  },
};

const conflictingResult = {
  analysis_output: {
    event_type: "listing_risk",
    signal: "neutral",
    delivery_level: "archive",
    quick_take: "T2 Biosystems' Nasdaq delisting became effective February 12, 2025.",
    summary:
      "Trading was suspended on February 12, 2025. Formal Nasdaq removal became effective July 21, 2025.",
    why_it_matters: "Formal removal ends the Nasdaq listing.",
    form25_lifecycle: { disposition: "related_event_update" },
  },
  display_payload: {
    data: {
      delisting_or_removal_date: "2025-07-21",
      trading_suspension_date: "2025-02-12",
    },
  },
};

const conflictIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: conflictingResult,
  parserOutput,
});
const conflict = conflictIssues.find((issue) => issue.code === "form25_date_role_conflict");
assert.ok(conflict, "date-role conflict must be detected");
assert.deepEqual(conflict.allowed_patch_paths, ["/analysis_output/quick_take"]);

const correctResult = JSON.parse(JSON.stringify(conflictingResult));
correctResult.analysis_output.quick_take =
  "Trading was suspended February 12; formal Nasdaq removal became effective July 21.";
const correctIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: correctResult,
  parserOutput,
});
assert.equal(
  correctIssues.some((issue) => issue.code === "form25_date_role_conflict"),
  false,
  "properly labeled dates must not trigger repair",
);

const compressedResult = JSON.parse(JSON.stringify(conflictingResult));
compressedResult.analysis_output.quick_take =
  "T2 Biosystems' common stock delisted from Nasdaq; trading was suspended February 12, 2025.";
const compressedIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: compressedResult,
  parserOutput,
});
assert.equal(
  compressedIssues.some((issue) => issue.code === "form25_date_role_conflict"),
  true,
  "quick take must not omit the formal removal date while combining delisting with the suspension date",
);

const unverifiedDateParser = JSON.parse(JSON.stringify(parserOutput)) as SecForm25ParserOutput;
unverifiedDateParser.facts.filing_date = field("2025-11-28");
unverifiedDateParser.facts.effectiveness_date = field("2025-11-28");
unverifiedDateParser.facts.delisting_or_removal_date = null;
unverifiedDateParser.facts.trading_suspension_date = null;
const unverifiedDateResult = JSON.parse(JSON.stringify(correctResult));
unverifiedDateResult.analysis_output.quick_take =
  "This Form 25 completes formal removal on November 28, 2025.";
unverifiedDateResult.analysis_output.summary =
  "The common stock was formally removed from Nasdaq on November 28, 2025.";
unverifiedDateResult.display_payload.data.delisting_or_removal_date = "2025-11-28";
unverifiedDateResult.display_payload.data.effectiveness_date = "2025-11-28";
delete unverifiedDateResult.display_payload.data.trading_suspension_date;
const unverifiedDateIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: unverifiedDateResult,
  parserOutput: unverifiedDateParser,
});
const unverifiedDateIssue = unverifiedDateIssues.find((issue) => issue.code === "form25_date_role_conflict");
assert.ok(unverifiedDateIssue, "filing date must not be reused as an unverified formal removal date");
assert.deepEqual(unverifiedDateIssue.allowed_patch_paths, [
  "/display_payload/data/delisting_or_removal_date",
  "/display_payload/data/effectiveness_date",
  "/analysis_output/quick_take",
  "/analysis_output/summary",
]);

const warrantOnlyParser = JSON.parse(JSON.stringify(parserOutput)) as SecForm25ParserOutput;
warrantOnlyParser.facts.removed_security = field("Warrant expiring 2030");
warrantOnlyParser.facts.rule_provision = field("17 CFR 240.12d2-2(a)(1)");
warrantOnlyParser.facts.removal_reason_text = null;
warrantOnlyParser.raw.directSourceBlocks = [
  {
    block_id: "form25-warrant-only-1",
    source_ref: "fixture",
    origin: "fixture",
    priority: 100,
    block_type: "form25_removal_notice",
    document_type: "25-NSE",
    label: "Warrant removal",
    text: "Nasdaq notifies the SEC of its intention to remove the Warrant expiring 2030 from listing and registration.",
  },
];
const overstatedWarrantResult = JSON.parse(JSON.stringify(correctResult));
overstatedWarrantResult.analysis_output.event_type = "listing_risk";
overstatedWarrantResult.analysis_output.score = 65;
overstatedWarrantResult.analysis_output.signal = "volatile";
overstatedWarrantResult.analysis_output.delivery_level = "feed";
const warrantOnlyIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: overstatedWarrantResult,
  parserOutput: warrantOnlyParser,
});
assert.equal(
  warrantOnlyIssues.some((issue) => issue.code === "non_common_security_cleanup_overstated"),
  true,
  "warrant-only removal without common-equity or stress evidence must trigger low-impact cleanup repair",
);

const stressedWarrantParser = JSON.parse(JSON.stringify(warrantOnlyParser)) as SecForm25ParserOutput;
stressedWarrantParser.facts.removal_reason_text = field(
  "The warrants failed to satisfy Nasdaq continued listing requirements.",
);
const stressedWarrantIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: overstatedWarrantResult,
  parserOutput: stressedWarrantParser,
});
assert.equal(
  stressedWarrantIssues.some((issue) => issue.code === "non_common_security_cleanup_overstated"),
  false,
  "source-backed listing failure must not be downgraded by the non-common cleanup rule",
);

const proceduralFollowUpParser = JSON.parse(JSON.stringify(parserOutput)) as SecForm25ParserOutput;
proceduralFollowUpParser.raw.directSourceBlocks = [
  {
    block_id: "procedural-removal-1",
    source_ref: "fixture",
    origin: "fixture",
    priority: 100,
    block_type: "form25_exchange_determination",
    document_type: "25-NSE",
    label: "Formal removal notice",
    text: [
      "Nasdaq will remove the Common Stock from listing and registration effective July 31, 2025.",
      "[ ] 17 CFR 240.12d2-2(c), voluntary withdrawal from listing and registration.",
      "[X] 17 CFR 240.12d2-2(b), the exchange determined the security no longer qualified for listing.",
    ].join("\n"),
  },
];
const proceduralFollowUpResult = JSON.parse(JSON.stringify(correctResult));
proceduralFollowUpResult.analysis_output.event_type = "listing_risk";
proceduralFollowUpResult.analysis_output.score = 92;
proceduralFollowUpResult.analysis_output.signal = "bearish";
proceduralFollowUpResult.analysis_output.delivery_level = "alert";
proceduralFollowUpResult.analysis_output.form25_lifecycle = {
  disposition: "related_event_update",
  related_event_id: "prior-axdx-event",
  related_accession_number: "0001104659-25-047314",
  has_new_material_information: true,
  rationale: "The formal removal date is new.",
};
const proceduralFollowUpContext = {
  selected_filings: [
    {
      event_id: "prior-axdx-event",
      accession_number: "0001104659-25-047314",
      form_type: "8-K",
      event_type: "listing_risk",
      match_confidence: "high",
      summary:
        "Following its bankruptcy and Nasdaq listing-rule violations, Nasdaq will suspend trading on May 15 and file Form 25. Shares are expected to continue on OTC as AXDXQ.",
    },
  ],
};
const proceduralFollowUpIssues = inspectSecForm25ValidationRepairIssues({
  analysisResult: proceduralFollowUpResult,
  parserOutput: proceduralFollowUpParser,
  relatedFilingContext: proceduralFollowUpContext,
});
const proceduralFollowUpIssue = proceduralFollowUpIssues.find(
  (issue) => issue.code === "procedural_form25_follow_up_overstated",
);
assert.ok(proceduralFollowUpIssue, "formal removal alone must not repeat an existing listing-risk alert");
assert.equal(
  proceduralFollowUpIssue.allowed_patch_paths.includes(
    "/analysis_output/form25_lifecycle/has_new_material_information",
  ),
  true,
);

console.log("sec form25 validation repair checks passed");
