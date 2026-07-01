import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { buildS1F1AnalysisPrompt } from "@/lib/sources/sec/forms/s1-f1/analysisPrompt";
import { APPROVED_SEC_EVENT_TYPES, type S1F1ParserOutput } from "@/lib/sources/sec/forms/s1-f1/types";
import { normalize424bOfferingDisplayModel } from "@/lib/ai/sec424bAnalysisAdapter";

export const SEC_S1_F1_ANALYSIS_PROMPT_KEY = "sec_s1_f1_analysis";
export const SEC_S1_F1_ANALYSIS_PROMPT_VERSION = "v15";

const ALLOWED_S1_F1_DISPLAY_MODES = new Set([
  "ipo_registration",
  "ipo_amendment",
  "routine_amendment",
  "resale_registration",
  "atm",
  "primary_offering",
  "registered_direct",
  "warrant_convertible",
  "rights_offering",
  "shelf_capacity",
  "mixed_offering",
  "mixed_registration",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
]);

const S1_F1_OFFERING_DETAIL_LABELS_BY_MODE: Record<string, readonly string[]> = {
  ipo_registration: [],
  ipo_amendment: [
    "Lead underwriters",
    "Underwriter option",
    "Primary / secondary mix",
    "Use of proceeds",
    "Lock-up",
    "Control / voting structure",
    "Foreign issuer / VIE structure",
    "Listing condition",
    "Directed share program",
    "ADS ratio",
    "Selling shareholders",
  ],
  resale_registration: [
    "Offering Type",
    "Selling Holders",
    "Agreement Date",
    "Resale Method",
    "Sale Price",
    "Source Instrument",
    "Purchase Limit",
    "Exchange Cap",
    "Ownership Limit",
    "Six-month Cap",
    "Conversion Price",
    "Floor Price",
    "Reset / Repricing",
    "Sales to Date",
    "Approx. Placement Price",
    "Use of Proceeds",
    "Registration Obligation",
  ],
  atm: ["Offering Type", "Sales Agent", "Fee / Commission", "Agreement Date", "End Date", "Use of Proceeds"],
  primary_offering: [
    "Offering Type",
    "Underwriter",
    "Placement Agent / Underwriter",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
    "Warrant Terms",
  ],
  registered_direct: [
    "Offering Type",
    "Purchaser / Investor",
    "Placement Agent / Underwriter",
    "Warrant Terms",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
  ],
  warrant_convertible: [
    "Offering Type",
    "Purchaser / Investor",
    "Placement Agent / Underwriter",
    "Warrant Terms",
    "Exercise Price",
    "Conversion Price",
    "Reset / Repricing",
    "Floor Price",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
  ],
  rights_offering: [
    "Offering Type",
    "Record Date",
    "Subscription Period",
    "Oversubscription",
    "Backstop / Dealer Manager",
    "Use of Proceeds",
  ],
  shelf_capacity: [
    "Offering Type",
    "Shelf Status",
    "Securities Covered",
    "Active Sale Terms",
    "Next Required Filing",
    "Use of Proceeds",
  ],
  mixed_offering: [
    "Offering Type",
    "Component Summary",
    "Units offered",
    "Purchaser / Investor",
    "Selling Holders",
    "Placement Agent",
    "Placement Agent / Underwriter",
    "Assumed Offering Price",
    "Assumed Public Offering Price",
    "Assumed Combined Public Offering Price",
    "Public Offering Price",
    "Company Proceeds",
    "Source Instrument",
    "Concurrent Private Placement",
    "Warrant Terms",
    "ADS Ratio",
    "Underlying ADS Basis",
    "Control / voting structure",
    "Control structure",
    "Listing condition",
    "Lock-up",
    "Use of Proceeds",
  ],
  mixed_registration: [
    "Offering Type",
    "Component Summary",
    "Units offered",
    "Purchaser / Investor",
    "Selling Holders",
    "Placement Agent",
    "Placement Agent / Underwriter",
    "Assumed Offering Price",
    "Assumed Public Offering Price",
    "Assumed Combined Public Offering Price",
    "Public Offering Price",
    "Company Proceeds",
    "Source Instrument",
    "Concurrent Private Placement",
    "Warrant Terms",
    "ADS Ratio",
    "Underlying ADS Basis",
    "Control / voting structure",
    "Control structure",
    "Listing condition",
    "Lock-up",
    "Use of Proceeds",
  ],
  spac_ipo: ["Sponsor", "Trust Account", "Redemption Terms", "Unit Components", "Proposed Exchange"],
  rule_462b_mef: [
    "Prior registration statement",
    "Rule 462(b) status",
    "Securities added",
    "Base offering",
    "Fee table",
  ],
  post_effective_amendment: [],
  routine_amendment: [],
  generic: [],
};

