import { NextRequest, NextResponse } from "next/server";
import {
  CalendarRepositoryError,
  parseNormalizedCalendarRange,
} from "@/lib/calendar-v1/normalized";
import { getNormalizedCalendarEvents } from "@/lib/calendar-v1/repository";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function GET(request: NextRequest) {
  const parsed = parseNormalizedCalendarRange(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  try {
    const data = await getNormalizedCalendarEvents(parsed.range);
    return NextResponse.json(
      {
        ok: true,
        count: data.length,
        data,
        range: parsed.range,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const code =
      error instanceof CalendarRepositoryError
        ? error.code
        : "CALENDAR_DATA_UNAVAILABLE";
    console.error("[calendar-normalized-read]", { code });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code,
          message:
            code === "CALENDAR_RESULT_LIMIT"
              ? "This range contains too many events. Choose a shorter range."
              : "Calendar events are temporarily unavailable.",
        },
      },
      {
        headers: NO_STORE_HEADERS,
        status: code === "CALENDAR_RESULT_LIMIT" ? 422 : 502,
      },
    );
  }
}
