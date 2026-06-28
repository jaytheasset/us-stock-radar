import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { build424bAnalysisPrompt } from "@/lib/sources/sec/forms/424b/analysisPrompt";
import { APPROVED_424B_EVENT_TYPES } from "@/lib/sources/sec/forms/424b/types";
import type { Sec424bParserOutput } from "@/lib/sources/sec/forms/424b/types";

export const SEC_424B_ANALYSIS_PROMPT_KEY = "sec_424b_analysis";
export const SEC_424B_ANALYSIS_PROMPT_VERSION = "v9";
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

export type Sec424bAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function is424bFilingInput(input: SecFilingAnalysisInput) {
  return Boolean(read424bParserOutput(input));
}

export function buildSec424bAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = read424bParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 424B parser output is missing from filing package");
  }

  return {
    key: SEC_424B_ANALYSIS_PROMPT_KEY,
    version: SEC_424B_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC 424B filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "There is no 424B router LLM and no parser-completed 424B result. Choose event_type, display_type, score, and display_payload from the provided source blocks.",
      "Use generic for the common filing detail page, offering_terms for offering/dilution/IPO terms, and spac_transaction_status only for source-backed SPAC/de-SPAC transaction status.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: build424bAnalysisPrompt(parserOutput),
    responseFormat: {
      json_schema: {
        name: "sec_424b_required_output",
        strict: false,
        schema: sec424bRequiredOutputSchema,
      },
    },
  };
}

export function adaptSec424bAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): Sec424bAnalysisAdapterResult {
  const parserOutput = read424bParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC 424B result did not contain analysis_output and display_payload",
    };
  }
  const displayPayloadError = validate424bDisplayPayload(displayPayload);
  const displayPayloadWarnings = [
    ...(displayPayloadError ? [displayPayloadError] : []),
    ...collect424bDisplayPayloadWarnings(displayPayload),
  ];
  append424bDisplayWarnings(displayPayload, displayPayloadWarnings);

  return adapt424bRoomResultForAnalysis({
    parser_output: parserOutput,
    analysis_output: normalize424bAnalysisOutput(analysisOutput, input),
    display_payload: displayPayload,
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
    "narrative_summary",
    "needs_human_review",
  ];
  const missing = requiredKeys.filter((key) => !(key in data));
  if (missing.length) {
    return `SEC 424B offering_terms display_payload.data missing required field(s): ${missing.join(", ")}`;
  }
  if (!stringValue(data.investor_takeaway)) {
    return "SEC 424B offering_terms display_payload.data.investor_takeaway must be written by the analysis LLM";
  }
  if (!stringValue(data.narrative_summary)) {
    return "SEC 424B offering_terms display_payload.data.narrative_summary must be written by the analysis LLM";
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
  for (const segment of arrayValue(data.supply_segments)) {
    const record = readRecord(segment);
    const shares = readRecord(record?.shares);
    const sharesText = stringValue(shares?.value_text).toLowerCase();
    const shareFieldError = validateShareExposureFact(shares, "supply_segments.shares");
    if (shareFieldError) warnings.push(`SEC 424B ${shareFieldError}`);
    const underlyingShareError = validateShareExposureFact(readRecord(record?.underlying_shares), "supply_segments.underlying_shares");
    if (underlyingShareError) warnings.push(`SEC 424B ${underlyingShareError}`);
    const instrumentCountError = validateInstrumentCountFact(readRecord(record?.instrument_count), "supply_segments.instrument_count");
    if (instrumentCountError) warnings.push(`SEC 424B ${instrumentCountError}`);
    if (stringValue(shares?.unit) === "shares" && /\bwarrants?\b/i.test(sharesText) && !/\bshares?\b/i.test(stringValue(shares?.value_text))) {
      warnings.push("SEC 424B supply_segments.shares may contain warrant counts; prefer instrument_count for warrants and underlying_shares for share exposure.");
    }
    const price = readRecord(record?.price);
    const exercisePrice = readRecord(record?.exercise_price);
    const marketPrice = readRecord(record?.market_price);
    const priceText = `${stringValue(price?.value_text)} ${stringValue(price?.evidence)}`.toLowerCase();
    const exerciseText = `${stringValue(exercisePrice?.value_text)} ${stringValue(exercisePrice?.evidence)}`.toLowerCase();
    if (/\blast reported sales price|market price\b/i.test(priceText) && !stringValue(marketPrice?.value_text)) {
      warnings.push("SEC 424B warrant market price should use supply_segments.market_price, not price/exercise_price.");
    }
    if (/\blast reported sales price|market price\b/i.test(exerciseText)) {
      warnings.push("SEC 424B market price may be incorrectly used as Exercise / Conversion Price.");
    }
  }
  return warnings;
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

function validateShareExposureFact(value: Record<string, unknown> | null, fieldName: string) {
  if (!hasDisplayFactValue(value)) return "";

  const unit = stringValue(value?.unit).toLowerCase();
  const valueText = stringValue(value?.value_text);
  if (/\$|\busd\b|dollars?/i.test(valueText) || unit === "$" || /\busd\b/.test(unit)) {
    return `${fieldName} cannot contain dollar amounts or proceeds; put cash amounts in key_cash_terms or offering_details.`;
  }

  if (unit && unit !== "unknown" && !/shares?|ads|ordinary|common/.test(unit)) {
    return `${fieldName} must use a share unit, not ${stringValue(value?.unit)}.`;
  }

  return "";
}

function validateInstrumentCountFact(value: Record<string, unknown> | null, fieldName: string) {
  if (!hasDisplayFactValue(value)) return "";

  const unit = stringValue(value?.unit).toLowerCase();
  const valueText = stringValue(value?.value_text);
  if (/\$|\busd\b|dollars?/i.test(valueText) || unit === "$" || /\busd\b/.test(unit)) {
    return `${fieldName} cannot contain dollar amounts or proceeds; put cash amounts in key_cash_terms or offering_details.`;
  }

  return "";
}

function append424bDisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const data = readRecord(displayPayload.data);
  if (!data) return;
  const existing = readStringArray(data.display_warnings);
  data.display_warnings = uniqueStrings([...existing, ...warnings]);
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
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_424b_display_warnings: uniqueStrings(displayPayloadWarnings),
    sec_424b_analysis_mode: "analysis_only",
  };
}

