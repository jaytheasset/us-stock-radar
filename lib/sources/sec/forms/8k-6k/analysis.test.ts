import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applySec8k6kValidationRepairPatches,
  buildSec8k6kValidationRepairPlan,
  getSec8k6kCapitalSecurityCoverageWarnings,
  getSec8k6kGovernanceSemanticWarnings,
  getSec8k6kValidationSemanticWarnings,
  normalizeSec8k6kCapitalDisplayPayloadForPersistence,
  normalizeSec8k6kOperatingDisplayPayloadForPersistence,
  repairSec8k6kDisplayPayloadEncoding,
} from "../../../../ai/sec8k6kAnalysisAdapter";
import { buildSecFilingAnalysisPackage } from "../../../../prompts/secFilingAnalysisPackage";
import {
  buildSec8k6kAnalysisPromptDraft,
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_KEYS,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  getSec8k6kSpecializedRuntimeResponseSchema,
  resolveSec8k6kAnalysisPromptFamily,
  sec8k6kAnalysisResponseSchema,
  sec8k6kAnalysisSystemPrompt,
  sec8k6kFinalOutputCheckPrompt,
  sec8k6kFinancingDilutionCapitalStructurePrompt,
  sec8k6kGovernanceVoteLeadershipPrompt,
  sec8k6kListingFinancialRiskPrompt,
  sec8k6kOperatingLegalRoutinePrompt,
  sec8k6kStrategicTransactionPrompt,
} from "./analysisPrompt";
import { parseSec8k6kFiling } from "./parser";
import { buildSecSourceBlockPromptInput, isLowQualitySourceText } from "./sourceBlockPromptInput";
import {
  SEC_8K_6K_APPROVED_EVENT_TYPES,
  SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES,
  SEC_8K_6K_FORM_SCOPE,
  deriveSec8k6kDeliveryLevel,
  isSec8k6kApprovedEventType,
  type Sec8k6kParseInput,
  type Sec8k6kRoomExpectedOutput,
} from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

const expectedNames = readdirSync(expectedDir)
  .filter((name: string) => name.endsWith(".expected.json"))
  .sort();

assert.equal(expectedNames.length, 15);

assert.deepEqual(
  repairSec8k6kDisplayPayloadEncoding({
    data: { note: "Cauchar\u00c3\u00ad-Olaroz", nested: ["LYTENAVA\u00e2\u201e\u00a2"] },
  }),
  { data: { note: "Cauchar\u00ed-Olaroz", nested: ["LYTENAVA\u2122"] } },
);

const coveredEventTypes = new Set<string>();
const coveredAnalysisFamilies = new Set<string>();

for (const expectedName of expectedNames) {
  const expected = readJson<Sec8k6kRoomExpectedOutput>(join(expectedDir, expectedName));
  const output = expected.analysis_output;
  const fixtureExpected = expected.fixture_expected;

  assert.equal(expected.parser_output.parserGroup, "8k-6k", expectedName);
  assert.equal(expected.parser_output.formType, SEC_8K_6K_FORM_SCOPE, expectedName);
  assert.equal(expected.parser_output.isSupported, true, expectedName);
  assertParserExpectedHasNoRoutingDecision(expected, expectedName);
  assert.equal(output.source_group, "filings", expectedName);
  assert.ok(isSec8k6kApprovedEventType(output.event_type), expectedName);
  assert.equal(deriveSec8k6kDeliveryLevel(output.score), fixtureExpected.expected_delivery_level, expectedName);
  assert.equal(
    resolveSec8k6kAnalysisPromptFamily({ event_type: output.event_type }),
    fixtureExpected.analysis_family,
    expectedName,
  );
  assert.equal(expected.display_payload.display_type, fixtureExpected.expected_display_type, expectedName);
  assert.equal(expected.display_payload.data.display_version, fixtureExpected.expected_display_version, expectedName);
  assert.equal(typeof output.score_explanation?.summary, "string", expectedName);
  assertCurrentFamilyFixtureContract(expected, expectedName);
  if (fixtureExpected.expected_delivery_level === "archive") {
    assertArchiveDisplayPayload(expected, expectedName);
  }
  coveredEventTypes.add(output.event_type);
  coveredAnalysisFamilies.add(fixtureExpected.analysis_family);
}

for (const eventType of coveredEventTypes) {
  assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes(eventType as (typeof SEC_8K_6K_APPROVED_EVENT_TYPES)[number]), eventType);
}
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("operating_update"));
assert.deepEqual(
  [...coveredAnalysisFamilies].sort(),
  ["capital_financing", "governance_vote", "operating_legal_routine", "risk_status", "strategic_transaction"],
);

const fixture = readJson<Sec8k6kParseInput>(join(fixturesDir, "fda-clinical-6k.json"));
const parsed = parseSec8k6kFiling(fixture);
const prompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "fda_clinical",
    route_case: "fda_or_clinical",
    score: 86,
    delivery_level: "alert",
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
  },
  market_context: null,
});
const analysisUserPayload = JSON.parse(prompt.user) as Record<string, any>;

assert.equal(prompt.key, SEC_8K_6K_ANALYSIS_PROMPT_KEY);
assert.equal(prompt.version, SEC_8K_6K_ANALYSIS_PROMPT_VERSION);
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "listing_risk" }), "risk_status");
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "financial_risk" }), "risk_status");
assert.equal(
  resolveSec8k6kAnalysisPromptFamily({
    route_case: "debt_or_credit_financing",
    primary_route_candidate: { route_type: "financial_risk" },
  }),
  "capital_financing",
);
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "dilution_risk" }), "capital_financing");
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "strategic_transaction" }), "strategic_transaction");
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "shareholder_vote" }), "governance_vote");
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "operating_update" }), "operating_legal_routine");
assert.equal(
  resolveSec8k6kAnalysisPromptFamily({
    route_case: "dilution_or_offering",
    primary_route_candidate: { route_type: "shareholder_vote" },
  }),
  "capital_financing",
);
assert.equal(
  resolveSec8k6kAnalysisPromptFamily({
    route_case: "strategic_transaction",
    primary_route_candidate: { route_type: "shareholder_vote" },
  }),
  "strategic_transaction",
);
assert.equal(resolveSec8k6kAnalysisPromptFamily({ event_type: "fda_clinical" }), "operating_legal_routine");
assert.equal(prompt.responseFormat.json_schema.name, "sec_8k_6k_analysis");
assert.equal(prompt.responseFormat.json_schema.strict, true);
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.event_type.enum,
  SEC_8K_6K_APPROVED_EVENT_TYPES,
);

const riskRuntimeSchema = getSec8k6kSpecializedRuntimeResponseSchema("risk_status") as any;
const capitalRuntimeSchema = getSec8k6kSpecializedRuntimeResponseSchema("capital_financing") as any;
const strategicRuntimeSchema = getSec8k6kSpecializedRuntimeResponseSchema("strategic_transaction") as any;
const governanceRuntimeSchema = getSec8k6kSpecializedRuntimeResponseSchema("governance_vote") as any;
const operatingRuntimeSchema = getSec8k6kSpecializedRuntimeResponseSchema("operating_legal_routine") as any;
assert.ok(riskRuntimeSchema);
assert.ok(capitalRuntimeSchema);
assert.ok(strategicRuntimeSchema);
assert.ok(governanceRuntimeSchema);
assert.ok(operatingRuntimeSchema);
assert.equal(operatingRuntimeSchema.required.includes("debug"), false);
assert.equal("debug" in operatingRuntimeSchema.properties, false);
assert.equal(sec8k6kAnalysisResponseSchema.required.includes("debug"), false);
assert.equal("debug" in sec8k6kAnalysisResponseSchema.properties, false);
assert.equal("security_inventory" in riskRuntimeSchema.properties, false);
assert.equal("display_payload" in riskRuntimeSchema.properties, false);
for (const schema of [riskRuntimeSchema, capitalRuntimeSchema, strategicRuntimeSchema, governanceRuntimeSchema, operatingRuntimeSchema]) {
  assert.equal(schema.required.includes("amendment_delta"), true);
  assert.deepEqual(schema.properties.amendment_delta.properties.change_kind.enum, [
    "not_amendment",
    "clerical_correction",
    "supplemental_update",
    "material_change",
    "unable_to_compare",
  ]);
}
assert.equal("security_inventory" in strategicRuntimeSchema.properties, false);
assert.equal(strategicRuntimeSchema.properties.display_payload.properties.display_type.enum[0], "strategic_transaction");
assert.equal("share_overhang" in strategicRuntimeSchema.properties.display_payload.properties.data.properties, false);
assert.equal(capitalRuntimeSchema.properties.display_payload.properties.display_type.enum[0], "capital_financing");
assert.ok("share_overhang" in capitalRuntimeSchema.properties.display_payload.properties.data.properties);
assert.ok("instrument_details" in capitalRuntimeSchema.properties.display_payload.properties.data.properties);
assert.equal("key_evidence" in capitalRuntimeSchema.properties.analysis_output.properties, false);
assert.equal("what_to_watch_next" in capitalRuntimeSchema.properties.analysis_output.properties, false);
assert.ok(
  capitalRuntimeSchema.properties.analysis_case.enum.includes("debt_or_credit_financing"),
  "ordinary debt financing must be accepted by the capital response schema",
);
assert.match(
  riskRuntimeSchema.properties.analysis_output.properties.listing_status_snapshot.items.properties.value.description,
  /single-line value/i,
);
assert.equal(riskRuntimeSchema.properties.analysis_output.properties.listing_status_snapshot.minItems, 4);
assert.equal(riskRuntimeSchema.properties.analysis_output.properties.listing_status_snapshot.maxItems, 4);
assert.equal(capitalRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.minItems, 4);
assert.equal(capitalRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.maxItems, 4);
assert.equal(strategicRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.minItems, 4);
assert.equal(strategicRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.maxItems, 4);
assert.match(
  strategicRuntimeSchema.properties.analysis_output.properties.key_evidence.description,
  /each no more than 18 words/i,
);
assert.equal(capitalRuntimeSchema.properties.analysis_output.required.includes("key_evidence"), false);
assert.equal(capitalRuntimeSchema.properties.analysis_output.required.includes("what_to_watch_next"), false);
assert.equal(Object.keys(governanceRuntimeSchema.properties)[0], "amendment_delta");
assert.equal(Object.keys(governanceRuntimeSchema.properties)[1], "display_payload");
assert.equal(governanceRuntimeSchema.properties.display_payload.properties.display_type.enum[0], "governance_event");
assert.deepEqual(
  governanceRuntimeSchema.properties.display_payload.properties.data.properties.governance_mode.enum,
  ["leadership_change", "auditor_change", "vote_result", "governance_change", "mixed"],
);
assert.equal(governanceRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.maxItems, 4);
assert.equal(governanceRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.minItems, 4);
assert.equal(governanceRuntimeSchema.properties.display_payload.properties.data.properties.key_changes.maxItems, 4);
assert.equal(
  governanceRuntimeSchema.properties.display_payload.properties.data.properties.key_changes.items.properties.details.maxItems,
  3,
);
assert.deepEqual(governanceRuntimeSchema.properties.display_payload.required, ["display_type", "data"]);
assert.equal("evidence" in governanceRuntimeSchema.properties.display_payload.properties, false);
assert.equal("notes" in governanceRuntimeSchema.properties.display_payload.properties, false);
assert.equal("key_evidence" in governanceRuntimeSchema.properties.analysis_output.properties, false);
assert.equal(governanceRuntimeSchema.properties.analysis_output.required.includes("key_evidence"), false);
assert.equal("what_to_watch_next" in governanceRuntimeSchema.properties.analysis_output.properties, false);
assert.equal(governanceRuntimeSchema.properties.analysis_output.required.includes("what_to_watch_next"), false);
const governanceSemanticWarnings = getSec8k6kGovernanceSemanticWarnings(
  {
    display_type: "governance_event",
    data: {
      governance_mode: "auditor_change",
      snapshot_metrics: [
        { label: "Engagement Date", value: "March 20, 2026", note: "Subject to an engagement letter" },
      ],
      key_changes: [
        {
          details: [
            { label: "Disagreements", value: "None", note: "Except for going concern" },
          ],
        },
      ],
    },
  },
  {
    summary: "The company reported no disagreements except for a going concern paragraph.",
  },
);
assert.equal(governanceSemanticWarnings.length, 3);
assert.equal(
  getSec8k6kGovernanceSemanticWarnings(
    {
      display_type: "governance_event",
      data: {
        governance_mode: "auditor_change",
        snapshot_metrics: [{ label: "Approval Date", value: "March 20, 2026", note: "Subject to an engagement letter" }],
        key_changes: [{ details: [{ label: "Disagreements", value: "None", note: null }] }],
      },
    },
    { summary: "There were no disagreements. The prior report included a going concern paragraph." },
  ).length,
  0,
);

const repairSourceBlocks = (block: Record<string, unknown>) => JSON.stringify({
  cleaned_source_blocks: [block],
});
const repairAnalysisOutput = (
  eventType: string,
  sourceBlockId: string,
  extra: Record<string, unknown> = {},
) => ({
  event_type: eventType,
  summary: "Source-backed filing summary.",
  material_events: [
    {
      role: "primary",
      event_type: eventType,
      event_summary: "Primary filing event.",
      key_terms: [],
      source_block_ids: [sourceBlockId],
    },
  ],
  ...extra,
});

const severeDilutionRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("dilution_risk", "sttk_offering", {
      score: 65,
      signal: "bearish",
      score_reason: "Immediate supply pressure outweighs the funding benefit.",
      score_explanation: { summary: "Immediate supply pressure outweighs the funding benefit." },
    }),
    display_payload: {
      display_type: "capital_financing",
      data: {
        capital_mode: "share_linked_financing",
        snapshot_metrics: [
          { label: "Offering Size", value: "Up to $103 million", note: "Gross proceeds before fees" },
          { label: "Purchase Price", value: "$0.875", note: null },
          { label: "Closing", value: "Expected", note: null },
          { label: "Use of Proceeds", value: "Clinical development", note: null },
        ],
        share_overhang: {
          status_value: "109.9%",
          rows: [
            { label: "Common and pre-funded", numeric_value: 52_635_346, row_role: "counted" },
            { label: "Common warrants", numeric_value: 52_635_346, row_role: "conditional" },
          ],
          basis: { numeric_value: 47_903_215 },
          total_note: { numerator: 52_635_346, denominator: 47_903_215, ratio: "109.9%" },
        },
      },
    },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "sttk_offering",
    exhibit_number: "99.1",
    label: "Private placement terms",
    text: "The private placement is expected to produce gross proceeds of $46 million at closing. If all Common Warrants are exercised, the company may receive additional gross proceeds of $57 million.",
  }),
});
assert.ok(severeDilutionRepairPlan);
assert.ok(severeDilutionRepairPlan.issues.some((issue) => issue.code === "capital_severe_dilution_alert_policy"));
assert.ok(severeDilutionRepairPlan.issues.some((issue) => issue.code === "capital_conditional_proceeds_snapshot"));
assert.ok(severeDilutionRepairPlan.allowedPatchPaths.includes("/analysis_output/score"));
assert.ok(severeDilutionRepairPlan.allowedPatchPaths.includes("/display_payload/data/snapshot_metrics/0/note"));

const omittedProjectEconomicsPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("operating_update", "lar_operating_update", { score: 60, signal: "neutral" }),
    display_payload: {
      display_type: "operating_event",
      data: {
        operating_mode: "operating_update",
        performance_comparisons: [],
        snapshot_metrics: [
          { label: "2024 Production", value: "25,400 tonnes", note: null },
          { label: "Q4 Capacity", value: "85%", note: null },
          { label: "2025 Guidance", value: "30,000-35,000 tonnes", note: null },
          { label: "Operating Focus", value: "Ramp-up", note: null },
        ],
        business_catalysts: [],
        detail_sections: [],
        secondary_updates: [],
      },
    },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "lar_operating_update",
    exhibit_number: "99.2",
    label: "Operations and technical report",
    text: "Stage 1 after-tax NPV (8%) is $3.6 billion. Lithium Argentina owns 44.8%. Estimated operating cost is $6,543 per tonne.",
  }),
});
assert.ok(omittedProjectEconomicsPlan);
assert.ok(omittedProjectEconomicsPlan.issues.some((issue) => issue.code === "operating_project_economics_section_missing"));
assert.deepEqual(omittedProjectEconomicsPlan.allowedPatchPaths, ["/display_payload/data/detail_sections"]);
assert.match(omittedProjectEconomicsPlan.prompt.system, /Never use label or summary at the section level/);
assert.deepEqual(omittedProjectEconomicsPlan.sourceBlockIds, ["lar_operating_update"]);

const auditorIcfrRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("leadership_governance", "fonr_item_4_01", { score: 55, signal: "neutral" }),
    display_payload: {
      display_type: "governance_event",
      data: {
        governance_mode: "auditor_change",
        snapshot_metrics: [
          { label: "Previous Auditor", value: "Marcum", note: null },
          { label: "New Auditor", value: "CohnReznick", note: null },
          { label: "Disagreements", value: "None", note: null },
          { label: "Approval Date", value: "September 23, 2024", note: null },
        ],
        key_changes: [{
          details: [{
            label: "Auditor Reports",
            value: "No qualification, except for an ICFR statement",
            note: "The auditor did not express an opinion on internal control over financial reporting.",
          }],
        }],
      },
    },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "fonr_item_4_01",
    item_number: "4.01",
    label: "Auditor reports",
    text: "The reports contained no adverse opinion, disclaimer, or qualification. Marcum was not engaged to express an opinion on internal control over financial reporting.",
  }),
});
assert.ok(auditorIcfrRepairPlan);
assert.ok(auditorIcfrRepairPlan.issues.some((issue) => issue.code === "governance_auditor_icfr_scope_misclassified_as_qualification"));

const keyEvidenceRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "nkla_item_3_01", {
      score: 92,
      signal: "bearish",
      key_evidence: ["Evidence one", "Evidence two", "Evidence three", "Evidence four"],
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "nkla_item_3_01",
    item_number: "3.01",
    label: "Nasdaq delisting notice",
    text: "Nasdaq will suspend trading after the bankruptcy filing, and the company will not appeal the determination.",
  }),
});
assert.ok(keyEvidenceRepairPlan);
assert.ok(keyEvidenceRepairPlan.issues.some((issue) => issue.code === "key_evidence_count_exceeded"));
assert.equal(keyEvidenceRepairPlan.issues.some((issue) => issue.code === "key_evidence_word_limit_exceeded"), false);
const exactlyEighteenWordEvidence = Array.from(
  { length: 18 },
  (_, index) => `evidence${index + 1}${index === 0 ? "," : ""}`,
).join(" ");
const nineteenWordEvidence = `${exactlyEighteenWordEvidence} evidence19.`;
const keyEvidenceRepairDisplayPayload = {
  display_type: "generic",
  data: {
    snapshot_metrics: [
      { label: "Exchange", value: "Nasdaq", note: null },
      { label: "Status", value: "Delisting notice received", note: null },
      { label: "Trading", value: "Suspension scheduled", note: null },
      { label: "Appeal", value: "Not planned", note: null },
    ],
  },
};
assert.equal(
  getSec8k6kValidationSemanticWarnings({}, { key_evidence: [exactlyEighteenWordEvidence, "Second proof point."] })
    .some((warning) => warning.includes("18-word contract")),
  false,
);
const longKeyEvidenceRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "nkla_item_3_01", {
      key_evidence: ["Short proof point.", nineteenWordEvidence, "Another short proof point."],
      listing_status_snapshot: keyEvidenceRepairDisplayPayload.data.snapshot_metrics,
    }),
    display_payload: keyEvidenceRepairDisplayPayload,
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "nkla_item_3_01",
    item_number: "3.01",
    label: "Nasdaq delisting notice",
    text: "Nasdaq will suspend trading after the bankruptcy filing, and the company will not appeal the determination.",
  }),
});
assert.ok(longKeyEvidenceRepairPlan);
assert.deepEqual(
  longKeyEvidenceRepairPlan.issues
    .filter((issue) => issue.code.startsWith("key_evidence_"))
    .map((issue) => issue.code),
  ["key_evidence_word_limit_exceeded"],
);
assert.deepEqual(longKeyEvidenceRepairPlan.allowedPatchPaths, ["/analysis_output/key_evidence"]);
const combinedKeyEvidenceRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "nkla_item_3_01", {
      key_evidence: ["Evidence one", "Evidence two", nineteenWordEvidence, "Evidence four"],
      listing_status_snapshot: keyEvidenceRepairDisplayPayload.data.snapshot_metrics,
    }),
    display_payload: keyEvidenceRepairDisplayPayload,
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "nkla_item_3_01",
    item_number: "3.01",
    label: "Nasdaq delisting notice",
    text: "Nasdaq will suspend trading after the bankruptcy filing, and the company will not appeal the determination.",
  }),
});
assert.ok(combinedKeyEvidenceRepairPlan);
assert.deepEqual(
  combinedKeyEvidenceRepairPlan.issues
    .filter((issue) => issue.code.startsWith("key_evidence_"))
    .map((issue) => issue.code),
  ["key_evidence_count_exceeded", "key_evidence_word_limit_exceeded"],
);
assert.match(combinedKeyEvidenceRepairPlan.prompt.system, /Each item must be no more than 18 words/);
const keyEvidenceRepairApplied = applySec8k6kValidationRepairPatches({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "nkla_item_3_01", {
      key_evidence: ["Evidence one", "Evidence two", "Evidence three", "Evidence four"],
    }),
  },
  repairResult: {
    patches: [{
      path: "/analysis_output/key_evidence",
      value: JSON.stringify(["Bankruptcy triggered Nasdaq delisting.", "Trading suspension is scheduled.", "The company will not appeal."]),
    }],
    unresolved_warning_codes: [],
  },
  allowedPatchPaths: keyEvidenceRepairPlan.allowedPatchPaths,
});
assert.equal(
  ((keyEvidenceRepairApplied.analysisResult.analysis_output as Record<string, unknown>).key_evidence as string[]).length,
  3,
);
assert.ok(
  ((keyEvidenceRepairApplied.analysisResult.analysis_output as Record<string, unknown>).key_evidence as string[])
    .every((item) => item.trim().split(/\s+/).length <= 18),
);
const rejectedLongKeyEvidenceRepair = applySec8k6kValidationRepairPatches({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "nkla_item_3_01", {
      key_evidence: ["Existing evidence one.", nineteenWordEvidence],
    }),
  },
  repairResult: {
    patches: [{
      path: "/analysis_output/key_evidence",
      value: JSON.stringify(["Valid replacement.", nineteenWordEvidence]),
    }],
    unresolved_warning_codes: [],
  },
  allowedPatchPaths: longKeyEvidenceRepairPlan.allowedPatchPaths,
});
assert.deepEqual(rejectedLongKeyEvidenceRepair.appliedPatchPaths, []);
assert.deepEqual(rejectedLongKeyEvidenceRepair.ignoredPatchPaths, ["/analysis_output/key_evidence"]);

const riskRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "risk_item_3_01", {
      listing_status_snapshot: [
        { label: "Delisting Date", value: "July 1, 2026", note: "Expected if the appeal is denied" },
      ],
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "risk_item_3_01",
    item_number: "3.01",
    label: "Notice of Delisting",
    text: "The company expects delisting on July 1, 2026 if its appeal is denied.",
  }),
  additionalSourceBlocks: () => [
    {
      block_id: "historical_risk_item_3_01",
      block_type: "parent_filing_source_block",
      origin: "integration.amendment_repair.parser.item_section",
      item_number: "3.01",
      label: "Original Item 3.01",
      text: "The original filing described a conditional delisting process subject to appeal.",
    },
  ],
});
assert.ok(riskRepairPlan);
assert.ok(riskRepairPlan.issues.some((issue) => issue.code === "risk_conditional_state_label_0"));
assert.ok(riskRepairPlan.sourceBlockIds.includes("risk_item_3_01"));
assert.ok(riskRepairPlan.sourceBlockIds.includes("historical_risk_item_3_01"));
assert.ok(riskRepairPlan.sourceBlockIds.length <= 3);

const listingSuspensionDateRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "sleep_number_item_3_01", {
      event_title: "Sleep Number common stock to be delisted after bankruptcy filing",
      quick_take: "Nasdaq will delist Sleep Number common stock effective June 23, 2026.",
      score_reason: "Trading access is ending after the bankruptcy filing.",
      listing_status_snapshot: [
        { label: "Trading Suspension", value: "June 23, 2026", note: "Form 25-NSE will follow" },
        { label: "Company Response", value: "No appeal", note: null },
        { label: "Primary Reason", value: "Chapter 11", note: null },
        { label: "Continued Venue", value: "OTC possible", note: "Not assured" },
      ],
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "sleep_number_item_3_01",
    item_number: "3.01",
    label: "Notice of Delisting",
    text: "Trading on Nasdaq of the Company's common stock will be suspended at the beginning of business on June 23, 2026. Nasdaq will file a Form 25-NSE with the SEC to remove the common stock from Nasdaq.",
  }),
});
assert.ok(listingSuspensionDateRepairPlan);
assert.ok(
  listingSuspensionDateRepairPlan.issues.some(
    (issue) => issue.code === "risk_listing_suspension_date_misclassified_as_removal",
  ),
);
assert.ok(listingSuspensionDateRepairPlan.allowedPatchPaths.includes("/analysis_output/quick_take"));
assert.deepEqual(listingSuspensionDateRepairPlan.sourceBlockIds, ["sleep_number_item_3_01"]);

const correctListingSuspensionDatePlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("listing_risk", "sleep_number_item_3_01", {
      event_title: "Sleep Number common stock to be delisted after bankruptcy filing",
      quick_take: "Nasdaq trading will be suspended on June 23, 2026, with a Form 25-NSE removal filing to follow.",
      score_reason: "Trading access is ending after the bankruptcy filing.",
      listing_status_snapshot: [
        { label: "Trading Suspension", value: "June 23, 2026", note: "Form 25-NSE will follow" },
        { label: "Company Response", value: "No appeal", note: null },
        { label: "Primary Reason", value: "Chapter 11", note: null },
        { label: "Continued Venue", value: "OTC possible", note: "Not assured" },
      ],
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "sleep_number_item_3_01",
    item_number: "3.01",
    label: "Notice of Delisting",
    text: "Trading on Nasdaq of the Company's common stock will be suspended at the beginning of business on June 23, 2026. Nasdaq will file a Form 25-NSE with the SEC to remove the common stock from Nasdaq.",
  }),
});
assert.equal(correctListingSuspensionDatePlan, null);

const amendmentRepairAnalysis = {
  amendment_delta: {
    is_amendment: true,
    change_kind: "material_change",
    changed_fields: ["CUSIP"],
    unchanged_parent_event: false,
    investor_impact: "The reverse split terms changed.",
    parent_accession: "0001213900-25-124899",
    source_block_ids: ["current_amendment_block"],
  },
  analysis_output: repairAnalysisOutput("dilution_risk", "current_amendment_block", {
    score: 80,
    signal: "bearish",
    event_title: "Company announces reverse stock split",
    quick_take: "The company announced a reverse stock split.",
    score_reason: "The reverse stock split creates material listing pressure.",
    score_explanation: { summary: "The reverse stock split creates material listing pressure." },
  }),
  display_payload: {
    display_type: "capital_financing",
    data: { snapshot_metrics: [] },
  },
};
const amendmentRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: amendmentRepairAnalysis,
  analysisPromptUser: JSON.stringify({
    current_filing: { form_type: "6-K/A" },
    cleaned_source_blocks: [
      {
        block_id: "current_amendment_block",
        block_type: "item_section",
        origin: "parser.item_section",
        label: "Amendment",
        text: "This amendment corrects the CUSIP number. All other information remains unchanged.",
      },
    ],
  }),
  additionalSourceBlocks: () => [
    {
      block_id: "parent_reverse_split_block",
      block_type: "parent_filing_source_block",
      origin: "integration.amendment_repair.parser.item_section",
      label: "Original filing",
      text: "The original filing announced a 1-for-25 reverse stock split.",
    },
  ],
});
assert.ok(amendmentRepairPlan);
assert.ok(amendmentRepairPlan.issues.some((issue) => issue.code === "amendment_parent_comparison_required"));
assert.ok(amendmentRepairPlan.sourceBlockIds.includes("current_amendment_block"));
assert.ok(amendmentRepairPlan.sourceBlockIds.includes("parent_reverse_split_block"));
assert.ok(amendmentRepairPlan.sourceBlockIds.length <= 3);
const amendedAsClerical = applySec8k6kValidationRepairPatches({
  analysisResult: amendmentRepairAnalysis,
  allowedPatchPaths: amendmentRepairPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      { path: "/amendment_delta/is_amendment", value: "true" },
      { path: "/amendment_delta/change_kind", value: "clerical_correction" },
      { path: "/amendment_delta/changed_fields", value: '["CUSIP"]' },
      { path: "/amendment_delta/unchanged_parent_event", value: "true" },
      { path: "/amendment_delta/investor_impact", value: "The correction does not change the reverse split terms." },
      { path: "/amendment_delta/source_block_ids", value: '["current_amendment_block","parent_reverse_split_block"]' },
    ],
    unresolved_warning_codes: [],
  },
});
const repairedAmendmentDelta = amendedAsClerical.analysisResult.amendment_delta as Record<string, unknown>;
assert.equal(repairedAmendmentDelta.change_kind, "clerical_correction");
assert.equal(repairedAmendmentDelta.unchanged_parent_event, true);
assert.deepEqual(repairedAmendmentDelta.changed_fields, ["CUSIP"]);

const capitalRepairAnalysis = {
  analysis_output: repairAnalysisOutput("dilution_risk", "capital_item_3_02"),
  display_payload: {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      share_overhang: {
        status_value: "65.5% vs. Current Shares",
        rows: [
          {
            row_role: "conditional",
            label: "Pre-Funded Warrant Shares",
            value: "10,000,000 shares",
            numeric_value: 10_000_000,
          },
        ],
        total_note: { numerator: "10,000,000", denominator: "20,000,000", ratio: "0.5" },
      },
    },
  },
};
const capitalRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: capitalRepairAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "capital_item_3_02",
    item_number: "3.02",
    label: "Unregistered Sale of Equity Securities",
    text: "The company issued pre-funded warrants to purchase 10,000,000 shares at a nominal exercise price.",
  }),
});
assert.ok(capitalRepairPlan);
assert.ok(capitalRepairPlan.issues.some((issue) => issue.code === "capital_prefunded_role_0"));
assert.ok(capitalRepairPlan.allowedPatchPaths.includes("/display_payload/data/share_overhang/rows/0/row_role"));

