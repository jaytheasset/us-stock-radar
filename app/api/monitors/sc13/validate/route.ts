import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { validateSc13MonitorCandidate } from "@/lib/monitor/sc13MonitorApi";
import { SC13_MONITOR_NO_STORE_HEADERS, sc13MonitorAuthRequiredResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, SC13_MONITOR_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  if (!await getOptionalCurrentUserId()) return sc13MonitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ ok: false, valid: false, target: null, conditions: [], errors: ["invalid_json"], error: "INVALID_JSON" }, { status: 400, headers: SC13_MONITOR_NO_STORE_HEADERS });
  const validation = validateSc13MonitorCandidate(body);
  return validation.valid
    ? NextResponse.json({ ok: true, ...validation }, { headers: SC13_MONITOR_NO_STORE_HEADERS })
    : NextResponse.json({ ok: false, ...validation, error: validation.error.code, message: validation.error.message }, { status: validation.error.status, headers: SC13_MONITOR_NO_STORE_HEADERS });
}
