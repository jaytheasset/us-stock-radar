import {
  type ApprovedEventType,
  deliveryLevelForScore,
  type EffectParserOutput,
  type EffectRouterDecision,
} from "./types";

const DILUTION_FORMS = new Set([
  "S-1",
  "F-1",
  "S-1/A",
  "F-1/A",
  "S-3",
  "F-3",
  "S-3/A",
  "F-3/A",
  "S-3ASR",
  "F-3ASR",
  "F-10",
  "S-8",
  "S-8/A",
  "S-11",
  "424B3",
  "424B5",
]);
const STRATEGIC_FORMS = new Set(["S-4", "F-4", "S-4/A", "F-4/A"]);
const IPO_FORMS = new Set(["S-1", "F-1", "S-1/A", "F-1/A"]);
const FUND_OR_UNCLEAR_FORMS = new Set(["S-6", "N-2", "N-4", "N-6", "N-14", "485APOS", "485BPOS", "POS AM", "POS EX"]);

export function routeEffectFiling(parserOutput: EffectParserOutput): EffectRouterDecision {
  const formType = parserOutput.facts.effectiveFilingForm;

  if (formType === null) {
    return {
      deterministic: true,
      requiresLlm: false,
      eventType: "other",
      routeReason:
        "The EFFECT notice does not identify the related registration form, so the room archives it conservatively rather than guessing.",
      preliminaryScore: 30,
      preliminarySignal: "neutral",
      preliminaryConfidence: "low",
      expectedImpact: "low",
      displayType: "generic",
      marketContextNeeded: false,
      marketContextReason: null,
      marketContextFields: [],
      needsHumanReview: true,
    };
  }

  if (parserOutput.facts.parentEventType !== null && shouldReuseParentEventType(formType, parserOutput.facts.parentEventType)) {
    const parentEventType = parserOutput.facts.parentEventType;
    return decisionForKnownForm({
      eventType: parentEventType,
      formType,
      routeReason: routeReasonForParentEffect(parentEventType, formType),
      score: scoreForParentContext(parserOutput.facts.parentScore, parentEventType),
      signal:
        parentEventType === "strategic_transaction" ||
        parentEventType === "ipo_listing"
          ? "neutral"
          : "volatile",
      expectedImpact: "medium",
    });
  }

  if (STRATEGIC_FORMS.has(formType)) {
    return decisionForKnownForm({
      eventType: "strategic_transaction",
      formType,
      routeReason: `${formType} effectiveness usually means a merger, exchange, or acquisition registration statement cleared the SEC effectiveness step.`,
      score: 70,
      signal: "neutral",
      expectedImpact: "medium",
    });
  }

  if (DILUTION_FORMS.has(formType)) {
    return decisionForKnownForm({
      eventType: "dilution_risk",
      formType,
      routeReason: `${formType} is now effective, and related registered securities may become saleable under the filing terms.`,
      score: shelfLike(formType) ? 55 : 62,
      signal: "volatile",
      expectedImpact: "medium",
    });
  }

  if (FUND_OR_UNCLEAR_FORMS.has(formType)) {
    return {
      deterministic: true,
      requiresLlm: false,
      eventType: "other",
      routeReason: `${formType} effectiveness was mechanically identified, but this EFFECT room cannot infer operating-company investor impact from the notice alone.`,
      preliminaryScore: parserOutput.facts.hasSeriesClassContractData ? 25 : 35,
      preliminarySignal: "neutral",
      preliminaryConfidence: parserOutput.facts.hasSeriesClassContractData ? "medium" : "low",
      expectedImpact: "low",
      displayType: "generic",
      marketContextNeeded: false,
      marketContextReason: null,
      marketContextFields: [],
      needsHumanReview: true,
    };
  }

  return {
    deterministic: true,
    requiresLlm: false,
    eventType: "other",
    routeReason: `${formType} was identified, but the EFFECT room does not have a deterministic investor-impact rule for that related form.`,
    preliminaryScore: 35,
    preliminarySignal: "neutral",
    preliminaryConfidence: "low",
    expectedImpact: "low",
    displayType: "generic",
    marketContextNeeded: false,
    marketContextReason: null,
    marketContextFields: [],
    needsHumanReview: true,
  };
}

function decisionForKnownForm(input: {
  eventType: ApprovedEventType;
  formType: string;
  routeReason: string;
  score: number;
  signal: "bullish" | "bearish" | "volatile" | "neutral";
  expectedImpact: "low" | "medium" | "high";
}): EffectRouterDecision {
  return {
    deterministic: true,
    requiresLlm: false,
    eventType: input.eventType,
    routeReason: input.routeReason,
    preliminaryScore: input.score,
    preliminarySignal: input.signal,
    preliminaryConfidence: "high",
    expectedImpact: input.expectedImpact,
    displayType: "generic",
    marketContextNeeded: false,
    marketContextReason: null,
    marketContextFields: [],
    needsHumanReview: false,
  };
}

function shouldReuseParentEventType(formType: string, parentEventType: ApprovedEventType): boolean {
  if (parentEventType === "other") {
    return false;
  }

  if (IPO_FORMS.has(formType)) {
    return parentEventType === "ipo_listing" || parentEventType === "dilution_risk";
  }

  if (STRATEGIC_FORMS.has(formType)) {
    return parentEventType === "strategic_transaction";
  }

  if (DILUTION_FORMS.has(formType)) {
    return parentEventType === "dilution_risk";
  }

  return false;
}

function routeReasonForParentEffect(parentEventType: ApprovedEventType, formType: string): string {
  if (parentEventType === "dilution_risk") {
    return "The related dilution registration is now effective, opening the door to registered share sales or resales under the filing terms.";
  }

  return `This ${formType} EFFECT is linked to the prior ${parentEventType} filing context.`;
}

function scoreForParentContext(parentScore: number | null, parentEventType: ApprovedEventType): number {
  if (parentScore === null) {
    return 62;
  }

  if (parentEventType === "dilution_risk") {
    return scoreForDilutionParentContext(parentScore);
  }

  const capped = Math.max(50, Math.min(parentScore, 74));
  return deliveryLevelForScore(capped) === "feed" ? capped : 62;
}

function scoreForDilutionParentContext(parentScore: number): number {
  if (parentScore < 75) {
    return Math.max(55, Math.min(parentScore, 70));
  }

  if (parentScore < 80) {
    return 74;
  }

  if (parentScore < 90) {
    return Math.min(82, Math.max(75, parentScore - 5));
  }

  return Math.min(88, parentScore - 8);
}

function shelfLike(formType: string): boolean {
  return (
    formType === "S-3" ||
    formType === "F-3" ||
    formType === "S-3/A" ||
    formType === "F-3/A" ||
    formType === "S-3ASR" ||
    formType === "F-3ASR" ||
    formType === "F-10"
  );
}