const strategicRepairAnalysis = {
  analysis_output: repairAnalysisOutput("strategic_transaction", "strategic_item_2_01", {
    summary: "The merger was completed and the target was acquired.",
  }),
  display_payload: {
    display_type: "strategic_transaction",
    data: {
      snapshot_metrics: [
        { label: "Closing Date", value: "Q4 2026", note: "Expected subject to shareholder approval" },
        { label: "Deal Status", value: "Pending", note: "Subject to closing conditions" },
      ],
    },
  },
};
const strategicRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: strategicRepairAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "strategic_item_2_01",
    item_number: "2.01",
    label: "Transaction Agreement",
    text: "The parties expect the merger to close in the fourth quarter subject to shareholder approval and other closing conditions.",
  }),
});
assert.ok(strategicRepairPlan);
assert.ok(strategicRepairPlan.issues.some((issue) => issue.code === "strategic_conditional_state_label_0"));
assert.ok(strategicRepairPlan.issues.some((issue) => issue.code === "strategic_summary_conflicts_with_pending_status"));

const operatingRepairAnalysis = {
  analysis_output: repairAnalysisOutput("earnings", "operating_item_2_02"),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "earnings",
      performance_comparisons: [
        {
          label: "Revenue",
          current_label: "Q1 2026",
          current_value: "$120M",
          current_numeric: 120,
          comparison_label: "Q1 2025",
          comparison_value: "$100M",
          comparison_numeric: 100,
          comparison_basis: "qoq",
          change_note: "Down 20%",
        },
      ],
    },
  },
};
const operatingRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: operatingRepairAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_item_2_02",
    item_number: "2.02",
    label: "Results of Operations",
    text: "Revenue increased from $100 million in Q1 2025 to $120 million in Q1 2026.",
  }),
});
assert.ok(operatingRepairPlan);
assert.ok(operatingRepairPlan.issues.some((issue) => issue.code === "operating_comparison_basis_0"));
assert.ok(operatingRepairPlan.issues.some((issue) => issue.code === "operating_change_note_direction_0"));
assert.equal(
  getSec8k6kValidationSemanticWarnings(
    operatingRepairAnalysis.display_payload,
    operatingRepairAnalysis.analysis_output,
  ).length,
  3,
);

const mixedAlertEarningsAnalysis = {
  analysis_output: repairAnalysisOutput("earnings", "worthington_item_2_02", {
    score: 75,
    signal: "bearish",
    score_reason: "The score is high because adjusted profitability deteriorated.",
    score_explanation: {
      summary: "Lower adjusted earnings warrant an alert-level score.",
    },
  }),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "earnings",
      snapshot_metrics: [
        { label: "Net Loss per Diluted Share", value: "$0.98", note: "Fiscal 2025" },
        { label: "Net Sales", value: "$3.8B", note: "Fiscal 2025" },
        { label: "Operating Income", value: "$54.0M", note: "Fiscal 2025" },
        { label: "Non-Cash Impairment", value: "$180.0M", note: "Fiscal 2025" },
      ],
      performance_comparisons: [
        {
          label: "Net Sales",
          current_label: "FY 2025",
          current_value: "$3.8B",
          current_numeric: 3.8,
          comparison_label: "FY 2024",
          comparison_value: "$3.4B",
          comparison_numeric: 3.4,
          comparison_basis: "yoy",
          change_note: "Up 12% YoY",
        },
        {
          label: "Operating Income",
          current_label: "FY 2025",
          current_value: "$54.0M",
          current_numeric: 54,
          comparison_label: "FY 2024",
          comparison_value: "$70.1M",
          comparison_numeric: 70.1,
          comparison_basis: "yoy",
          change_note: "Down 23% YoY",
        },
      ],
    },
  },
};
const mixedAlertEarningsRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: mixedAlertEarningsAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "worthington_item_2_02",
    item_number: "2.02",
    label: "Results of Operations",
    text: "Net sales increased 12%. Adjusted EBIT declined from $70.1 million to $54.0 million. Net loss per diluted share was $(0.98), including a non-cash impairment charge.",
  }),
});
assert.ok(mixedAlertEarningsRepairPlan);
assert.ok(
  mixedAlertEarningsRepairPlan.issues.some((issue) => issue.code === "score_rationale_meta_language"),
);
assert.ok(
  mixedAlertEarningsRepairPlan.issues.some((issue) => issue.code === "operating_snapshot_sign_conflict_0"),
);
assert.ok(
  mixedAlertEarningsRepairPlan.issues.some((issue) => issue.code === "operating_earnings_alert_offset_missing"),
);
assert.ok(mixedAlertEarningsRepairPlan.allowedPatchPaths.includes("/analysis_output/score"));
const repairedMixedAlertEarnings = applySec8k6kValidationRepairPatches({
  analysisResult: mixedAlertEarningsAnalysis,
  allowedPatchPaths: mixedAlertEarningsRepairPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      { path: "/display_payload/data/snapshot_metrics/0/value", value: "($0.98)" },
      { path: "/analysis_output/score", value: "70" },
      { path: "/analysis_output/signal", value: "volatile" },
      {
        path: "/analysis_output/score_reason",
        value: "Sales growth partly offsets weaker adjusted profitability, leaving a meaningful but non-urgent earnings deterioration.",
      },
      {
        path: "/analysis_output/score_explanation/summary",
        value: "Sales growth partly offsets weaker adjusted profitability, leaving a meaningful but non-urgent earnings deterioration.",
      },
    ],
    unresolved_warning_codes: [],
  },
});
assert.equal(
  ((repairedMixedAlertEarnings.analysisResult.display_payload as Record<string, any>).data.snapshot_metrics[0] as Record<string, unknown>).value,
  "($0.98)",
);
assert.equal((repairedMixedAlertEarnings.analysisResult.analysis_output as Record<string, unknown>).score, 70);
assert.equal((repairedMixedAlertEarnings.analysisResult.analysis_output as Record<string, unknown>).signal, "volatile");
assert.equal(
  getSec8k6kValidationSemanticWarnings(
    repairedMixedAlertEarnings.analysisResult.display_payload as Record<string, unknown>,
    repairedMixedAlertEarnings.analysisResult.analysis_output as Record<string, unknown>,
  ).length,
  0,
);

const nonCashAlertReviewAnalysis = {
  analysis_output: repairAnalysisOutput("earnings", "worthington_non_cash_item", {
    score: 75,
    signal: "bearish",
    summary: "Net sales increased, while a non-cash impairment charge drove a reported operating loss.",
    score_reason: "Higher sales partly offset the reported loss caused primarily by impairment charges.",
    score_explanation: {
      summary: "Despite higher sales, impairment charges drove a reported loss and weaker headline earnings.",
    },
  }),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "earnings",
      snapshot_metrics: [
        { label: "Operating Loss", value: "($57.6M)", note: "Primarily due to impairments" },
      ],
      performance_comparisons: [
        {
          label: "Net Sales",
          current_label: "Q4 2026",
          current_value: "$929.2M",
          current_numeric: 929.2,
          comparison_label: "Q4 2025",
          comparison_value: "$832.9M",
          comparison_numeric: 832.9,
          comparison_basis: "yoy",
          change_note: "Up 12% YoY",
        },
        {
          label: "Operating Income (Loss)",
          current_label: "Q4 2026",
          current_value: "($57.6M)",
          current_numeric: -57.6,
          comparison_label: "Q4 2025",
          comparison_value: "$66.4M",
          comparison_numeric: 66.4,
          comparison_basis: "yoy",
          change_note: "Swung to a loss YoY",
        },
      ],
    },
  },
};
const nonCashAlertReviewPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: nonCashAlertReviewAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "worthington_non_cash_item",
    item_number: "2.02",
    label: "Results of Operations",
    text: "Net sales increased 12% to $929.2 million. The operating loss included $94.5 million of goodwill and long-lived asset impairment charges. Adjusted EBIT was $54.0 million.",
  }),
});
assert.ok(nonCashAlertReviewPlan);
assert.ok(
  nonCashAlertReviewPlan.issues.some((issue) => issue.code === "operating_earnings_alert_offset_missing"),
);

const nonCashGainAlertAnalysis = {
  analysis_output: repairAnalysisOutput("earnings", "ondas_amendment_exhibit_99_1", {
    score: 75,
    signal: "bullish",
    summary: "Reported net income turned positive after a large warrant-liability fair-value gain, while adjusted EBITDA remained negative.",
    score_reason: "The reported profit reversal and unchanged revenue outlook support a strong positive earnings event.",
    score_explanation: {
      summary: "The large net-income reversal outweighs continued adjusted losses.",
    },
  }),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "earnings",
      snapshot_metrics: [
        { label: "Q4 Revenue", value: "$29.1M-$30.1M", note: "Unchanged" },
        { label: "Q4 Net Income", value: "$82.9M-$83.4M", note: "Revised from a loss" },
        { label: "FY Revenue", value: "$49.7M-$50.7M", note: "Unchanged" },
        { label: "FY Net Income", value: "$50.4M-$50.9M", note: "Revised from a loss" },
      ],
      performance_comparisons: [],
    },
  },
};
const nonCashGainAlertRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: nonCashGainAlertAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "ondas_amendment_exhibit_99_1",
    exhibit_number: "99.1",
    label: "Revised preliminary financial results",
    text: "The revision reflects an approximately $102 million non-cash gain from the change in fair value of warrant liabilities. Revenue guidance was unchanged. Q4 adjusted EBITDA remained negative at approximately $(9.9) million to $(9.4) million.",
  }),
});
assert.ok(nonCashGainAlertRepairPlan);
assert.ok(
  nonCashGainAlertRepairPlan.issues.some(
    (issue) => issue.code === "operating_earnings_alert_noncash_gain_dominant",
  ),
);
assert.ok(nonCashGainAlertRepairPlan.allowedPatchPaths.includes("/analysis_output/summary"));
assert.ok(nonCashGainAlertRepairPlan.allowedPatchPaths.includes("/analysis_output/score"));

const mixedPeriodOperatingAnalysis = {
  analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_2"),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "operating_update",
      snapshot_metrics: [
        { label: "Q4 Production", value: "8,500 tonnes", note: "Q4 2024" },
        { label: "Prior Quarter", value: "6,800 tonnes", note: "Q3 2024" },
        { label: "Full-Year Production", value: "25,400 tonnes", note: "FY 2024" },
        { label: "Quarterly Growth", value: "25%", note: "Q4 versus Q3" },
      ],
      performance_comparisons: [
        {
          label: "Lithium Carbonate Production",
          current_label: "2024",
          current_value: "25,400 tonnes",
          current_numeric: 25400,
          comparison_label: "Q3 2024",
          comparison_value: "6,800 tonnes",
          comparison_numeric: 6800,
          comparison_basis: "other",
          change_note: "Up 274%",
        },
      ],
    },
  },
};
const mixedPeriodRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: mixedPeriodOperatingAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_exhibit_99_2",
    exhibit_number: "99.2",
    label: "2024 production results",
    text: "Fourth quarter 2024 production was approximately 8,500 tonnes, a 25% increase from 6,800 tonnes in the third quarter of 2024. Full-year 2024 production was approximately 25,400 tonnes.",
  }),
});
assert.ok(mixedPeriodRepairPlan);
assert.ok(mixedPeriodRepairPlan.issues.some((issue) => issue.code === "operating_comparison_period_scope_0"));
assert.ok(
  mixedPeriodRepairPlan.allowedPatchPaths.includes(
    "/display_payload/data/performance_comparisons/0/current_numeric",
  ),
);
const mixedPeriodRepairResult = applySec8k6kValidationRepairPatches({
  analysisResult: mixedPeriodOperatingAnalysis,
  allowedPatchPaths: mixedPeriodRepairPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      { path: "/display_payload/data/performance_comparisons/0/current_label", value: "Q4 2024" },
      { path: "/display_payload/data/performance_comparisons/0/current_value", value: "8,500 tonnes" },
      { path: "/display_payload/data/performance_comparisons/0/current_numeric", value: "8500" },
      { path: "/display_payload/data/performance_comparisons/0/comparison_basis", value: "qoq" },
      { path: "/display_payload/data/performance_comparisons/0/change_note", value: "Up 25% QoQ" },
    ],
    unresolved_warning_codes: [],
  },
});
const repairedMixedPeriodDisplay = mixedPeriodRepairResult.analysisResult.display_payload as Record<string, unknown>;
const repairedMixedPeriodData = repairedMixedPeriodDisplay.data as Record<string, unknown>;
const repairedMixedPeriodComparison = (repairedMixedPeriodData.performance_comparisons as Array<Record<string, unknown>>)[0];
assert.equal(repairedMixedPeriodComparison.current_numeric, 8500);
assert.equal(repairedMixedPeriodComparison.current_label, "Q4 2024");
assert.equal(
  getSec8k6kValidationSemanticWarnings(
    repairedMixedPeriodDisplay,
    mixedPeriodRepairResult.analysisResult.analysis_output as Record<string, unknown>,
  ).length,
  0,
);

const projectEconomicsTitleAnalysis = {
  analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_1"),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "operating_update",
      performance_comparisons: [],
      detail_sections: [
        {
          title: "Project Details",
          rows: [
            { label: "Ownership", value: "44.8%", note: null },
            { label: "After-Tax NPV (8%)", value: "$3.6B", note: "Stage 1" },
          ],
        },
      ],
    },
  },
};
const projectEconomicsTitlePlan = buildSec8k6kValidationRepairPlan({
  analysisResult: projectEconomicsTitleAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_exhibit_99_1",
    exhibit_number: "99.1",
    label: "Technical report economics",
    text: "Lithium Argentina owns 44.8% and the Stage 1 after-tax NPV (8%) is $3.6 billion.",
  }),
});
assert.ok(projectEconomicsTitlePlan);
assert.ok(
  projectEconomicsTitlePlan.issues.some((issue) => issue.code === "operating_project_economics_title_0"),
);
assert.ok(
  projectEconomicsTitlePlan.allowedPatchPaths.includes("/display_payload/data/detail_sections/0/title"),
);

const nonFinancialEarningsAnalysis = {
  analysis_output: {
    ...repairAnalysisOutput("earnings", "operating_exhibit_99_2"),
    material_events: [
      {
        role: "primary",
        event_type: "earnings",
        event_summary: "Production results and production guidance were updated.",
        key_terms: ["25,400 tonnes", "30,000-35,000 tonnes"],
        source_block_ids: ["operating_exhibit_99_2"],
      },
    ],
  },
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "earnings",
      snapshot_title: "Earnings Snapshot",
      snapshot_metrics: [{ label: "2024 Production", value: "25,400 tonnes", note: null }],
      performance_comparisons: [
        {
          label: "Lithium Carbonate Production",
          current_label: "Q4 2024",
          current_value: "8,500 tonnes",
          current_numeric: 8500,
          comparison_label: "Q3 2024",
          comparison_value: "6,800 tonnes",
          comparison_numeric: 6800,
          comparison_basis: "qoq",
          change_note: "Up 25% QoQ",
        },
      ],
      guidance_metrics: [
        {
          label: "Lithium Carbonate Production",
          guidance_label: "2025",
          guidance_value: "30,000-35,000 tonnes",
        },
      ],
      business_catalysts: [],
      detail_sections: [],
      secondary_updates: [],
    },
  },
};
const nonFinancialEarningsPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: nonFinancialEarningsAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_exhibit_99_2",
    exhibit_number: "99.2",
    label: "Production update",
    text: "The operation produced 25,400 tonnes in 2024 and expects 30,000 to 35,000 tonnes in 2025.",
  }),
});
assert.ok(nonFinancialEarningsPlan);
assert.ok(
  nonFinancialEarningsPlan.issues.some(
    (issue) => issue.code === "operating_nonfinancial_performance_misclassified_as_earnings",
  ),
);
assert.ok(nonFinancialEarningsPlan.allowedPatchPaths.includes("/analysis_output/event_type"));
assert.ok(nonFinancialEarningsPlan.allowedPatchPaths.includes("/display_payload/data/operating_mode"));
const rejectedOperatingModePatch = applySec8k6kValidationRepairPatches({
  analysisResult: nonFinancialEarningsAnalysis,
  allowedPatchPaths: nonFinancialEarningsPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      { path: "/analysis_output/event_type", value: "operating_results" },
      { path: "/display_payload/data/operating_mode", value: "operating_results" },
    ],
    unresolved_warning_codes: [],
  },
});
assert.deepEqual(rejectedOperatingModePatch.appliedPatchPaths, []);
assert.equal(rejectedOperatingModePatch.ignoredPatchPaths.length, 2);
const repairedOperatingModePatch = applySec8k6kValidationRepairPatches({
  analysisResult: nonFinancialEarningsAnalysis,
  allowedPatchPaths: nonFinancialEarningsPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      { path: "/analysis_output/event_type", value: "operating_update" },
      { path: "/analysis_output/material_events/0/event_type", value: "operating_update" },
      { path: "/display_payload/data/operating_mode", value: "operating_update" },
      { path: "/display_payload/data/snapshot_title", value: "Operating Snapshot" },
    ],
    unresolved_warning_codes: [],
  },
});
assert.equal(
  (repairedOperatingModePatch.analysisResult.analysis_output as Record<string, unknown>).event_type,
  "operating_update",
);
assert.equal(
  ((repairedOperatingModePatch.analysisResult.display_payload as Record<string, unknown>).data as Record<string, unknown>)
    .operating_mode,
  "operating_update",
);

