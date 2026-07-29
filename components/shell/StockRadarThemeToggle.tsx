"use client";

import { Moon, Sun } from "lucide-react";
import { useStockRadarTheme } from "@/components/shell/StockRadarThemeProvider";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./StockRadarThemeToggle.module.css";

export type StockRadarThemeToggleProps = {
  labeled?: boolean;
};

export function StockRadarThemeToggle({
  labeled = false,
}: StockRadarThemeToggleProps) {
  const { theme, toggleTheme } = useStockRadarTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const icon =
    theme === "dark" ? (
      <Sun aria-hidden="true" size={18} />
    ) : (
      <Moon aria-hidden="true" size={18} />
    );

  if (labeled) {
    return (
      <button
        aria-label={`Switch to ${nextTheme} theme`}
        className={styles.labeledButton}
        onClick={toggleTheme}
        title={`Switch to ${nextTheme} theme`}
        type="button"
      >
        {icon}
        <span>{nextTheme === "light" ? "Light" : "Dark"}</span>
      </button>
    );
  }

  return (
    <IconButton
      aria-label={`Switch to ${nextTheme} theme`}
      onClick={toggleTheme}
      title={`Switch to ${nextTheme} theme`}
    >
      {icon}
    </IconButton>
  );
}
