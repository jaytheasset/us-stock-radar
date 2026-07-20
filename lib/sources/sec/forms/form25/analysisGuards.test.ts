import assert from "node:assert/strict";
import { applySecForm25PostAnalysisGuards } from "./analysisGuards";
import { scoreSecForm25RelatedFormType } from "./lifecyclePolicy";
import type { SecForm25ParserOutput } from "./parser";

assert.equal(scoreSecForm25RelatedFormType("8-K"), 45);
assert.equal(scoreSecForm25RelatedFormType("6-K"), 45);
assert.equal(scoreSecForm25RelatedFormType("6-K/A"), 45);
assert.equal(scoreSecForm25RelatedFormType("20-F"), 0);

const baseParserOutput: SecForm25ParserOutput = {
  parserVersion: "sec_form25_parser_v1",
  parserGroup: "form25",
  formType: "Form 25 / 25-NSE",
  accessionNumber: "0000000000-26-000001",
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
    filing_date: null,
    effectiveness_date: null,
    file_number: null,
    issuer_name: null,
    subject_company_cik: null,
    filed_by_name: null,
    filed_by_cik: null,
    exchange: null,
    removed_security: {
      value: "Common Stock",
      evidence: "Common Stock",
      source: "fixture",
      confidence: "high",
    },
    rule_provision: null,
    removal_reason_text: null,
    delisting_or_removal_date: null,
    trading_suspension_date: null,
    continued_listing_or_trading_venue: null,
    successor_or_acquirer: null,
    consideration_summary: null,
    extracted_field_count: 1,
  },
  signals: [],
  calendarItems: [],
  warnings: ["missing_or_unclear_reason"],
  raw: {
    sourceInventory: {
      documents: [],
      attachments: [],
      primary_text_char_count: 0,
      source_text_char_count: 0,
      table_counts: { primary: 0, attachments: 0, total: 0 },
      truncation_notes: [],
    },
    directSourceBlocks: [],
    selectedEvidenceSnippets: [],
    selectedAttachmentSnippets: [],
    selectedTableSnippets: [],
  },
};

const root = {
  analysis_output: {
    score: 88,
    signal: "bearish",
    confidence: "high",
    needs_human_review: false,
    score_reason: "delisting risk",
    score_explanation: { summary: "Severe exchange delisting risk pressures holders." },
  },
  display_payload: {
    data: {
      removed_security: "Common Stock",
      removal_reason: null,
      removal_reason_text: null,
    },
    notes: [],
  },
};

const result = applySecForm25PostAnalysisGuards(root, baseParserOutput);
assert.equal(result.changed, true);
assert.equal(root.analysis_output.score, 74);
assert.equal(root.analysis_output.signal, "volatile");
assert.equal(root.analysis_output.needs_human_review, true);
assert.equal(root.analysis_output.confidence, "medium");
assert.match(root.analysis_output.score_explanation.summary, /does not state a failure/);
assert.equal(root.display_payload.data.removal_reason, "Reason not disclosed");

const failureRoot = JSON.parse(JSON.stringify(root));
failureRoot.analysis_output.score = 88;
const failureParserOutput = {
  ...baseParserOutput,
  raw: {
    ...baseParserOutput.raw,
    selectedEvidenceSnippets: [
      {
        source: "fixture",
        text: "The exchange determined the issuer failed to meet the continued listing requirement.",
      },
    ],
  },
};
const failureResult = applySecForm25PostAnalysisGuards(failureRoot, failureParserOutput);
assert.equal(failureResult.changed, false);
assert.equal(failureRoot.analysis_output.score, 88);

const archiveRoot = {
  analysis_output: {
    score: 30,
    signal: "neutral",
    confidence: "high",
    needs_human_review: false,
    score_reason: "routine cleanup",
    score_explanation: { summary: "Routine non-common security cleanup has limited investor impact." },
    what_to_watch_next: ["Monitor generic company announcements."],
  },
  display_payload: {
    data: {},
    notes: [],
  },
};
const archiveResult = applySecForm25PostAnalysisGuards(archiveRoot, baseParserOutput);
assert.equal(archiveResult.changed, true);
assert.deepEqual(archiveRoot.analysis_output.what_to_watch_next, []);

