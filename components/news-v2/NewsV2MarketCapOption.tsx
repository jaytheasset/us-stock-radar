import type { NewsV2MarketCapBand } from "@/lib/newsV2";
import { marketCapRangeLabels } from "@/lib/marketCapBands";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2MarketCapOptionProps = {
  marketCap: NewsV2MarketCapBand;
  onClick: () => void;
  selected: boolean;
};

export function NewsV2MarketCapOption({
  marketCap,
  onClick,
  selected,
}: NewsV2MarketCapOptionProps) {
  const range = marketCapRangeLabels[marketCap];

  return (
    <button
      aria-label={`${marketCap} market cap, ${range}`}
      aria-pressed={selected}
      className={`${styles.marketCapFilterOption}${selected ? ` ${styles.marketCapFilterOptionSelected}` : ""}`}
      onClick={onClick}
      type="button"
    >
      <strong>{marketCap}</strong>
      <small>{range}</small>
    </button>
  );
}
