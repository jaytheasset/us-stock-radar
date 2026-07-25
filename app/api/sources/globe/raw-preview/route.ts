import { NextRequest, NextResponse } from "next/server";
import { fetchGlobeNewswireRawItems } from "@/lib/sources/globe/parser";
import { sourceDiagnosticAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = sourceDiagnosticAuthResponse(request);
  if (unauthorized) return unauthorized;

  const params = request.nextUrl.searchParams;
  const limit = readNumber(params.get("limit"), 10, 1, 50);
  const includeArticleBody = params.get("includeArticleBody") !== "false";
  const articleBodyLimit = readNumber(params.get("articleBodyLimit"), Math.min(limit, 3), 0, limit);
  const sourceUniqueId = readString(params.get("sourceUniqueId"));
  const result = await fetchGlobeNewswireRawItems({
    limit,
    sourceUniqueId,
    includeArticleBody,
    articleBodyLimit,
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