export type SecS1F1AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS1F1FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS1F1ParserOutput(input));
}

export function buildSecS1F1AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = withRuntimeMarketContext(readS1F1ParserOutput(input), input);
  if (!parserOutput) {
    throw new Error("SEC S-1/F-1 parser output is missing from filing package");
  }

  return {
    key: SEC_S1_F1_ANALYSIS_PROMPT_KEY,
    version: SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-1/F-1 registration filing from cleaned source blocks.",
      "Return only analysis_output and display_payload, with one primary display_payload.data.display_mode.",
      "There is no S-1/F-1 router LLM and no parser-completed display payload. Choose event_type, display_type, score, and display_payload from the source blocks.",
      "For offering_terms, generic analysis fields are storage/list compatibility only and must match the selected display payload.",
      "Use generic for the common filing detail page, offering_terms for IPO/offering/resale/MEF/POS AM registration terms, and spac_transaction_status only for source-backed de-SPAC status.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildS1F1AnalysisPrompt(parserOutput),
    responseFormat: {
      json_schema: {
        name: "sec_s1_f1_required_output",
        strict: false,
        schema: secS1F1RequiredOutputSchema,
      },
    },
  };
}

function withRuntimeMarketContext(parserOutput: S1F1ParserOutput | null, input: SecFilingAnalysisInput) {
  if (!parserOutput) return null;
  const filingPackage = readFilingPackage(input);
  const marketContext = readRecord(filingPackage.market_context);
  if (!marketContext || !Object.keys(marketContext).length) return parserOutput;
  return {
    ...parserOutput,
    raw: {
      ...parserOutput.raw,
      marketContext,
    },
  };
}

export function adaptSecS1F1AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS1F1AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = normalizeS1F1DisplayPayload(readRecord(root?.display_payload));
  if (!analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-1/F-1 result did not contain analysis_output and display_payload",
    };
  }

  const displayPayloadError = validateS1F1DisplayPayload(displayPayload);
  const displayPayloadWarnings = displayPayloadError ? [displayPayloadError] : [];
  const displayPayloadData = readRecord(displayPayload.data);
  if (displayPayloadData) {
    displayPayloadWarnings.push(...collectS1F1SourceCoverageWarnings(displayPayloadData, input));
    displayPayloadWarnings.push(...collectS1F1ShareOverhangDisplayWarnings(displayPayloadData, analysisOutput));
    appendS1F1DisplayWarnings(displayPayloadData, displayPayloadWarnings);
  }

  const normalizedValue = {
    ...root,
    parser_output: normalizeS1F1ParserOutput(root?.parser_output, input),
    analysis_output: alignS1F1AnalysisOutputToDisplayPayload(
      normalizeS1F1AnalysisOutput(analysisOutput, input),
      displayPayload,
    ),
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(normalizedValue);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-1/F-1 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value, displayPayloadWarnings),
  };
}

function validateS1F1DisplayPayload(displayPayload: Record<string, unknown>) {
  const displayType = stringValue(displayPayload.display_type);
  if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(displayType)) {
    return `SEC S-1/F-1 display_payload.display_type is not allowed: ${displayType || "(empty)"}`;
  }
  if (displayType !== "offering_terms") return "";

  const data = readRecord(displayPayload.data);
  if (!data || !Object.keys(data).length) {
    return "SEC S-1/F-1 offering_terms display_payload.data must be filled by the analysis LLM";
  }
  const displayMode = stringValue(data.display_mode);
  if (displayMode && !ALLOWED_S1_F1_DISPLAY_MODES.has(displayMode)) {
    return `SEC S-1/F-1 offering_terms display_payload.data.display_mode is not allowed: ${displayMode}`;
  }
  if (!displayMode) {
    return "SEC S-1/F-1 offering_terms display_payload.data.display_mode must be written by the analysis LLM";
  }
  const amendmentSummaryMode = displayMode === "post_effective_amendment" || displayMode === "routine_amendment";
  const snapshotMetricsMayBeEmpty = amendmentSummaryMode;
  if (!Array.isArray(data.snapshot_metrics) || (!snapshotMetricsMayBeEmpty && !data.snapshot_metrics.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.snapshot_metrics must be written by the analysis LLM";
  }
  const offeringDetailsMayBeEmpty = displayMode === "ipo_registration" || amendmentSummaryMode;
  if (!Array.isArray(data.offering_details) || (!offeringDetailsMayBeEmpty && !data.offering_details.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.offering_details must be written by the analysis LLM";
  }
  if (!stringValue(data.investor_takeaway)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.investor_takeaway must be written by the analysis LLM";
  }
  appendS1F1DisplayWarnings(
    data,
    [
      ...collectLabelValueRowWarnings(data.offering_details, "offering_details", {
        maxValueLength: 90,
        maxNoteLength: 80,
      }),
      ...collectOfferingDetailLabelWarnings(data.offering_details, displayMode),
    ],
  );
  const rowError =
    validateLabelValueRows(data.snapshot_metrics, "snapshot_metrics", {
      allowEmpty: snapshotMetricsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.offering_details, "offering_details", {
      allowEmpty: offeringDetailsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.amendment_changes, "amendment_changes", { allowEmpty: true });
  if (rowError) return rowError;
  const structuredOverhangError = validateS1F1OverhangFacts(data);
  if (structuredOverhangError) return structuredOverhangError;
  return "";
}

function validateLabelValueRows(
  value: unknown,
  fieldName: string,
  options?: { allowEmpty?: boolean },
) {
  if (value === undefined || value === null) return "";
  if (!Array.isArray(value)) return `SEC S-1/F-1 display_payload.data.${fieldName} must be an array`;
  if (!options?.allowEmpty && !value.length) {
    return `SEC S-1/F-1 display_payload.data.${fieldName} must be written by the analysis LLM`;
  }
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record || !Object.keys(record).length) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] cannot be an empty object`;
    }
    const label = stringValue(record.label);
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (!label || !rowValue) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] must include label and value`;
    }
  }
  return "";
}

