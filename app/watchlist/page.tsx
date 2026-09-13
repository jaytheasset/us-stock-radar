import type { Metadata } from "next";
import { StockRadarWatchlistV2 } from "@/components/watchlist-v2/StockRadarWatchlistV2";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import { projectWatchlistViewModelForDisplay } from "@/lib/watchlist/tickerProjection";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Review the stocks, news, filings, and disclosures on your Stock Radar watchlist.",
  robots: { follow: false, index: false },
};

type WatchlistPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WatchlistPage({
  searchParams,
}: WatchlistPageProps) {
  const userId = await getOptionalCurrentUserId();
  const params = await searchParams;
  const requestedTicker =
    typeof params.ticker === "string" ? params.ticker : params.ticker?.[0];
  const initialSelectedTicker = normalizeStockTicker(requestedTicker);
  const initialWatchlist = await projectWatchlistViewModelForDisplay(
    userId ? await getWatchlistViewModel(userId) : getGuestWatchlistViewModel(),
    initialSelectedTicker,
  );

  return (
    <StockRadarWatchlistV2
      initialSelectedTicker={initialSelectedTicker}
      initialWatchlist={initialWatchlist}
    />
  );
}
