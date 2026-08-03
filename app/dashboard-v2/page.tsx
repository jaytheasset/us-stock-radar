import type { Metadata } from "next";
import { StockRadarDashboardV2 } from "@/components/dashboard-v2/StockRadarDashboardV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getPreferredDashboardSession } from "@/lib/dashboardV2MoverLifecycle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Markets Dashboard",
  description: "Live U.S. market movers with Stock Radar event context.",
};

export default async function DashboardV2Page() {
  const viewerPlan = await getCurrentViewerPlan();
  const initialSession = getPreferredDashboardSession();

  return (
    <StockRadarAppShell activeNavigationItem="markets" themeMode="user-selectable">
      <StockRadarDashboardV2
        initialSession={initialSession}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}
