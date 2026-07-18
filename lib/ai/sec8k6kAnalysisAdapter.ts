import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSec8k6kAnalysisPromptDraft,
  buildSec8k6kDisplayPayload,
  buildSec8k6kRouterPromptDraft,
} from "@/lib/sources/sec/forms/8k-6k/adapter";
import {
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_KEYS,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  sec8k6kAmendmentDeltaSchema,
  getSec8k6kSpecializedRuntimeResponseSchema,
  resolveSec8k6kAnalysisPromptFamily,
  sec8k6kAnalysisDisplayPayloadSchema,
  sec8k6kScoreExplanationSchema,
  sec8k6kSecurityInventorySchema,
  isSec8k6kAnalysisPromptKey,
} from "@/lib/sources/sec/forms/8k-6k/analysisPrompt";
import {
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/8k-6k/routerPrompt";
import { SEC_8K_6K_APPROVED_EVENT_TYPES } from "@/lib/sources/sec/forms/8k-6k/types";

export {
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_KEYS,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  isSec8k6kAnalysisPromptKey,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
};

export type Sec8k6kAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export type Sec8k6kValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type Sec8k6kValidationRepairPlan = {
  prompt: {
    key: string;
    version: string;
    system: string;
    user: string;
    responseFormat: {
      json_schema: Record<string, unknown>;
    };
  };
  issues: Sec8k6kValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export const SEC_8K_6K_VALIDATION_REPAIR_PROMPT_KEY = "sec_8k_6k_validation_repair";
export const SEC_8K_6K_VALIDATION_REPAIR_PROMPT_VERSION = "v6-source-backed-regression-guards";

export function isSec8k6kFilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec8k6kParserOutput(input);
  return Boolean(parserOutput && parserOutput.isSupported !== false);
}

export function buildSec8k6kRouterPromptForInput(input: SecFilingAnalysisInput) {
  const promptInput = buildSec8k6kPromptInput(input);
  return buildSec8k6kRouterPromptDraft(promptInput);
}

export function buildSec8k6kAnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
) {
  const promptInput = buildSec8k6kPromptInput(input);
  const promptFamily = resolveSec8k6kAnalysisPromptFamily(routerResult);
  const runtimeResponseSchema =
    getSec8k6kSpecializedRuntimeResponseSchema(promptFamily) || sec8k6kRuntimeAnalysisResponseSchema;
  const prompt = buildSec8k6kAnalysisPromptDraft({
    ...promptInput,
    router_result: routerResult,
    market_context: readMarketContext(input),
  });
  return {
    ...prompt,
    system: [
      prompt.system,
      "Runtime integration note: for analysis_prompt_family=capital_financing, strategic_transaction, governance_vote, or operating_legal_routine, return the LLM-authored display_payload required by the response schema. For every other family, integration preserves the supplied parser-built display payload and you should omit display_payload from the response.",
      "Runtime routing note: router_result.event_type, primary_route_candidate, and route_candidates are candidate routes only. Make the final event and materiality interpretation from all original cleaned_source_blocks in the analysis source bundle.",
      "Runtime scoring note: when router_result.analysis_needed is true, router_result.score is only an archive-gate placeholder. Assign analysis_output.score from the complete cleaned_source_blocks bundle, score policy, urgency, and evidence instead of copying the router placeholder.",
    ].join("\n"),
    responseFormat: {
      json_schema: {
        name: "sec_8k_6k_runtime_analysis",
        strict: true,
        schema: runtimeResponseSchema,
      },
    },
  };
}

export function buildSec8k6kPreviewDebug(input: {
  routerResult: Record<string, unknown>;
  routerPromptUser?: unknown;
  analysisPromptUser?: unknown;
  analysisSkipped?: boolean;
}) {
  const routerPayload = parsePromptUser(input.routerPromptUser);
  const analysisPayload = parsePromptUser(input.analysisPromptUser);
  const sourcePayload = analysisPayload || routerPayload || {};
  const sourceBlocks = readRecordArray(sourcePayload.cleaned_source_blocks);
  const manifest = readRecordArray(sourcePayload.source_block_manifest);
  const analysisBundle = readRecord(analysisPayload?.analysis_source_bundle);
  const analysisIncludedIds = uniqueStrings(readStringArray(analysisBundle?.included_source_block_ids));
  const selectedIds = analysisIncludedIds.length
    ? analysisIncludedIds
    : input.analysisSkipped
      ? sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean)
      : [];
  const selectedSummaries = summarizeSelectedSourceBlocks(sourceBlocks, manifest, selectedIds);
  const relatedFilingIds = sourceBlocks
    .filter((block) => {
      const blockType = stringValue(block.block_type);
      return blockType === "related_filing_context" || blockType === "related_filing_source_block";
    })
    .map((block) => stringValue(block.block_id))
    .filter(Boolean);
  const relatedFilingSummaries = summarizeSelectedSourceBlocks(
    sourceBlocks,
    manifest,
    relatedFilingIds,
  );
  const includedIdSet = new Set(selectedIds);
  const includedTextChars = sourceBlocks.reduce((sum, block) => {
    const blockId = stringValue(block.block_id);
    return includedIdSet.has(blockId) ? sum + stringValue(block.text).length : sum;
  }, 0);
  const primaryRouteCandidate = readRecord(input.routerResult.primary_route_candidate);
  const routeCandidates = readRecordArray(input.routerResult.route_candidates).slice(0, 8).map((candidate) => ({
    route_type: stringValue(candidate.route_type),
    priority: stringValue(candidate.priority),
    confidence: stringValue(candidate.confidence),
    reason: stringValue(candidate.reason) || null,
  }));
  const sourceSelection = {
    selection_source: stringValue(analysisBundle?.selection_source) || (input.analysisSkipped ? "archive_router_selection" : null),
    included_source_block_ids: selectedIds,
    included_source_refs: [
      ...readStringArray(analysisBundle?.included_source_refs),
      ...readStringArray(analysisBundle?.selected_source_refs),
    ],
    included_block_count: selectedIds.length,
    approximate_included_text_chars: includedTextChars,
    approximate_included_tokens: Math.ceil(includedTextChars / 4),
    warnings: readStringArray(analysisBundle?.warnings),
  };

  return {
    router_result: {
      event_type: stringValue(input.routerResult.event_type),
      route_case: stringValue(input.routerResult.route_case) || null,
      display_type: stringValue(input.routerResult.display_type) || null,
      display_version: stringValue(input.routerResult.display_version) || null,
      score: numberValue(input.routerResult.score),
      delivery_level: stringValue(input.routerResult.delivery_level),
      confidence: stringValue(input.routerResult.confidence),
      filing_complexity: stringValue(input.routerResult.filing_complexity),
      analysis_needed: input.routerResult.analysis_needed === true,
      archive_like_candidate: input.routerResult.archive_like_candidate === true,
      deterministic_possible: input.routerResult.deterministic_possible === true,
      low_signal_reason: nullableString(input.routerResult.low_signal_reason),
      archive_safety_blocked: input.routerResult.archive_safety_blocked === true,
      archive_safety_warnings: readStringArray(input.routerResult.archive_safety_warnings),
      needs_parent_context: input.routerResult.needs_parent_context === true,
      market_context_needed: input.routerResult.market_context_needed === true,
      routing_reason: nullableString(input.routerResult.routing_reason),
      primary_route_candidate: primaryRouteCandidate
        ? {
            route_type: stringValue(primaryRouteCandidate.route_type),
            priority: stringValue(primaryRouteCandidate.priority),
            confidence: stringValue(primaryRouteCandidate.confidence),
            reason: stringValue(primaryRouteCandidate.reason) || null,
          }
        : null,
      route_candidates: routeCandidates,
    },
    analysis_source_blocks: selectedSummaries,
    related_filing_source_blocks: relatedFilingSummaries,
    analysis_source_bundle: {
      mode: stringValue(readRecord(sourcePayload.source_block_bundle)?.mode) || null,
      total_available_blocks: numberValue(readRecord(sourcePayload.source_block_bundle)?.total_available_blocks),
      returned_blocks: numberValue(readRecord(sourcePayload.source_block_bundle)?.returned_blocks),
      ...sourceSelection,
      analysis_prompt_available: Boolean(analysisPayload),
      analysis_received_all_original_blocks: Boolean(
        analysisPayload &&
          numberValue(readRecord(sourcePayload.source_block_bundle)?.returned_blocks) ===
            numberValue(readRecord(sourcePayload.source_block_bundle)?.total_available_blocks),
      ),
      related_filing_block_count: relatedFilingSummaries.length,
      analysis_received_related_filing_blocks: Boolean(analysisPayload && relatedFilingSummaries.length),
    },
    archive_or_deterministic_path: input.analysisSkipped
      ? {
          analysis_needed: false,
          archive_like_candidate: input.routerResult.archive_like_candidate === true,
          deterministic_possible: input.routerResult.deterministic_possible === true,
          low_signal_reason: nullableString(input.routerResult.low_signal_reason),
          selected_evidence_summary: selectedSummaries.slice(0, 8).map((block) => ({
            block_id: block.block_id,
            source_ref: block.source_ref,
            origin: block.origin,
            preview: block.preview,
          })),
          has_primary_material_route_candidate: readRecordArray(input.routerResult.route_candidates).some(
            (candidate) => stringValue(candidate.priority) === "primary" && normalizeEventType(stringValue(candidate.route_type)) !== "other",
          ),
          parent_context_required: input.routerResult.needs_parent_context === true,
          market_context_required: input.routerResult.market_context_needed === true,
        }
      : null,
  };
}

export function shouldRunSec8k6kAnalysis(routerResult: Record<string, unknown>) {
  if (routerResult.analysis_needed === true) return true;
  const score = numberValue(routerResult.score);
  return score !== null && score >= 50;
}

const SEC_8K_6K_ARCHIVE_BLOCKING_SOURCE_WARNINGS = new Set([
  "no_filing_text_available",
  "item_section_body_too_short",
  "document_fetch_error_present",
  "document_text_truncated",
  "important_attachment_text_not_extracted",
  "important_attachment_text_empty",
  "important_attachment_omitted_due_to_limit",
  "image_heavy_package_text_may_be_incomplete",
  "potentially_material_non_text_document_present",
  "possible_material_binary_or_pdf_exhibit_without_text",
  "table_document_text_truncated",
  "table_like_content_low_extraction",
  "six_k_wrapper_without_meaningful_exhibit",
  "six_k_meaningful_exhibit_non_text",
  "exhibit_reference_document_match_failed",
]);

export function applySec8k6kArchiveSafetyGate(
  routerResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
) {
  const parserOutput = readSec8k6kParserOutput(input);
  if (shouldRunSec8k6kAnalysis(routerResult) || !parserOutput) return routerResult;

  const blockingWarnings = readStringArray(parserOutput.warnings).filter((warning) =>
    SEC_8K_6K_ARCHIVE_BLOCKING_SOURCE_WARNINGS.has(warning),
  );
  const parserFacts = readRecord(parserOutput.facts);
  const substantiveCueTypes = readRecordArray(parserFacts?.filingCues)
    .map((cue) => stringValue(cue.cueType))
    .filter((cueType) => cueType && !["routine_administrative_amendment", "uncategorized_text"].includes(cueType));
  const primaryCandidate = readRecord(routerResult.primary_route_candidate);
  const routerConfidence = stringValue(primaryCandidate?.confidence || routerResult.confidence).toLowerCase();
  const lowConfidenceArchive = routerConfidence === "low";

  const safetyReasons = [
    ...blockingWarnings.map((warning) => `source_warning:${warning}`),
    ...substantiveCueTypes.map((cueType) => `substantive_parser_cue:${cueType}`),
    ...(lowConfidenceArchive ? ["low_confidence_router_archive"] : []),
  ];
  if (!safetyReasons.length) return routerResult;

  return {
    ...routerResult,
    score: 50,
    delivery_level: "feed",
    analysis_needed: true,
    archive_safety_blocked: true,
    archive_safety_warnings: blockingWarnings,
    archive_safety_reasons: safetyReasons,
    router_score_normalized_by_integration: true,
  };
}

export function applySec8k6kReverseSplitRouteGuard(
  routerResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
  routerPromptUser?: unknown,
) {
  const promptPayload = parsePromptUser(routerPromptUser) ||
    parsePromptUser(buildSec8k6kRouterPromptForInput(input).user);
  const currentFiling = readRecord(promptPayload?.current_filing) || {};
  const formType = stringValue(currentFiling.form_type);
  if (currentFiling.is_amendment === true || /\/A$/i.test(formType)) return routerResult;

  const digestText = JSON.stringify(promptPayload?.router_digest || {});
  if (!hasCurrentReverseSplitAction(digestText)) return routerResult;

  const listingPressure = /\b(?:nasdaq|nyse|minimum bid|continued listing|listing compliance|delisting)\b/i.test(digestText);
  const primaryCandidate = {
    route_type: "dilution_risk",
    priority: "primary",
    confidence: "high",
    reason: "The current filing announces, approves, or implements a reverse stock split, which is a capital-structure action.",
  };
  const preservedCandidates = normalizeRouteCandidates(routerResult.route_candidates)
    .filter((candidate) => candidate.route_type !== "dilution_risk" && candidate.route_type !== "listing_risk")
    .map((candidate) => ({ ...candidate, priority: candidate.priority === "primary" ? "secondary" : candidate.priority }));
  const routeCandidates = [
    primaryCandidate,
    ...(listingPressure
      ? [{
          route_type: "listing_risk",
          priority: "secondary" as const,
          confidence: "high" as const,
          reason: "The filing links the reverse split to exchange-listing or minimum-bid pressure.",
        }]
      : []),
    ...preservedCandidates,
  ];

  return {
    ...routerResult,
    event_type: "dilution_risk",
    route_case: "dilution_or_offering",
    score: 50,
    delivery_level: "feed",
    display_type: "capital_financing",
    display_version: "sec_8k_6k_capital_financing_v1",
    analysis_needed: true,
    archive_like_candidate: false,
    deterministic_possible: false,
    low_signal_reason: null,
    primary_route_candidate: primaryCandidate,
    route_candidates: routeCandidates,
    routing_reason: primaryCandidate.reason,
    router_reverse_split_guard_applied: true,
    router_score_normalized_by_integration: true,
  };
}

function hasCurrentReverseSplitAction(value: string) {
  const splitPattern = /\breverse(?:\s+stock)?\s+split\b/i;
  if (!splitPattern.test(value)) return false;
  const actionPattern = /\b(?:announc(?:e|ed|es|ing)|approv(?:e|ed|es|ing)|authoriz(?:e|ed|es|ing)|effect(?:ed|ive|ing)?|implement(?:ed|s|ing)?|complet(?:e|ed|es|ing)|determin(?:e|ed|es|ing)|will\s+(?:effect|implement)|\d+\s*[- ]for[- ]\s*\d+)\b/i;
  for (const match of value.matchAll(new RegExp(splitPattern.source, "gi"))) {
    const index = match.index || 0;
    const context = value.slice(Math.max(0, index - 360), Math.min(value.length, index + 520));
    if (actionPattern.test(context)) return true;
  }
  return false;
}

export function normalizeSec8k6kRouterResult(value: Record<string, unknown>) {
  const score = numberValue(value.score);
  const routeCandidates = normalizeRouteCandidates(value.route_candidates);
  const primaryRouteCandidate =
    normalizeRouteCandidate(readRecord(value.primary_route_candidate)) ||
    routeCandidates.find((candidate) => candidate.priority === "primary") ||
    routeCandidates[0] ||
    normalizeRouteCandidate({ route_type: value.event_type, priority: "primary", confidence: value.confidence, reason: value.routing_reason });
  const hasPhase2RouterFields =
    Array.isArray(value.route_candidates) ||
    value.archive_like_candidate === true ||
    value.deterministic_possible === true;
  const needsParentContext = value.needs_parent_context === true || value.parent_context_needed === true;
  const marketContextNeeded = value.market_context_needed === true;
  const archiveLikeCandidate = value.archive_like_candidate === true;
  const deterministicPossible = value.deterministic_possible === true;
  const requestedAnalysisNeeded = value.analysis_needed === true || (score !== null && score >= 50);
  const archiveAllowed =
    !requestedAnalysisNeeded &&
    (!hasPhase2RouterFields ||
      ((archiveLikeCandidate || deterministicPossible) &&
        readStringArray(value.evidence).length > 0 &&
        !needsParentContext &&
        !marketContextNeeded &&
        !hasPrimaryMaterialRouteCandidate(routeCandidates)));
  const analysisNeeded = requestedAnalysisNeeded || !archiveAllowed;
  const normalizedScore = analysisNeeded ? 50 : Math.min(49, Math.max(0, Math.round(score ?? 0)));
  const displayType = normalizeRouterDisplayType(value.display_type);

  const {
    selected_source_block_ids: _selectedSourceBlockIds,
    selected_source_blocks_by_route: _selectedSourceBlocksByRoute,
    source_blocks_used: _sourceBlocksUsed,
    ...routeValue
  } = value;

  return {
    ...routeValue,
    debug: {
      parser_version: null,
      router_prompt_key: SEC_8K_6K_ROUTER_PROMPT_KEY,
      router_prompt_version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
    },
    event_type: normalizeEventType(stringValue(value.event_type) || primaryRouteCandidate?.route_type || ""),
    route_candidates: routeCandidates,
    primary_route_candidate: primaryRouteCandidate,
    filing_complexity: normalizeFilingComplexity(value.filing_complexity),
    archive_like_candidate: archiveLikeCandidate,
    deterministic_possible: deterministicPossible,
    low_signal_reason: nullableString(value.low_signal_reason),
    needs_parent_context: needsParentContext,
    parent_context_needed: needsParentContext,
    market_context_needed: marketContextNeeded,
    routing_reason: stringValue(value.routing_reason) || primaryRouteCandidate?.reason || stringValue(value.reason),
    score: normalizedScore,
    delivery_level: analysisNeeded ? "feed" : "archive",
    analysis_needed: analysisNeeded,
    display_type: displayType,
    display_version: normalizeRouterDisplayVersion(value.display_version, displayType),
    router_score_normalized_by_integration: score !== normalizedScore || value.delivery_level === "alert",
  };
}

function normalizeRouteCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeRouteCandidate(readRecord(item)))
    .filter((item): item is NonNullable<ReturnType<typeof normalizeRouteCandidate>> => Boolean(item));
}

function normalizeRouteCandidate(value: Record<string, unknown> | null) {
  if (!value) return null;
  const routeType = normalizeEventType(stringValue(value.route_type) || stringValue(value.event_type));
  const priority = normalizeRoutePriority(value.priority);
  const confidence = normalizeConfidence(stringValue(value.confidence));
  const reason = stringValue(value.reason) || stringValue(value.routing_reason);
  return {
    route_type: routeType,
    priority,
    confidence,
    reason,
  };
}

