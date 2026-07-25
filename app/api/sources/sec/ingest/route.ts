import { NextRequest, NextResponse } from "next/server";
import { runSecRawIngest } from "@/lib/secIngest";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const result = await runSecRawIngest({
    limit: readNumber(request.nextUrl.searchParams.get("limit"), bodyRecord.limit, 1, 50, 3),
    accessionNumber:
      request.nextUrl.searchParams.get("accessionNumber") || stringValue(bodyRecord.accessionNumber) || undefined,
    cik: request.nextUrl.searchParams.get("cik") || stringValue(bodyRecord.cik) || undefined,
    countPerForm: readNumber(request.nextUrl.searchParams.get("countPerForm"), bodyRecord.countPerForm, 1, 100, 10),
    attachmentLimit: readNumber(
      request.nextUrl.searchParams.get("attachmentLimit"),
      bodyRecord.attachmentLimit,
      0,
      20,
      6,
    ),
    formTypes: readCsv(request.nextUrl.searchParams.get("formTypes")) || readCsvValue(bodyRecord.formTypes),
    includeDocuments:
      request.nextUrl.searchParams.get("includeDocuments") === "false"
        ? false
        : bodyRecord.includeDocuments === false
          ? false
          : true,
    dryRun: request.nextUrl.searchParams.get("dryRun") === "true" || bodyRecord.dryRun === true,
    force: request.nextUrl.searchParams.get("force") === "true" || bodyRecord.force === true,
  });

  return NextResponse.json(result, {
    status: responseStatus(result),
  });
}

export async function GET(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;

  const result = await runSecRawIngest({
    limit: readNumber(request.nextUrl.searchParams.get("limit"), null, 1, 50, 3),
    accessionNumber: request.nextUrl.searchParams.get("accessionNumber") || undefined,
    cik: request.nextUrl.searchParams.get("cik") || undefined,
    countPerForm: readNumber(request.nextUrl.searchParams.get("countPerForm"), null, 1, 100, 10),
    attachmentLimit: readNumber(request.nextUrl.searchParams.get("attachmentLimit"), null, 0, 20, 6),
    formTypes: readCsv(request.nextUrl.searchParams.get("formTypes")),
    includeDocuments: request.nextUrl.searchParams.get("includeDocuments") !== "false",
    dryRun: request.nextUrl.searchParams.get("dryRun") !== "false",
    force: request.nextUrl.searchParams.get("force") === "true",
  });

  return NextResponse.json(result, {
    status: responseStatus(result),
  });
}

function responseStatus(result: { ok: boolean; stage?: string; stats?: { raw_upserted_count?: number } }) {
  if (result.ok) return 200;
  if ((result.stage === "complete" || result.stage === "dry_run") && (result.stats?.raw_upserted_count || 0) > 0) {
    return 200;
  }
  return 502;
}

function readCsv(value: string | null) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function readCsvValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return readCsv(value);
  return undefined;
}

function readNumber(
  queryValue: string | null,
  bodyValue: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const value = queryValue ?? bodyValue;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
