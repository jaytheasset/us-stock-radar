import { NextRequest, NextResponse } from "next/server";
import { runFmpEconomicCalendarIngest } from "@/lib/calendar-v1/fmpEconomicCalendarIngest";
import { parseFmpEconomicCalendarIngestRequest } from "@/lib/calendar-v1/fmpEconomicCalendarIngestCore";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  return handleRequest("GET", request, null);
}

export async function POST(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  return handleRequest("POST", request, body);
}

async function handleRequest(
  method: "GET" | "POST",
  request: NextRequest,
  body: unknown,
) {
  const parsed = parseFmpEconomicCalendarIngestRequest(
    method,
    request.nextUrl.searchParams,
    body,
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: parsed.error, ok: false },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  try {
    const result = await runFmpEconomicCalendarIngest(parsed.request);
    return NextResponse.json(result, {
      headers: NO_STORE_HEADERS,
      status: result.ok ? 200 : 502,
    });
  } catch {
    return NextResponse.json(
      {
        error: "FMP_ECONOMIC_CALENDAR_INGEST_FAILED",
        message: "FMP economic Calendar ingest could not be completed.",
        ok: false,
      },
      { headers: NO_STORE_HEADERS, status: 502 },
    );
  }
}
