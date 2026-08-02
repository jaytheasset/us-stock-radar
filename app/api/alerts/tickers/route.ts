import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  findTickerBySymbol,
  getAlertTickersViewModel,
  getGuestAlertTickersViewModel,
} from "@/lib/alerts/tickers/getAlertTickersViewModel";
import {
  AlertTickerValidationError,
  assertAlertTickerLimit,
  normalizeAlertTicker,
} from "@/lib/alerts/tickers/alertTickerValidation";
import { supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    const data = userId ? await getAlertTickersViewModel(userId) : getGuestAlertTickersViewModel();

    return NextResponse.json(
      { ok: true, guestMode: data.guestMode === true, data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ALERT_TICKERS_READ_FAILED",
        message: error instanceof Error ? error.message : "Failed to read alert-enabled tickers.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  try {
    const userId = await getOptionalCurrentUserId();
    const body = await request.json().catch(() => null);
    const ticker = normalizeAlertTicker((body as { ticker?: unknown } | null)?.ticker);

    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          guestMode: true,
          persisted: false,
          error: "AUTH_REQUIRED",
          message: "Sign in to save alert-enabled tickers.",
          data: getGuestAlertTickersViewModel(),
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const existing = await getAlertTickersViewModel(userId);
    if (existing.items.some((item) => item.ticker === ticker)) {
      throw new AlertTickerValidationError(
        "DUPLICATE_TICKER",
        `${ticker} is already alert-enabled.`,
        { ticker },
      );
    }

    assertAlertTickerLimit(existing.plan, existing.usage);

    const catalogTicker = await findTickerBySymbol(ticker);
    if (!catalogTicker) {
      throw new AlertTickerValidationError(
        "TICKER_NOT_FOUND",
        "Select a listed ticker from the search results.",
        { ticker },
      );
    }

    const insertResult = await supabaseUpsert(
      "user_alert_tickers",
      {
        user_id: userId,
        ticker: catalogTicker.ticker,
        company_name: catalogTicker.companyName,
        enabled: true,
      },
      { prefer: "return=representation" },
    );

    if (!insertResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ALERT_TICKER_ADD_FAILED",
          message: insertResult.error || "Failed to add alert-enabled ticker.",
        },
        { status: insertResult.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getAlertTickersViewModel(userId);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AlertTickerValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...error.details,
        },
        {
          status:
            error.code === "DUPLICATE_TICKER" ||
            error.code === "ALERT_TICKER_LIMIT_EXCEEDED"
              ? 409
              : 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "ALERT_TICKER_ADD_FAILED",
        message: error instanceof Error ? error.message : "Failed to add alert-enabled ticker.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