function collectLabelValueRowWarnings(
  value: unknown,
  fieldName: string,
  options: { maxValueLength?: number; maxNoteLength?: number },
) {
  if (!Array.isArray(value)) return [];
  const warnings: string[] = [];
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record) continue;
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (options.maxValueLength && rowValue.length > options.maxValueLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].value exceeded ${options.maxValueLength} characters`,
      );
    }
    if (options.maxNoteLength && note.length > options.maxNoteLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].note exceeded ${options.maxNoteLength} characters`,
      );
    }
  }
  return warnings;
}

function collectOfferingDetailLabelWarnings(value: unknown, displayMode: string) {
  if (!Array.isArray(value)) return [];
  const allowed = S1_F1_OFFERING_DETAIL_LABELS_BY_MODE[displayMode] || [];
  if (!allowed.length) return [];
  const allowedSet = new Set(allowed.map((label) => label.toLowerCase()));
  const warnings: string[] = [];
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    const label = stringValue(record?.label);
    if (!label || allowedSet.has(label.toLowerCase())) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.offering_details[${index}].label is outside ${displayMode} candidates: ${label}`,
    );
  }
  return warnings;
}

function collectS1F1ShareOverhangDisplayWarnings(data: Record<string, unknown>, analysisOutput?: Record<string, unknown>) {
  const warnings: string[] = [];
  const shareOverhang = readRecord(data.share_overhang);
  if (!shareOverhang) return warnings;

  const caption = stringValue(shareOverhang.caption);
  const basis = readRecord(shareOverhang.basis);
  const structuredRows = Array.isArray(shareOverhang.rows) ? shareOverhang.rows : [];
  const legacySegments = Array.isArray(shareOverhang.segments) ? shareOverhang.segments : [];
  const rowsToCheck = structuredRows.length ? structuredRows : legacySegments;
  warnings.push(...collectS1F1ShareOverhangUnitWarnings(basis, rowsToCheck, structuredRows.length > 0));
  for (const item of rowsToCheck) {
    const row = readRecord(item);
    const label = stringValue(row?.label);
    const included = isS1F1CountedShareOverhangRow(row, structuredRows.length > 0);
    if (!hasGroupedInstrumentSeriesLabel(label) || !included) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.share_overhang has grouped instrument series in an included numerator row (${label}); grouped series must share the same supply_type and material economics.`,
    );
  }
  warnings.push(...collectS1F1WarrantShareOverhangWarnings(data, rowsToCheck, analysisOutput));

  if (!caption) return warnings;

  const primaryPercent =
    firstPercentValue(stringValue(shareOverhang.status_value || shareOverhang.statusValue)) ??
    firstPercentValue(stringValue(shareOverhang.ratio_value || shareOverhang.ratioValue));
  if (primaryPercent === null) return warnings;

  const captionPercents = percentValues(caption);
  if (!captionPercents.length) return warnings;

  const hasMatchingCaptionPercent = captionPercents.some((percent) => Math.abs(percent - primaryPercent) <= 0.2);
  if (hasMatchingCaptionPercent) return warnings;

  warnings.push(
    `S-1/F-1 display_payload.data.share_overhang.caption percent does not match status_value/ratio_value (${caption} vs ${primaryPercent}%).`,
  );
  return warnings;
}

