import type { FilingsV2MarketCap } from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

const marketCapRanges: Record<FilingsV2MarketCap, string> = {
  Mega: "$50B+",
  Large: "$10B-$50B",
  Mid: "$1B-$10B",
  Small: "$50M-$1B",
  Micro: "<$50M",
};

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
