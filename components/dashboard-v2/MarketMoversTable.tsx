import { Fragment } from "react";
import {
  EventBadge,
  getEventAccessibleLabel,
} from "@/components/dashboard-v2/EventBadge";
import { DesktopInlineAdSlot } from "@/components/dashboard-v2/DesktopInlineAdSlot";
import { MobileInlineAdSlot } from "@/components/dashboard-v2/MobileInlineAdSlot";
import { DesktopMarketRow } from "@/components/market/DesktopMarketRow";
import { MobileMarketRow, type MarketValueTone } from "@/components/market/MobileMarketRow";
import { selectDashboardV2EventTypeBadges } from "@/lib/dashboardV2Events";
import type { DashboardV2MarketMover } from "@/lib/dashboardV2Types";
import { getStockRouteHref } from "@/lib/watchlist/stockOverview";

type MarketMoversTableProps = {
  adsEnabledForViewer: boolean;
  mobileValueMode?: "change" | "volume";
  onOpenChart?: (row: DashboardV2MarketMover) => void;
  onSelectRow?: (row: DashboardV2MarketMover) => void;
  rows: DashboardV2MarketMover[];
  selectedTicker?: string;
};

export function MarketMoversTable({
  adsEnabledForViewer,
  mobileValueMode = "change",
  onOpenChart,
  onSelectRow,
  rows,
  selectedTicker,
}: MarketMoversTableProps) {
  return (
    <section className="dashboard-v2-table-panel" aria-label="Market movers">
      <div className="dashboard-v2-table-scroll">
        <table className="dashboard-v2-market-table">
          <thead>
            <tr className="dashboard-v2-desktop-table-head">
              <th>#</th>
              <th>Ticker</th>
              <th>Price</th>
              <th>Chg %</th>
              <th>Volume</th>
              <th>Mkt Cap</th>
              <th>Events (7D)</th>
              <th>Max Impact</th>
              <th aria-label="Chart" />
            </tr>
            <tr className="dashboard-v2-mobile-table-head">
              <th>#</th>
              <th>Ticker</th>
              <th>{mobileValueMode === "volume" ? "Volume" : "Chg %"}</th>
              <th>Events (7D)</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const changeTone: MarketValueTone = row.changePercent.startsWith("-")
                ? "negative"
                : "positive";
              const isSelected = selectedTicker === row.ticker;
              const tickerHref = getStockRouteHref(row.ticker);
              const primaryValue =
                mobileValueMode === "volume" ? row.volume : row.changePercent;
              const secondaryValue =
                mobileValueMode === "volume" ? row.changePercent : row.price;
              const primaryTone = mobileValueMode === "volume" ? "neutral" : changeTone;
              const secondaryTone = mobileValueMode === "volume" ? changeTone : "neutral";
              const desktopEventTypes = selectDashboardV2EventTypeBadges(
                row.events,
                4,
              );
              const visibleMobileEventTypes =
                desktopEventTypes.representatives.slice(0, 2);
              const hiddenMobileEventTypes =
                desktopEventTypes.representatives.slice(2);
              const hiddenDesktopLabel = desktopEventTypes.hidden.length
                ? `Additional event types: ${desktopEventTypes.hidden
                    .map(getEventAccessibleLabel)
                    .join(", ")}`
                : undefined;
              const hiddenMobileLabel = hiddenMobileEventTypes.length
                ? `Additional event types: ${hiddenMobileEventTypes
                    .map(getEventAccessibleLabel)
                    .join(", ")}`
                : undefined;

              return (
                <Fragment key={row.ticker}>
                  <DesktopMarketRow
                    change={row.changePercent}
                    company={row.company}
                    events={
                      desktopEventTypes.visible.length
                        ? (
                            <>
                              {desktopEventTypes.visible.map((event) => (
                                <EventBadge
                                  event={event}
                                  key={event.code}
                                  size="micro"
                                />
                              ))}
                              {desktopEventTypes.hidden.length ? (
                                <span
                                  aria-label={hiddenDesktopLabel}
                                  className="dashboard-v2-event-overflow"
                                  title={hiddenDesktopLabel}
                                >
                                  +{desktopEventTypes.hidden.length}
                                </span>
                              ) : null}
                            </>
                          )
                        : undefined
                    }
                    impact={row.maxImpact}
                    logoUrl={row.logoUrl}
                    marketCap={row.marketCap}
                    onOpenChart={() => onOpenChart?.(row)}
                    onSelect={() => onSelectRow?.(row)}
                    price={row.price}
                    rank={row.rank}
                    selected={isSelected}
                    ticker={row.ticker}
                    tickerHref={tickerHref}
                    volume={row.volume}
                  />
                  {adsEnabledForViewer && rows.length > 25 && index === 24 ? (
                    <DesktopInlineAdSlot />
                  ) : null}
                  {adsEnabledForViewer && rows.length >= 50 && index === rows.length - 1 ? (
                    <DesktopInlineAdSlot />
                  ) : null}
                  <MobileMarketRow
                    company={row.company}
                    eventBadges={
                      visibleMobileEventTypes.length
                        ? visibleMobileEventTypes.map((event) => (
                            <EventBadge
                              event={event}
                              key={`${row.ticker}-mobile-${event.code}`}
                              size="micro"
                            />
                          ))
                        : undefined
                    }
                    eventOverflowCount={hiddenMobileEventTypes.length}
                    eventOverflowLabel={hiddenMobileLabel}
                    impact={row.maxImpact}
                    logoUrl={row.logoUrl}
                    onSelect={() => onSelectRow?.(row)}
                    primaryTone={primaryTone}
                    primaryValue={primaryValue}
                    rank={row.rank}
                    secondaryTone={secondaryTone}
                    secondaryValue={secondaryValue}
                    selected={isSelected}
                    ticker={row.ticker}
                    tickerHref={tickerHref}
                  />
                  {adsEnabledForViewer && rows.length >= 50 && index === 24 ? (
                    <MobileInlineAdSlot />
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
