import type { ReactNode } from "react";
import { StockRadarProductHeader } from "@/components/shell/StockRadarProductHeader";
import type { StockRadarPrimaryNavigationKey } from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarAppShell.module.css";

export type StockRadarAppShellProps = {
  activeNavigationItem: StockRadarPrimaryNavigationKey;
  children: ReactNode;
};

export function StockRadarAppShell({
  activeNavigationItem,
  children,
}: StockRadarAppShellProps) {
  return (
    <div className={styles.shell}>
      <StockRadarProductHeader activeNavigationItem={activeNavigationItem} />
      <main className={styles.main} id="stock-radar-main-content">
        {children}
      </main>
    </div>
  );
}
