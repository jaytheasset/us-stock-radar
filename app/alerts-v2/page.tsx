import type { Metadata } from "next";
import { StockRadarAlertsV2 } from "@/components/alerts-v2/StockRadarAlertsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Alerts v2 | Stock Radar",
  description: "Mock Stock Radar alerts center v2.",
};

export default function AlertsV2Page() {
  return (
    <StockRadarAppShell activeNavigationItem="alerts">
      <StockRadarAlertsV2 />
    </StockRadarAppShell>
  );
}
