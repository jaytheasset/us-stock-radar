import {
  SEC_FORM25_APPROVED_EVENT_TYPES,
  type SecForm25DirectSourceBlock,
  type SecForm25ParserOutput,
} from "./parser";
import { assessSecForm25ProceduralFollowUp } from "./lifecyclePolicy";

type JsonRecord = Record<string, unknown>;

const FORM25_SIGNAL_VALUES = ["bullish", "bearish", "volatile", "neutral"] as const;
const FORM25_DELIVERY_VALUES = ["archive", "feed", "alert"] as const;
const FORM25_LIFECYCLE_VALUES = [
  "standalone_event",
  "related_event_update",
  "administrative_cleanup",
  "context_unresolved",
] as const;

export type SecForm25ValidationRepairIssue = {
  code: string;
  warning: string;
  allowed_patch_paths: string[];
};

export type SecForm25ValidationRepairPlan = {
  prompt: {
    key: string;
    version: string;
    system: string;
    user: string;
    responseFormat: { json_schema: Record<string, unknown> };
  };
  issues: SecForm25ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export const SEC_FORM25_VALIDATION_REPAIR_PROMPT_KEY = "sec_form25_validation_repair";
export const SEC_FORM25_VALIDATION_REPAIR_PROMPT_VERSION = "v7-procedural-follow-up";

export function buildSecForm25ValidationRepairPlan(input: {
  analysisResult: JsonRecord;
  parserOutput: SecForm25ParserOutput;
  relatedFilingContext?: JsonRecord | null;
}): SecForm25ValidationRepairPlan | null {
  const issues = inspectSecForm25ValidationRepairIssues(input);
  if (!issues.length) return null;

  const sourceBlocks = selectRepairSourceBlocks(input.parserOutput.raw.directSourceBlocks, issues);
  if (!sourceBlocks.length) return null;

  const allowedPatchPaths = uniqueStrings(issues.flatMap((issue) => issue.allowed_patch_paths));
  const sourceBlockIds = sourceBlocks.map((block) => block.block_id);
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
            value: { type: ["string", "null"], maxLength: 600 },
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
      key: SEC_FORM25_VALIDATION_REPAIR_PROMPT_KEY,
      version: SEC_FORM25_VALIDATION_REPAIR_PROMPT_VERSION,
      system: [
        "Repair only validator-identified fields in an existing SEC Form 25 analysis.",
        "This is one bounded repair pass, not a new analysis. Return JSON patches only.",
        "Warnings identify possible conflicts but are not evidence. Use the supplied original source blocks for current Form 25 facts and the supplied related filing context only for facts already established by prior analyzed filings.",
        "Do not change a path that is not explicitly allowed and do not rewrite unrelated analysis or UI fields.",
        "Classify from the investor consequence: voluntary common-equity removal without a continued exchange venue is listing risk, while automatic unit separation into retained underlying securities is low-impact other unless the source proves a separate transaction or risk.",
        "Removing only warrants, rights, preferred securities, notes, bonds, or other non-common securities is normally a low-impact standalone cleanup when the source shows no common-equity effect, listing-standard failure, bankruptcy, default, legal stress, or completed transaction. In that case use other, neutral, archive, and a score below 40 rather than listing_risk.",
        "A removal that follows a source-stated completed merger, acquisition, share exchange, tender offer, or cash-out is a strategic transaction consequence rather than exchange listing failure.",
        "For a completed transaction removal that only confirms delisting, cash conversion, or an effective date already inherent in the closing, keep the result neutral and archive-level with a score below 50 unless the Form 25 adds a separate material investor fact.",
        "When a matched prior analyzed filing already disclosed the delisting decision, trading suspension, or expected Form 25, the later Form 25 is a procedural lifecycle update, not new material information or a second alert. If the current source does not establish completed formal removal or a formal effective date, say only that Form 25 was filed for the previously announced delisting. Use score 10-25, neutral signal, archive delivery, and a one-sentence procedural summary.",
        "standalone_event means no supplied analyzed event explains the filing; it does not imply high materiality.",
        "Use related_event_update or administrative_cleanup only when related_filing_context contains an analyzed matching event. Otherwise use standalone_event and null related identifiers.",
        "Keep trading suspension, final delisting determination, and formal removal/effectiveness dates separate. Never call the trading suspension date the formal removal effective date.",
        "Patch numeric and boolean fields as JSON-compatible strings, such as '35' and 'false'.",
        "If the source blocks do not establish a correction, return no patch for that issue and list its code in unresolved_warning_codes.",
        "When the source does establish a correction, patch every allowed field that still conflicts with the corrected event type, materiality, signal, delivery level, score explanation, or lifecycle disposition.",
        "Every patch must cite at least one supplied source block.",
      ].join("\n"),
      user: JSON.stringify({
        validation_issues: issues.map((issue) => ({
          code: issue.code,
          warning: issue.warning,
          allowed_patch_paths: issue.allowed_patch_paths,
          candidate_source_block_ids: sourceBlockIds,
        })),
        current_analysis: input.analysisResult,
        original_source_blocks: sourceBlocks,
        related_filing_context: compactRepairRelatedFilingContext(input.relatedFilingContext),
      }),
      responseFormat: {
        json_schema: {
          name: "sec_form25_validation_repair",
          strict: true,
          schema: responseSchema,
        },
      },
    },
    issues,
    allowedPatchPaths,
    sourceBlockIds,
  };
}

