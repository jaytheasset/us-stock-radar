import { NextResponse } from "next/server.js";
import type { FinancialMonitorApiRequestError } from "../../../../lib/monitor/financialMonitorApi.ts";
import { FinancialMonitorPersistenceError } from "../../../../lib/monitor/financialMonitorPersistence.ts";

export const FINANCIAL_MONITOR_NO_STORE_HEADERS = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" };
export function financialMonitorAuthRequiredResponse() {
  return NextResponse.json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to manage Financial monitors." }, { status: 401, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
}
export function financialMonitorRequestErrorResponse(error: FinancialMonitorApiRequestError) {
  return NextResponse.json({ ok: false, error: error.code, message: error.message, errors: error.errors }, { status: error.status, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
}
export function financialMonitorPersistenceErrorResponse(error: unknown, fallbackCode: string) {
  if (error instanceof FinancialMonitorPersistenceError) {
    return NextResponse.json({ ok: false, error: error.code.toUpperCase(), message: error.message, errors: error.details }, { status: error.code === "financial_monitor_invalid" ? 422 : 502, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
  }
  return NextResponse.json({ ok: false, error: fallbackCode, message: error instanceof Error ? error.message : "Financial Monitor request failed." }, { status: 500, headers: FINANCIAL_MONITOR_NO_STORE_HEADERS });
}