export function normalize424bOfferingDisplayModel(data: Record<string, unknown> | null) {
  if (!data) return null;
  const shareOverhang = normalizeShareOverhang(readRecord(data.share_overhang));
  return {
    ...data,
    display_mode: stringValue(data.display_mode) || "offering_terms",
    risk_label: stringValue(data.risk_label) || "needs_review",
    current_shares: normalizeDisplayFact(readRecord(data.current_shares), "shares"),
    total_potential_supply: normalizeDisplayFact(readRecord(data.total_potential_supply), "shares"),
    ads_equivalence: normalizeAdsEquivalence(readRecord(data.ads_equivalence)),
    snapshot_metrics: normalizeSnapshotMetrics(data.snapshot_metrics),
    mixed_offering_components: normalizeMixedOfferingComponents(data.mixed_offering_components),
    key_cash_terms: normalizeKeyCashTerms(readRecord(data.key_cash_terms)),
    registered_security_totals: normalizeRegisteredSecurityTotals(readRecord(data.registered_security_totals)),
    supply_segments: normalizeSupplySegments(data.supply_segments),
    ...(shareOverhang ? { share_overhang: shareOverhang } : {}),
    investor_takeaway: stringValue(data.investor_takeaway),
    offering_details: normalizeOfferingDetails(data.offering_details),
    amendment_changes: normalizeOfferingDetails(data.amendment_changes),
    warrant_details: normalizeWarrantDetails(data.warrant_details),
    narrative_summary: stringValue(data.narrative_summary),
    watch_items: readStringArray(data.watch_items),
    source_notes: readStringArray(data.source_notes),
    review_reasons: readStringArray(data.review_reasons),
    needs_human_review: data.needs_human_review === true,
  };
}

