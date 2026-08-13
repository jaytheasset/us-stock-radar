import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { validateListingMonitorCandidate } from "@/lib/monitor/listingMonitorApi";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
} from "../shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        conditions: [],
        errors: ["invalid_json"],
        error: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      { status: 400, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
  const validation = validateListingMonitorCandidate(body);
  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        conditions: validation.conditions,
        errors: validation.errors,
        error: validation.error.code,
        message: validation.error.message,
      },
      { status: validation.error.status, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      valid: true,
      conditions: validation.conditions,
      errors: validation.errors,
    },
    { headers: MONITOR_API_NO_STORE_HEADERS },
  );
}
