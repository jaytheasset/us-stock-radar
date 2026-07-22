import type { NewsV2MarketCapBand } from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

const marketCapRanges: Record<NewsV2MarketCapBand, string> = {
  Mega: "$200B+",
  Large: "$10B-$200B",
  Mid: "$2B-$10B",
  Small: "$300M-$2B",
  Micro: "<$300M",
};

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
  const range = marketCapRanges[marketCap];

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
