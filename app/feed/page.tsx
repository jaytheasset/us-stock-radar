import { FeedShell } from "@/components/FeedShell";
import { getLiveFeedViewModel } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

type FeedPageProps = {
  searchParams?: Promise<{
    page?: string;
    limit?: string;
  }>;
};

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page || 1) || 1);
  const requestedLimit = Number(params?.limit || 20) || 20;
  const limit = [10, 20, 50, 100].includes(requestedLimit) ? requestedLimit : 20;
  const viewModel = await getLiveFeedViewModel({ page, limit });

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
