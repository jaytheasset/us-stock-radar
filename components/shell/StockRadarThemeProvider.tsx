"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

const defaultTheme: StockRadarTheme = "dark";

const StockRadarThemeContext = createContext<StockRadarThemeContextValue | null>(
  null,
);

const initialThemeScript = `
  try {
    const root = document.currentScript?.parentElement;
    const storedTheme = localStorage.getItem("${stockRadarThemeStorageKey}");

    if (root) {
      root.dataset.srTheme = storedTheme === "light" ? "light" : "dark";
    }
  } catch (_) {}
`;

export function StockRadarThemeProvider({
  children,
  className,
  mode = "fixed-dark",
}: StockRadarThemeProviderProps) {
  const [theme, setTheme] = useState<StockRadarTheme>(defaultTheme);

  useEffect(() => {
    if (mode !== "user-selectable") {
      setTheme(defaultTheme);
      return;
    }

    try {
      const storedTheme = localStorage.getItem(stockRadarThemeStorageKey);
      setTheme(storedTheme === "light" ? "light" : defaultTheme);
    } catch (_) {
      setTheme(defaultTheme);
    }
  }, [mode]);

  const toggleTheme = useCallback(() => {
    if (mode !== "user-selectable") {
      return;
    }

    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";

      try {
        localStorage.setItem(stockRadarThemeStorageKey, nextTheme);
      } catch (_) {}

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
        {mode === "user-selectable" ? (
          <script dangerouslySetInnerHTML={{ __html: initialThemeScript }} />
        ) : null}
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
