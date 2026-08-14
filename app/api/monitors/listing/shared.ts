import { NextResponse } from "next/server.js";
import {
  ListingMonitorAlertReadError,
  type ListingMonitorApiRequestError,
} from "../../../../lib/monitor/listingMonitorApi.ts";
import { ListingMonitorPersistenceError } from "../../../../lib/monitor/listingMonitorPersistence.ts";

export const MONITOR_API_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export function monitorAuthRequiredResponse() {
  return NextResponse.json(
    { ok: false, error: "AUTH_REQUIRED", message: "Sign in to manage Listing monitors." },
    { status: 401, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}

export function monitorRequestErrorResponse(error: ListingMonitorApiRequestError) {
  return NextResponse.json(
    {
      ok: false,
      error: error.code,
      message: error.message,
      errors: error.errors,
    },
    { status: error.status, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}

export function monitorInvalidJsonResponse() {
  return NextResponse.json(
    { ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON." },
    { status: 400, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}

export function monitorPersistenceErrorResponse(error: unknown, fallbackCode: string) {
  if (error instanceof ListingMonitorPersistenceError) {
    const status = error.code === "listing_monitor_invalid"
      ? 422
      : error.code === "listing_monitor_not_found"
        ? 404
        : 502;
    return NextResponse.json(
      {
        ok: false,
        error: error.code.toUpperCase(),
        message: error.message,
        ...(error.details.length > 0 ? { errors: error.details } : {}),
      },
      { status, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
  if (error instanceof ListingMonitorAlertReadError) {
    return NextResponse.json(
      { ok: false, error: "LISTING_MONITOR_ALERTS_READ_FAILED", message: error.message },
      { status: error.status || 502, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: fallbackCode,
      message: error instanceof Error ? error.message : "Listing Monitor request failed.",
    },
    { status: 500, headers: MONITOR_API_NO_STORE_HEADERS },
  );
}