function normalizeShareOverhang(value: Record<string, unknown> | null) {
  if (!value) return null;
  const unavailableRows = arrayValue(value.unavailable_rows || value.detail_rows || value.rows)
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
  const segments = arrayValue(value.segments || value.bar_segments || value.barSegments)
    .map((segment) => {
      const record = readRecord(segment);
      const label = stringValue(record?.label);
      const segmentValue = stringValue(record?.value) || stringValue(record?.value_text);
      if (!label || !segmentValue) return null;
      return {
        key: nullableString(record?.key),
        class_name: nullableString(record?.class_name || record?.className),
        label,
        value: segmentValue,
        note: nullableString(record?.note),
        width_percent: numberValue(record?.width_percent) ?? numberValue(record?.widthPercent) ?? numberValue(record?.width) ?? null,
      };
    })
    .filter(Boolean);
  const totalNote = readRecord(value.total_note || value.totalNote);
  const normalizedTotalNote = totalNote
    ? {
        title: stringValue(totalNote.title || totalNote.label),
        numerator: stringValue(totalNote.numerator || totalNote.supply_value || totalNote.supplyValue),
        denominator: stringValue(totalNote.denominator || totalNote.current_value || totalNote.currentValue),
        ratio: stringValue(totalNote.ratio || totalNote.ratio_value || totalNote.ratioValue),
        suffix: stringValue(totalNote.suffix || totalNote.note),
      }
    : null;
  const normalized = {
    chart_title: stringValue(value.chart_title || value.chartTitle || value.title),
    subtitle: stringValue(value.subtitle || value.chart_subtitle),
    status_label: stringValue(value.status_label || value.statusLabel || value.level_label || value.levelLabel),
    status_value: stringValue(value.status_value || value.statusValue || value.value),
    caption: stringValue(value.caption || value.score_caption || value.scoreCaption),
    ratio_label: stringValue(value.ratio_label || value.ratioLabel || value.scale_label || value.scaleLabel),
    ratio_value: stringValue(value.ratio_value || value.ratioValue || value.percent_value || value.percentValue),
    current_label: stringValue(value.current_label || value.currentLabel),
    current_value: stringValue(value.current_value || value.currentValue),
    supply_label: stringValue(value.supply_label || value.supplyLabel || value.potential_supply_label || value.potentialSupplyLabel),
    supply_value: stringValue(value.supply_value || value.supplyValue || value.potential_supply_value || value.potentialSupplyValue),
    total_note: normalizedTotalNote,
    note: nullableString(value.note || value.footnote),
    unavailable_rows: unavailableRows,
    segments,
  };

  const hasContent =
    [
      normalized.status_label,
      normalized.status_value,
      normalized.ratio_label,
      normalized.ratio_value,
      normalized.current_value,
      normalized.supply_value,
    ].some(Boolean) ||
    unavailableRows.length > 0 ||
    Boolean(normalizedTotalNote && Object.values(normalizedTotalNote).some(Boolean)) ||
    segments.length > 0;
  return hasContent ? normalized : null;
}

