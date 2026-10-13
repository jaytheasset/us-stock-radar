import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { readFinancialMonitorTarget } from "@/lib/monitor/financialMonitorTargetReader";
import { FINANCIAL_MONITOR_NO_STORE_HEADERS, financialMonitorAuthRequiredResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await getOptionalCurrentUserId()) return financialMonitorAuthRequiredResponse();
  const result = await readFinancialMonitorTarget(request.nextUrl.searchParams.get("ticker") ?? "");
  return NextResponse.json(result, { headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
}