export function buildSec8k6kValidationRepairPlan(input: {
  analysisResult: Record<string, unknown>;
  analysisPromptUser: unknown;
  additionalSourceBlocks?: () => Record<string, unknown>[];
}): Sec8k6kValidationRepairPlan | null {
  const promptPayload = parsePromptUser(input.analysisPromptUser);
  const sourceBlocks = readRecordArray(promptPayload?.cleaned_source_blocks);
  const issues = [
    ...getSec8k6kValidationRepairIssues(input.analysisResult, promptPayload, sourceBlocks),
    ...getSec8k6kSourceConsistencyRepairIssues(input.analysisResult, sourceBlocks),
  ];
  if (!issues.length) return null;

  const additionalSourceBlocks = input.additionalSourceBlocks?.() || [];
  const repairSourceBlocks = dedupeValidationRepairSourceBlocks([...sourceBlocks, ...additionalSourceBlocks]);
  const selectedSourceBlocks = selectValidationRepairSourceBlocks(input.analysisResult, repairSourceBlocks, issues);
  if (!selectedSourceBlocks.length) return null;

  const sourceBlockIds = selectedSourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const allowedPatchPaths = uniqueStrings(issues.flatMap((issue) => issue.allowed_patch_paths));
  const selectedSourceBlockIdSet = new Set(sourceBlockIds);
  const issuesWithSources = issues.map((issue) => {
    const issueSourceIds = issue.candidate_source_block_ids.filter((id) => selectedSourceBlockIdSet.has(id));
    return {
      ...issue,
      candidate_source_block_ids: issueSourceIds.length ? issueSourceIds : sourceBlockIds,
    };
  });
  const scoreRationaleOnlyRepair = issuesWithSources.every(
    (issue) => issue.code === "score_rationale_meta_language" || issue.code === "score_rationale_filing_recap",
  );
  const responseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["patches", "unresolved_warning_codes"],
    properties: {
      patches: {
        type: "array",
        maxItems: allowedPatchPaths.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "value", "reason", "source_block_ids"],
          properties: {
            path: { type: "string", enum: allowedPatchPaths },
            value: { type: ["string", "null"], maxLength: 4000 },
            reason: { type: "string", maxLength: 180 },
            source_block_ids: {
              type: "array",
              maxItems: 3,
              items: { type: "string", enum: sourceBlockIds },
            },
          },
        },
      },
      unresolved_warning_codes: {
        type: "array",
        maxItems: issues.length,
        items: { type: "string", enum: issues.map((issue) => issue.code) },
      },
    },
  } as const;

  return {
    prompt: {
      key: SEC_8K_6K_VALIDATION_REPAIR_PROMPT_KEY,
      version: SEC_8K_6K_VALIDATION_REPAIR_PROMPT_VERSION,
      system: (scoreRationaleOnlyRepair ? [
        "Repair only the validator-identified score rationale fields in an existing SEC 8-K/6-K analysis.",
        "This is one bounded repair pass, not a new analysis. Return JSON patches only and do not change any unlisted path.",
        "The warning is not evidence. Use the supplied original source blocks only to preserve the correct investor consequence and material offset.",
        "Write each replacement as a 12-24 word analyst bottom line explaining the practical scoring principle, not the filing facts or transaction mechanics.",
        "Begin with the investor consequence or economic principle. Never begin with The offering, The financing, The transaction, The company, an issuer name, The score, or This score.",
        "Do not repeat exact share counts, security counts, prices, proceeds, dates, issuer names, or terms already visible in the snapshot and details.",
        "Use at most two controlling drivers and one material offset when it changes the investor reading. Do not mention a score, rating, impact band, or delivery level.",
        "If the sources do not support a replacement, return no patch and list the warning code in unresolved_warning_codes. Every patch must cite a supplied source block.",
      ] : [
        "Repair only the validator-identified fields in an existing SEC 8-K/6-K analysis.",
        "This is one bounded repair pass, not a new analysis. Return JSON patches only.",
        "The warning identifies a possible problem but is not evidence. Use only the supplied original source blocks as factual authority.",
        "Do not change any path that is not explicitly allowed. Do not rewrite unrelated fields, scores, classifications, titles, or UI structure.",
        "Preserve procedural state exactly: approved, conditionally approved, engaged, effective, dismissed, and completed are not interchangeable.",
        "Preserve financial meaning exactly: counted, conditional, alternative, fixed, variable, current period, prior-year period, and prior-quarter period are not interchangeable.",
        "When repairing a calculation or comparison, keep the existing source-backed units and denominator and change only the validator-identified field.",
        "For operating comparisons, the current and comparison values must use the same metric, unit, and period scope. A quarter, half year, year-to-date period, nine-month period, and full year are not interchangeable.",
        "Use only enum values from the existing analysis schema. In particular, operating_mode must be earnings or operating_update for performance output, and comparison_basis must be yoy, qoq, or other.",
        "For operating_nonfinancial_performance_misclassified_as_earnings, use exactly operating_update for analysis_output.event_type, the primary material event event_type, and display_payload.data.operating_mode; use Operating Snapshot for snapshot_title.",
        "For operating_regulatory_event_type_mismatch, keep product_or_regulatory and the source-backed regulatory_stage unchanged, but use fda_clinical for analysis_output.event_type and the primary material event event_type when regulatory_stage is not not_applicable. Use product_update only when regulatory_stage is not_applicable.",
        "For operating_project_economics_section_missing, create one Project Economics detail section and include every material source-backed project valuation, ownership, reserve/capacity, or long-term unit-economics fact supplied for repair. The warning names the required fact categories: return at least one separate rows item for every named category supported by the supplied blocks, and cite every block used for those rows. Preserve primary operating KPIs in the snapshot and do not duplicate project-economics facts elsewhere.",
        "A /display_payload/data/detail_sections collection patch value must be a JSON array of objects shaped exactly as [{\"title\":\"Project Economics\",\"rows\":[{\"label\":\"After-Tax NPV (8%)\",\"value\":\"$3.6 billion\",\"note\":null}]}]. Never use label or summary at the section level. Include a separate rows item for each material source-backed valuation, ownership, reserve/capacity, or unit-economics fact in the supplied repair blocks.",
        "For operating_project_economics_fact_duplication, keep each duplicated project-economics fact only in Project Economics. Remove it from snapshot_metrics, business_catalysts, or another detail section while preserving unrelated primary operating facts.",
        "For operating_secondary_material_event_missing, move any separate governance, capital, legal, or transaction detail section into one compact secondary_updates item. Remove that moved section from detail_sections and preserve only details that directly support the primary operating event.",
        "For operating_snapshot_sign_conflict, restore the source-backed negative sign using parentheses or a leading minus sign without changing the disclosed magnitude, unit, or period.",
        "For operating_earnings_alert_offset_missing, reassess score and signal from the full source-backed earnings mix. A GAAP/IFRS loss driven mainly by non-cash impairment, purchase accounting, tax effects, or another one-time item does not by itself support 75 or above. Keep 75 or above only when adjusted profitability, cash flow, guidance, demand, or another near-term driver also materially deteriorated; otherwise lower the score. When a large headline profit-to-loss inflection remains material but adjusted performance or growth provides a meaningful offset, normally use 65-74 rather than collapsing the event to a routine 40-54 score. State one material offset in each score rationale without repeating the filing recap.",
        "For operating_earnings_alert_noncash_gain_dominant, separate reported accounting income from recurring operating performance. A non-cash fair-value change, warrant-liability remeasurement, tax benefit, asset-sale gain, or another one-time accounting gain does not by itself support a bullish signal or score of 75 or above. Keep that direction and range only when adjusted profitability, cash flow, demand, guidance, or another recurring or near-term driver independently supports it. Otherwise lower the score and use neutral or volatile as appropriate. State the accounting driver in Summary and explain the operating-quality principle in both score rationales.",
        "For amendment_parent_comparison_required or amendment_delta_missing_or_invalid, compare the current amendment blocks with the supplied original filing or prior-amendment source blocks. Classify only the present delta. Use clerical_correction for an identifier, caption, date, name, typographical, formatting, or filing-description correction that leaves economic, legal, operational, voting, listing, and transaction substance unchanged. Use supplemental_update or material_change only for a source-backed new investor-relevant fact or changed term. Never repeat the unchanged parent event as the amendment's new event.",
        "For amendment_clerical_event_overstated, set change_kind to clerical_correction, unchanged_parent_event to true, and changed_fields to the corrected administrative fields. Use event_type other, neutral signal, score below 50, and amendment-only title, quick take, summary, and score rationale.",
        "For structured_snapshot_count_mismatch, return exactly four non-duplicative source-backed snapshot rows. Use four useful status, scope, amount, timing, party, condition, or next-stage facts. Never pad with an immaterial Not disclosed row. routine_archive remains empty.",
        "For risk_listing_suspension_date_misclassified_as_removal, preserve the source-backed date role exactly. A trading suspension date is not a delisting or removal effective date. Rewrite only the flagged fields to describe trading as suspended on that date, and mention a later Form 25 removal without assigning an effective date unless the source explicitly provides one.",
        "For capital_reverse_split_alert_policy, use event_type dilution_risk, a bearish signal, and a score of at least 75. Explain listing, price, or capital pressure and do not describe the proportional share consolidation itself as mechanical dilution.",
        "For capital_severe_dilution_alert_policy, apply the shared active-offering dilution bands to the fixed counted ratio already shown in Share Overhang. A ratio of 100% or more is severe: use dilution_risk, bearish, and a score of at least 84, then explain the supply pressure and any material funding offset without repeating the transaction terms.",
        "For capital_conditional_proceeds_snapshot, distinguish cash expected at closing from additional proceeds available only if warrants or another instrument are exercised. Do not present their sum as closed Gross Proceeds or an unconditional Offering Size. Keep both source-backed amounts in one compact row when needed and state the condition in the note.",
        "For governance_auditor_icfr_scope_misclassified_as_qualification, separate the financial-statement audit opinion from the scope of the internal-control audit. An auditor statement that it was not engaged to opine on ICFR is not an exception to, or qualification of, the financial-statement opinion.",
        "For key_evidence_count_exceeded, replace the complete key_evidence array with the strongest two or three non-duplicative source-backed proof points. Rank them by direct support for the central conclusion; do not simply keep the first three. Each item must be no more than 18 words.",
        "For score_rationale_meta_language, rewrite score_reason and score_explanation.summary as investor-impact conclusions. Do not mention a score, rating, impact band, alert/feed/archive level, or why a number was assigned.",
        "For score_rationale_filing_recap, rewrite only the flagged score rationale fields as a 12-24 word analyst bottom line. Explain the practical scoring principle through immediacy, economic scale, dilution mechanics, financing quality, balance-sheet effect, or another controlling investor consequence. Do not repeat exact share counts, prices, proceeds, dates, transaction mechanics, or facts already visible in the snapshot and details. Use at most two controlling drivers and one material offset when it changes the reading. Begin with the investor consequence or economic principle, such as Immediate equity supply, Large actionable overhang, or Severe liquidity pressure. Never begin with The offering, The financing, The transaction, The company, an issuer name, The score, or This score.",
        "Do not fix an incompatible-period comparison by relabeling a value. Replace the labels, displayed values, numeric values, comparison basis, and change note only when the supplied source blocks contain a complete comparable pair; otherwise leave it unresolved.",
        "For an allowed path ending in _numeric, return the replacement as a plain numeric string without units or thousands separators; the integration converts it to a JSON number.",
        "For an allowed snapshot_metrics, business_catalysts, detail_sections, secondary_updates, or key_evidence collection path, return the complete replacement array as a compact JSON string. Preserve valid existing items, remove only validator-identified duplication, and add only source-backed missing items.",
        "If the supplied source blocks do not establish a correction, return no patch for that warning and list its code in unresolved_warning_codes.",
        "Each patch must cite at least one supplied source block that supports the replacement value.",
      ]).join("\n"),
      user: JSON.stringify({
        validation_issues: issuesWithSources,
        allowed_patch_paths: allowedPatchPaths,
        current_analysis: input.analysisResult,
        original_source_blocks: selectedSourceBlocks.map((block) => ({
          block_id: stringValue(block.block_id),
          source_ref: nullableString(block.source_ref),
          origin: nullableString(block.origin),
          block_type: nullableString(block.block_type),
          item_number: nullableString(block.item_number),
          exhibit_number: nullableString(block.exhibit_number),
          document_type: nullableString(block.document_type),
          label: nullableString(block.label),
          text: stringValue(block.text),
        })),
      }),
      responseFormat: {
        json_schema: {
          name: "sec_8k_6k_validation_repair",
          strict: true,
          schema: responseSchema,
        },
      },
    },
    issues: issuesWithSources,
    allowedPatchPaths,
    sourceBlockIds,
  };
}

export function applySec8k6kValidationRepairPatches(input: {
  analysisResult: Record<string, unknown>;
  repairResult: Record<string, unknown>;
  allowedPatchPaths: string[];
}) {
  const cloned = JSON.parse(JSON.stringify(input.analysisResult)) as Record<string, unknown>;
  const allowed = new Set(input.allowedPatchPaths);
  const appliedPatchPaths: string[] = [];
  const ignoredPatchPaths: string[] = [];
  const normalizedPatches = readRecordArray(input.repairResult.patches).flatMap((patch) => {
    const path = stringValue(patch.path);
    const patchValue = normalizeValidationRepairPatchValue(path, patch.value);
    if (!allowed.has(path) || patchValue === undefined) {
      if (path) ignoredPatchPaths.push(path);
      return [];
    }
    return [{ path, value: patchValue }];
  });

  const currentData = readRecord(readRecord(cloned.display_payload)?.data) || {};
  const currentDetailSections = readRecordArray(currentData.detail_sections);
  const needsProjectEconomicsSection =
    allowed.has("/display_payload/data/snapshot_metrics") &&
    allowed.has("/display_payload/data/business_catalysts") &&
    allowed.has("/display_payload/data/detail_sections") &&
    !hasProjectEconomicsDetailSection(currentDetailSections);
  const detailSectionsPatch = normalizedPatches.find(
    (patch) => patch.path === "/display_payload/data/detail_sections",
  );
  const createsProjectEconomicsSection =
    Array.isArray(detailSectionsPatch?.value) &&
    hasProjectEconomicsDetailSection(readRecordArray(detailSectionsPatch.value));
  const blockedProjectCollectionPaths =
    needsProjectEconomicsSection && !createsProjectEconomicsSection
      ? new Set([
          "/display_payload/data/snapshot_metrics",
          "/display_payload/data/business_catalysts",
          "/display_payload/data/detail_sections",
        ])
      : new Set<string>();

  for (const patch of normalizedPatches) {
    if (blockedProjectCollectionPaths.has(patch.path)) {
      ignoredPatchPaths.push(patch.path);
      continue;
    }
    if (replaceJsonPointerValue(cloned, patch.path, patch.value)) appliedPatchPaths.push(patch.path);
    else ignoredPatchPaths.push(patch.path);
  }

  const rationaleFallbackPaths = applySec8k6kScoreRationaleFallbacks(cloned, appliedPatchPaths);

  return {
    analysisResult: cloned,
    appliedPatchPaths: uniqueStrings(appliedPatchPaths),
    ignoredPatchPaths: uniqueStrings(ignoredPatchPaths),
    rationaleFallbackPaths,
    unresolvedWarningCodes: readStringArray(input.repairResult.unresolved_warning_codes),
  };
}

function applySec8k6kScoreRationaleFallbacks(
  analysisResult: Record<string, unknown>,
  appliedPatchPaths: string[],
) {
  const analysisOutput = readRecord(analysisResult.analysis_output);
  if (!analysisOutput) return [];

  const scoreExplanation = readRecord(analysisOutput.score_explanation);
  const candidates = [
    {
      path: "/analysis_output/score_reason",
      value: stringValue(analysisOutput.score_reason),
    },
    {
      path: "/analysis_output/score_explanation/summary",
      value: stringValue(scoreExplanation?.summary),
    },
  ].filter((candidate) => appliedPatchPaths.includes(candidate.path));
  const invalidPaths = candidates
    .filter((candidate) => hasSec8k6kScoreRationaleMetaLanguage(candidate.value) || isSec8k6kScoreRationaleFilingRecap(candidate.value))
    .map((candidate) => candidate.path);
  if (!invalidPaths.length) return [];

  const fallback = buildSec8k6kScoreRationalePrincipleFallback(analysisResult, analysisOutput);
  return invalidPaths.filter((path) => replaceJsonPointerValue(analysisResult, path, fallback));
}

function buildSec8k6kScoreRationalePrincipleFallback(
  analysisResult: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
) {
  const eventType = stringValue(analysisOutput.event_type);
  const displayData = readRecord(readRecord(analysisResult.display_payload)?.data) || {};
  const capitalMode = stringValue(displayData.capital_mode);

  if (eventType === "dilution_risk") {
    if (capitalMode === "atm_capacity") {
      return "Large actionable sale capacity raises future dilution pressure, while actual impact still depends on issuance pace.";
    }
    if (capitalMode === "share_linked_financing") {
      return "Actionable share-linked supply creates material dilution risk, with financing liquidity providing only a partial offset.";
    }
    if (capitalMode === "capital_structure_action") {
      return "Expanded capital flexibility increases future shareholder exposure, while no immediate issuance limits the near-term effect.";
    }
    return "Immediate equity supply creates meaningful ownership dilution, while added liquidity provides a partial balance-sheet offset.";
  }
  if (eventType === "listing_risk") {
    return "Reduced exchange access materially weakens trading liquidity, while any remaining cure or appeal path limits immediate severity.";
  }
  if (eventType === "financial_risk") {
    return "Unresolved financial pressure raises near-term creditor and reporting risk, with disclosed liquidity support providing only a partial offset.";
  }
  if (eventType === "strategic_transaction") {
    return "Material value depends on closing certainty and consideration quality, while unresolved conditions preserve meaningful transaction risk.";
  }
  if (eventType === "earnings") {
    return "The controlling operating trend drives the investor impact, while the strongest opposing result tempers the directional conclusion.";
  }
  if (eventType === "fda_clinical") {
    return "Regulatory progress improves development certainty, while remaining review or execution steps preserve meaningful outcome risk.";
  }
  if (eventType === "leadership_governance" || eventType === "shareholder_vote") {
    return "Governance impact depends on control and execution consequences, while an orderly transition or approval path limits disruption.";
  }
  return "Immediate investor consequences determine the impact, while the strongest source-backed offset limits the directional conclusion.";
}

function normalizeRoutePriority(value: unknown): "primary" | "secondary" | "context" {
  const priority = stringValue(value);
  if (priority === "primary" || priority === "secondary") return priority;
  return "context";
}

function hasPrimaryMaterialRouteCandidate(routeCandidates: Array<NonNullable<ReturnType<typeof normalizeRouteCandidate>>>) {
  return routeCandidates.some((candidate) => candidate.priority === "primary" && candidate.route_type !== "other");
}

function normalizeFilingComplexity(value: unknown) {
  const text = stringValue(value);
  if (text === "simple" || text === "complex") return text;
  return "moderate";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(stringValue).filter(Boolean)));
}

export function buildSec8k6kArchiveAnalysis(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec8k6kAnalysisAdapterResult {
  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K parser output is missing from filing package",
    };
  }

  const filingPackage = readFilingPackage(input);
  const facts = readRecord(parserOutput.facts) || {};
  const primaryTicker = readPrimaryTicker(filingPackage, facts);
  const score = clampScore(numberValue(routerResult.score) ?? 0);
  const displayPayload = buildDisplayPayload(parserOutput, routerResult, readMarketContext(input));
  const archiveSummary = buildArchiveInvestorSummary(filingPackage, facts);
  const eventType = normalizeEventType(stringValue(routerResult.event_type));

  return {
    ok: true,
    analysis: normalize8k6kAnalysisForPersistence(
      {
        source_group: "filings",
        market_scope: "company",
        event_type: eventType,
        material_events: [
          {
            role: "primary",
            event_type: eventType,
            event_summary: archiveSummary,
            key_terms: [],
            source_block_ids: [],
          },
        ],
        event_title: buildArchiveEventTitle(filingPackage, facts, eventType),
        primary_ticker: primaryTicker,
        tickers: primaryTicker.ticker ? [primaryTicker.ticker] : [],
        sector: null,
        industry_group: null,
        theme_group: null,
        sub_theme: null,
        score,
        score_reason: "",
        signal: "neutral",
        quick_take: archiveSummary,
        summary: archiveSummary,
        why_it_matters: "",
        bullish_points: [],
        bearish_points: [],
        key_evidence: [],
        what_to_watch_next: [],
        related_tickers: [],
        calendar_items: [],
        security_inventory: [],
        confidence: normalizeConfidence(stringValue(routerResult.confidence)),
        needs_human_review: routerResult.needs_parent_context === true,
        archive_summary: archiveSummary,
        analysis_runtime_source: "router_archive",
        display_payload: displayPayload,
        sec_8k_6k_router_result: routerResult,
        sec_8k_6k_analysis_case: stringValue(routerResult.route_case) || null,
        source_blocks_used: readStringArray(routerResult.source_blocks_used),
        sec_8k_6k_prompt_metadata: buildSec8k6kPromptMetadata(input, routerResult),
      },
      input,
    ),
  };
}

