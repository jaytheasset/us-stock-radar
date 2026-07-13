import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";
import { BarChart3 } from "lucide-react";
import styles from "./MarketResultRows.module.css";

export type MarketChartActionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "className" | "onClick" | "onKeyDown" | "type"
> & {
  onOpen?: () => void;
  ticker: string;
};

export const MarketChartAction = forwardRef<
  HTMLButtonElement,
  MarketChartActionProps
>(function MarketChartAction({ onOpen, ticker, ...buttonProps }, ref) {
  return (
    <button
      {...buttonProps}
      aria-label={`Open ${ticker} chart`}
      className={styles.chartAction}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      ref={ref}
      type="button"
    >
      <BarChart3 aria-hidden="true" size={18} />
    </button>
  );
});
