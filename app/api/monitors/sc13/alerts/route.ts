import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { isSc13MonitorUuid } from "@/lib/monitor/sc13MonitorApi";
import { listSc13MonitorAlertsForOwner } from "@/lib/monitor/sc13MonitorAlertConsumer";
import { buildSc13AlertDisplay } from "@/lib/monitor/sc13MonitorAlertDisplayServer";
import { SC13_MONITOR_NO_STORE_HEADERS, sc13MonitorAuthRequiredResponse, sc13MonitorPersistenceErrorResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return sc13MonitorAuthRequiredResponse();
  const monitorId = request.nextUrl.searchParams.get("monitorId")?.trim();
  if (monitorId && !isSc13MonitorUuid(monitorId)) return NextResponse.json({ ok: false, error: "INVALID_MONITOR_ID" }, { status: 400, headers: SC13_MONITOR_NO_STORE_HEADERS });
  try { return NextResponse.json({ ok: true, data: { alerts: await buildSc13AlertDisplay(await listSc13MonitorAlertsForOwner({ ownerId: userId, ...(monitorId ? { monitorId } : {}) })) } }, { headers: SC13_MONITOR_NO_STORE_HEADERS }); }
  catch (error) { return sc13MonitorPersistenceErrorResponse(error, "SC13_MONITOR_ALERTS_READ_FAILED"); }
}