export function adaptSec8k6kAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec8k6kAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return {
      ok: false,
      error: "SEC 8-K/6-K analysis response did not contain a JSON object",
    };
  }

  const analysisOutput = readRecord(root.analysis_output);
  if (!analysisOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K analysis response did not contain analysis_output",
    };
  }

  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K parser output is missing from filing package",
    };
  }

  const generatedDisplayPayload = buildDisplayPayload(parserOutput, routerResult, readMarketContext(input));
  const securityInventory = normalizeSecurityInventory(root.security_inventory);
  const initialDisplayPayload = repairSec8k6kDisplayPayloadEncoding(
    appendCapitalSecurityCoverageWarnings(
      normalizeSec8k6kOperatingDisplayPayloadForPersistence(
        normalizeSec8k6kCapitalDisplayPayloadForPersistence(
          selectDisplayPayloadForPersistence(readRecord(root.display_payload), generatedDisplayPayload),
        ),
      ),
      securityInventory,
    ),
  );
  const amendmentDelta = normalizeSec8k6kAmendmentDelta(root.amendment_delta, input);
  const reverseSplitPolicyOutput = applySec8k6kReverseSplitAnalysisPolicy(analysisOutput, initialDisplayPayload);
  const capitalDilutionPolicyOutput = applySec8k6kSevereDilutionAnalysisPolicy(
    reverseSplitPolicyOutput,
    initialDisplayPayload,
  );
  const amendmentPolicy = applySec8k6kAmendmentAnalysisPolicy(
    capitalDilutionPolicyOutput,
    initialDisplayPayload,
    amendmentDelta,
  );
  const policyAnalysisOutput = amendmentPolicy.analysisOutput;
  const displayPayload = appendSec8k6kValidationSemanticWarnings(
    amendmentPolicy.displayPayload,
    policyAnalysisOutput,
  );
  const score = clampScore(numberValue(policyAnalysisOutput.score) ?? numberValue(routerResult.score) ?? 0);
  const archiveSummary =
    nullableString(policyAnalysisOutput.archive_summary) ||
    (score < 50 ? nullableString(readRecord(displayPayload.data)?.archive_summary) || nullableString(policyAnalysisOutput.summary) : null);

  return {
    ok: true,
    analysis: normalize8k6kAnalysisForPersistence(
      {
        ...policyAnalysisOutput,
        security_inventory: securityInventory,
        event_type: normalizeEventType(stringValue(policyAnalysisOutput.event_type) || stringValue(routerResult.event_type)),
        score,
        archive_summary: archiveSummary,
        display_payload: displayPayload,
        sec_8k_6k_amendment_delta: amendmentDelta,
        sec_8k_6k_router_result: routerResult,
        sec_8k_6k_analysis_case: stringValue(root.analysis_case) || null,
        source_blocks_used: readStringArray(root.source_blocks_used),
        sec_8k_6k_prompt_metadata: buildSec8k6kPromptMetadata(input, routerResult),
      },
      input,
    ),
  };
}

function normalizeSec8k6kAmendmentDelta(value: unknown, input: SecFilingAnalysisInput) {
  const delta = readRecord(value) || {};
  const isAmendment = isSec8k6kAmendmentInput(input);
  if (!isAmendment) {
    return {
      is_amendment: false,
      change_kind: "not_amendment",
      changed_fields: [],
      unchanged_parent_event: false,
      investor_impact: null,
      parent_accession: null,
      source_block_ids: [],
    };
  }

  const changeKind = stringValue(delta.change_kind);
  return {
    is_amendment: true,
    change_kind: [
      "clerical_correction",
      "supplemental_update",
      "material_change",
      "unable_to_compare",
    ].includes(changeKind) ? changeKind : "unable_to_compare",
    changed_fields: readStringArray(delta.changed_fields).slice(0, 4),
    unchanged_parent_event: delta.unchanged_parent_event === true,
    investor_impact: nullableString(delta.investor_impact),
    parent_accession: nullableString(delta.parent_accession),
    source_block_ids: readStringArray(delta.source_block_ids).slice(0, 8),
  };
}

function applySec8k6kAmendmentAnalysisPolicy(
  analysisOutput: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
  amendmentDelta: Record<string, unknown>,
) {
  if (
    amendmentDelta.is_amendment !== true ||
    stringValue(amendmentDelta.change_kind) !== "clerical_correction"
  ) {
    return { analysisOutput, displayPayload };
  }

  const changedFields = readStringArray(amendmentDelta.changed_fields).slice(0, 4);
  const changedLabel = changedFields.length ? changedFields.join(", ") : "administrative filing information";
  const summary =
    nullableString(amendmentDelta.investor_impact) ||
    `The amendment corrects ${changedLabel} without changing the previously reported event or its investor economics.`;
  const originalTitle = stringValue(analysisOutput.event_title);
  const eventTitle = /\b(?:amend|correct|clerical|administrative|CUSIP)\b/i.test(originalTitle)
    ? originalTitle
    : "Filing amendment corrects administrative information";
  const sourceBlockIds = readStringArray(amendmentDelta.source_block_ids).slice(0, 8);
  const score = Math.min(35, clampScore(numberValue(analysisOutput.score) ?? 25));
  const scoreExplanation = {
    summary: "The correction changes filing information but leaves the previously reported investor event and its economics unchanged.",
  };
  const policyOutput = {
    ...analysisOutput,
    event_type: "other",
    material_events: [{
      role: "primary",
      event_type: "other",
      event_summary: summary,
      key_terms: changedFields,
      source_block_ids: sourceBlockIds,
    }],
    event_title: eventTitle,
    score,
    score_reason: scoreExplanation.summary,
    score_explanation: scoreExplanation,
    signal: "neutral",
    quick_take: summary,
    listing_status_snapshot: [],
    why_it_matters: "",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [],
    what_to_watch_next: [],
    summary,
    archive_summary: summary,
  };

  return {
    analysisOutput: policyOutput,
    displayPayload: {
      display_type: "generic",
      data: {
        display_version: "sec_8k_6k_generic_v1",
        archive_summary: summary,
        archive_reason: "Administrative amendment",
        amendment_change_kind: "clerical_correction",
        changed_fields: changedFields,
      },
      evidence: [],
      notes: [],
    },
  };
}

function isSec8k6kAmendmentInput(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readSec8k6kParserOutput(input);
  const facts = readRecord(parserOutput?.facts) || {};
  const formType = stringValue(filingPackage.form_type) || stringValue(facts.secFormType);
  return /^(?:8-K|6-K)\/A$/i.test(formType.replace(/\s+/g, ""));
}

function applySec8k6kReverseSplitAnalysisPolicy(
  analysisOutput: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (!isReverseSplitCapitalDisplay(displayPayload)) return analysisOutput;
  return {
    ...analysisOutput,
    event_type: "dilution_risk",
    score: Math.max(75, clampScore(numberValue(analysisOutput.score) ?? 0)),
    signal: "bearish",
  };
}

function isReverseSplitCapitalDisplay(displayPayload: Record<string, unknown>) {
  if (stringValue(displayPayload.display_type) !== "capital_financing") return false;
  const data = readRecord(displayPayload.data) || {};
  if (stringValue(data.capital_mode) !== "capital_structure_action") return false;
  const visibleText = JSON.stringify({
    snapshot_metrics: data.snapshot_metrics,
    detail_sections: data.detail_sections,
  });
  return /\breverse(?:\s+stock)?\s+split\b|\bsplit ratio\b|\b\d+\s*[- ]for[- ]\s*\d+\b/i.test(visibleText);
}

function normalizeSecurityInventory(value: unknown) {
  return readRecordArray(value)
    .map((item) => {
      const securityName = stringValue(item.security_name);
      const instrumentDetailsType = nullableString(item.instrument_details_type);
      const plainEquity = isPlainEquityInstrumentType(instrumentDetailsType || securityName);

      return {
        security_name: securityName,
        security_role: stringValue(item.security_role),
        display_target:
          plainEquity && stringValue(item.display_target) === "instrument_details"
            ? "share_overhang"
            : stringValue(item.display_target),
        source_block_id: stringValue(item.source_block_id),
        instrument_details_type: plainEquity ? null : instrumentDetailsType,
      };
    })
    .filter((item) => item.security_name);
}

function applySec8k6kSevereDilutionAnalysisPolicy(
  analysisOutput: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "capital_financing") return analysisOutput;
  const data = readRecord(displayPayload.data) || {};
  if (!["equity_issuance", "share_linked_financing"].includes(stringValue(data.capital_mode))) return analysisOutput;
  const shareOverhang = readRecord(data.share_overhang);
  const totalNote = readRecord(shareOverhang?.total_note || shareOverhang?.totalNote);
  const fixedRatio = capitalShareOverhangPercent(
    shareOverhang?.status_value || shareOverhang?.statusValue || totalNote?.ratio || totalNote?.ratio_value,
  );
  if (fixedRatio == null || fixedRatio < 100) return analysisOutput;
  return {
    ...analysisOutput,
    event_type: "dilution_risk",
    score: Math.max(84, clampScore(numberValue(analysisOutput.score) ?? 0)),
    signal: "bearish",
  };
}

export function normalizeSec8k6kCapitalDisplayPayloadForPersistence(displayPayload: Record<string, unknown>) {
  if (stringValue(displayPayload.display_type) !== "capital_financing") return displayPayload;

  const originalData = readRecord(displayPayload.data) || {};
  const normalizedShareOverhang = normalizeCapitalShareOverhangRatio(readRecord(originalData.share_overhang));
  let data = normalizedShareOverhang
    ? { ...originalData, share_overhang: normalizedShareOverhang }
    : originalData;
  const originalInstrumentDetails = readRecordArray(data.instrument_details);
  const instrumentDetailsWithoutPlainEquity = removePlainEquityInstrumentDetailGroups(originalInstrumentDetails);
  if (instrumentDetailsWithoutPlainEquity.length !== originalInstrumentDetails.length) {
    data = { ...data, instrument_details: instrumentDetailsWithoutPlainEquity };
  }
  const shareOverhang = readRecord(data.share_overhang);
  const countedSupply = readRecordArray(shareOverhang?.rows)
    .filter((row) => stringValue(row.row_role || row.rowRole) === "counted")
    .reduce((sum, row) => sum + (capitalShareOverhangNumber(row.numeric_value ?? row.numericValue) || 0), 0);
  const totalNote = readRecord(shareOverhang?.total_note || shareOverhang?.totalNote);
  const numerator = capitalShareOverhangNumber(totalNote?.numerator ?? totalNote?.supply_value ?? totalNote?.supplyValue);
  const hasCalculableSupply = countedSupply > 0 || (numerator != null && numerator > 0);
  const snapshotLabels = readRecordArray(data.snapshot_metrics).map((row) => stringValue(row.label));
  const hasApprovalSnapshot = snapshotLabels.some((label) => /^approval (?:status|scope)$/i.test(label));
  const hasCurrentFinancingScale = snapshotLabels.some((label) =>
    /^(?:new shares|offering size|purchase price|gross proceeds|net proceeds|warrant shares|debt amount|liquidity added)$/i.test(label),
  );
  const isApprovalOnly =
    stringValue(data.capital_mode) === "capital_structure_action" ||
    (hasApprovalSnapshot && !hasCurrentFinancingScale && !hasCalculableSupply);
  if (!isApprovalOnly) {
    return data === originalData ? displayPayload : { ...displayPayload, data };
  }

  const instrumentDetails = readRecordArray(data.instrument_details).filter((row) => {
    if (stringValue(row.label) !== "Shares / Securities") return true;
    return !/\b(?:full issuance approved|quantity not stated|not stated|not disclosed|not fixed|unknown)\b/i.test(
      stringValue(row.value),
    );
  });

  return {
    ...displayPayload,
    data: {
      ...data,
      capital_mode: "capital_structure_action",
      offering_details: [],
      instrument_details: instrumentDetails,
      share_overhang: hasCalculableSupply ? shareOverhang : null,
    },
  };
}

function removePlainEquityInstrumentDetailGroups(rows: Array<Record<string, unknown>>) {
  const filtered: Array<Record<string, unknown>> = [];
  let omitCurrentGroup = false;

  for (const row of rows) {
    if (stringValue(row.label) === "Type") {
      omitCurrentGroup = isPlainEquityInstrumentType(stringValue(row.value));
    }
    if (!omitCurrentGroup) filtered.push(row);
  }

  return filtered;
}

function isPlainEquityInstrumentType(value: string) {
  const normalized = value
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:class|series)\s+[a-z0-9-]+\s+)?(?:common stock|common shares?|ordinary shares?|ads|adss|american depositary shares?)$/i.test(
    normalized,
  );
}

function normalizeCapitalShareOverhangRatio(shareOverhang: Record<string, unknown> | null) {
  if (!shareOverhang) return null;
  const totalNoteKey = shareOverhang.total_note ? "total_note" : shareOverhang.totalNote ? "totalNote" : "total_note";
  const totalNote = readRecord(shareOverhang.total_note || shareOverhang.totalNote);
  if (!totalNote) return shareOverhang;

  const statusValue = stringValue(shareOverhang.status_value || shareOverhang.statusValue);
  const totalRatioValue = stringValue(totalNote.ratio ?? totalNote.ratio_value ?? totalNote.ratioValue);
  const ratioValue = stringValue(shareOverhang.ratio_value || shareOverhang.ratioValue);
  const hasVisiblePercentage = [statusValue, totalRatioValue, ratioValue].some((value) => value.includes("%"));
  if (!hasVisiblePercentage) return shareOverhang;

  const countedSupply = readRecordArray(shareOverhang.rows)
    .filter((row) => stringValue(row.row_role || row.rowRole) === "counted")
    .reduce((sum, row) => sum + (capitalShareOverhangNumber(row.numeric_value ?? row.numericValue) || 0), 0);
  const hasConditionalSupply = readRecordArray(shareOverhang.rows).some(
    (row) => stringValue(row.row_role || row.rowRole) === "conditional",
  );
  const basis = readRecord(shareOverhang.basis);
  const numerator = countedSupply > 0
    ? countedSupply
    : capitalShareOverhangNumber(totalNote.numerator ?? totalNote.supply_value ?? totalNote.supplyValue);
  const denominator =
    capitalShareOverhangNumber(basis?.numeric_value ?? basis?.numericValue) ??
    capitalShareOverhangNumber(totalNote.denominator ?? totalNote.current_value ?? totalNote.currentValue);
  if (numerator == null || numerator <= 0 || denominator == null || denominator <= 0) return shareOverhang;

  const normalizedRatio = `${(((numerator / denominator) * 100) + Number.EPSILON).toFixed(1)}%`;
  const numeratorKey = "numerator" in totalNote
    ? "numerator"
    : "supply_value" in totalNote
      ? "supply_value"
      : "supplyValue";
  const normalizedTotalNote = { ...totalNote, [numeratorKey]: numerator, ratio: normalizedRatio };
  const normalized = {
    ...shareOverhang,
    [totalNoteKey]: normalizedTotalNote,
  };
  if (countedSupply > 0 && hasConditionalSupply) {
    normalized.note = "Headline ratio includes counted supply only; conditional future supply is shown separately.";
  }
  if ("statusValue" in shareOverhang && !("status_value" in shareOverhang)) normalized.statusValue = normalizedRatio;
  else normalized.status_value = normalizedRatio;
  if ("ratioValue" in shareOverhang && !("ratio_value" in shareOverhang)) normalized.ratioValue = normalizedRatio;
  else normalized.ratio_value = normalizedRatio;
  return normalized;
}

export function getSec8k6kCapitalSecurityCoverageWarnings(
  displayPayload: Record<string, unknown>,
  securityInventory: Array<Record<string, unknown>>,
) {
  if (stringValue(displayPayload.display_type) !== "capital_financing") return [];
  const data = readRecord(displayPayload.data) || {};
  const capitalMode = stringValue(data.capital_mode);
  const warnings: string[] = [];
  const shareOverhang = readRecord(data.share_overhang);
  const instrumentTypes = readRecordArray(data.instrument_details)
    .filter((row) => stringValue(row.label) === "Type")
    .map((row) => normalizeSecurityCoverageValue(stringValue(row.value)))
    .filter(Boolean);

  if (!securityInventory.length && ["equity_issuance", "share_linked_financing"].includes(capitalMode)) {
    warnings.push("Capital security inventory was empty for an equity or share-linked financing analysis.");
  }

  for (const item of securityInventory) {
    if (stringValue(item.display_target) !== "instrument_details") continue;
    if (
      isPlainEquityInstrumentType(
        stringValue(item.instrument_details_type) || stringValue(item.security_name),
      )
    ) {
      continue;
    }
    const expectedType = normalizeSecurityCoverageValue(stringValue(item.instrument_details_type));
    if (!expectedType) {
      warnings.push(`Security inventory row ${stringValue(item.security_name)} targets Instrument Details without instrument_details_type.`);
      continue;
    }
    if (!instrumentTypes.includes(expectedType)) {
      warnings.push(`Instrument Details is missing the inventory Type group: ${stringValue(item.instrument_details_type)}.`);
    }
  }

  warnings.push(...getSec8k6kShareOverhangWarnings(shareOverhang, capitalMode));

  return uniqueStrings(warnings);
}

function getSec8k6kShareOverhangWarnings(shareOverhang: Record<string, unknown> | null, capitalMode = "") {
  if (!shareOverhang) return [];

  const warnings: string[] = [];
  const rows = readRecordArray(shareOverhang.rows);
  const countedRows = rows.filter((row) => stringValue(row.row_role || row.rowRole) === "counted");
  const countedSum = countedRows.reduce((sum, row) => sum + (capitalShareOverhangNumber(row.numeric_value ?? row.numericValue) || 0), 0);
  const totalNote = readRecord(shareOverhang.total_note || shareOverhang.totalNote) || {};
  const numerator = capitalShareOverhangNumber(totalNote.numerator ?? totalNote.supply_value ?? totalNote.supplyValue);
  const denominator = capitalShareOverhangNumber(totalNote.denominator ?? totalNote.current_value ?? totalNote.currentValue);
  const totalRatioValue = stringValue(totalNote.ratio ?? totalNote.ratio_value ?? totalNote.ratioValue);
  const totalRatio = capitalShareOverhangPercent(totalRatioValue);
  const statusValue = stringValue(shareOverhang.status_value || shareOverhang.statusValue);
  const statusRatio = capitalShareOverhangPercent(statusValue);

  if (statusValue && !isAllowedCapitalShareOverhangStatus(statusValue)) {
    warnings.push("Capital share_overhang status_value must be a bare percentage or a short non-calculable status, not comparison wording or a sentence.");
  }
  if (totalRatioValue && totalRatio != null && !totalRatioValue.includes("%")) {
    warnings.push("Capital share_overhang total_note.ratio must include the % sign; it is displayed as provided and is not UI-normalized.");
  }
  if (countedSum > 0 && numerator != null && capitalShareOverhangDiffers(countedSum, numerator)) {
    warnings.push("Capital share_overhang counted row numeric_value sum does not reconcile to total_note.numerator.");
  }
  if (capitalMode !== "atm_capacity" && countedSum === 0 && numerator != null && numerator > 0) {
    warnings.push("Capital share_overhang total_note.numerator is numeric but no counted row supports that headline calculation.");
  }
  for (const row of rows) {
    const rowRole = stringValue(row.row_role || row.rowRole);
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    if (rowRole === "conditional" && /\bpre[-\s]?funded\b/i.test(rowText)) {
      warnings.push(
        "Capital share_overhang marks pre-funded supply conditional; current-event pre-funded warrants with zero or nominal exercise economics must be counted unless they are an explicit alternative pool.",
      );
    }
  }
  if (numerator != null && denominator != null && denominator > 0 && totalRatio != null) {
    const expectedPercent = (numerator / denominator) * 100;
    if (capitalShareOverhangDiffers(expectedPercent, totalRatio)) {
      warnings.push("Capital share_overhang total_note ratio does not reconcile to numerator divided by denominator.");
    }
  }
  if (statusRatio != null && totalRatio != null && capitalShareOverhangDiffers(statusRatio, totalRatio)) {
    warnings.push("Capital share_overhang status_value percentage conflicts with total_note.ratio.");
  }

  return warnings;
}

function capitalShareOverhangNumber(value: unknown) {
  const direct = numberValue(value);
  if (direct != null) return direct;
  const normalized = stringValue(value).replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function capitalShareOverhangPercent(value: unknown) {
  const text = stringValue(value).trim();
  if (!text) return null;
  const matched = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  if (text.includes("%")) return parsed;
  return Math.abs(parsed) <= 10 ? parsed * 100 : parsed;
}

function isAllowedCapitalShareOverhangStatus(value: string) {
  return /^(?:\d[\d,]*(?:\.\d+)?%|Variable|Not fixed yet|Not calculable|Not stated)$/i.test(value.trim());
}

function capitalShareOverhangDiffers(left: number, right: number) {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1) > 0.02;
}

function sourceBlockShowsConditionalExerciseProceeds(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || !/\bproceeds\b/i.test(text) || !/\b(?:warrant|option|right)s?\b/i.test(text)) return false;
  const hasExerciseCondition = [
    /\bif\b[^.]{0,120}\b(?:exercise|exercised)\b/i,
    /\b(?:upon|from|assuming)\b[^.]{0,100}\b(?:exercise|exercised)\b/i,
    /\b(?:exercise|exercised)\b[^.]{0,120}\b(?:additional|further|future|potential)\s+(?:gross\s+)?proceeds\b/i,
  ].some((pattern) => pattern.test(text));
  const monetaryAmounts = text.match(
    /(?:US\s*)?\$\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|m|bn))?/gi,
  );
  return hasExerciseCondition && (monetaryAmounts?.length || 0) >= 2;
}

