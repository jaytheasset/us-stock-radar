import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { parseFinancialMonitorCreateRequest } from "@/lib/monitor/financialMonitorApi";
import { createFinancialMonitor, listFinancialMonitorsForOwner } from "@/lib/monitor/financialMonitorPersistence";
import { FINANCIAL_MONITOR_NO_STORE_HEADERS, financialMonitorAuthRequiredResponse, financialMonitorPersistenceErrorResponse, financialMonitorRequestErrorResponse } from "./shared";

export const dynamic = "force-dynamic";
export async function GET() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return financialMonitorAuthRequiredResponse();
  try { return NextResponse.json({ ok: true, data: await listFinancialMonitorsForOwner(userId) }, { headers: FINANCIAL_MONITOR_NO_STORE_HEADERS }); }
  catch (error) { return financialMonitorPersistenceErrorResponse(error, "FINANCIAL_MONITORS_READ_FAILED"); }
}
export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, FINANCIAL_MONITOR_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return financialMonitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON." }, { status: 400, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
  const parsed = parseFinancialMonitorCreateRequest(body);
  if (!parsed.ok) return financialMonitorRequestErrorResponse(parsed);
  try {
    const monitor = await createFinancialMonitor({ ownerId: userId, conditions: parsed.value.conditions });
    return NextResponse.json({ ok: true, data: { monitor } }, { status: 201, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
  } catch (error) { return financialMonitorPersistenceErrorResponse(error, "FINANCIAL_MONITOR_CREATE_FAILED"); }
}
