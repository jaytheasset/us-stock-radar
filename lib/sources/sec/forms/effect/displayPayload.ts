import type { EffectDisplayPayload, EffectParserOutput, EffectRouterDecision } from "./types";

export function buildEffectDisplayPayload(
  parserOutput: EffectParserOutput,
  routeDecision: EffectRouterDecision,
): EffectDisplayPayload {
  return {
    display_type: routeDecision.displayType,
    data: {
      effective_filing_form: parserOutput.facts.effectiveFilingForm,
      ipo_kind: routeDecision.eventType === "ipo_listing" ? parserOutput.facts.parentIpoKind : null,
      effective_registration_reference: parserOutput.facts.effectiveRegistrationReference,
      effective_date: parserOutput.facts.effectiveDate,
      original_filing_reference: parserOutput.facts.originalFilingReference,
    },
    evidence: parserOutput.facts.sourceExcerpts,
    notes: buildDisplayNotes(parserOutput),
  };
}

function buildDisplayNotes(parserOutput: EffectParserOutput): string[] {
  const notes = ["EFFECT room did not query live DB; original filing context is fixture-only."];

  if (parserOutput.facts.hasMultipleFilers) {
    notes.push("Multiple filer/file-number pairs were preserved for integration matching.");
  }

  if (parserOutput.facts.hasSeriesClassContractData) {
    notes.push("Series/class/contract data was preserved in parser facts; no special UI was built in this room.");
  }

  if (parserOutput.facts.originalAnalysisShouldBeShown) {
    notes.push("Integration should link this EFFECT notice to the original analyzed registration filing.");
  }

  return notes;
}