function collectS1F1ShareOverhangUnitWarnings(
  basis: Record<string, unknown> | null,
  rawRows: unknown[],
  structuredRows: boolean,
) {
  const warnings: string[] = [];
  const basisNumericValue = numberValue(basis?.numeric_value) ?? numberValue(basis?.numericValue);
  const basisUnit = stringValue(basis?.unit);
  const basisClass = stringValue(basis?.class_basis || basis?.classBasis);
  if (typeof basisNumericValue === "number" && Number.isFinite(basisNumericValue) && basisNumericValue > 0 && !basisUnit) {
    warnings.push("S-1/F-1 display_payload.data.share_overhang.basis has numeric_value but missing unit.");
  }

  for (const item of rawRows) {
    const row = readRecord(item);
    if (!row) continue;
    const numericValue = numberValue(row.numeric_value) ?? numberValue(row.numericValue);
    if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) continue;

    const rowUnit = stringValue(row.unit);
    const rowClass = stringValue(row.class_basis || row.classBasis);
    const included = isS1F1CountedShareOverhangRow(row, structuredRows);

    if (!rowUnit) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang row has numeric_value but missing unit: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
    if (!included) continue;

    if (basisUnit && rowUnit && normalizeShareOverhangUnitForWarning(basisUnit) !== normalizeShareOverhangUnitForWarning(rowUnit)) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row unit does not match basis unit: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
    if (basisClass && rowClass && normalizeShareOverhangUnitForWarning(basisClass) !== normalizeShareOverhangUnitForWarning(rowClass)) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row class_basis does not match basis class_basis: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
  }

  return uniqueStrings(warnings);
}

function normalizeShareOverhangUnitForWarning(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/\bamerican depositary shares?\b/g, "ads")
    .replace(/\badses\b/g, "ads")
    .replace(/\badss\b/g, "ads")
    .replace(/\bshares?\b/g, "shares")
    .replace(/\bunits?\b/g, "units")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bads\b/.test(normalized)) return "ads";
  return normalized;
}

function collectS1F1WarrantShareOverhangWarnings(
  data: Record<string, unknown>,
  rawRows: unknown[],
  analysisOutput?: Record<string, unknown>,
) {
  const rows = rawRows.map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  if (!rows.length) return [];

  const warnings: string[] = [];
  for (const row of rows) {
    const label = stringValue(row.label);
    const rowText = `${label} ${stringValue(row.value)} ${stringValue(row.note)}`;
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    if (
      countedInRatio === true &&
      supplyType === "current_offering_pool" &&
      isNonShareEquivalentWarrantText(label)
    ) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row label appears to mix accompanying warrant package text with counted current offering supply: ${label}`,
      );
    }
    if (
      countedInRatio === true &&
      supplyType === "share_equivalent" &&
      isNonShareEquivalentWarrantText(rowText)
    ) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row appears to include non-share-equivalent warrant supply: ${label}`,
      );
    }
  }

  const futureExerciseRows = rows.filter((row) => {
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    return countedInRatio === false || supplyType === "future_exercise";
  });
  const aggregateFutureRows = futureExerciseRows.filter((row) =>
    /\b(?:all|total)\b[\s\S]{0,80}\bwarrants?\b|\b(?:warrants?\s+total|total\s+potential\s+supply|issuable\s+upon\s+exercise\s+of\s+all\s+warrants?)\b/i.test(
      `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`,
    ),
  );
  if (aggregateFutureRows.length && futureExerciseRows.length > aggregateFutureRows.length) {
    warnings.push(
      "S-1/F-1 display_payload.data.share_overhang includes an aggregate all-warrants future_exercise row alongside component future_exercise rows; omit the overlapping aggregate row.",
    );
  }

  for (const group of readInstrumentDetailGroups(data.instrument_details)) {
    if (!isNonShareEquivalentWarrantText(group.text)) continue;
    const hasVisibleConditionalRow = rows.some((row) => {
      if (!shareOverhangRowMatchesInstrument(row, group.type)) return false;
      const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
      const supplyType = stringValue(row.supply_type || row.supplyType);
      return countedInRatio === false || supplyType === "future_exercise";
    });
    if (hasVisibleConditionalRow) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.instrument_details includes ${group.type}, but share_overhang.rows does not show a matching future_exercise row with counted_in_ratio false.`,
    );
  }

  const instrumentGroups = readInstrumentDetailGroups(data.instrument_details);
  for (const row of rows) {
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    if (countedInRatio !== false && supplyType !== "future_exercise") continue;
    if (!isNonShareEquivalentWarrantText(rowText)) continue;
    const hasMatchingInstrument = instrumentGroups.some((group) => shareOverhangRowMatchesInstrument(row, group.type));
    if (hasMatchingInstrument) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.share_overhang includes ${stringValue(row.label)}, but instrument_details does not show a matching Type group.`,
    );
  }

  const shareOverhangContext = `${JSON.stringify(readRecord(data.share_overhang) || {})} ${JSON.stringify(data.snapshot_metrics || [])} ${stringValue(analysisOutput?.summary)} ${stringValue(analysisOutput?.quick_take)} ${stringValue(data.narrative_summary)} ${stringValue(data.investor_takeaway)}`;
  const hasFutureExerciseWarrantMention = hasNonShareEquivalentWarrantMention(shareOverhangContext);
  const hasFutureExerciseWarrantRow = rows.some((row) => {
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    return (countedInRatio === false || supplyType === "future_exercise") && hasNonShareEquivalentWarrantMention(rowText);
  });
  if (hasFutureExerciseWarrantMention && !hasFutureExerciseWarrantRow) {
    warnings.push(
      "S-1/F-1 display_payload mentions material warrant supply, but share_overhang.rows does not show a future_exercise row with counted_in_ratio false.",
    );
  }
  if (hasFutureExerciseWarrantMention && !instrumentGroups.length) {
    warnings.push(
      "S-1/F-1 display_payload mentions material warrant supply, but instrument_details is empty.",
    );
  }

  return uniqueStrings(warnings);
}

