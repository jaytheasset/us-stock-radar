"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getStockRouteHref,
  mapTickerSearchResults,
  type TickerSearchResult,
} from "@/lib/watchlist/stockOverview";
import {
  moveTickerSearchIndex,
  type TickerSearchArrowKey,
} from "@/lib/tickerSearchNavigation";
import styles from "./StockRadarProductHeader.module.css";

const searchPanelId = "stock-radar-global-ticker-search";
const searchListboxId = "stock-radar-global-ticker-results";

type SearchState = "idle" | "loading" | "ready" | "error";

export function StockRadarTickerSearch({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeSearch = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setActiveIndex(-1);

    if (restoreFocus) {
      requestAnimationFrame(() => {
        openerRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        closeSearch();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSearch, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setSearchState("idle");
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchState("loading");
      void fetch(
        `/api/tickers/search?q=${encodeURIComponent(normalizedQuery)}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(readSearchResponse)
        .then((payload) => {
          if (controller.signal.aborted) return;
          const nextResults = mapTickerSearchResults(payload);
          setResults(nextResults);
          setActiveIndex(nextResults.length ? 0 : -1);
          setSearchState("ready");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setActiveIndex(-1);
          setSearchState("error");
        });
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isOpen, query]);

  const navigateToResult = (result: TickerSearchResult) => {
    const href = getStockRouteHref(result.ticker);
    if (!href) return;
    closeSearch();
    setQuery("");
    setResults([]);
    router.push(href);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const key: TickerSearchArrowKey = event.key;
      setActiveIndex((current) =>
        moveTickerSearchIndex(current, results.length, key),
      );
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = results[activeIndex] ?? results[0];
    if (result) navigateToResult(result);
  };

  return (
    <div className={styles.globalSearch} ref={rootRef}>
      <button
        aria-controls={searchPanelId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Search stocks"
        className={styles.searchButton}
        onClick={() => {
          if (isOpen) closeSearch(true);
          else {
            onOpen();
            setIsOpen(true);
          }
        }}
        ref={openerRef}
        type="button"
      >
        <Search aria-hidden="true" size={18} />
        <span>Search</span>
      </button>

      {isOpen ? (
        <section
          aria-label="Search stocks"
          className={styles.globalSearchPanel}
          id={searchPanelId}
          role="dialog"
        >
          <div className={styles.globalSearchHeading}>
            <div>
              <span>STOCK SEARCH</span>
              <strong>Open a stock overview</strong>
            </div>
            <button
              aria-label="Close stock search"
              className={styles.globalSearchClose}
              onClick={() => closeSearch(true)}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>

          <form className={styles.globalSearchForm} onSubmit={handleSubmit}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-activedescendant={
                activeIndex >= 0
                  ? `${searchListboxId}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={searchListboxId}
              aria-expanded={isOpen}
              aria-label="Search ticker or company"
              autoCapitalize="characters"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search ticker or company"
              ref={inputRef}
              role="combobox"
              type="search"
              value={query}
            />
          </form>

          <div
            aria-label="Ticker search results"
            className={styles.globalSearchResults}
            id={searchListboxId}
            role="listbox"
          >
            {searchState === "loading" ? (
              <p className={styles.globalSearchState} role="status">
                <LoaderCircle aria-hidden="true" size={16} />
                Searching…
              </p>
            ) : searchState === "error" ? (
              <p className={styles.globalSearchState} role="alert">
                Ticker search is temporarily unavailable.
              </p>
            ) : results.length ? (
              results.map((result, index) => (
                <button
                  aria-selected={activeIndex === index}
                  className={styles.globalSearchResult}
                  id={`${searchListboxId}-option-${index}`}
                  key={result.ticker}
                  onClick={() => navigateToResult(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>
                    <strong>{result.ticker}</strong>
                    <small>{result.exchange || "Exchange unavailable"}</small>
                  </span>
                  <span>{result.companyName}</span>
                </button>
              ))
            ) : query.trim() && searchState === "ready" ? (
              <p className={styles.globalSearchState}>
                No matching active ticker.
              </p>
            ) : (
              <p className={styles.globalSearchState}>
                Search active US tickers and companies.
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function readSearchResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || "Ticker search failed.");
  }
  return payload;
}
