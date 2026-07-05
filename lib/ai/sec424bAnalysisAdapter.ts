import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { build424bAnalysisPrompt, type Sec424bAnalysisPromptVariant } from "@/lib/sources/sec/forms/424b/analysisPrompt";
import { APPROVED_424B_EVENT_TYPES } from "@/lib/sources/sec/forms/424b/types";
import type { Sec424bParserOutput } from "@/lib/sources/sec/forms/424b/types";
import { collectSecOfferingMarketContextWarnings } from "@/lib/secOfferingMarketContext";
import { marketTaxonomyAnalysisOutputSchemaProperties } from "@/lib/marketTaxonomySchema";
import {
  looseObjectSchema,
  offeringDisplayRowSchema,
  scoreExplanationSchema,
  shareOverhangSchema,
} from "@/lib/ai/secOfferingOutputSchemas";

export const SEC_424B_ANALYSIS_PROMPT_KEY = "sec_424b_analysis";
export const SEC_424B_ANALYSIS_PROMPT_VERSION = "v20";
export const SEC_424B_SECTIONED_ANALYSIS_PROMPT_VERSION = "v39-taxonomy-schema";
const ALLOWED_424B_DISPLAY_MODES = new Set([
  "atm",
  "resale_registration",
  "primary_offering",
  "registered_direct",
  "warrant_convertible",
  "rights_offering",
  "shelf_capacity",
  "spac_transaction_status",
  "mixed_offering",
  "generic",
]);

export const APPROVED_424B_SHARE_OVERHANG_CHART_TITLES = [
  "Share Dilution",
  "Share Overhang",
  "Warrant Share Supply",
  "Convertible Share Supply",
  "Preferred Conversion Supply",
  "Pre-Funded Warrant Supply",
  "Mixed Instrument Supply",
  "Mixed Offering",
  "Rights Offering",
  "ATM Program",
  "Shelf Details",
] as const;

export type Sec424bAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function is424bFilingInput(input: SecFilingAnalysisInput) {
  return Boolean(read424bParserOutput(input));
}

export function buildSec424bAnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  options: { promptVariant?: Sec424bAnalysisPromptVariant | string } = {},
) {
  const parserOutput = read424bParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 424B parser output is missing from filing package");
  }
  const parserOutputForPrompt = attach424bPromptMarketContext(parserOutput, input);
  const promptVariant = normalize424bPromptVariant(options.promptVariant);
  const promptVersion =
    promptVariant === "legacy" ? SEC_424B_ANALYSIS_PROMPT_VERSION : SEC_424B_SECTIONED_ANALYSIS_PROMPT_VERSION;

  return {
    key: SEC_424B_ANALYSIS_PROMPT_KEY,
    version: promptVersion,
    system: [
      "Analyze one SEC 424B filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "There is no 424B router LLM and no parser-completed 424B result. Choose event_type, display_type, score, and display_payload from the provided source blocks.",
      "Use generic for the common filing detail page, offering_terms for offering/dilution/IPO terms, and spac_transaction_status only for source-backed SPAC/de-SPAC transaction status.",
      "For analysis_output sector and industry_group, use exact taxonomy display names from the response schema. For theme_group and sub_theme, use exact taxonomy slugs from the response schema. Use null when unsupported.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: build424bAnalysisPrompt(parserOutputForPrompt, { variant: promptVariant }),
    responseFormat: {
      json_schema: {
        name: "sec_424b_required_output",
        strict: false,
        schema: sec424bRequiredOutputSchema,
      },
    },
  };
}

function attach424bPromptMarketContext(
  parserOutput: Sec424bParserOutput,
  input: SecFilingAnalysisInput,
): Sec424bParserOutput {
  const raw = readRecord(parserOutput.raw) || {};
  const existingMarketContext = readRecord(raw.marketContext) || readRecord(raw.market_context);
  const filingPackage = readFilingPackage(input);
  const packageMarketContext = readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext);
  const marketContext = existingMarketContext || packageMarketContext;

  if (!marketContext) return parserOutput;

  return {
    ...parserOutput,
    raw: {
      ...raw,
      marketContext,
    },
  };
}

function normalize424bPromptVariant(value: unknown): Sec424bAnalysisPromptVariant {
  if (typeof value !== "string") return "sectioned";
  const normalized = value.trim().toLowerCase();
  if (normalized === "legacy" || normalized === "legacy-default" || normalized === "old-default") return "legacy";
  return "sectioned";
}

export function adaptSec424bAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): Sec424bAnalysisAdapterResult {
  const parserOutput = read424bParserOutput(input);
  const filingPackage = readRecord(input.filing_package);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC 424B result did not contain analysis_output and display_payload",
    };
  }
  const normalizedAnalysisOutput = normalize424bAnalysisOutput(analysisOutput, input);
  const scoreExplanation = normalizeScoreExplanation(
    readRecord((normalizedAnalysisOutput as Record<string, unknown>).score_explanation),
  );
  if (!scoreExplanation?.summary && (!scoreExplanation?.base_band || !scoreExplanation.final_read)) {
    return {
      ok: false,
      error: "SEC 424B analysis_output.score_explanation must include summary or base_band/final_read for the Score Basis UI",
    };
  }
  const normalizedDisplayPayload = normalize424bDisplayPayload(displayPayload);
  const displayPayloadError = validate424bDisplayPayload(normalizedDisplayPayload);
  const displayPayloadWarnings = [
    ...(displayPayloadError ? [displayPayloadError] : []),
    ...collect424bDisplayPayloadWarnings(normalizedDisplayPayload),
    ...collect424bScoreConsistencyWarnings(normalizedAnalysisOutput, normalizedDisplayPayload),
    ...collectSecOfferingMarketContextWarnings(filingPackage?.market_context, "SEC 424B"),
  ];
  append424bDisplayWarnings(normalizedDisplayPayload, displayPayloadWarnings);

  return adapt424bRoomResultForAnalysis({
    parser_output: parserOutput,
    analysis_output: align424bAnalysisOutputToDisplayPayload(
      normalizedAnalysisOutput,
      normalizedDisplayPayload,
    ),
    display_payload: normalizedDisplayPayload,
  }, displayPayloadWarnings);
}

type Validate424bDisplayPayloadOptions = {
  requireKeyCashTermFacts?: boolean;
  strictLabels?: boolean;
  requireMixedComponents?: boolean;
};

export function validate424bDisplayPayload(
  displayPayload: Record<string, unknown>,
  options: Validate424bDisplayPayloadOptions = {},
) {
  void options;
  if (stringValue(displayPayload.display_type) !== "offering_terms") return "";
  const data = readRecord(displayPayload.data);
  if (!data || !Object.keys(data).length) {
    return "SEC 424B offering_terms display_payload.data must be filled by the analysis LLM";
  }

  const displayMode = stringValue(data.display_mode);
  const requiredKeys = [
    "display_mode",
    "snapshot_metrics",
    "investor_takeaway",
    "needs_human_review",
  ];
  const missing = requiredKeys.filter((key) => !(key in data));
  if (missing.length) {
    return `SEC 424B offering_terms display_payload.data missing required field(s): ${missing.join(", ")}`;
  }
  if (!stringValue(data.investor_takeaway)) {
    return "SEC 424B offering_terms display_payload.data.investor_takeaway must be written by the analysis LLM";
  }
  if (!arrayValue(data.snapshot_metrics).length) {
    return "SEC 424B offering_terms display_payload.data.snapshot_metrics must be written by the analysis LLM";
  }
  if (displayMode && !ALLOWED_424B_DISPLAY_MODES.has(displayMode)) {
    return `SEC 424B offering_terms display_payload.data.display_mode is not allowed: ${displayMode}`;
  }
  return "";
}