function hasShareOverhangContent(value: Record<string, unknown> | null) {
  if (!value) return false;
  if (arrayValue(value.segments).length) return true;
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

function normalizeSnapshotMetrics(value: unknown) {
  return arrayValue(value)
    .map((row) => {
      const record = readRecord(row);
      const label = stringValue(record?.label);
      const metricValue = stringValue(record?.value);
      if (!label || !metricValue) return null;
      const tone = stringValue(record?.tone);
      return {
        label,
        value: metricValue,
        note: nullableString(record?.note),
        tone: ["danger", "neutral", "positive"].includes(tone) ? tone : "neutral",
        emphasis: record?.emphasis === true,
      };
    })
    .filter(Boolean);
}

function normalizeMixedOfferingComponents(value: unknown) {
  return arrayValue(value).map((row) => {
    const record = readRecord(row);
    return {
      role: stringValue(record?.role),
      label: stringValue(record?.label),
      value_text: nullableString(record?.value_text),
      numeric_value: numberValue(record?.numeric_value) ?? 0,
      unit: stringValue(record?.unit) || "shares",
      evidence: nullableString(record?.evidence),
    };
  });
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

const CANONICAL_SUPPLY_SEGMENT_LABELS: Record<string, string> = {
  resale_common_shares: "Resale shares",
  common_shares: "Common shares",
  new_common_shares: "New common shares",
  public_warrant_shares: "Public warrant shares",
  private_warrant_shares: "Private warrant shares",
  common_warrant_shares: "Common warrant shares",
  prefunded_warrant_shares: "Pre-funded warrant shares",
  placement_agent_warrant_shares: "Placement agent warrant shares",
  public_warrants: "Public warrants",
  private_warrants: "Private warrants",
  common_warrants: "Common warrants",
  prefunded_warrants: "Pre-funded warrants",
  placement_agent_warrants: "Placement agent warrants",
  pipe_shares: "PIPE shares",
  founder_shares: "Founder shares",
  sponsor_shares: "Sponsor shares",
  conversion_shares: "Conversion shares",
  convertible_notes: "Convertible notes",
  convertible_preferred_shares: "Convertible preferred shares",
  preferred_shares: "Preferred shares",
  rights_shares: "Rights shares",
  subscription_rights: "Subscription rights",
  units: "Units",
  other_securities: "Other securities",
};

function canonicalSupplySegmentLabel(record: Record<string, unknown>) {
  const rawLabel = stringValue(record.label);
  const explicitResaleLabel = rawLabel.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/^(?:resale shares|registered resale shares|resale common shares|selling holder shares)$/.test(explicitResaleLabel)) {
    return "Resale shares";
  }

  const explicitCode = stringValue(record.label_code || record.segment_type || record.security_type);
  const canonicalFromCode = CANONICAL_SUPPLY_SEGMENT_LABELS[explicitCode];
  if (canonicalFromCode) {
    return canonicalFromCode;
  }

  const instrumentType = stringValue(record.instrument_type);
  const securityRole = stringValue(record.security_role);
  const text = `${rawLabel} ${instrumentType} ${securityRole}`.toLowerCase();
  const hasInstrumentCount = Boolean(readRecord(record.instrument_count)?.value_text || readRecord(record.instrument_count)?.numeric_value);
  const hasUnderlyingShares = Boolean(readRecord(record.underlying_shares)?.value_text || readRecord(record.underlying_shares)?.numeric_value);

  if (/pre[-\s]?funded/.test(text) && /warrants?/.test(text) && hasUnderlyingShares) return "Pre-funded warrant shares";
  if (/pre[-\s]?funded/.test(text) && /warrants?/.test(text)) return "Pre-funded warrants";
  if (/placement agent|underwriter|agent warrant/.test(text) && hasUnderlyingShares) return "Placement agent warrant shares";
  if (/placement agent|underwriter|agent warrant/.test(text)) return "Placement agent warrants";
  if (/public warrants?/.test(text) && hasUnderlyingShares) return "Public warrant shares";
  if (/private warrants?/.test(text) && hasUnderlyingShares && !hasInstrumentCount) return "Private warrant shares";
  if (/private warrants?/.test(text) && hasInstrumentCount && !hasUnderlyingShares) return "Private warrants";
  if (/private warrants?/.test(text) && hasInstrumentCount && hasUnderlyingShares) return "Private warrants";
  if (/common warrants?/.test(text) && hasUnderlyingShares) return "Common warrant shares";
  if (/common warrants?/.test(text)) return "Common warrants";
  if (/\bwarrants?\b/.test(text) && hasUnderlyingShares) return "Warrant shares";
  if (/\bwarrants?\b/.test(text)) return "Warrants";
  if (/\bpipe\b/.test(text)) return "PIPE shares";
  if (/founder/.test(text)) return "Founder shares";
  if (/sponsor/.test(text)) return "Sponsor shares";
  if (/conversion|convertible/.test(text) && /preferred/.test(text)) return "Convertible preferred shares";
  if (/conversion|convertible/.test(text) && /notes?|debt|principal/.test(text)) return "Convertible notes";
  if (/conversion|convertible/.test(text)) return "Conversion shares";
  if (/preferred/.test(text)) return "Preferred shares";
  if (/rights?|subscription/.test(text) && /shares?/.test(text)) return "Rights shares";
  if (/rights?|subscription/.test(text)) return "Subscription rights";
  if (/units?/.test(text)) return "Units";
  if (/resale|selling stockholders?|selling securityholders?/.test(text)) return "Resale shares";
  if (/new common|primary/.test(text)) return "New common shares";
  if (/common stock|common shares?/.test(text)) return "Common shares";

  const compactLabel = rawLabel
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (compactLabel && compactLabel.length <= 40) {
    return compactLabel;
  }

  return instrumentType ? toTitleLabel(instrumentType) : "Other securities";
}

function toTitleLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeSupplySegments(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const record = readRecord(item);
          if (!record) return null;
          return {
            label: canonicalSupplySegmentLabel(record),
            source_label: nullableString(record.label),
            label_code: nullableString(record.label_code || record.segment_type || record.security_type),
            instrument_type: stringValue(record.instrument_type) || "other",
            shares: normalizeDisplayFact(readRecord(record.shares), "shares"),
            price: normalizeDisplayFact(readRecord(record.price), "usd_per_share"),
            instrument_count: normalizeDisplayFact(readRecord(record.instrument_count), "securities"),
            underlying_shares: normalizeDisplayFact(readRecord(record.underlying_shares), "shares"),
            exercise_price: normalizeDisplayFact(readRecord(record.exercise_price), "usd_per_share"),
            market_price: normalizeDisplayFact(readRecord(record.market_price), "usd_per_warrant"),
            security_role: nullableString(record.security_role),
            calculation_basis: nullableString(record.calculation_basis),
            overlap_notes: readStringArray(record.overlap_notes),
            timing_or_condition: nullableString(record.timing_or_condition),
            evidence: nullableString(record.evidence),
          };
        })
        .filter(Boolean)
    : [];
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
          const detailValue = stringValue(record.value);
          const note = stringValue(record.note);
          return label && detailValue ? { label, value: detailValue, ...(note ? { note } : {}) } : null;
        })
        .filter(Boolean)
    : [];
}

