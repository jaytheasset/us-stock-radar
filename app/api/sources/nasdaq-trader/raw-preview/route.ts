import { NextRequest, NextResponse } from "next/server";
import { fetchNasdaqTraderRawItems } from "@/lib/sources/nasdaqtrader/parser";
import { sourceDiagnosticAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = sourceDiagnosticAuthResponse(request);
  if (unauthorized) return unauthorized;

  const params = request.nextUrl.searchParams;
  const limit = readNumber(params.get("limit"), 10, 1, 50);
  const sourceUniqueId = readString(params.get("sourceUniqueId"));
  const haltDate = readString(params.get("haltDate") || params.get("haltdate"));
  const resumptionDate = readString(params.get("resumptionDate") || params.get("resumedate"));
  const result = await fetchNasdaqTraderRawItems({
    limit,
    sourceUniqueId,
    haltDate,
    resumptionDate,
    includeArticleBody: false,
    articleBodyLimit: 0,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function readNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readString(value: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