function compactRepairRelatedFilingContext(context: JsonRecord | null | undefined) {
  const selected = recordArray(context?.selected_filings)
    .filter((filing) => Boolean(stringValue(filing.event_id)))
    .slice(0, 3)
    .map((filing) => ({
      event_id: stringValue(filing.event_id) || null,
      accession_number: stringValue(filing.accession_number) || null,
      form_type: stringValue(filing.form_type) || null,
      event_type: stringValue(filing.event_type) || null,
      event_title: stringValue(filing.event_title) || stringValue(filing.title) || null,
      quick_take: stringValue(filing.quick_take) || null,
      summary: stringValue(filing.summary) || null,
      match_confidence: stringValue(filing.match_confidence) || null,
    }));
  return selected.length ? { selected_filings: selected } : null;
}

export function applySecForm25ValidationRepairPatches(input: {
  analysisResult: JsonRecord;
  repairResult: JsonRecord;
  allowedPatchPaths: string[];
}) {
  const cloned = JSON.parse(JSON.stringify(input.analysisResult)) as JsonRecord;
  const allowed = new Set(input.allowedPatchPaths);
  const appliedPatchPaths: string[] = [];
  const ignoredPatchPaths: string[] = [];

  for (const patch of recordArray(input.repairResult.patches)) {
    const path = stringValue(patch.path);
    const value = typeof patch.value === "string" || patch.value === null ? patch.value : undefined;
    if (!allowed.has(path) || value === undefined) {
      if (path) ignoredPatchPaths.push(path);
      continue;
    }
    if (replaceJsonPointerValue(cloned, path, value)) appliedPatchPaths.push(path);
    else ignoredPatchPaths.push(path);
  }

  return {
    analysisResult: cloned,
    appliedPatchPaths: uniqueStrings(appliedPatchPaths),
    ignoredPatchPaths: uniqueStrings(ignoredPatchPaths),
    unresolvedWarningCodes: stringArray(input.repairResult.unresolved_warning_codes),
  };
}