const relatedContext = {
  selected_filings: [
    {
      event_id: "prior-event-1",
      accession_number: "0000000000-26-000010",
      form_type: "8-K",
      event_type: "listing_risk",
    },
  ],
};
const followUpRoot: Record<string, any> = {
  analysis_output: {
    event_type: "strategic_transaction",
    score: 82,
    signal: "bearish",
    confidence: "high",
    needs_human_review: false,
    what_to_watch_next: ["Monitor the already disclosed delisting."],
    form25_lifecycle: {
      disposition: "related_event_update",
      related_event_id: "prior-event-1",
      related_accession_number: "0000000000-26-000010",
      has_new_material_information: false,
      rationale: "The prior 8-K already disclosed the delisting decision.",
    },
  },
  display_payload: { data: {}, notes: [] },
};
const followUpResult = applySecForm25PostAnalysisGuards(followUpRoot, baseParserOutput, relatedContext);
assert.equal(followUpResult.changed, true);
assert.equal(followUpRoot.analysis_output.score, 20);
assert.equal(followUpRoot.analysis_output.event_type, "listing_risk");
assert.equal(followUpRoot.analysis_output.analysis_action, "related_event_update");
assert.deepEqual(followUpRoot.analysis_output.what_to_watch_next, []);
assert.equal(
  followUpRoot.display_payload.notes.some((note: string) => /duplicate alert suppressed/.test(note)),
  true,
);

const standaloneWithPriorCauseRoot: Record<string, any> = {
  analysis_output: {
    event_type: "listing_risk",
    score: 88,
    signal: "bearish",
    confidence: "high",
    needs_human_review: false,
    what_to_watch_next: ["Monitor OTC trading."],
    form25_lifecycle: {
      disposition: "standalone_event",
      related_event_id: null,
      related_accession_number: null,
      has_new_material_information: true,
      rationale: "The Form 25 formally removes the security.",
    },
  },
  display_payload: {
    data: {
      removal_reason: "Reason not disclosed",
      removal_reason_text: "No failure or stress reason stated.",
    },
    notes: [],
  },
};
const priorCauseContext = {
  selected_filings: [
    {
      event_id: "prior-listing-event",
      accession_number: "0000000000-26-000020",
      form_type: "8-K",
      event_type: "listing_risk",
      match_confidence: "medium",
      removal_reason_context: {
        label: "Listing Issue",
        value: "Nasdaq Listing Rule 5550(b)(2) noncompliance",
        note: "The prior 8-K explains the exchange's delisting decision.",
      },
    },
  ],
};
const standaloneWithPriorCauseResult = applySecForm25PostAnalysisGuards(
  standaloneWithPriorCauseRoot,
  baseParserOutput,
  priorCauseContext,
);
assert.equal(standaloneWithPriorCauseResult.changed, true);
assert.equal(standaloneWithPriorCauseRoot.analysis_output.score, 20);
assert.equal(standaloneWithPriorCauseRoot.analysis_output.analysis_action, "related_event_update");
assert.equal(standaloneWithPriorCauseRoot.analysis_output.form25_lifecycle.disposition, "related_event_update");
assert.equal(standaloneWithPriorCauseRoot.analysis_output.form25_lifecycle.related_event_id, "prior-listing-event");
assert.deepEqual(standaloneWithPriorCauseRoot.analysis_output.what_to_watch_next, []);
assert.equal(standaloneWithPriorCauseRoot.analysis_output.delivery_level, "archive");
assert.equal(
  standaloneWithPriorCauseRoot.display_payload.data.removal_reason,
  "Nasdaq Listing Rule 5550(b)(2) noncompliance",
);
assert.equal(
  standaloneWithPriorCauseRoot.display_payload.data.removal_reason_text,
  "The prior 8-K explains the exchange's delisting decision.",
);