function appendCapitalSecurityCoverageWarnings(
  displayPayload: Record<string, unknown>,
  securityInventory: Array<Record<string, unknown>>,
) {
  const warnings = getSec8k6kCapitalSecurityCoverageWarnings(displayPayload, securityInventory);
  if (!warnings.length) return displayPayload;
  const data = readRecord(displayPayload.data) || {};
  return {
    ...displayPayload,
    data: {
      ...data,
      display_warnings: uniqueStrings([...readStringArray(data.display_warnings), ...warnings]),
    },
  };
}

export function getSec8k6kGovernanceSemanticWarnings(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
) {
  return getSec8k6kGovernanceRepairIssues(displayPayload, analysisOutput).map((issue) => issue.warning);
}

function getSec8k6kValidationRepairIssues(
  analysisResult: Record<string, unknown>,
  promptPayload?: Record<string, unknown> | null,
  sourceBlocks: Record<string, unknown>[] = [],
) {
  const root = readRecord(analysisResult) || {};
  const analysisOutput = readRecord(root.analysis_output) || {};
  const displayPayload = readRecord(root.display_payload) || {};
  return [
    ...getSec8k6kAmendmentRepairIssues(root, promptPayload),
    ...getSec8k6kValidationRepairIssuesForFields(displayPayload, analysisOutput, sourceBlocks),
  ];
}

export function getSec8k6kValidationSemanticWarnings(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
) {
  return getSec8k6kValidationRepairIssuesForFields(displayPayload, analysisOutput).map((issue) => issue.warning);
}

function getSec8k6kValidationRepairIssuesForFields(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[] = [],
) {
  return [
    ...getSec8k6kSnapshotCountRepairIssues(displayPayload, analysisOutput),
    ...getSec8k6kTextEncodingRepairIssues(analysisOutput),
    ...getSec8k6kKeyEvidenceRepairIssues(analysisOutput),
    ...getSec8k6kScoreRationaleRepairIssues(analysisOutput),
    ...getSec8k6kRiskRepairIssues(analysisOutput),
    ...getSec8k6kCapitalRepairIssues(displayPayload, analysisOutput, sourceBlocks),
    ...getSec8k6kStrategicRepairIssues(displayPayload, analysisOutput),
    ...getSec8k6kGovernanceRepairIssues(displayPayload, analysisOutput, sourceBlocks),
    ...getSec8k6kOperatingRepairIssues(displayPayload, analysisOutput, sourceBlocks),
  ];
}

function getSec8k6kAmendmentRepairIssues(
  root: Record<string, unknown>,
  promptPayload?: Record<string, unknown> | null,
): Sec8k6kValidationRepairIssue[] {
  const currentFiling = readRecord(promptPayload?.current_filing) || {};
  const formType = stringValue(currentFiling.form_type).replace(/\s+/g, "");
  if (!/^(?:8-K|6-K)\/A$/i.test(formType)) return [];

  const delta = readRecord(root.amendment_delta);
  const analysisOutput = readRecord(root.analysis_output) || {};
  const displayPayload = readRecord(root.display_payload) || {};
  const allowedDeltaPaths = [
    "/amendment_delta/is_amendment",
    "/amendment_delta/change_kind",
    "/amendment_delta/changed_fields",
    "/amendment_delta/unchanged_parent_event",
    "/amendment_delta/investor_impact",
    "/amendment_delta/parent_accession",
    "/amendment_delta/source_block_ids",
  ];
  const allowedAnalysisPaths = [
    "/analysis_output/event_type",
    "/analysis_output/event_title",
    "/analysis_output/score",
    "/analysis_output/score_reason",
    "/analysis_output/score_explanation/summary",
    "/analysis_output/signal",
    "/analysis_output/quick_take",
    "/analysis_output/summary",
  ];
  const allowedPatchPaths = [...allowedDeltaPaths, ...allowedAnalysisPaths];
  const currentSourceIds = primaryMaterialEventSourceIds(analysisOutput);

  if (!delta || delta.is_amendment !== true) {
    return [{
      code: "amendment_delta_missing_or_invalid",
      warning: "The amendment response does not identify the present change separately from the original filing event.",
      field_paths: allowedDeltaPaths,
      allowed_patch_paths: allowedPatchPaths,
      candidate_source_block_ids: currentSourceIds,
    }];
  }

  const changeKind = stringValue(delta.change_kind);
  if (["not_amendment", "supplemental_update", "material_change", "unable_to_compare"].includes(changeKind)) {
    return [{
      code: "amendment_parent_comparison_required",
      warning: "The amendment may contain a substantive or uncertain change. Compare it once against the supplied original filing source blocks and score only the present delta.",
      field_paths: allowedDeltaPaths,
      allowed_patch_paths: allowedPatchPaths,
      candidate_source_block_ids: currentSourceIds,
    }];
  }

  if (changeKind !== "clerical_correction") {
    return [{
      code: "amendment_delta_missing_or_invalid",
      warning: "The amendment change kind is invalid or unsupported.",
      field_paths: allowedDeltaPaths,
      allowed_patch_paths: allowedPatchPaths,
      candidate_source_block_ids: currentSourceIds,
    }];
  }

  const score = numberValue(analysisOutput.score) ?? 0;
  const hasRichDisplay = !["", "generic"].includes(stringValue(displayPayload.display_type));
  if (
    stringValue(analysisOutput.event_type) !== "other" ||
    stringValue(analysisOutput.signal) !== "neutral" ||
    score >= 50 ||
    delta.unchanged_parent_event !== true ||
    hasRichDisplay
  ) {
    return [{
      code: "amendment_clerical_event_overstated",
      warning: "A clerical amendment is being presented or scored as though the unchanged original event occurred again.",
      field_paths: [...allowedDeltaPaths, ...allowedAnalysisPaths],
      allowed_patch_paths: allowedPatchPaths,
      candidate_source_block_ids: currentSourceIds,
    }];
  }

  return [];
}

function getSec8k6kSnapshotCountRepairIssues(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  const eventType = stringValue(analysisOutput.event_type);
  const displayType = stringValue(displayPayload.display_type);
  const data = readRecord(displayPayload.data) || {};
  const sourceBlockIds = primaryMaterialEventSourceIds(analysisOutput);

  if (["listing_risk", "financial_risk"].includes(eventType)) {
    const snapshot = readRecordArray(analysisOutput.listing_status_snapshot);
    if (snapshot.length !== 4) {
      return [{
        code: "structured_snapshot_count_mismatch",
        warning: `The visible Risk Status snapshot has ${snapshot.length} rows; every structured 2-by-2 snapshot must contain exactly four non-duplicative rows.`,
        field_paths: ["/analysis_output/listing_status_snapshot"],
        allowed_patch_paths: ["/analysis_output/listing_status_snapshot"],
        candidate_source_block_ids: sourceBlockIds,
      }];
    }
    return [];
  }

  if (!["capital_financing", "strategic_transaction", "governance_event", "operating_event"].includes(displayType)) {
    return [];
  }
  if (displayType === "operating_event" && stringValue(data.operating_mode) === "routine_archive") return [];

  const snapshot = readRecordArray(data.snapshot_metrics);
  if (snapshot.length === 4) return [];
  return [{
    code: "structured_snapshot_count_mismatch",
    warning: `The visible structured snapshot has ${snapshot.length} rows; it must contain exactly four non-duplicative source-backed rows.`,
    field_paths: ["/display_payload/data/snapshot_metrics"],
    allowed_patch_paths: ["/display_payload/data/snapshot_metrics"],
    candidate_source_block_ids: sourceBlockIds,
  }];
}

function getSec8k6kScoreRationaleRepairIssues(
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  const fields = [
    {
      value: stringValue(analysisOutput.score_reason),
      path: "/analysis_output/score_reason",
    },
    {
      value: stringValue(readRecord(analysisOutput.score_explanation)?.summary),
      path: "/analysis_output/score_explanation/summary",
    },
  ];
  const metaLanguagePaths = fields
    .filter((field) => field.value && hasSec8k6kScoreRationaleMetaLanguage(field.value))
    .map((field) => field.path);
  const filingRecapPaths = fields
    .filter((field) => isSec8k6kScoreRationaleFilingRecap(field.value))
    .map((field) => field.path);
  const sourceBlockIds = primaryMaterialEventSourceIds(analysisOutput);
  const issues: Sec8k6kValidationRepairIssue[] = [];

  if (metaLanguagePaths.length) {
    issues.push({
      code: "score_rationale_meta_language",
      warning: "Investor-facing score rationale describes the score, rating, or delivery tier instead of stating the practical investment-impact principle.",
      field_paths: metaLanguagePaths,
      allowed_patch_paths: metaLanguagePaths,
      candidate_source_block_ids: sourceBlockIds,
    });
  }

  if (filingRecapPaths.length) {
    issues.push({
      code: "score_rationale_filing_recap",
      warning: "Investor-facing score rationale repeats filing mechanics or dense transaction terms instead of explaining the practical scoring principle.",
      field_paths: filingRecapPaths,
      allowed_patch_paths: filingRecapPaths,
      candidate_source_block_ids: sourceBlockIds,
    });
  }

  return issues;
}

function hasSec8k6kScoreRationaleMetaLanguage(value: string) {
  return /(?:\b(?:the|this|impact)\s+score\b|\bscore\s+(?:is|of|level|band|reflects|because)\b|\b(?:alert|feed|archive)[ -]level\b|\bwarrant(?:s|ed|ing)?\s+(?:an?\s+)?(?:alert|feed|archive)[ -]level\b|\bjustif(?:y|ies|ied|ying)\s+(?:an?\s+)?(?:high|low|alert)\b)/i.test(value);
}

function isSec8k6kScoreRationaleFilingRecap(value: string) {
  const text = stringValue(value).replace(/\s+/g, " ");
  if (!text) return false;

  const transactionMechanicOpening = /^(?:the\s+)?(?:offering|issuance|sale|placement|financing|transaction|agreement)\b/i;
  const issuerActionOpening = /^(?:the\s+)?(?:company|issuer|registrant)\s+(?:filed|announced|disclosed|issued|offered|sold|entered|completed|appointed|resigned|received|approved)\b/i;
  const denseTransactionTerms = countSec8k6kRationaleQuantitativeFacts(text) >= 2 &&
    /\b(?:offering|issuance|shares?|ADSs?|units?|warrants?|price|proceeds|financing|transaction)\b/i.test(text);

  return transactionMechanicOpening.test(text) || issuerActionOpening.test(text) || denseTransactionTerms;
}

function countSec8k6kRationaleQuantitativeFacts(value: string) {
  const pattern = /(?:[$€£¥]\s*\(?\d[\d,.]*(?:\s*(?:thousand|million|billion|trillion|[KMBT]))?|\b\d[\d,.]*\s*(?:%|percent|shares?|ADSs?|units?|warrants?)\b)/gi;
  return [...String(value || "").matchAll(pattern)].length;
}

function getSec8k6kTextEncodingRepairIssues(
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  const fields = [
    ["event_title", "/analysis_output/event_title"],
    ["quick_take", "/analysis_output/quick_take"],
    ["summary", "/analysis_output/summary"],
    ["score_reason", "/analysis_output/score_reason"],
  ] as const;

  return fields.flatMap(([field, path]) => {
    const value = stringValue(analysisOutput[field]);
    if (!hasLikelyMojibake(value)) return [];
    return [{
      code: `text_encoding_mojibake_${field}`,
      warning: `${field} contains likely character-encoding corruption and should be restored from the original source text.`,
      field_paths: [path],
      allowed_patch_paths: [path],
      candidate_source_block_ids: [],
    }];
  });
}

function getSec8k6kSourceConsistencyRepairIssues(
  analysisResult: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[],
): Sec8k6kValidationRepairIssue[] {
  const listingDateRoleIssues = getSec8k6kListingDateRoleRepairIssues(analysisResult, sourceBlocks);
  const analysisOutput = readRecord(analysisResult.analysis_output) || {};
  const summary = stringValue(analysisOutput.summary);
  if (!summary) return listingDateRoleIssues;

  const qualifiedAmountBlocks = sourceBlocks
    .map((block) => ({
      block,
      matches: materialQualifiedAmounts(stringValue(block.text)),
    }))
    .filter((item) => item.matches.length > 0);
  if (!qualifiedAmountBlocks.length) return listingDateRoleIssues;

  const omitted = qualifiedAmountBlocks.filter((item) =>
    item.matches.some((match) => summaryMentionsAmountWithoutQualifier(summary, match.amount, match.qualifierText))
  );
  if (!omitted.length) return listingDateRoleIssues;

  return [...listingDateRoleIssues, {
    code: "source_material_amount_qualifier_omitted",
    warning: "Summary states a material payment or proceeds amount but omits a source-backed offset, deduction, netting, or third-party payment condition attached to that amount.",
    field_paths: ["/analysis_output/summary"],
    allowed_patch_paths: ["/analysis_output/summary"],
    candidate_source_block_ids: uniqueStrings(
      omitted.map((item) => stringValue(item.block.block_id)).filter(Boolean),
    ),
  }];
}

function getSec8k6kListingDateRoleRepairIssues(
  analysisResult: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[],
): Sec8k6kValidationRepairIssue[] {
  const analysisOutput = readRecord(analysisResult.analysis_output) || {};
  if (stringValue(analysisOutput.event_type) !== "listing_risk") return [];

  const sourceSuspensionDates = new Map<string, Set<string>>();
  const sourceRemovalDates = new Set<string>();
  for (const block of sourceBlocks) {
    const blockId = stringValue(block.block_id);
    if (!blockId) continue;
    const roles = extractListingDateRoles(stringValue(block.text));
    sourceSuspensionDates.set(blockId, roles.suspension);
    for (const date of roles.removal) sourceRemovalDates.add(date);
  }

  const suspensionDates = new Set<string>();
  for (const dates of sourceSuspensionDates.values()) {
    for (const date of dates) suspensionDates.add(date);
  }
  if (!suspensionDates.size) return [];

  const flaggedPaths: string[] = [];
  const misclassifiedDates = new Set<string>();
  const inspectText = (path: string, value: unknown) => {
    const roles = extractListingDateRoles(stringValue(value));
    const mismatches = [...roles.removal].filter(
      (date) => suspensionDates.has(date) && !sourceRemovalDates.has(date),
    );
    if (!mismatches.length) return;
    flaggedPaths.push(path);
    for (const date of mismatches) misclassifiedDates.add(date);
  };

  inspectText("/analysis_output/event_title", analysisOutput.event_title);
  inspectText("/analysis_output/quick_take", analysisOutput.quick_take);
  inspectText("/analysis_output/summary", analysisOutput.summary);
  inspectText("/analysis_output/score_reason", analysisOutput.score_reason);

  readRecordArray(analysisOutput.material_events).forEach((event, index) => {
    inspectText(`/analysis_output/material_events/${index}/event_summary`, event.event_summary);
  });
  readRecordArray(analysisOutput.listing_status_snapshot).forEach((row, index) => {
    const rowText = `${stringValue(row.label)}: ${stringValue(row.value)}. ${stringValue(row.note)}`;
    const before = flaggedPaths.length;
    inspectText(`/analysis_output/listing_status_snapshot/${index}/label`, rowText);
    if (flaggedPaths.length > before) {
      flaggedPaths.pop();
      flaggedPaths.push(
        `/analysis_output/listing_status_snapshot/${index}/label`,
        `/analysis_output/listing_status_snapshot/${index}/value`,
        `/analysis_output/listing_status_snapshot/${index}/note`,
      );
    }
  });

  const allowedPatchPaths = uniqueStrings(flaggedPaths);
  if (!allowedPatchPaths.length) return [];

  const candidateSourceBlockIds = [...sourceSuspensionDates.entries()]
    .filter(([, dates]) => [...dates].some((date) => misclassifiedDates.has(date)))
    .map(([blockId]) => blockId);

  return [{
    code: "risk_listing_suspension_date_misclassified_as_removal",
    warning: "A trading suspension date is presented as the effective delisting or removal date, although the source assigns that date only to suspension of trading.",
    field_paths: allowedPatchPaths,
    allowed_patch_paths: allowedPatchPaths,
    candidate_source_block_ids: candidateSourceBlockIds,
  }];
}

function extractListingDateRoles(value: string) {
  const suspension = new Set<string>();
  const removal = new Set<string>();
  const segments = String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .filter(Boolean);

  for (const segment of segments) {
    for (const mention of extractCalendarDateMentions(segment)) {
      const window = segment.slice(Math.max(0, mention.index - 140), mention.index + mention.text.length + 140);
      if (hasTradingSuspensionDateLanguage(window)) suspension.add(mention.key);
      if (hasEffectiveRemovalDateLanguage(window)) removal.add(mention.key);
    }
  }
  return { suspension, removal };
}

function extractCalendarDateMentions(value: string) {
  const pattern = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/gi;
  return [...String(value || "").matchAll(pattern)].flatMap((match) => {
    const key = normalizeCalendarDateMention(match[0]);
    return key ? [{ text: match[0], key, index: match.index ?? 0 }] : [];
  });
}

function normalizeCalendarDateMention(value: string) {
  const text = String(value || "").trim().replace(/\./g, "");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const numeric = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;

  const named = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (!named) return null;
  const month = ({
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
    nov: "11", november: "11", dec: "12", december: "12",
  } as Record<string, string>)[named[1].toLowerCase()];
  return month ? `${named[3]}-${month}-${named[2].padStart(2, "0")}` : null;
}

function hasTradingSuspensionDateLanguage(value: string) {
  return /(?:\btrading\b.{0,100}\b(?:suspend(?:ed|sion)?|halt(?:ed)?)\b|\b(?:suspend(?:ed|sion)?|halt(?:ed)?)\b.{0,100}\btrading\b|\btrading suspension date\b)/i.test(value);
}

function hasEffectiveRemovalDateLanguage(value: string) {
  return /(?:\b(?:delist(?:ed|ing)?|remov(?:ed|al))\b.{0,90}\b(?:effective|takes? effect|will occur|scheduled for)\b|\b(?:effective|takes? effect)\b.{0,90}\b(?:delist(?:ed|ing)?|remov(?:ed|al))\b|\b(?:is|was|will be)\s+(?:delisted|removed)\b.{0,60}\bon\b|\b(?:delisting|removal) date\b)/i.test(value);
}

function getSec8k6kRiskRepairIssues(
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  if (!['listing_risk', 'financial_risk'].includes(stringValue(analysisOutput.event_type))) return [];
  const issues: Sec8k6kValidationRepairIssue[] = [];
  const snapshot = readRecordArray(analysisOutput.listing_status_snapshot);

  for (let index = 0; index < snapshot.length; index += 1) {
    const metric = snapshot[index];
    const basePath = `/analysis_output/listing_status_snapshot/${index}`;
    const label = stringValue(metric.label);
    const value = stringValue(metric.value);
    const note = stringValue(metric.note);
    if (isDefinitiveStatusOrDateLabel(label) && hasConditionalStateLanguage(`${value} ${note}`)) {
      issues.push({
        code: `risk_conditional_state_label_${index}`,
        warning: "Risk snapshot labels a planned, conditional, or pending status/date as already effective or completed.",
        field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
        allowed_patch_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
        candidate_source_block_ids: [],
      });
    }
    if (
      /^(?:current )?status$/i.test(label) &&
      hasDefinitiveCompletionLanguage(value) &&
      hasConditionalStateLanguage(note)
    ) {
      issues.push({
        code: `risk_conditional_status_value_${index}`,
        warning: "Risk snapshot presents a conditional trigger or outcome as the current completed status.",
        field_paths: [`${basePath}/value`, `${basePath}/note`],
        allowed_patch_paths: [`${basePath}/value`, `${basePath}/note`],
        candidate_source_block_ids: [],
      });
    }
  }
  return issues;
}

function getSec8k6kKeyEvidenceRepairIssues(
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  const keyEvidence = readStringArray(analysisOutput.key_evidence);
  if (keyEvidence.length <= 3) return [];
  return [{
    code: "key_evidence_count_exceeded",
    warning: "Key Evidence exceeds the two-to-three-item contract and must be re-ranked from the original evidence rather than truncated by position.",
    field_paths: ["/analysis_output/key_evidence"],
    allowed_patch_paths: ["/analysis_output/key_evidence"],
    candidate_source_block_ids: primaryMaterialEventSourceIds(analysisOutput),
  }];
}

function getSec8k6kCapitalRepairIssues(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[] = [],
): Sec8k6kValidationRepairIssue[] {
  if (stringValue(displayPayload.display_type) !== "capital_financing") return [];
  const data = readRecord(displayPayload.data) || {};
  const issues: Sec8k6kValidationRepairIssue[] = [];
  if (isReverseSplitCapitalDisplay(displayPayload)) {
    const score = numberValue(analysisOutput.score);
    const eventType = stringValue(analysisOutput.event_type);
    const signal = stringValue(analysisOutput.signal);
    if (score == null || score < 75 || eventType !== "dilution_risk" || signal !== "bearish") {
      issues.push({
        code: "capital_reverse_split_alert_policy",
        warning: "A current reverse stock split must use the capital-structure route, bearish signal, and alert-level score while explaining listing, price, or capital pressure rather than mechanical dilution.",
        field_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        candidate_source_block_ids: primaryMaterialEventSourceIds(analysisOutput),
      });
    }
  }
  const conditionalProceedsSourceBlocks = sourceBlocks.filter((block) =>
    sourceBlockShowsConditionalExerciseProceeds(stringValue(block.text))
  );
  if (conditionalProceedsSourceBlocks.length > 0) {
    const snapshotMetrics = readRecordArray(data.snapshot_metrics);
    for (let index = 0; index < snapshotMetrics.length; index += 1) {
      const metric = snapshotMetrics[index];
      const label = stringValue(metric.label);
      const value = stringValue(metric.value);
      const note = stringValue(metric.note);
      const snapshotProceedsText = `${value} ${note}`;
      const visibleAmounts = snapshotProceedsText.match(/(?:US\s*)?\$\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|m|bn))?/gi) || [];
      if (
        /\b(?:offering|financing) size\b|\bgross proceeds\b/i.test(label) &&
        /\bup to\b/i.test(value) &&
        (visibleAmounts.length < 2 || !/\b(?:exercise|conditional|if all|if fully)\b/i.test(snapshotProceedsText))
      ) {
        const basePath = `/display_payload/data/snapshot_metrics/${index}`;
        issues.push({
          code: "capital_conditional_proceeds_snapshot",
          warning: "The capital snapshot presents an aggregate maximum as unconditional offering proceeds even though original sources split closing proceeds from exercise-contingent additional proceeds.",
          field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          allowed_patch_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          candidate_source_block_ids: uniqueStrings([
            ...primaryMaterialEventSourceIds(analysisOutput),
            ...conditionalProceedsSourceBlocks.map((block) => stringValue(block.block_id)),
          ]),
        });
      }
    }
  }
  const shareOverhang = readRecord(data.share_overhang);
  if (!shareOverhang) return issues;

  const basePath = "/display_payload/data/share_overhang";
  const statusKey = "status_value" in shareOverhang ? "status_value" : "statusValue";
  const statusValue = stringValue(shareOverhang[statusKey]);
  const rows = readRecordArray(shareOverhang.rows);
  const countedRows = rows.filter((row) => stringValue(row.row_role || row.rowRole) === "counted");
  const countedSum = countedRows.reduce(
    (sum, row) => sum + (capitalShareOverhangNumber(row.numeric_value ?? row.numericValue) || 0),
    0,
  );
  const totalNoteKey = shareOverhang.total_note ? "total_note" : "totalNote";
  const totalNote = readRecord(shareOverhang[totalNoteKey]) || {};
  const numeratorKey = "numerator" in totalNote ? "numerator" : "supply_value" in totalNote ? "supply_value" : "supplyValue";
  const ratioKey = "ratio" in totalNote ? "ratio" : "ratio_value" in totalNote ? "ratio_value" : "ratioValue";
  const numerator = capitalShareOverhangNumber(totalNote[numeratorKey]);
  const denominator = capitalShareOverhangNumber(
    totalNote.denominator ?? totalNote.current_value ?? totalNote.currentValue,
  );
  const totalRatioValue = stringValue(totalNote[ratioKey]);
  const totalRatio = capitalShareOverhangPercent(totalRatioValue);
  const statusRatio = capitalShareOverhangPercent(statusValue);
  const visibleFixedRatio = statusRatio ?? totalRatio;
  const capitalMode = stringValue(data.capital_mode);

  if (
    ["equity_issuance", "share_linked_financing"].includes(capitalMode) &&
    visibleFixedRatio != null &&
    visibleFixedRatio >= 100
  ) {
    const score = numberValue(analysisOutput.score);
    const eventType = stringValue(analysisOutput.event_type);
    const signal = stringValue(analysisOutput.signal);
    if (score == null || score < 84 || eventType !== "dilution_risk" || signal !== "bearish") {
      issues.push({
        code: "capital_severe_dilution_alert_policy",
        warning: "A fixed counted share-overhang ratio of 100% or more is in the shared severe-dilution band and requires an alert-level bearish dilution assessment.",
        field_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        candidate_source_block_ids: primaryMaterialEventSourceIds(analysisOutput),
      });
    }
  }

  if (statusValue && !isAllowedCapitalShareOverhangStatus(statusValue)) {
    issues.push({
      code: "capital_status_value_not_compact",
      warning: "Capital share-overhang headline status contains comparison wording or prose instead of a bare percentage or short non-calculable status.",
      field_paths: [`${basePath}/${statusKey}`],
      allowed_patch_paths: [`${basePath}/${statusKey}`],
      candidate_source_block_ids: [],
    });
  }
  if (totalRatioValue && totalRatio != null && !totalRatioValue.includes("%")) {
    issues.push({
      code: "capital_ratio_missing_percent_sign",
      warning: "Capital share-overhang ratio is numeric but omits the percent sign required by the visible ratio field.",
      field_paths: [`${basePath}/${totalNoteKey}/${ratioKey}`],
      allowed_patch_paths: [`${basePath}/${totalNoteKey}/${ratioKey}`],
      candidate_source_block_ids: [],
    });
  }
  if (countedSum > 0 && numerator != null && capitalShareOverhangDiffers(countedSum, numerator)) {
    issues.push({
      code: "capital_counted_supply_mismatch",
      warning: "Capital share-overhang counted rows do not reconcile to the displayed numerator.",
      field_paths: [`${basePath}/${totalNoteKey}/${numeratorKey}`],
      allowed_patch_paths: [`${basePath}/${totalNoteKey}/${numeratorKey}`],
      candidate_source_block_ids: [],
    });
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowRoleKey = "row_role" in row ? "row_role" : "rowRole";
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    if (stringValue(row[rowRoleKey]) === "conditional" && /\bpre[-\s]?funded\b/i.test(rowText)) {
      issues.push({
        code: `capital_prefunded_role_${index}`,
        warning: "Capital share-overhang marks current-event pre-funded supply conditional even though nominal-exercise supply is normally counted unless it is an explicit alternative pool.",
        field_paths: [`${basePath}/rows/${index}/${rowRoleKey}`],
        allowed_patch_paths: [`${basePath}/rows/${index}/${rowRoleKey}`],
        candidate_source_block_ids: [],
      });
    }
  }
  if (numerator != null && denominator != null && denominator > 0 && totalRatio != null) {
    const expectedPercent = (numerator / denominator) * 100;
    if (capitalShareOverhangDiffers(expectedPercent, totalRatio)) {
      issues.push({
        code: "capital_ratio_math_mismatch",
        warning: "Capital share-overhang ratio does not equal the displayed numerator divided by the displayed denominator.",
        field_paths: [`${basePath}/${totalNoteKey}/${ratioKey}`],
        allowed_patch_paths: [`${basePath}/${totalNoteKey}/${ratioKey}`],
        candidate_source_block_ids: [],
      });
    }
  }
  if (statusRatio != null && totalRatio != null && capitalShareOverhangDiffers(statusRatio, totalRatio)) {
    issues.push({
      code: "capital_status_ratio_conflict",
      warning: "Capital share-overhang headline percentage conflicts with the detailed total ratio.",
      field_paths: [`${basePath}/${statusKey}`],
      allowed_patch_paths: [`${basePath}/${statusKey}`],
      candidate_source_block_ids: [],
    });
  }
  return issues;
}

