import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StockRadarWatchlistV2 } from "@/components/watchlist-v2/StockRadarWatchlistV2";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getProjectedWatchlistViewModel } from "@/lib/watchlist/tickerProjection";
import { readStockHeaderSecIdentity } from "@/lib/watchlist/stockHeaderSecIdentity";
import {
  getStockRouteHref,
  normalizeStockTicker,
} from "@/lib/watchlist/stockOverview";

export const dynamic = "force-dynamic";

type StockPageProps = {
  params: Promise<{ ticker: string }>;
};

export async function generateMetadata({
  params,
}: StockPageProps): Promise<Metadata> {
  const { ticker: routeTicker } = await params;
  const ticker = normalizeStockTicker(routeTicker);

  if (!ticker) {
    return {
      description: "Review a stock's quote, chart, news, and filings.",
      title: "Stock unavailable",
    };
  }

  return {
    alternates: { canonical: getStockRouteHref(ticker) ?? undefined },
    description: `Review ${ticker} quote, chart, news, filings, and tracked disclosures on Stock Radar.`,
    title: `${ticker} Stock Overview`,
  };
}

export default async function StockPage({ params }: StockPageProps) {
  const { ticker: routeTicker } = await params;
  const ticker = normalizeStockTicker(routeTicker);

  if (!ticker) notFound();
  if (routeTicker !== ticker) {
    redirect(getStockRouteHref(ticker) as string);
  }

  const userId = await getOptionalCurrentUserId();
  const initialWatchlist = await getProjectedWatchlistViewModel(userId, ticker);
  const currentTicker = initialWatchlist.selection?.requestedTicker === ticker
    ? initialWatchlist.selection.currentTicker
    : ticker;
  const stockHeaderIdentity = await readStockHeaderSecIdentity(currentTicker);

  return (
    <StockRadarWatchlistV2
      initialSelectedTicker={ticker}
      initialWatchlist={initialWatchlist}
      selectionMode="stock"
      stockHeaderIdentity={stockHeaderIdentity}
    />
  );
}