const directReasonParserOutput: SecForm25ParserOutput = {
  ...baseParserOutput,
  facts: {
    ...baseParserOutput.facts,
    exchange: {
      value: "Nasdaq Stock Market LLC",
      evidence: "Exchange: Nasdaq Stock Market LLC",
      source: "fixture",
      confidence: "high",
    },
    removal_reason_text: {
      value:
        "Nasdaq Staff determined that the Company no longer qualified for listing pursuant to Listing Rule 5550(b)(2).",
      evidence: "The Company no longer qualified for listing.",
      source: "fixture",
      confidence: "high",
    },
  },
};
const directReasonRoot = JSON.parse(JSON.stringify(standaloneWithPriorCauseRoot));
directReasonRoot.display_payload.data.removal_reason = "Reason not disclosed";
directReasonRoot.display_payload.data.removal_reason_text = "No failure or stress reason stated.";
applySecForm25PostAnalysisGuards(directReasonRoot, directReasonParserOutput, priorCauseContext);
assert.equal(
  directReasonRoot.display_payload.data.removal_reason,
  "Nasdaq Listing Rule 5550(b)(2) noncompliance",
);
assert.equal(
  directReasonRoot.display_payload.data.removal_reason_text,
  "The company no longer met Nasdaq's continued listing requirements.",
);

const voluntaryParserOutput: SecForm25ParserOutput = {
  ...baseParserOutput,
  facts: {
    ...baseParserOutput.facts,
    filing_date: {
      value: "2025-11-28",
      evidence: "Filed November 28, 2025",
      source: "fixture",
      confidence: "high",
    },
    effectiveness_date: {
      value: "2025-11-28",
      evidence: "Filed November 28, 2025",
      source: "raw_payload.effectiveness_date",
      confidence: "medium",
    },
    rule_provision: {
      value: "12d2-2(c)",
      evidence: "Rule 12d2-2(c)",
      source: "fixture",
      confidence: "high",
    },
  },
};
const voluntaryFollowUpRoot: Record<string, any> = {
  analysis_output: {
    event_type: "strategic_transaction",
    score: 50,
    signal: "neutral",
    delivery_level: "feed",
    what_to_watch_next: ["Monitor OTC trading."],
    form25_lifecycle: {
      disposition: "standalone_event",
      has_new_material_information: true,
    },
  },
  display_payload: {
    data: {
      filing_date: "2025-11-28",
      effectiveness_date: "2025-11-28",
      delisting_or_removal_date: "2025-11-28",
    },
    notes: [],
  },
};
const voluntaryFollowUpResult = applySecForm25PostAnalysisGuards(
  voluntaryFollowUpRoot,
  voluntaryParserOutput,
  priorCauseContext,
);
assert.equal(voluntaryFollowUpResult.changed, true);
assert.equal(voluntaryFollowUpRoot.analysis_output.event_type, "listing_risk");
assert.equal(voluntaryFollowUpRoot.analysis_output.analysis_action, "related_event_update");
assert.equal(voluntaryFollowUpRoot.analysis_output.form25_lifecycle.related_event_id, "prior-listing-event");
assert.equal(voluntaryFollowUpRoot.analysis_output.form25_lifecycle.has_new_material_information, false);
assert.equal(voluntaryFollowUpRoot.analysis_output.delivery_level, "archive");
assert.equal(voluntaryFollowUpRoot.display_payload.data.effectiveness_date, null);
assert.equal(voluntaryFollowUpRoot.display_payload.data.delisting_or_removal_date, null);

