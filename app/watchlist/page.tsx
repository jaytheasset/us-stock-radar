import WatchlistClient from "@/app/watchlist/WatchlistClient";
import { getCurrentUserId } from "@/lib/currentUser";
import { getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const initialWatchlist = await getWatchlistViewModel(await getCurrentUserId());

  return <WatchlistClient initialWatchlist={initialWatchlist} />;
}
