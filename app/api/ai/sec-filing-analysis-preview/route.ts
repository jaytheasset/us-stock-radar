import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_PRIVATE_RESPONSE_HEADERS,
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  runSecFilingAnalysisPreview,
  runSecFilingAnalysisPreviewForRawItem,
} from "@/lib/ai/secFilingAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(
    request,
    "data.run",
    async () => {
      const params = request.nextUrl.searchParams;
      return runSecFilingAnalysisPreview({
        dryRun: params.get("dryRun") === "true",
        rawItemId: params.get("rawItemId") || undefined,
        accessionNumber: params.get("accessionNumber") || undefined,
        ticker: params.get("ticker") || undefined,
        calendarCandidate: params.get("calendarCandidate") === "true",
        llmProvider: params.get("llmProvider") || undefined,
        llmModel: params.get("llmModel") || undefined,
        secPromptVariant: params.get("secPromptVariant") || undefined,
      });
    },
    { status: (result) => (result.ok ? 200 : result.status || 502) },
  );
}

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.run");
    const body = await request.json().catch(() => null);
    const rawItem = readRecord(body?.rawItem) || readRecord(body?.raw_item);
    if (!rawItem) {
      const response = NextResponse.json(
        {
          ok: false,
          stage: "raw_item",
          status: 400,
          error: "rawItem is required",
        },
        { status: 400, headers: ADMIN_PRIVATE_RESPONSE_HEADERS },
      );
      applyAdminAuthCookies(response, resolution);
      return response;
    }

    const result = await runSecFilingAnalysisPreviewForRawItem(rawItem, {
      dryRun: body?.dryRun !== false,
      llmProvider: stringValue(body?.llmProvider) || undefined,
      llmModel: stringValue(body?.llmModel) || undefined,
      secPromptVariant: stringValue(body?.secPromptVariant) || undefined,
    });

    const response = NextResponse.json(result, {
      status: result.ok ? 200 : readResultStatus(result),
      headers: ADMIN_PRIVATE_RESPONSE_HEADERS,
    });
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const normalized = normalizeAdminError(error);
    const response = NextResponse.json(
      { ok: false, error: normalized },
      { status: normalized.status, headers: ADMIN_PRIVATE_RESPONSE_HEADERS },
    );
    if (resolution) applyAdminAuthCookies(response, resolution);
    return response;
  }
}

function readResultStatus(result: unknown) {
  const record = readRecord(result);
  return typeof record?.status === "number" && record.status > 0 ? record.status : 502;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
