import { NextRequest, NextResponse } from "next/server";
import {
  getSecDevRoomDetail,
  getSecDevRoomDiagnostics,
} from "@/lib/development/secFormDevDashboard";
import { parseSecDiagnosticFilters } from "@/lib/development/secDiagnosticSnapshot";
import { respondWithAdminReadAccess } from "@/lib/admin/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DIAGNOSTIC_QUERY_KEYS = new Set(["room", "view", "eventId", "ticker", "accession"]);

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  return respondWithAdminReadAccess(request, "system.read", async () => {
    const room = request.nextUrl.searchParams.get("room") || "";
    const view = request.nextUrl.searchParams.get("view") || "detail";
    if (view !== "detail" && view !== "diagnostics") {
      return {
        ok: false,
        error: {
          code: "INVALID_DIAGNOSTIC_VIEW",
          message: "view must be detail or diagnostics.",
        },
      };
    }

    if (view === "diagnostics") {
      const unsupportedKey = [...request.nextUrl.searchParams.keys()]
        .find((key) => !DIAGNOSTIC_QUERY_KEYS.has(key));
      if (unsupportedKey) {
        return {
          ok: false,
          error: {
            code: "INVALID_DIAGNOSTIC_PARAMETER",
            field: unsupportedKey,
            message: "Only room, view, eventId, ticker, and accession are supported.",
          },
        };
      }
      const parsedFilters = parseSecDiagnosticFilters({
        eventId: request.nextUrl.searchParams.get("eventId"),
        ticker: request.nextUrl.searchParams.get("ticker"),
        accessionNumber: request.nextUrl.searchParams.get("accession"),
      });
      if (!parsedFilters.ok) return { ok: false, error: parsedFilters.error };

      const diagnostics = await getSecDevRoomDiagnostics(room, parsedFilters.filters);
      return diagnostics
        ? { ok: true, diagnostics }
        : { ok: false, error: "Unknown SEC form room." };
    }

    const detail = await getSecDevRoomDetail(room);
    return detail
      ? { ok: true, detail }
      : { ok: false, error: "Unknown SEC form room." };
  }, { status: diagnosticResponseStatus });
}

function diagnosticResponseStatus(data: { ok: boolean; error?: unknown }) {
  if (data.ok) return 200;
  const error = data.error && typeof data.error === "object" && !Array.isArray(data.error)
    ? data.error as Record<string, unknown>
    : null;
  return typeof error?.code === "string" && error.code.startsWith("INVALID_DIAGNOSTIC_") ? 400 : 404;
}