export function collect424bDisplayPayloadWarnings(displayPayload: Record<string, unknown>) {
  const warnings: string[] = [];
  if (stringValue(displayPayload.display_type) !== "offering_terms") return warnings;

  const data = readRecord(displayPayload.data);
  if (!data) return warnings;

  const keyCashWarning = validateKeyCashTermFacts(data);
  if (keyCashWarning) warnings.push(`SEC 424B ${keyCashWarning}`);

  const currentShares = readRecord(data.current_shares);
  const totalPotentialSupply = readRecord(data.total_potential_supply);
  const displayMode = stringValue(data.display_mode);
  const adsEquivalence = readRecord(data.ads_equivalence);
  const ordinarySharesRepresented = readRecord(adsEquivalence?.ordinary_shares_represented);
  const adsOffered = readRecord(adsEquivalence?.ads_offered);
  const totalPotentialText = `${stringValue(totalPotentialSupply?.value_text)} ${stringValue(totalPotentialSupply?.evidence)}`;
  const currentSharesText = `${stringValue(currentShares?.value_text)} ${stringValue(currentShares?.evidence)}`;
  if (
    /\bADSs?\b|American Depositary Shares?/i.test(totalPotentialText) &&
    /\bordinary shares?\b/i.test(currentSharesText) &&
    !hasDisplayFactValue(ordinarySharesRepresented)
  ) {
    warnings.push("SEC 424B ADS offering should separate ADS count from ordinary-share exposure in ads_equivalence.ordinary_shares_represented before calculating overhang.");
  }
  if (
    /\bADSs?\b|American Depositary Shares?/i.test(totalPotentialText) &&
    /\bordinary shares?\b/i.test(stringValue(totalPotentialSupply?.evidence)) &&
    hasDisplayFactValue(adsOffered) &&
    !hasDisplayFactValue(ordinarySharesRepresented)
  ) {
    warnings.push("SEC 424B total_potential_supply may be using ADS count when evidence gives ordinary shares represented.");
  }
  const snapshotMetrics = arrayValue(data.snapshot_metrics);
  const snapshotText = snapshotMetrics
    .map((row) => {
      const record = readRecord(row);
      return `${stringValue(record?.label)} ${stringValue(record?.value)} ${stringValue(record?.note)}`;
    })
    .join(" ");
  const selectedModeUsesShareOverhang = [
    "primary_offering",
    "registered_direct",
    "resale_registration",
    "warrant_convertible",
    "rights_offering",
    "mixed_offering",
  ].includes(displayMode);
  if (
    (selectedModeUsesShareOverhang || /\b(?:Dilution|Overhang|Size vs|Scale|vs current shares|vs market cap)\b/i.test(snapshotText)) &&
    !hasShareOverhangContent(readRecord(data.share_overhang))
  ) {
    warnings.push("SEC 424B selected display mode uses a visible share/scale chart but display_payload.data.share_overhang is missing.");
  }
  const shareOverhang = readRecord(data.share_overhang);
  const shareOverhangRows = arrayValue(shareOverhang?.rows)
    .map((row) => readRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const shareOverhangSegments = arrayValue(shareOverhang?.segments)
    .map((segment) => readRecord(segment))
    .filter((segment): segment is Record<string, unknown> => Boolean(segment));
  const hasStructuredRows = Boolean(readRecord(shareOverhang?.basis)) || shareOverhangRows.length > 0;
  const hasIncludedShareOverhangRowAmount = shareOverhangRows.some(
    (row) => isIncludedShareOverhangRow(row) && hasUsableShareOverhangAmount(row),
  );
  const hasIncludedShareOverhangSegment = shareOverhangSegments.some((segment) => {
    const countedInRatio = booleanValue(segment.counted_in_ratio ?? segment.countedInRatio);
    if (typeof countedInRatio === "boolean") return countedInRatio;
    return ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(
      stringValue(segment.supply_nature || segment.supplyNature),
    );
  });
  const basisRecord = readRecord(shareOverhang?.basis);
  const hasShareOverhangBasis = hasUsableShareOverhangBasis(basisRecord);
  const hasBaseShareOverhangSegment = shareOverhangSegments.some(
    (segment) =>
      stringValue(segment.supply_nature || segment.supplyNature) === "base_shares" &&
      hasUsableShareOverhangAmount(segment),
  );
  if (
    selectedModeUsesShareOverhang &&
    (hasStructuredRows
      ? hasIncludedShareOverhangRowAmount && !hasShareOverhangBasis
      : hasIncludedShareOverhangSegment && !hasBaseShareOverhangSegment)
  ) {
    warnings.push(
      "SEC 424B share_overhang has numeric included supply rows but no usable numeric basis denominator; use source-block shares outstanding first, then market_context.shares_outstanding when source blocks do not provide it.",
    );
  }
  const basisText = shareBasisText(basisRecord);
  const includedRowsBasisText = shareOverhangRows
    .filter((row) => {
      const rowRole = shareOverhangRowRole(row);
      if (rowRole) return rowRole === "counted";
      const calculationRole = stringValue(row.calculation_role || row.calculationRole);
      const supplyNature = stringValue(row.supply_nature || row.supplyNature);
      return (
        calculationRole === "headline_numerator" &&
        ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(supplyNature)
      );
    })
    .map(shareBasisText)
    .join(" ");
  if (
    includedRowsBasisText &&
    basisText &&
    /\bclass\s+a\b/i.test(includedRowsBasisText) &&
    !/\bexclud(?:e|es|ing|ed)\s+class\s+b\b/i.test(basisText) &&
    (/\bclass\s+b\b/i.test(basisText) ||
      /\bclass\s+a\s+(?:and|&|\+)\s+class\s+b\b/i.test(basisText) ||
      (!/\bclass\s+a\b/i.test(basisText) && /\b(?:ordinary|common)\s+shares?\b/i.test(basisText)))
  ) {
    warnings.push(
      "SEC 424B share_overhang counted rows appear Class A-specific, but basis appears to combine Class A with Class B or another broader share basis.",
    );
  }
  if (includedRowsBasisText && basisText && /\bADSs?\b|American Depositary Shares?/i.test(includedRowsBasisText) && /\bordinary shares?\b/i.test(basisText)) {
    warnings.push("SEC 424B share_overhang counted rows appear ADS-specific, but basis appears to use ordinary shares.");
  }
  const includedRows = shareOverhangRows.filter(isIncludedShareOverhangRow);
  const includedRowSum = includedRows.reduce((total, row) => total + (shareOverhangNumericValue(row) || 0), 0);
  const totalNote = readRecord(shareOverhang?.total_note || shareOverhang?.totalNote);
  const totalNoteNumerator = parseShareCount(stringValue(totalNote?.numerator || totalNote?.supply_value || totalNote?.supplyValue));
  const totalNoteDenominator = parseShareCount(stringValue(totalNote?.denominator || totalNote?.current_value || totalNote?.currentValue));
  const totalNoteRatio = parsePercentValue(stringValue(totalNote?.ratio || totalNote?.ratio_value || totalNote?.ratioValue || shareOverhang?.ratio_value || shareOverhang?.status_value));
  if (
    includedRowSum > 0 &&
    totalNoteNumerator &&
    Math.abs(includedRowSum - totalNoteNumerator) / Math.max(includedRowSum, totalNoteNumerator) > 0.02
  ) {
    warnings.push(
      "SEC 424B share_overhang counted row numeric_value sum does not reconcile to total_note.numerator; merge alternative pools or fix row_role before relying on the displayed ratio.",
    );
  }
  if (totalNoteNumerator && totalNoteDenominator && totalNoteRatio != null) {
    const expectedRatio = (totalNoteNumerator / totalNoteDenominator) * 100;
    if (Number.isFinite(expectedRatio) && Math.abs(expectedRatio - totalNoteRatio) / Math.max(Math.abs(expectedRatio), Math.abs(totalNoteRatio), 1) > 0.02) {
      warnings.push(
        "SEC 424B share_overhang total_note ratio does not reconcile to numerator divided by denominator; verify unit conversion and full share counts.",
      );
    }
  }
  if (hasDuplicateOrdinaryPrefundedCountedRows(includedRows)) {
    warnings.push(
      "SEC 424B share_overhang appears to count ordinary/unit supply and pre-funded replacement supply with the same numeric_value; use one ordinary-or-pre-funded current_offering_pool row or mark the replacement row row_role alternative.",
    );
  }
  return warnings;
}

function collect424bScoreConsistencyWarnings(
  analysisOutput: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  const warnings: string[] = [];
  if (stringValue(displayPayload.display_type) !== "offering_terms") return warnings;
  const score = numberValue(analysisOutput.score);
  if (score == null) return warnings;
  const data = readRecord(displayPayload.data);
  const shareOverhang = readRecord(data?.share_overhang);
  const scale = deriveShareOverhangScale(shareOverhang);
  const baseValue = scale?.base_numeric_value ?? 0;
  const includedValue = scale?.supply_numeric_value ?? 0;
  if (baseValue <= 0 || includedValue <= 0) return warnings;

  const includedPercent = (includedValue / baseValue) * 100;
  if (includedPercent >= 100 && score < 80) {
    warnings.push(
      `SEC 424B score ${score} appears below overhang guide: included share exposure is ${formatShareOverhangPercent(includedPercent)} of base shares.`,
    );
  } else if (includedPercent >= 20 && score < 75) {
    warnings.push(
      `SEC 424B score ${score} appears below alert threshold for ${formatShareOverhangPercent(includedPercent)} included share exposure vs base shares.`,
    );
  }
  const conflictingProseFields = collectConflictingShareOverhangPercentFields(analysisOutput, shareOverhang);
  if (conflictingProseFields.length) {
    warnings.push(
      `SEC 424B analysis prose contains dilution/overhang percentage(s) that conflict with share_overhang.total_note.ratio in: ${conflictingProseFields.join(", ")}.`,
    );
  }
  return warnings;
}

function collectConflictingShareOverhangPercentFields(
  analysisOutput: Record<string, unknown>,
  shareOverhang: Record<string, unknown> | null,
) {
  const expectedRatio = normalizedPercentToken(readShareOverhangRatio(shareOverhang));
  if (!expectedRatio || !hasNonCountedShareOverhangRows(shareOverhang)) return [];
  const fields: Array<[string, unknown]> = [
    ["event_title", analysisOutput.event_title],
    ["quick_take", analysisOutput.quick_take],
    ["summary", analysisOutput.summary],
    ["score_reason", analysisOutput.score_reason],
  ];
  const scoreExplanation = readRecord(analysisOutput.score_explanation);
  if (scoreExplanation) {
    fields.push(
      ["score_explanation.summary", scoreExplanation.summary],
      ["score_explanation.final_read", scoreExplanation.final_read],
    );
    for (const key of ["upward_factors", "limiting_factors"]) {
      for (const [index, value] of readStringArray(scoreExplanation[key]).entries()) {
        fields.push([`score_explanation.${key}[${index}]`, value]);
      }
    }
  }
  return fields
    .filter(([, value]) => hasConflictingPercent(value, expectedRatio))
    .map(([field]) => field);
}

function readShareOverhangRatio(shareOverhang: Record<string, unknown> | null) {
  const totalNote = readRecord(shareOverhang?.total_note);
  return stringValue(totalNote?.ratio) || stringValue(shareOverhang?.ratio_value) || stringValue(shareOverhang?.status_value);
}

function hasNonCountedShareOverhangRows(shareOverhang: Record<string, unknown> | null) {
  return arrayValue(shareOverhang?.rows)
    .map((row) => readRecord(row))
    .some((row) => {
      if (!row) return false;
      const rowRole = shareOverhangRowRole(row);
      return rowRole === "conditional" || rowRole === "alternative" || rowRole === "reference";
    });
}

function normalizedPercentToken(value: unknown) {
  const match = stringValue(value).match(/(\d[\d,]*(?:\.\d+)?)\s*%/);
  if (!match) return "";
  return Number(match[1].replace(/,/g, "")).toFixed(1);
}

function hasConflictingPercent(value: unknown, expectedRatio: string) {
  const text = stringValue(value);
  if (!text) return false;
  const matches = [...text.matchAll(/(?:over\s+|approximately\s+|approx\.?\s+|around\s+|about\s+)?\d[\d,]*(?:\.\d+)?\s*%/gi)];
  return matches.some((match) => normalizedPercentToken(match[0]) !== expectedRatio);
}

function validateKeyCashTermFacts(data: Record<string, unknown>) {
  const cashTerms = readRecord(data.key_cash_terms);
  const hasCashTermContent =
    cashTerms &&
    Object.values(cashTerms).some((value) => {
      const record = readRecord(value);
      return hasDisplayFactValue(record) || Boolean(stringValue(value));
    });
  if (!hasCashTermContent) return "";

  const searchableText = [
    data.investor_takeaway,
    data.narrative_summary,
    cashTerms?.explanation,
    ...arrayValue(data.offering_details).flatMap((row) => {
      const record = readRecord(row);
      return [record?.label, record?.value, record?.note];
    }),
    ...readStringArray(data.source_notes),
  ]
    .map((value) => stringValue(value))
    .join(" ");
  if (!/\b(cash|proceeds?|receive|received|resale|sepa|eloc|purchase agreement|warrant exercise|exercise cash)\b/i.test(searchableText)) {
    return "";
  }

  const cashFactKeys = [
    "resale_proceeds_to_company",
    "issuer_primary_or_closing_cash",
    "conditional_warrant_cash",
    "prefunded_warrant_exercise_cash",
    "common_warrant_cash_exercise_proceeds",
    "private_placement_proceeds",
    "sec_registration_value",
  ];
  const hasAnyFact = cashFactKeys.some((key) => hasDisplayFactValue(readRecord(cashTerms?.[key])));
  return hasAnyFact
    ? ""
    : "key_cash_terms contains cash/proceeds context but no populated fact field";
}

function append424bDisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const data = readRecord(displayPayload.data);
  if (!data) return;
  const existing = readStringArray(data.display_warnings);
  data.display_warnings = uniqueStrings([...existing, ...warnings]);
}