function readInstrumentDetailGroups(value: unknown) {
  const groups: Array<{ type: string; text: string }> = [];
  let current: { type: string; parts: string[] } | null = null;

  for (const item of Array.isArray(value) ? value : []) {
    const row = readRecord(item);
    const label = stringValue(row?.label);
    const rowValue = stringValue(row?.value);
    if (!label || !rowValue) continue;
    if (label.toLowerCase() === "type") {
      current = { type: rowValue, parts: [rowValue] };
      groups.push({
        type: current.type,
        text: current.parts.join(" "),
      });
      continue;
    }
    if (!current) continue;
    current.parts.push(rowValue);
    groups[groups.length - 1] = {
      type: current.type,
      text: current.parts.join(" "),
    };
  }

  return groups;
}

function isNonShareEquivalentWarrantText(value: string) {
  if (!/\bwarrants?\b/i.test(value)) return false;
  if (/\bpre[-\s]?funded\b/i.test(value)) return false;
  if (/\b(?:zero[-\s]?exercise|zero\s+exercise\s+price|nominal[-\s]?exercise|share[-\s]?equivalent)\b/i.test(value)) return false;
  if (/\$0\.0+1\b|\$0\.0+01\b/i.test(value)) return false;
  return true;
}

function hasNonShareEquivalentWarrantMention(value: string) {
  return /\b(?:common|ordinary|placement\s+agent|agent|underwriter|representative|Series\s+[A-Z])\s+warrants?\b/i.test(value);
}

function shareOverhangRowMatchesInstrument(row: Record<string, unknown>, instrumentType: string) {
  const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
  const normalizedRowText = normalizeInstrumentMatchText(rowText);
  const normalizedType = normalizeInstrumentMatchText(instrumentType);
  if (normalizedType && normalizedRowText.includes(normalizedType)) return true;

  const words = normalizedType.split(" ").filter((word) => word.length > 2 && word !== "warrant" && word !== "warrants");
  if (!words.length) return /\bwarrant\b/i.test(normalizedRowText);
  return words.every((word) => normalizedRowText.includes(word)) && /\bwarrant\b/i.test(normalizedRowText);
}

function normalizeInstrumentMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bwarrants\b/g, "warrant")
    .replace(/\s+/g, " ")
    .trim();
}

function appendS1F1DisplayWarnings(data: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const existing = Array.isArray(data.display_warnings)
    ? data.display_warnings.map((item) => stringValue(item)).filter(Boolean)
    : [];
  data.display_warnings = uniqueStrings([...existing, ...warnings]);
}

function collectS1F1SourceCoverageWarnings(data: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const displayMode = stringValue(data.display_mode);
  if (!["mixed_offering", "mixed_registration"].includes(displayMode)) return [];

  const parserOutput = readS1F1ParserOutput(input);
  const sourceText = Array.isArray(parserOutput?.raw?.cleanedSourceBlocks)
    ? parserOutput.raw.cleanedSourceBlocks.map((block) => stringValue(readRecord(block)?.text)).join("\n")
    : "";
  const hasConcurrentSeries =
    /\bSeries\s+C\s+Warrants?\b/i.test(sourceText) &&
    /\bSeries\s+D\s+Warrants?\b/i.test(sourceText) &&
    /\b(?:concurrent\s+private\s+placement|private\s+placement|VRT Prohibition|Waiver)\b/i.test(sourceText);
  if (!hasConcurrentSeries) return [];

  const offeringDetailsText = JSON.stringify(Array.isArray(data.offering_details) ? data.offering_details : []);
  const shareOverhangText = JSON.stringify(readRecord(data.share_overhang) || {});
  const instrumentDetailsText = JSON.stringify(Array.isArray(data.instrument_details) ? data.instrument_details : []);
  const missingSurfaces: string[] = [];
  if (!/\bConcurrent Private Placement\b/i.test(offeringDetailsText)) {
    missingSurfaces.push("Offering Details");
  }
  if (!hasSeriesCAndDText(shareOverhangText)) {
    missingSurfaces.push("share_overhang");
  }
  if (!hasSeriesCAndDText(instrumentDetailsText)) {
    missingSurfaces.push("instrument_details");
  }
  if (!missingSurfaces.length) {
    return [];
  }

  return [
    `S-1/F-1 source contains concurrent private placement Series C/D warrant exposure, but visible mixed_offering UI is missing it in: ${missingSurfaces.join(", ")}.`,
  ];
}

