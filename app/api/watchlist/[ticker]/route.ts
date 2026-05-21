import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { supabaseDelete } from "@/lib/supabase";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import { WatchlistValidationError, normalizeTicker } from "@/lib/watchlist/watchlistValidation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function DELETE(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const userId = await getOptionalCurrentUserId();
    const { ticker: tickerParam } = await context.params;
    const ticker = normalizeTicker(decodeURIComponent(tickerParam));

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

    const deleteResult = await supabaseDelete("watchlist_tickers", {
      user_id: `eq.${userId}`,
      ticker: `eq.${ticker}`,
    });

    if (!deleteResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "WATCHLIST_DELETE_FAILED",
          message: deleteResult.error || "Failed to remove ticker.",
        },
        { status: deleteResult.status || 502, headers: NO_STORE_HEADERS },
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
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "WATCHLIST_DELETE_FAILED",
        message: error instanceof Error ? error.message : "Failed to remove ticker.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
