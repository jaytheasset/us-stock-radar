import "server-only";

import { cache } from "react";
import { getOptionalCurrentUserIdReadOnly } from "@/lib/currentUser";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import type { Plan } from "@/lib/subscriptionPolicy";

export const getCurrentViewerPlan = cache(async (): Promise<Plan> => {
  const userId = await getOptionalCurrentUserIdReadOnly();
  return userId
    ? (await getEffectiveUserPlan(userId)).effectivePlan
    : "free";
});