export function inspectSecForm25ValidationRepairIssues(input: {
  analysisResult: JsonRecord;
  parserOutput: SecForm25ParserOutput;
  relatedFilingContext?: JsonRecord | null;
}) {
  const analysis = readRecord(input.analysisResult.analysis_output) || {};
  const lifecycle = readRecord(analysis.form25_lifecycle) || {};
  const displayPayload = readRecord(input.analysisResult.display_payload) || {};
  const displayData = readRecord(displayPayload.data) || {};
  const sourceText = input.parserOutput.raw.directSourceBlocks.map((block) => block.text).join("\n");
  const issues: SecForm25ValidationRepairIssue[] = [];

  const dateRoleConflictPaths = findDateRoleConflictPaths({
    analysis,
    displayData,
    parserOutput: input.parserOutput,
  });
  if (dateRoleConflictPaths.length) {
    issues.push({
      code: "form25_date_role_conflict",
      warning:
        "The source does not establish a formal delisting/removal effective date or completed-removal status. Do not say the delisting is effective, completed, completes, or completing. State only that Form 25 was filed for the previously announced delisting, and label any last-trading or OTC date by its actual role.",
      allowed_patch_paths: dateRoleConflictPaths,
    });
  }

  if (isRoutineAutomaticUnitSeparation(input.parserOutput, sourceText)) {
    const score = numberValue(analysis.score);
    const disposition = stringValue(lifecycle.disposition);
    if (score >= 40 || stringValue(analysis.delivery_level) !== "archive" || disposition !== "standalone_event") {
      issues.push({
        code: "routine_unit_separation_overstated",
        warning:
          "Automatic unit separation into retained underlying securities is presented as a material transaction or unresolved context instead of low-impact standalone cleanup.",
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/score_reason",
          "/analysis_output/signal",
          "/analysis_output/delivery_level",
          "/analysis_output/analysis_action",
          "/analysis_output/score_explanation/summary",
          "/analysis_output/form25_lifecycle/disposition",
          "/analysis_output/form25_lifecycle/has_new_material_information",
          "/analysis_output/form25_lifecycle/rationale",
        ],
      });
    }
  }

  if (isLowImpactNonCommonSecurityRemoval(input.parserOutput, sourceText)) {
    const score = numberValue(analysis.score);
    const eventType = stringValue(analysis.event_type);
    const signal = stringValue(analysis.signal);
    const deliveryLevel = stringValue(analysis.delivery_level);
    if (
      score >= 40 ||
      eventType === "listing_risk" ||
      eventType === "financial_risk" ||
      eventType === "legal_risk" ||
      signal !== "neutral" ||
      deliveryLevel !== "archive"
    ) {
      issues.push({
        code: "non_common_security_cleanup_overstated",
        warning:
          "Only a non-common security class is being removed, and the supplied source does not establish common-equity impact, listing failure, bankruptcy, default, legal stress, or a completed transaction. Treat it as low-impact standalone cleanup rather than common-equity listing risk.",
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/score_reason",
          "/analysis_output/signal",
          "/analysis_output/delivery_level",
          "/analysis_output/quick_take",
          "/analysis_output/summary",
          "/analysis_output/why_it_matters",
          "/analysis_output/score_explanation/summary",
        ],
      });
    }
  }

  const proceduralFollowUp = assessSecForm25ProceduralFollowUp({
    analysisOutput: analysis,
    parserOutput: input.parserOutput,
    relatedFilingContext: input.relatedFilingContext,
  });
  if (
    proceduralFollowUp.isProceduralFollowUp &&
    (lifecycle.has_new_material_information === true ||
      numberValue(analysis.score) > 25 ||
      stringValue(analysis.delivery_level) !== "archive")
  ) {
    issues.push({
      code: "procedural_form25_follow_up_overstated",
      warning:
        "A matched prior analyzed filing already disclosed the listing outcome. This Form 25 only completes formal removal and does not establish a second material investor event.",
      allowed_patch_paths: [
        "/analysis_output/score",
        "/analysis_output/score_reason",
        "/analysis_output/signal",
        "/analysis_output/delivery_level",
        "/analysis_output/analysis_action",
        "/analysis_output/quick_take",
        "/analysis_output/summary",
        "/analysis_output/why_it_matters",
        "/analysis_output/score_explanation/summary",
        "/analysis_output/form25_lifecycle/disposition",
        "/analysis_output/form25_lifecycle/has_new_material_information",
        "/analysis_output/form25_lifecycle/rationale",
      ],
    });
  }

  if (isVoluntaryCommonEquityRemovalWithoutContinuedVenue(input.parserOutput, sourceText)) {
    if (stringValue(analysis.event_type) !== "listing_risk") {
      issues.push({
        code: "voluntary_common_delisting_misclassified",
        warning:
          "Voluntary common-equity removal without a disclosed continued exchange venue is classified as a transaction rather than listing and liquidity risk.",
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/score_reason",
          "/analysis_output/signal",
          "/analysis_output/delivery_level",
          "/analysis_output/analysis_action",
          "/analysis_output/score_explanation/summary",
          "/analysis_output/form25_lifecycle/disposition",
          "/analysis_output/form25_lifecycle/has_new_material_information",
          "/analysis_output/form25_lifecycle/rationale",
        ],
      });
    }
  }

  if (isCompletedTransactionRemoval(input.parserOutput, sourceText)) {
    if (stringValue(analysis.event_type) !== "strategic_transaction") {
      issues.push({
        code: "completed_transaction_removal_misclassified",
        warning:
          "The original Form 25 source states that the removal follows a completed transaction or cash-out. Treat the consequence as a strategic transaction, not listing failure; if this filing only confirms procedural removal or cash conversion, keep it neutral, below 50, and archive-level.",
        allowed_patch_paths: [
          "/analysis_output/event_type",
          "/analysis_output/score",
          "/analysis_output/score_reason",
          "/analysis_output/signal",
          "/analysis_output/delivery_level",
          "/analysis_output/analysis_action",
          "/analysis_output/score_explanation/summary",
          "/analysis_output/form25_lifecycle/disposition",
          "/analysis_output/form25_lifecycle/has_new_material_information",
          "/analysis_output/form25_lifecycle/rationale",
        ],
      });
    }
  }

  const eventType = stringValue(analysis.event_type);
  if (eventType && !includesString(SEC_FORM25_APPROVED_EVENT_TYPES, eventType)) {
    issues.push({
      code: "invalid_form25_event_type",
      warning: `event_type must use an approved investor event type; received ${eventType}.`,
      allowed_patch_paths: ["/analysis_output/event_type"],
    });
  }

  const signal = stringValue(analysis.signal);
  if (signal && !includesString(FORM25_SIGNAL_VALUES, signal)) {
    issues.push({
      code: "invalid_form25_signal",
      warning: `signal must be bullish, bearish, volatile, or neutral; received ${signal}.`,
      allowed_patch_paths: ["/analysis_output/signal"],
    });
  }

  const deliveryLevel = stringValue(analysis.delivery_level);
  if (deliveryLevel && !includesString(FORM25_DELIVERY_VALUES, deliveryLevel)) {
    issues.push({
      code: "invalid_form25_delivery_level",
      warning: `delivery_level must be archive, feed, or alert; received ${deliveryLevel}.`,
      allowed_patch_paths: ["/analysis_output/delivery_level"],
    });
  }

  const disposition = stringValue(lifecycle.disposition);
  if (disposition && !includesString(FORM25_LIFECYCLE_VALUES, disposition)) {
    issues.push({
      code: "invalid_form25_lifecycle_disposition",
      warning:
        "form25_lifecycle.disposition must describe whether this filing is standalone or linked to an analyzed prior event, not repeat the event type.",
      allowed_patch_paths: [
        "/analysis_output/analysis_action",
        "/analysis_output/form25_lifecycle/disposition",
        "/analysis_output/form25_lifecycle/rationale",
      ],
    });
  }

  if (
    (disposition === "related_event_update" || disposition === "administrative_cleanup") &&
    !hasMatchingAnalyzedRelatedEvent(lifecycle, input.relatedFilingContext)
  ) {
    issues.push({
      code: "unsupported_form25_related_event",
      warning:
        "The analysis links this Form 25 to a prior event that is not present as an analyzed matching filing in the supplied context.",
      allowed_patch_paths: [
        "/analysis_output/analysis_action",
        "/analysis_output/form25_lifecycle/disposition",
        "/analysis_output/form25_lifecycle/related_event_id",
        "/analysis_output/form25_lifecycle/related_accession_number",
        "/analysis_output/form25_lifecycle/rationale",
      ],
    });
  }

  if (
    disposition === "context_unresolved" &&
    !stringValue(lifecycle.related_event_id) &&
    !stringValue(lifecycle.related_accession_number) &&
    !hasAnalyzedRelatedEvent(input.relatedFilingContext)
  ) {
    issues.push({
      code: "standalone_lifecycle_marked_unresolved",
      warning:
        "No prior analyzed event was supplied and no relationship was claimed, so lifecycle disposition should describe this as a standalone filing rather than unresolved context.",
      allowed_patch_paths: [
        "/analysis_output/analysis_action",
        "/analysis_output/form25_lifecycle/disposition",
        "/analysis_output/form25_lifecycle/rationale",
      ],
    });
  }

  return dedupeIssues(issues);
}