function hasSeriesCAndDText(value: string) {
  return (
    (/\bSeries\s+C\b/i.test(value) && /\bSeries\s+D\b/i.test(value)) ||
    /\bSeries\s+C\s*(?:\/|&|\band\b)\s*(?:Series\s+)?D\b/i.test(value)
  );
}

function hasGroupedInstrumentSeriesLabel(value: string) {
  return /\bSeries\s+[A-Za-z0-9-]+\s*(?:\/|&|\band\b)\s*(?:Series\s+)?[A-Za-z0-9-]+\b/i.test(value);
}

function isIncludedSupplyNature(value: string) {
  return ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(value);
}

function isS1F1CountedShareOverhangRow(row: Record<string, unknown> | null, structuredRows: boolean) {
  if (!row) return false;
  const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
  if (structuredRows && countedInRatio !== null) return countedInRatio;

  const supplyNature = stringValue(row.supply_nature || row.supplyNature);
  const calculationRole = stringValue(row.calculation_role || row.calculationRole);
  if (structuredRows) return calculationRole === "headline_numerator" && isIncludedSupplyNature(supplyNature);
  return isIncludedSupplyNature(supplyNature);
}

function validateS1F1OverhangFacts(data: Record<string, unknown>) {
  const displayMode = stringValue(data.display_mode);
  if (!["resale_registration", "mixed_offering", "mixed_registration"].includes(displayMode)) return "";
  const requiresOverhangSnapshotLabel = displayMode !== "mixed_offering";
  const hasSupplyNumerator = hasNumericShareOverhangSegment(data, "supply");
  const snapshotText = Array.isArray(data.snapshot_metrics)
    ? data.snapshot_metrics
        .map((row) => {
          const record = readRecord(row);
          return `${stringValue(record?.label)} ${stringValue(record?.value)} ${stringValue(record?.note)}`;
        })
        .join(" ")
    : "";
  const mentionsOverhang = /\b(?:overhang|dilution|outstanding)\b/i.test(snapshotText);
  if (!hasSupplyNumerator && !mentionsOverhang) return "";
  if (
    hasNumericShareOverhangSegment(data, "current") &&
    hasNumericShareOverhangSegment(data, "supply") &&
    hasVisibleShareOverhangRatio(data)
  ) {
    return "";
  }
  if (requiresOverhangSnapshotLabel && hasSupplyNumerator && !/\boverhang\s+vs\.?\s+outstanding\b/i.test(snapshotText)) {
    return "SEC S-1/F-1 resale display must include snapshot_metrics row labeled Overhang vs outstanding when share_overhang has included supply";
  }
  if (!hasNumericShareOverhangSegment(data, "current")) {
    return "SEC S-1/F-1 overhang snapshot must include numeric display_payload.data.share_overhang.basis from filing data when available; market_context shares are allowed only when the filing provides no denominator";
  }
  if (!hasSupplyNumerator) {
    return "SEC S-1/F-1 overhang snapshot must include numeric counted_in_ratio true share_overhang.rows from the same registered/offered share numerator";
  }
  return "";
}

function hasNumericShareOverhangSegment(data: Record<string, unknown>, kind: "current" | "supply") {
  const shareOverhang = readRecord(data.share_overhang);
  if (kind === "current") {
    const basis = readRecord(shareOverhang?.basis);
    const numericValue = numberValue(basis?.numeric_value) ?? numberValue(basis?.numericValue);
    if (typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0) return true;
  }

  if (kind === "supply") {
    const rows = Array.isArray(shareOverhang?.rows) ? shareOverhang.rows : [];
    const hasHeadlineSupplyRow = rows.some((item) => {
      const record = readRecord(item);
      const numericValue = numberValue(record?.numeric_value) ?? numberValue(record?.numericValue);
      if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) return false;
      return isS1F1CountedShareOverhangRow(record, true);
    });
    if (hasHeadlineSupplyRow) return true;
  }

  const segments = Array.isArray(shareOverhang?.segments) ? shareOverhang.segments : [];
  return segments.some((item) => {
    const record = readRecord(item);
    const numericValue = numberValue(record?.numeric_value) ?? numberValue(record?.numericValue);
    if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) return false;
    const className = stringValue(record?.class_name || record?.className);
    const supplyNature = stringValue(record?.supply_nature || record?.supplyNature);
    const isBase = className === "current-base" || className === "base-shares" || supplyNature === "base_shares";
    return kind === "current" ? isBase : !isBase;
  });
}

