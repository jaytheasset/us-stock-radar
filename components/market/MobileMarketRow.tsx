import type { ReactNode } from "react";
import {
  MarketImpactLabel,
  type MarketImpact,
} from "@/components/market/MarketImpactLabel";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import styles from "./MarketResultRows.module.css";

export type MarketValueTone = "negative" | "neutral" | "positive";

export type MobileMarketRowProps = {
  company: string;
  eventBadges?: ReactNode;
  eventOverflowCount?: number;
  eventOverflowLabel?: string;
  impact?: MarketImpact;
  logoUrl?: string;
  onSelect?: () => void;
  primaryTone?: MarketValueTone;
  primaryValue: string;
  rank: number;
  secondaryTone?: MarketValueTone;
  secondaryValue: string;
  selected?: boolean;
  ticker: string;
};

const toneClasses: Record<MarketValueTone, string> = {
  negative: styles.negative,
  neutral: styles.neutral,
  positive: styles.positive,
};

export function MobileMarketRow({
  company,
  eventBadges,
  eventOverflowCount = 0,
  eventOverflowLabel,
  impact,
  logoUrl,
  onSelect,
  primaryTone = "neutral",
  primaryValue,
  rank,
  secondaryTone = "neutral",
  secondaryValue,
  selected = false,
  ticker,
}: MobileMarketRowProps) {
  return (
    <tr
      aria-selected={selected}
      className={`${styles.mobileRow}${selected ? ` ${styles.selected}` : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.();
        }
      }}
      tabIndex={0}
    >
      <td className={styles.mobileRank}>{rank}</td>
      <td className={styles.mobileIdentity}>
        <MarketTickerLogo logoUrl={logoUrl} size="mobile" ticker={ticker} />
        <strong>{ticker}</strong>
        <span>{company}</span>
      </td>
      <td className={`${styles.mobilePrimary} ${toneClasses[primaryTone]}`}>
        {primaryValue}
      </td>
      <td className={`${styles.mobileSecondary} ${toneClasses[secondaryTone]}`}>
        {secondaryValue}
      </td>
      <td className={styles.mobileEvents}>
        <span className={styles.mobileEventBadgeRow}>
          {eventBadges ?? <span className={styles.mobileMetadataEmpty}>—</span>}
          {eventOverflowCount > 0 ? (
            <span
              aria-label={eventOverflowLabel}
              className={styles.mobileEventOverflow}
              title={eventOverflowLabel}
            >
              +{eventOverflowCount}
            </span>
          ) : null}
        </span>
      </td>
      <td className={styles.mobileImpact}>
        {impact ? (
          <MarketImpactLabel impact={impact} size="compact" />
        ) : (
          <span className={styles.mobileMetadataEmpty}>—</span>
        )}
      </td>
    </tr>
  );
}