function selectRepairSourceBlocks(
  blocks: SecForm25DirectSourceBlock[],
  issues: SecForm25ValidationRepairIssue[],
) {
  const issueText = issues.map((issue) => issue.code).join(" ");
  const patterns = /date_role/.test(issueText)
    ? [
        /suspend|trading halted|ceased trading/i,
        /remove|delist|listing and registration|effective at the opening/i,
      ]
    : /unit_separation/.test(issueText)
    ? [/separat|unit holder|underlying/i, /warrant|ordinary share|common stock/i]
    : /non_common_security_cleanup/.test(issueText)
      ? [
          /warrant|right|preferred|note|debenture|bond|debt securit/i,
          /remove|delist|listing and registration|matur|redeem|retir|expir/i,
          /non[- ]?compliance|bankrupt|default|litigation|merger|acquisition/i,
        ]
    : /procedural_form25_follow_up/.test(issueText)
      ? [
          /remove|delist|listing and registration|effective at the opening/i,
          /suspend|Form 25|formal removal/i,
        ]
    : /voluntary_common/.test(issueText)
      ? [/voluntar|12d2-2\(c\)/i, /common stock|ordinary share|continued listing|trading venue/i]
      : /completed_transaction/.test(issueText)
        ? [
            /merger|acquisition|business combination|share exchange|tender offer|cash-out/i,
            /completed|consummated|closed|became effective|converted into|right to receive|cash payment/i,
          ]
      : [/remove|delist|separat|voluntar/i];

  const ranked = [...blocks]
    .map((block) => ({ block, matches: patterns.filter((pattern) => pattern.test(block.text)).length }))
    .sort((left, right) => right.matches - left.matches || right.block.priority - left.block.priority)
  const matched = ranked.filter(({ matches }) => matches > 0);

  return (matched.length ? matched : ranked)
    .slice(0, 3)
    .map(({ block }) => ({
      block_id: block.block_id,
      source_ref: block.source_ref,
      origin: block.origin,
      block_type: block.block_type,
      document_type: block.document_type,
      label: block.label,
      text: block.text,
    }));
}

