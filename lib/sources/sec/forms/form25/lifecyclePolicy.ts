import type { SecForm25ParserOutput } from "./parser";

type JsonRecord = Record<string, unknown>;

export type SecForm25ProceduralFollowUpAssessment = {
  isProceduralFollowUp: boolean;
  matchedRelatedFiling: JsonRecord | null;
  reason: string | null;
};

export function assessSecForm25ProceduralFollowUp(input: {
  analysisOutput: JsonRecord;
  parserOutput: SecForm25ParserOutput;
  relatedFilingContext?: JsonRecord | null;
}): SecForm25ProceduralFollowUpAssessment {
  const lifecycle = readRecord(input.analysisOutput.form25_lifecycle);
  const disposition = stringValue(lifecycle?.disposition);
  if (disposition !== "related_event_update" && disposition !== "administrative_cleanup") {
    return emptyAssessment();
  }

  const matchedRelatedFiling = findMatchedRelatedFiling(lifecycle, input.relatedFilingContext);
  if (!matchedRelatedFiling || !/^(?:medium|high)$/i.test(stringValue(matchedRelatedFiling.match_confidence))) {
    return emptyAssessment(matchedRelatedFiling);
  }

  const priorText = relatedFilingText(matchedRelatedFiling);
  if (!priorText || !priorDisclosedListingLifecycle(priorText)) {
    return emptyAssessment(matchedRelatedFiling);
  }

  return {
    isProceduralFollowUp: true,
    matchedRelatedFiling,
    reason:
      "The matched prior filing already established the listing outcome; Form 25 is a procedural lifecycle update.",
  };
}

function findMatchedRelatedFiling(
  lifecycle: JsonRecord | null,
  relatedFilingContext: JsonRecord | null | undefined,
) {
  const relatedEventId = stringValue(lifecycle?.related_event_id);
  const relatedAccession = normalizeAccession(stringValue(lifecycle?.related_accession_number));
  if (!relatedEventId && !relatedAccession) return null;

  return (
    recordArray(relatedFilingContext?.selected_filings).find((candidate) => {
      const candidateEventId = stringValue(candidate.event_id);
      const candidateAccession = normalizeAccession(stringValue(candidate.accession_number));
      if (!candidateEventId) return false;
      return Boolean(
        (relatedEventId && candidateEventId === relatedEventId) ||
          (relatedAccession && candidateAccession === relatedAccession),
      );
    }) || null
  );
}

function priorDisclosedListingLifecycle(value: string) {
  return /\b(?:Form\s*25|delist(?:ing|ed)?|deregist(?:er|ration)|trading (?:was )?suspend(?:ed|sion)?|suspended from trading|remove(?:d|al)? from listing)\b/i.test(
    value,
  );
}


function relatedFilingText(filing: JsonRecord) {
  return [
    filing.event_title,
    filing.title,
    filing.quick_take,
    filing.summary,
    ...stringArray(filing.key_evidence),
    ...recordArray(filing.source_snippets).map((snippet) => snippet.text),
    ...stringArray(filing.source_snippets),
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n");
}


function emptyAssessment(matchedRelatedFiling: JsonRecord | null = null): SecForm25ProceduralFollowUpAssessment {
  return { isProceduralFollowUp: false, matchedRelatedFiling, reason: null };
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

function normalizeAccession(value: string) {
  return value.replace(/[^0-9]/g, "");
}
