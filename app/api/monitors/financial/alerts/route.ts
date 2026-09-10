import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { isFinancialMonitorUuid } from "@/lib/monitor/financialMonitorApi";
import { listFinancialMonitorAlertsForOwner } from "@/lib/monitor/financialMonitorAlertConsumer";
import { FINANCIAL_MONITOR_NO_STORE_HEADERS, financialMonitorAuthRequiredResponse, financialMonitorPersistenceErrorResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return financialMonitorAuthRequiredResponse();
  const monitorId = request.nextUrl.searchParams.get("monitorId")?.trim();
  if (monitorId && !isFinancialMonitorUuid(monitorId)) return NextResponse.json({ ok: false, error: "INVALID_MONITOR_ID" }, { status: 400, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
  try { return NextResponse.json({ ok: true, data: { alerts: await listFinancialMonitorAlertsForOwner({ ownerId: userId, ...(monitorId ? { monitorId } : {}) }) } }, { headers: FINANCIAL_MONITOR_NO_STORE_HEADERS }); }
  catch (error) { return financialMonitorPersistenceErrorResponse(error, "FINANCIAL_MONITOR_ALERTS_READ_FAILED"); }
}
