import type { ReactNode } from "react";
import styles from "./DetailPanelShell.module.css";

type DetailPanelAccessibleName =
  | {
      "aria-label": string;
      "aria-labelledby"?: never;
    }
  | {
      "aria-label"?: never;
      "aria-labelledby": string;
    };

export type DetailPanelShellProps = DetailPanelAccessibleName & {
  children: ReactNode;
  className?: string;
};

export function DetailPanelShell({
  children,
  className,
  ...accessibleName
}: DetailPanelShellProps) {
  const classes = [styles.panel, className].filter(Boolean).join(" ");

  return (
    <aside className={classes} {...accessibleName}>
      {children}
    </aside>
  );
}
