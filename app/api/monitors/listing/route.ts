import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { parseListingMonitorCreateRequest } from "@/lib/monitor/listingMonitorApi";
import {
  createListingMonitor,
  listListingMonitorsForOwner,
} from "@/lib/monitor/listingMonitorPersistence";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
  monitorInvalidJsonResponse,
  monitorPersistenceErrorResponse,
  monitorRequestErrorResponse,
} from "./shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  try {
    const data = await listListingMonitorsForOwner(userId);
    return NextResponse.json({ ok: true, data }, { headers: MONITOR_API_NO_STORE_HEADERS });
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITORS_READ_FAILED");
  }
}

export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return monitorInvalidJsonResponse();
  const parsed = parseListingMonitorCreateRequest(body);
  if (!parsed.ok) return monitorRequestErrorResponse(parsed);
  try {
    const monitor = await createListingMonitor({
      ownerId: userId,
      conditions: parsed.value.conditions,
    });
    return NextResponse.json(
      { ok: true, data: { monitor } },
      { status: 201, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITOR_CREATE_FAILED");
  }
}
