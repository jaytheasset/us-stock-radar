"use client";

import { useState, type Ref } from "react";
import { ChevronRight } from "lucide-react";
import { ChartRangeSelector, type ChartRange } from "@/components/chart/ChartRangeSelector";
import { ChartShell } from "@/components/chart/ChartShell";
import { ChartToolbar } from "@/components/chart/ChartToolbar";
import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import { EventTimeline } from "@/components/dashboard-v2/EventTimeline";
import { MockChart } from "@/components/dashboard-v2/MockChart";
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
  const [chartRange, setChartRange] = useState<ChartRange>("1D");
  const priceLineClass = ticker.changePercent.startsWith("-")
    ? "dashboard-v2-price-line is-negative"
    : "dashboard-v2-price-line";
  const chartSummary = `${ticker.ticker} intraday values. Open ${ticker.ohlc.open}, high ${ticker.ohlc.high}, low ${ticker.ohlc.low}, close ${ticker.ohlc.close}, change ${ticker.changeAmount} (${ticker.changePercent}).`;

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
        <ChartShell
          aria-label={`${ticker.ticker} mock intraday chart`}
          rangeControl={
            <ChartRangeSelector
              ariaLabel="Chart time range"
              onValueChange={setChartRange}
              value={chartRange}
            />
          }
          summary={chartSummary}
          toolbar={<ChartToolbar ariaLabel="Chart tools" />}
        >
          <MockChart
            candles={ticker.candles}
            changeAmount={ticker.changeAmount}
            changePercent={ticker.changePercent}
            ohlc={ticker.ohlc}
          />
        </ChartShell>
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
