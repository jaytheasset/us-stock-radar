import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  listListingMonitorAlertsForOwner,
  parseListingMonitorAlertQuery,
} from "@/lib/monitor/listingMonitorApi";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
  monitorPersistenceErrorResponse,
  monitorRequestErrorResponse,
} from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const query = parseListingMonitorAlertQuery(request.nextUrl.searchParams);
  if (!query.ok) return monitorRequestErrorResponse(query);
  try {
    const data = await listListingMonitorAlertsForOwner({ ownerId: userId, ...query });
    return NextResponse.json({ ok: true, data }, { headers: MONITOR_API_NO_STORE_HEADERS });
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITOR_ALERTS_READ_FAILED");
  }
}