function hasVisibleShareOverhangRatio(data: Record<string, unknown>) {
  const shareOverhang = readRecord(data.share_overhang);
  return Boolean(
    stringValue(shareOverhang?.status_value || shareOverhang?.statusValue) ||
      stringValue(shareOverhang?.ratio_value || shareOverhang?.ratioValue),
  );
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput, displayPayloadWarnings: string[] = []) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    archive_summary:
      nullableString(value.analysis_output.archive_summary) ||
      (score < 50 ? nullableString(value.analysis_output.summary) : null),
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_s1_f1_display_warnings: uniqueStrings(displayPayloadWarnings),
    sec_s1_f1_analysis_mode: "analysis_only",
    sec_offering_analysis_mode: "analysis_only",
  };
}

function normalizeS1F1DisplayPayload(displayPayload: Record<string, unknown> | null) {
  if (!displayPayload) return null;
  const data = readRecord(displayPayload.data);
  if (!data) return displayPayload;
  const displayMode = stringValue(data.display_mode);
  const normalizedData =
    displayMode === "mixed_registration"
      ? {
          ...data,
          display_mode: "mixed_offering",
        }
      : data;
  const normalizedPayload = {
    ...displayPayload,
    data: normalizedData,
  };
  if (stringValue((normalizedPayload as Record<string, unknown>).display_type) !== "offering_terms") {
    return normalizedPayload;
  }
  const normalizedPayloadData = (normalize424bOfferingDisplayModel(readRecord(normalizedPayload.data)) ||
    readRecord(normalizedPayload.data) ||
    {}) as Record<string, unknown>;
  const hasReviewFlag =
    normalizedPayloadData.needs_human_review === true ||
    normalizedPayloadData.needsHumanReview === true;
  return {
    ...normalizedPayload,
    evidence: hasReviewFlag ? displayPayload.evidence : [],
    notes: hasReviewFlag ? displayPayload.notes : [],
    data: {
      ...normalizedPayloadData,
      source_notes: hasReviewFlag ? normalizedPayloadData.source_notes : [],
    },
  };
}

function normalizeS1F1ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const fallback = readS1F1ParserOutput(input);
  const filingPackage = readFilingPackage(input);
  const fallbackRaw = readRecord(fallback?.raw) || {};
  const raw = readRecord(parser.raw) || fallbackRaw;
  const runtimeMarketContext = readRecord(filingPackage.market_context);
  return {
    ...fallback,
    ...parser,
    parserVersion: stringValue(parser.parserVersion) || fallback?.parserVersion || "s1-f1-parser-v1",
    parserGroup: stringValue(parser.parserGroup) || fallback?.parserGroup || "s1-f1",
    formType: stringValue(parser.formType) || fallback?.formType || "S-1 / F-1, S-1/A / F-1/A",
    accessionNumber:
      stringValue(parser.accessionNumber) ||
      fallback?.accessionNumber ||
      stringValue(filingPackage.accession_number) ||
      null,
    isSupported: typeof parser.isSupported === "boolean" ? parser.isSupported : fallback?.isSupported !== false,
    facts: readRecord(parser.facts) || readRecord(fallback?.facts) || {},
    signals: Array.isArray(parser.signals) ? parser.signals : Array.isArray(fallback?.signals) ? fallback?.signals : [],
    calendarItems: Array.isArray(parser.calendarItems)
      ? parser.calendarItems
      : Array.isArray(fallback?.calendarItems)
        ? fallback?.calendarItems
        : [],
    warnings: Array.isArray(parser.warnings) ? parser.warnings : Array.isArray(fallback?.warnings) ? fallback?.warnings : [],
    raw: {
      ...raw,
      ...(runtimeMarketContext && Object.keys(runtimeMarketContext).length ? { marketContext: runtimeMarketContext } : {}),
    },
  };
}

