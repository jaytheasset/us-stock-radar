import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { reportedHoldingsCreateSchema } from "@/lib/monitor/reportedHoldings";
import { verifyFinancialMonitorSelection } from "@/lib/monitor/financialMonitorTargetReader";
import { createReportedHoldingsMonitor, listReportedHoldingsMonitors } from "@/lib/monitor/reportedHoldingsPersistence";
import { listReportedHoldingsAlerts } from "@/lib/monitor/reportedHoldingsConsumer";
import { FINANCIAL_MONITOR_NO_STORE_HEADERS as headers } from "../financial/shared";

export const dynamic = "force-dynamic";
export async function GET() {
  const ownerId = await getOptionalCurrentUserId();
  if (!ownerId) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
  try {
    const [monitors, alerts] = await Promise.all([listReportedHoldingsMonitors(ownerId), listReportedHoldingsAlerts(ownerId)]);
    return NextResponse.json({ ok: true, data: { ...monitors, alerts } }, { headers });
  } catch { return NextResponse.json({ error: "READ_FAILED" }, { status: 502, headers }); }
}
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutationRequest(request, headers);
  if (rejected) return rejected;
  const ownerId = await getOptionalCurrentUserId();
  if (!ownerId) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
  const parsed = reportedHoldingsCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST", message: "Select a company and valid reported holding conditions." }, { status: 400, headers });
  const verified = await verifyFinancialMonitorSelection(parsed.data.target);
  if (verified.status !== "available") return NextResponse.json({ error: "TARGET_NOT_CONFIRMED", message: "Select the company again; its SEC identity could not be confirmed." }, { status: 422, headers });
  try {
    const monitor = await createReportedHoldingsMonitor(ownerId, parsed.data.settings, verified.target);
    return NextResponse.json({ ok: true, data: { monitor } }, { status: 201, headers });
  } catch { return NextResponse.json({ error: "SAVE_FAILED", message: "Could not save reported holding conditions." }, { status: 502, headers }); }
}
