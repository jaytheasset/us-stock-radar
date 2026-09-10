import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { validateFinancialMonitorCandidate } from "@/lib/monitor/financialMonitorApi";
import { FINANCIAL_MONITOR_NO_STORE_HEADERS, financialMonitorAuthRequiredResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, FINANCIAL_MONITOR_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  if (!await getOptionalCurrentUserId()) return financialMonitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ ok: false, valid: false, conditions: [], errors: ["invalid_json"], error: "INVALID_JSON" }, { status: 400, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
  const validation = validateFinancialMonitorCandidate(body);
  return validation.valid
    ? NextResponse.json({ ok: true, ...validation }, { headers: FINANCIAL_MONITOR_NO_STORE_HEADERS })
    : NextResponse.json({ ok: false, ...validation, error: validation.error.code, message: validation.error.message }, { status: validation.error.status, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
}
