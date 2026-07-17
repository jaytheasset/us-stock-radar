import type { SecForm25ParserOutput } from "./parser";
import { assessSecForm25ProceduralFollowUp } from "./lifecyclePolicy";

type GuardRoot = Record<string, unknown>;

const FORM25_UNCLEAR_REASON_CAP = 74;
const FORM25_UNCLEAR_REASON_NOTE =
  "Form 25 score capped because the source does not state a failure or stress reason.";
const FORM25_UNCLEAR_REASON_SCORE_SUMMARY =
  "The listing change may matter, but this Form 25 source does not state a failure, stress, or transaction reason.";
const FORM25_FOLLOW_UP_SCORE = 20;
const FORM25_FOLLOW_UP_NOTE =
  "Form 25 treated as a lifecycle follow-up to an existing analyzed filing; duplicate alert suppressed.";
const FORM25_INVALID_RELATED_REFERENCE_NOTE =
  "Form 25 related-event reference did not match the supplied related filing context.";
const FORM25_AMENDMENT_FOLLOW_UP_NOTE =
  "Form 25 amendment treated as an update to the matched original Form 25; duplicate alert suppressed.";
const FORM25_PROCEDURAL_FOLLOW_UP_NOTE =
  "Form 25 formal removal treated as procedural completion of an already analyzed listing event; duplicate alert suppressed.";

