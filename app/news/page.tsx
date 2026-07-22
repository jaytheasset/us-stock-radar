import type { Metadata } from "next";
import { StockRadarNewsV2 } from "@/components/news-v2/StockRadarNewsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getNewsV2PageData } from "@/lib/newsV2";

export const metadata: Metadata = {
  title: "News | Stock Radar",
};

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const data = await getNewsV2PageData();

  return (
    <StockRadarAppShell activeNavigationItem="news" themeMode="user-selectable">
      <StockRadarNewsV2 {...data} />
    </StockRadarAppShell>
  );
}
