import type { Metadata } from "next";
import { StockRadarDashboardV2 } from "@/components/dashboard-v2/StockRadarDashboardV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Markets Dashboard | Stock Radar",
  description: "Live U.S. market movers with Stock Radar event context.",
};

export default function DashboardV2Page() {
  return (
    <StockRadarAppShell activeNavigationItem="markets" themeMode="user-selectable">
      <StockRadarDashboardV2 />
    </StockRadarAppShell>
  );
}
