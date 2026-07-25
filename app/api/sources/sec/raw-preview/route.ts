import { NextRequest, NextResponse } from "next/server";
import { fetchSecEdgarRawItems } from "@/lib/sources/sec/parser";
import { sourceDiagnosticAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = sourceDiagnosticAuthResponse(request);
  if (unauthorized) return unauthorized;

  const params = request.nextUrl.searchParams;
  const limit = readNumber(params.get("limit"), 3, 1, 20);
  const countPerForm = readNumber(params.get("countPerForm"), 5, 1, 40);
  const attachmentLimit = readNumber(params.get("attachmentLimit"), 3, 0, 10);
  const includeDocuments = params.get("includeDocuments") !== "false";
  const formTypes = readCsv(params.get("formTypes") || params.get("forms"));
  const result = await fetchSecEdgarRawItems({
    formTypes,
    countPerForm,
    limit,
    includeDocuments,
    attachmentLimit,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function readCsv(value: string | null) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function readNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