export function applySecForm25PostAnalysisGuards(
  root: GuardRoot,
  parserOutput: SecForm25ParserOutput | null,
  relatedFilingContext: Record<string, unknown> | null = null,
) {
  const analysisOutput = readRecord(root.analysis_output);
  if (!analysisOutput || !parserOutput) return { changed: false, warnings: [] as string[] };

  let changed = false;
  const warnings: string[] = [];

  if (shouldCapUnclearCommonEquityForm25(analysisOutput, parserOutput)) {
    analysisOutput.score = FORM25_UNCLEAR_REASON_CAP;
    analysisOutput.needs_human_review = true;
    if (stringValue(analysisOutput.signal).toLowerCase() === "bearish") {
      analysisOutput.signal = "volatile";
    }
    if (stringValue(analysisOutput.confidence).toLowerCase() === "high") {
      analysisOutput.confidence = "medium";
    }
    analysisOutput.score_reason = "source reason unclear";

    const scoreExplanation = readRecord(analysisOutput.score_explanation);
    if (scoreExplanation) {
      scoreExplanation.summary = FORM25_UNCLEAR_REASON_SCORE_SUMMARY;
    } else {
      analysisOutput.score_explanation = { summary: FORM25_UNCLEAR_REASON_SCORE_SUMMARY };
    }

    const displayPayload = readRecord(root.display_payload);
    const data = readRecord(displayPayload?.data);
    if (data) {
      if (!stringValue(data.removal_reason)) data.removal_reason = "Reason not disclosed";
      if (!stringValue(data.removal_reason_text)) data.removal_reason_text = "No failure or stress reason stated.";
    }
    if (displayPayload) {
      displayPayload.notes = uniqueStrings([...readStringArray(displayPayload.notes), FORM25_UNCLEAR_REASON_NOTE]);
    }

    changed = true;
    warnings.push(FORM25_UNCLEAR_REASON_NOTE);
  }

  if (shouldClearArchiveWatchNext(analysisOutput)) {
    analysisOutput.what_to_watch_next = [];
    changed = true;
  }

  if (clearUnverifiedFormalRemovalDate(root, parserOutput)) {
    changed = true;
    warnings.push("Form 25 filing date was removed from formal removal/effectiveness display fields because the source does not establish that date role.");
  }

  const amendmentOriginal = findMatchedOriginalForm25ForAmendment(parserOutput, relatedFilingContext);
  let lifecycle = readRecord(analysisOutput.form25_lifecycle);
  if (amendmentOriginal) {
    if (!lifecycle) {
      lifecycle = {};
      analysisOutput.form25_lifecycle = lifecycle;
    }
    lifecycle.disposition = "related_event_update";
    lifecycle.related_event_id = stringValue(amendmentOriginal.event_id) || null;
    lifecycle.related_accession_number = stringValue(amendmentOriginal.accession_number) || null;
    lifecycle.rationale =
      "This amendment updates the matched original Form 25 and does not create a second standalone listing event.";
    analysisOutput.analysis_action = "related_event_update";
    analysisOutput.score = FORM25_FOLLOW_UP_SCORE;
    analysisOutput.signal = "neutral";
    analysisOutput.what_to_watch_next = [];
    const displayPayload = readRecord(root.display_payload);
    if (displayPayload) {
      displayPayload.notes = uniqueStrings([
        ...readStringArray(displayPayload.notes),
        FORM25_AMENDMENT_FOLLOW_UP_NOTE,
      ]);
    }
    changed = true;
    warnings.push(FORM25_AMENDMENT_FOLLOW_UP_NOTE);
  }

  const priorAnalyzedCause = findPriorAnalyzedCauseForFollowUp(
    analysisOutput,
    parserOutput,
    relatedFilingContext,
  );
  if (
    priorAnalyzedCause &&
    (!lifecycle || stringValue(lifecycle.disposition) === "standalone_event")
  ) {
    if (!lifecycle) {
      lifecycle = {};
      analysisOutput.form25_lifecycle = lifecycle;
    }
    const priorEventType = stringValue(priorAnalyzedCause.event_type);
    if (priorEventType && priorEventType !== stringValue(analysisOutput.event_type)) {
      analysisOutput.event_type = priorEventType;
    }
    lifecycle.disposition = "related_event_update";
    lifecycle.related_event_id = stringValue(priorAnalyzedCause.event_id) || null;
    lifecycle.related_accession_number = stringValue(priorAnalyzedCause.accession_number) || null;
    lifecycle.has_new_material_information = false;
    lifecycle.rationale =
      "A supplied prior analyzed filing already explains the removal cause; this Form 25 confirms the listing lifecycle update without adding a new material investor event.";
    analysisOutput.analysis_action = "related_event_update";
    changed = true;
  }

  if (lifecycle) {
    const disposition = stringValue(lifecycle.disposition);
    const matchedRelatedFiling = findMatchedRelatedFiling(lifecycle, relatedFilingContext);

    if (
      (disposition === "related_event_update" || disposition === "administrative_cleanup") &&
      !matchedRelatedFiling
    ) {
      lifecycle.disposition = "context_unresolved";
      lifecycle.related_event_id = null;
      lifecycle.related_accession_number = null;
      analysisOutput.analysis_action = "context_unresolved";
      analysisOutput.needs_human_review = true;
      changed = true;
      warnings.push(FORM25_INVALID_RELATED_REFERENCE_NOTE);
    } else {
      analysisOutput.analysis_action = disposition;
    }

    if (
      (disposition === "related_event_update" || disposition === "administrative_cleanup") &&
      Boolean(matchedRelatedFiling)
    ) {
      if (backfillRemovalReasonFromAvailableContext(root, parserOutput, matchedRelatedFiling)) {
        changed = true;
      }
      const proceduralAssessment = assessSecForm25ProceduralFollowUp({
        analysisOutput,
        parserOutput,
        relatedFilingContext,
      });
      if (proceduralAssessment.isProceduralFollowUp) {
        lifecycle.has_new_material_information = false;
        lifecycle.rationale = proceduralAssessment.reason;
      }

      if (lifecycle.has_new_material_information !== true) {
        analysisOutput.score = FORM25_FOLLOW_UP_SCORE;
        analysisOutput.signal = "neutral";
        analysisOutput.delivery_level = "archive";
        analysisOutput.what_to_watch_next = [];
        analysisOutput.bullish_points = [];
        analysisOutput.bearish_points = [];
        analysisOutput.key_evidence = [];
        analysisOutput.score_reason = "procedural listing removal update";
        const displayPayload = readRecord(root.display_payload);
        if (displayPayload) {
          displayPayload.notes = uniqueStrings([
            ...readStringArray(displayPayload.notes),
            proceduralAssessment.isProceduralFollowUp
              ? FORM25_PROCEDURAL_FOLLOW_UP_NOTE
              : FORM25_FOLLOW_UP_NOTE,
          ]);
        }
        changed = true;
        warnings.push(
          proceduralAssessment.isProceduralFollowUp
            ? FORM25_PROCEDURAL_FOLLOW_UP_NOTE
            : FORM25_FOLLOW_UP_NOTE,
        );
      }
    }
  }

  return { changed, warnings };
}

