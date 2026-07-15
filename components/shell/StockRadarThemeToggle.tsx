"use client";

import { Moon, Sun } from "lucide-react";
import { useStockRadarTheme } from "@/components/shell/StockRadarThemeProvider";
import { IconButton } from "@/components/ui/IconButton";

export function StockRadarThemeToggle() {
  const { theme, toggleTheme } = useStockRadarTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <IconButton
      aria-label={`Switch to ${nextTheme} theme`}
      onClick={toggleTheme}
      title={`Switch to ${nextTheme} theme`}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={18} />
      ) : (
        <Moon aria-hidden="true" size={18} />
      )}
    </IconButton>
  );
}