function normalize424bDisplayPayload(displayPayload: Record<string, unknown>) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return displayPayload;
  const data = readRecord(displayPayload.data);
  if (!data) return displayPayload;
  const normalizedData = normalize424bOfferingDisplayModel(data);
  if (!normalizedData) return displayPayload;
  return {
    ...displayPayload,
    data: normalizedData,
  };
}

function adapt424bRoomResultForAnalysis(value: unknown, displayPayloadWarnings: string[] = []): Sec424bAnalysisAdapterResult {
  const adapted = adaptSecFormRoomOutputForIngest(value);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC 424B Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value, displayPayloadWarnings),
  };
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput, displayPayloadWarnings: string[] = []) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const scoreExplanation = normalizeScoreExplanation(readRecord(value.analysis_output.score_explanation));
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);
  const displayPayload = readRecord(value.metadata.display_payload);
  const normalizedDisplayPayload = displayPayload ? normalize424bDisplayPayload(displayPayload) : null;
  const offeringDisplayModel =
    stringValue(normalizedDisplayPayload?.display_type) === "offering_terms"
      ? readRecord(normalizedDisplayPayload?.data)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    score_explanation: scoreExplanation,
    archive_summary: archiveSummary,
    display_payload: normalizedDisplayPayload ?? value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_424b_display_warnings: uniqueStrings(displayPayloadWarnings),
    sec_424b_analysis_mode: "analysis_only",
  };
}

