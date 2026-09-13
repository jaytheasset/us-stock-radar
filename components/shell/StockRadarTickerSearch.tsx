"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getStockRouteHref,
  type TickerSearchResult,
} from "@/lib/watchlist/stockOverview";
import {
  buildTickerSearchReadout,
  createTickerSearchSelectionSnapshot,
  getTickerSearchRequestHref,
  resolveTickerSearchObservation,
  resolveTickerSearchRequestSnapshot,
  serializeTickerSearchSelectionSnapshot,
  TICKER_SEARCH_SELECTION_STORAGE_KEY,
} from "@/lib/tickerSearchFlowObservation";
import {
  moveTickerSearchIndex,
  type TickerSearchArrowKey,
} from "@/lib/tickerSearchNavigation";
import { TickerSearchFlowReadout } from "./TickerSearchFlowReadout";
import styles from "./StockRadarProductHeader.module.css";

const searchPanelId = "stock-radar-global-ticker-search";
const searchListboxId = "stock-radar-global-ticker-results";

export function StockRadarTickerSearch({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [responsePayload, setResponsePayload] = useState<unknown>();
  const [request, setRequest] = useState(() =>
    resolveTickerSearchRequestSnapshot({ requestState: "idle" }),
  );
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const observation = useMemo(
    () =>
      resolveTickerSearchObservation({
        activeIndex,
        payload: responsePayload,
        query,
        request,
      }),
    [activeIndex, query, request, responsePayload],
  );
  const flowReadout = useMemo(
    () => buildTickerSearchReadout(observation),
    [observation],
  );

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
    const requestHref = getTickerSearchRequestHref(query);
    if (!requestHref) {
      setResponsePayload(undefined);
      setRequest(resolveTickerSearchRequestSnapshot({ requestState: "idle" }));
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setRequest(resolveTickerSearchRequestSnapshot({ requestState: "loading" }));
      void fetch(requestHref, {
        cache: "no-store",
        headers: { "X-Stock-Radar-Search-Surface": "stock-research" },
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          return {
            payload,
            request: resolveTickerSearchRequestSnapshot({
              httpStatus: response.status,
              payload,
              requestState: "received",
            }),
          };
        })
        .then((next) => {
          if (controller.signal.aborted) return;
          setResponsePayload(next.payload);
          setRequest(next.request);
          setActiveIndex(
            next.request.sourceResultCount && next.request.sourceResultCount > 0
              ? 0
              : -1,
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResponsePayload(undefined);
          setActiveIndex(-1);
          setRequest(resolveTickerSearchRequestSnapshot({ requestState: "failed" }));
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
    const selection = createTickerSearchSelectionSnapshot({
      observation,
      selectedTicker: result.ticker,
      selectionHref: href,
    });
    if (selection) {
      try {
        window.sessionStorage.setItem(
          TICKER_SEARCH_SELECTION_STORAGE_KEY,
          serializeTickerSearchSelectionSnapshot(selection),
        );
      } catch {
        // Search navigation remains usable when ephemeral storage is blocked.
      }
    }
    closeSearch();
    setQuery("");
    setResponsePayload(undefined);
    setRequest(resolveTickerSearchRequestSnapshot({ requestState: "idle" }));
    router.push(href);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!observation.results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const key: TickerSearchArrowKey = event.key;
      setActiveIndex((current) =>
        moveTickerSearchIndex(current, observation.results.length, key),
      );
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result =
      observation.results[activeIndex] ?? observation.results[0];
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
        <div
          aria-hidden="true"
          className={styles.globalSearchBackdrop}
          onClick={() => closeSearch(true)}
        />
      ) : null}

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
              onChange={(event) => {
                setQuery(event.target.value);
                setResponsePayload(undefined);
                setRequest(
                  resolveTickerSearchRequestSnapshot({ requestState: "idle" }),
                );
                setActiveIndex(-1);
              }}
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
            {observation.status === "loading" ? (
              <p
                className={styles.globalSearchState}
                role={observation.role ?? undefined}
              >
                <LoaderCircle aria-hidden="true" size={16} />
                {observation.message}
              </p>
            ) : observation.status === "unavailable" ? (
              <p
                className={styles.globalSearchState}
                role={observation.role ?? undefined}
              >
                {observation.message}
              </p>
            ) : observation.status === "ready" ? (
              observation.results.map((result, index) => (
                <button
                  aria-selected={activeIndex === index}
                  className={styles.globalSearchResult}
                  id={`${searchListboxId}-option-${index}`}
                  key={`${result.ticker}:${result.historicalTicker || "current"}`}
                  onClick={() => navigateToResult(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>
                    <strong>{result.historicalTicker || result.ticker}</strong>
                    <small>
                      {result.isHistoricalTicker && result.historicalTicker
                        ? `Historical ticker · now ${result.ticker}`
                        : result.exchange || "Exchange unavailable"}
                    </small>
                  </span>
                  <span>{result.companyName}</span>
                </button>
              ))
            ) : observation.status === "empty" ? (
              <p
                className={styles.globalSearchState}
                role={observation.role ?? undefined}
              >
                {observation.message}
              </p>
            ) : (
              <p className={styles.globalSearchState}>
                {observation.message}
              </p>
            )}
          </div>
          <TickerSearchFlowReadout state={flowReadout} />
        </section>
      ) : null}
    </div>
  );
}