const carverContext = {
  selected_filings: [
    {
      event_id: "carver-voluntary-delisting",
      accession_number: "0000943374-25-000480",
      form_type: "8-K",
      event_type: "listing_risk",
      match_confidence: "high",
      company_name: "CARVER BANCORP INC",
      summary:
        "Carver expected its last Nasdaq trading day on December 5, 2025, followed by OTCQX trading on December 8, 2025.",
    },
  ],
};
const unsupportedCarverRoot: Record<string, any> = {
  analysis_output: {
    event_type: "listing_risk",
    score: 20,
    signal: "neutral",
    delivery_level: "archive",
    quick_take: "Carver Bancorp's voluntary Nasdaq delisting is now procedurally complete.",
    summary: "Carver filed Form 25 to formally complete its voluntary Nasdaq delisting.",
    why_it_matters: "This filing formally completes the voluntary delisting process from Nasdaq.",
    score_explanation: {
      summary: "The voluntary delisting is a consequence of a strategic transaction.",
    },
    form25_lifecycle: {
      disposition: "related_event_update",
      related_event_id: "carver-voluntary-delisting",
      related_accession_number: "0000943374-25-000480",
      has_new_material_information: false,
    },
  },
  display_payload: { data: {}, notes: [] },
};
const carverParserOutput = JSON.parse(JSON.stringify(voluntaryParserOutput)) as SecForm25ParserOutput;
carverParserOutput.facts.issuer_name = {
  value: "CARVER BANCORP INC",
  evidence: "CARVER BANCORP INC",
  source: "fixture",
  confidence: "high",
};
carverParserOutput.facts.exchange = {
  value: "The Nasdaq Stock Market LLC",
  evidence: "The Nasdaq Stock Market LLC",
  source: "fixture",
  confidence: "high",
};
const unsupportedCarverResult = applySecForm25PostAnalysisGuards(
  unsupportedCarverRoot,
  carverParserOutput,
  carverContext,
);
assert.equal(unsupportedCarverResult.changed, true);
assert.equal(
  unsupportedCarverRoot.analysis_output.quick_take,
  "Carver Bancorp, Inc. filed Form 25 for its previously announced delisting from Nasdaq.",
);
assert.equal(
  unsupportedCarverRoot.analysis_output.summary,
  "Carver Bancorp, Inc. filed Form 25 for its previously announced delisting from Nasdaq. Its common stock was expected to continue trading on OTCQX.",
);
assert.equal(
  unsupportedCarverRoot.analysis_output.why_it_matters,
  "The filing is a procedural update to the previously announced delisting and does not add a new material listing event.",
);
assert.equal(
  unsupportedCarverRoot.analysis_output.score_explanation.summary,
  "This Form 25 is a procedural update to a previously announced delisting and does not add a new material listing event.",
);
assert.equal(
  unsupportedCarverResult.warnings.some((warning) => /Unsupported formal-removal/.test(warning)),
  true,
);

const missingVenueRoot: Record<string, any> = JSON.parse(JSON.stringify(unsupportedCarverRoot));
missingVenueRoot.analysis_output.quick_take =
  "Form 25 filed to confirm the previously announced voluntary Nasdaq delisting.";
missingVenueRoot.analysis_output.summary =
  "Carver Bancorp, Inc. filed Form 25 to confirm its previously announced voluntary Nasdaq delisting.";
missingVenueRoot.analysis_output.why_it_matters =
  "This filing is a procedural confirmation of the previously announced delisting.";
missingVenueRoot.display_payload.data = {};
const missingVenueResult = applySecForm25PostAnalysisGuards(
  missingVenueRoot,
  carverParserOutput,
  carverContext,
);
assert.equal(
  missingVenueRoot.analysis_output.summary,
  "Carver Bancorp, Inc. filed Form 25 to confirm its previously announced voluntary Nasdaq delisting. Its common stock was expected to continue trading on OTCQX.",
);
assert.equal(missingVenueRoot.display_payload.data.continued_listing_or_trading_venue, "OTCQX");
assert.equal(
  missingVenueResult.warnings.some((warning) => /continued trading venue/.test(warning)),
  true,
);