function findDateRoleConflictPaths(input: {
  analysis: JsonRecord;
  displayData: JsonRecord;
  parserOutput: SecForm25ParserOutput;
}) {
  const removalDate = normalizeDateValue(input.parserOutput.facts.delisting_or_removal_date?.value);
  const effectivenessDate = normalizeDateValue(input.parserOutput.facts.effectiveness_date?.value);
  const filingDate = normalizeDateValue(input.parserOutput.facts.filing_date?.value);
  const suspensionDate = normalizeDateValue(input.parserOutput.facts.trading_suspension_date?.value);
  const paths: string[] = [];
  const verifiedFormalDate = removalDate || (effectivenessDate && effectivenessDate !== filingDate ? effectivenessDate : "");
  const displayRemovalDate = normalizeDateValue(input.displayData.delisting_or_removal_date);
  const displayEffectivenessDate = normalizeDateValue(input.displayData.effectiveness_date);

  if (!verifiedFormalDate) {
    if (displayRemovalDate) paths.push("/display_payload/data/delisting_or_removal_date");
    if (displayEffectivenessDate) paths.push("/display_payload/data/effectiveness_date");

    for (const [path, value] of [
      ["/analysis_output/quick_take", input.analysis.quick_take],
      ["/analysis_output/summary", input.analysis.summary],
      ["/analysis_output/why_it_matters", input.analysis.why_it_matters],
    ] as const) {
      if (textAssignsFormalRemovalToUnverifiedDate(stringValue(value))) {
        paths.push(path);
      }
    }
    return uniqueStrings(paths);
  }

  if (!suspensionDate || verifiedFormalDate === suspensionDate) return uniqueStrings(paths);

  for (const [path, value] of [
    ["/analysis_output/quick_take", input.analysis.quick_take],
    ["/analysis_output/summary", input.analysis.summary],
    ["/analysis_output/why_it_matters", input.analysis.why_it_matters],
  ] as const) {
    const text = stringValue(value);
    if (
      textAssignsRemovalRoleToDate(text, suspensionDate, verifiedFormalDate) ||
      (path === "/analysis_output/quick_take" && quickTakeCompressesDistinctDateRoles(text, suspensionDate, verifiedFormalDate))
    ) {
      paths.push(path);
    }
  }

  if (displayRemovalDate && displayRemovalDate !== verifiedFormalDate) {
    paths.push("/display_payload/data/delisting_or_removal_date");
  }
  if (displayEffectivenessDate && displayEffectivenessDate !== verifiedFormalDate) {
    paths.push("/display_payload/data/effectiveness_date");
  }
  const displaySuspensionDate = normalizeDateValue(input.displayData.trading_suspension_date);
  if (displaySuspensionDate && displaySuspensionDate !== suspensionDate) {
    paths.push("/display_payload/data/trading_suspension_date");
  }

  return uniqueStrings(paths);
}

