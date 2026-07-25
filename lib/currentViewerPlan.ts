import "server-only";

import { cache } from "react";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import type { Plan } from "@/lib/subscriptionPolicy";

export const getCurrentViewerPlan = cache(async (): Promise<Plan> => {
  const userId = await getOptionalCurrentUserId();
  return userId
    ? (await getEffectiveUserPlan(userId)).effectivePlan
    : "free";
});