function normalizeS1F1AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  return {
    ...value,
    source_group: "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    sector: nullableString(value.sector),
    industry_group: nullableString(value.industry_group),
    theme_group: nullableString(value.theme_group),
    sub_theme: nullableString(value.sub_theme),
    why_it_matters:
      nullableString(value.why_it_matters) ||
      nullableString(value.quick_take) ||
      nullableString(value.summary) ||
      "",
    related_tickers: [],
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function alignS1F1AnalysisOutputToDisplayPayload(
  analysis: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return analysis;
  const data = readRecord(displayPayload.data);
  if (!data) return analysis;
  const displayMode = stringValue(data.display_mode);
  const investorTakeaway = nullableString(data.investor_takeaway);
  const narrativeSummary = nullableString(data.narrative_summary);
  const aligned: Record<string, unknown> = {
    ...analysis,
    ...(investorTakeaway ? { quick_take: investorTakeaway } : {}),
    ...(narrativeSummary ? { summary: narrativeSummary } : {}),
  };
  if (displayMode && displayMode !== "generic") {
    aligned.bullish_points = [];
    aligned.bearish_points = [];
    aligned.key_evidence = [];
    aligned.what_to_watch_next = [];
  }
  return aligned;
}

function readS1F1ParserOutput(input: SecFilingAnalysisInput): S1F1ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return (readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1)) as S1F1ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const packageTicker = nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const ticker = packageTicker || nullableString(record?.ticker);
  const exchange = nullableString(packagePrimary?.exchange) || nullableString(record?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  if (role === "primary" && primaryTicker.ticker) {
    return [
      {
        ticker: primaryTicker.ticker,
        exchange: primaryTicker.exchange,
        role: "primary",
        reason: "Primary SEC filing ticker",
      },
    ];
  }
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

function percentValues(value: string) {
  const matches = value.match(/[+-]?\d[\d,]*(?:\.\d+)?\s*%/g) || [];
  return matches
    .map((match) => Number(match.replace(/[,%\s]/g, "")))
    .filter((item) => Number.isFinite(item));
}

function firstPercentValue(value: string) {
  return percentValues(value)[0] ?? null;
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const secS1F1RequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
    analysis_output: {
      type: "object",
      additionalProperties: true,
      required: [
        "event_type",
        "event_title",
        "score",
        "score_reason",
        "signal",
        "quick_take",
        "summary",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
        event_title: { type: "string" },
        score: { type: "number" },
        score_reason: { type: "string" },
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        archive_summary: { type: ["string", "null"] },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data"],
      properties: {
        display_type: { type: "string" },
        display_version: { type: "string" },
        data: {
          type: "object",
          additionalProperties: true,
          required: [
            "display_mode",
            "risk_label",
            "snapshot_metrics",
            "investor_takeaway",
            "offering_details",
            "instrument_details",
          ],
          properties: {
            display_mode: { type: ["string", "null"] },
            ipo_kind: { type: ["string", "null"] },
            risk_label: { type: ["string", "null"] },
            snapshot_metrics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                  tone: { type: ["string", "null"] },
                  emphasis: { type: ["boolean", "null"] },
                },
              },
            },
            share_overhang: {
              type: "object",
              additionalProperties: true,
              required: [
                "chart_title",
                "status_label",
                "status_value",
                "basis",
                "rows",
              ],
              properties: {
                chart_title: { type: "string" },
                subtitle: { type: "string" },
                status_label: { type: "string" },
                status_value: { type: "string" },
                caption: { type: "string" },
                ratio_label: { type: "string" },
                ratio_value: { type: "string" },
                total_note: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    title: { type: "string" },
                    numerator: { type: "string" },
                    denominator: { type: "string" },
                    ratio: { type: "string" },
                    suffix: { type: "string" },
                  },
                },
                basis: {
                  type: "object",
                  additionalProperties: true,
                  required: ["label", "value", "numeric_value", "unit"],
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    numeric_value: { type: ["number", "null"] },
                    unit: { type: "string" },
                    class_basis: { type: ["string", "null"] },
                    note: { type: ["string", "null"] },
                  },
                },
                rows: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                    required: ["counted_in_ratio", "supply_type", "label", "value", "numeric_value", "unit"],
                    properties: {
                      counted_in_ratio: { type: "boolean" },
                      supply_type: { type: "string" },
                      label: { type: "string" },
                      value: { type: "string" },
                      numeric_value: { type: ["number", "null"] },
                      unit: { type: "string" },
                      class_basis: { type: ["string", "null"] },
                      note: { type: ["string", "null"] },
                    },
                  },
                },
                note: { type: ["string", "null"] },
              },
            },
            investor_takeaway: { type: ["string", "null"] },
            narrative_summary: { type: ["string", "null"] },
            offering_details: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                },
              },
            },
            instrument_details: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                },
              },
            },
            amendment_changes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                },
              },
            },
            source_notes: { type: "array", items: { type: "string" } },
            needs_human_review: { type: "boolean" },
            review_reasons: { type: "array", items: { type: "string" } },
          },
        },
        evidence: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