const offeringRecapRationaleAnalysis = {
  analysis_output: repairAnalysisOutput("dilution_risk", "abivax_offering", {
    score: 75,
    signal: "bearish",
    score_reason: "The offering of 10,156,000 ADSs at $64.00 per ADS, raising approximately $608.6 million, presents a material dilution risk for existing shareholders.",
    score_explanation: {
      summary: "The company issued 10,156,000 ADSs and raised approximately $608.6 million through the offering.",
    },
  }),
  display_payload: { display_type: "generic", data: {} },
};
const offeringRecapRationaleRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: offeringRecapRationaleAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "abivax_offering",
    item_number: "8.01",
    label: "ADS Offering",
    text: "The company offered 10,156,000 ADSs at $64.00 per ADS and expected net proceeds of approximately $608.6 million.",
  }),
});
assert.ok(offeringRecapRationaleRepairPlan);
assert.ok(
  offeringRecapRationaleRepairPlan.issues.some(
    (issue) => issue.code === "score_rationale_filing_recap",
  ),
);
assert.ok(offeringRecapRationaleRepairPlan.allowedPatchPaths.includes("/analysis_output/score_reason"));
assert.ok(offeringRecapRationaleRepairPlan.allowedPatchPaths.includes("/analysis_output/score_explanation/summary"));
assert.ok(offeringRecapRationaleRepairPlan.prompt.system.includes("12-24 word analyst bottom line"));
assert.ok(!offeringRecapRationaleRepairPlan.prompt.system.includes("operating_project_economics_section_missing"));

const offeringSizeRecapRationaleRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("dilution_risk", "abivax_offering", {
      score: 65,
      signal: "bearish",
      score_reason: "The offering size represents a significant dilution risk for existing shareholders, particularly given the company's market capitalization.",
      score_explanation: {
        summary: "The score reflects a material dilution risk from the ADS offering.",
      },
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "abivax_offering",
    item_number: "8.01",
    label: "ADS Offering",
    text: "The company offered 10,156,000 ADSs at $64.00 per ADS and expected net proceeds of approximately $608.6 million.",
  }),
});
assert.ok(offeringSizeRecapRationaleRepairPlan);
assert.ok(
  offeringSizeRecapRationaleRepairPlan.issues.some(
    (issue) => issue.code === "score_rationale_filing_recap",
  ),
);
assert.ok(
  offeringSizeRecapRationaleRepairPlan.issues.some(
    (issue) => issue.code === "score_rationale_meta_language",
  ),
);
const offeringSizeFallbackResult = applySec8k6kValidationRepairPatches({
  analysisResult: offeringRecapRationaleAnalysis,
  allowedPatchPaths: offeringSizeRecapRationaleRepairPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      {
        path: "/analysis_output/score_reason",
        value: "The offering size represents a significant dilution risk for existing shareholders.",
      },
      {
        path: "/analysis_output/score_explanation/summary",
        value: "The score reflects a material dilution risk from the ADS offering.",
      },
    ],
    unresolved_warning_codes: [],
  },
});
assert.deepEqual(offeringSizeFallbackResult.rationaleFallbackPaths, [
  "/analysis_output/score_reason",
  "/analysis_output/score_explanation/summary",
]);
assert.equal(
  (offeringSizeFallbackResult.analysisResult.analysis_output as Record<string, unknown>).score_reason,
  "Immediate equity supply creates meaningful ownership dilution, while added liquidity provides a partial balance-sheet offset.",
);

const analyticalOfferingRationalePlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("dilution_risk", "abivax_offering", {
      score: 75,
      signal: "bearish",
      score_reason: "Immediate equity supply creates meaningful ownership dilution, partly offset by a substantially stronger cash position.",
      score_explanation: {
        summary: "Confirmed issuance makes dilution immediate, while the resulting liquidity provides a meaningful balance-sheet offset.",
      },
    }),
    display_payload: { display_type: "generic", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "abivax_offering",
    item_number: "8.01",
    label: "ADS Offering",
    text: "The company offered 10,156,000 ADSs at $64.00 per ADS and expected net proceeds of approximately $608.6 million.",
  }),
});
assert.equal(analyticalOfferingRationalePlan, null);

const regulatoryEventTypeAnalysis = {
  analysis_output: repairAnalysisOutput("product_update", "fda_exhibit_99_1"),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "product_or_regulatory",
      regulatory_stage: "approval",
      snapshot_metrics: [],
      performance_comparisons: [],
      guidance_metrics: [],
      business_catalysts: [],
      detail_sections: [],
      secondary_updates: [],
    },
  },
};
const regulatoryEventTypePlan = buildSec8k6kValidationRepairPlan({
  analysisResult: regulatoryEventTypeAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "fda_exhibit_99_1",
    exhibit_number: "99.1",
    label: "FDA approval",
    text: "The FDA approved the company's therapy for the disclosed indication.",
  }),
});
assert.ok(regulatoryEventTypePlan);
assert.ok(
  regulatoryEventTypePlan.issues.some(
    (issue) => issue.code === "operating_regulatory_event_type_mismatch",
  ),
);
assert.ok(regulatoryEventTypePlan.allowedPatchPaths.includes("/analysis_output/event_type"));
assert.ok(regulatoryEventTypePlan.allowedPatchPaths.includes("/analysis_output/material_events/0/event_type"));

const splitProjectEconomicsAnalysis = {
  analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_1"),
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "operating_update",
      performance_comparisons: [],
      snapshot_metrics: [
        { label: "2024 Production", value: "25,400 tonnes", note: null },
        { label: "After-Tax NPV", value: "$3.6B", note: "Stage 1" },
      ],
      business_catalysts: [
        {
          title: "Long-Term Operating Cost",
          value: "$6,543/tonne",
          summary: "The technical report estimates long-term unit operating costs.",
        },
      ],
      detail_sections: [
        {
          title: "Project Economics",
          rows: [{ label: "Company Ownership", value: "44.8%", note: null }],
        },
      ],
      secondary_updates: [],
    },
  },
};
const splitProjectEconomicsPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: splitProjectEconomicsAnalysis,
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_exhibit_99_1",
    exhibit_number: "99.1",
    label: "Technical report economics",
    text: "Lithium Argentina owns 44.8%. Stage 1 after-tax NPV (8%) is $3.6 billion and long-term operating cost is $6,543 per tonne.",
  }),
});
assert.ok(splitProjectEconomicsPlan);
assert.ok(
  splitProjectEconomicsPlan.issues.some(
    (issue) => issue.code === "operating_project_economics_section_incomplete",
  ),
);
assert.ok(
  splitProjectEconomicsPlan.allowedPatchPaths.includes("/display_payload/data/snapshot_metrics"),
);
assert.ok(
  splitProjectEconomicsPlan.allowedPatchPaths.includes("/display_payload/data/business_catalysts"),
);
const consolidatedProjectEconomics = applySec8k6kValidationRepairPatches({
  analysisResult: splitProjectEconomicsAnalysis,
  allowedPatchPaths: splitProjectEconomicsPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      {
        path: "/display_payload/data/snapshot_metrics",
        value: JSON.stringify([{ label: "2024 Production", value: "25,400 tonnes", note: null }]),
      },
      {
        path: "/display_payload/data/business_catalysts",
        value: JSON.stringify([]),
      },
      {
        path: "/display_payload/data/detail_sections",
        value: JSON.stringify([
          {
            title: "Project Economics",
            rows: [
              { label: "After-Tax NPV (8%)", value: "$3.6B", note: "Stage 1" },
              { label: "Company Ownership", value: "44.8%", note: null },
              { label: "Long-Term Operating Cost", value: "$6,543/tonne", note: null },
            ],
          },
        ]),
      },
    ],
    unresolved_warning_codes: [],
  },
});
const consolidatedProjectData = (
  consolidatedProjectEconomics.analysisResult.display_payload as Record<string, unknown>
).data as Record<string, unknown>;
assert.equal((consolidatedProjectData.snapshot_metrics as unknown[]).length, 1);
assert.equal((consolidatedProjectData.business_catalysts as unknown[]).length, 0);
assert.equal(
  (((consolidatedProjectData.detail_sections as Array<Record<string, unknown>>)[0]).rows as unknown[]).length,
  3,
);

const singleObjectProjectEconomicsPatch = applySec8k6kValidationRepairPatches({
  analysisResult: {
    analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_1"),
    display_payload: {
      display_type: "operating_event",
      data: {
        operating_mode: "operating_update",
        snapshot_metrics: [
          { label: "2024 Production", value: "25,400 tonnes", note: null },
          { label: "After-Tax NPV", value: "$3.6B", note: "Stage 1" },
        ],
        business_catalysts: [],
        detail_sections: [],
      },
    },
  },
  allowedPatchPaths: [
    "/display_payload/data/snapshot_metrics",
    "/display_payload/data/business_catalysts",
    "/display_payload/data/detail_sections",
  ],
  repairResult: {
    patches: [
      {
        path: "/display_payload/data/snapshot_metrics",
        value: JSON.stringify([{ label: "2024 Production", value: "25,400 tonnes", note: null }]),
      },
      {
        path: "/display_payload/data/detail_sections",
        value: JSON.stringify({
          title: "Project Economics",
          rows: [{ label: "After-Tax NPV (8%)", value: "$3.6B", note: "Stage 1" }],
        }),
      },
    ],
    unresolved_warning_codes: [],
  },
});
const singleObjectProjectData = (
  singleObjectProjectEconomicsPatch.analysisResult.display_payload as Record<string, unknown>
).data as Record<string, unknown>;
assert.equal((singleObjectProjectData.snapshot_metrics as unknown[]).length, 1);
assert.equal(
  ((singleObjectProjectData.detail_sections as Array<Record<string, unknown>>)[0]).title,
  "Project Economics",
);

const incompleteProjectEconomicsPatch = applySec8k6kValidationRepairPatches({
  analysisResult: {
    analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_1"),
    display_payload: {
      display_type: "operating_event",
      data: {
        operating_mode: "operating_update",
        snapshot_metrics: [
          { label: "2024 Production", value: "25,400 tonnes", note: null },
          { label: "After-Tax NPV", value: "$3.6B", note: "Stage 1" },
        ],
        business_catalysts: [],
        detail_sections: [],
      },
    },
  },
  allowedPatchPaths: [
    "/display_payload/data/snapshot_metrics",
    "/display_payload/data/business_catalysts",
    "/display_payload/data/detail_sections",
  ],
  repairResult: {
    patches: [
      {
        path: "/display_payload/data/snapshot_metrics",
        value: JSON.stringify([{ label: "2024 Production", value: "25,400 tonnes", note: null }]),
      },
      {
        path: "/display_payload/data/detail_sections",
        value: JSON.stringify({ title: "Project Economics", rows: [] }),
      },
    ],
    unresolved_warning_codes: [],
  },
});
const incompleteProjectData = (
  incompleteProjectEconomicsPatch.analysisResult.display_payload as Record<string, unknown>
).data as Record<string, unknown>;
assert.equal((incompleteProjectData.snapshot_metrics as unknown[]).length, 2);
assert.equal((incompleteProjectData.detail_sections as unknown[]).length, 0);

const duplicatedProjectEconomicsPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("operating_update", "operating_exhibit_99_1"),
    display_payload: {
      display_type: "operating_event",
      data: {
        operating_mode: "operating_update",
        performance_comparisons: [],
        snapshot_metrics: [
          { label: "2024 Production", value: "25,400 tonnes", note: null },
          { label: "After-Tax NPV", value: "$3.6B", note: "Stage 1" },
          { label: "Design Capacity Reached", value: "85%", note: "Q4 2024" },
        ],
        business_catalysts: [
          {
            title: "Long-Term Operating Cost",
            value: "$6,543/tonne",
            summary: "The technical report estimates long-term unit operating costs.",
          },
        ],
        detail_sections: [
          {
            title: "Project Economics",
            rows: [
              { label: "After-Tax NPV (8%)", value: "$3.6B", note: "Stage 1" },
              { label: "Long-Term Operating Cost", value: "$6,543/tonne", note: null },
            ],
          },
        ],
        secondary_updates: [],
      },
    },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "operating_exhibit_99_1",
    exhibit_number: "99.1",
    label: "Technical report economics",
    text: "Stage 1 after-tax NPV (8%) is $3.6 billion and long-term operating cost is $6,543 per tonne. Q4 production reached 85% of design capacity.",
  }),
});
assert.ok(duplicatedProjectEconomicsPlan);
assert.ok(
  duplicatedProjectEconomicsPlan.issues.some(
    (issue) => issue.code === "operating_project_economics_fact_duplication",
  ),
);
assert.ok(
  !duplicatedProjectEconomicsPlan.issues.some(
    (issue) => issue.warning.includes("resource or capacity"),
  ),
);