function getSec8k6kStrategicRepairIssues(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
): Sec8k6kValidationRepairIssue[] {
  if (stringValue(displayPayload.display_type) !== "strategic_transaction") return [];
  const issues: Sec8k6kValidationRepairIssue[] = [];
  const data = readRecord(displayPayload.data) || {};
  const snapshot = readRecordArray(data.snapshot_metrics);
  let hasPendingTransactionStatus = false;

  for (let index = 0; index < snapshot.length; index += 1) {
    const metric = snapshot[index];
    const basePath = `/display_payload/data/snapshot_metrics/${index}`;
    const label = stringValue(metric.label);
    const value = stringValue(metric.value);
    const note = stringValue(metric.note);
    if (isDefinitiveStatusOrDateLabel(label) && hasConditionalStateLanguage(`${value} ${note}`)) {
      issues.push({
        code: `strategic_conditional_state_label_${index}`,
        warning: "Strategic-transaction snapshot labels a planned, conditional, or pending milestone as already effective or completed.",
        field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
        allowed_patch_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
        candidate_source_block_ids: [],
      });
    }
    if (/\b(?:transaction|deal|closing) status\b/i.test(label) && hasConditionalStateLanguage(`${value} ${note}`)) {
      hasPendingTransactionStatus = true;
    }
  }

  const summary = stringValue(analysisOutput.summary);
  if (hasPendingTransactionStatus && /\b(?:completed|closed|consummated|was acquired|has acquired)\b/i.test(summary)) {
    issues.push({
      code: "strategic_summary_conflicts_with_pending_status",
      warning: "Strategic-transaction summary describes completion while the transaction-status snapshot remains pending or conditional.",
      field_paths: ["/analysis_output/summary"],
      allowed_patch_paths: ["/analysis_output/summary"],
      candidate_source_block_ids: [],
    });
  }
  return issues;
}

function getSec8k6kGovernanceRepairIssues(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[] = [],
): Sec8k6kValidationRepairIssue[] {
  if (stringValue(displayPayload.display_type) !== "governance_event") return [];
  const data = readRecord(displayPayload.data) || {};
  if (stringValue(data.governance_mode) !== "auditor_change") return [];

  const issues: Sec8k6kValidationRepairIssue[] = [];
  const icfrScopeSourceBlockIds = sourceBlocks
    .filter((block) => {
      const text = stringValue(block.text);
      return /\b(?:internal control over financial reporting|ICFR)\b/i.test(text) &&
        /\b(?:not engaged to|did not express|does not express|not required to)\b/i.test(text);
    })
    .map((block) => stringValue(block.block_id))
    .filter(Boolean);
  const summarySentences = stringValue(analysisOutput.summary).split(/(?<=[.!?])\s+/);
  if (summarySentences.some((sentence) =>
    /\b(?:no|without)\s+(?:disagreements?|reportable events?)\b/i.test(sentence) &&
    /\b(?:going concern|adverse opinion|disclaimer|audit opinion)\b/i.test(sentence)
  )) {
    issues.push({
      code: "governance_auditor_summary_conflates_opinion_and_disagreements",
      warning: "Governance auditor summary conflates disagreements or reportable events with a separate audit-opinion or going-concern disclosure.",
      field_paths: ["/analysis_output/summary"],
      allowed_patch_paths: ["/analysis_output/summary"],
      candidate_source_block_ids: [],
    });
  }

  const keyChanges = readRecordArray(data.key_changes);
  for (let changeIndex = 0; changeIndex < keyChanges.length; changeIndex += 1) {
    const details = readRecordArray(keyChanges[changeIndex].details);
    for (let detailIndex = 0; detailIndex < details.length; detailIndex += 1) {
      const detail = details[detailIndex];
      const basePath = `/display_payload/data/key_changes/${changeIndex}/details/${detailIndex}`;
      const label = stringValue(detail.label);
      const valueAndNote = `${stringValue(detail.value)} ${stringValue(detail.note)}`;
      if (
        /\b(?:disagreements?|reportable events?)\b/i.test(label) &&
        /\b(?:going concern|adverse opinion|disclaimer|audit opinion)\b/i.test(valueAndNote)
      ) {
        issues.push({
          code: `governance_auditor_detail_conflates_opinion_${changeIndex}_${detailIndex}`,
          warning: "Governance auditor detail attaches an audit-opinion or going-concern fact to a disagreements or reportable-events value.",
          field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          allowed_patch_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          candidate_source_block_ids: [],
        });
      }
      if (
        /\b(?:auditor reports?|audit opinion|qualification)\b/i.test(label) &&
        /\b(?:qualified|qualification|except)\b/i.test(valueAndNote) &&
        /\b(?:internal control over financial reporting|ICFR|internal control)\b/i.test(valueAndNote)
      ) {
        issues.push({
          code: "governance_auditor_icfr_scope_misclassified_as_qualification",
          warning: "Governance UI treats the auditor's separate lack of an ICFR opinion as a qualification or exception to the financial-statement audit opinion.",
          field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          allowed_patch_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          candidate_source_block_ids: uniqueStrings([
            ...icfrScopeSourceBlockIds,
            ...primaryMaterialEventSourceIds(analysisOutput),
          ]),
        });
      }
      if (
        /\b(?:engagement|effective) date\b/i.test(label) &&
        /\b(?:subject to|conditional|conditioned on|pending)\b/i.test(stringValue(detail.note))
      ) {
        issues.push({
          code: `governance_auditor_conditional_date_detail_${changeIndex}_${detailIndex}`,
          warning: "Governance auditor date is labeled as engagement or effective even though the note says the appointment remains conditional.",
          field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
          allowed_patch_paths: [`${basePath}/label`, `${basePath}/note`],
          candidate_source_block_ids: [],
        });
      }
    }
  }

  const snapshotMetrics = readRecordArray(data.snapshot_metrics);
  for (let metricIndex = 0; metricIndex < snapshotMetrics.length; metricIndex += 1) {
    const metric = snapshotMetrics[metricIndex];
    if (
      /\b(?:engagement|effective) date\b/i.test(stringValue(metric.label)) &&
      /\b(?:subject to|conditional|conditioned on|pending)\b/i.test(stringValue(metric.note))
    ) {
      const basePath = `/display_payload/data/snapshot_metrics/${metricIndex}`;
      issues.push({
        code: `governance_auditor_conditional_date_snapshot_${metricIndex}`,
        warning: "Governance auditor snapshot labels a conditional approval date as engagement or effective.",
        field_paths: [`${basePath}/label`, `${basePath}/value`, `${basePath}/note`],
        allowed_patch_paths: [`${basePath}/label`, `${basePath}/note`],
        candidate_source_block_ids: [],
      });
    }
  }

  return issues;
}

