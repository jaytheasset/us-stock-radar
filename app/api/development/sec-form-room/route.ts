import { NextRequest, NextResponse } from "next/server";
import {
  getSecDevRoomDetail,
  getSecDevRoomDiagnostics,
} from "@/lib/development/secFormDevDashboard";
import { parseSecDiagnosticFilters } from "@/lib/development/secDiagnosticSnapshot";
import { respondWithAdminReadAccess } from "@/lib/admin/api";
import { readSecTickerResolutionByDecisionId } from "@/lib/sec-ticker-resolution/persistence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DIAGNOSTIC_QUERY_KEYS = new Set(["room", "view", "eventId", "ticker", "accession", "resolutionId"]);

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  return respondWithAdminReadAccess(request, "system.read", async () => {
    const room = request.nextUrl.searchParams.get("room") || "";
    const view = request.nextUrl.searchParams.get("view") || "detail";
    if (view !== "detail" && view !== "diagnostics" && view !== "resolution") {
      return {
        ok: false,
        error: {
          code: "INVALID_DIAGNOSTIC_VIEW",
          message: "view must be detail, diagnostics, or resolution.",
        },
      };
    }

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

    if (view === "resolution") {
      const resolutionId = request.nextUrl.searchParams.get("resolutionId") || "";
      const hasUnrelatedFilter = ["eventId", "ticker", "accession"]
        .some((key) => request.nextUrl.searchParams.has(key));
      if (!resolutionId || hasUnrelatedFilter) {
        return {
          ok: false,
          error: {
            code: "INVALID_RESOLUTION_FILTER",
            message: "Resolution view requires only one resolutionId.",
          },
        };
      }
      const resolution = await readSecTickerResolutionByDecisionId({ decisionId: resolutionId });
      if (resolution.status === "available") return { ok: true, resolution };
      if (resolution.status === "not_found") {
        return {
          ok: false,
          error: {
            code: "RESOLUTION_NOT_FOUND",
            message: "No saved ticker resolution matches that decision ID.",
          },
        };
      }
      if (resolution.reason === "invalid_decision_id") {
        return {
          ok: false,
          error: {
            code: "INVALID_RESOLUTION_ID",
            message: "resolutionId must be a valid UUID.",
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "RESOLUTION_READ_UNAVAILABLE",
          message: "The saved ticker resolution could not be validated.",
          reason: resolution.reason,
        },
      };
    }

    const parsedFilters = parseSecDiagnosticFilters({
      eventId: request.nextUrl.searchParams.get("eventId"),
      ticker: request.nextUrl.searchParams.get("ticker"),
      accessionNumber: request.nextUrl.searchParams.get("accession"),
    });
    if (!parsedFilters.ok) return { ok: false, error: parsedFilters.error };

    if (view === "diagnostics") {
      const diagnostics = await getSecDevRoomDiagnostics(room, parsedFilters.filters);
      return diagnostics
        ? { ok: true, diagnostics }
        : { ok: false, error: "Unknown SEC form room." };
    }

    const detail = await getSecDevRoomDetail(room, parsedFilters.filters);
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
  if (error?.code === "RESOLUTION_READ_UNAVAILABLE") return 503;
  return typeof error?.code === "string" && error.code.startsWith("INVALID_") ? 400 : 404;
}