function backfillRemovalReasonFromAvailableContext(
  root: GuardRoot,
  parserOutput: SecForm25ParserOutput,
  relatedFiling: Record<string, unknown> | null,
) {
  const displayPayload = readRecord(root.display_payload);
  const data = readRecord(displayPayload?.data);
  if (!data || !isMissingReasonValue(data.removal_reason)) return false;

  const reasonContext =
    directRemovalReasonContext(parserOutput) || readRecord(relatedFiling?.removal_reason_context);
  const reason = compactSnapshotText(stringValue(reasonContext?.value), 80);
  if (!reason || isMissingReasonValue(reason)) return false;

  data.removal_reason = reason;
  if (isMissingReasonValue(data.removal_reason_text)) {
    data.removal_reason_text =
      compactSnapshotText(stringValue(reasonContext?.note), 80) ||
      compactSnapshotText(`Established in the related ${stringValue(relatedFiling?.form_type) || "filing"}`, 80);
  }
  return true;
}

function directRemovalReasonContext(parserOutput: SecForm25ParserOutput) {
  const fact = parserOutput.facts.removal_reason_text;
  const text = stringValue(fact?.value);
  if (!text) return null;

  const listingRules = uniqueStrings(
    [...text.matchAll(/\b(?:Nasdaq\s+)?Listing Rule\s+(\d+(?:\([a-z0-9]+\))*)/gi)].map(
      (match) => match[1],
    ),
  );
  const statesNoncompliance = /\b(?:no longer qualified|no longer suitable|failed to (?:meet|satisfy)|non-?compliance)\b/i.test(text);
  if (!listingRules.length || !statesNoncompliance) return null;

  const exchange = stringValue(parserOutput.facts.exchange?.value);
  const venue = /nasdaq/i.test(exchange) ? "Nasdaq" : /new york stock exchange|\bnyse\b/i.test(exchange) ? "NYSE" : "Exchange";
  return {
    label: "Removal Reason",
    value: `${venue} Listing Rule ${listingRules.join(" and ")} noncompliance`,
    note: `The company no longer met ${venue}'s continued listing requirements.`,
  };
}

function isMissingReasonValue(value: unknown) {
  const text = stringValue(value);
  return (
    !text ||
    /^(?:reason\s+)?(?:not disclosed|not stated|unknown|unclear|n\/?a)$/i.test(text) ||
    /^no (?:failure|listing|removal).*reason (?:is )?stated\.?$/i.test(text)
  );
}

function compactSnapshotText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
  return shortened || text.slice(0, maxLength).trim();
}

function findPriorAnalyzedCauseForFollowUp(
  analysisOutput: Record<string, unknown>,
  parserOutput: SecForm25ParserOutput,
  relatedFilingContext: Record<string, unknown> | null,
) {
  const eventType = stringValue(analysisOutput.event_type);
  if (!eventType) return null;

  const candidates = recordArray(relatedFilingContext?.selected_filings).filter((candidate) => {
      if (!stringValue(candidate.event_id)) return false;
      if (!/^(?:8-K|8-K\/A|6-K|6-K\/A)$/i.test(stringValue(candidate.form_type))) return false;
      return /^(?:medium|high)$/i.test(stringValue(candidate.match_confidence));
    });

  return (
    candidates.find((candidate) => stringValue(candidate.event_type) === eventType) ||
    candidates.find(
      (candidate) =>
        stringValue(candidate.event_type) === "listing_risk" &&
        isIssuerVoluntaryCommonEquityRemoval(parserOutput),
    ) ||
    null
  );
}

function isIssuerVoluntaryCommonEquityRemoval(parserOutput: SecForm25ParserOutput) {
  const rule = stringValue(parserOutput.facts.rule_provision?.value);
  const security = stringValue(parserOutput.facts.removed_security?.value);
  const sourceText = [
    ...parserOutput.raw.directSourceBlocks.map((block) => block.text),
    ...parserOutput.raw.selectedEvidenceSnippets.map((snippet) => snippet.text),
  ].join("\n");
  const isVoluntary =
    /12d2-2\(c\)/i.test(rule) ||
    /\b(?:voluntary|voluntarily)\b[\s\S]{0,100}\b(?:delist|withdraw|remove)\b/i.test(sourceText);
  const isCommonEquity =
    /\b(?:common stock|common shares?|ordinary shares?|ads|american depositary shares?)\b/i.test(security);
  const isTransactionCleanup =
    /\b(?:completed|consummated|closed)\b[\s\S]{0,120}\b(?:merger|acquisition|business combination|tender offer)\b/i.test(
      sourceText,
    );
  return isVoluntary && isCommonEquity && !isTransactionCleanup;
}

