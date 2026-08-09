import type { FilingsV2MarketCap } from "@/lib/filingsV2Model";
import { marketCapRangeLabels } from "@/lib/marketCapBands";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2MarketCapOptionProps = {
  marketCap: FilingsV2MarketCap;
  onClick: () => void;
  selected: boolean;
};

export function FilingsV2MarketCapOption({
  marketCap,
  onClick,
  selected,
}: FilingsV2MarketCapOptionProps) {
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
