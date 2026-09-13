"use client";

import { LoaderCircle, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  readTickerSearchResponse,
  type TickerSearchResult,
} from "@/lib/tickerSearchContract";
import { moveTickerSearchIndex } from "@/lib/tickerSearchNavigation";
import type { TickerSearchArrowKey } from "@/lib/tickerSearchNavigation";
import styles from "./TickerCompanyAutocomplete.module.css";

type TickerCompanyAutocompleteProps = {
  autoFocus?: boolean;
  autoSelectExact?: boolean;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  getOptionAction?: (result: TickerSearchResult) => ReactNode;
  id?: string;
  isOptionDisabled?: (result: TickerSearchResult) => boolean;
  label: string;
  onSelect: (result: TickerSearchResult) => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  selectedTicker?: string | null;
  searchSurface?: "stock-research";
  value: string;
};

type SearchState = "idle" | "loading" | "ready" | "error";

export function TickerCompanyAutocomplete({
  autoFocus = false,
  autoSelectExact = false,
  className,
  disabled = false,
  emptyMessage = "No matching listed ticker.",
  getOptionAction,
  id,
  isOptionDisabled,
  label,
  onSelect,
  onValueChange,
  placeholder,
  selectedTicker,
  searchSurface,
  value,
}: TickerCompanyAutocompleteProps) {
  const generatedId = useId().replace(/:/g, "");
  const inputId = id || `ticker-company-search-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const lastAutoSelectedRef = useRef("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedValue = value.trim();
  const selectionMatches =
    Boolean(selectedTicker) && selectedTicker?.toUpperCase() === normalizedValue.toUpperCase();

  useEffect(() => {
    if (!normalizedValue || selectionMatches) {
      setResults([]);
      setState("idle");
      setActiveIndex(-1);
      setIsOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState("loading");
      setIsOpen(true);
      void fetch(`/api/tickers/search?q=${encodeURIComponent(normalizedValue)}`, {
        cache: "no-store",
        headers: searchSurface ? { "x-stock-radar-search-surface": searchSurface } : undefined,
        signal: controller.signal,
      })
        .then(readTickerSearchResponse)
        .then((nextResults) => {
          if (controller.signal.aborted) return;
          setResults(nextResults);
          setActiveIndex(nextResults.length ? 0 : -1);
          setState("ready");

          const exact = autoSelectExact
            ? nextResults.find(
                (result) => result.ticker === normalizedValue.toUpperCase(),
              )
            : undefined;
          if (exact && lastAutoSelectedRef.current !== exact.ticker) {
            lastAutoSelectedRef.current = exact.ticker;
            setIsOpen(false);
            onSelectRef.current(exact);
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setActiveIndex(-1);
          setState(error instanceof DOMException && error.name === "AbortError" ? "idle" : "error");
        });
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [autoSelectExact, normalizedValue, selectionMatches, searchSurface]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const selectResult = (result: TickerSearchResult) => {
    lastAutoSelectedRef.current = result.ticker;
    setIsOpen(false);
    setActiveIndex(-1);
    onValueChange(result.ticker);
    onSelect(result);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (isOpen) event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        moveTickerSearchIndex(
          current,
          results.length,
          event.key as TickerSearchArrowKey,
        ),
      );
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      const result = results[activeIndex];
      if (!result || isOptionDisabled?.(result)) return;
      event.preventDefault();
      selectResult(result);
    }
  };

  const rootClassName = className ? `${styles.root} ${className}` : styles.root;
  const showListbox = isOpen && Boolean(normalizedValue);

  return (
    <div className={rootClassName} ref={rootRef}>
      <label className={styles.control} htmlFor={inputId}>
        <span aria-hidden="true" className={styles.iconCell}>
          <Search size={17} />
        </span>
        <span className={styles.visuallyHidden}>{label}</span>
        <input
          aria-activedescendant={
            showListbox && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showListbox}
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          id={inputId}
          onChange={(event) => {
            lastAutoSelectedRef.current = "";
            onValueChange(event.target.value);
            setIsOpen(Boolean(event.target.value.trim()));
          }}
          onFocus={() => {
            if (normalizedValue) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          type="search"
          value={value}
        />
      </label>

      {showListbox ? (
        <div
          aria-label={`${label} results`}
          className={styles.listbox}
          id={listboxId}
          role="listbox"
        >
          {state === "loading" ? (
            <p className={styles.status} role="status">
              <LoaderCircle aria-hidden="true" className={styles.spinner} size={15} />
              Searching...
            </p>
          ) : state === "error" ? (
            <p className={styles.status} role="alert">Ticker search is unavailable.</p>
          ) : results.length ? (
            results.map((result, index) => {
              const optionDisabled = isOptionDisabled?.(result) === true;
              return (
                <button
                  aria-disabled={optionDisabled}
                  aria-selected={activeIndex === index}
                  className={styles.option}
                  data-active={activeIndex === index}
                  disabled={optionDisabled}
                  id={`${listboxId}-option-${index}`}
                  key={result.ticker}
                  onClick={() => selectResult(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className={styles.identity}>
                    <strong>{result.ticker}</strong>
                    <small>{result.exchange || result.assetType || "US listed"}</small>
                  </span>
                  <span className={styles.company}>
                    {result.companyName}
                    {result.isHistoricalTicker ? <small> · Previously {result.historicalTicker}</small> : null}
                  </span>
                  {getOptionAction ? (
                    <span className={styles.action}>{getOptionAction(result)}</span>
                  ) : null}
                </button>
              );
            })
          ) : state === "ready" ? (
            <p className={styles.status}>{emptyMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