function clearUnverifiedFormalRemovalDate(
  root: GuardRoot,
  parserOutput: SecForm25ParserOutput,
) {
  const filingDate = normalizedDate(parserOutput.facts.filing_date?.value);
  const removalDate = normalizedDate(parserOutput.facts.delisting_or_removal_date?.value);
  const effectivenessDate = normalizedDate(parserOutput.facts.effectiveness_date?.value);
  if (removalDate || (effectivenessDate && effectivenessDate !== filingDate)) return false;

  const displayPayload = readRecord(root.display_payload);
  const data = readRecord(displayPayload?.data);
  if (!data) return false;

  let changed = false;
  for (const key of ["delisting_or_removal_date", "effectiveness_date"]) {
    if (!stringValue(data[key])) continue;
    data[key] = null;
    changed = true;
  }
  return changed;
}

function normalizedDate(value: unknown) {
  const text = stringValue(value);
  if (!text) return "";
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : text.toLowerCase();
}

function findMatchedOriginalForm25ForAmendment(
  parserOutput: SecForm25ParserOutput,
  relatedFilingContext: Record<string, unknown> | null,
) {
  const sourceFormType = stringValue(parserOutput.facts.source_form_type).toUpperCase();
  const originalFormType = sourceFormType === "25-NSE/A" ? "25-NSE" : sourceFormType === "25/A" ? "25" : "";
  if (!originalFormType) return null;

  return (
    recordArray(relatedFilingContext?.selected_filings).find((candidate) => {
      if (!stringValue(candidate.event_id)) return false;
      return stringValue(candidate.form_type).toUpperCase() === originalFormType;
    }) || null
  );
}

function findMatchedRelatedFiling(
  lifecycle: Record<string, unknown>,
  relatedFilingContext: Record<string, unknown> | null,
) {
  const relatedEventId = stringValue(lifecycle.related_event_id);
  const relatedAccession = normalizeAccession(stringValue(lifecycle.related_accession_number));
  if (!relatedEventId && !relatedAccession) return null;

  return recordArray(relatedFilingContext?.selected_filings).find((candidate) => {
    const candidateEventId = stringValue(candidate.event_id);
    const candidateAccession = normalizeAccession(stringValue(candidate.accession_number));
    if (!candidateEventId) return false;
    return Boolean(
      (relatedEventId && candidateEventId === relatedEventId) ||
        (relatedAccession && candidateAccession === relatedAccession),
    );
  }) || null;
}

function shouldCapUnclearCommonEquityForm25(
  analysisOutput: Record<string, unknown>,
  parserOutput: SecForm25ParserOutput
) {
  const score = numberValue(analysisOutput.score);
  if (score < 75) return false;
  if (!parserOutput.warnings.includes("missing_or_unclear_reason")) return false;
  if (stringValue(parserOutput.facts.removal_reason_text?.value)) return false;

  const removedSecurity = stringValue(parserOutput.facts.removed_security?.value);
  if (!isCommonEquityLikeSecurity(removedSecurity)) return false;

  return !hasSourceBackedFailureOrStressEvidence(parserOutput);
}

function isCommonEquityLikeSecurity(value: string) {
  return /\b(?:common stock|common shares?|ordinary shares?|class [a-z] ordinary shares?|ads|american depositary shares?)\b/i.test(
    value
  );
}

function hasSourceBackedFailureOrStressEvidence(parserOutput: SecForm25ParserOutput) {
  const evidenceText = [
    parserOutput.facts.removal_reason_text?.value,
    parserOutput.facts.removal_reason_text?.evidence,
    parserOutput.facts.continued_listing_or_trading_venue?.value,
    parserOutput.facts.continued_listing_or_trading_venue?.evidence,
    parserOutput.facts.successor_or_acquirer?.value,
    parserOutput.facts.successor_or_acquirer?.evidence,
    parserOutput.facts.consideration_summary?.value,
    parserOutput.facts.consideration_summary?.evidence,
    ...parserOutput.raw.selectedEvidenceSnippets.map((snippet) => snippet.text),
    ...parserOutput.raw.selectedAttachmentSnippets.map((snippet) => snippet.text),
    ...parserOutput.raw.selectedTableSnippets.map((snippet) => snippet.text),
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n");

  return /\b(?:listing standard|continued listing requirement|minimum bid|bid price|delisting determination|non[- ]?compliance|deficien(?:cy|t)|suitability concern|bankrupt|insolven|receivership|default|litigation|legal stress|financial stress)\b/i.test(
    evidenceText
  );
}

function shouldClearArchiveWatchNext(analysisOutput: Record<string, unknown>) {
  if (numberValue(analysisOutput.score) >= 50) return false;
  return readStringArray(analysisOutput.what_to_watch_next).length > 0;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeAccession(value: string) {
  return value.replace(/[^0-9]/g, "");
}
