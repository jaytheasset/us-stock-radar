import type { HTMLAttributes, ReactNode } from "react";
import styles from "@/components/ui/Badge.module.css";

export type BadgeTone =
  | "earnings"
  | "legal"
  | "insider"
  | "transaction"
  | "product"
  | "neutral";

export type BadgeSize = "micro" | "small" | "large";

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  children: ReactNode;
  size?: BadgeSize;
  tone: BadgeTone;
};

export function Badge({
  children,
  className,
  size = "small",
  tone,
  ...spanProps
}: BadgeProps) {
  const classes = [styles.badge, styles[size], styles[tone], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span {...spanProps} className={classes}>
      {children}
    </span>
  );
}
