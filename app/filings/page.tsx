import { RankingLanding } from "@/components/RankingLanding";
import { getRankingViewModel } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

export default async function FilingsPage() {
  const viewModel = await getRankingViewModel("filings");

  return (
    <RankingLanding
      title="Alert Filings"
      eyebrow="Filings Ranking"
      description="Highest-priority SEC filing alerts for the current session."
      items={viewModel.items}
    />
  );
}