function normalizeWarrantDetails(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const record = readRecord(item);
          if (!record) return null;
          const label = stringValue(record.label);
          const detailValue = stringValue(record.value);
          return label && detailValue ? { label, value: detailValue } : null;
        })
        .filter(Boolean)
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
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
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
  const ticker = nullableString(record?.ticker) || nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const exchange = nullableString(record?.exchange) || nullableString(packagePrimary?.exchange);
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

function hasDisplayFactValue(value: Record<string, unknown> | null) {
  return Boolean(stringValue(value?.value_text) || (numberValue(value?.numeric_value) || 0) > 0);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const sec424bRequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
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
        "signal",
        "quick_take",
        "summary",
        "why_it_matters",
        "bullish_points",
        "bearish_points",
        "key_evidence",
        "what_to_watch_next",
        "related_tickers",
        "calendar_items",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: { type: "string", enum: APPROVED_424B_EVENT_TYPES },
        event_title: { type: "string" },
        primary_ticker: {
          type: "object",
          additionalProperties: true,
          required: ["ticker", "exchange"],
          properties: {
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
          },
        },
        tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        analysis_action: { type: ["string", "null"] },
        archive_summary: { type: ["string", "null"] },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data", "evidence", "notes"],
      properties: {
        display_type: {
          type: "string",
          enum: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        display_version: { type: "string" },
        data: {
          type: "object",
          additionalProperties: true,
          required: [
            "display_mode",
            "snapshot_metrics",
            "share_overhang",
            "investor_takeaway",
            "narrative_summary",
            "needs_human_review",
          ],
          properties: {
            display_mode: { type: ["string", "null"] },
            risk_label: { type: ["string", "null"] },
            current_shares: displayFactSchema(),
            total_potential_supply: displayFactSchema(),
            ads_equivalence: {
              type: "object",
              additionalProperties: true,
              properties: {
                ads_offered: displayFactSchema(),
                ordinary_shares_represented: displayFactSchema(),
                ordinary_shares_per_ads: displayFactSchema(),
                calculation_basis: { type: ["string", "null"] },
              },
            },
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
                  tone: { type: ["string", "null"], enum: ["danger", "neutral", "positive", null] },
                  emphasis: { type: "boolean" },
                },
              },
            },
            share_overhang: {
              type: "object",
              additionalProperties: true,
              required: [
                "chart_title",
                "subtitle",
                "status_label",
                "status_value",
                "caption",
                "ratio_label",
                "ratio_value",
                "current_label",
                "current_value",
                "supply_label",
                "supply_value",
                "segments",
              ],
              properties: {
                chart_title: { type: "string" },
                subtitle: { type: "string" },
                status_label: { type: "string" },
                status_value: { type: "string" },
                caption: { type: "string" },
                ratio_label: { type: "string" },
                ratio_value: { type: "string" },
                current_label: { type: "string" },
                current_value: { type: "string" },
                supply_label: { type: "string" },
                supply_value: { type: "string" },
                segments: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                    required: ["class_name", "label", "value", "width_percent"],
                    properties: {
                      class_name: { type: "string" },
                      label: { type: "string" },
                      value: { type: "string" },
                      width_percent: { type: "number" },
                      note: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
            key_cash_terms: {
              type: "object",
              additionalProperties: true,
              properties: {
                resale_proceeds_to_company: keyCashTermFactSchema(),
                issuer_primary_or_closing_cash: keyCashTermFactSchema(),
                conditional_warrant_cash: keyCashTermFactSchema(),
                prefunded_warrant_exercise_cash: keyCashTermFactSchema(),
                common_warrant_cash_exercise_proceeds: keyCashTermFactSchema(),
                private_placement_proceeds: keyCashTermFactSchema(),
                sec_registration_value: keyCashTermFactSchema(),
                explanation: { type: "string" },
              },
            },
            registered_security_totals: looseObjectSchema(),
            supply_segments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: ["string", "null"] },
                  label_code: { type: ["string", "null"] },
                  instrument_type: { type: ["string", "null"] },
                  shares: displayFactSchema(),
                  instrument_count: displayFactSchema(),
                  underlying_shares: displayFactSchema(),
                },
              },
            },
            investor_takeaway: { type: "string" },
            offering_details: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: "string" },
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
                  note: { type: "string" },
                },
              },
            },
            warrant_details: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
              },
            },
            narrative_summary: { type: "string" },
            watch_items: { type: "array", items: { type: "string" } },
            source_notes: { type: "array", items: { type: "string" } },
            review_reasons: { type: "array", items: { type: "string" } },
            needs_human_review: { type: "boolean" },
          },
        },
        evidence: { type: "array", items: { type: "object", additionalProperties: true } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
  },
};

function looseObjectSchema() {
  return {
    type: "object",
    additionalProperties: true,
  };
}

function displayFactSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["value_text", "numeric_value", "unit", "evidence"],
    properties: {
      value_text: { type: ["string", "null"] },
      numeric_value: { type: "number" },
      unit: { type: "string" },
      evidence: { type: ["string", "null"] },
    },
  };
}

function keyCashTermFactSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["value_text"],
    properties: {
      value_text: { type: "string" },
    },
  };
}
