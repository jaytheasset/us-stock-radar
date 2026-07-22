import { Fragment } from "react";
import {
  EventBadge,
  getEventAccessibleLabel,
} from "@/components/dashboard-v2/EventBadge";
import { DesktopInlineAdSlot } from "@/components/dashboard-v2/DesktopInlineAdSlot";
import { MobileInlineAdSlot } from "@/components/dashboard-v2/MobileInlineAdSlot";
import { DesktopMarketRow } from "@/components/market/DesktopMarketRow";
import { MobileMarketRow, type MarketValueTone } from "@/components/market/MobileMarketRow";
import type { DashboardV2MarketMover } from "@/lib/dashboardV2Types";

type MarketMoversTableProps = {
  mobileValueMode?: "change" | "volume";
  onOpenChart?: (row: DashboardV2MarketMover) => void;
  onSelectRow?: (row: DashboardV2MarketMover) => void;
  rows: DashboardV2MarketMover[];
  selectedTicker?: string;
};

export function MarketMoversTable({
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
              const primaryValue =
                mobileValueMode === "volume" ? row.volume : row.changePercent;
              const secondaryValue =
                mobileValueMode === "volume" ? row.changePercent : row.price;
              const primaryTone = mobileValueMode === "volume" ? "neutral" : changeTone;
              const secondaryTone = mobileValueMode === "volume" ? changeTone : "neutral";
              const visibleMobileEvents = row.events.slice(0, 2);
              const hiddenMobileEvents = row.events.slice(2);
              const hiddenEventLabel = hiddenMobileEvents.length
                ? `Additional events: ${hiddenMobileEvents
                    .map(getEventAccessibleLabel)
                    .join(", ")}`
                : undefined;

              return (
                <Fragment key={row.ticker}>
                  <DesktopMarketRow
                    change={row.changePercent}
                    company={row.company}
                    events={
                      row.events.length
                        ? row.events.slice(0, 4).map((event) => (
                            <EventBadge event={event} key={event.id} />
                          ))
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
                    volume={row.volume}
                  />
                  {rows.length > 25 && index === 24 ? <DesktopInlineAdSlot /> : null}
                  {rows.length >= 50 && index === rows.length - 1 ? <DesktopInlineAdSlot /> : null}
                  <MobileMarketRow
                    company={row.company}
                    eventBadges={
                      visibleMobileEvents.length
                        ? visibleMobileEvents.map((event) => (
                            <EventBadge
                              event={event}
                              key={`${row.ticker}-mobile-${event.id}`}
                              size="micro"
                            />
                          ))
                        : undefined
                    }
                    eventOverflowCount={hiddenMobileEvents.length}
                    eventOverflowLabel={hiddenEventLabel}
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
                  />
                  {rows.length >= 50 && index === 24 ? <MobileInlineAdSlot /> : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
