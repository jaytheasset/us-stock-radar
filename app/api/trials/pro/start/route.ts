import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { comparePlanRank, getEffectivePlanFromSubscription, type UserPlanSubscriptionRow } from "@/lib/subscription/effectivePlan";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST() {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          guestMode: true,
          error: "ACCOUNT_REQUIRED",
          message: "Create an account or log in to start your Pro trial.",
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const subscription = await readSubscription(userId);
    const planState = getEffectivePlanFromSubscription(subscription);

    if (comparePlanRank(planState.basePlan, "pro") >= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ALREADY_ON_PAID_PLAN",
          message: "Your current plan already includes these features.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    if (planState.trial.active) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIAL_ALREADY_ACTIVE",
          message: `Your Pro trial is already active until ${formatDate(planState.trial.endsAt)}.`,
          trial: planState.trial,
          effectivePlan: planState.effectivePlan,
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    if (planState.trial.used) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIAL_ALREADY_USED",
          message: "You have already used your Pro trial.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + 14 * 86_400_000);
    const trialPayload = buildTrialStartPayload({
      userId,
      subscription,
      planState,
      now,
      endsAt,
    });
    const result = await supabaseUpsert(
      "user_plan_subscriptions",
      trialPayload,
      {
        onConflict: "user_id",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIAL_START_FAILED",
          message: result.error || "Failed to start Pro trial.",
        },
        { status: result.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const updated = Array.isArray(result.data)
      ? getEffectivePlanFromSubscription(result.data[0] as UserPlanSubscriptionRow | undefined)
      : getEffectivePlanFromSubscription(buildFallbackSubscription(subscription, trialPayload));

    return NextResponse.json(
      {
        ok: true,
        basePlan: updated.basePlan,
        effectivePlan: updated.effectivePlan,
        effectivePlanLabel: getPlanDisplayName(updated.effectivePlan),
        planSource: updated.planSource,
        trial: updated.trial,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRIAL_START_FAILED",
        message: error instanceof Error ? error.message : "Failed to start Pro trial.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function readSubscription(userId: string): Promise<UserPlanSubscriptionRow | undefined> {
  const result = await supabaseSelect("user_plan_subscriptions", {
    select: "*",
    user_id: `eq.${userId}`,
    limit: "1",
  });

  return Array.isArray(result.data) ? (result.data[0] as UserPlanSubscriptionRow | undefined) : undefined;
}

function buildTrialStartPayload({
  userId,
  subscription,
  planState,
  now,
  endsAt,
}: {
  userId: string;
  subscription: UserPlanSubscriptionRow | undefined;
  planState: ReturnType<typeof getEffectivePlanFromSubscription>;
  now: Date;
  endsAt: Date;
}) {
  const payload: Record<string, unknown> = {
    user_id: userId,
    trial_plan: "pro",
    trial_started_at: now.toISOString(),
    trial_ends_at: endsAt.toISOString(),
    trial_used_at: now.toISOString(),
    trial_cancelled_at: null,
  };

  if (!subscription) {
    payload.plan = planState.basePlan;
    payload.status = "active";
  }

  return payload;
}

function buildFallbackSubscription(subscription: UserPlanSubscriptionRow | undefined, trialPayload: Record<string, unknown>) {
  return {
    ...subscription,
    plan: subscription?.plan ?? trialPayload.plan,
    status: subscription?.status ?? trialPayload.status,
    trial_plan: trialPayload.trial_plan,
    trial_started_at: trialPayload.trial_started_at,
    trial_ends_at: trialPayload.trial_ends_at,
    trial_used_at: trialPayload.trial_used_at,
    trial_cancelled_at: trialPayload.trial_cancelled_at,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "the end date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the end date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
