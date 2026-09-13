import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { addWatchlistTicker } from "@/lib/watchlist/addTicker";
import { findTickerBySymbol } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import { getProjectedWatchlistViewModel } from "@/lib/watchlist/tickerProjection";
import {
  WatchlistValidationError,
  assertWatchlistLimit,
  normalizeTicker,
} from "@/lib/watchlist/watchlistValidation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  try {
    const userId = await getOptionalCurrentUserId();
    const requestedTicker = request.nextUrl.searchParams.get("ticker");
    const data = request.nextUrl.searchParams.get("projection") === "1"
      ? await getProjectedWatchlistViewModel(userId, requestedTicker ? normalizeTicker(requestedTicker) : null)
      : userId ? await getWatchlistViewModel(userId) : getGuestWatchlistViewModel();
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
  const originRejection = rejectCrossOriginMutationRequest(request, NO_STORE_HEADERS);
  if (originRejection) return originRejection;
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

    await addWatchlistTicker({
      userId,
      ticker,
      expectedCurrentTicker: (body as { expectedCurrentTicker?: unknown } | null)?.expectedCurrentTicker,
      assertLimit: assertWatchlistLimit,
      readCatalog: async (currentTicker) => {
        const catalogTicker = await findTickerBySymbol(currentTicker);
        return catalogTicker ? { company_name: catalogTicker.companyName } : null;
      },
    });
    const data = request.nextUrl.searchParams.get("projection") === "1"
      ? await getProjectedWatchlistViewModel(userId, ticker)
      : await getWatchlistViewModel(userId);
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
        { status: ["WATCHLIST_LIMIT_EXCEEDED", "DUPLICATE_TICKER", "TICKER_PROJECTION_CHANGED"].includes(error.code) ? 409 : 400, headers: NO_STORE_HEADERS },
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
