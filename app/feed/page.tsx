import { FeedShell } from "@/components/FeedShell";
import { getLiveFeedViewModel, normalizeFeedTab } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

type FeedPageProps = {
  searchParams?: Promise<{
    page?: string;
    limit?: string;
    tab?: string;
  }>;
};

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page || 1) || 1);
  const requestedLimit = Number(params?.limit || 20) || 20;
  const limit = [10, 20, 50, 100].includes(requestedLimit) ? requestedLimit : 20;
  const tab = normalizeFeedTab(params?.tab);
  const viewModel = await getLiveFeedViewModel({ page, limit, tab });

  return (
    <FeedShell
      activeTab={viewModel.activeTab}
      feedItems={viewModel.feedItems}
      feedDateLabel={viewModel.feedDateLabel}
      highImpactNews={viewModel.highImpactNews}
      alertFilings={viewModel.alertFilings}
      marketPulseItems={viewModel.marketPulseItems}
      situationCards={viewModel.situationCards}
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