function normalizeScoreExplanation(value: Record<string, unknown> | null) {
  if (!value) return null;
  const summary = nullableString(value.summary) || nullableString(value.rationale);
  const baseBand = nullableString(value.base_band) || nullableString(value.baseBand);
  const upwardFactors = uniqueStrings([
    ...readStringArray(value.upward_factors),
    ...readStringArray(value.upwardFactors),
  ]).slice(0, 3);
  const limitingFactors = uniqueStrings([
    ...readStringArray(value.limiting_factors),
    ...readStringArray(value.limitingFactors),
  ]).slice(0, 3);
  const finalRead = nullableString(value.final_read) || nullableString(value.finalRead);

  if (!summary && !baseBand && !upwardFactors.length && !limitingFactors.length && !finalRead) return null;
  return {
    summary,
    base_band: baseBand,
    upward_factors: upwardFactors,
    limiting_factors: limitingFactors,
    final_read: finalRead,
  };
}

export function normalize424bOfferingDisplayModel(data: Record<string, unknown> | null) {
  if (!data) return null;
  const cleanData = { ...data };
  delete cleanData.supply_segments;
  delete cleanData.mixed_offering_components;
  const instrumentDetails = normalizeInstrumentDetails(data.instrument_details);
  const shareOverhang = normalizeShareOverhang(readRecord(data.share_overhang), instrumentDetails);
  const shareOverhangScale = deriveShareOverhangScale(readRecord(shareOverhang));
  return {
    ...cleanData,
    display_mode: stringValue(data.display_mode) || "offering_terms",
    risk_label: stringValue(data.risk_label) || "needs_review",
    current_shares: normalizeDisplayFact(readRecord(data.current_shares), "shares"),
    total_potential_supply: normalizeDisplayFact(readRecord(data.total_potential_supply), "shares"),
    ads_equivalence: normalizeAdsEquivalence(readRecord(data.ads_equivalence)),
    snapshot_metrics: normalizeSnapshotMetrics(data.snapshot_metrics, shareOverhangScale),
    key_cash_terms: normalizeKeyCashTerms(readRecord(data.key_cash_terms)),
    registered_security_totals: normalizeRegisteredSecurityTotals(readRecord(data.registered_security_totals)),
    ...(shareOverhang ? { share_overhang: shareOverhang } : {}),
    investor_takeaway: stringValue(data.investor_takeaway),
    offering_details: normalizeOfferingDetails(data.offering_details),
    amendment_changes: normalizeOfferingDetails(data.amendment_changes),
    instrument_details: instrumentDetails,
    narrative_summary: stringValue(data.narrative_summary),
    watch_items: readStringArray(data.watch_items),
    source_notes: readStringArray(data.source_notes),
    review_reasons: readStringArray(data.review_reasons),
    needs_human_review: data.needs_human_review === true,
  };
}

function normalizeShareOverhang(value: Record<string, unknown> | null, instrumentDetails: Array<{ label: string; value: string }> = []) {
  if (!value) return null;
  const basisRecord = readRecord(value.basis);
  const basis = basisRecord
    ? {
        key: nullableString(basisRecord.key),
        label: stringValue(basisRecord.label),
        value: stringValue(basisRecord.value) || stringValue(basisRecord.value_text),
        numeric_value:
          numberValue(basisRecord.numeric_value) ??
          numberValue(basisRecord.numericValue) ??
          numberValue(basisRecord.amount) ??
          null,
        unit: nullableString(basisRecord.unit),
        class_basis: nullableString(basisRecord.class_basis || basisRecord.classBasis),
        note: nullableString(basisRecord.note),
      }
    : null;
  const rows = arrayValue(value.rows)
    .map((row) => normalizeShareOverhangRow(readRecord(row), false))
    .filter(Boolean);
  const hasStructuredRows = Boolean(basis) || rows.length > 0;
  const unavailableRows = arrayValue(hasStructuredRows ? value.unavailable_rows || value.detail_rows : value.unavailable_rows || value.detail_rows || value.rows)
    .map((row) => {
      const record = readRecord(row);
      const label = stringValue(record?.label);
      const rowValue = stringValue(record?.value) || stringValue(record?.value_text);
      if (!label || !rowValue) return null;
      return {
        label,
        value: rowValue,
        note: nullableString(record?.note),
        tone: nullableString(record?.tone),
      };
    })
    .filter(Boolean);
  const instrumentContexts = readInstrumentDetailContexts(instrumentDetails);
  const segments = normalizeShareOverhangReplacementSegments(arrayValue(value.segments || value.bar_segments || value.barSegments)
    .map((segment) => {
      const record = readRecord(segment);
      const label = stringValue(record?.label);
      const segmentValue = stringValue(record?.value) || stringValue(record?.value_text);
      if (!label || !segmentValue) return null;
      const normalizedSegment = {
        key: nullableString(record?.key),
        class_name: nullableString(record?.class_name || record?.className),
        row_role: nullableString(record?.row_role || record?.rowRole),
        counted_in_ratio: booleanValue(record?.counted_in_ratio ?? record?.countedInRatio),
        supply_type: nullableString(record?.supply_type || record?.supplyType),
        supply_nature: nullableString(record?.supply_nature || record?.supplyNature),
        calculation_role: nullableString(record?.calculation_role || record?.calculationRole),
        unit: nullableString(record?.unit),
        class_basis: nullableString(record?.class_basis || record?.classBasis),
        pool_id: nullableString(record?.pool_id || record?.poolId),
        pool_relationship: nullableString(record?.pool_relationship || record?.poolRelationship),
        label,
        value: segmentValue,
        numeric_value: numberValue(record?.numeric_value) ?? numberValue(record?.numericValue) ?? numberValue(record?.amount) ?? null,
        note: nullableString(record?.note),
      };
      return normalizeShareOverhangSegmentSupplyNature(
        reconcileShareOverhangSegmentWithInstrumentDetails(normalizedSegment, instrumentDetails),
        instrumentContexts,
      );
    })
    .filter(
      (
        segment,
      ): segment is {
        key: string | null;
        class_name: string | null;
        row_role: string | null;
        counted_in_ratio: boolean | null;
        supply_type: string | null;
        supply_nature: string | null;
        calculation_role: string | null;
        unit: string | null;
        class_basis: string | null;
        pool_id: string | null;
        pool_relationship: string | null;
        label: string;
        value: string;
        numeric_value: number | null;
        note: string | null;
      } => Boolean(segment),
    ));
  const conditionalSupply = arrayValue(value.conditional_supply || value.conditionalSupply)
    .map((row) => normalizeShareOverhangRow(readRecord(row), true))
    .filter(Boolean);
  const totalNote = readRecord(value.total_note || value.totalNote);
  const normalizedTotalNote = normalizeShareOverhangTotalNote(totalNote);
  const scale = deriveShareOverhangScale({ basis, rows, segments });
  const scaledTotalNote =
    normalizedTotalNote && scale
      ? {
          ...normalizedTotalNote,
          numerator: scale.supply_full_value,
          denominator: scale.current_full_value,
          ratio: scale.ratio_value,
        }
      : normalizedTotalNote;
  const normalized = {
    chart_title: stringValue(value.chart_title || value.chartTitle || value.title),
    subtitle: stringValue(value.subtitle || value.chart_subtitle),
    status_label: stringValue(value.status_label || value.statusLabel || value.level_label || value.levelLabel),
    status_value: scale?.ratio_value || stringValue(value.status_value || value.statusValue || value.value),
    caption: stringValue(value.caption || value.score_caption || value.scoreCaption),
    ratio_label: stringValue(value.ratio_label || value.ratioLabel || value.scale_label || value.scaleLabel),
    ratio_value: scale?.ratio_value || stringValue(value.ratio_value || value.ratioValue || value.percent_value || value.percentValue),
    current_label: stringValue(value.current_label || value.currentLabel),
    current_value: scale?.current_value || stringValue(value.current_value || value.currentValue),
    supply_label: stringValue(value.supply_label || value.supplyLabel || value.potential_supply_label || value.potentialSupplyLabel),
    supply_value: scale?.supply_value || stringValue(value.supply_value || value.supplyValue || value.potential_supply_value || value.potentialSupplyValue),
    basis,
    rows,
    total_note: scaledTotalNote,
    note: scale?.has_conditional_supply
      ? "Headline ratio excludes conditional future supply shown separately."
      : nullableString(value.note || value.footnote),
    unavailable_rows: unavailableRows,
    segments,
    conditional_supply: conditionalSupply,
  };

  const hasContent =
    [
      normalized.status_label,
      normalized.status_value,
      normalized.ratio_label,
      normalized.ratio_value,
      normalized.current_value,
      normalized.supply_value,
      normalized.basis?.value,
    ].some(Boolean) ||
    rows.length > 0 ||
    unavailableRows.length > 0 ||
    conditionalSupply.length > 0 ||
    Boolean(scaledTotalNote && Object.values(scaledTotalNote).some(Boolean)) ||
    segments.length > 0;
  return hasContent ? normalized : null;
}

