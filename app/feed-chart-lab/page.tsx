import type { Metadata } from "next";
import { FeedChartLab } from "@/components/feed-chart-lab/FeedChartLab";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Feed chart lab | Stock Radar",
  description: "Provider-neutral micro chart comparison for Stock Radar live feed rows.",
};

export default function FeedChartLabPage() {
  return (
    <StockRadarAppShell activeNavigationItem="feed">
      <FeedChartLab />
    </StockRadarAppShell>
  );
}