function textAssignsFormalRemovalToUnverifiedDate(text: string) {
  if (!text) return false;

  return text
    .replace(/\s+/g, " ")
    .split(/[;.!?]+/)
    .map((clause) => clause.trim())
    .some((clause) => {
      return (
        /(?:formal(?:ly)?\s+)?(?:remov(?:al|ed)?|delist(?:ing|ed)?)[^.!?]{0,100}\b(?:on|effective|became effective|takes? effect|as of|complet(?:e|ed|es|ing))\b/i.test(clause) ||
        /\b(?:on|effective|became effective|takes? effect|as of|complet(?:e|ed|es|ing))\b[^.!?]{0,100}(?:formal(?:ly)?\s+)?(?:remov(?:al|ed)?|delist(?:ing|ed)?)/i.test(clause)
      );
    });
}

function quickTakeCompressesDistinctDateRoles(text: string, suspensionDate: string, removalDate: string) {
  if (!text || !/(?:delist|remov|suspend|trading halted|ceased trading)/i.test(text)) return false;
  const dates = extractNormalizedDates(text);
  const mentionsSuspensionDate = dates.includes(suspensionDate);
  const mentionsRemovalDate = dates.includes(removalDate);
  if (mentionsSuspensionDate && !mentionsRemovalDate && /delist|remov/i.test(text)) return true;
  if (mentionsRemovalDate && !mentionsSuspensionDate && /suspend|trading halted|ceased trading/i.test(text)) return true;
  return false;
}

function textAssignsRemovalRoleToDate(text: string, suspensionDate: string, removalDate: string) {
  if (!text) return false;
  const removalEffectivePatterns = [
    /(?:delist(?:ing|ed)?|remov(?:al|ed)?\s+from\s+(?:listing|the\s+exchange))[^.!?]{0,100}\b(?:effective|became effective|takes? effect)\b/i,
    /\b(?:effective|became effective|takes? effect)\b[^.!?]{0,100}(?:delist(?:ing|ed)?|remov(?:al|ed)?\s+from\s+(?:listing|the\s+exchange))/i,
  ];
  const clauses = text
    .replace(/\s+/g, " ")
    .split(/[;.!?]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.some((clause) => {
    if (!removalEffectivePatterns.some((pattern) => pattern.test(clause))) return false;
    const dates = extractNormalizedDates(clause);
    if (!dates.includes(suspensionDate)) return false;
    if (dates.includes(removalDate) && /suspend|trading halted|ceased trading/i.test(clause)) return false;
    return true;
  });
}

function extractNormalizedDates(text: string) {
  const candidates = [
    ...text.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/gi),
    ...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g),
  ];
  return uniqueStrings(candidates.map((match) => normalizeDateValue(match[0])).filter(Boolean));
}

function normalizeDateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return "";
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const namedMatch = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\b/i,
  );
  if (!namedMatch) return "";

  const month = namedMonthNumber(namedMatch[1]);
  if (!month) return "";
  return `${namedMatch[3]}-${month}-${namedMatch[2].padStart(2, "0")}`;
}