function getSec8k6kOperatingRepairIssues(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[] = [],
): Sec8k6kValidationRepairIssue[] {
  if (stringValue(displayPayload.display_type) !== "operating_event") return [];
  const data = readRecord(displayPayload.data) || {};
  const operatingMode = stringValue(data.operating_mode);
  const issues: Sec8k6kValidationRepairIssue[] = [];
  const materialEvents = readRecordArray(analysisOutput.material_events);
  const primaryMaterialEventIndex = materialEvents.findIndex((event) => stringValue(event.role) === "primary");
  const primarySourceBlockIds = primaryMaterialEventSourceIds(analysisOutput);

  if (operatingMode === "product_or_regulatory") {
    const regulatoryStage = stringValue(data.regulatory_stage);
    const expectedEventType = regulatoryStage && regulatoryStage !== "not_applicable"
      ? "fda_clinical"
      : "product_update";
    const primaryEventType = primaryMaterialEventIndex >= 0
      ? stringValue(materialEvents[primaryMaterialEventIndex].event_type)
      : "";
    if (
      stringValue(analysisOutput.event_type) !== expectedEventType ||
      primaryEventType !== expectedEventType
    ) {
      const allowedPatchPaths = ["/analysis_output/event_type"];
      if (primaryMaterialEventIndex >= 0) {
        allowedPatchPaths.push(`/analysis_output/material_events/${primaryMaterialEventIndex}/event_type`);
      }
      issues.push({
        code: "operating_regulatory_event_type_mismatch",
        warning: "The product/regulatory display and its source-backed regulatory stage conflict with the final event classification.",
        field_paths: allowedPatchPaths,
        allowed_patch_paths: allowedPatchPaths,
        candidate_source_block_ids: primarySourceBlockIds,
      });
    }
    return issues;
  }

  if (operatingMode !== "earnings" && operatingMode !== "operating_update") return issues;
  const comparisons = readRecordArray(data.performance_comparisons);
  const detailSections = readRecordArray(data.detail_sections);
  const snapshotMetrics = readRecordArray(data.snapshot_metrics);
  const businessCatalysts = readRecordArray(data.business_catalysts);
  const secondaryUpdates = readRecordArray(data.secondary_updates);
  const sourceProjectEconomicsBlocks = sourceBlocks.filter((block) =>
    projectEconomicsSourceFactGroups(stringValue(block.text)).length > 0
  );
  const sourceProjectEconomicsGroups = uniqueStrings(
    sourceProjectEconomicsBlocks.flatMap((block) => projectEconomicsSourceFactGroups(stringValue(block.text))),
  );
  const sourceProjectEconomicsBlockIds = sourceProjectEconomicsBlocks
    .map((block) => stringValue(block.block_id))
    .filter(Boolean);
  const performanceAndOutlookText = [
    ...snapshotMetrics.map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`),
    ...comparisons.map(
      (row) =>
        `${stringValue(row.label)} ${stringValue(row.current_label)} ${stringValue(row.current_value)} ${stringValue(row.comparison_label)} ${stringValue(row.comparison_value)}`,
    ),
    ...readRecordArray(data.guidance_metrics).map(
      (row) => `${stringValue(row.label)} ${stringValue(row.guidance_label)} ${stringValue(row.guidance_value)}`,
    ),
  ].join(" ");
  const hasOperatingPerformance = /\b(?:production|produced|deliver(?:y|ies)|shipments?|utilization|uptime|output|operating volume|customers?|hashrate|capacity)\b/i.test(
    performanceAndOutlookText,
  );
  const hasFinancialPerformance = /\b(?:revenue|sales|gross profit|operating (?:profit|income|loss)|net (?:profit|income|loss)|EBITDA|EPS|earnings per share|cash flow|margin)\b/i.test(
    performanceAndOutlookText,
  );
  const shouldBeOperatingUpdate =
    operatingMode === "earnings" && hasOperatingPerformance && !hasFinancialPerformance;

  if (shouldBeOperatingUpdate) {
    const allowedPatchPaths = [
      "/analysis_output/event_type",
      "/display_payload/data/operating_mode",
      "/display_payload/data/snapshot_title",
    ];
    if (primaryMaterialEventIndex >= 0) {
      allowedPatchPaths.push(`/analysis_output/material_events/${primaryMaterialEventIndex}/event_type`);
    }
    issues.push({
      code: "operating_nonfinancial_performance_misclassified_as_earnings",
      warning: "Production, delivery, utilization, capacity, or another non-financial operating KPI is the primary disclosed performance, but the result is classified as earnings without a financial performance metric. Repair the classification with exactly operating_update and set the snapshot title to Operating Snapshot.",
      field_paths: allowedPatchPaths,
      allowed_patch_paths: allowedPatchPaths,
      candidate_source_block_ids: uniqueStrings(
        materialEvents
          .filter((event) => stringValue(event.role) === "primary")
          .flatMap((event) => readStringArray(event.source_block_ids)),
      ),
    });
  }

  if (operatingMode === "operating_update" || shouldBeOperatingUpdate) {
    const visibleProjectText = [
      stringValue(analysisOutput.summary),
      ...snapshotMetrics.map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`),
      ...businessCatalysts.map((row) => `${stringValue(row.title)} ${stringValue(row.value)} ${stringValue(row.summary)}`),
      ...detailSections.flatMap((section) => [
        stringValue(section.title),
        ...readRecordArray(section.rows).map(
          (row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`,
        ),
      ]),
    ].join(" ");
    const visibleProjectEconomicsGroups = projectEconomicsFactGroups(visibleProjectText);
    const hasProjectEconomicsFacts = sourceProjectEconomicsGroups.length > 0 ||
      /\b(?:NPV|net present value|ownership|reserves?|technical report|operating cost|unit cost)\b/i.test(
        visibleProjectText,
      );
    const projectSectionIndex = detailSections.findIndex((section) => {
      const sectionText = readRecordArray(section.rows)
        .map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`)
        .join(" ");
      return /\b(?:NPV|net present value|ownership|reserves?|technical report|operating cost|unit cost)\b/i.test(sectionText);
    });

    if (hasProjectEconomicsFacts && projectSectionIndex < 0) {
      const sourceFactsWereOmitted = sourceProjectEconomicsGroups.length > 0 && visibleProjectEconomicsGroups.length === 0;
      const projectCollectionPaths = sourceFactsWereOmitted
        ? ["/display_payload/data/detail_sections"]
        : [
            "/display_payload/data/snapshot_metrics",
            "/display_payload/data/business_catalysts",
            "/display_payload/data/detail_sections",
          ];
      issues.push({
        code: "operating_project_economics_section_missing",
        warning: sourceFactsWereOmitted
          ? `Original source blocks contain material ${sourceProjectEconomicsGroups.join(", ")} facts that are absent from the visible analysis. Add them once in Project Economics while preserving the four primary operating snapshot rows.`
          : "Material project valuation, ownership, reserves, or technical economics are missing from a consolidated Project Economics section. Move those facts out of Snapshot and Key Business Updates while creating the section so each fact appears once.",
        field_paths: projectCollectionPaths,
        allowed_patch_paths: projectCollectionPaths,
        candidate_source_block_ids: uniqueStrings([
          ...sourceProjectEconomicsBlockIds,
          ...primarySourceBlockIds,
        ]),
      });
    }

    if (projectSectionIndex >= 0) {
      const projectSection = detailSections[projectSectionIndex];
      const projectSectionText = [
        stringValue(projectSection.title),
        ...readRecordArray(projectSection.rows).map(
          (row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`,
        ),
      ].join(" ");
      const missingProjectFactGroups = uniqueStrings([
        ...sourceProjectEconomicsGroups,
        ...visibleProjectEconomicsGroups,
      ]).filter(
        (group) => !projectEconomicsFactGroups(projectSectionText).includes(group),
      );
      const outsideProjectText = [
        ...snapshotMetrics.map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`),
        ...businessCatalysts.map((row) => `${stringValue(row.title)} ${stringValue(row.value)} ${stringValue(row.summary)}`),
        ...detailSections
          .filter((_, index) => index !== projectSectionIndex)
          .flatMap((section) => [
            stringValue(section.title),
            ...readRecordArray(section.rows).map(
              (row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`,
            ),
          ]),
      ].join(" ");
      const duplicatedProjectFactGroups = projectEconomicsFactGroups(outsideProjectText).filter((group) =>
        projectEconomicsFactGroups(projectSectionText).includes(group),
      );
      if (missingProjectFactGroups.length > 0) {
        issues.push({
          code: "operating_project_economics_section_incomplete",
          warning: `Project Economics does not consolidate the visible ${missingProjectFactGroups.join(", ")} facts; those facts remain split across Snapshot or Key Business Updates.`,
          field_paths: [
            "/display_payload/data/snapshot_metrics",
            "/display_payload/data/business_catalysts",
            "/display_payload/data/detail_sections",
          ],
          allowed_patch_paths: [
            "/display_payload/data/snapshot_metrics",
            "/display_payload/data/business_catalysts",
            "/display_payload/data/detail_sections",
          ],
          candidate_source_block_ids: uniqueStrings([
            ...sourceProjectEconomicsBlockIds,
            ...primarySourceBlockIds,
          ]),
        });
      } else if (duplicatedProjectFactGroups.length > 0) {
        issues.push({
          code: "operating_project_economics_fact_duplication",
          warning: `Project Economics already contains the visible ${duplicatedProjectFactGroups.join(", ")} facts, but the same facts are repeated in Snapshot, Key Business Updates, or another detail section. Keep them only in Project Economics while preserving primary operating KPIs elsewhere.`,
          field_paths: [
            "/display_payload/data/snapshot_metrics",
            "/display_payload/data/business_catalysts",
            "/display_payload/data/detail_sections",
          ],
          allowed_patch_paths: [
            "/display_payload/data/snapshot_metrics",
            "/display_payload/data/business_catalysts",
            "/display_payload/data/detail_sections",
          ],
          candidate_source_block_ids: uniqueStrings(
            materialEvents
              .filter((event) => stringValue(event.role) === "primary")
              .flatMap((event) => readStringArray(event.source_block_ids)),
          ),
        });
      }
    }

    for (let index = 0; index < detailSections.length; index += 1) {
      const section = detailSections[index];
      const title = stringValue(section.title);
      const sectionText = readRecordArray(section.rows)
        .map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`)
        .join(" ");
      if (
        /\b(?:NPV|net present value|ownership|reserves?|technical report|operating cost|unit cost)\b/i.test(sectionText) &&
        title.toLowerCase() !== "project economics"
      ) {
        const titlePath = `/display_payload/data/detail_sections/${index}/title`;
        issues.push({
          code: `operating_project_economics_title_${index}`,
          warning: "Operating project valuation, ownership, reserves, or technical economics use an inconsistent detail-section title instead of Project Economics.",
          field_paths: [titlePath],
          allowed_patch_paths: [titlePath],
          candidate_source_block_ids: [],
        });
      }
    }

    const secondaryMaterialEvents = materialEvents.filter((event) => stringValue(event.role) === "secondary");
    if (secondaryMaterialEvents.length > 0 && secondaryUpdates.length === 0) {
      const secondaryCollectionPaths = [
        "/display_payload/data/detail_sections",
        "/display_payload/data/secondary_updates",
      ];
      issues.push({
        code: "operating_secondary_material_event_missing",
        warning: "A distinct secondary material event is missing from the compact Other Material Event display section. Move any separate governance, capital, legal, or transaction details out of the primary detail sections and summarize them once in secondary_updates.",
        field_paths: secondaryCollectionPaths,
        allowed_patch_paths: secondaryCollectionPaths,
        candidate_source_block_ids: uniqueStrings(
          secondaryMaterialEvents.flatMap((event) => readStringArray(event.source_block_ids)),
        ),
      });
    }
  }

  for (let index = 0; index < comparisons.length; index += 1) {
    const comparison = comparisons[index];
    const basePath = `/display_payload/data/performance_comparisons/${index}`;
    const currentLabel = stringValue(comparison.current_label);
    const comparisonLabel = stringValue(comparison.comparison_label);
    if (operatingPeriodScopesConflict(currentLabel, comparisonLabel)) {
      const comparisonFieldPaths = [
        `${basePath}/current_label`,
        `${basePath}/current_value`,
        `${basePath}/current_numeric`,
        `${basePath}/comparison_label`,
        `${basePath}/comparison_value`,
        `${basePath}/comparison_numeric`,
        `${basePath}/comparison_basis`,
        `${basePath}/change_note`,
      ];
      issues.push({
        code: `operating_comparison_period_scope_${index}`,
        warning: "Operating performance comparison mixes incompatible period scopes, so the displayed change is not meaningful.",
        field_paths: comparisonFieldPaths,
        allowed_patch_paths: comparisonFieldPaths,
        candidate_source_block_ids: [],
      });
      continue;
    }
    const inferredBasis = inferOperatingComparisonBasis(
      currentLabel,
      comparisonLabel,
    );
    const statedBasis = normalizeOperatingComparisonBasis(comparison.comparison_basis);
    if (inferredBasis && inferredBasis !== statedBasis) {
      issues.push({
        code: `operating_comparison_basis_${index}`,
        warning: "Operating performance comparison basis conflicts with the displayed current and comparison period labels.",
        field_paths: [`${basePath}/comparison_basis`, `${basePath}/change_note`],
        allowed_patch_paths: [`${basePath}/comparison_basis`, `${basePath}/change_note`],
        candidate_source_block_ids: [],
      });
    }

    const current = numberValue(comparison.current_numeric);
    const prior = numberValue(comparison.comparison_numeric);
    const changeNote = stringValue(comparison.change_note);
    if (current != null && prior != null && changeNote && operatingChangeNoteContradictsValues(current, prior, changeNote)) {
      issues.push({
        code: `operating_change_note_direction_${index}`,
        warning: "Operating performance change note states a direction that conflicts with the displayed signed numeric values.",
        field_paths: [`${basePath}/change_note`],
        allowed_patch_paths: [`${basePath}/change_note`],
        candidate_source_block_ids: [],
      });
    }
  }

  if (operatingMode === "earnings") {
    for (let index = 0; index < snapshotMetrics.length; index += 1) {
      const metric = snapshotMetrics[index];
      const label = stringValue(metric.label);
      const value = stringValue(metric.value);
      if (!operatingSnapshotLossSignMissing(label, value, comparisons)) continue;
      const valuePath = `/display_payload/data/snapshot_metrics/${index}/value`;
      issues.push({
        code: `operating_snapshot_sign_conflict_${index}`,
        warning: "Earnings Snapshot presents a source-disclosed loss or negative per-share amount without a negative sign or parentheses, or conflicts with the signed performance comparison.",
        field_paths: [valuePath],
        allowed_patch_paths: [valuePath],
        candidate_source_block_ids: primarySourceBlockIds,
      });
    }

    const score = numberValue(analysisOutput.score);
    const directions = comparisons
      .map(operatingComparisonDirection)
      .filter((value): value is "improved" | "deteriorated" => value !== null);
    const hasMixedPerformance = directions.includes("improved") && directions.includes("deteriorated");
    const scoreReason = stringValue(analysisOutput.score_reason);
    const scoreExplanationSummary = stringValue(readRecord(analysisOutput.score_explanation)?.summary);
    const improvedFamilies = comparisons
      .filter((comparison) => operatingComparisonDirection(comparison) === "improved")
      .flatMap((comparison) => {
        const family = operatingMetricFamily(stringValue(comparison.label));
        return family ? [family] : [];
      });
    const rationaleStatesOffset = (value: string) =>
      improvedFamilies.some((family) => operatingRationaleMentionsFamily(value, family)) &&
      /\b(?:but|despite|although|offset|partly|partially|while|however)\b/i.test(value);
    const bothRationalesStateOffset =
      rationaleStatesOffset(scoreReason) && rationaleStatesOffset(scoreExplanationSummary);
    const visibleEarningsContext = [
      stringValue(analysisOutput.summary),
      scoreReason,
      scoreExplanationSummary,
      ...snapshotMetrics.map((row) => `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`),
      ...comparisons.map(
        (row) => `${stringValue(row.label)} ${stringValue(row.current_value)} ${stringValue(row.comparison_value)} ${stringValue(row.change_note)}`,
      ),
    ].join(" ");
    const hasNonCashOrOneTimeLossDriver =
      /\b(?:non[-\s]?cash|impairment|write[-\s]?down|purchase accounting|tax benefit|one[-\s]?time|nonrecurring)\b/i.test(
        visibleEarningsContext,
      );
    const relevantSourceBlocks = sourceBlocks.filter((block) => {
      const blockId = stringValue(block.block_id);
      return !primarySourceBlockIds.length || primarySourceBlockIds.includes(blockId);
    });
    const nonCashGainSourceBlocks = relevantSourceBlocks.filter((block) =>
      operatingTextHasNonCashOrOneTimeGain(stringValue(block.text)),
    );
    const hasNonCashOrOneTimeGainDriver =
      operatingTextHasNonCashOrOneTimeGain(visibleEarningsContext) || nonCashGainSourceBlocks.length > 0;

    if (
      score != null &&
      score >= 75 &&
      hasMixedPerformance &&
      (!bothRationalesStateOffset || hasNonCashOrOneTimeLossDriver)
    ) {
      issues.push({
        code: "operating_earnings_alert_offset_missing",
        warning: "Alert-level earnings result contains materially opposing trends or a loss driven by non-cash or one-time items. Reassess whether adjusted performance, cash flow, guidance, demand, or another near-term driver supports that impact range, and state the strongest material offset in both score rationales.",
        field_paths: [
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        allowed_patch_paths: [
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        candidate_source_block_ids: primarySourceBlockIds,
      });
    }

    if (score != null && score >= 75 && hasNonCashOrOneTimeGainDriver) {
      issues.push({
        code: "operating_earnings_alert_noncash_gain_dominant",
        warning: "Alert-level earnings result includes a material non-cash or one-time accounting gain. Reassess signal and score from recurring operating performance, adjusted profitability, cash flow, demand, and guidance; identify the accounting driver in Summary.",
        field_paths: [
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/summary",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        allowed_patch_paths: [
          "/analysis_output/score",
          "/analysis_output/signal",
          "/analysis_output/summary",
          "/analysis_output/score_reason",
          "/analysis_output/score_explanation/summary",
        ],
        candidate_source_block_ids: uniqueStrings([
          ...primarySourceBlockIds,
          ...nonCashGainSourceBlocks.map((block) => stringValue(block.block_id)),
        ]),
      });
    }
  }
  return issues;
}

function primaryMaterialEventSourceIds(analysisOutput: Record<string, unknown>) {
  return uniqueStrings(
    readRecordArray(analysisOutput.material_events)
      .filter((event) => stringValue(event.role) === "primary")
      .flatMap((event) => readStringArray(event.source_block_ids)),
  );
}

function operatingSnapshotLossSignMissing(
  label: string,
  value: string,
  comparisons: Array<Record<string, unknown>>,
) {
  if (!/\d/.test(value) || operatingValueShowsNegative(value)) return false;
  const normalizedLabel = normalizeOperatingMetricLabel(label);
  if (/\b(?:net |operating |gross )?loss(?: per (?:basic |diluted )?share)?\b/.test(normalizedLabel)) return true;

  const family = operatingMetricFamily(label);
  if (!family) return false;
  return comparisons.some(
    (comparison) =>
      operatingMetricFamily(stringValue(comparison.label)) === family &&
      numberValue(comparison.current_numeric) != null &&
      (numberValue(comparison.current_numeric) as number) < 0,
  );
}

function operatingValueShowsNegative(value: string) {
  const normalized = value.trim();
  return /^-/.test(normalized) || /^\(.*\)$/.test(normalized) || /^\$?\(.*\)$/.test(normalized);
}

function operatingComparisonDirection(comparison: Record<string, unknown>): "improved" | "deteriorated" | null {
  const current = numberValue(comparison.current_numeric);
  const prior = numberValue(comparison.comparison_numeric);
  if (current == null || prior == null || current === prior) return null;
  const family = operatingMetricFamily(stringValue(comparison.label));
  if (!family) return null;
  if (family === "operating_expenses") return current < prior ? "improved" : "deteriorated";
  if ([
    "revenue",
    "net_interest_income",
    "gross_profit",
    "operating_profit",
    "net_profit",
    "free_cash_flow",
    "ebitda",
    "eps",
    "gross_margin",
    "operating_margin",
  ].includes(family)) {
    return current > prior ? "improved" : "deteriorated";
  }
  return null;
}

function operatingRationaleMentionsFamily(value: string, family: string) {
  const patterns: Record<string, RegExp> = {
    revenue: /\b(?:revenue|revenues|sales)\b/i,
    net_interest_income: /\bnet interest income\b/i,
    gross_profit: /\bgross (?:profit|income|margin)\b/i,
    operating_profit: /\boperating (?:profit|income|loss|margin)\b/i,
    net_profit: /\bnet (?:profit|income|loss|earnings)\b/i,
    free_cash_flow: /\bfree cash flow\b/i,
    ebitda: /\bEBITDA\b/i,
    eps: /\b(?:EPS|earnings per share)\b/i,
    gross_margin: /\bgross margin\b/i,
    operating_margin: /\boperating margin\b/i,
  };
  return patterns[family]?.test(value) === true;
}

function operatingTextHasNonCashOrOneTimeGain(value: string) {
  if (!value) return false;
  return [
    /\b(?:non[-\s]?cash|one[-\s]?time|nonrecurring)\b[^.\n]{0,180}\b(?:gain|income|benefit|profit)\b/i,
    /\b(?:gain|income|benefit|profit)\b[^.\n]{0,180}\b(?:non[-\s]?cash|one[-\s]?time|nonrecurring)\b/i,
    /\b(?:fair[-\s]?value|mark[-\s]?to[-\s]?market|remeasurement)\b[^.\n]{0,180}\b(?:gain|income|benefit|profit)\b/i,
    /\b(?:gain|income|benefit|profit)\b[^.\n]{0,180}\b(?:fair[-\s]?value|mark[-\s]?to[-\s]?market|remeasurement)\b/i,
    /\bwarrant liabilit(?:y|ies)\b[^.\n]{0,180}\b(?:gain|income|decrease|remeasurement|fair[-\s]?value change)\b/i,
    /\b(?:tax benefit|bargain purchase gain|gain on (?:sale|disposal|remeasurement|extinguishment))\b/i,
  ].some((pattern) => pattern.test(value));
}

function projectEconomicsFactGroups(value: string) {
  const groups: string[] = [];
  if (/\b(?:NPV|net present value|IRR|internal rate of return|project valuation)\b/i.test(value)) {
    groups.push("valuation");
  }
  if (/\b(?:ownership|equity interest|working interest|stake)\b/i.test(value)) {
    groups.push("ownership");
  }
  const hasProjectResource = /\b(?:reserves?|resources?)\b/i.test(value);
  const hasLongTermCapacity =
    /\b(?:nameplate|design|stage \d+) capacity\b\s*(?:(?:of|is|was|at|:)\s*)?\d[\d,.]*\s*(?:tonnes?|tons?|units?|MW|GW|GWh|barrels?)\b/i.test(
      value,
    ) ||
    /\b\d[\d,.]*\s*(?:tonnes?|tons?|units?|MW|GW|GWh|barrels?)\s+(?:nameplate|design|stage \d+) capacity\b/i.test(
      value,
    );
  if (hasProjectResource || hasLongTermCapacity) {
    groups.push("resource or capacity");
  }
  if (/\b(?:operating cost|unit cost|cash cost|cost per (?:tonne|ton|unit)|long-term cost)\b/i.test(value)) {
    groups.push("unit economics");
  }
  return groups;
}

function projectEconomicsSourceFactGroups(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  return projectEconomicsFactGroups(text).filter((group) => {
    if (group === "valuation") {
      return /\b(?:NPV|net present value|IRR|internal rate of return|project valuation)\b[^.]{0,140}(?:\$|US\$|\d)/i.test(text) ||
        /(?:\$|US\$|\d)[^.]{0,140}\b(?:NPV|net present value|IRR|internal rate of return|project valuation)\b/i.test(text);
    }
    if (group === "ownership") {
      return /\b(?:ownership|equity interest|working interest|stake)\b[^.]{0,100}\d[\d,.]*\s*%/i.test(text) ||
        /\d[\d,.]*\s*%[^.]{0,100}\b(?:ownership|equity interest|working interest|stake)\b/i.test(text);
    }
    if (group === "resource or capacity") {
      return /\b\d[\d,.]*\s*(?:tonnes?|tons?|units?|MW|GW|GWh|barrels?)\b/i.test(text);
    }
    if (group === "unit economics") {
      return /(?:\$|US\$)?\s*\d[\d,.]*\s*(?:\/|per\s+)(?:tonne|ton|unit)\b/i.test(text) ||
        /\b(?:operating cost|unit cost|cash cost)\b[^.]{0,100}(?:\$|US\$|\d)/i.test(text);
    }
    return false;
  });
}

function appendSec8k6kValidationSemanticWarnings(
  displayPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
) {
  const warnings = getSec8k6kValidationSemanticWarnings(displayPayload, analysisOutput);
  if (!warnings.length) return displayPayload;
  const data = readRecord(displayPayload.data) || {};
  return {
    ...displayPayload,
    data: {
      ...data,
      display_warnings: uniqueStrings([...readStringArray(data.display_warnings), ...warnings]),
    },
  };
}

function isDefinitiveStatusOrDateLabel(label: string) {
  return /\b(?:effective|completion|completed|closing|closed|delisting|delisted|removal|removed|suspension|suspended|termination|terminated)\s+(?:date|status)\b/i.test(
    label,
  );
}

function hasConditionalStateLanguage(value: string) {
  return /\b(?:expected|planned|pending|proposed|subject to|conditioned on|conditional|if approved|if completed|if conditions|would|could|may)\b/i.test(
    value,
  );
}

function hasDefinitiveCompletionLanguage(value: string) {
  return /\b(?:effective|completed|closed|consummated|delisted|removed|suspended|terminated|defaulted|triggered)\b/i.test(
    value,
  );
}

function operatingChangeNoteContradictsValues(current: number, prior: number, note: string) {
  const normalized = note.toLowerCase();
  const saysIncrease = /\b(?:up|increased?|grew|growth|improved|rose|higher|narrowed|turned profitable)\b/.test(normalized);
  const saysDecrease = /\b(?:down|decreased?|declined?|fell|lower|widened|deteriorated|weakened)\b/.test(normalized);
  if (!saysIncrease && !saysDecrease) return false;

  if (current < 0 && prior < 0) {
    const lossImproved = Math.abs(current) < Math.abs(prior);
    return (lossImproved && saysDecrease && !/\bnarrowed\b/.test(normalized)) ||
      (!lossImproved && saysIncrease && !/\bwidened\b/.test(normalized));
  }
  if (current >= 0 && prior < 0) return saysDecrease;
  if (current < 0 && prior >= 0) return saysIncrease;
  return (current > prior && saysDecrease) || (current < prior && saysIncrease);
}

function normalizeSecurityCoverageValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildSec8k6kPromptInput(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 8-K/6-K parser output is missing from filing package");
  }

  return {
    filing_package: filingPackage,
    parser_output: parserOutput,
    filing_excerpt: stringValue(filingPackage.llm_text) || null,
    parent_filing_context: readRecord(filingPackage.parent_filing_context) || null,
    related_filing_contexts: readRecordArray(filingPackage.related_filing_contexts),
  };
}

function buildSec8k6kPromptMetadata(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
) {
  const parserOutput = readSec8k6kParserOutput(input);
  const promptFamily = resolveSec8k6kAnalysisPromptFamily(routerResult);
  const analysisPromptKey = {
    risk_status: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.riskStatus,
    capital_financing: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.capitalFinancing,
    strategic_transaction: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.strategicTransaction,
    governance_vote: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.governanceVote,
    operating_legal_routine: SEC_8K_6K_ANALYSIS_PROMPT_KEYS.operatingLegalRoutine,
  }[promptFamily];

  return {
    parser_version: nullableString(parserOutput?.parserVersion),
    router_prompt_key: SEC_8K_6K_ROUTER_PROMPT_KEY,
    router_prompt_version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
    analysis_prompt_key: analysisPromptKey,
    analysis_prompt_version: SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  };
}

function normalize8k6kAnalysisForPersistence(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);

  return {
    ...value,
    source_group: stringValue(value.source_group) || "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    material_events: normalizeMaterialEvents(value.material_events),
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    listing_status_snapshot: normalizeListingStatusSnapshot(value.listing_status_snapshot),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function normalizeMaterialEvents(value: unknown) {
  return readRecordArray(value)
    .map((item) => ({
      role: stringValue(item.role) === "secondary" ? "secondary" : "primary",
      event_type: normalizeEventType(stringValue(item.event_type)),
      event_summary: stringValue(item.event_summary),
      key_terms: readStringArray(item.key_terms).slice(0, 5),
      source_block_ids: readStringArray(item.source_block_ids).slice(0, 8),
    }))
    .filter((item) => item.event_summary)
    .slice(0, 4);
}

function normalizeListingStatusSnapshot(value: unknown) {
  return readRecordArray(value)
    .map((item) => ({
      label: stringValue(item.label),
      value: stringValue(item.value),
      note: nullableString(item.note),
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 4);
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
      reason: "Primary ticker from SEC filing package",
    });
  }

  return normalized;
}

function buildDisplayPayload(
  parserOutput: Record<string, unknown>,
  routerResult: Record<string, unknown>,
  marketContext: Record<string, unknown> | null,
) {
  return buildSec8k6kDisplayPayload({
    parser_output: parserOutput,
    router_result: routerResult,
    market_context: marketContext,
  });
}

export function normalizeSec8k6kOperatingDisplayPayloadForPersistence(payload: Record<string, unknown>) {
  if (stringValue(payload.display_type) !== "operating_event") return payload;
  const data = readRecord(payload.data);
  if (!data) return payload;
  const operatingMode = stringValue(data.operating_mode);
  if (operatingMode !== "earnings" && operatingMode !== "operating_update") return payload;

  const comparisons = readRecordArray(data.performance_comparisons);
  const guidanceMetrics = readRecordArray(data.guidance_metrics);
  const businessCatalysts = readRecordArray(data.business_catalysts);
  const normalizedComparisons: Array<Record<string, unknown>> = comparisons.map((comparison) => ({
    ...comparison,
    comparison_basis:
      inferOperatingComparisonBasis(
        stringValue(comparison.current_label),
        stringValue(comparison.comparison_label),
      ) || normalizeOperatingComparisonBasis(comparison.comparison_basis),
  }));
  if (!guidanceMetrics.length) {
    return {
      ...payload,
      data: {
        ...data,
        performance_comparisons: normalizedComparisons,
      },
    };
  }

  const normalizedGuidance: Array<Record<string, unknown>> = guidanceMetrics.map((guidance) => {
    const guidanceLow = numberValue(guidance.guidance_low_numeric);
    const guidanceHigh = numberValue(guidance.guidance_high_numeric);
    const guidanceKind = normalizeOperatingGuidanceKind(guidance.guidance_kind, guidanceLow, guidanceHigh);
    const guidanceFamily = operatingMetricFamily(stringValue(guidance.label));
    if (!guidanceFamily) {
      return {
        ...guidance,
        guidance_kind: guidanceKind,
        guidance_low_numeric: guidanceLow,
        guidance_high_numeric: guidanceHigh,
        performance_relationship: "standalone",
        performance_label: null,
      };
    }

    const candidates = normalizedComparisons.filter(
      (comparison) => operatingMetricFamily(stringValue(comparison.label)) === guidanceFamily,
    );
    if (!candidates.length) {
      return {
        ...guidance,
        guidance_kind: guidanceKind,
        guidance_low_numeric: guidanceLow,
        guidance_high_numeric: guidanceHigh,
        performance_relationship: "standalone",
        performance_label: null,
      };
    }

    const guidanceAdjusted = isAdjustedPerformanceMetric(stringValue(guidance.label));
    const matchingBasis = candidates.find(
      (comparison) => isAdjustedPerformanceMetric(stringValue(comparison.label)) === guidanceAdjusted,
    );
    const target = matchingBasis || candidates[0];
    const normalizedRange = normalizeGuidanceRangeToPerformanceUnit(
      stringValue(guidance.guidance_value),
      stringValue(target.current_value),
    );

    return {
      ...guidance,
      guidance_kind: normalizedRange
        ? normalizeOperatingGuidanceKind("", normalizedRange[0], normalizedRange[1])
        : guidanceKind,
      guidance_low_numeric: normalizedRange?.[0] ?? guidanceLow,
      guidance_high_numeric: normalizedRange?.[1] ?? guidanceHigh,
      performance_relationship: matchingBasis ? "same_basis" : "related_different_basis",
      performance_label: stringValue(target.label),
    };
  });
  const standaloneGuidance = normalizedComparisons.length
    ? normalizedGuidance.filter((guidance) => guidance.performance_relationship === "standalone")
    : [];
  const visibleGuidance = normalizedGuidance
    .filter((guidance) => !standaloneGuidance.includes(guidance))
    .slice(0, 3);
  const promotedGuidance = standaloneGuidance.map((guidance) => {
    const guidanceLabel = stringValue(guidance.guidance_label);
    return {
      title: stringValue(guidance.label),
      value: stringValue(guidance.guidance_value) || null,
      summary:
        stringValue(guidance.note) ||
        (guidanceLabel ? `${guidanceLabel} company outlook.` : "Company outlook disclosed in the filing."),
    };
  });
  const normalizedBusinessCatalysts = [...promotedGuidance, ...businessCatalysts]
    .filter((item, index, rows) => {
      const key = `${stringValue(item.title).toLowerCase()}|${stringValue(item.value).toLowerCase()}`;
      return key !== "|" && rows.findIndex((candidate) =>
        `${stringValue(candidate.title).toLowerCase()}|${stringValue(candidate.value).toLowerCase()}` === key
      ) === index;
    })
    .slice(0, 3);

  return {
    ...payload,
    data: {
      ...data,
      performance_comparisons: normalizedComparisons,
      guidance_metrics: visibleGuidance,
      business_catalysts: normalizedBusinessCatalysts,
    },
  };
}

function normalizeOperatingComparisonBasis(value: unknown) {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "yoy" || normalized === "qoq" || normalized === "other") return normalized;
  return "other";
}

function normalizeOperatingGuidanceKind(value: unknown, low: number | null, high: number | null) {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "numeric_range" || normalized === "point" || normalized === "qualitative") {
    return normalized;
  }
  if (low !== null && high !== null) return low === high ? "point" : "numeric_range";
  if (low !== null || high !== null) return "point";
  return "qualitative";
}

function inferOperatingComparisonBasis(currentLabel: string, comparisonLabel: string) {
  const current = parseOperatingQuarterLabel(currentLabel);
  const comparison = parseOperatingQuarterLabel(comparisonLabel);
  if (current && comparison) {
    if (current.quarter === comparison.quarter && current.year === comparison.year + 1) return "yoy";
    const currentSequence = current.year * 4 + current.quarter;
    const comparisonSequence = comparison.year * 4 + comparison.quarter;
    if (currentSequence === comparisonSequence + 1) return "qoq";
    return "other";
  }

  const currentYear = parseOperatingFiscalYearLabel(currentLabel);
  const comparisonYear = parseOperatingFiscalYearLabel(comparisonLabel);
  if (currentYear !== null && comparisonYear !== null && currentYear === comparisonYear + 1) return "yoy";
  return null;
}

function operatingPeriodScopesConflict(currentLabel: string, comparisonLabel: string) {
  const currentScope = parseOperatingPeriodScope(currentLabel);
  const comparisonScope = parseOperatingPeriodScope(comparisonLabel);
  return Boolean(currentScope && comparisonScope && currentScope !== comparisonScope);
}

function parseOperatingPeriodScope(label: string) {
  const normalized = label.toLowerCase().replace(/[??]/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (parseOperatingQuarterLabel(normalized)) return "quarter";
  if (/\b(?:h1|h2|1h|2h)\s*(?:fy\s*)?\d{2,4}\b|\b(?:first|second) half\b|\bsix months?\b/.test(normalized)) {
    return "half_year";
  }
  if (/\b(?:9m|nine months?)\b/.test(normalized)) return "nine_months";
  if (/\b(?:ytd|year[ -]to[ -]date)\b/.test(normalized)) return "year_to_date";
  if (parseOperatingFiscalYearLabel(normalized) !== null || /^(?:calendar year\s*)?\d{4}$/.test(normalized)) {
    return "full_year";
  }
  return null;
}

function parseOperatingQuarterLabel(label: string) {
  const normalized = label.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  const quarterFirst = normalized.match(/\bq([1-4])\s*(?:fy\s*)?(\d{2,4})\b/);
  const numberFirst = normalized.match(/\b([1-4])q\s*(?:fy\s*)?(\d{2,4})\b/);
  const wordQuarter = normalized.match(/\b(first|second|third|fourth) quarter\s+(\d{4})\b/);
  const match = quarterFirst || numberFirst;
  if (match) {
    return {
      quarter: Number(match[1]),
      year: normalizeOperatingPeriodYear(Number(match[2])),
    };
  }
  if (!wordQuarter) return null;
  return {
    quarter: { first: 1, second: 2, third: 3, fourth: 4 }[wordQuarter[1] as "first" | "second" | "third" | "fourth"],
    year: Number(wordQuarter[2]),
  };
}

function parseOperatingFiscalYearLabel(label: string) {
  const normalized = label.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b(?:fy|fiscal year|full year)\s*(\d{2,4})\b/);
  return match ? normalizeOperatingPeriodYear(Number(match[1])) : null;
}

function normalizeOperatingPeriodYear(value: number) {
  return value < 100 ? 2000 + value : value;
}

function operatingMetricFamily(label: string) {
  const normalized = normalizeOperatingMetricLabel(label);
  if (!normalized) return null;

  if (/^(?:total )?net interest income$/.test(normalized)) return "net_interest_income";
  if (/^(?:total |net )?(?:revenue|revenues|sales)$/.test(normalized)) return "revenue";
  if (/^(?:total )?(?:operating expenses?|opex)$/.test(normalized)) return "operating_expenses";
  if (/^(?:total )?gross margins?$/.test(normalized)) return "gross_margin";
  if (/^(?:total )?operating margins?$/.test(normalized)) return "operating_margin";
  if (/^(?:total )?gross (?:income|profit|loss|profits|losses)$/.test(normalized)) return "gross_profit";
  if (/^(?:total )?operating (?:income|profit|loss|profits|losses)(?: income| profit| loss)?$/.test(normalized)) {
    return "operating_profit";
  }
  if (/^(?:total )?net (?:income|profit|loss|profits|losses)(?: attributable to .+)?$/.test(normalized)) {
    return "net_profit";
  }
  if (/^(?:levered |unlevered )?free cash flow$/.test(normalized)) return "free_cash_flow";
  if (/^(?:total )?ebitda$/.test(normalized)) return "ebitda";
  if (/^(?:(?:net )?(?:income|earnings|profit|loss) per )?(?:basic |diluted )?share$/.test(normalized)) return "eps";
  if (/^(?:basic |diluted )?(?:eps|earnings per share)$/.test(normalized)) return "eps";
  if (/^(?:gross )?bookings?$/.test(normalized)) return "gross_bookings";
  if (/^(?:gmv|gross merchandise value|gross merchandise volume)$/.test(normalized)) return "gmv";
  if (/\b(?:production|output)\b/.test(normalized)) return "production";
  if (/\b(?:deliveries|delivery volume|shipments?)\b/.test(normalized)) return "deliveries";
  if (/\b(?:capacity utilization|utilization|uptime)\b/.test(normalized)) return "utilization";
  if (/\b(?:hash ?rate|hashrate)\b/.test(normalized)) return "hashrate";
  if (/\b(?:customers?|subscribers?|active users?|monthly active users?)\b/.test(normalized)) return "customers";
  if (/\b(?:sales volume|transaction volume|operating volume)\b/.test(normalized)) return "operating_volume";
  return null;
}

function normalizeOperatingMetricLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:q[1-4]|fy)\s*(?:19|20)?\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:guidance|outlook|forecast|target|range)\b/g, " ")
    .replace(/\b(?:adjusted|non gaap|non ifrs|gaap|ifrs)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdjustedPerformanceMetric(label: string) {
  return /\b(?:adjusted|non[ -]gaap|non[ -]ifrs)\b/i.test(label);
}

function normalizeGuidanceRangeToPerformanceUnit(guidanceValue: string, performanceValue: string) {
  const targetScale = financialUnitScale(performanceValue);
  if (!targetScale) return null;

  const amounts = Array.from(
    guidanceValue.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|[BM])\b/gi),
    (match) => {
      const numeric = Number(match[1].replace(/,/g, ""));
      const scale = financialUnitScale(match[2]);
      return Number.isFinite(numeric) && scale ? (numeric * scale) / targetScale : null;
    },
  ).filter((value): value is number => value !== null);

  if (!amounts.length) return null;
  return [Math.min(...amounts), Math.max(...amounts)] as const;
}