const missingOperatingSectionsAnalysis = {
  analysis_output: {
    ...repairAnalysisOutput("operating_update", "operating_exhibit_99_2"),
    summary: "The project has an after-tax NPV of $3.6 billion and the company owns 44.8%.",
    material_events: [
      {
        role: "primary",
        event_type: "operating_update",
        event_summary: "Production results and project economics were updated.",
        key_terms: [],
        source_block_ids: ["operating_exhibit_operations"],
      },
      {
        role: "secondary",
        event_type: "leadership_governance",
        event_summary: "Shareholder-meeting capital resolutions were amended.",
        key_terms: [],
        source_block_ids: ["operating_exhibit_99_2"],
      },
    ],
  },
  display_payload: {
    display_type: "operating_event",
    data: {
      operating_mode: "operating_update",
      performance_comparisons: [],
      snapshot_metrics: [{ label: "After-Tax NPV", value: "$3.6B", note: "Stage 1" }],
      business_catalysts: [],
      detail_sections: [],
      secondary_updates: [],
    },
  },
};
const missingOperatingSectionsPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: missingOperatingSectionsAnalysis,
  analysisPromptUser: JSON.stringify({
    cleaned_source_blocks: [
      {
        block_id: "operating_exhibit_operations",
        exhibit_number: "99.2",
        label: "Production update",
        text: "The operation produced 25,400 tonnes in 2024 and issued 2025 production guidance.",
      },
      {
        block_id: "operating_exhibit_99_1",
        exhibit_number: "99.1",
        label: "Technical report economics",
        text: `${"Technical report background. ".repeat(35)}Lithium Argentina owns 44.8% and the Stage 1 after-tax NPV (8%) is $3.6 billion.`,
      },
      {
        block_id: "operating_exhibit_99_2",
        exhibit_number: "99.2",
        label: "Shareholder meeting update",
        text: "The proposed capital-band and conditional-capital limits were reduced to 10%.",
      },
    ],
  }),
});
assert.ok(missingOperatingSectionsPlan);
assert.ok(
  missingOperatingSectionsPlan.issues.some((issue) => issue.code === "operating_project_economics_section_missing"),
);
assert.ok(
  missingOperatingSectionsPlan.issues.some((issue) => issue.code === "operating_secondary_material_event_missing"),
);
assert.ok(missingOperatingSectionsPlan.allowedPatchPaths.includes("/display_payload/data/snapshot_metrics"));
assert.ok(missingOperatingSectionsPlan.allowedPatchPaths.includes("/display_payload/data/business_catalysts"));
assert.ok(missingOperatingSectionsPlan.allowedPatchPaths.includes("/display_payload/data/detail_sections"));
assert.ok(missingOperatingSectionsPlan.allowedPatchPaths.includes("/display_payload/data/secondary_updates"));
assert.ok(missingOperatingSectionsPlan.sourceBlockIds.includes("operating_exhibit_99_1"));
const repairedOperatingSections = applySec8k6kValidationRepairPatches({
  analysisResult: missingOperatingSectionsAnalysis,
  allowedPatchPaths: missingOperatingSectionsPlan.allowedPatchPaths,
  repairResult: {
    patches: [
      {
        path: "/display_payload/data/detail_sections",
        value: JSON.stringify([
          {
            title: "Project Economics",
            rows: [
              { label: "After-Tax NPV (8%)", value: "$3.6B", note: "Stage 1" },
              { label: "Company Ownership", value: "44.8%", note: null },
            ],
          },
        ]),
      },
      {
        path: "/display_payload/data/secondary_updates",
        value: JSON.stringify([
          {
            label: "Governance",
            title: "Capital resolutions amended",
            summary: "Proposed capital limits were reduced to 10%.",
          },
        ]),
      },
    ],
    unresolved_warning_codes: [],
  },
});
const repairedOperatingSectionsData = (
  repairedOperatingSections.analysisResult.display_payload as Record<string, unknown>
).data as Record<string, unknown>;
assert.equal(
  ((repairedOperatingSectionsData.detail_sections as Array<Record<string, unknown>>)[0]).title,
  "Project Economics",
);
assert.equal(
  (repairedOperatingSectionsData.secondary_updates as Array<Record<string, unknown>>).length,
  1,
);
const governanceRepairAnalysis = {
  analysis_output: {
    score: 55,
    summary: "There were no disagreements, but the prior report included a going concern qualification.",
    material_events: [
      {
        role: "primary",
        event_type: "leadership_governance",
        event_summary: "The audit committee approved an auditor transition.",
        key_terms: ["Conditional KPMG approval"],
        source_block_ids: ["item_4_01_primary"],
      },
    ],
  },
  display_payload: {
    display_type: "governance_event",
    data: {
      governance_mode: "auditor_change",
      snapshot_metrics: [
        { label: "Engagement Date", value: "March 20, 2026", note: "Subject to Form 10-K filing and engagement letter" },
      ],
      key_changes: [],
    },
  },
  source_blocks_used: ["item_4_01_primary"],
};
const governanceRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: governanceRepairAnalysis,
  analysisPromptUser: JSON.stringify({
    cleaned_source_blocks: [
      {
        block_id: "item_4_01_primary",
        source_ref: "8-K/A Item 4.01",
        origin: "primary_filing",
        block_type: "item_section",
        item_number: "4.01",
        exhibit_number: null,
        document_type: "8-K/A",
        label: "Changes in Registrant's Certifying Accountant",
        text: "On March 20, 2026, the Audit Committee approved the engagement of KPMG, subject to the filing of the 2025 Form 10-K and execution of the engagement letter. Withum was dismissed on March 31, 2026. There were no disagreements. The prior report included substantial doubt about the Company's ability to continue as a going concern.",
      },
      {
        block_id: "unrelated_item_5_02",
        source_ref: "8-K/A Item 5.02",
        origin: "primary_filing",
        block_type: "item_section",
        item_number: "5.02",
        text: "Unrelated officer compensation disclosure.",
      },
    ],
  }),
});
assert.ok(governanceRepairPlan);
assert.equal(governanceRepairPlan.sourceBlockIds.length, 1);
assert.equal(governanceRepairPlan.sourceBlockIds[0], "item_4_01_primary");
assert.ok(governanceRepairPlan.allowedPatchPaths.includes("/analysis_output/summary"));
assert.ok(governanceRepairPlan.allowedPatchPaths.includes("/display_payload/data/snapshot_metrics/0/label"));
const governanceRepairApplied = applySec8k6kValidationRepairPatches({
  analysisResult: governanceRepairAnalysis,
  repairResult: {
    patches: [
      {
        path: "/analysis_output/summary",
        value: "The audit committee approved KPMG subject to stated conditions. There were no disagreements. The prior report separately included going-concern language.",
      },
      {
        path: "/display_payload/data/snapshot_metrics/0/label",
        value: "Approval Date",
      },
      {
        path: "/analysis_output/score",
        value: "20",
      },
    ],
    unresolved_warning_codes: [],
  },
  allowedPatchPaths: governanceRepairPlan.allowedPatchPaths,
});
assert.deepEqual(
  governanceRepairApplied.appliedPatchPaths.sort(),
  ["/analysis_output/summary", "/display_payload/data/snapshot_metrics/0/label"].sort(),
);
assert.deepEqual(governanceRepairApplied.ignoredPatchPaths, ["/analysis_output/score"]);
assert.equal(
  (governanceRepairApplied.analysisResult.analysis_output as Record<string, unknown>).score,
  55,
);
assert.equal(
  getSec8k6kGovernanceSemanticWarnings(
    (governanceRepairApplied.analysisResult.display_payload as Record<string, unknown>),
    (governanceRepairApplied.analysisResult.analysis_output as Record<string, unknown>),
  ).length,
  0,
);

const encodingRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("fda_clinical", "outlook_item_8_01", {
      event_title: "Outlook Therapeutics advances LYTENAVA\u00e2\u0084\u00a2 after FDA appeal",
      summary: "The FDA granted the appeal and the company plans a Class 1 resubmission.",
    }),
    display_payload: { display_type: "operating_event", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "outlook_item_8_01",
    item_number: "8.01",
    label: "FDA Formal Dispute Resolution",
    text: "The FDA granted the appeal for LYTENAVA\u2122 and the company plans a Class 1 resubmission.",
  }),
});
assert.ok(encodingRepairPlan);
assert.ok(encodingRepairPlan.issues.some((issue) => issue.code === "text_encoding_mojibake_event_title"));
assert.deepEqual(encodingRepairPlan.sourceBlockIds, ["outlook_item_8_01"]);

const qualifiedAmountRepairPlan = buildSec8k6kValidationRepairPlan({
  analysisResult: {
    analysis_output: repairAnalysisOutput("fda_clinical", "arvinas_exhibit_99_1", {
      summary: "FDA approval triggered a $50 million milestone payment from Pfizer.",
    }),
    display_payload: { display_type: "operating_event", data: {} },
  },
  analysisPromptUser: repairSourceBlocks({
    block_id: "arvinas_exhibit_99_1",
    exhibit_number: "99.1",
    label: "FDA Approval Press Release",
    text: "FDA approval triggered a $50 million milestone payment from Pfizer. The payment will be offset by amounts owed to Yale University under the license agreement.",
  }),
});
assert.ok(qualifiedAmountRepairPlan);
assert.ok(
  qualifiedAmountRepairPlan.issues.some((issue) => issue.code === "source_material_amount_qualifier_omitted"),
);
assert.deepEqual(qualifiedAmountRepairPlan.sourceBlockIds, ["arvinas_exhibit_99_1"]);

assert.equal(isLowQualitySourceText("Item 8.01. The FDA approved the application after completing its review."), false);
assert.equal(
  isLowQualitySourceText(`JFIF${"\u0000\u0001\u0002\u0003\u0004\u0005".repeat(20)}binary image payload`),
  true,
);
assert.equal(Object.keys(operatingRuntimeSchema.properties)[0], "amendment_delta");
assert.equal(Object.keys(operatingRuntimeSchema.properties)[1], "display_payload");
assert.equal(
  Object.keys(operatingRuntimeSchema.properties.display_payload.properties.data.properties)[2],
  "performance_comparisons",
);
assert.equal(
  operatingRuntimeSchema.properties.display_payload.properties.data.required[2],
  "performance_comparisons",
);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.display_type.enum[0], "operating_event");
assert.deepEqual(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.operating_mode.enum,
  ["earnings", "operating_update", "product_or_regulatory", "legal_or_accounting", "routine_archive"],
);
assert.deepEqual(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.regulatory_stage.enum,
  [
    "not_applicable",
    "ind_or_clinical_hold",
    "application_review",
    "advisory_committee",
    "approval",
    "crl_or_appeal",
    "clinical_update",
    "other_regulatory",
  ],
);
assert.ok(operatingRuntimeSchema.properties.analysis_output.properties.event_type.enum.includes("operating_update"));
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.properties.snapshot_metrics.maxItems, 4);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.properties.performance_comparisons.maxItems, 3);
assert.equal(
  "minimum" in operatingRuntimeSchema.properties.display_payload.properties.data.properties.performance_comparisons.items.properties.current_numeric,
  false,
);
assert.equal(
  "minimum" in operatingRuntimeSchema.properties.display_payload.properties.data.properties.performance_comparisons.items.properties.comparison_numeric,
  false,
);
assert.deepEqual(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.performance_comparisons.items.properties.comparison_basis.enum,
  ["yoy", "qoq", "other"],
);
assert.equal(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.performance_comparisons.items.required.includes("comparison_basis"),
  true,
);
assert.equal(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.description,
  "Never return more than three items.",
);
assert.deepEqual(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.items.properties.guidance_kind.enum,
  ["numeric_range", "point", "qualitative"],
);
assert.deepEqual(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.items.properties.guidance_low_numeric.type,
  ["number", "null"],
);
assert.ok(
  "guidance_low_numeric" in
    operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.items.properties,
);
assert.ok(
  "performance_label" in
    operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.items.properties,
);
assert.ok(
  "performance_relationship" in
    operatingRuntimeSchema.properties.display_payload.properties.data.properties.guidance_metrics.items.properties,
);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.properties.business_catalysts.maxItems, 3);
assert.equal("operating_metrics" in operatingRuntimeSchema.properties.display_payload.properties.data.properties, false);
assert.equal("business_highlights" in operatingRuntimeSchema.properties.display_payload.properties.data.properties, false);
assert.deepEqual(operatingRuntimeSchema.properties.display_payload.required, ["display_type", "data"]);
assert.equal("evidence" in operatingRuntimeSchema.properties.display_payload.properties, false);
assert.equal("notes" in operatingRuntimeSchema.properties.display_payload.properties, false);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.required.includes("detail_sections"), false);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.required.includes("secondary_updates"), false);
assert.equal(operatingRuntimeSchema.properties.display_payload.properties.data.properties.secondary_updates.maxItems, 1);
assert.equal(
  operatingRuntimeSchema.properties.display_payload.properties.data.properties.secondary_updates.items.properties.summary.maxLength,
  120,
);
assert.equal("key_evidence" in operatingRuntimeSchema.properties.analysis_output.properties, false);
assert.equal(operatingRuntimeSchema.properties.analysis_output.required.includes("key_evidence"), false);
assert.equal("what_to_watch_next" in operatingRuntimeSchema.properties.analysis_output.properties, false);
assert.equal(operatingRuntimeSchema.properties.analysis_output.required.includes("what_to_watch_next"), false);

const normalizedOperatingDisplay = normalizeSec8k6kOperatingDisplayPayloadForPersistence({
  display_type: "operating_event",
  data: {
    operating_mode: "earnings",
    performance_comparisons: [
      { label: "Total Revenues", current_label: "Q1 2026", comparison_label: "Q1 2025", current_value: "$14.7M" },
      { label: "Net Interest Income", current_label: "Q1 2026", comparison_label: "Q4 2025", current_value: "$93.3M" },
      { label: "Subscription Revenue", current_label: "FY 2026", comparison_label: "FY 2025", current_value: "$673.1M" },
    ],
    guidance_metrics: [
      { label: "FY 2026 Revenue Guidance", guidance_value: "Flat to Up Low Single Digits", guidance_kind: "qualitative" },
      { label: "Net Interest Income Outlook", guidance_value: "$90M - $100M", guidance_kind: "numeric_range" },
      {
        label: "Adjusted Unlevered Free Cash Flow Guidance",
        guidance_label: "FY 2026",
        guidance_value: "$250M - $275M",
        guidance_kind: "numeric_range",
        note: "Net FCF conversion around 25% of EBITDA.",
      },
    ],
    business_catalysts: [
      { title: "Experiential Services Growth", value: "22.8%", summary: "Revenue growth accelerated." },
      { title: "Debt Reduction", value: "$131M", summary: "Debt maturities were extended." },
      { title: "Centralized Labor Model", value: null, summary: "The operating model is being centralized." },
    ],
  },
});
const normalizedOperatingData = normalizedOperatingDisplay.data as Record<string, unknown>;
const normalizedOperatingGuidance = normalizedOperatingData.guidance_metrics as Array<Record<string, unknown>>;
const normalizedOperatingComparisons = normalizedOperatingData.performance_comparisons as Array<Record<string, unknown>>;
assert.deepEqual(
  normalizedOperatingComparisons.map((item) => item.comparison_basis),
  ["yoy", "qoq", "yoy"],
);

assert.deepEqual(
  normalizedOperatingGuidance.map((item) => [item.performance_relationship, item.performance_label]),
  [
    ["same_basis", "Total Revenues"],
    ["same_basis", "Net Interest Income"],
  ],
);
assert.equal(
  normalizedOperatingGuidance.some((item) => item.performance_label === "Subscription Revenue"),
  false,
);
assert.deepEqual(
  normalizedOperatingGuidance.map((item) => item.guidance_kind),
  ["qualitative", "numeric_range"],
);
assert.deepEqual(
  (normalizedOperatingData.business_catalysts as Array<Record<string, unknown>>).map((item) => item.title),
  ["Adjusted Unlevered Free Cash Flow Guidance", "Experiential Services Growth", "Debt Reduction"],
);
assert.equal(
  ((normalizedOperatingData.business_catalysts as Array<Record<string, unknown>>)[0]).summary,
  "Net FCF conversion around 25% of EBITDA.",
);

