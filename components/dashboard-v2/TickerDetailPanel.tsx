import { X } from "lucide-react";
import { TickerDetailContent } from "@/components/dashboard-v2/TickerDetailContent";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import type { DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

export function TickerDetailPanel({ ticker }: { ticker: DashboardV2TickerDetail }) {
  return (
    <DetailPanelShell
      className="dashboard-v2-desktop-detail-panel"
      aria-label={`${ticker.ticker} detail panel`}
    >
      <button className="dashboard-v2-detail-close" type="button" aria-label="Close detail panel">
        <X aria-hidden="true" size={22} />
      </button>
      <TickerDetailContent ticker={ticker} />
    </DetailPanelShell>
  );
}
