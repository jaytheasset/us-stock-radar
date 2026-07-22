import { useId, type ReactNode } from "react";
import styles from "./ChartShell.module.css";

type ChartShellAccessibleName =
  | {
      "aria-label": string;
      "aria-labelledby"?: never;
    }
  | {
      "aria-label"?: never;
      "aria-labelledby": string;
    };

export type ChartShellProps = ChartShellAccessibleName & {
  children: ReactNode;
  rangeControl: ReactNode;
  summary: string;
  toolbar: ReactNode;
};

export function ChartShell({
  children,
  rangeControl,
  summary,
  toolbar,
  ...accessibleName
}: ChartShellProps) {
  const summaryId = useId();

  return (
    <section aria-describedby={summaryId} className={styles.root} {...accessibleName}>
      <div className={styles.navigation}>
        {rangeControl}
        {toolbar}
      </div>
      <p className={styles.summary} id={summaryId}>
        {summary}
      </p>
      {children}
    </section>
  );
}