function financialUnitScale(value: string) {
  if (/\bbillion\b|\bB\b/i.test(value)) return 1_000_000_000;
  if (/\bmillion\b|\bM\b/i.test(value)) return 1_000_000;
  return null;
}

function selectDisplayPayloadForPersistence(
  analysisDisplayPayload: Record<string, unknown> | null,
  generatedDisplayPayload: Record<string, unknown>,
) {
  const displayType = stringValue(analysisDisplayPayload?.display_type);
  if (
    displayType !== "capital_financing" &&
    displayType !== "strategic_transaction" &&
    displayType !== "governance_event" &&
    displayType !== "operating_event"
  ) {
    return generatedDisplayPayload;
  }

  return {
    display_type: displayType,
    data: readRecord(analysisDisplayPayload?.data) || {},
    evidence: readStringArray(analysisDisplayPayload?.evidence),
    notes: readStringArray(analysisDisplayPayload?.notes),
  };
}

function readSec8k6kParserOutput(input: SecFilingAnalysisInput): Record<string, unknown> | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.["8k-6k"]);
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext) || null;
}

function readPrimaryTicker(filingPackage: Record<string, unknown>, facts: Record<string, unknown>) {
  const packageTicker = readRecord(filingPackage.primary_ticker);
  const ticker = stringValue(packageTicker?.ticker) || stringValue(facts.ticker);
  const exchange = stringValue(packageTicker?.exchange);
  return {
    ticker: ticker || null,
    exchange: exchange || null,
  };
}

function normalizePrimaryTicker(value: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const fallback = readRecord(filingPackage.primary_ticker);
  return {
    ticker: stringValue(value?.ticker) || stringValue(fallback?.ticker) || null,
    exchange: stringValue(value?.exchange) || stringValue(fallback?.exchange) || null,
  };
}

function buildArchiveEventTitle(filingPackage: Record<string, unknown>, facts: Record<string, unknown>, eventType: string) {
  const ticker = stringValue(readRecord(filingPackage.primary_ticker)?.ticker) || stringValue(facts.ticker);
  const formType = stringValue(filingPackage.form_type) || stringValue(facts.secFormType) || "8-K/6-K";
  const company = stringValue(filingPackage.company_name) || stringValue(facts.companyName) || ticker || "Issuer";
  const label = eventType === "other" ? "current report" : eventType.replace(/_/g, " ");
  return `${ticker || company} ${formType} ${label}`;
}

function buildArchiveInvestorSummary(filingPackage: Record<string, unknown>, facts: Record<string, unknown>) {
  const ticker = stringValue(readRecord(filingPackage.primary_ticker)?.ticker) || stringValue(facts.ticker);
  const formType = stringValue(filingPackage.form_type) || stringValue(facts.secFormType) || "8-K/6-K";
  const company = stringValue(filingPackage.company_name) || stringValue(facts.companyName) || ticker || "The issuer";
  const article = /^8\b/.test(formType) ? "an" : "a";
  return `${company} filed ${article} ${formType} current report. The original filing and attachments are available below for review.`;
}

function normalizeEventType(value: string) {
  const allowed = new Set([
    "listing_risk",
    "dilution_risk",
    "ipo_listing",
    "earnings",
    "sales_performance",
    "operating_update",
    "product_update",
    "leadership_governance",
    "insider_ownership",
    "shareholder_vote",
    "strategic_transaction",
    "financial_risk",
    "legal_risk",
    "dividends",
    "capital_return",
    "fda_clinical",
    "other",
  ]);
  return allowed.has(value) ? value : "other";
}

function normalizeRouterDisplayType(value: unknown) {
  const displayType = stringValue(value);
  if (displayType === "offering_terms" || displayType === "capital_financing" || displayType === "spac_transaction_status" || displayType === "candidate_special") {
    return displayType;
  }
  return "generic";
}

function normalizeRouterDisplayVersion(value: unknown, displayType: string) {
  const version = stringValue(value);
  if (
    version === "sec_8k_6k_generic_v1" ||
    version === "sec_8k_6k_offering_terms_v1" ||
    version === "sec_8k_6k_capital_financing_v1" ||
    version === "sec_8k_6k_spac_transaction_status_v1" ||
    version === "sec_8k_6k_candidate_special_v1"
  ) {
    return version;
  }
  if (displayType === "offering_terms") return "sec_8k_6k_offering_terms_v1";
  if (displayType === "capital_financing") return "sec_8k_6k_capital_financing_v1";
  if (displayType === "spac_transaction_status") return "sec_8k_6k_spac_transaction_status_v1";
  if (displayType === "candidate_special") return "sec_8k_6k_candidate_special_v1";
  return "sec_8k_6k_generic_v1";
}

