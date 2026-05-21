import WatchlistClient from "@/app/watchlist/WatchlistClient";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const userId = await getOptionalCurrentUserId();
  const initialWatchlist = userId ? await getWatchlistViewModel(userId) : getGuestWatchlistViewModel();

  return <WatchlistClient initialWatchlist={initialWatchlist} />;
}
