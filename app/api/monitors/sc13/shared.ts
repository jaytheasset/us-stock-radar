import { NextResponse } from "next/server.js";
import type { Sc13MonitorApiRequestError } from "../../../../lib/monitor/sc13MonitorApi.ts";
import { Sc13MonitorPersistenceError } from "../../../../lib/monitor/sc13MonitorPersistence.ts";

export const SC13_MONITOR_NO_STORE_HEADERS = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" };
export function sc13MonitorAuthRequiredResponse() {
  return NextResponse.json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to manage Schedule 13 monitors." }, { status: 401, headers: SC13_MONITOR_NO_STORE_HEADERS });
}
export function sc13MonitorRequestErrorResponse(error: Sc13MonitorApiRequestError) {
  return NextResponse.json({ ok: false, error: error.code, message: error.message, errors: error.errors }, { status: error.status, headers: SC13_MONITOR_NO_STORE_HEADERS });
}
export function sc13MonitorPersistenceErrorResponse(error: unknown, fallbackCode: string) {
  if (error instanceof Sc13MonitorPersistenceError) {
    return NextResponse.json({ ok: false, error: error.code.toUpperCase(), message: error.message, errors: error.details }, { status: error.code === "sc13_monitor_invalid" ? 422 : 502, headers: SC13_MONITOR_NO_STORE_HEADERS });
  }
  return NextResponse.json({ ok: false, error: fallbackCode, message: error instanceof Error ? error.message : "Schedule 13 Monitor request failed." }, { status: 500, headers: SC13_MONITOR_NO_STORE_HEADERS });
}
