import type { Metadata } from "next";
import { StockRadarWatchlistV2 } from "@/components/watchlist-v2/StockRadarWatchlistV2";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import { resolveWatchlistTicker } from "@/lib/watchlist/stockOverview";

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
  const [initialWatchlist, params] = await Promise.all([
    userId ? getWatchlistViewModel(userId) : getGuestWatchlistViewModel(),
    searchParams,
  ]);
  const requestedTicker =
    typeof params.ticker === "string" ? params.ticker : params.ticker?.[0];
  const initialSelectedTicker = resolveWatchlistTicker(
    requestedTicker,
    initialWatchlist.items.map((item) => item.ticker),
  );

  return (
    <StockRadarWatchlistV2
      initialSelectedTicker={initialSelectedTicker}
      initialWatchlist={initialWatchlist}
    />
  );
}
