import {
  CandlestickChart,
  Expand,
  LineChart,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import styles from "./ChartToolbar.module.css";

const toolbarActions = [
  { icon: CandlestickChart, key: "candles", label: "Candles" },
  { icon: LineChart, key: "indicators", label: "Indicators" },
  { icon: SlidersHorizontal, key: "settings", label: "Chart settings" },
  { icon: Expand, key: "expand", label: "Expand chart" },
] as const satisfies readonly {
  icon: LucideIcon;
  key: string;
  label: string;
}[];

export type ChartToolbarProps = {
  ariaLabel: string;
  compact?: boolean;
};

export function ChartToolbar({ ariaLabel, compact = false }: ChartToolbarProps) {
  const actions = compact ? toolbarActions.filter(({ key }) => key === "expand") : toolbarActions;

  return (
    <div aria-label={ariaLabel} className={styles.root} role="toolbar">
      {actions.map(({ icon: Icon, key, label }) => (
        <button
          aria-label={label}
          key={key}
          type="button"
        >
          <Icon aria-hidden="true" size={17} />
        </button>
      ))}
    </div>
  );
}
