import { NextRequest, NextResponse } from "next/server";
import {
  type DeliveryStatusFilter,
  getDeliveredAlertsForUser,
  getUnreadAlertCountForUser,
} from "@/lib/alerts/getAlertSettingsViewModel";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { isValidAlertCategory, type AlertCategory } from "@/lib/subscriptionPolicy";
import { supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json([], {
      headers: {
        ...NO_STORE_HEADERS,
        "X-Total-Count": "0",
        "X-Unread-Count": "0",
        "X-Auth-State": "guest",
      },
    });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = clampLimit(Number(searchParams.get("limit") || 20));
  const offset = clampOffset(Number(searchParams.get("offset") || 0));
  const lane = normalizeLane(searchParams.get("lane"));
  const category = normalizeCategory(searchParams.get("category"));
  const status = normalizeStatus(searchParams.get("status"));

  if (searchParams.get("lane") && !lane) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_LANE",
        message: "lane must be watchlist, market_discovery, or calendar_follow.",
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

  const [result, unread] = await Promise.all([
    getDeliveredAlertsForUser({
      userId,
      limit,
      offset,
      lane,
      category,
      status: status || "sent",
    }),
    getUnreadAlertCountForUser(userId),
  ]);

  if (!result.ok || !unread.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "DELIVERED_ALERTS_READ_FAILED",
        message:
          result.error ||
          unread.error ||
          "Failed to read delivered alerts.",
      },
      {
        status: result.status || unread.status || 502,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  return NextResponse.json(result.data, {
    headers: {
      ...NO_STORE_HEADERS,
      "X-Total-Count": String(result.total),
      "X-Unread-Count": String(unread.ok ? unread.count : 0),
      "X-Auth-State": "authenticated",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "AUTH_REQUIRED", message: "Sign in to manage alert history." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    read?: unknown;
    all?: unknown;
  } | null;
  if (body?.read !== true && body?.read !== false) {
    return NextResponse.json(
      { ok: false, error: "INVALID_READ_STATE", message: "read must be a boolean." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const query: Record<string, string> = {
    user_id: `eq.${userId}`,
    delivery_status: "eq.sent",
  };
  if (body.all !== true) {
    if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ALERT_ID", message: "Select a valid alert." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    query.id = `eq.${body.id}`;
  }

  const result = await supabaseUpdate(
    "user_alert_deliveries",
    query,
    { read_at: body.read ? new Date().toISOString() : null },
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "ALERT_READ_STATE_SAVE_FAILED",
        message: result.error || "Failed to update alert read state.",
      },
      { status: result.status || 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "AUTH_REQUIRED", message: "Sign in to send a test alert." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "test") {
    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION", message: "Unsupported alert action." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const now = new Date().toISOString();
  const result = await supabaseUpsert("user_alert_deliveries", {
    user_id: userId,
    title: "Stock Radar in-app alerts are connected",
    category: null,
    source_type: "other",
    source_label: "Stock Radar",
    alert_lane: "watchlist",
    severity: "low",
    delivered_channels: ["web"],
    delivery_status: "sent",
    delivered_at: now,
    scheduled_for: now,
    sent_at: now,
    attempted_at: now,
    dedupe_key: `test:${userId}:${Date.now()}`,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "TEST_ALERT_FAILED",
        message: result.error || "Failed to send the test alert.",
      },
      { status: result.status || 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

function normalizeLane(value: string | null) {
  if (
    value === "watchlist" ||
    value === "market_discovery" ||
    value === "calendar_follow"
  ) {
    return value;
  }
  return undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function clampOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