function namedMonthNumber(value: string) {
  const month = value.slice(0, 3).toLowerCase();
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  return months[month] || "";
}

function isRoutineAutomaticUnitSeparation(parserOutput: SecForm25ParserOutput, sourceText: string) {
  const removedSecurity = stringValue(parserOutput.facts.removed_security?.value);
  const combinedText = [
    sourceText,
    parserOutput.facts.removed_security?.value,
    parserOutput.facts.removal_reason_text?.value,
    parserOutput.facts.removal_reason_text?.evidence,
    parserOutput.facts.consideration_summary?.value,
    parserOutput.facts.consideration_summary?.evidence,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n");
  const hasCompositeUnit =
    /\bunits?\b/i.test(combinedText) &&
    /\b(?:ordinary shares?|common stock|class [a-z] shares?)\b/i.test(combinedText) &&
    /\b(?:warrants?|rights?)\b/i.test(combinedText);
  const hasSeparation =
    hasCompositeUnit ||
    /\b(?:mandatory and automatic separation|automatic separation|unit holders? (?:will|shall) receive|separat(?:e|ed|ion) into)\b/i.test(
      combinedText,
    );
  const hasUnderlying = /\b(?:ordinary shares?|common stock|class [a-z] shares?)\b/i.test(combinedText) && /\b(?:warrants?|rights?)\b/i.test(combinedText);
  const hasStress = /\b(?:non[- ]?compliance|listing standard|bankrupt|insolven|default|liquidat|failure to satisfy)\b/i.test(combinedText);
  return hasSeparation && hasUnderlying && !hasStress;
}

function isLowImpactNonCommonSecurityRemoval(parserOutput: SecForm25ParserOutput, sourceText: string) {
  const security = stringValue(parserOutput.facts.removed_security?.value);
  if (!security || /\bunits?\b/i.test(security)) return false;
  if (/\b(?:common stock|common shares?|ordinary shares?|class [a-z] shares?|ads|american depositary shares?)\b/i.test(security)) {
    return false;
  }
  if (!/\b(?:warrants?|rights?|preferred|notes?|debentures?|bonds?|debt securit(?:y|ies))\b/i.test(security)) {
    return false;
  }
  if (isCompletedTransactionRemoval(parserOutput, sourceText)) return false;

  const combinedText = [
    sourceText,
    parserOutput.facts.removal_reason_text?.value,
    parserOutput.facts.removal_reason_text?.evidence,
    parserOutput.facts.continued_listing_or_trading_venue?.value,
    parserOutput.facts.continued_listing_or_trading_venue?.evidence,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n");
  const hasStress =
    /\b(?:listing standards?|continued listing requirements?|minimum bid|bid price|non[- ]?compliance|deficien(?:cy|t)|bankrupt|insolven|receivership|default|litigation|legal stress|financial stress|failure to satisfy)\b/i.test(
      combinedText,
    );
  const hasCommonEquityImpact =
    /\b(?:common stock|common shares?|ordinary shares?|ads|american depositary shares?)\b[\s\S]{0,100}\b(?:remove|delist|suspend|cease trading)\b|\b(?:remove|delist|suspend|cease trading)\b[\s\S]{0,100}\b(?:common stock|common shares?|ordinary shares?|ads|american depositary shares?)\b/i.test(
      combinedText,
    );
  return !hasStress && !hasCommonEquityImpact;
}

function isVoluntaryCommonEquityRemovalWithoutContinuedVenue(
  parserOutput: SecForm25ParserOutput,
  sourceText: string,
) {
  if (isCompletedTransactionRemoval(parserOutput, sourceText)) return false;
  const rule = stringValue(parserOutput.facts.rule_provision?.value);
  const security = stringValue(parserOutput.facts.removed_security?.value);
  const continuedVenue = stringValue(parserOutput.facts.continued_listing_or_trading_venue?.value);
  if (/\bunits?\b/i.test(security)) return false;
  const voluntarySource = /\b(?:voluntary|voluntarily)\b[\s\S]{0,100}\b(?:delist|withdraw|remove)|\bissuer[\s\S]{0,80}\b(?:withdraw|delist)/i.test(
    sourceText,
  );
  if (
    (!/12d2-2\(c\)/i.test(rule) && !voluntarySource) ||
    !/\b(?:common stock|common shares?|ordinary shares?|ads|american depositary shares?)\b/i.test(security)
  ) {
    return false;
  }
  if (continuedVenue) return false;
  return !/\b(?:continue|remain)\w*\s+(?:to be\s+)?(?:listed|traded)|\bOTC(?:QX|QB| Pink)?\b/i.test(sourceText);
}

function isCompletedTransactionRemoval(parserOutput: SecForm25ParserOutput, sourceText: string) {
  const combinedText = [
    sourceText,
    parserOutput.facts.removal_reason_text?.value,
    parserOutput.facts.removal_reason_text?.evidence,
    parserOutput.facts.consideration_summary?.value,
    parserOutput.facts.consideration_summary?.evidence,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n");
  const hasTransaction =
    /\b(?:merger|acquisition|business combination|share exchange|tender offer|going[- ]private|cash[- ]out)\b/i.test(
      combinedText,
    );
  const hasCompletion =
    /\b(?:completed|consummated|closed|became effective|effective time|closing of the transaction)\b/i.test(
      combinedText,
    );
  const hasReplacementOrPayment =
    /\b(?:converted into|right to receive|immediate cash payment|cash consideration|other securities in substitution)\b/i.test(
      combinedText,
    );
  return hasTransaction && hasCompletion && hasReplacementOrPayment;
}

function hasAnalyzedRelatedEvent(context: JsonRecord | null | undefined) {
  return recordArray(context?.selected_filings).some((filing) => Boolean(stringValue(filing.event_id)));
}

function hasMatchingAnalyzedRelatedEvent(
  lifecycle: JsonRecord,
  context: JsonRecord | null | undefined,
) {
  const relatedEventId = stringValue(lifecycle.related_event_id);
  const relatedAccession = normalizeAccession(stringValue(lifecycle.related_accession_number));
  if (!relatedEventId && !relatedAccession) return false;

  return recordArray(context?.selected_filings).some((filing) => {
    const eventId = stringValue(filing.event_id);
    const accession = normalizeAccession(stringValue(filing.accession_number));
    if (!eventId) return false;
    return Boolean(
      (relatedEventId && relatedEventId === eventId) ||
        (relatedAccession && relatedAccession === accession),
    );
  });
}

function replaceJsonPointerValue(root: JsonRecord, pointer: string, rawValue: string | null) {
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (!parts.length) return false;

  let target: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (!target || typeof target !== "object") return false;
    target = (target as JsonRecord)[part];
  }
  if (!target || typeof target !== "object") return false;

  const key = parts[parts.length - 1];
  const record = target as JsonRecord;
  const currentValue = record[key];
  if (rawValue !== null && !isAllowedPatchValue(pointer, rawValue)) return false;
  if (rawValue === null) record[key] = null;
  else if (typeof currentValue === "number") {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return false;
    record[key] = parsed;
  } else if (typeof currentValue === "boolean") {
    if (!/^(?:true|false)$/i.test(rawValue)) return false;
    record[key] = rawValue.toLowerCase() === "true";
  } else record[key] = rawValue;
  return true;
}

function isAllowedPatchValue(pointer: string, value: string) {
  if (pointer === "/analysis_output/event_type") {
    return includesString(SEC_FORM25_APPROVED_EVENT_TYPES, value);
  }
  if (pointer === "/analysis_output/signal") {
    return includesString(FORM25_SIGNAL_VALUES, value);
  }
  if (pointer === "/analysis_output/delivery_level") {
    return includesString(FORM25_DELIVERY_VALUES, value);
  }
  if (pointer === "/analysis_output/form25_lifecycle/disposition") {
    return includesString(FORM25_LIFECYCLE_VALUES, value);
  }
  if (pointer === "/analysis_output/score") {
    const score = Number(value);
    return Number.isInteger(score) && score >= 0 && score <= 100;
  }
  return true;
}

function dedupeIssues(issues: SecForm25ValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.code)) return false;
    seen.add(issue.code);
    return true;
  });
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeAccession(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function includesString(values: readonly string[], value: string) {
  return values.includes(value);
}
