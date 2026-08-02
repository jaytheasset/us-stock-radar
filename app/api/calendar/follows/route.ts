import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import {
  CalendarFollowError,
  getUserCalendarFollowsViewModel,
  setUserCalendarFollow,
} from "@/lib/alerts/calendarFollows";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import { getPlanLimits } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        {
          ok: true,
          guestMode: true,
          data: {
            follows: [],
            usage: {
              activeCount: 0,
              limit: getPlanLimits("free").calendarEventFollowLimit,
              remaining: getPlanLimits("free").calendarEventFollowLimit,
            },
          },
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const planState = await getEffectiveUserPlan(userId);

    return NextResponse.json(
      {
        ok: true,
        guestMode: false,
        data: await getUserCalendarFollowsViewModel(
          userId,
          planState.effectivePlan,
        ),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "Failed to load followed calendar events.");
  }
}

export async function PATCH(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          error: "AUTH_REQUIRED",
          message: "Sign in to follow calendar events.",
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      eventId?: unknown;
      enabled?: unknown;
    } | null;
    if (typeof body?.eventId !== "string" || typeof body?.enabled !== "boolean") {
      throw new CalendarFollowError(
        "INVALID_CALENDAR_FOLLOW",
        "eventId and enabled are required.",
      );
    }

    const planState = await getEffectiveUserPlan(userId);
    return NextResponse.json(
      {
        ok: true,
        data: await setUserCalendarFollow({
          userId,
          eventId: body.eventId,
          enabled: body.enabled,
          plan: planState.effectivePlan,
        }),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "Failed to update the calendar event follow.");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CalendarFollowError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
        ...error.details,
      },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: "CALENDAR_FOLLOW_FAILED",
      message: error instanceof Error ? error.message : fallback,
    },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
