import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { EventBadge } from "@/components/dashboard-v2/EventBadge";
import { ImpactBadge } from "@/components/dashboard-v2/ImpactBadge";
import type { DashboardV2MarketMover } from "@/lib/mock/dashboardV2Data";

export function MarketMoversTable({ rows }: { rows: DashboardV2MarketMover[] }) {
  const rowsPerPage = rows.length;
  const totalResults = 500;
  const lastPage = Math.ceil(totalResults / rowsPerPage);

  return (
    <section className="dashboard-v2-table-panel" aria-label="Market movers">
      <div className="dashboard-v2-table-scroll">
        <table className="dashboard-v2-market-table">
          <thead>
            <tr>
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
          </thead>
          <tbody>
            {rows.map((row) => {
              const changeClass = row.changePercent.startsWith("-")
                ? "dashboard-v2-negative"
                : "dashboard-v2-positive";

              return (
                <tr
                  className={row.selected ? "dashboard-v2-row-selected" : undefined}
                  key={row.ticker}
                >
                  <td>{row.rank}</td>
                  <td>
                    <div className="dashboard-v2-ticker-cell">
                      <strong>{row.ticker}</strong>
                      <span>{row.company}</span>
                    </div>
                  </td>
                  <td>{row.price}</td>
                  <td className={changeClass}>{row.changePercent}</td>
                  <td>{row.volume}</td>
                  <td>{row.marketCap}</td>
                  <td>
                    <div className="dashboard-v2-badge-row">
                      {row.events.map((event) => (
                        <EventBadge key={`${row.ticker}-${event}`} type={event} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <ImpactBadge impact={row.maxImpact} />
                  </td>
                  <td>
                    <button
                      className="dashboard-v2-chart-button"
                      type="button"
                      aria-label={`Open ${row.ticker} chart`}
                    >
                      <BarChart3 aria-hidden="true" size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="dashboard-v2-table-footer">
        <span>{`Results: 1-${rowsPerPage} of ${totalResults}`}</span>
        <div className="dashboard-v2-pagination" aria-label="Pagination">
          <button type="button" aria-label="Previous page">
            <ChevronLeft aria-hidden="true" size={15} />
          </button>
          <strong>1</strong>
          <button type="button">2</button>
          <button type="button">3</button>
          <span>...</span>
          <button type="button">{lastPage}</button>
          <button type="button" aria-label="Next page">
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </div>
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
