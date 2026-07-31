import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { supabaseUpsert } from "@/lib/supabase";
import { findTickerBySymbol } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import {
  WatchlistValidationError,
  assertWatchlistLimit,
  normalizeTicker,
} from "@/lib/watchlist/watchlistValidation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    const data = userId ? await getWatchlistViewModel(userId) : getGuestWatchlistViewModel();
    return NextResponse.json({ ok: true, guestMode: data.guestMode === true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "WATCHLIST_READ_FAILED",
        message: error instanceof Error ? error.message : "Failed to read watchlist.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getOptionalCurrentUserId();
    const body = await request.json().catch(() => null);
    const ticker = normalizeTicker((body as { ticker?: unknown } | null)?.ticker);

    if (!userId) {
      return NextResponse.json(
        {
          ok: true,
          guestMode: true,
          persisted: false,
          message: "Create an account to save your watchlist.",
          ticker,
          data: getGuestWatchlistViewModel(),
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const existing = await getWatchlistViewModel(userId);

    if (existing.items.some((item) => item.ticker === ticker)) {
      throw new WatchlistValidationError("DUPLICATE_TICKER", `${ticker} is already in your watchlist.`, {
        ticker,
      });
    }

    assertWatchlistLimit(existing.plan, existing.usage);

    const catalogTicker = await findTickerBySymbol(ticker);
    if (!catalogTicker) {
      throw new WatchlistValidationError(
        "TICKER_NOT_FOUND",
        `${ticker} is not an active listed ticker.`,
        { ticker },
      );
    }

    const insertResult = await supabaseUpsert(
      "watchlist_tickers",
      {
        user_id: userId,
        ticker: catalogTicker.ticker,
        company_name: catalogTicker.companyName,
      },
      {
        prefer: "return=representation",
      },
    );

    if (!insertResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "WATCHLIST_ADD_FAILED",
          message: insertResult.error || "Failed to add ticker.",
        },
        { status: insertResult.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getWatchlistViewModel(userId);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof WatchlistValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...error.details,
        },
        { status: error.code === "WATCHLIST_LIMIT_EXCEEDED" || error.code === "DUPLICATE_TICKER" ? 409 : 400, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "WATCHLIST_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Failed to update watchlist.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