function normalizeConfidence(value: string) {
  return value === "high" || value === "low" ? value : "medium";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function selectValidationRepairSourceBlocks(
  analysisResult: Record<string, unknown>,
  sourceBlocks: Record<string, unknown>[],
  issues: Sec8k6kValidationRepairIssue[],
) {
  const analysisOutput = readRecord(analysisResult.analysis_output) || {};
  const citedIds = uniqueStrings([
    ...readRecordArray(analysisOutput.material_events).flatMap((event) => readStringArray(event.source_block_ids)),
    ...readStringArray(analysisResult.source_blocks_used),
  ]);
  const citedRank = new Map(citedIds.map((id, index) => [id, citedIds.length - index]));
  const issueSourceIds = new Set(issues.flatMap((issue) => issue.candidate_source_block_ids));
  const hasRiskIssue = issues.some((issue) => issue.code.startsWith("risk_"));
  const hasCapitalIssue = issues.some((issue) => issue.code.startsWith("capital_"));
  const hasStrategicIssue = issues.some((issue) => issue.code.startsWith("strategic_"));
  const hasGovernanceAuditorIssue = issues.some((issue) => issue.code.startsWith("governance_auditor_"));
  const hasOperatingIssue = issues.some((issue) => issue.code.startsWith("operating_"));
  const hasEncodingIssue = issues.some((issue) => issue.code.startsWith("text_encoding_"));
  const hasAmountQualifierIssue = issues.some((issue) => issue.code === "source_material_amount_qualifier_omitted");
  const hasAmendmentIssue = issues.some((issue) => issue.code.startsWith("amendment_"));

  const ranked = sourceBlocks
    .filter((block) => stringValue(block.block_id) && stringValue(block.text))
    .map((block, index) => {
      const blockId = stringValue(block.block_id);
      const itemNumber = stringValue(block.item_number);
      const exhibitNumber = stringValue(block.exhibit_number);
      const sourceText = `${stringValue(block.label)} ${stringValue(block.text).slice(0, 5000)}`;
      let score = (citedRank.get(blockId) || 0) * 100;
      if (stringValue(block.origin).startsWith("integration.amendment_repair")) score += 250;
      if (issueSourceIds.has(blockId)) score += 1_000;
      if (hasRiskIssue && /^(?:1\.03|2\.04|2\.05|2\.06|3\.01|4\.02|8\.01)$/.test(itemNumber)) score += 80;
      if (hasRiskIssue && /delist|suspend|default|bankrupt|going concern|non-reliance|restatement/i.test(sourceText)) score += 35;
      if (hasCapitalIssue && /^(?:1\.01|2\.03|3\.02|5\.07|8\.01)$/.test(itemNumber)) score += 80;
      if (hasCapitalIssue && /warrant|convertible|preferred|pre-funded|offering|financing|credit agreement|indenture/i.test(sourceText)) score += 35;
      if (hasStrategicIssue && /^(?:2\.01|3\.01|5\.07|8\.01)$/.test(itemNumber)) score += 80;
      if (hasStrategicIssue && /merger|acquisition|tender offer|business combination|closing|transaction/i.test(sourceText)) score += 35;
      if (hasGovernanceAuditorIssue && itemNumber === "4.01") score += 80;
      if (hasGovernanceAuditorIssue && exhibitNumber === "16.1") score += 60;
      if (hasGovernanceAuditorIssue && /certifying accountant|auditor|accounting firm/i.test(sourceText)) score += 30;
      if (hasOperatingIssue && /^(?:2\.02|2\.05|2\.06|7\.01|8\.01)$/.test(itemNumber)) score += 80;
      if (hasOperatingIssue && /results|revenue|income|loss|guidance|outlook|restructuring|operating|NPV|net present value|ownership|technical report|unit cost/i.test(sourceText)) score += 35;
      if (hasEncodingIssue && /(?:™|&trade;|®|&reg;|©|&copy;)/i.test(sourceText)) score += 60;
      if (hasAmountQualifierIssue && /\b(?:offset|net of|less|deduct|reduc|payable|amounts? owed|owe to)\b/i.test(sourceText)) score += 80;
      if (hasAmendmentIssue && stringValue(block.origin).startsWith("integration.amendment_repair")) score += 500;
      if (hasAmendmentIssue && citedRank.has(blockId)) score += 350;
      return { block, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.block);

  if (hasAmendmentIssue) {
    const historical = ranked.filter((block) =>
      stringValue(block.origin).startsWith("integration.amendment_repair")
    ).slice(0, 2);
    const current = ranked.filter((block) =>
      !stringValue(block.origin).startsWith("integration.amendment_repair")
    ).slice(0, 1);
    return dedupeValidationRepairSourceBlocks([...historical, ...current]).slice(0, 3);
  }

  return ranked.slice(0, 3);
}

function dedupeValidationRepairSourceBlocks(sourceBlocks: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return sourceBlocks.filter((block) => {
    const blockId = stringValue(block.block_id);
    const text = stringValue(block.text).replace(/\s+/g, " ").trim();
    if (!blockId || !text) return false;
    const key = `${blockId}\u0000${text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasLikelyMojibake(value: string) {
  return /(?:Ã[\u0080-\u00ff]?|Â[\u0080-\u00ff]?|â[\u0080-\u00ff]|ï¿½|\uFFFD|[\u0080-\u009F])/.test(value);
}

export function repairSec8k6kDisplayPayloadEncoding(value: Record<string, unknown>) {
  return repairSec8k6kDisplayValue(value) as Record<string, unknown>;
}

function repairSec8k6kDisplayValue(value: unknown): unknown {
  if (typeof value === "string") return repairSec8k6kUtf8Mojibake(value);
  if (Array.isArray(value)) return value.map(repairSec8k6kDisplayValue);
  const record = readRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, repairSec8k6kDisplayValue(item)]),
  );
}

function repairSec8k6kUtf8Mojibake(value: string) {
  if (!/[\u00c2\u00c3\u00e2]/.test(value)) return value;
  const characters = Array.from(value);
  let repaired = "";

  for (let index = 0; index < characters.length; index += 1) {
    const leadByte = sec8k6kWindows1252Byte(characters[index]);
    const sequenceLength = sec8k6kUtf8SequenceLength(leadByte);
    if (sequenceLength <= 1 || index + sequenceLength > characters.length) {
      repaired += characters[index];
      continue;
    }
    const bytes = characters.slice(index, index + sequenceLength).map(sec8k6kWindows1252Byte);
    if (bytes.some((byte) => byte === null) || bytes.slice(1).some((byte) => byte! < 0x80 || byte! > 0xbf)) {
      repaired += characters[index];
      continue;
    }
    try {
      const encoded = bytes.map((byte) => `%${byte!.toString(16).padStart(2, "0")}`).join("");
      repaired += decodeURIComponent(encoded);
      index += sequenceLength - 1;
    } catch {
      repaired += characters[index];
    }
  }

  return repaired;
}

function sec8k6kUtf8SequenceLength(leadByte: number | null) {
  if (leadByte === null) return 0;
  if (leadByte >= 0xc2 && leadByte <= 0xdf) return 2;
  if (leadByte >= 0xe0 && leadByte <= 0xef) return 3;
  if (leadByte >= 0xf0 && leadByte <= 0xf4) return 4;
  return 1;
}

function sec8k6kWindows1252Byte(character: string): number | null {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return null;
  if (codePoint <= 0xff) return codePoint;
  return SEC_8K_6K_WINDOWS_1252_SPECIAL_BYTES[codePoint] ?? null;
}

const SEC_8K_6K_WINDOWS_1252_SPECIAL_BYTES: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function materialQualifiedAmounts(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const qualifierPattern = /\b(?:offset(?:\s+by)?|net\s+of|less|deduct(?:ed|ion)?|reduced?\s+by|after\s+deduct(?:ing|ion)|payable\s+to|amounts?\s+(?:owed|payable)|owe\s+to)\b/gi;
  const amountPattern = /(?:US\s*)?\$\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|m|bn))?/gi;
  const results: Array<{ amount: string; qualifierText: string }> = [];

  for (const qualifier of text.matchAll(qualifierPattern)) {
    const qualifierIndex = qualifier.index ?? 0;
    const window = text.slice(Math.max(0, qualifierIndex - 320), Math.min(text.length, qualifierIndex + 420));
    const amounts = [...window.matchAll(amountPattern)];
    for (const amount of amounts) {
      results.push({ amount: amount[0], qualifierText: window });
    }
  }

  return results.filter((item, index, rows) =>
    rows.findIndex((candidate) => normalizeComparableAmount(candidate.amount) === normalizeComparableAmount(item.amount)) === index
  );
}

function summaryMentionsAmountWithoutQualifier(summary: string, amount: string, qualifierText: string) {
  const normalizedAmount = normalizeComparableAmount(amount);
  const summaryAmounts = [...summary.matchAll(/(?:US\s*)?\$\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|m|bn))?/gi)]
    .map((match) => normalizeComparableAmount(match[0]));
  if (!normalizedAmount || !summaryAmounts.includes(normalizedAmount)) return false;
  const sourceQualifierTerms = materialQualifierTerms(qualifierText);
  if (!sourceQualifierTerms.length) return false;
  const normalizedSummary = normalizeComparableText(summary);
  return !sourceQualifierTerms.some((term) => normalizedSummary.includes(term));
}

function materialQualifierTerms(value: string) {
  const terms = new Set<string>();
  const normalized = normalizeComparableText(value);
  if (/\boffset\b/.test(normalized)) terms.add("offset");
  if (/\bnet of\b/.test(normalized)) terms.add("net of");
  if (/\bless\b/.test(normalized)) terms.add("less");
  if (/\bdeduct/.test(normalized)) terms.add("deduct");
  if (/\breduc/.test(normalized)) terms.add("reduc");
  if (/\bpayable\b/.test(normalized)) terms.add("payable");
  const thirdParty = normalized.match(/(?:owe|owed|payable) to ([a-z][a-z0-9&.' -]{1,50})/);
  if (thirdParty?.[1]) terms.add(thirdParty[1].trim());
  return [...terms];
}

function normalizeComparableAmount(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bus\s*/g, "")
    .replace(/\$\s*/g, "$")
    .replace(/,/g, "")
    .replace(/\bbillion\b/g, "b")
    .replace(/\bmillion\b/g, "m")
    .replace(/\bthousand\b/g, "k")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeComparableText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\bbillion\b/g, "b")
    .replace(/\bmillion\b/g, "m")
    .replace(/\bthousand\b/g, "k")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceJsonPointerValue(root: Record<string, unknown>, pointer: string, value: unknown) {
  if (!pointer.startsWith("/")) return false;
  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (!segments.length) return false;

  let current: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) return false;
      current = current[arrayIndex];
    } else {
      const record = readRecord(current);
      if (!record || !(segment in record)) return false;
      current = record[segment];
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const arrayIndex = Number(finalSegment);
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) return false;
    current[arrayIndex] = value;
    return true;
  }
  const record = readRecord(current);
  if (!record || !(finalSegment in record)) return false;
  record[finalSegment] = value;
  return true;
}

function normalizeValidationRepairPatchValue(path: string, value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (path === "/amendment_delta/is_amendment" || path === "/amendment_delta/unchanged_parent_event") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return undefined;
  }
  if (path === "/amendment_delta/change_kind") {
    const changeKind = stringValue(value);
    return [
      "not_amendment",
      "clerical_correction",
      "supplemental_update",
      "material_change",
      "unable_to_compare",
    ].includes(changeKind) ? changeKind : undefined;
  }
  if (path === "/amendment_delta/changed_fields" || path === "/amendment_delta/source_block_ids") {
    const parsed = parseValidationRepairCollection(value);
    if (!parsed) return undefined;
    return parsed.map(stringValue).filter(Boolean).slice(0, path.endsWith("changed_fields") ? 4 : 8);
  }
  if (path === "/display_payload/data/detail_sections") {
    return normalizeValidationRepairDetailSections(value);
  }
  if (path === "/display_payload/data/snapshot_metrics" || path === "/analysis_output/listing_status_snapshot") {
    return normalizeValidationRepairSnapshotMetrics(value);
  }
  if (path === "/display_payload/data/business_catalysts") {
    return normalizeValidationRepairBusinessCatalysts(value);
  }
  if (path === "/analysis_output/key_evidence") {
    const parsed = parseValidationRepairCollection(value);
    if (!parsed) return undefined;
    const evidence = parsed.map(stringValue).map((item) => item.trim()).filter(Boolean);
    return evidence.length >= 2 && evidence.length <= 3 ? evidence : undefined;
  }
  if (path === "/analysis_output/event_type" || /\/material_events\/\d+\/event_type$/.test(path)) {
    const eventType = stringValue(value);
    return SEC_8K_6K_APPROVED_EVENT_TYPES.includes(eventType as (typeof SEC_8K_6K_APPROVED_EVENT_TYPES)[number])
      ? eventType
      : undefined;
  }
  if (path === "/display_payload/data/operating_mode") {
    const mode = stringValue(value);
    return ["earnings", "operating_update", "product_or_regulatory", "legal_or_accounting", "routine_archive"].includes(mode)
      ? mode
      : undefined;
  }
  if (path === "/analysis_output/score") {
    const score = Number(value.trim());
    return Number.isFinite(score) ? clampScore(score) : undefined;
  }
  if (path === "/analysis_output/signal") {
    const signal = stringValue(value);
    return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : undefined;
  }
  if (/\/performance_comparisons\/\d+\/comparison_basis$/.test(path)) {
    const basis = stringValue(value);
    return ["yoy", "qoq", "other"].includes(basis) ? basis : undefined;
  }
  if (path === "/display_payload/data/secondary_updates") {
    return normalizeValidationRepairSecondaryUpdates(value);
  }
  if (!/_numeric$/.test(path)) return value;
  const numericValue = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function normalizeValidationRepairSnapshotMetrics(value: string) {
  const parsed = parseValidationRepairCollection(value);
  if (!parsed) return undefined;
  const rows = parsed.slice(0, 4).flatMap((item) => {
    const row = readRecord(item);
    if (!row) return [];
    const label = stringValue(row.label).slice(0, 32);
    const rowValue = stringValue(row.value).slice(0, 100);
    const note = nullableString(row.note);
    if (!label || !rowValue) return [];
    return [{ label, value: rowValue, note: note ? note.slice(0, 80) : null }];
  });
  return rows.length ? rows : undefined;
}

function normalizeValidationRepairBusinessCatalysts(value: string) {
  const parsed = parseValidationRepairCollection(value);
  if (!parsed) return undefined;
  const rows = parsed.slice(0, 3).flatMap((item) => {
    const row = readRecord(item);
    if (!row) return [];
    const title = stringValue(row.title).slice(0, 64);
    const rowValue = nullableString(row.value);
    const summary = stringValue(row.summary).slice(0, 160);
    if (!title || !summary) return [];
    return [{ title, value: rowValue ? rowValue.slice(0, 80) : null, summary }];
  });
  return rows;
}

function normalizeValidationRepairDetailSections(value: string) {
  const parsed = parseValidationRepairCollection(value);
  if (!parsed) return undefined;
  const sections = parsed.slice(0, 2).flatMap((item) => {
    const section = readRecord(item);
    if (!section) return [];
    const title = stringValue(section.title).slice(0, 40);
    const rows = readRecordArray(section.rows).slice(0, 5).flatMap((row) => {
      const label = stringValue(row.label).slice(0, 48);
      const rowValue = stringValue(row.value).slice(0, 100);
      const note = nullableString(row.note);
      if (!label || !rowValue) return [];
      return [{ label, value: rowValue, note: note ? note.slice(0, 80) : null }];
    });
    return title && rows.length ? [{ title, rows }] : [];
  });
  return sections.length ? sections : undefined;
}

function normalizeValidationRepairSecondaryUpdates(value: string) {
  const parsed = parseValidationRepairCollection(value);
  if (!parsed) return undefined;
  const updates = parsed.slice(0, 1).flatMap((item) => {
    const update = readRecord(item);
    if (!update) return [];
    const label = stringValue(update.label).slice(0, 24);
    const title = stringValue(update.title).slice(0, 80);
    const summary = stringValue(update.summary).slice(0, 120);
    return label && title && summary ? [{ label, title, summary }] : [];
  });
  return updates.length ? updates : undefined;
}

function parseValidationRepairCollection(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return readRecord(parsed) ? [parsed] : null;
  } catch {
    return null;
  }
}

function hasProjectEconomicsDetailSection(sections: Record<string, unknown>[]) {
  return sections.some((section) => stringValue(section.title).trim().toLowerCase() === "project economics");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value) ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function parsePromptUser(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return readRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return readRecord(value);
}

function summarizeSelectedSourceBlocks(
  sourceBlocks: Record<string, unknown>[],
  manifest: Record<string, unknown>[],
  selectedIds: string[],
) {
  const blocksById = new Map<string, Record<string, unknown>>();
  for (const block of sourceBlocks) {
    const id = stringValue(block.block_id);
    if (id) blocksById.set(id, block);
  }
  const manifestById = new Map<string, Record<string, unknown>>();
  for (const item of manifest) {
    const id = stringValue(item.block_id);
    if (id) manifestById.set(id, item);
  }

  return selectedIds
    .map((id) => {
      const block = blocksById.get(id) || manifestById.get(id);
      if (!block) return null;
      const text = stringValue(block.text);
      return {
        block_id: id,
        source_ref: nullableString(block.source_ref),
        origin: stringValue(block.origin) || null,
        priority: numberValue(block.priority),
        block_type: stringValue(block.block_type) || null,
        label: nullableString(block.label),
        item_number: nullableString(block.item_number),
        exhibit_number: nullableString(block.exhibit_number),
        document_type: nullableString(block.document_type),
        document_reference: nullableString(block.document_reference),
        text_chars: text.length,
        preview: text ? clipDebugSnippet(text, 260) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 24);
}

function clipDebugSnippet(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

const sec8k6kRuntimeAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amendment_delta", "security_inventory", "analysis_output", "analysis_case", "source_blocks_used"],
  properties: {
    amendment_delta: sec8k6kAmendmentDeltaSchema,
    security_inventory: sec8k6kSecurityInventorySchema,
    display_payload: sec8k6kAnalysisDisplayPayloadSchema,
    analysis_output: {
      type: "object",
      additionalProperties: false,
      required: [
        "source_group",
        "market_scope",
        "event_type",
        "material_events",
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
        "listing_status_snapshot",
        "why_it_matters",
        "bullish_points",
        "bearish_points",
        "key_evidence",
        "what_to_watch_next",
        "related_tickers",
        "calendar_items",
        "confidence",
        "needs_human_review",
        "summary",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: {
          type: "string",
          enum: [
            "listing_risk",
            "dilution_risk",
            "ipo_listing",
            "earnings",
            "sales_performance",
            "operating_update",
            "product_update",
            "leadership_governance",
            "insider_ownership",
            "shareholder_vote",
            "strategic_transaction",
            "financial_risk",
            "legal_risk",
            "dividends",
            "capital_return",
            "fda_clinical",
            "other",
          ],
        },
        material_events: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          description: "Internal analysis plan written before investor-facing prose. Include exactly one primary event and only independently material secondary events.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "event_type", "event_summary", "key_terms", "source_block_ids"],
            properties: {
              role: { type: "string", enum: ["primary", "secondary"] },
              event_type: {
                type: "string",
                enum: [
                  "listing_risk",
                  "dilution_risk",
                  "ipo_listing",
                  "earnings",
                  "sales_performance",
                  "operating_update",
                  "product_update",
                  "leadership_governance",
                  "insider_ownership",
                  "shareholder_vote",
                  "strategic_transaction",
                  "financial_risk",
                  "legal_risk",
                  "dividends",
                  "capital_return",
                  "fda_clinical",
                  "other",
                ],
              },
              event_summary: { type: "string" },
              key_terms: { type: "array", maxItems: 5, items: { type: "string" } },
              source_block_ids: { type: "array", maxItems: 8, items: { type: "string" } },
            },
          },
        },
        event_title: { type: "string" },
        primary_ticker: {
          type: "object",
          additionalProperties: false,
          required: ["ticker", "exchange"],
          properties: {
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
          },
        },
        tickers: { type: "array", items: { type: "string" } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        score_explanation: sec8k6kScoreExplanationSchema,
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        listing_status_snapshot: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              note: { type: ["string", "null"] },
            },
          },
        },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: {
          type: "array",
          maxItems: 3,
          description:
            "Return only the two or three strongest proof points for the central investor conclusion. Rank all candidates first, remove duplicates and lower-priority facts, and never return more than three items.",
          items: { type: "string" },
        },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: "string" } },
        calendar_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "dateText", "evidence"],
            properties: {
              label: { type: "string" },
              dateText: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        summary: {
          type: "string",
          description: "Write this last. Synthesize every material_events primary and secondary row into a concise investor summary, preserving its strongest source-backed key terms.",
        },
      },
    },
    analysis_case: {
      type: "string",
      enum: [
        "listing_risk",
        "dilution_or_offering",
        "ipo_listing",
        "earnings_or_results",
        "sales_or_operating_update",
        "product_or_commercial_update",
        "leadership_or_governance",
        "insider_or_control_update",
        "shareholder_vote",
        "strategic_transaction",
        "financial_distress_or_default",
        "legal_or_regulatory_risk",
        "dividend",
        "capital_return",
        "fda_or_clinical",
        "routine_amendment",
        "material_amendment",
        "other_8k_6k",
      ],
    },
    source_blocks_used: { type: "array", items: { type: "string" } },
  },
} as const;
