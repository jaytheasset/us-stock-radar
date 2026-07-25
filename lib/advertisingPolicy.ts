import type { Plan } from "@/lib/subscriptionPolicy";

export type AnalysisSignalCompanionAdInput = {
  adsAllowed: boolean;
  bearishCount: number;
  bullishCount: number;
};

export function areAdsEnabledForPlan(plan: Plan) {
  return plan === "free";
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
