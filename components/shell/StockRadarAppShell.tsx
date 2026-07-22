"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StockRadarProductHeader } from "@/components/shell/StockRadarProductHeader";
import type { StockRadarPrimaryNavigationKey } from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarAppShell.module.css";

export type StockRadarThemeMode = "fixed-dark" | "user-selectable";

type StockRadarTheme = "dark" | "light";

const stockRadarThemeStorageKey = "sr-theme";

function resolveStockRadarTheme(value: string | null): StockRadarTheme {
  return value === "light" || value === "dark" ? value : "dark";
}

function readStoredStockRadarTheme(): StockRadarTheme {
  try {
    return resolveStockRadarTheme(window.localStorage.getItem(stockRadarThemeStorageKey));
  } catch {
    return "dark";
  }
}

function storeStockRadarTheme(theme: StockRadarTheme) {
  try {
    window.localStorage.setItem(stockRadarThemeStorageKey, theme);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export type StockRadarAppShellProps = {
  activeNavigationItem: StockRadarPrimaryNavigationKey;
  themeMode?: StockRadarThemeMode;
  headerContentMaxWidth?: string;
  children: ReactNode;
};

export function StockRadarAppShell({
  activeNavigationItem,
  themeMode = "fixed-dark",
  headerContentMaxWidth,
  children,
}: StockRadarAppShellProps) {
  const [theme, setTheme] = useState<StockRadarTheme>("dark");

  useEffect(() => {
    if (themeMode !== "user-selectable") {
      setTheme("dark");
      return;
    }

    setTheme(readStoredStockRadarTheme());
  }, [themeMode]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      storeStockRadarTheme(nextTheme);
      return nextTheme;
    });
  }, []);

  return (
    <div className={styles.shell} data-sr-theme={theme}>
      <StockRadarProductHeader
        activeNavigationItem={activeNavigationItem}
        onThemeToggle={
          themeMode === "user-selectable"
            ? toggleTheme
            : undefined
        }
        theme={theme}
        themeMode={themeMode}
        contentMaxWidth={headerContentMaxWidth}
      />
      <main className={styles.main} id="stock-radar-main-content">
        {children}
      </main>
    </div>
  );
}