function reconcileShareOverhangSegmentWithInstrumentDetails<
  T extends { label: string; value: string; numeric_value: number | null },
>(segment: T, instrumentDetails: Array<{ label: string; value: string }>): T {
  const segmentKey = instrumentMatchKey(segment.label);
  if (!segmentKey) return segment;
  const instrumentShares = readInstrumentDetailShareCounts(instrumentDetails).get(segmentKey);
  if (!instrumentShares || instrumentShares <= 0) return segment;
  const currentValue = segment.numeric_value || parseShareCount(segment.value) || 0;
  if (currentValue > 0 && Math.abs(currentValue - instrumentShares) / instrumentShares <= 0.01) return segment;
  return {
    ...segment,
    value: formatWholeShareCount(instrumentShares),
    numeric_value: instrumentShares,
  };
}

function readInstrumentDetailShareCounts(instrumentDetails: Array<{ label: string; value: string }>) {
  const counts = new Map<string, number>();
  let currentKey = "";
  for (const row of instrumentDetails) {
    const label = stringValue(row.label).toLowerCase();
    if (label === "type") {
      currentKey = instrumentMatchKey(row.value);
      continue;
    }
    if (label === "shares / securities" && currentKey) {
      const count = parseShareCount(row.value);
      if (count && count > 0) counts.set(currentKey, count);
    }
  }
  return counts;
}

function readInstrumentDetailContexts(instrumentDetails: Array<{ label: string; value: string }>) {
  const contexts = new Map<string, string>();
  let currentKey = "";
  for (const row of instrumentDetails) {
    const label = stringValue(row.label).toLowerCase();
    if (label === "type") {
      currentKey = instrumentMatchKey(row.value);
      if (currentKey) contexts.set(currentKey, `${row.value}`);
      continue;
    }
    if (currentKey) {
      contexts.set(currentKey, `${contexts.get(currentKey) || ""} ${row.label} ${row.value}`.trim());
    }
  }
  return contexts;
}

function instrumentMatchKey(value: string) {
  const text = value.toLowerCase();
  if (/\bseries\s+a\b/.test(text) && /\bwarrants?\b/.test(text)) return "series_a_warrant";
  if (/\bseries\s+b\b/.test(text) && /\bwarrants?\b/.test(text)) return "series_b_warrant";
  if (/\bseries\s+c\b/.test(text) && /\bwarrants?\b/.test(text)) return "series_c_warrant";
  if (/\bpre[-\s]?funded\b/.test(text) && /\bwarrants?\b/.test(text)) return "prefunded_warrant";
  if (/\bplacement\s+agent\b/.test(text) && /\bwarrants?\b/.test(text)) return "placement_agent_warrant";
  if (/\bcommon\b/.test(text) && /\bwarrants?\b/.test(text)) return "common_warrant";
  return "";
}

function isIncludedShareOverhangRow(row: Record<string, unknown>) {
  const rowRole = shareOverhangRowRole(row);
  if (rowRole) return rowRole === "counted";
  const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
  if (typeof countedInRatio === "boolean") return countedInRatio;
  const calculationRole = stringValue(row.calculation_role || row.calculationRole);
  const supplyNature = stringValue(row.supply_nature || row.supplyNature);
  return (
    calculationRole === "headline_numerator" &&
    ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(supplyNature)
  );
}

function shareOverhangRowRole(row: Record<string, unknown> | null) {
  const normalized = stringValue(row?.row_role || row?.rowRole).toLowerCase().replace(/[\s-]+/g, "_");
  if (["counted", "conditional", "alternative", "reference"].includes(normalized)) return normalized;
  return "";
}

function hasUsableShareOverhangBasis(record: Record<string, unknown> | null) {
  return Boolean(record && hasUsableShareOverhangAmount(record));
}

function hasUsableShareOverhangAmount(record: Record<string, unknown>) {
  const numericValue =
    numberValue(record.numeric_value) ??
    numberValue(record.numericValue) ??
    numberValue(record.amount);
  if (typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0) return true;

  const valueText = [
    stringValue(record.value),
    stringValue(record.value_text),
    stringValue(record.valueText),
  ]
    .filter(Boolean)
    .join(" ");
  if (!/\b(?:shares?|ADSs?|American Depositary Shares?|ordinary shares?|common stock)\b/i.test(valueText)) {
    return false;
  }
  return (parseShareCount(valueText) || 0) > 0;
}

function shareOverhangNumericValue(record: Record<string, unknown>) {
  return (
    numberValue(record.numeric_value) ??
    numberValue(record.numericValue) ??
    numberValue(record.amount) ??
    numberValue(record.share_count) ??
    numberValue(record.shareCount) ??
    parseShareCount([stringValue(record.value), stringValue(record.value_text), stringValue(record.valueText)].filter(Boolean).join(" "))
  );
}

function hasDuplicateOrdinaryPrefundedCountedRows(rows: Record<string, unknown>[]) {
  const ordinaryRows = rows.filter((row) => {
    const text = shareBasisText(row);
    return /\b(?:ordinary|common|class\s+a|ADSs?|units?)\b/i.test(text) && !/\bpre[-\s]?funded\b/i.test(text);
  });
  const prefundedRows = rows.filter((row) => /\bpre[-\s]?funded\b/i.test(shareBasisText(row)));
  return ordinaryRows.some((ordinaryRow) => {
    const ordinaryValue = shareOverhangNumericValue(ordinaryRow);
    if (!ordinaryValue) return false;
    return prefundedRows.some((prefundedRow) => {
      const prefundedValue = shareOverhangNumericValue(prefundedRow);
      return Boolean(prefundedValue && Math.abs(ordinaryValue - prefundedValue) / Math.max(ordinaryValue, prefundedValue) <= 0.01);
    });
  });
}

function parseShareCount(value: string) {
  const match = value.match(/(\d[\d,]*(?:\.\d+)?)\s*(million|m|thousand|k)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "million" || suffix === "m") return Math.round(base * 1_000_000);
  if (suffix === "thousand" || suffix === "k") return Math.round(base * 1_000);
  return Math.round(base);
}

