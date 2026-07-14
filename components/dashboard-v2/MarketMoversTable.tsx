import { Fragment } from "react";
import {
  EventBadge,
  getEventAccessibleLabel,
} from "@/components/dashboard-v2/EventBadge";
import { DesktopMarketRow } from "@/components/market/DesktopMarketRow";
import { MobileMarketRow, type MarketValueTone } from "@/components/market/MobileMarketRow";
import { Pagination, type PaginationItem } from "@/components/ui/Pagination";
import type { DashboardV2MarketMover } from "@/lib/mock/dashboardV2Data";

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
  const rowsPerPage = rows.length;
  const totalResults = 500;
  const lastPage = Math.ceil(totalResults / rowsPerPage);
  const paginationItems: readonly PaginationItem[] = [
    1,
    2,
    3,
    "ellipsis",
    lastPage,
  ];

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
            {rows.map((row) => {
              const changeTone: MarketValueTone = row.changePercent.startsWith("-")
                ? "negative"
                : "positive";
              const isSelected = selectedTicker ? selectedTicker === row.ticker : row.selected;
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
                    events={row.events.map((event) => (
                      <EventBadge key={`${row.ticker}-${event}`} type={event} />
                    ))}
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
                  <MobileMarketRow
                    company={row.company}
                    eventBadges={
                      visibleMobileEvents.length
                        ? visibleMobileEvents.map((event) => (
                            <EventBadge
                              key={`${row.ticker}-mobile-${event}`}
                              size="micro"
                              type={event}
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="dashboard-v2-table-footer">
        <span>{`Results: 1-${rowsPerPage} of ${totalResults}`}</span>
        <Pagination
          currentPage={1}
          items={paginationItems}
          onPageChange={() => undefined}
          totalPages={lastPage}
        />
        <div className="dashboard-v2-rows-select">
          <span>Rows per page:</span>
          <button type="button">
            {rowsPerPage}
            <ChevronDownIcon />
          </button>
        </div>
      </footer>
    </section>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