const proceduralRemovalParser: SecForm25ParserOutput = {
  ...baseParserOutput,
  warnings: [],
  facts: {
    ...baseParserOutput.facts,
    exchange: {
      value: "The Nasdaq Stock Market LLC",
      evidence: "The Nasdaq Stock Market LLC",
      source: "fixture",
      confidence: "high",
    },
    trading_suspension_date: {
      value: "2025-05-15",
      evidence: "Trading was suspended on May 15, 2025.",
      source: "fixture",
      confidence: "high",
    },
    delisting_or_removal_date: {
      value: "2025-07-31",
      evidence: "Removal from listing is effective July 31, 2025.",
      source: "fixture",
      confidence: "high",
    },
    effectiveness_date: {
      value: "2025-07-31",
      evidence: "Removal from listing is effective July 31, 2025.",
      source: "fixture",
      confidence: "high",
    },
  },
  raw: {
    ...baseParserOutput.raw,
    directSourceBlocks: [
      {
        block_id: "formal-removal-only",
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
    ],
  },
};
const proceduralPriorContext = {
  selected_filings: [
    {
      event_id: "axdx-listing-risk",
      accession_number: "0001104659-25-047314",
      form_type: "8-K",
      event_type: "listing_risk",
      match_confidence: "high",
      event_title: "Accelerate Diagnostics faces Nasdaq delisting after restructuring",
      summary:
        "Following its bankruptcy and Nasdaq listing-rule violations, Nasdaq will suspend trading on May 15 and file Form 25. Shares are expected to continue on OTC as AXDXQ.",
    },
  ],
};
const proceduralRemovalRoot: Record<string, any> = {
  analysis_output: {
    event_type: "listing_risk",
    event_title: "Accelerate Diagnostics Nasdaq removal update",
    score: 92,
    signal: "bearish",
    delivery_level: "alert",
    quick_take: "Nasdaq formally removed the common stock after trading had already stopped.",
    summary:
      "Nasdaq formally removed the common stock after trading had already stopped. Shares remain available on the OTC market as AXDXQ.",
    why_it_matters: "This completes the exchange removal without creating a second listing-risk event.",
    key_evidence: ["Formal removal completed."],
    what_to_watch_next: ["Monitor formal removal."],
    form25_lifecycle: {
      disposition: "related_event_update",
      related_event_id: "axdx-listing-risk",
      related_accession_number: "0001104659-25-047314",
      has_new_material_information: true,
      rationale: "The formal removal date is new.",
    },
  },
  display_payload: { data: {}, notes: [] },
};
const proceduralRemovalResult = applySecForm25PostAnalysisGuards(
  proceduralRemovalRoot,
  proceduralRemovalParser,
  proceduralPriorContext,
);
assert.equal(proceduralRemovalResult.changed, true);
assert.equal(proceduralRemovalRoot.analysis_output.form25_lifecycle.has_new_material_information, false);
assert.equal(proceduralRemovalRoot.analysis_output.score, 20);
assert.match(proceduralRemovalRoot.analysis_output.summary, /remain available on the OTC market as AXDXQ/);
assert.equal(proceduralRemovalRoot.analysis_output.event_title, "Accelerate Diagnostics Nasdaq removal update");
assert.deepEqual(proceduralRemovalRoot.analysis_output.key_evidence, []);
assert.equal(proceduralRemovalRoot.analysis_output.delivery_level, "archive");
assert.deepEqual(proceduralRemovalRoot.analysis_output.what_to_watch_next, []);
assert.equal(
  proceduralRemovalResult.warnings.some((warning) => /procedural update/.test(warning)),
  true,
);

const newVenueParser = JSON.parse(JSON.stringify(proceduralRemovalParser)) as SecForm25ParserOutput;
newVenueParser.facts.continued_listing_or_trading_venue = {
  value: "OTCQX",
  evidence: "Trading is expected to continue on OTCQX.",
  source: "fixture",
  confidence: "high",
};
const newVenueRoot: Record<string, any> = JSON.parse(JSON.stringify(proceduralRemovalRoot));
newVenueRoot.analysis_output.score = 82;
newVenueRoot.analysis_output.delivery_level = "alert";
newVenueRoot.analysis_output.what_to_watch_next = ["Confirm OTCQX trading."];
newVenueRoot.analysis_output.form25_lifecycle.has_new_material_information = true;
const newVenueResult = applySecForm25PostAnalysisGuards(
  newVenueRoot,
  newVenueParser,
  proceduralPriorContext,
);
assert.equal(newVenueResult.changed, true);
assert.equal(newVenueRoot.analysis_output.score, 20);
assert.equal(newVenueRoot.analysis_output.delivery_level, "archive");
assert.equal(newVenueRoot.analysis_output.form25_lifecycle.has_new_material_information, false);

const newCauseParser = JSON.parse(JSON.stringify(proceduralRemovalParser)) as SecForm25ParserOutput;
newCauseParser.raw.directSourceBlocks[0].text =
  "Nasdaq will remove the Common Stock effective July 31, 2025, after the issuer filed for Chapter 11 bankruptcy.";
const newCausePriorContext = JSON.parse(JSON.stringify(proceduralPriorContext));
newCausePriorContext.selected_filings[0].event_title = "Nasdaq trading suspension announced";
newCausePriorContext.selected_filings[0].summary =
  "Nasdaq will suspend trading on May 15 and file Form 25. The cause was not disclosed.";
const newCauseRoot: Record<string, any> = JSON.parse(JSON.stringify(proceduralRemovalRoot));
newCauseRoot.analysis_output.score = 85;
newCauseRoot.analysis_output.delivery_level = "alert";
newCauseRoot.analysis_output.form25_lifecycle.has_new_material_information = true;
const newCauseResult = applySecForm25PostAnalysisGuards(
  newCauseRoot,
  newCauseParser,
  newCausePriorContext,
);
assert.equal(newCauseResult.changed, true);
assert.equal(newCauseRoot.analysis_output.score, 20);
assert.equal(newCauseRoot.analysis_output.delivery_level, "archive");
assert.equal(newCauseRoot.analysis_output.form25_lifecycle.has_new_material_information, false);

const invalidReferenceRoot: Record<string, any> = JSON.parse(JSON.stringify(followUpRoot));
invalidReferenceRoot.analysis_output.score = 75;
invalidReferenceRoot.analysis_output.form25_lifecycle.related_event_id = "invented-event";
invalidReferenceRoot.analysis_output.form25_lifecycle.related_accession_number = null;
const invalidReferenceResult = applySecForm25PostAnalysisGuards(
  invalidReferenceRoot,
  baseParserOutput,
  relatedContext,
);
assert.equal(invalidReferenceResult.changed, true);
assert.equal(invalidReferenceRoot.analysis_output.form25_lifecycle.disposition, "context_unresolved");
assert.equal(invalidReferenceRoot.analysis_output.analysis_action, "context_unresolved");
assert.equal(invalidReferenceRoot.analysis_output.needs_human_review, true);

const cleanupRoot: Record<string, any> = JSON.parse(JSON.stringify(followUpRoot));
cleanupRoot.analysis_output.score = 60;
cleanupRoot.analysis_output.signal = "bearish";
cleanupRoot.analysis_output.form25_lifecycle.disposition = "administrative_cleanup";
const cleanupResult = applySecForm25PostAnalysisGuards(cleanupRoot, baseParserOutput, relatedContext);
assert.equal(cleanupResult.changed, true);
assert.equal(cleanupRoot.analysis_output.score, 20);
assert.equal(cleanupRoot.analysis_output.signal, "neutral");
assert.equal(cleanupRoot.analysis_output.analysis_action, "administrative_cleanup");

const amendmentParserOutput: SecForm25ParserOutput = {
  ...baseParserOutput,
  accessionNumber: "0000000000-26-000011",
  facts: {
    ...baseParserOutput.facts,
    source_form_type: "25-NSE/A",
  },
};
const amendmentContext = {
  selected_filings: [
    {
      event_id: "original-form25-event",
      accession_number: "0000000000-26-000010",
      form_type: "25-NSE",
    },
    {
      event_id: "earlier-8k-event",
      accession_number: "0000000000-26-000009",
      form_type: "8-K",
    },
  ],
};
const amendmentRoot: Record<string, any> = {
  analysis_output: {
    score: 88,
    signal: "bearish",
    confidence: "high",
    needs_human_review: false,
    what_to_watch_next: ["Monitor the repeated delisting event."],
    form25_lifecycle: {
      disposition: "standalone_event",
      related_event_id: null,
      related_accession_number: null,
      has_new_material_information: true,
      rationale: "The amendment repeats the exchange delisting.",
    },
  },
  display_payload: { data: {}, notes: [] },
};
const amendmentResult = applySecForm25PostAnalysisGuards(
  amendmentRoot,
  amendmentParserOutput,
  amendmentContext,
);
assert.equal(amendmentResult.changed, true);
assert.equal(amendmentRoot.analysis_output.score, 20);
assert.equal(amendmentRoot.analysis_output.signal, "neutral");
assert.equal(amendmentRoot.analysis_output.analysis_action, "related_event_update");
assert.equal(amendmentRoot.analysis_output.form25_lifecycle.disposition, "related_event_update");
assert.equal(amendmentRoot.analysis_output.form25_lifecycle.related_event_id, "original-form25-event");
assert.equal(
  amendmentRoot.analysis_output.form25_lifecycle.related_accession_number,
  "0000000000-26-000010",
);
assert.deepEqual(amendmentRoot.analysis_output.what_to_watch_next, []);
assert.equal(
  amendmentRoot.display_payload.notes.some((note: string) => /amendment treated as an update/.test(note)),
  true,
);

console.log("sec form25 analysis guard checks passed");
