import styles from "./MarketResultRows.module.css";

export type MarketValueTone = "negative" | "neutral" | "positive";

export type MobileMarketRowProps = {
  company: string;
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
        <strong>{ticker}</strong>
        <span>{company}</span>
      </td>
      <td className={`${styles.mobilePrimary} ${toneClasses[primaryTone]}`}>
        {primaryValue}
      </td>
      <td className={`${styles.mobileSecondary} ${toneClasses[secondaryTone]}`}>
        {secondaryValue}
      </td>
    </tr>
  );
}
