import { ChevronRight, X } from "lucide-react";
import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import { EventTimeline } from "@/components/dashboard-v2/EventTimeline";
import { MockChart } from "@/components/dashboard-v2/MockChart";
import type { DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

export function TickerDetailPanel({ ticker }: { ticker: DashboardV2TickerDetail }) {
  return (
    <aside className="dashboard-v2-detail-panel" aria-label={`${ticker.ticker} detail panel`}>
      <button className="dashboard-v2-detail-close" type="button" aria-label="Close detail panel">
        <X aria-hidden="true" size={22} />
      </button>
      <header className="dashboard-v2-detail-header">
        <div className="dashboard-v2-detail-title">
          <h1>{ticker.ticker}</h1>
          <span>{ticker.company}</span>
        </div>
        <div className="dashboard-v2-price-line">
          <strong>{ticker.price}</strong>
          <span>{ticker.changePercent}</span>
          <span>({ticker.changeAmount})</span>
        </div>
        <div className="dashboard-v2-detail-badges">
          {ticker.badges.map((badge) => (
            <EventBadge key={badge} type={badge} />
          ))}
        </div>
      </header>

      <MockChart
        candles={ticker.candles}
        changeAmount={ticker.changeAmount}
        changePercent={ticker.changePercent}
        ohlc={ticker.ohlc}
      />

      <EventTimeline events={ticker.recentEvents} />

      <button className="dashboard-v2-analysis-button" type="button">
        <span>View Full Analysis</span>
        <ChevronRight aria-hidden="true" size={22} />
      </button>
    </aside>
  );
}
