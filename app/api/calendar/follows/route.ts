import { NextRequest, NextResponse } from "next/server";
import {
  CalendarFollowError,
  getUserCalendarFollows,
  setUserCalendarFollow,
} from "@/lib/alerts/calendarFollows";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { ok: true, guestMode: true, data: [] },
        { headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        guestMode: false,
        data: await getUserCalendarFollows(userId),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "Failed to load followed calendar events.");
  }
}

export async function PATCH(request: NextRequest) {
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

    return NextResponse.json(
      {
        ok: true,
        data: await setUserCalendarFollow({
          userId,
          eventId: body.eventId,
          enabled: body.enabled,
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
      { ok: false, error: error.code, message: error.message },
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
