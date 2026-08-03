import type { Metadata } from "next";
import {
  StockRadarPremiumV2,
  type PremiumV2AccountState,
} from "@/components/premium-v2/StockRadarPremiumV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import type { PremiumV2PlanKey } from "@/lib/mock/premiumV2Data";
import type { Plan } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Premium",
  description: "Compare Stock Radar alert coverage, delivery, and market scanning plans.",
};

const premiumPlanKeyByPlan: Record<Plan, PremiumV2PlanKey> = {
  free: "free",
  ad_free: "adFree",
  pro: "pro",
  advanced: "advanced",
  ultimate: "ultimate",
};

export default async function PremiumPage() {
  const userId = await getOptionalCurrentUserId();
  const planState = userId ? await getEffectiveUserPlan(userId) : null;

  const accountState: PremiumV2AccountState = planState
    ? {
        authenticated: true,
        basePlan: premiumPlanKeyByPlan[planState.basePlan],
        currentPlan: premiumPlanKeyByPlan[planState.effectivePlan],
        planSource: planState.planSource,
        trial: {
          active: planState.trial.active,
          ...(planState.trial.plan ? { plan: planState.trial.plan } : {}),
          used: planState.trial.used,
          ...(planState.trial.daysRemaining
            ? { daysRemaining: planState.trial.daysRemaining }
            : {}),
        },
      }
    : {
        authenticated: false,
        basePlan: "free",
        currentPlan: "free",
        planSource: "base",
        trial: {
          active: false,
          used: false,
        },
      };

  return (
    <StockRadarAppShell activeNavigationItem="premium" themeMode="user-selectable">
      <StockRadarPremiumV2 accountState={accountState} />
    </StockRadarAppShell>
  );
}
