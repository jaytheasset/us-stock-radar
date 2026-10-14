import {has425} from "@/lib/sec425/conditions";
import {allowedUser} from "@/lib/sec425/consumer";
import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  isListingMonitorUuid,
  parseListingMonitorUpdateRequest,
} from "@/lib/monitor/listingMonitorApi";
import {
  deleteListingMonitor,
  readListingMonitorForOwner,
  updateListingMonitor,
} from "@/lib/monitor/listingMonitorPersistence";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
  monitorInvalidJsonResponse,
  monitorPersistenceErrorResponse,
  monitorRequestErrorResponse,
} from "../shared";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ monitorId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const monitorId = await readMonitorId(context);
  if (!monitorId) return invalidMonitorIdResponse();
  try {
    const result = await readListingMonitorForOwner(userId, monitorId);
    if (result.status === "not_found") return monitorNotFoundResponse();
    return NextResponse.json({ ok: true, data: result }, { headers: MONITOR_API_NO_STORE_HEADERS });
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITOR_READ_FAILED");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originRejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const monitorId = await readMonitorId(context);
  if (!monitorId) return invalidMonitorIdResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return monitorInvalidJsonResponse();
  const parsed = parseListingMonitorUpdateRequest(body);
  if (!parsed.ok) return monitorRequestErrorResponse(parsed);
  try {
    const current=await readListingMonitorForOwner(userId,monitorId);
    if(current.status!=="available")return monitorNotFoundResponse();
    if((has425(current.monitor.conditions)||has425(parsed.value.conditions??[]))&&!(parsed.value.isActive===false&&parsed.value.conditions===undefined)&&!await allowedUser(userId))return NextResponse.json({ok:false,error:"PRO_REQUIRED",message:"425 monitors require Pro access."},{status:403,headers:MONITOR_API_NO_STORE_HEADERS});
    const monitor = await updateListingMonitor({
      ownerId: userId,
      monitorId,
      ...parsed.value,
    });
    return NextResponse.json({ ok: true, data: { monitor } }, { headers: MONITOR_API_NO_STORE_HEADERS });
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITOR_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const originRejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const monitorId = await readMonitorId(context);
  if (!monitorId) return invalidMonitorIdResponse();
  try {
    const deleted = await deleteListingMonitor(userId, monitorId);
    if (!deleted) return monitorNotFoundResponse();
    return NextResponse.json(
      { ok: true, data: { id: monitorId, deleted: true } },
      { headers: MONITOR_API_NO_STORE_HEADERS },
    );
  } catch (error) {
    return monitorPersistenceErrorResponse(error, "LISTING_MONITOR_DELETE_FAILED");
  }
}

async function readMonitorId(context: RouteContext) {
  const { monitorId } = await context.params;
  const decoded = decodeURIComponent(monitorId).trim();
  return isListingMonitorUuid(decoded) ? decoded : null;
}

function invalidMonitorIdResponse() {
  return NextResponse.json(
    { ok: false, error: "INVALID_MONITOR_ID", message: "monitorId must be a UUID." },
    { status: 400, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}

function monitorNotFoundResponse() {
  return NextResponse.json(
    { ok: false, error: "LISTING_MONITOR_NOT_FOUND", message: "Listing monitor was not found." },
    { status: 404, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}
