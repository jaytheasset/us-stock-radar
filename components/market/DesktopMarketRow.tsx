import type { ReactNode } from "react";
import Link from "next/link";
import { MarketChartAction } from "@/components/market/MarketChartAction";
import { MarketImpactLabel, type MarketImpact } from "@/components/market/MarketImpactLabel";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import styles from "./MarketResultRows.module.css";

export type DesktopMarketRowProps = {
  change: string;
  company: string;
  events?: ReactNode;
  impact?: MarketImpact;
  logoUrl?: string;
  marketCap: string;
  onOpenChart?: () => void;
  onSelect?: () => void;
  price: string;
  rank: number;
  selected?: boolean;
  ticker: string;
  tickerHref?: string | null;
  volume: string;
};

export function DesktopMarketRow({
  change,
  company,
  events,
  impact,
  logoUrl,
  marketCap,
  onOpenChart,
  onSelect,
  price,
  rank,
  selected = false,
  ticker,
  tickerHref,
  volume,
}: DesktopMarketRowProps) {
  const changeTone = change.startsWith("-") ? styles.negative : styles.positive;

  return (
    <tr
      aria-selected={selected}
      className={`dashboard-v2-desktop-market-row ${styles.desktopRow}${selected ? ` ${styles.selected}` : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.();
        }
      }}
      tabIndex={0}
    >
      <td>{rank}</td>
      <td>
        <div className={styles.tickerCell}>
          <MarketTickerLogo logoUrl={logoUrl} size="desktop" ticker={ticker} />
          <strong>
            {tickerHref ? (
              <Link
                aria-label={`View ${ticker} stock overview`}
                className={styles.tickerLink}
                href={tickerHref}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {ticker}
              </Link>
            ) : ticker}
          </strong>
          <span>{company}</span>
        </div>
      </td>
      <td>{price}</td>
      <td className={changeTone}>{change}</td>
      <td>{volume}</td>
      <td>{marketCap}</td>
      <td>
        <div className={styles.badgeRow}>
          {events ?? <span className={styles.marketMetadataEmpty}>—</span>}
        </div>
      </td>
      <td>
        {impact ? (
          <MarketImpactLabel impact={impact} />
        ) : (
          <span className={styles.marketMetadataEmpty}>—</span>
        )}
      </td>
      <td>
        <MarketChartAction onOpen={onOpenChart} ticker={ticker} />
      </td>
    </tr>
  );
}
