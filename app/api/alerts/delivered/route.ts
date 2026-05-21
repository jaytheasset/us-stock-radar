import { NextRequest, NextResponse } from "next/server";
import { type DeliveryStatusFilter, getDeliveredAlertsForUser } from "@/lib/alerts/getAlertSettingsViewModel";
import { getCurrentUserId } from "@/lib/currentUser";
import { isValidAlertCategory, type AlertCategory } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  const searchParams = request.nextUrl.searchParams;
  const limit = clampLimit(Number(searchParams.get("limit") || 20));
  const lane = normalizeLane(searchParams.get("lane"));
  const category = normalizeCategory(searchParams.get("category"));
  const status = normalizeStatus(searchParams.get("status"));

  if (searchParams.get("lane") && !lane) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_LANE",
        message: "lane must be watchlist or market_discovery.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (searchParams.get("category") && !category) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_CATEGORY",
        message: "category is not a supported alert category.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (searchParams.get("status") && !status) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_STATUS",
        message: "status must be queued, sent, failed, suppressed, or all.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const result = await getDeliveredAlertsForUser({
    userId,
    limit,
    lane,
    category,
    status: status || "sent",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "DELIVERED_ALERTS_READ_FAILED",
        message: result.error || "Failed to read delivered alerts.",
      },
      { status: result.status || 502, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(result.data, { headers: NO_STORE_HEADERS });
}

function normalizeLane(value: string | null) {
  if (value === "watchlist" || value === "market_discovery") return value;
  return undefined;
}

function normalizeCategory(value: string | null): AlertCategory | undefined {
  const category = value?.trim() || "";
  return isValidAlertCategory(category) ? category : undefined;
}

function normalizeStatus(value: string | null): DeliveryStatusFilter | undefined {
  const status = value?.trim() || "";
  if (status === "queued" || status === "sent" || status === "failed" || status === "suppressed" || status === "all") {
    return status;
  }
  return undefined;
}

function clampLimit(value: number) {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(Math.floor(value), 100));
}
