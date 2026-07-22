"use client";

import { useCallback, useEffect, useState, type Ref } from "react";
import Link from "next/link";
import { Bookmark, ChevronRight } from "lucide-react";
import {
  ChartRangeSelector,
  mobileChartRanges,
  type ChartRange,
} from "@/components/chart/ChartRangeSelector";
import { ChartShell } from "@/components/chart/ChartShell";
import { ChartToolbar } from "@/components/chart/ChartToolbar";
import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import { EventTimeline } from "@/components/dashboard-v2/EventTimeline";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { FmpChart, type FmpMarketSnapshot } from "@/components/dashboard-v2/FmpChart";
import type { DashboardV2TickerDetail } from "@/lib/dashboardV2Types";

type TickerDetailContentProps = {
  mobileSheetHeader?: boolean;
  ticker: DashboardV2TickerDetail;
  titleId?: string;
  sectionRefs?: {
    summary?: Ref<HTMLElement>;
    chart?: Ref<HTMLDivElement>;
    events?: Ref<HTMLDivElement>;
  };
};

export function TickerDetailContent({
  mobileSheetHeader,
  ticker,
  titleId,
  sectionRefs,
}: TickerDetailContentProps) {
  const [chartRange, setChartRange] = useState<ChartRange>("1D");
  const [fmpMarketData, setFmpMarketData] = useState<FmpMarketSnapshot | null>(null);
  const activeMarketData = fmpMarketData?.ticker === ticker.ticker ? fmpMarketData : null;
  const activePrice = activeMarketData ? formatCurrency(activeMarketData.latestPrice) : ticker.price;
  const activeChangePercent = activeMarketData
    ? formatSignedPercent(activeMarketData.changePercent)
    : ticker.changePercent;
  const activeChangeAmount = activeMarketData
    ? formatSignedNumber(activeMarketData.changeAmount)
    : ticker.changeAmount;
  const priceLineClass = activeChangePercent.startsWith("-")
    ? "dashboard-v2-price-line is-negative"
    : "dashboard-v2-price-line";
  const chartSummary = activeMarketData
    ? `FMP ${chartRange} chart for ${ticker.ticker}. Latest price ${activePrice}, change ${activeChangeAmount} (${activeChangePercent}).`
    : `Loading FMP ${chartRange} chart for ${ticker.ticker}.`;
  const handleFmpMarketData = useCallback((next: FmpMarketSnapshot) => {
    setFmpMarketData((current) =>
      current?.ticker === next.ticker &&
      current.latestPrice === next.latestPrice &&
      current.changeAmount === next.changeAmount &&
      current.changePercent === next.changePercent
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    setFmpMarketData(null);
  }, [ticker.ticker]);

  return (
    <>
      <header
        className={`dashboard-v2-detail-header${
          mobileSheetHeader ? " dashboard-v2-mobile-detail-header" : ""
        }`}
        ref={sectionRefs?.summary}
      >
        {mobileSheetHeader ? (
          <>
            <div className="dashboard-v2-mobile-detail-identity">
              <MarketTickerLogo logoUrl={ticker.logoUrl} size="detail" ticker={ticker.ticker} />
              <div className="dashboard-v2-detail-title">
                <h1 id={titleId}>{ticker.ticker}</h1>
                <span>{ticker.company}</span>
              </div>
            </div>
            <WatchlistButton
              className="dashboard-v2-mobile-favorite"
              iconSize={14}
              ticker={ticker.ticker}
            />
          </>
        ) : (
          <>
            <div className="dashboard-v2-detail-title">
              <h1 id={titleId}>{ticker.ticker}</h1>
              <span>{ticker.company}</span>
            </div>
            <WatchlistButton
              className="dashboard-v2-desktop-favorite"
              iconSize={22}
              ticker={ticker.ticker}
            />
          </>
        )}
        <div className={priceLineClass}>
          <strong>{activePrice}</strong>
          <span>{activeChangePercent}</span>
          <span>({activeChangeAmount})</span>
        </div>
        <div className="dashboard-v2-detail-badges">
          {ticker.badges.map((event) => (
            <EventBadge event={event} key={event.id} size="large" />
          ))}
        </div>
      </header>

      <div className="dashboard-v2-detail-chart-anchor" ref={sectionRefs?.chart}>
        <ChartShell
          aria-label={`${ticker.ticker} FMP price chart`}
          rangeControl={
            <ChartRangeSelector
              ariaLabel="Chart time range"
              onValueChange={setChartRange}
              ranges={mobileSheetHeader ? mobileChartRanges : undefined}
              value={chartRange}
            />
          }
          summary={chartSummary}
          toolbar={<ChartToolbar ariaLabel="Chart tools" compact={Boolean(mobileSheetHeader)} />}
        >
          <FmpChart
            key={`${mobileSheetHeader ? "mobile" : "desktop"}-${ticker.ticker}`}
            mobileOnly={Boolean(mobileSheetHeader)}
            onMarketData={handleFmpMarketData}
            range={chartRange}
            ticker={ticker.ticker}
          />
        </ChartShell>
      </div>

      <div className="dashboard-v2-detail-events-anchor" ref={sectionRefs?.events}>
        <EventTimeline events={ticker.recentEvents} />
      </div>

      {ticker.recentEvents[0] ? (
        <Link
          className="dashboard-v2-analysis-button"
          href={`/events/${encodeURIComponent(ticker.recentEvents[0].id)}`}
        >
          <span>View latest {ticker.ticker} event</span>
          <ChevronRight aria-hidden="true" size={22} />
        </Link>
      ) : (
        <span className="dashboard-v2-analysis-button" aria-disabled="true">
          <span>Event details unavailable</span>
          <ChevronRight aria-hidden="true" size={22} />
        </span>
      )}
    </>
  );
}

type WatchlistButtonProps = {
  className: string;
  iconSize: number;
  ticker: string;
};

function WatchlistButton({
  className,
  iconSize,
  ticker,
}: WatchlistButtonProps) {
  return (
    <button
      aria-label={`Watchlist action unavailable for ${ticker}`}
      className={className}
      disabled
      title="Watchlist action unavailable"
      type="button"
    >
      <Bookmark aria-hidden="true" size={iconSize} />
    </button>
  );
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatSignedNumber(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}
