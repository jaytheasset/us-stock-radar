import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  secFilingAnalysisResponseSchema,
  type SecFilingAnalysisInput,
} from "@/lib/prompts/secFilingAnalysis";
import {
  adaptOwnershipPromptResultForAnalysis,
  applySecOwnershipValidationRepairPatches,
  buildSecOwnershipAnalysisPrompt,
  buildSecOwnershipValidationRepairPlan,
  collectOwnershipRuntimeDisplayPayloadWarnings,
} from "@/lib/ai/secOwnershipAnalysisAdapter";

describe("Ownership validation repair", () => {
  it("uses only the original SEC excerpt and limits repair to existing scalar fields", () => {
    const input = buildOwnershipRepairInput();
    const analysisResult = buildOwnershipRepairAnalysis();
    const plan = buildSecOwnershipValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.deepEqual(plan.sourceBlockIds, ["ownership_original_source_excerpt_1"]);
    assert.ok(plan.issues.some((issue) => issue.code === "missing_filing_summary"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/filing_summary"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
    assert.ok(plan.prompt.system.includes("instead of using parser facts"));
  });

  it("ignores unauthorized score and structural edits", () => {
    const analysisResult = buildOwnershipRepairAnalysis();
    const result = applySecOwnershipValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/display_payload/data/filing_summary"],
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/filing_summary",
            replacement: "The CEO reported an open-market purchase of 10,000 shares at $12.50 per share.",
            reason: "The original Form 4 excerpt states the purchase terms.",
            source_block_ids: ["ownership_original_source_excerpt_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 90,
            reason: "Not authorized.",
            source_block_ids: [],
          },
          {
            path: "/display_payload/data/form4/new_row",
            replacement: "not allowed",
            reason: "Not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    const data = (result.value.display_payload as Record<string, unknown>).data as Record<string, unknown>;
    assert.equal(data.filing_summary, "The CEO reported an open-market purchase of 10,000 shares at $12.50 per share.");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 55);
    assert.deepEqual(result.appliedPaths, ["/display_payload/data/filing_summary"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
    assert.ok(result.ignoredPaths.includes("/display_payload/data/form4/new_row"));
  });

  it("keeps missing ownership UI data as a warning instead of failing persistence", () => {
    const warnings = collectOwnershipRuntimeDisplayPayloadWarnings({
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    });
    assert.ok(warnings.some((warning) => /filing_summary|ownership details/i.test(warning)));

    const result = adaptOwnershipPromptResultForAnalysis(buildCompleteOwnershipAnalysis(), buildOwnershipRepairInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const displayPayload = result.analysis.display_payload as Record<string, unknown>;
    assert.ok((displayPayload.notes as string[]).some((warning) => /filing_summary|ownership details/i.test(warning)));
  });

  it("requires additive typed monitor facts without changing visible Ownership output", () => {
    const input = buildOwnershipRepairInput();
    const prompt = buildSecOwnershipAnalysisPrompt(input);
    const schema = prompt.responseFormat.json_schema as any;
    assert.equal(prompt.version, "v3-semantic-source-judge");
    assert.ok(prompt.user.includes("analysis_output.ownership_monitor_facts"));
    assert.ok(prompt.user.includes("Do not calculate transaction value here"));
    assert.ok(prompt.user.includes("transaction code or A/D alone"));
    assert.ok(prompt.user.includes("percent_calculation"));
    assert.ok(schema.schema.properties.analysis_output.required.includes("ownership_monitor_facts"));
    assert.equal(schema.schema.properties.analysis_output.properties.ownership_monitor_facts.properties.version.enum[0], "ownership_monitor_facts_v1");
    assert.ok(
      schema.schema.properties.analysis_output.properties.ownership_monitor_facts.properties.form144
        .properties.proposed_sales.items.required.includes("percent_calculation"),
    );

    const missing = buildCompleteOwnershipAnalysis();
    delete (missing.analysis_output as Record<string, unknown>).ownership_monitor_facts;
    const result = adaptOwnershipPromptResultForAnalysis(missing, input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /ownership monitor facts failed validation/i);
  });

  it("removes exclusiveMinimum only from every Ownership Primary provider schema", () => {
    const {
      previewSource,
      readGeminiResponseSchema,
      toGeminiResponseSchema,
    } = compileGeminiResponseSchemaConverters();
    assert.ok(previewSource.includes("responseSchema: readGeminiResponseSchema(prompt)"));

    const formTypes = ["4", "4/A", "144", "144/A"] as const;
    for (const formType of formTypes) {
      const input = structuredClone(buildOwnershipRepairInput()) as any;
      input.filing_package.form_type = formType;
      input.filing_package.hard_parsers.ownership.formType = `Form ${formType}`;

      const prompt = buildSecOwnershipAnalysisPrompt(input);
      const originalSchema = (prompt.responseFormat.json_schema as any).schema;
      const originalSnapshot = structuredClone(originalSchema);
      const originalMultiplier = readNormalizationMultiplierSchema(originalSchema);
      assert.equal(originalMultiplier.exclusiveMinimum, 0, formType);
      assert.deepEqual(originalMultiplier.type, ["number", "null"], formType);

      const requestBody = {
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: readGeminiResponseSchema(prompt),
        },
      };
      const providerSchema = requestBody.generationConfig.responseSchema as any;
      const providerMultiplier = readNormalizationMultiplierSchema(providerSchema);
      assert.equal(hasNestedKey(providerSchema, "exclusiveMinimum"), false, formType);
      assert.equal(providerMultiplier.type, "number", formType);
      assert.equal(providerMultiplier.nullable, true, formType);
      assert.deepEqual(providerSchema.required, originalSchema.required, formType);
      assert.deepEqual(
        providerSchema.properties.analysis_output.required,
        originalSchema.properties.analysis_output.required,
        formType,
      );
      assert.deepEqual(
        providerSchema.properties.analysis_output.properties.event_type.enum,
        originalSchema.properties.analysis_output.properties.event_type.enum,
        formType,
      );
      assert.deepEqual(originalSchema, originalSnapshot, formType);
    }

    const genericSnapshot = structuredClone(secFilingAnalysisResponseSchema);
    const genericProviderSchema = toGeminiResponseSchema(secFilingAnalysisResponseSchema) as any;
    assert.deepEqual(secFilingAnalysisResponseSchema, genericSnapshot);
    assert.equal(genericProviderSchema.type, "object");
    assert.deepEqual(genericProviderSchema.required, secFilingAnalysisResponseSchema.required);
    assert.deepEqual(
      genericProviderSchema.properties.event_type.enum,
      secFilingAnalysisResponseSchema.properties.event_type.enum,
    );
    assert.equal(genericProviderSchema.properties.primary_ticker.type, "object");
    assert.equal(genericProviderSchema.properties.primary_ticker.nullable, undefined);
    assert.equal(genericProviderSchema.properties.primary_ticker.properties.ticker.type, "string");
    assert.equal(genericProviderSchema.properties.primary_ticker.properties.ticker.nullable, true);
  });

  it("keeps an unconfirmed Form 144 unit comparison out of PDD investor copy", () => {
    const input = buildOwnershipRepairInput();
    const analysis = buildUnconfirmedPddAnalysis();
    const result = adaptOwnershipPromptResultForAnalysis(analysis, input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const output = analysis.analysis_output as Record<string, unknown>;
    const display = (analysis.display_payload as Record<string, any>).data as Record<string, unknown>;
    const visibleEvidence = JSON.stringify({
      event_title: output.event_title,
      quick_take: output.quick_take,
      summary: output.summary,
      why_it_matters: output.why_it_matters,
      score_reason: output.score_reason,
      bullish_points: output.bullish_points,
      bearish_points: output.bearish_points,
      key_evidence: output.key_evidence,
      what_to_watch_next: output.what_to_watch_next,
      filing_summary: display.filing_summary,
    });
    assert.doesNotMatch(visibleEvidence, /%|percent/i);
    const facts = output.ownership_monitor_facts as Record<string, any>;
    assert.equal(facts.form144.proposed_sales[0].percent_calculation.comparable_units, null);
  });
});

function buildOwnershipRepairInput() {
  return {
    filing_package: {
      form_type: "4",
      hard_parsers: {
        ownership: {
          parserVersion: "ownership-v1",
          parserGroup: "ownership",
          formType: "Form 4",
          accessionNumber: "0001000000-26-000400",
          isSupported: true,
          summary: "CEO purchase",
          facts: {},
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {
            source_excerpt: "The reporting person, Acme CEO Jane Smith, acquired 10,000 shares of common stock at $12.50 per share in an open-market purchase.",
            selected_evidence: [
              { label: "form4_transaction", value: "code P; 10,000 shares; $12.50", source: "transaction table" },
            ],
          },
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function compileGeminiResponseSchemaConverters() {
  const here = dirname(fileURLToPath(import.meta.url));
  const previewSource = readFileSync(join(here, "secFilingAnalysisPreview.ts"), "utf8");
  const start = previewSource.indexOf("function readGeminiResponseSchema(");
  const end = previewSource.indexOf("\nfunction buildGeminiGenerateContentUrl(", start);
  assert.ok(start >= 0 && end > start);
  const executableSource = stripTypeScriptTypes(previewSource.slice(start, end), { mode: "transform" });
  const factory = new Function(
    "mocks",
    `const { readRecord, stringValue, numberValue, finiteNumber } = mocks;
    ${executableSource}
    return { readGeminiResponseSchema, toGeminiResponseSchema };`,
  );

  const converters = factory({
    readRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null,
    stringValue: (value: unknown) => typeof value === "string" ? value.trim() : "",
    numberValue: (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null,
    finiteNumber: (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0,
  }) as {
    readGeminiResponseSchema: (prompt: unknown) => unknown;
    toGeminiResponseSchema: (schema: unknown) => unknown;
  };
  return { previewSource, ...converters };
}

function readNormalizationMultiplierSchema(schema: any) {
  return schema.properties.analysis_output.properties.ownership_monitor_facts.properties.form144
    .properties.proposed_sales.items.properties.percent_calculation.properties.normalization_multiplier;
}

function hasNestedKey(value: unknown, targetKey: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNestedKey(item, targetKey));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, targetKey)
    || Object.values(record).some((child) => hasNestedKey(child, targetKey));
}

function buildOwnershipRepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "CEO buys 10,000 shares",
      summary: "The CEO bought $ shares in the open market.",
      score: 55,
      signal: "bullish",
    },
    display_payload: {
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    },
  };
}

function buildCompleteOwnershipAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "insider_ownership",
      event_title: "CEO buys 10,000 shares",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 55,
      score_reason: "The CEO made a source-backed open-market purchase.",
      signal: "bullish",
      quick_take: "The CEO purchased 10,000 shares in the open market.",
      summary: "The CEO acquired 10,000 shares at $12.50 per share.",
      why_it_matters: "A direct insider purchase can signal management confidence, though the position size remains limited.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
      ownership_monitor_facts: {
        version: "ownership_monitor_facts_v1",
        form4: {
          reporting_owners: [{
            name: "Jane Smith",
            roles: ["CEO", "Director"],
            is_officer: true,
            is_director: true,
            is_10_percent_owner: null,
            officer_title: "Chief Executive Officer",
            evidence: ["Jane Smith is identified as CEO and director."],
            confidence: "high",
          }],
          transactions: [{
            transaction_kind: "non_derivative",
            security_title: "Common Stock",
            transaction_date: "2026-08-10",
            transaction_code: "P",
            acquired_disposed_code: "A",
            economic_direction: "buy",
            shares: { value: 10_000, value_quality: "exact", availability: "available" },
            price_per_share: { value: 12.5, value_quality: "exact", availability: "available" },
            post_transaction_shares: { value: null, value_quality: "unknown", availability: "unavailable" },
            direct_or_indirect_ownership: "D",
            nature_of_ownership: null,
            is_10b5_1: null,
            evidence: ["Transaction code P reports 10,000 shares at $12.50."],
            confidence: "high",
          }],
        },
        form144: null,
      },
    },
    display_payload: {
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    },
  };
}

function buildUnconfirmedPddAnalysis(): Record<string, unknown> {
  const result = buildCompleteOwnershipAnalysis();
  const output = result.analysis_output as Record<string, any>;
  output.event_title = "Director proposes sale of 1,533 ADS";
  output.score = 35;
  output.score_reason = "Small proposed value with incomparable reported units.";
  output.signal = "neutral";
  output.quick_take = "A director filed a notice to sell 1,533 ADS.";
  output.summary = "The notice proposes 1,533 ADS valued at about $153,009. The outstanding figure uses ordinary shares, so no ownership ratio is stated.";
  output.why_it_matters = "The notice is small by value, while its reported units are not directly comparable.";
  output.bullish_points = [];
  output.bearish_points = [];
  output.key_evidence = ["1,533 ADS proposed", "$153,008.73 aggregate value", "Outstanding basis uses ordinary shares"];
  output.what_to_watch_next = [];
  output.ownership_monitor_facts = {
    version: "ownership_monitor_facts_v1",
    form4: null,
    form144: {
      reporting_owners: [{
        name: "Kam Anthony Ping Leung",
        roles: ["director"],
        is_officer: false,
        is_director: true,
        is_10_percent_owner: false,
        officer_title: null,
        evidence: ["Director"],
        confidence: "high",
      }],
      proposed_sales: [{
        security_title: "ADS",
        proposed_sale_shares: { value: 1_533, value_quality: "exact", availability: "available" },
        aggregate_market_value: { value: 153_008.73, value_quality: "exact", availability: "available" },
        proposed_sale_date: "2026-03-30",
        exchange: "NASDAQ",
        shares_outstanding: { value: 5_693_585_848, value_quality: "exact", availability: "available" },
        percent_calculation: {
          comparable_units: null,
          numerator_unit: "ADS",
          denominator_unit: "ordinary shares",
          normalization_target: null,
          normalization_multiplier: null,
          source_relation: null,
          evidence: ["The source labels the numerator as ADS and the denominator as ordinary shares."],
          confidence: null,
        },
        evidence: ["Form 144 securities information"],
        confidence: "high",
      }],
    },
  };
  (result.display_payload as Record<string, any>).data = {
    filing_summary: "The director proposes to sell 1,533 ADS valued at about $153,009; the outstanding basis uses ordinary shares.",
    form144: { proposed_sale_shares: 1_533, aggregate_market_value: 153_008.73 },
  };
  return result;
}

