import "server-only";

import { getPlanLimits, type Plan, type PlanLimits } from "@/lib/subscriptionPolicy";
import { supabaseSelect } from "@/lib/supabase";

export type PlanSource = "base" | "trial";

export type TrialState = {
  active: boolean;
  used: boolean;
  expired?: boolean;
  plan?: "pro";
  startedAt?: string | null;
  endsAt?: string | null;
  endedAt?: string | null;
  cancelledAt?: string | null;
  daysRemaining?: number;
};

export type EffectiveUserPlan = {
  basePlan: Plan;
  effectivePlan: Plan;
  planSource: PlanSource;
  trial: TrialState;
};

export type UserPlanSubscriptionRow = {
  plan?: unknown;
  status?: unknown;
  trial_plan?: unknown;
  trial_started_at?: unknown;
  trial_ends_at?: unknown;
  trial_used_at?: unknown;
  trial_cancelled_at?: unknown;
};

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  ad_free: 1,
  pro: 2,
  advanced: 3,
  ultimate: 4,
};

export async function getEffectiveUserPlan(userId: string): Promise<EffectiveUserPlan> {
  const result = await supabaseSelect("user_plan_subscriptions", {
    select: "*",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const row = Array.isArray(result.data) ? (result.data[0] as UserPlanSubscriptionRow | undefined) : undefined;

  return getEffectivePlanFromSubscription(row);
}

export function getEffectivePlanFromSubscription(
  subscription?: UserPlanSubscriptionRow | null,
  now: Date = new Date(),
): EffectiveUserPlan {
  const basePlan = readBasePlan(subscription);
  const trial = getTrialState(subscription, now);
  const paidPlanTakesPriority = PLAN_RANK[basePlan] >= PLAN_RANK.pro;

  if (!paidPlanTakesPriority && trial.active) {
    return {
      basePlan,
      effectivePlan: "pro",
      planSource: "trial",
      trial,
    };
  }

  return {
    basePlan,
    effectivePlan: basePlan,
    planSource: "base",
    trial,
  };
}

export function getEffectivePlanLimits(subscription?: UserPlanSubscriptionRow | null): PlanLimits {
  return getPlanLimits(getEffectivePlanFromSubscription(subscription).effectivePlan);
}

export function isTrialActive(subscription?: UserPlanSubscriptionRow | null, now: Date = new Date()) {
  return getTrialState(subscription, now).active;
}

export function getTrialState(subscription?: UserPlanSubscriptionRow | null, now: Date = new Date()): TrialState {
  const trialPlan = readString(subscription?.trial_plan);
  const startedAt = readString(subscription?.trial_started_at) || null;
  const endsAt = readString(subscription?.trial_ends_at) || null;
  const usedAt = readString(subscription?.trial_used_at) || null;
  const cancelledAt = readString(subscription?.trial_cancelled_at) || null;
  const endsTime = endsAt ? Date.parse(endsAt) : NaN;
  const isProTrial = trialPlan === "pro";
  const active = Boolean(isProTrial && startedAt && Number.isFinite(endsTime) && endsTime > now.getTime() && !cancelledAt);
  const used = Boolean(usedAt);
  const expired = Boolean(isProTrial && used && Number.isFinite(endsTime) && endsTime <= now.getTime());

  if (active) {
    return {
      active: true,
      used: true,
      plan: "pro",
      startedAt,
      endsAt,
      cancelledAt,
      daysRemaining: Math.max(1, Math.ceil((endsTime - now.getTime()) / 86_400_000)),
    };
  }

  return {
    active: false,
    used,
    expired,
    plan: isProTrial ? "pro" : undefined,
    startedAt,
    endsAt,
    endedAt: expired ? endsAt : null,
    cancelledAt,
  };
}

export function comparePlanRank(a: Plan, b: Plan) {
  return PLAN_RANK[a] - PLAN_RANK[b];
}

function readBasePlan(subscription?: UserPlanSubscriptionRow | null): Plan {
  const status = readString(subscription?.status);
  if (status && status !== "active") return "free";

  const plan = readString(subscription?.plan);
  if (isPlan(plan)) return plan;
  return "free";
}

function isPlan(value: string): value is Plan {
  return value === "free" || value === "ad_free" || value === "pro" || value === "advanced" || value === "ultimate";
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  return "";
}
