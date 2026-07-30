import { NextRequest, NextResponse } from "next/server";
import { runFmpCompanyCalendarIngest } from "@/lib/calendar-v1/fmpCalendarIngest";
import { parseFmpCalendarIngestRequest } from "@/lib/calendar-v1/fmpCalendarIngestCore";
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
  const parsed = parseFmpCalendarIngestRequest(
    method,
    request.nextUrl.searchParams,
    body,
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "INVALID_REQUEST", message: parsed.error },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  try {
    const result = await runFmpCompanyCalendarIngest(parsed.request);
    return NextResponse.json(result, {
      headers: NO_STORE_HEADERS,
      status: result.ok ? 200 : 502,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "FMP_CALENDAR_INGEST_FAILED",
        message: "FMP Calendar ingest could not be completed.",
      },
      { headers: NO_STORE_HEADERS, status: 502 },
    );
  }
}
