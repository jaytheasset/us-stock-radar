import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { parseSc13MonitorCreateRequest } from "@/lib/monitor/sc13MonitorApi";
import { createSc13Monitor, listSc13MonitorsForOwner } from "@/lib/monitor/sc13MonitorPersistence";
import { SC13_MONITOR_NO_STORE_HEADERS, sc13MonitorAuthRequiredResponse, sc13MonitorPersistenceErrorResponse, sc13MonitorRequestErrorResponse } from "./shared";

export const dynamic = "force-dynamic";
export async function GET() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) return sc13MonitorAuthRequiredResponse();
  try { return NextResponse.json({ ok: true, data: await listSc13MonitorsForOwner(userId) }, { headers: SC13_MONITOR_NO_STORE_HEADERS }); }
  catch (error) { return sc13MonitorPersistenceErrorResponse(error, "SC13_MONITORS_READ_FAILED"); }
}
export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, SC13_MONITOR_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await getOptionalCurrentUserId();
  if (!userId) return sc13MonitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON." }, { status: 400, headers: SC13_MONITOR_NO_STORE_HEADERS });
  const parsed = parseSc13MonitorCreateRequest(body);
  if (!parsed.ok) return sc13MonitorRequestErrorResponse(parsed);
  try {
    const monitor = await createSc13Monitor({ ownerId: userId, target: parsed.value.target, conditions: parsed.value.conditions });
    return NextResponse.json({ ok: true, data: { monitor } }, { status: 201, headers: SC13_MONITOR_NO_STORE_HEADERS });
  } catch (error) { return sc13MonitorPersistenceErrorResponse(error, "SC13_MONITOR_CREATE_FAILED"); }
}
