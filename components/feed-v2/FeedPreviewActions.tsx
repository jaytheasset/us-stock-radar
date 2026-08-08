import { SavedContentButton } from "@/components/actions/SavedContentButton";
import { WatchlistButton } from "@/components/actions/WatchlistButton";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";

export function FeedPreviewActions({
  preview,
}: {
  preview: LiveFeedV2Item["preview"];
}) {
  if (preview.kind === "market-news") {
    return null;
  }

  const hasTicker = /^[A-Z][A-Z0-9.-]{0,14}$/.test(preview.ticker);
  const returnHref = `/feed?preview=${encodeURIComponent(preview.id)}`;

  return (
    <>
      {hasTicker ? (
        <WatchlistButton
          initialAuthenticated={preview.authenticated}
          initialWatched={preview.watchlist}
          returnHref={returnHref}
          ticker={preview.ticker}
        />
      ) : null}
      <SavedContentButton
        contentId={preview.id}
        contentType={preview.kind === "filing" ? "filing" : "news"}
        initialAuthenticated={preview.authenticated}
        initialSaved={preview.saved}
        returnHref={returnHref}
      />
    </>
  );
}
