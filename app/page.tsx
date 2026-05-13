import { FeedShell } from "@/components/FeedShell";
import { getLiveFeedViewModel } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewModel = await getLiveFeedViewModel({ page: 1, limit: 20 });

  return (
    <FeedShell
      feedItems={viewModel.feedItems}
      highImpactNews={viewModel.highImpactNews}
      alertFilings={viewModel.alertFilings}
      marketPulseItems={viewModel.marketPulseItems}
      pageInfo={{
        page: viewModel.page,
        limit: viewModel.limit,
        hasNext: viewModel.hasNext,
        total: viewModel.total,
        itemCount: viewModel.feedItems.length,
      }}
      dbError={viewModel.ok ? undefined : viewModel.error}
    />
  );
}