function parsePercentValue(value: string) {
  const match = value.match(/(-?\d[\d,]*(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatWholeShareCount(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} shares`;
}

function normalizeShareOverhangSegmentSupplyNature<T extends { label: string; value: string; note: string | null; supply_nature: string | null }>(
  segment: T,
  instrumentContexts: Map<string, string> = new Map(),
): T {
  const supplyNature = stringValue(segment.supply_nature);
  const instrumentContext = instrumentContexts.get(instrumentMatchKey(segment.label)) || "";
  const text = `${segment.label} ${segment.value} ${segment.note || ""} ${instrumentContext}`.toLowerCase();
  const hasZeroOrNominal =
    /\bzero[-\s]+exercise\b/.test(text) ||
    /\bzero\s+exercise\s+price\b/.test(text) ||
    /\bnominal\b/.test(text) ||
    /\bde\s+minimis\b/.test(text) ||
    /\$0\.0{2,}\d+/.test(text);
  const hasPreFunded = /\bpre[-\s]?funded\b/.test(text);
  const hasReplacementContext = /\b(?:alternative|replacement|in\s+lieu|instead\s+of|one[-\s]?for[-\s]?one)\b/.test(text);
  const hasConditionalPricing = /\b(?:reset|floor|vwap|discount|exercise\s+price|conversion\s+price)\b/.test(text);

  if (supplyNature === "common_equivalent_supply" && hasPreFunded && hasReplacementContext) {
    return { ...segment, supply_nature: "replacement_supply" };
  }
  if (supplyNature === "conditional_future_supply" && (hasZeroOrNominal || (hasPreFunded && !hasReplacementContext))) {
    return { ...segment, supply_nature: "common_equivalent_supply" };
  }
  if (supplyNature === "common_equivalent_supply" && hasConditionalPricing && !hasZeroOrNominal && !hasPreFunded) {
    return { ...segment, supply_nature: "conditional_future_supply" };
  }
  return segment;
}

function normalizeShareOverhangReplacementSegments<
  T extends { label: string; value: string; note: string | null; supply_nature: string | null; numeric_value: number | null },
>(segments: T[]) {
  const currentOfferingValues = segments
    .filter((segment) => stringValue(segment.supply_nature) === "current_offering_supply")
    .map((segment) => segment.numeric_value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  if (!currentOfferingValues.length) return segments;

  return segments.map((segment) => {
    const supplyNature = stringValue(segment.supply_nature);
    const text = `${segment.label} ${segment.value} ${segment.note || ""}`.toLowerCase();
    const isPreFunded = /\bpre[-\s]?funded\b/.test(text);
    const value = segment.numeric_value;
    const duplicatesCurrentOffering =
      typeof value === "number" &&
      Number.isFinite(value) &&
      currentOfferingValues.some((currentValue) => Math.abs(currentValue - value) / Math.max(currentValue, value) <= 0.01);

    if (supplyNature === "common_equivalent_supply" && isPreFunded && duplicatesCurrentOffering) {
      return { ...segment, supply_nature: "replacement_supply" };
    }
    return segment;
  });
}

function deriveShareOverhangScale(shareOverhang: Record<string, unknown> | null) {
  const basis = readRecord(shareOverhang?.basis);
  const rows = arrayValue(shareOverhang?.rows)
    .map((item) => readRecord(item))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => ({
      countedInRatio: booleanValue(record.counted_in_ratio ?? record.countedInRatio),
      rowRole: stringValue(record.row_role || record.rowRole),
      supplyType: stringValue(record.supply_type || record.supplyType),
      calculationRole: stringValue(record.calculation_role || record.calculationRole),
      supplyNature: stringValue(record.supply_nature || record.supplyNature),
      className: stringValue(record.class_name || record.className),
      unit: stringValue(record.unit),
      classBasis: stringValue(record.class_basis || record.classBasis),
      value: stringValue(record.value || record.value_text),
      numericValue: numberValue(record.numeric_value) ?? numberValue(record.numericValue) ?? numberValue(record.amount) ?? 0,
    }))
    .filter((row) => row.numericValue > 0);
  const basisValue = numberValue(basis?.numeric_value) ?? numberValue(basis?.numericValue) ?? numberValue(basis?.amount) ?? 0;
  if (basisValue > 0 && rows.length > 0) {
    const supplyValue = rows
      .filter((row) => {
        if (row.rowRole) return row.rowRole === "counted";
        if (typeof row.countedInRatio === "boolean") return row.countedInRatio;
        return (
          row.calculationRole === "headline_numerator" &&
          ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(row.supplyNature)
        );
      })
      .reduce((total, row) => total + row.numericValue, 0);
    if (supplyValue > 0) {
      const unit = detectShareOverhangUnit([stringValue(basis?.value || basis?.value_text), ...rows.map((row) => row.value)].join(" "));
      return {
        current_value: formatShareOverhangCount(basisValue, unit),
        supply_value: formatShareOverhangCount(supplyValue, unit),
        current_full_value: formatShareOverhangFullCount(basisValue, unit),
        supply_full_value: formatShareOverhangFullCount(supplyValue, unit),
        ratio_value: formatShareOverhangPercent((supplyValue / basisValue) * 100),
        has_conditional_supply: rows.some(
          (row) =>
            row.rowRole === "conditional" ||
            row.rowRole === "alternative" ||
            (row.countedInRatio === false && row.supplyType !== "shelf_capacity") ||
            row.supplyType === "future_exercise" ||
            ["conditional_future_supply", "replacement_supply"].includes(row.supplyNature),
        ),
        base_numeric_value: basisValue,
        supply_numeric_value: supplyValue,
      };
    }
  }

  const segments = arrayValue(shareOverhang?.segments)
    .map((item) => readRecord(item))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => ({
      countedInRatio: booleanValue(record.counted_in_ratio ?? record.countedInRatio),
      rowRole: stringValue(record.row_role || record.rowRole),
      supplyType: stringValue(record.supply_type || record.supplyType),
      supplyNature: stringValue(record.supply_nature || record.supplyNature),
      className: stringValue(record.class_name || record.className),
      unit: stringValue(record.unit),
      classBasis: stringValue(record.class_basis || record.classBasis),
      value: stringValue(record.value || record.value_text),
      numericValue: numberValue(record.numeric_value) ?? numberValue(record.numericValue) ?? numberValue(record.amount) ?? 0,
    }))
    .filter((segment) => segment.numericValue > 0);
  if (!segments.length) return null;

  const baseValue = segments
    .filter((segment) => segment.supplyNature === "base_shares" || segment.className === "base-shares" || segment.className === "current-base")
    .reduce((total, segment) => total + segment.numericValue, 0);
  const supplyValue = segments
    .filter((segment) => {
      if (segment.rowRole) return segment.rowRole === "counted";
      if (typeof segment.countedInRatio === "boolean") return segment.countedInRatio;
      return ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(segment.supplyNature);
    })
    .reduce((total, segment) => total + segment.numericValue, 0);
  if (baseValue <= 0 || supplyValue <= 0) return null;

  const unit = detectShareOverhangUnit(segments.map((segment) => segment.value).join(" "));
  return {
    current_value: formatShareOverhangCount(baseValue, unit),
    supply_value: formatShareOverhangCount(supplyValue, unit),
    current_full_value: formatShareOverhangFullCount(baseValue, unit),
    supply_full_value: formatShareOverhangFullCount(supplyValue, unit),
    ratio_value: formatShareOverhangPercent((supplyValue / baseValue) * 100),
    has_conditional_supply: segments.some(
      (segment) =>
        segment.rowRole === "conditional" ||
        segment.rowRole === "alternative" ||
        (segment.countedInRatio === false && segment.supplyType !== "shelf_capacity") ||
        segment.supplyType === "future_exercise" ||
        ["conditional_future_supply", "replacement_supply"].includes(segment.supplyNature),
    ),
    base_numeric_value: baseValue,
    supply_numeric_value: supplyValue,
  };
}

function detectShareOverhangUnit(text: string) {
  if (/\bADSs?\b/i.test(text)) return "ADSs";
  if (/\bunits?\b/i.test(text)) return "units";
  return "shares";
}

function formatShareOverhangCount(value: number, unit: string) {
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `${formatter.format(value / 1_000_000)}M ${unit}`;
  if (abs >= 1_000) return `${formatter.format(value / 1_000)}K ${unit}`;
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

function formatShareOverhangFullCount(value: number, unit: string) {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

function formatShareOverhangPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function normalizeShareOverhangRow(record: Record<string, unknown> | null, includeTone: boolean) {
  const label = stringValue(record?.label);
  const rowValue = stringValue(record?.value) || stringValue(record?.value_text);
  if (!label || !rowValue) return null;
  return {
    key: nullableString(record?.key),
    class_name: nullableString(record?.class_name || record?.className),
    row_role: nullableString(record?.row_role || record?.rowRole),
    counted_in_ratio: booleanValue(record?.counted_in_ratio ?? record?.countedInRatio),
    supply_type: nullableString(record?.supply_type || record?.supplyType),
    supply_nature: nullableString(record?.supply_nature || record?.supplyNature),
    calculation_role: nullableString(record?.calculation_role || record?.calculationRole),
    unit: nullableString(record?.unit),
    class_basis: nullableString(record?.class_basis || record?.classBasis),
    pool_id: nullableString(record?.pool_id || record?.poolId),
    pool_relationship: nullableString(record?.pool_relationship || record?.poolRelationship),
    label,
    value: rowValue,
    numeric_value: numberValue(record?.numeric_value) ?? numberValue(record?.numericValue) ?? numberValue(record?.amount) ?? null,
    note: nullableString(record?.note),
    ...(includeTone ? { tone: nullableString(record?.tone) } : {}),
  };
}

function normalizeShareOverhangTotalNote(record: Record<string, unknown> | null) {
  if (!record) return null;
  const rawTitle = stringValue(record.title || record.label);
  const splitTitle = splitShareOverhangTotalNoteTitle(rawTitle);
  return {
    title: splitTitle?.title || rawTitle,
    numerator: stringValue(record.numerator || record.supply_value || record.supplyValue) || splitTitle?.numerator || "",
    denominator: stringValue(record.denominator || record.current_value || record.currentValue) || splitTitle?.denominator || "",
    ratio: stringValue(record.ratio || record.ratio_value || record.ratioValue) || splitTitle?.ratio || "",
    suffix: stringValue(record.suffix || record.note) || splitTitle?.suffix || "",
  };
}

function splitShareOverhangTotalNoteTitle(value: string) {
  const text = stringValue(value).replace(/\s+/g, " ");
  if (!text || !text.includes("/") || !text.includes("=")) return null;
  const formulaPattern = "((?:Up to\\s+)?[~$]?\\d[\\d,.]*(?:\\s*[MBK])?(?:\\s+[^/=]+?)?)\\s*/\\s*([^=]+?)\\s*=\\s*([\\d,.]+\\s*%)(?:\\s+(.+))?$";
  const titledMatch = text.match(new RegExp(`^(.+?):\\s*${formulaPattern}`, "i"));
  const directMatch = titledMatch ? null : text.match(new RegExp(`^${formulaPattern}`, "i"));
  const match = titledMatch || directMatch;
  if (!match) return null;
  const titlePart = titledMatch ? match[1] : "";
  const numerator = titledMatch ? match[2] : match[1];
  const denominator = titledMatch ? match[3] : match[2];
  const ratio = titledMatch ? match[4] : match[3];
  const suffixText = titledMatch ? match[5] : match[4];
  const condition = titlePart.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
  const title = stringValue(titlePart.replace(/\s*\([^)]*\)/g, "")) || "Total Potential Supply";
  return {
    title,
    numerator: stringValue(numerator),
    denominator: stringValue(denominator),
    ratio: stringValue(ratio),
    suffix: stringValue(suffixText) || condition,
  };
}

function hasShareOverhangContent(value: Record<string, unknown> | null) {
  if (!value) return false;
  if (readRecord(value.basis) || arrayValue(value.rows).length) return true;
  if (arrayValue(value.segments).length) return true;
  if (arrayValue(value.conditional_supply || value.conditionalSupply).length) return true;
  const totalNote = readRecord(value.total_note || value.totalNote);
  if (totalNote && Object.keys(totalNote).length > 0) return true;
  return [
    value.status_value,
    value.statusValue,
    value.ratio_value,
    value.ratioValue,
    value.current_value,
    value.currentValue,
    value.supply_value,
    value.supplyValue,
  ].some((item) => Boolean(stringValue(item)));
}

function normalizeSnapshotMetrics(value: unknown, shareOverhangScale: ReturnType<typeof deriveShareOverhangScale> = null) {
  return arrayValue(value)
    .map((row) => {
      const record = readRecord(row);
      const label = stringValue(record?.label);
      const metricValue = stringValue(record?.value);
      if (!label || !metricValue) return null;
      const tone = stringValue(record?.tone);
      const shouldUseShareOverhangRatio =
        shareOverhangScale && /\b(?:dilution|overhang|supply\s+ratio|supply\s+vs)/i.test(label) && /%/.test(metricValue);
      return {
        label,
        value: shouldUseShareOverhangRatio ? shareOverhangScale.ratio_value : metricValue,
        note:
          shouldUseShareOverhangRatio && shareOverhangScale.has_conditional_supply
            ? "Excludes conditional future supply"
            : nullableString(record?.note),
        tone: ["danger", "neutral", "positive"].includes(tone) ? tone : "neutral",
        emphasis: record?.emphasis === true,
      };
    })
    .filter(Boolean);
}

function normalizeKeyCashTerms(value: Record<string, unknown> | null) {
  return {
    issuer_primary_or_closing_cash: normalizeDisplayFact(
      readRecord(value?.issuer_primary_or_closing_cash),
      "usd",
    ),
    resale_proceeds_to_company: normalizeDisplayFact(
      readRecord(value?.resale_proceeds_to_company),
      "usd",
    ),
    prefunded_warrant_exercise_cash: normalizeDisplayFact(
      readRecord(value?.prefunded_warrant_exercise_cash),
      "usd",
    ),
    conditional_warrant_cash: normalizeDisplayFact(
      readRecord(value?.conditional_warrant_cash),
      "usd",
    ),
    common_warrant_cash_exercise_proceeds: normalizeDisplayFact(
      readRecord(value?.common_warrant_cash_exercise_proceeds),
      "usd",
    ),
    private_placement_proceeds: normalizeDisplayFact(
      readRecord(value?.private_placement_proceeds),
      "usd",
    ),
    sec_registration_value: normalizeDisplayFact(
      readRecord(value?.sec_registration_value),
      "usd",
    ),
    explanation: stringValue(value?.explanation),
  };
}

function normalizeRegisteredSecurityTotals(value: Record<string, unknown> | null) {
  return {
    primary_common_shares: normalizeDisplayFact(readRecord(value?.primary_common_shares), "shares"),
    resale_common_shares: normalizeDisplayFact(readRecord(value?.resale_common_shares), "shares"),
    warrant_underlying_shares: normalizeDisplayFact(readRecord(value?.warrant_underlying_shares), "shares"),
    warrants_offered: normalizeDisplayFact(readRecord(value?.warrants_offered), "warrants"),
    current_shares_outstanding: normalizeDisplayFact(readRecord(value?.current_shares_outstanding), "shares"),
    shares_outstanding_after_warrant_exercise: normalizeDisplayFact(
      readRecord(value?.shares_outstanding_after_warrant_exercise),
      "shares",
    ),
    total_distinct_share_exposure: normalizeDisplayFact(readRecord(value?.total_distinct_share_exposure), "shares"),
    total_registered_line_item_shares: normalizeDisplayFact(readRecord(value?.total_registered_line_item_shares), "shares"),
    ads_offered: normalizeDisplayFact(readRecord(value?.ads_offered), "ads"),
    ordinary_shares_represented: normalizeDisplayFact(readRecord(value?.ordinary_shares_represented), "shares"),
    ordinary_shares_per_ads: normalizeDisplayFact(readRecord(value?.ordinary_shares_per_ads), "shares_per_ads"),
    warrant_exercise_price: normalizeDisplayFact(readRecord(value?.warrant_exercise_price), "usd_per_share"),
    public_warrant_market_price: normalizeDisplayFact(readRecord(value?.public_warrant_market_price), "usd_per_warrant"),
    calculation_basis: nullableString(value?.calculation_basis),
    overlap_notes: readStringArray(value?.overlap_notes),
  };
}

function normalizeAdsEquivalence(value: Record<string, unknown> | null) {
  return {
    ads_offered: normalizeDisplayFact(readRecord(value?.ads_offered), "ads"),
    ordinary_shares_represented: normalizeDisplayFact(readRecord(value?.ordinary_shares_represented), "shares"),
    ordinary_shares_per_ads: normalizeDisplayFact(readRecord(value?.ordinary_shares_per_ads), "shares_per_ads"),
    calculation_basis: nullableString(value?.calculation_basis),
  };
}

function normalizeOfferingDetails(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const record = readRecord(item);
          if (!record) return null;
          const label = stringValue(record.label);
          const detailValue = normalizeOfferingDetailValue(label, stringValue(record.value));
          const note = stringValue(record.note);
          return label && detailValue ? { label, value: detailValue, ...(note ? { note } : {}) } : null;
        })
        .filter(Boolean)
    : [];
}

function normalizeOfferingDetailValue(label: string, value: string) {
  if (!/^use\s+of\s+proceeds$/i.test(label) || !/\+\s*others\b/i.test(value)) return value;
  const [beforeOthers] = value.split(/\+\s*others\b/i);
  const purposes = beforeOthers
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (purposes.length <= 2) return value;
  return `${purposes.slice(0, 2).join(", ")} + others`;
}

function normalizeInstrumentDetails(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const record = readRecord(item);
          if (!record) return null;
          const label = stringValue(record.label);
          const detailValue = stringValue(record.value);
          const note = stringValue(record.note);
          return label && detailValue ? { label, value: detailValue, ...(note ? { note } : {}) } : null;
        })
        .filter((row): row is { label: string; value: string } => Boolean(row))
    : [];
}

function normalizeDisplayFact(value: Record<string, unknown> | null, fallbackUnit: string) {
  return {
    value_text: nullableString(value?.value_text),
    numeric_value: numberValue(value?.numeric_value) ?? 0,
    unit: stringValue(value?.unit) || fallbackUnit,
    evidence: nullableString(value?.evidence),
  };
}

function normalize424bAnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  return {
    ...value,
    source_group: stringValue(value.source_group) || "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: [],
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    why_it_matters: stringValue(value.why_it_matters),
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function align424bAnalysisOutputToDisplayPayload(
  analysis: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return analysis;
  return {
    ...analysis,
    why_it_matters: "",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [],
    what_to_watch_next: [],
    related_tickers: [],
    calendar_items: [],
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  const rows = Array.isArray(value) ? value : [];
  const normalized: Array<Record<string, unknown>> = [];
  for (const item of rows) {
    const record = readRecord(item);
    const ticker = stringValue(record?.ticker) || stringValue(item);
    if (!ticker) continue;
    normalized.push({
      ticker,
      exchange: stringValue(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      role: stringValue(record?.role) || role,
      reason: stringValue(record?.reason) || null,
    });
  }

  if (role === "primary" && primaryTicker.ticker && !normalized.some((item) => item.ticker === primaryTicker.ticker)) {
    normalized.unshift({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: "Primary SEC filing ticker",
    });
  }

  return normalized;
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const ticker = nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker) || nullableString(record?.ticker);
  const exchange = nullableString(packagePrimary?.exchange) || nullableString(record?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function read424bParserOutput(input: SecFilingAnalysisInput): Sec424bParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.["424b"]) as Sec424bParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function hasDisplayFactValue(value: Record<string, unknown> | null) {
  return Boolean(stringValue(value?.value_text) || (numberValue(value?.numeric_value) || 0) > 0);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function shareBasisText(record: Record<string, unknown> | null) {
  if (!record) return "";
  return [record.class_basis, record.classBasis, record.label, record.value, record.value_text, record.note]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
}

// Required-output schema for 424B and S3/F3 main offering flows.
// Shared offering sub-schemas live in secOfferingOutputSchemas so S1/F1 can reuse
// common UI blocks while keeping its IPO/listing-specific output schema separate.
export const sec424bRequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["display_payload", "analysis_output"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data", "evidence", "notes"],
      properties: {
        display_type: {
          type: "string",
          enum: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        display_version: { type: "string", maxLength: 60 },
        data: {
          type: "object",
          additionalProperties: true,
          required: [
            "display_mode",
            "snapshot_metrics",
            "share_overhang",
            "instrument_details",
            "investor_takeaway",
            "needs_human_review",
          ],
          properties: {
            display_mode: { type: ["string", "null"], maxLength: 40 },
            risk_label: { type: ["string", "null"], maxLength: 40 },
            snapshot_metrics: {
              type: "array",
              maxItems: 4,
              items: offeringDisplayRowSchema(40, 80, 80),
            },
            share_overhang: shareOverhangSchema({ includeLegacyConditionalSupply: true }),
            investor_takeaway: { type: "string", maxLength: 180 },
            narrative_summary: { type: ["string", "null"], maxLength: 800 },
            offering_details: {
              type: "array",
              maxItems: 5,
              items: offeringDisplayRowSchema(40, 90, 80),
            },
            instrument_details: {
              type: "array",
              maxItems: 35,
              items: offeringDisplayRowSchema(40, 130, 80),
            },
            registered_security_totals: looseObjectSchema(),
            key_cash_terms: looseObjectSchema(),
            source_notes: { type: "array", maxItems: 2, items: { type: "string", maxLength: 160 } },
            review_reasons: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
            needs_human_review: { type: "boolean" },
          },
        },
        evidence: { type: "array", maxItems: 0, items: { type: "string", maxLength: 160 } },
        notes: { type: "array", maxItems: 2, items: { type: "string", maxLength: 160 } },
      },
    },
    analysis_output: {
      type: "object",
      additionalProperties: true,
      required: [
        "source_group",
        "market_scope",
        "event_type",
        "event_title",
        "primary_ticker",
        "tickers",
        "sector",
        "industry_group",
        "theme_group",
        "sub_theme",
        "score",
        "score_reason",
        "score_explanation",
        "signal",
        "quick_take",
        "summary",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: { type: "string", enum: APPROVED_424B_EVENT_TYPES },
        event_title: { type: "string", maxLength: 160 },
        primary_ticker: {
          type: ["object", "null"],
          additionalProperties: true,
          required: ["ticker", "exchange"],
          properties: {
            ticker: { type: ["string", "null"], maxLength: 12 },
            exchange: { type: ["string", "null"], maxLength: 40 },
          },
        },
        tickers: { type: "array", maxItems: 0, items: { type: "object", additionalProperties: true } },
        ...marketTaxonomyAnalysisOutputSchemaProperties(),
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string", maxLength: 140 },
        score_explanation: scoreExplanationSchema(),
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string", maxLength: 260 },
        summary: { type: "string", maxLength: 800 },
        why_it_matters: { type: ["string", "null"], maxLength: 320 },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        analysis_action: { type: ["string", "null"] },
        archive_summary: { type: ["string", "null"] },
      },
    },
  },
};

function keyCashTermFactSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["value_text"],
    properties: {
      value_text: { type: "string", maxLength: 120 },
    },
  };
}