const normalizedOperatingUpdateDisplay = normalizeSec8k6kOperatingDisplayPayloadForPersistence({
  display_type: "operating_event",
  data: {
    operating_mode: "operating_update",
    performance_comparisons: [
      {
        label: "Lithium Carbonate Production",
        current_label: "Q4 2024",
        current_value: "8,500 tonnes",
        current_numeric: 8500,
        comparison_label: "Q3 2024",
        comparison_value: "6,800 tonnes",
        comparison_numeric: 6800,
        comparison_basis: "qoq",
        change_note: "Up 25% QoQ",
      },
    ],
    guidance_metrics: [
      {
        label: "Production Guidance",
        guidance_label: "2025",
        guidance_value: "30,000-35,000 tonnes",
        guidance_kind: "numeric_range",
        guidance_low_numeric: 30000,
        guidance_high_numeric: 35000,
        performance_relationship: "standalone",
        performance_label: null,
        note: null,
      },
    ],
    business_catalysts: [],
  },
});
const normalizedOperatingUpdateData = normalizedOperatingUpdateDisplay.data as Record<string, unknown>;
const normalizedOperatingUpdateGuidance = (
  normalizedOperatingUpdateData.guidance_metrics as Array<Record<string, unknown>>
)[0];
assert.equal(normalizedOperatingUpdateGuidance.performance_relationship, "same_basis");
assert.equal(normalizedOperatingUpdateGuidance.performance_label, "Lithium Carbonate Production");
assert.deepEqual(normalizedOperatingUpdateData.business_catalysts, []);

const normalizedApprovalOnlyDisplay = normalizeSec8k6kCapitalDisplayPayloadForPersistence({
  display_type: "capital_financing",
  data: {
    capital_mode: "share_linked_financing",
    snapshot_metrics: [
      { label: "Approval Status", value: "Approved", note: null },
      { label: "Approval Scope", value: "Warrant issuance", note: null },
    ],
    offering_details: [{ label: "Agreement Date", value: "February 25, 2025", note: null }],
    instrument_details: [
      { label: "Type", value: "Series C Warrants", note: null },
      { label: "Shares / Securities", value: "Full issuance approved", note: null },
      { label: "Reset / Floor", value: "$2.4882", note: null },
    ],
    share_overhang: {
      rows: [{ row_role: "conditional", numeric_value: null }],
      total_note: { numerator: "Not calculable", denominator: "950,301", ratio: "Not calculable" },
    },
  },
});
assert.deepEqual((normalizedApprovalOnlyDisplay.data as Record<string, unknown>).offering_details, []);
assert.equal((normalizedApprovalOnlyDisplay.data as Record<string, unknown>).share_overhang, null);
assert.equal((normalizedApprovalOnlyDisplay.data as Record<string, unknown>).capital_mode, "capital_structure_action");
assert.deepEqual(
  ((normalizedApprovalOnlyDisplay.data as Record<string, unknown>).instrument_details as Array<Record<string, unknown>>).map(
    (row) => row.label,
  ),
  ["Type", "Reset / Floor"],
);

const normalizedCapitalRatioDisplay = normalizeSec8k6kCapitalDisplayPayloadForPersistence({
  display_type: "capital_financing",
  data: {
    capital_mode: "share_linked_financing",
    snapshot_metrics: [],
    share_overhang: {
      status_value: "109.9%",
      ratio_value: "109.88%",
      basis: {
        label: "Current shares outstanding",
        value: "47,903,215 shares",
        numeric_value: 47_903_215,
        unit: "shares",
      },
      rows: [
        { row_role: "counted", numeric_value: 15_225_158 },
        { row_role: "counted", numeric_value: 37_410_188 },
        { row_role: "conditional", numeric_value: 52_635_346 },
      ],
      total_note: {
        numerator: "52,635,346 shares",
        denominator: "47,903,215 shares",
        ratio: "109.88%",
      },
    },
  },
});
const normalizedCapitalRatioOverhang = (normalizedCapitalRatioDisplay.data as Record<string, unknown>)
  .share_overhang as Record<string, unknown>;
assert.equal(normalizedCapitalRatioOverhang.status_value, "109.9%");
assert.equal(normalizedCapitalRatioOverhang.ratio_value, "109.9%");
assert.equal((normalizedCapitalRatioOverhang.total_note as Record<string, unknown>).ratio, "109.9%");

const normalizedPlainEquityInstrumentDisplay = normalizeSec8k6kCapitalDisplayPayloadForPersistence({
  display_type: "capital_financing",
  data: {
    capital_mode: "equity_issuance",
    snapshot_metrics: [{ label: "Offering Size", value: "10,156,000 ADSs", note: null }],
    share_overhang: null,
    instrument_details: [
      { label: "Type", value: "Ordinary Shares", note: null },
      { label: "Shares / Securities", value: "10,156,000", note: null },
      { label: "Exercise / Conversion Price", value: "-", note: null },
      { label: "Reset / Floor", value: "-", note: null },
      { label: "Term / Limits", value: "-", note: null },
      { label: "Type", value: "Common warrant", note: null },
      { label: "Shares / Securities", value: "2,000,000 shares", note: null },
      { label: "Exercise / Conversion Price", value: "$5.00", note: null },
    ],
    offering_details: [],
  },
});
assert.deepEqual(
  (
    (normalizedPlainEquityInstrumentDisplay.data as Record<string, unknown>)
      .instrument_details as Array<Record<string, unknown>>
  ).map((row) => row.value),
  ["Common warrant", "2,000,000 shares", "$5.00"],
);

const longAgreementText = "WARRANT AGREEMENT\n" + "Long agreement provision. ".repeat(1_500);
const priorityPressReleaseText = [
  "SHATTUCK LABS ANNOUNCES PRIVATE PLACEMENT",
  "The financing is expected to fund SL-325 through multiple Phase 2 trials.",
  "The company anticipates a cash runway into 2029.",
].join("\n\n");
const prioritySourcePackage = buildSecFilingAnalysisPackage(
  {
    source_unique_id: "0001193125-25-173010",
    body_text: "Item 1.01 Entry into a Material Definitive Agreement.\n" + "Primary filing context. ".repeat(250),
    raw_payload: {
      form_type: "8-K",
      accession_number: "0001193125-25-173010",
      cik: "0001680367",
      attachment_texts: [
        { type: "EX-4.1", description: "Warrant Agreement", text: longAgreementText },
        { type: "EX-10.1", description: "Securities Purchase Agreement", text: longAgreementText },
        { type: "EX-99.1", description: "Press Release", text: priorityPressReleaseText },
      ],
    },
  },
  { maxChars: 20_000, maxDocumentChars: 4_000 },
);
assert.ok(prioritySourcePackage.llm_text.includes("EX-99.1 - Press Release - Priority Source"));
assert.ok(prioritySourcePackage.llm_text.includes("fund SL-325 through multiple Phase 2 trials"));
const prioritySourceBlocks = buildSecSourceBlockPromptInput({
  filingPackage: prioritySourcePackage,
  fallbackText: prioritySourcePackage.llm_text,
}).cleaned_source_blocks;
assert.ok(
  prioritySourceBlocks.some(
    (block) => block.exhibit_number === "99.1" && block.text.includes("cash runway into 2029"),
  ),
);

const earningsTableParserOutput = {
  parserVersion: "sec_8k_6k_parser_v1",
  parserGroup: "8k-6k",
  formType: "8-K / 6-K, 8-K/A / 6-K/A",
  accessionNumber: "0001473844-25-000062",
  isSupported: true,
  facts: {
    items: [
      {
        item: "2.02",
        label: "Results of Operations and Financial Condition",
        evidence: "Item 2.02. The company reported third quarter 2025 results in Exhibit 99.1.",
      },
    ],
    extracted: {
      tableFacts: {
        tableLikeBlocks: [
          {
            label: "quarterly financial results",
            evidence: "Three Months Ended | 2025 | 2024 | Interest income | 122,557 | 132,372",
            rows: [
              ["Three Months Ended", "Q3 2025", "Q3 2024"],
              ["Interest income", "122,557", "132,372"],
            ],
          },
          {
            label: "quarterly financial results",
            evidence: "Three Months Ended | 2025 | 2024 | Net income | 25,670 | 33,891",
            rows: [
              ["Three Months Ended", "Q3 2025", "Q3 2024"],
              ["Net income", "25,670", "33,891"],
            ],
          },
        ],
      },
    },
  },
};
const earningsTablePrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: {
    accession_number: "0001473844-25-000062",
    company_name: "Stellar Bancorp, Inc.",
    primary_ticker: { ticker: "STEL", exchange: "NYSE" },
  },
  parser_output: earningsTableParserOutput,
  filing_excerpt: "Item 2.02. Third quarter 2025 results.",
  router_result: {
    event_type: "earnings",
    route_case: "earnings_or_results",
    analysis_needed: true,
    selected_source_block_ids: [],
  },
});
const earningsTablePayload = JSON.parse(earningsTablePrompt.user) as Record<string, any>;
const earningsTableBlock = sourceBlocks(earningsTablePayload).find(
  (block) => block.block_type === "table_source_block" && String(block.text).includes("Net income | 25,670 | 33,891"),
);
assert.ok(earningsTableBlock);
assert.ok(
  sourceBlocks(earningsTablePayload).some(
    (block) => block.block_type === "table_source_block" && String(block.text).includes("Interest income | 122,557 | 132,372"),
  ),
);
assert.ok(
  earningsTablePayload.analysis_source_bundle.included_source_block_ids.includes(earningsTableBlock.block_id),
);

const strategicPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "strategic_transaction",
    route_case: "strategic_transaction",
    score: 60,
    delivery_level: "feed",
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
  },
  market_context: null,
});
assert.equal(strategicPrompt.responseFormat.json_schema.schema, strategicRuntimeSchema);
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Use exactly one approved event_type"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Base conclusions first on the complete original cleaned_source_blocks"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("related_filing_source_block contains the original text"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Historical original source blocks are normally withheld"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Write the amendment analysis around the delta"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("one expressly linked related_filing_source_block block_id"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("router result is routing context only"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("candidate routes, not final classifications"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("correct or override the router candidate route"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Reason from the complete original source-block bundle first"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Extracted dates, amounts, share counts"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("not analysis evidence"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("parser facts, parser signals"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not assume missing exhibit text"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("do not treat a parser warning as negative news by itself"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For 6-K and 6-K/A, do not expect 8-K Item numbers"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Determine the final analysis_output.event_type from the complete original source blocks"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("A shareholder vote is a filing mechanism"));
assert.equal(sec8k6kAnalysisSystemPrompt.includes("Use router_result.event_type as the analysis_output.event_type"), false);
assert.ok(sec8k6kAnalysisSystemPrompt.includes("router_result.score is an archive-gate score only"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not copy router_result.score into analysis_output.score"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("runtime may persist archive output using the router score"));
assert.equal(sec8k6kAnalysisSystemPrompt.includes("Use router_result.score as analysis_output.score"), false);
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For families without a specialized response schema, return it unchanged"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For analysis_prompt_family=capital_financing"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For analysis_prompt_family=governance_vote"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Keep distinct disclosure dimensions separate"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("each note may qualify only its own labeled value"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For analysis_prompt_family=operating_legal_routine"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("approval-only capital action"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("return offering_details as an empty array"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("omit the Shares / Securities row"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not choose share_linked_financing merely because"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not return key_evidence for this family"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Score the net economic effect"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("contractual downside protections"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("no active adverse trigger is usually 60-74"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("the score must remain 74 or below"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("financial_risk event label does not by itself prove distress"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("conditional remedy as an immediate event"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("standard lender protections must not be the sole basis for a bearish signal"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("Set display_type=governance_event"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("Choose exactly one governance_mode"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("Do not return key_evidence for this family"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("complete plain-English explanation sentence with an explicit subject"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("keep disagreements, reportable events, audit opinion, going-concern language, and appointment conditions as separate disclosure dimensions"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("label the date Approval Date or Conditional Engagement"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("Separate independent disclosure dimensions"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("ipo_listing"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not split traditional IPO and SPAC IPO"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("SPAC/de-SPAC transaction status"));
assert.ok(sec8k6kAnalysisSystemPrompt.toLowerCase().includes("routine amendment cases should stay below 50"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("score the incremental investor impact"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("do not manufacture bullish_points"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("compact archive handoff fields"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("SECTION: Investor analysis and scoring"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Neither field may begin with The score"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Use only the strongest one or two score drivers"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("Rewrite either field if it begins with The score"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("score_reason and score_explanation.summary are visible investor-facing score rationales"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("bottom-line judgment, not a filing summary"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Neither field may begin with The score"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Writing style: Use plain investor language"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do analysis, not just recap"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Neutral is not the default"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("opinion, warning, or investor read-through"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Populate material_events before event_title"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("separate new event that would independently warrant its own investor conclusion"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not create a secondary row for a term, use of proceeds, condition, rationale"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("populate root security_inventory before display_payload"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("security_inventory is an internal completeness plan"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Summary must cover every primary and secondary material_events row"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("inspect the complete original source-block bundle"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("does not become a separate material_events row"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("not generic instructions to monitor the company"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("use it as a compact proof set"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("strongest two or three"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("no more than 18 words"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Never return four or more key_evidence items"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Classify the main new fact in the current filing"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Bankruptcy causing an exchange suspension is one connected risk sequence"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Keep notice date, suspension date, removal date, and appeal deadline distinct"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Initial minimum-bid or other continued-listing deficiency"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Trading suspension scheduled or active"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Going-concern warning, material cash-runway concern"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("reserve one summary sentence for that financial event"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("material fee, or near-term funding limit"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Covenant breach without a waiver"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Chapter 11 filing, involuntary bankruptcy"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Do not add generic advice to monitor announcements"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("listing_risk or financial_risk"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("visible 2-by-2 Risk Status snapshot"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Affected Periods, Non-Reliance Period, Restatement Scope"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Use Default Status only for an actual payment default"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("For financial_risk summary"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("For financial_risk score_reason"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("why the event belongs in its score band"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("final listing_risk summary sentence must be the investor judgment"));
assert.ok(sec8k6kListingFinancialRiskPrompt.includes("Never add a continued trading venue, OTC possibility"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Financing / Dilution / Capital Structure"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not treat fee-table amounts"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Choose share_linked_financing"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Use row_role as the single calculation role"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("A completed or board-approved reverse split is usually 75-84"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("does not mechanically dilute proportional ownership"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Write a three-to-five-sentence summary"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not multiply shares by price to create proceeds"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("snapshot_metrics, instrument_details, and offering_details"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Return exactly four snapshot_metrics"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("list no more than two specific source-backed purposes"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("{purpose1}, {purpose2} + others"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Concurrent Private Placement"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("material separate private placement"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not require any specific security type"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("first complete security_inventory"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Reconcile instrument_details against security_inventory"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Never calculate one visible percentage from all rows and another from only counted rows"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("same bare percentage representation including the % sign"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("status_value is the large header value"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Variable or Not fixed yet"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("instrument_details must not be empty"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("same fixed Instrument Details contract as 424B/S-1"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Use only these instrument_details labels"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not create an instrument_details Type group for plain common stock"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Set instrument_details note to null"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Model economic substance before visible fields"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("legal number of securities from their common-share equivalent"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Never hide known fixed common-share exposure"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("funded or closed amounts from commitments"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Keep each term scoped to the instrument"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("do not rely on downstream truncation"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("Correct misplaced mechanics before returning"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("remove any instrument_details Type group for plain Common Stock"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("summary must state the per-share consideration"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("tendered or approved share percentage"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("make the first summary sentence name the acquirer"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("Transaction snapshot"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("completed cash acquisition"));
assert.ok(sec8k6kStrategicTransactionPrompt.includes("score_explanation.summary"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("leadership change alone must remain below 75"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("distinct source-backed adverse condition"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("pending merger or other transaction does not automatically increase"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("Do not call a routine replacement bullish"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Choose exactly one data.operating_mode"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Product or production guidance alone is not earnings"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("title the section Project Economics"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("When the primary disclosed performance is production, deliveries, shipments, utilization"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("titled exactly Project Economics"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("Remove generic optimization goals"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Set data.regulatory_stage from the primary FDA or clinical event only"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("regulatory_stage follows the primary regulatory event"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("workforce or cost restructuring"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("A CEO employee note is supporting context, not a leadership event by itself"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Cross-field consistency is mandatory"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Do not use other for a substantive operating change"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("General employee layoffs"));
assert.ok(sec8k6kGovernanceVoteLeadershipPrompt.includes("Do not treat affected employees as leadership"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("For earnings and operating_update, use performance_comparisons"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("use the same-period prior-year YoY value"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("same-period prior-year YoY value when disclosed"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("a same-period prior-year pair was preferred over a prior-quarter pair"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Return true signed numeric values"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Do not use expenses, costs"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("use guidance_metrics for zero to three outlook rows inside Performance & Outlook"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("guidance_kind=numeric_range"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("never omit material guidance merely because the company used words"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Use standalone with performance_label=null only when no matching comparison exists"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Never duplicate the same outlook"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("An empty array is better than repetitive or low-information rows"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("reserve a business_catalysts row for it before selecting other updates"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Material guidance direction must be reflected in Summary, signal, and scoring"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("SECTION: FDA / clinical scoring guide"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Choose one base range from the most advanced source-backed regulatory or clinical stage"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("granted regulatory appeal"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("does not equal final approval"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Final FDA approval or a material label expansion is usually 80-94 bullish"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Complete Response Letter, approval rejection"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("must not be described as final approval"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("set performance_label to the exact performance_comparisons label"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Classify every guidance row with performance_relationship"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("include source-backed revenue and profitability guidance when present"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("use business_catalysts only for zero to three material investor-relevant facts"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Exclude awards, generic partner recognition"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("SECTION: Earnings scoring guide"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Use 65-74 for a clear directional change"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Use 75-84 only for a source-backed step change"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("A neutral earnings result must not score above 74"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Apply the same earnings-quality principle to gains"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("score the incremental economic change"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("use volatile rather than neutral"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("neutral never exceeds 74"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("one investor-facing sentence of roughly 12 to 16 words"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("SECTION: Key Business Updates"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("at most one secondary_updates item"));
assert.ok(sec8k6kFinalOutputCheckPrompt.includes("must not contain key_evidence or what_to_watch_next"));
assert.ok(
  sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not return what_to_watch_next for this family"),
);
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Never claim a beat, miss, expectations comparison"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("Do not return key_evidence for this family"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("keep financial results dominant"));
assert.ok(sec8k6kOperatingLegalRoutinePrompt.includes("routine_archive"));
assert.equal(sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.key_evidence.maxItems, 3);
assert.equal(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.snapshot_metrics.maxItems, 4);
assert.ok(
  sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.snapshot_metrics.description.includes(
    "Return exactly four non-duplicative scan-first metrics",
  ),
);
assert.ok(
  sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.key_evidence.description.includes(
    "Rank all candidates first",
  ),
);
assert.ok(
  sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.key_evidence.description.includes(
    "Each item must be no more than 18 words",
  ),
);
assert.ok(sec8k6kAnalysisResponseSchema.properties.analysis_output.required.includes("material_events"));
assert.ok(sec8k6kAnalysisResponseSchema.required.includes("security_inventory"));
assert.equal(Object.keys(sec8k6kAnalysisResponseSchema.properties)[0], "amendment_delta");
assert.equal(sec8k6kAnalysisResponseSchema.properties.security_inventory.maxItems, 8);
assert.equal(sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.material_events.minItems, 1);
assert.equal(
  Object.keys(sec8k6kAnalysisResponseSchema.properties.analysis_output.properties).at(-1),
  "summary",
);
assert.ok(sec8k6kAnalysisResponseSchema.properties.analysis_output.required.includes("listing_status_snapshot"));
assert.ok(sec8k6kAnalysisResponseSchema.properties.analysis_output.required.includes("score_explanation"));
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.score_explanation.required,
  ["summary"],
);
assert.ok(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.display_type.enum.includes("capital_financing"));
assert.ok(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.display_type.enum.includes("strategic_transaction"));
assert.ok(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.display_type.enum.includes("operating_event"));
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.capital_mode.enum,
  SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES,
);
assert.ok(SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES.includes("atm_capacity"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("current unsold ATM capacity"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.toLowerCase().includes("never convert the dollar capacity into an implied share count"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("SEC active offering and dilution scoring guide"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Mid cap: 20%+ = feed upper range; 30%+ = alert possible."));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("15-30% = 60-69, 30-50% = 70-74"));
assert.ok(sec8k6kFinancingDilutionCapitalStructurePrompt.includes("Do not apply the shared offering and dilution bands to debt_liquidity"));
assert.ok("offering_details" in sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties);
assert.equal("financing_terms" in sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties, false);
assert.ok(
  sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.instrument_details.description.includes(
    "424B/S-1-compatible Instrument Details rows",
  ),
);
assert.equal(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.instrument_details.maxItems, 35);
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.instrument_details.items.properties.label.enum,
  ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"],
);
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.share_overhang.properties.rows.items.properties.row_role.enum,
  ["counted", "conditional", "alternative", "reference"],
);
assert.deepEqual(
  Object.keys(sec8k6kAnalysisResponseSchema.properties.display_payload.properties.data.properties.share_overhang.properties).slice(0, 7),
  ["chart_title", "subtitle", "basis", "rows", "total_note", "status_label", "status_value"],
);
assert.ok(prompt.user.includes("fda_clinical"));
assert.ok(prompt.user.includes("cleaned_source_blocks"));
assert.ok(prompt.user.includes("analysis_source_bundle"));
assert.ok(prompt.user.includes("selected_source_snippets"));
assert.ok(prompt.user.includes("attachment_inventory"));
assert.equal(prompt.user.includes("\"facts\""), false);
assert.equal(prompt.user.includes("\"signals\""), false);
assert.equal(prompt.user.includes("\"classification\""), false);
assert.equal(analysisUserPayload.display_payload.display_type, "generic");
assert.equal(analysisUserPayload.display_payload.data.display_version, "sec_8k_6k_generic_v1");
assert.equal(analysisUserPayload.display_payload.data.event_type, "fda_clinical");
assert.equal(analysisUserPayload.display_payload.data.ipo_kind, null);
assert.equal(analysisUserPayload.display_payload.data.score_from_router, 86);
assert.equal(analysisUserPayload.analysis_prompt_family, "operating_legal_routine");
assert.equal(analysisUserPayload.analysis_prompt_key, SEC_8K_6K_ANALYSIS_PROMPT_KEYS.operatingLegalRoutine);
assert.equal(analysisUserPayload.analysis_prompt_version, SEC_8K_6K_ANALYSIS_PROMPT_VERSION);
assert.equal(analysisUserPayload.source_block_bundle.mode, "analysis_deep");
assert.equal(analysisUserPayload.analysis_source_bundle.selection_source, "all_source_blocks");
assert.deepEqual(analysisUserPayload.analysis_source_bundle.warnings, []);
assert.equal(Array.isArray(analysisUserPayload.analysis_source_bundle.included_source_block_ids), true);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.attachment_inventory), true);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.selected_source_snippets), true);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.selected_tables), true);
assertNoExtractedEvidenceBlocks(analysisUserPayload);
assert.equal(prompt.user.includes("fixture_expected"), false);
assert.equal(prompt.user.includes("\"bodyText\""), false);
assert.equal(prompt.user.includes("\"rawPayload\""), false);
assert.equal(prompt.user.includes("\"attachment_texts\""), false);

const completeCapitalInventoryWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      instrument_details: [
        { label: "Type", value: "Series A warrant" },
        { label: "Shares / Securities", value: "1,000,000 shares" },
        { label: "Type", value: "Series B warrant" },
        { label: "Shares / Securities", value: "2,000,000 shares" },
      ],
    },
  },
  [
    {
      security_name: "Series A warrant",
      display_target: "instrument_details",
      instrument_details_type: "Series A warrant",
    },
    {
      security_name: "Series B warrant",
      display_target: "instrument_details",
      instrument_details_type: "Series B warrant",
    },
  ],
);
assert.deepEqual(completeCapitalInventoryWarnings, []);
const missingCapitalInventoryWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      instrument_details: [{ label: "Type", value: "Series A warrant" }],
    },
  },
  [
    {
      security_name: "Series A warrant",
      display_target: "instrument_details",
      instrument_details_type: "Series A warrant",
    },
    {
      security_name: "Series B warrant",
      display_target: "instrument_details",
      instrument_details_type: "Series B warrant",
    },
  ],
);
assert.ok(missingCapitalInventoryWarnings.some((warning) => warning.includes("Series B warrant")));
const plainEquityCapitalInventoryWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "equity_issuance",
      instrument_details: [],
      share_overhang: {
        basis: { numeric_value: 73_432_835 },
        rows: [{ row_role: "counted", numeric_value: 10_156_000 }],
        total_note: { numerator: "10,156,000", denominator: "73,432,835", ratio: "13.8%" },
        status_value: "13.8%",
      },
    },
  },
  [
    {
      security_name: "Ordinary Shares",
      display_target: "instrument_details",
      instrument_details_type: "Ordinary Shares",
    },
  ],
);
assert.equal(
  plainEquityCapitalInventoryWarnings.some((warning) => warning.includes("Instrument Details")),
  false,
);
const inconsistentCapitalShareOverhangWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      share_overhang: {
        status_value: "65.5% vs. Current Shares",
        total_note: { numerator: "43,859,649", denominator: "70,261,800", ratio: "0.62424", suffix: "%" },
        rows: [
          { row_role: "counted", numeric_value: 35_970_383 },
          { row_role: "counted", numeric_value: 7_889_266 },
          { row_role: "conditional", numeric_value: 2_192_982 },
        ],
      },
    },
  },
  [],
);
assert.ok(inconsistentCapitalShareOverhangWarnings.some((warning) => warning.includes("status_value must be a bare percentage")));
assert.ok(inconsistentCapitalShareOverhangWarnings.some((warning) => warning.includes("total_note.ratio must include the % sign")));
assert.ok(inconsistentCapitalShareOverhangWarnings.some((warning) => warning.includes("status_value percentage conflicts")));
const conditionalPrefundedWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      share_overhang: {
        rows: [
          {
            row_role: "conditional",
            label: "Pre-Funded Warrant Shares",
            value: "37,410,188 shares",
            note: "Exercise price $0.0001 per share",
            numeric_value: 37_410_188,
          },
        ],
      },
    },
  },
  [],
);
assert.ok(conditionalPrefundedWarnings.some((warning) => warning.includes("pre-funded supply conditional")));
const reconciledCapitalShareOverhangWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "share_linked_financing",
      share_overhang: {
        status_value: "62.4%",
        total_note: { numerator: "43,859,649", denominator: "70,261,800", ratio: "0.62424", suffix: "%" },
        rows: [
          { row_role: "counted", numeric_value: 35_970_383 },
          { row_role: "counted", numeric_value: 7_889_266 },
          { row_role: "conditional", numeric_value: 2_192_982 },
        ],
      },
    },
  },
  [],
);
assert.equal(reconciledCapitalShareOverhangWarnings.some((warning) => warning.includes("total_note ratio does not reconcile")), false);
assert.ok(reconciledCapitalShareOverhangWarnings.some((warning) => warning.includes("total_note.ratio must include the % sign")));

const atmCapacityWarnings = getSec8k6kCapitalSecurityCoverageWarnings(
  {
    display_type: "capital_financing",
    data: {
      capital_mode: "atm_capacity",
      share_overhang: {
        basis: {
          label: "Market Cap",
          value: "$3.2B",
          numeric_value: 3_200_000_000,
          unit: "usd",
          note: "Latest market context",
        },
        rows: [
          {
            row_role: "reference",
            supply_type: "atm_capacity",
            label: "Remaining ATM Capacity",
            value: "$400M",
            numeric_value: 400_000_000,
            unit: "usd",
          },
        ],
        total_note: {
          numerator: "$400M",
          denominator: "$3.2B",
          ratio: "12.5%",
          suffix: "of market cap",
        },
        status_value: "12.5%",
      },
    },
  },
  [],
);
assert.equal(atmCapacityWarnings.some((warning) => warning.includes("no counted row")), false);

const ipoPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "ipo_listing",
    route_case: "ipo_listing",
    score: 72,
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
    ipo_kind: "spac",
  },
});
const ipoPayload = JSON.parse(ipoPrompt.user) as Record<string, any>;
assert.equal(ipoPrompt.key, SEC_8K_6K_ANALYSIS_PROMPT_KEYS.strategicTransaction);
assert.equal(ipoPayload.display_payload.data.event_type, "ipo_listing");
assert.equal(ipoPayload.display_payload.data.ipo_kind, "spac");

const spacStatusPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "strategic_transaction",
    route_case: "strategic_transaction",
    score: 73,
    display_type: "spac_transaction_status",
    display_version: "sec_8k_6k_spac_transaction_status_v1",
    ipo_kind: null,
  },
});
const spacStatusPayload = JSON.parse(spacStatusPrompt.user) as Record<string, any>;
assert.equal(spacStatusPrompt.key, SEC_8K_6K_ANALYSIS_PROMPT_KEYS.strategicTransaction);
assert.equal(spacStatusPayload.display_payload.display_type, "spac_transaction_status");
assert.equal(spacStatusPayload.display_payload.data.display_version, "sec_8k_6k_spac_transaction_status_v1");
assert.ok(spacStatusPayload.display_payload.data.spac_transaction_status);

const baseSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: fixture as Record<string, unknown>,
  parserOutput: parsed as unknown as Record<string, unknown>,
  fallbackText: fixture.bodyText || null,
});
const selectedBlock = firstAnalysisBlock(baseSourceInput.cleaned_source_blocks);
assert.ok(selectedBlock?.block_id);
const selectedPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "product_update",
    route_case: "product_or_commercial_update",
    score: 50,
    analysis_needed: true,
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
    selected_source_block_ids: [selectedBlock.block_id],
    primary_route_candidate: {
      route_type: "product_update",
      priority: "primary",
      confidence: "medium",
      selected_source_block_ids: [selectedBlock.block_id],
      reason: "Candidate route only.",
    },
    route_candidates: [
      {
        route_type: "product_update",
        priority: "primary",
        confidence: "medium",
        selected_source_block_ids: [selectedBlock.block_id],
        reason: "Candidate route only.",
      },
    ],
  },
});
const selectedPayload = JSON.parse(selectedPrompt.user) as Record<string, any>;
assert.equal(selectedPrompt.key, SEC_8K_6K_ANALYSIS_PROMPT_KEYS.operatingLegalRoutine);
assert.equal(selectedPayload.analysis_source_bundle.selection_source, "all_source_blocks");
assert.equal(
  selectedPayload.analysis_source_bundle.included_source_block_ids.length,
  selectedPayload.source_block_manifest.length,
);
assert.equal("selected_source_block_ids" in selectedPayload.router_result, false);
assert.equal("selected_source_block_ids" in selectedPayload.router_result.primary_route_candidate, false);
assert.equal("selected_source_block_ids" in selectedPayload.router_result.route_candidates[0], false);
assert.ok(sourceBlocks(selectedPayload).some((block) => block.block_id === selectedBlock.block_id && block.text === selectedBlock.text));
assert.ok(selectedPayload.router_result.primary_route_candidate);

const longAnalysisText = Array.from(
  { length: 54 },
  (_, index) => `Capital paragraph ${index + 1}. The company describes preferred stock rights and conversion mechanics in the original filing text.`,
).join("\n\n");
const longAnalysisFixture: Sec8k6kParseInput = {
  sourceUniqueId: "0000000000-26-000401",
  title: "8-K - Long conversion terms",
  bodyText: [
    "FORM 8-K",
    "Item 5.03 Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year.",
    longAnalysisText,
    "The final conversion clause sets the price at 85% of the lowest ten-day VWAP and applies a 75% triggering-event adjustment.",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000401", form_type: "8-K" },
};
const longAnalysisParsed = parseSec8k6kFiling(longAnalysisFixture);
const longAnalysisSourceInput = buildSecSourceBlockPromptInput({
  filingPackage: longAnalysisFixture as Record<string, unknown>,
  parserOutput: longAnalysisParsed as unknown as Record<string, unknown>,
  fallbackText: longAnalysisFixture.bodyText,
  maxBlockChars: 6_000,
});
const longAnalysisItemBlocks = longAnalysisSourceInput.cleaned_source_blocks.filter((block) => block.item_number === "5.03");
assert.ok(longAnalysisItemBlocks.length >= 2);
const longAnalysisPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: longAnalysisFixture as Record<string, unknown>,
  parser_output: longAnalysisParsed as unknown as Record<string, unknown>,
  filing_excerpt: longAnalysisFixture.bodyText || null,
  router_result: {
    event_type: "dilution_risk",
    route_case: "capital_structure_action",
    score: 65,
    analysis_needed: true,
    display_type: "capital_financing",
    display_version: "sec_8k_6k_capital_financing_v1",
    selected_source_block_ids: [longAnalysisItemBlocks[0].block_id],
  },
});
const longAnalysisPayload = JSON.parse(longAnalysisPrompt.user) as Record<string, any>;
assert.equal(longAnalysisPayload.analysis_source_bundle.selection_source, "all_source_blocks");
assert.equal(
  longAnalysisPayload.analysis_source_bundle.included_source_block_ids.length,
  longAnalysisPayload.source_block_manifest.length,
);
assert.ok(sourceBlocks(longAnalysisPayload).some((block) => String(block.text).includes("final conversion clause")));
assert.deepEqual(longAnalysisPayload.analysis_source_bundle.warnings, []);

const missingSelectedPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "fda_clinical",
    route_case: "fda_or_clinical",
    score: 50,
    analysis_needed: true,
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
    selected_source_block_ids: ["secblk_missing_source_block"],
  },
});
const missingSelectedPayload = JSON.parse(missingSelectedPrompt.user) as Record<string, any>;
assert.equal(missingSelectedPayload.source_block_bundle.mode, "analysis_deep");
assert.equal(missingSelectedPayload.analysis_source_bundle.selection_source, "all_source_blocks");
assert.deepEqual(missingSelectedPayload.analysis_source_bundle.warnings, []);

assertSelectedAnalysisBlock("listing-risk-8k.json", "3.01");
assertSelectedAnalysisBlock("strategic-transaction-8k.json", "2.01");
assertSelectedAnalysisBlock("shareholder-vote-8k.json", "5.07");
assertSelectedAnalysisBlock("six-k-exhibit-99-1.json", null, "99.1");
assertAnalysisBundleIncludesSelectedBlocks("exchange-delisting-8k.json", "listing_risk", [
  { itemNumber: "3.01", text: "Staff Delisting Determination" },
  { exhibitNumber: "99.1", text: "Nasdaq Staff Delisting Determination" },
]);
assertAnalysisBundleIncludesSelectedBlocks("voluntary-delisting-8k.json", "listing_risk", [
  { itemNumber: "8.01", text: "voluntary delisting" },
  { exhibitNumber: "99.1", text: "voluntary NYSE delisting" },
]);
assertAnalysisBundleIncludesSelectedBlocks("merger-closing-delisting-8k.json", "strategic_transaction", [
  { itemNumber: "2.01", text: "completed its previously announced merger" },
  { itemNumber: "3.01", text: "procedural and results from the completed merger" },
  { exhibitNumber: "99.1", text: "$18.25 per share in cash" },
]);
assertAnalysisBundleIncludesSelectedBlocks("material-vote-results-8k.json", "shareholder_vote", [
  { itemNumber: "5.07", text: "Stockholders approved the issuance" },
]);
assertAnalysisBundleIncludesSelectedBlocks("complex-financing-8k.json", "dilution_risk", [
  { itemNumber: "1.01", text: "securities purchase agreement" },
  { itemNumber: "2.03", text: "$12,000,000 principal amount" },
  { itemNumber: "3.02", text: "private placement exempt from registration" },
  { exhibitNumber: "10.1", text: "Securities Purchase Agreement" },
  { exhibitNumber: "10.2", text: "Senior Secured Convertible Note" },
  { exhibitNumber: "4.1", text: "Form of Warrant" },
]);

console.log("sec 8k-6k analysis expected-output checks passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assertParserExpectedHasNoRoutingDecision(expected: Sec8k6kRoomExpectedOutput, label: string) {
  const facts = expected.parser_output.facts as unknown as Record<string, unknown>;
  assert.equal("primaryEventCandidate" in facts, false, label);
  assert.equal("eventCandidates" in facts, false, label);
  assert.equal("deterministicDecision" in facts, false, label);

  for (const signal of expected.parser_output.signals as unknown as Array<Record<string, unknown>>) {
    assert.equal("eventType" in signal, false, label);
    assert.equal("scoreHint" in signal, false, label);
    assert.equal("displayType" in signal, false, label);
  }
}

function assertCurrentFamilyFixtureContract(expected: Sec8k6kRoomExpectedOutput, label: string) {
  const output = expected.analysis_output;
  const payload = expected.display_payload;
  const data = payload.data as Record<string, any>;
  const family = expected.fixture_expected.analysis_family;
  const hasOutputField = (field: string) => Object.prototype.hasOwnProperty.call(output, field);

  if (family === "risk_status") {
    assert.equal(payload.display_type, "generic", label);
    assert.ok(Array.isArray(output.listing_status_snapshot), label);
    assert.ok(output.listing_status_snapshot!.length >= 2 && output.listing_status_snapshot!.length <= 4, label);
    assert.ok(Array.isArray(output.key_evidence) && output.key_evidence.length >= 2 && output.key_evidence.length <= 3, label);
    assert.ok(Array.isArray(output.what_to_watch_next) && output.what_to_watch_next.length <= 3, label);
    return;
  }

  if (family === "capital_financing") {
    assert.equal(payload.display_type, "capital_financing", label);
    assert.ok(SEC_8K_6K_CAPITAL_FINANCING_MODE_VALUES.includes(data.capital_mode), label);
    assert.ok(Array.isArray(data.snapshot_metrics) && data.snapshot_metrics.length >= 2 && data.snapshot_metrics.length <= 4, label);
    assert.ok(Object.prototype.hasOwnProperty.call(data, "share_overhang"), label);
    assert.ok(Array.isArray(data.instrument_details), label);
    assert.ok(Array.isArray(data.offering_details), label);
    assert.equal(hasOutputField("key_evidence"), false, label);
    assert.equal(hasOutputField("what_to_watch_next"), false, label);
    return;
  }

  if (family === "strategic_transaction") {
    assert.equal(payload.display_type, "strategic_transaction", label);
    assert.ok(Array.isArray(data.snapshot_metrics) && data.snapshot_metrics.length >= 2 && data.snapshot_metrics.length <= 4, label);
    assert.ok(Array.isArray(output.key_evidence) && output.key_evidence.length >= 2 && output.key_evidence.length <= 3, label);
    assert.ok(Array.isArray(output.what_to_watch_next) && output.what_to_watch_next.length <= 3, label);
    return;
  }

  if (family === "governance_vote") {
    assert.equal(payload.display_type, "governance_event", label);
    assert.ok(["leadership_change", "auditor_change", "vote_result", "governance_change", "mixed"].includes(data.governance_mode), label);
    assert.ok(Array.isArray(data.snapshot_metrics) && data.snapshot_metrics.length >= 2 && data.snapshot_metrics.length <= 4, label);
    assert.ok(Array.isArray(data.key_changes) && data.key_changes.length >= 1 && data.key_changes.length <= 4, label);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "evidence"), false, label);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "notes"), false, label);
    assert.equal(hasOutputField("key_evidence"), false, label);
    assert.equal(hasOutputField("what_to_watch_next"), false, label);
    return;
  }

  assert.equal(family, "operating_legal_routine", label);
  assert.equal(payload.display_type, "operating_event", label);
  assert.ok(["earnings", "operating_update", "product_or_regulatory", "legal_or_accounting", "routine_archive"].includes(data.operating_mode), label);
  assert.ok(Array.isArray(data.performance_comparisons) && data.performance_comparisons.length <= 3, label);
  assert.ok(Array.isArray(data.snapshot_metrics) && data.snapshot_metrics.length <= 4, label);
  if (data.operating_mode !== "routine_archive") {
    assert.ok(data.snapshot_metrics.length >= 2, label);
  }
  assert.ok(Array.isArray(data.guidance_metrics) && data.guidance_metrics.length <= 3, label);
  assert.ok(Array.isArray(data.business_catalysts) && data.business_catalysts.length <= 3, label);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "evidence"), false, label);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "notes"), false, label);
  assert.equal(hasOutputField("key_evidence"), false, label);
  assert.equal(hasOutputField("what_to_watch_next"), false, label);
}

function assertArchiveDisplayPayload(expected: Sec8k6kRoomExpectedOutput, label: string) {
  const output = expected.analysis_output;
  const displayPayload = expected.display_payload;
  const data = displayPayload.data as Record<string, unknown>;

  assert.equal(displayPayload.display_type, "operating_event", label);
  assert.equal(data.operating_mode, "routine_archive", label);
  assert.deepEqual(data.snapshot_metrics, [], label);
  assert.deepEqual(data.performance_comparisons, [], label);
  assert.deepEqual(data.guidance_metrics, [], label);
  assert.deepEqual(data.business_catalysts, [], label);
  assert.equal(Object.prototype.hasOwnProperty.call(output, "key_evidence"), false, label);
  assert.equal(Object.prototype.hasOwnProperty.call(output, "what_to_watch_next"), false, label);
  assert.ok(output.summary.includes("corrected Exhibit 99.1 caption"), label);
}

function firstAnalysisBlock(blocks: Array<Record<string, any>>) {
  return blocks.find((block) => {
    const blockType = String(block.block_type || "");
    return block.block_id && block.text && !["current_filing", "filing_metadata"].includes(blockType) && !blockType.includes("inventory");
  });
}

function assertSelectedAnalysisBlock(fixtureName: string, itemNumber: string | null, exhibitNumber?: string) {
  const localFixture = readJson<Sec8k6kParseInput>(join(fixturesDir, fixtureName));
  const localParsed = parseSec8k6kFiling(localFixture);
  const localSourceInput = buildSecSourceBlockPromptInput({
    filingPackage: localFixture as Record<string, unknown>,
    parserOutput: localParsed as unknown as Record<string, unknown>,
    fallbackText: localFixture.bodyText || null,
  });
  const block = localSourceInput.cleaned_source_blocks.find((candidate: Record<string, any>) => {
    if (itemNumber && candidate.item_number === itemNumber) return true;
    if (exhibitNumber && candidate.exhibit_number === exhibitNumber) return true;
    return false;
  });
  assert.ok(block?.block_id, fixtureName);
  const localPrompt = buildSec8k6kAnalysisPromptDraft({
    filing_package: localFixture as Record<string, unknown>,
    parser_output: localParsed as unknown as Record<string, unknown>,
    filing_excerpt: localFixture.bodyText || null,
    router_result: {
      event_type: itemNumber === "3.01" ? "listing_risk" : itemNumber === "5.07" ? "shareholder_vote" : "strategic_transaction",
      route_case: itemNumber === "3.01" ? "listing_risk" : itemNumber === "5.07" ? "shareholder_vote" : "strategic_transaction",
      score: 50,
      analysis_needed: true,
      display_type: "generic",
      display_version: "sec_8k_6k_generic_v1",
      selected_source_block_ids: [block.block_id],
      route_candidates: [
        {
          route_type: itemNumber === "3.01" ? "listing_risk" : itemNumber === "5.07" ? "shareholder_vote" : "strategic_transaction",
          priority: "primary",
          confidence: "high",
          selected_source_block_ids: [block.block_id],
          reason: "Selected source block reaches analysis.",
        },
      ],
    },
  });
  const payload = JSON.parse(localPrompt.user) as Record<string, any>;
  assert.equal(payload.analysis_source_bundle.selection_source, "all_source_blocks", fixtureName);
  assert.ok(sourceBlocks(payload).some((candidate) => candidate.block_id === block.block_id && candidate.text === block.text), fixtureName);
}

function assertAnalysisBundleIncludesSelectedBlocks(
  fixtureName: string,
  routeType: string,
  selectors: Array<{ itemNumber?: string; exhibitNumber?: string; text: string }>,
) {
  const localFixture = readJson<Sec8k6kParseInput>(join(fixturesDir, fixtureName));
  const localParsed = parseSec8k6kFiling(localFixture);
  const localSourceInput = buildSecSourceBlockPromptInput({
    filingPackage: localFixture as Record<string, unknown>,
    parserOutput: localParsed as unknown as Record<string, unknown>,
    fallbackText: localFixture.bodyText || null,
  });
  const selectedBlocks = selectors.map((selector) => {
    const block = localSourceInput.cleaned_source_blocks.find((candidate: Record<string, any>) => {
      if (selector.itemNumber && candidate.item_number === selector.itemNumber) return String(candidate.text || "").includes(selector.text);
      if (selector.exhibitNumber && candidate.exhibit_number === selector.exhibitNumber) return String(candidate.text || "").includes(selector.text);
      return false;
    });
    assert.ok(block?.block_id, `${fixtureName} ${selector.itemNumber || selector.exhibitNumber}`);
    return block;
  });
  const selectedIds = selectedBlocks.map((block) => block.block_id);
  const localPrompt = buildSec8k6kAnalysisPromptDraft({
    filing_package: localFixture as Record<string, unknown>,
    parser_output: localParsed as unknown as Record<string, unknown>,
    filing_excerpt: localFixture.bodyText || null,
    router_result: {
      event_type: routeType,
      route_case: routeType,
      score: 60,
      analysis_needed: true,
      display_type: "generic",
      display_version: "sec_8k_6k_generic_v1",
      selected_source_block_ids: selectedIds,
      primary_route_candidate: {
        route_type: routeType,
        priority: "primary",
        confidence: "high",
        selected_source_block_ids: selectedIds,
        reason: "Selected original source blocks must reach analysis.",
      },
      route_candidates: [
        {
          route_type: routeType,
          priority: "primary",
          confidence: "high",
          selected_source_block_ids: selectedIds,
          reason: "Selected original source blocks must reach analysis.",
        },
      ],
    },
  });
  const payload = JSON.parse(localPrompt.user) as Record<string, any>;
  assert.equal(payload.analysis_source_bundle.selection_source, "all_source_blocks", fixtureName);
  assert.equal(payload.analysis_source_bundle.included_source_block_ids.length, payload.source_block_manifest.length, fixtureName);
  for (const selectedBlock of selectedBlocks) {
    assert.ok(sourceBlocks(payload).some((candidate) => candidate.block_id === selectedBlock.block_id && candidate.text === selectedBlock.text), fixtureName);
  }
}

function sourceBlocks(payload: Record<string, any>): Array<Record<string, any>> {
  return Array.isArray(payload.cleaned_source_blocks) ? payload.cleaned_source_blocks : [];
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
  assert.deepEqual(
    sourceBlocks(payload).map((block) => String(block.block_type || "")).filter((type) => forbidden.has(type)),
    [],
  );
}
