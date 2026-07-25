import type { Plan } from "@/lib/subscriptionPolicy";

export type AnalysisSignalCompanionAdInput = {
  adsAllowed: boolean;
  bearishCount: number;
  bullishCount: number;
};

export type AnalysisCollapsedRailInlineAdInput = {
  adsAllowed: boolean;
  hasRelatedContent: boolean;
  scoreRationaleVisible: boolean;
};

export function areAdsEnabledForPlan(plan: Plan) {
  return plan === "free";
}

export function shouldShowAnalysisCollapsedRailInlineAd({
  adsAllowed,
  hasRelatedContent,
  scoreRationaleVisible,
}: AnalysisCollapsedRailInlineAdInput) {
  return adsAllowed && !hasRelatedContent && scoreRationaleVisible;
}

export function shouldShowAnalysisSignalCompanionAd({
  adsAllowed,
  bearishCount,
  bullishCount,
}: AnalysisSignalCompanionAdInput) {
  if (!adsAllowed) return false;

  const hasBearishCard = bearishCount > 0;
  const hasBullishCard = bullishCount > 0;
  return hasBearishCard !== hasBullishCard;
}
