"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type StockRadarTheme = "dark" | "light";
export type StockRadarThemeMode = "fixed-dark" | "user-selectable";

type StockRadarThemeContextValue = {
  theme: StockRadarTheme;
  toggleTheme: () => void;
};

export type StockRadarThemeProviderProps = {
  children: ReactNode;
  className?: string;
  mode?: StockRadarThemeMode;
};

export const stockRadarThemeStorageKey = "sr-theme";
const legacyThemeStorageKey = "stock-radar-theme";

const defaultTheme: StockRadarTheme = "dark";

const StockRadarThemeContext = createContext<StockRadarThemeContextValue | null>(
  null,
);

function isStockRadarTheme(
  value: string | null | undefined,
): value is StockRadarTheme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): StockRadarTheme | null {
  const storedTheme = localStorage.getItem(stockRadarThemeStorageKey);

  if (isStockRadarTheme(storedTheme)) {
    return storedTheme;
  }

  const legacyTheme = localStorage.getItem(legacyThemeStorageKey);
  return isStockRadarTheme(legacyTheme) ? legacyTheme : null;
}

function applyDocumentTheme(theme: StockRadarTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function StockRadarThemeProvider({
  children,
  className,
  mode = "fixed-dark",
}: StockRadarThemeProviderProps) {
  const [theme, setTheme] = useState<StockRadarTheme>(defaultTheme);

  useLayoutEffect(() => {
    if (mode !== "user-selectable") {
      setTheme(defaultTheme);
      return;
    }

    let nextTheme = defaultTheme;

    try {
      const storedTheme = readStoredTheme();
      const documentTheme = document.documentElement.dataset.theme;
      nextTheme =
        storedTheme ??
        (isStockRadarTheme(documentTheme) ? documentTheme : defaultTheme);

      localStorage.setItem(stockRadarThemeStorageKey, nextTheme);
      localStorage.setItem(legacyThemeStorageKey, nextTheme);
    } catch (_) {}

    applyDocumentTheme(nextTheme);
    setTheme(nextTheme);
  }, [mode]);

  const toggleTheme = useCallback(() => {
    if (mode !== "user-selectable") {
      return;
    }

    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";

      try {
        localStorage.setItem(stockRadarThemeStorageKey, nextTheme);
        localStorage.setItem(legacyThemeStorageKey, nextTheme);
      } catch (_) {}

      applyDocumentTheme(nextTheme);
      return nextTheme;
    });
  }, [mode]);

  const contextValue = useMemo(
    () => ({ theme, toggleTheme }),
    [theme, toggleTheme],
  );

  return (
    <StockRadarThemeContext.Provider value={contextValue}>
      <div
        className={className}
        data-sr-theme={theme}
        suppressHydrationWarning
      >
        {children}
      </div>
    </StockRadarThemeContext.Provider>
  );
}

export function useStockRadarTheme() {
  const context = useContext(StockRadarThemeContext);

  if (!context) {
    throw new Error(
      "useStockRadarTheme must be used within StockRadarThemeProvider.",
    );
  }

  return context;
}
