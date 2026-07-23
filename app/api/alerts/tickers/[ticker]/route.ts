import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  getAlertTickersViewModel,
  getGuestAlertTickersViewModel,
} from "@/lib/alerts/tickers/getAlertTickersViewModel";
import {
  AlertTickerValidationError,
  normalizeAlertTicker,
} from "@/lib/alerts/tickers/alertTickerValidation";
import { supabaseDelete, supabaseUpdate } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  try {
    const userId = await getOptionalCurrentUserId();
    const { ticker: tickerParam } = await context.params;
    const ticker = normalizeAlertTicker(decodeURIComponent(tickerParam));
    const body = await request.json().catch(() => null);
    const enabled = (body as { enabled?: unknown } | null)?.enabled;

    if (typeof enabled !== "boolean") {
      throw new AlertTickerValidationError("INVALID_ENABLED_STATE", "Enabled must be true or false.");
    }

    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          guestMode: true,
          persisted: false,
          error: "AUTH_REQUIRED",
          message: "Sign in to update alert-enabled tickers.",
          data: getGuestAlertTickersViewModel(),
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const updateResult = await supabaseUpdate(
      "user_alert_tickers",
      {
        user_id: `eq.${userId}`,
        ticker: `eq.${ticker}`,
      },
      { enabled },
    );

    if (!updateResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ALERT_TICKER_UPDATE_FAILED",
          message: updateResult.error || "Failed to update alert-enabled ticker.",
        },
        { status: updateResult.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getAlertTickersViewModel(userId);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleMutationError(error, "ALERT_TICKER_UPDATE_FAILED");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  try {
    const userId = await getOptionalCurrentUserId();
    const { ticker: tickerParam } = await context.params;
    const ticker = normalizeAlertTicker(decodeURIComponent(tickerParam));

    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          guestMode: true,
          persisted: false,
          error: "AUTH_REQUIRED",
          message: "Sign in to update alert-enabled tickers.",
          data: getGuestAlertTickersViewModel(),
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const deleteResult = await supabaseDelete("user_alert_tickers", {
      user_id: `eq.${userId}`,
      ticker: `eq.${ticker}`,
    });

    if (!deleteResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ALERT_TICKER_DELETE_FAILED",
          message: deleteResult.error || "Failed to remove alert-enabled ticker.",
        },
        { status: deleteResult.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getAlertTickersViewModel(userId);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleMutationError(error, "ALERT_TICKER_DELETE_FAILED");
  }
}

function handleMutationError(error: unknown, fallbackCode: string) {
  if (error instanceof AlertTickerValidationError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
        ...error.details,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: fallbackCode,
      message: error instanceof Error ? error.message : "Failed to update alert-enabled ticker.",
    },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
