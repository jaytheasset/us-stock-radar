import { ChevronRight } from "lucide-react";
import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import { EventTimeline } from "@/components/dashboard-v2/EventTimeline";
import { MockChart } from "@/components/dashboard-v2/MockChart";
import type { Ref } from "react";
import type { DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

type TickerDetailContentProps = {
  ticker: DashboardV2TickerDetail;
  titleId?: string;
  sectionRefs?: {
    summary?: Ref<HTMLElement>;
    chart?: Ref<HTMLDivElement>;
    events?: Ref<HTMLDivElement>;
  };
};

export function TickerDetailContent({ ticker, titleId, sectionRefs }: TickerDetailContentProps) {
  const priceLineClass = ticker.changePercent.startsWith("-")
    ? "dashboard-v2-price-line is-negative"
    : "dashboard-v2-price-line";

  return (
    <>
      <header className="dashboard-v2-detail-header" ref={sectionRefs?.summary}>
        <div className="dashboard-v2-detail-title">
          <h1 id={titleId}>{ticker.ticker}</h1>
          <span>{ticker.company}</span>
        </div>
        <div className={priceLineClass}>
          <strong>{ticker.price}</strong>
          <span>{ticker.changePercent}</span>
          <span>({ticker.changeAmount})</span>
        </div>
        <div className="dashboard-v2-detail-badges">
          {ticker.badges.map((badge) => (
            <EventBadge key={badge} size="large" type={badge} />
          ))}
        </div>
      </header>

      <div className="dashboard-v2-detail-chart-anchor" ref={sectionRefs?.chart}>
        <MockChart
          candles={ticker.candles}
          changeAmount={ticker.changeAmount}
          changePercent={ticker.changePercent}
          ohlc={ticker.ohlc}
        />
      </div>

      <div className="dashboard-v2-detail-events-anchor" ref={sectionRefs?.events}>
        <EventTimeline events={ticker.recentEvents} />
      </div>

      <button className="dashboard-v2-analysis-button" type="button">
        <span>View Full Analysis</span>
        <ChevronRight aria-hidden="true" size={22} />
      </button>
    </>
  );
}
