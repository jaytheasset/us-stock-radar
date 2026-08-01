import type { ReactNode } from "react";
import { StockRadarProductHeader } from "@/components/shell/StockRadarProductHeader";
import { StockRadarProductFooter } from "@/components/shell/StockRadarProductFooter";
import {
  StockRadarThemeProvider,
  type StockRadarThemeMode,
} from "@/components/shell/StockRadarThemeProvider";
import type { StockRadarPrimaryNavigationKey } from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarAppShell.module.css";

export type StockRadarAppShellProps = {
  activeNavigationItem: StockRadarPrimaryNavigationKey | null;
  children: ReactNode;
  themeMode?: StockRadarThemeMode;
};

export function StockRadarAppShell({
  activeNavigationItem,
  children,
  themeMode = "fixed-dark",
}: StockRadarAppShellProps) {
  return (
    <StockRadarThemeProvider className={styles.shell} mode={themeMode}>
      <StockRadarProductHeader
        activeNavigationItem={activeNavigationItem}
        showThemeToggle={themeMode === "user-selectable"}
      />
      <main className={styles.main} id="stock-radar-main-content">
        {children}
      </main>
      <StockRadarProductFooter />
    </StockRadarThemeProvider>
  );
}
