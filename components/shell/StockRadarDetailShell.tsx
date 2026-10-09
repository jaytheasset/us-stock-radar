import type { ReactNode } from "react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

/** Keep the existing detail renderers inside the product navigation and theme. */
export function StockRadarDetailShell({
  activeNavigationItem,
  children,
  className,
}: {
  activeNavigationItem: "filings" | "news";
  children: ReactNode;
  className: string;
}) {
  return (
    <StockRadarAppShell
      activeNavigationItem={activeNavigationItem}
      themeMode="user-selectable"
    >
      <div className={`${className} detail-shell-page`}>{children}</div>
    </StockRadarAppShell>
  );
}
