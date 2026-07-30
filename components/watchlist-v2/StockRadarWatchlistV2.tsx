"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownAZ,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import { LiveRoomEntryButton } from "@/components/live-room/LiveRoomEntryButton";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { formatLimit } from "@/lib/subscriptionPolicy";
import {
  formatCompactMarketValue,
  formatStockOverviewEt,
  getStockRouteHref,
  hasStockOverviewData,
  mapStockOverviewChart,
  mapStockOverviewEvents,
  mapStockOverviewProfile,
  mapStockOverviewQuote,
  mapTickerSearchResults,
  resolveStockOverviewTicker,
  selectStockOverviewEvents,
  type StockOverviewChartPoint,
  type StockOverviewEvent,
  type StockOverviewProfile,
  type StockOverviewQuote,
  type StockOverviewSelectionMode,
  type TickerSearchResult,
} from "@/lib/watchlist/stockOverview";
import type { StockFundamentalsSnapshot } from "@/lib/watchlist/stockFundamentals";
import type {
  WatchlistTickerItem,
  WatchlistViewModel,
} from "@/lib/watchlist/types";
import { WatchlistStockChart } from "./WatchlistStockChart";
import { StockFundamentalsSections } from "./StockFundamentalsSections";
import styles from "./StockRadarWatchlistV2.module.css";

type StockRadarWatchlistV2Props = {
  initialSelectedTicker: string | null;
  initialWatchlist: WatchlistViewModel;
  selectionMode?: StockOverviewSelectionMode;
};

type LoadState = "idle" | "loading" | "ready" | "unavailable";
type SortMode = "saved" | "symbol";
type EventFilter = "all" | "news" | "filings";
type ChartRange = "1D" | "5D" | "1M" | "3M" | "1Y";

const emptyProfile: StockOverviewProfile = {
  companyName: "",
  country: "",
  description: "",
  exchange: "",
  industry: "",
  marketCap: null,
  sector: "",
  website: "",
};

const emptyQuote: StockOverviewQuote = {
  change: null,
  changePercent: null,
  dayHigh: null,
  dayLow: null,
  open: null,
  previousClose: null,
  price: null,
  volume: null,
  yearHigh: null,
  yearLow: null,
};

const sectionItems = [
  { id: "watchlist-events", label: "News & Events" },
  { id: "watchlist-financials", label: "Financials" },
  { id: "watchlist-ownership", label: "Ownership" },
  { id: "watchlist-dilution", label: "Dilution" },
] as const;

type StockSectionId = (typeof sectionItems)[number]["id"];

function getStockSectionIdFromHash(hash: string): StockSectionId | null {
  let candidate = hash.replace(/^#/, "");

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }

  return sectionItems.find((item) => item.id === candidate)?.id ?? null;
}

export function StockRadarWatchlistV2({
  initialSelectedTicker,
  initialWatchlist,
  selectionMode = "watchlist",
}: StockRadarWatchlistV2Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [profile, setProfile] = useState(emptyProfile);
  const [quote, setQuote] = useState(emptyQuote);
  const [chartPoints, setChartPoints] = useState<StockOverviewChartPoint[]>([]);
  const [events, setEvents] = useState<StockOverviewEvent[]>([]);
  const [fundamentals, setFundamentals] =
    useState<StockFundamentalsSnapshot | null>(null);
  const [overviewState, setOverviewState] = useState<LoadState>("idle");
  const [chartState, setChartState] = useState<LoadState>("idle");
  const [eventsState, setEventsState] = useState<LoadState>("idle");
  const [fundamentalsState, setFundamentalsState] =
    useState<LoadState>("idle");
  const [chartRange, setChartRange] = useState<ChartRange>("1D");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [visibleEventCount, setVisibleEventCount] = useState(10);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isTickerSheetOpen, setIsTickerSheetOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("saved");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [tickerQuery, setTickerQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([]);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [mutationTicker, setMutationTicker] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");
  const [activeSectionId, setActiveSectionId] =
    useState<StockSectionId>("watchlist-events");
  const tickerSheetOpenerRef = useRef<HTMLButtonElement>(null);
  const previewOpenerRef = useRef<HTMLElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sectionNavigationRef = useRef<HTMLElement>(null);

  const requestedTicker =
    selectionMode === "watchlist"
      ? searchParams.get("ticker") ?? initialSelectedTicker
      : initialSelectedTicker;
  const selectedTicker = resolveStockOverviewTicker(
    requestedTicker,
    watchlist.items.map((item) => item.ticker),
    selectionMode,
  );
  const selectedWatchlistItem =
    watchlist.items.find((item) => item.ticker === selectedTicker) ?? null;
  const allowAds = watchlist.plan === "free";
  const limitReached =
    watchlist.limit !== null && watchlist.usage >= watchlist.limit;
  const sortedWatchlist = useMemo(
    () =>
      sortMode === "symbol"
        ? [...watchlist.items].sort((a, b) => a.ticker.localeCompare(b.ticker))
        : watchlist.items,
    [sortMode, watchlist.items],
  );
  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventFilter === "all") return true;
        if (eventFilter === "filings") return event.sourceGroup === "filings";
        return event.sourceGroup !== "filings";
      }),
    [eventFilter, events],
  );
  const visibleEvents = filteredEvents.slice(0, visibleEventCount);
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
  const latestEvent = events[0] ?? null;
  const financialEvents = selectStockOverviewEvents(events, "financials");
  const ownershipEvents = selectStockOverviewEvents(events, "ownership");
  const dilutionEvents = selectStockOverviewEvents(events, "dilution");

  useEffect(() => {
    if (!selectedTicker) {
      setOverviewState("idle");
      setEvents([]);
      setProfile(emptyProfile);
      setQuote(emptyQuote);
      return;
    }

    const controller = new AbortController();
    const fallbackCompanyName = selectedWatchlistItem?.companyName || "";
    setOverviewState("loading");
    setEventsState("loading");
    setProfile({ ...emptyProfile, companyName: fallbackCompanyName });
    setQuote(emptyQuote);
    setEvents([]);
    setSelectedEventId(null);
    setVisibleEventCount(10);

    void Promise.allSettled([
      fetch(`/api/market/fmp/profile?symbol=${encodeURIComponent(selectedTicker)}`, {
        cache: "no-store",
        signal: controller.signal,
      }).then(readJsonResponse),
      fetch(`/api/market/fmp/quote?symbol=${encodeURIComponent(selectedTicker)}`, {
        cache: "no-store",
        signal: controller.signal,
      }).then(readJsonResponse),
      fetch(
        `/api/events?ticker=${encodeURIComponent(selectedTicker)}&limit=50`,
        { cache: "no-store", signal: controller.signal },
      ).then(readJsonResponse),
    ]).then(([profileResult, quoteResult, eventResult]) => {
      if (controller.signal.aborted) return;
      const mappedProfile =
        profileResult.status === "fulfilled"
          ? mapStockOverviewProfile(profileResult.value)
          : emptyProfile;
      const nextProfile = {
        ...mappedProfile,
        companyName: mappedProfile.companyName || fallbackCompanyName,
      };
      const nextQuote =
        quoteResult.status === "fulfilled"
          ? mapStockOverviewQuote(quoteResult.value)
          : emptyQuote;
      const nextEvents =
        eventResult.status === "fulfilled"
          ? mapStockOverviewEvents(eventResult.value)
          : [];
      setProfile(nextProfile);
      setQuote(nextQuote);
      setEvents(nextEvents);
      setSelectedEventId(nextEvents[0]?.id ?? null);
      setOverviewState(
        hasStockOverviewData(mappedProfile, nextQuote, nextEvents)
          ? "ready"
          : "unavailable",
      );
      setEventsState(
        eventResult.status === "fulfilled" ? "ready" : "unavailable",
      );
    });

    return () => controller.abort();
  }, [selectedTicker, selectedWatchlistItem?.companyName]);

  useEffect(() => {
    if (!selectedTicker) {
      setFundamentals(null);
      setFundamentalsState("idle");
      return;
    }

    const controller = new AbortController();
    setFundamentals(null);
    setFundamentalsState("loading");

    void fetch(
      `/api/market/fmp/fundamentals?symbol=${encodeURIComponent(selectedTicker)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(readJsonResponse)
      .then((payload) => {
        if (controller.signal.aborted) return;
        const nextFundamentals = readFundamentalsSnapshot(
          payload,
          selectedTicker,
        );
        setFundamentals(nextFundamentals);
        setFundamentalsState(nextFundamentals ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFundamentals(null);
          setFundamentalsState("unavailable");
        }
      });

    return () => controller.abort();
  }, [selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) {
      setChartPoints([]);
      setChartState("idle");
      return;
    }

    const controller = new AbortController();
    setChartState("loading");
    setChartPoints([]);
    void fetch(
      `/api/market/chart?symbol=${encodeURIComponent(selectedTicker)}&range=${chartRange}&soft=1`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(readJsonResponse)
      .then((payload) => {
        if (controller.signal.aborted) return;
        const points = mapStockOverviewChart(payload);
        setChartPoints(points);
        setChartState(points.length >= 2 ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setChartPoints([]);
          setChartState("unavailable");
        }
      });

    return () => controller.abort();
  }, [chartRange, selectedTicker]);

  useEffect(() => {
    const query = tickerQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchState("loading");
      void fetch(`/api/tickers/search?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(readJsonResponse)
        .then((payload) => {
          if (controller.signal.aborted) return;
          setSearchResults(mapTickerSearchResults(payload));
          setSearchState("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchResults([]);
            setSearchState("unavailable");
          }
        });
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [tickerQuery]);

  useEffect(() => {
    if (!isSortOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !sortMenuRef.current?.contains(event.target) &&
        !sortTriggerRef.current?.contains(event.target)
      ) {
        setIsSortOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isSortOpen]);

  useEffect(() => {
    const navigation = sectionNavigationRef.current;
    if (!selectedTicker || !navigation) return;

    const sections = sectionItems
      .map((item) => {
        const element = document.getElementById(item.id);
        return element ? { element, id: item.id } : null;
      })
      .filter(
        (
          section,
        ): section is { element: HTMLElement; id: StockSectionId } =>
          section !== null,
      );

    if (sections.length === 0) return;

    let animationFrameId: number | null = null;

    const updateActiveSection = () => {
      animationFrameId = null;
      let nextSectionId = sections[0].id;

      for (const section of sections) {
        const activationLine =
          (Number.parseFloat(
            window.getComputedStyle(section.element).scrollMarginTop,
          ) || 0) + 1;
        if (section.element.getBoundingClientRect().top <= activationLine) {
          nextSectionId = section.id;
        }
      }

      const atDocumentEnd =
        Math.ceil(window.scrollY + window.innerHeight) >=
        document.documentElement.scrollHeight - 2;
      if (atDocumentEnd) {
        nextSectionId = sections.at(-1)?.id ?? nextSectionId;
      }

      setActiveSectionId((current) =>
        current === nextSectionId ? current : nextSectionId,
      );
    };

    const scheduleActiveSectionUpdate = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(updateActiveSection);
    };

    const handleHashChange = () => {
      const hashSectionId = getStockSectionIdFromHash(window.location.hash);
      if (hashSectionId) {
        setActiveSectionId(hashSectionId);
        return;
      }
      scheduleActiveSectionUpdate();
    };

    const initialHashSectionId = getStockSectionIdFromHash(
      window.location.hash,
    );
    if (initialHashSectionId) {
      setActiveSectionId(initialHashSectionId);
      sections
        .find((section) => section.id === initialHashSectionId)
        ?.element.scrollIntoView({ block: "start" });
      scheduleActiveSectionUpdate();
    } else {
      scheduleActiveSectionUpdate();
    }

    window.addEventListener("scroll", scheduleActiveSectionUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleActiveSectionUpdate);
    window.addEventListener("hashchange", handleHashChange);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleActiveSectionUpdate);
    for (const section of sections) {
      resizeObserver?.observe(section.element);
    }

    return () => {
      window.removeEventListener("scroll", scheduleActiveSectionUpdate);
      window.removeEventListener("resize", scheduleActiveSectionUpdate);
      window.removeEventListener("hashchange", handleHashChange);
      resizeObserver?.disconnect();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [fundamentalsState, selectedTicker]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 1120px)").matches) return;

    const navigation = sectionNavigationRef.current;
    const activeLink = navigation?.querySelector<HTMLElement>(
      `a[href="#${activeSectionId}"]`,
    );
    if (!navigation || !activeLink) return;

    const linkStart = activeLink.offsetLeft;
    const linkEnd = linkStart + activeLink.offsetWidth;
    if (linkStart < navigation.scrollLeft) {
      navigation.scrollTo({ left: linkStart });
    } else if (linkEnd > navigation.scrollLeft + navigation.clientWidth) {
      navigation.scrollTo({ left: linkEnd - navigation.clientWidth });
    }
  }, [activeSectionId]);

  function navigateToTicker(ticker: string, replace = false) {
    const href =
      selectionMode === "stock"
        ? getStockRouteHref(ticker)
        : `/watchlist?ticker=${encodeURIComponent(ticker)}`;
    if (!href) return;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }

  async function addTicker(result: TickerSearchResult) {
    if (
      mutationTicker ||
      limitReached ||
      watchlist.items.some((item) => item.ticker === result.ticker)
    ) {
      if (watchlist.items.some((item) => item.ticker === result.ticker)) {
        navigateToTicker(result.ticker);
        setIsTickerSheetOpen(false);
      }
      return;
    }

    const previous = watchlist;
    const optimisticItem: WatchlistTickerItem = {
      companyName: result.companyName,
      createdAt: new Date().toISOString(),
      id: `optimistic-${result.ticker}`,
      ticker: result.ticker,
      updatedAt: new Date().toISOString(),
    };
    setMutationTicker(result.ticker);
    setStatusTone("neutral");
    setStatusMessage(`Adding ${result.ticker}…`);
    setWatchlist({
      ...watchlist,
      items: [...watchlist.items, optimisticItem],
      usage: watchlist.usage + 1,
    });
    navigateToTicker(result.ticker);

    try {
      const response = await fetch("/api/watchlist", {
        body: JSON.stringify({ ticker: result.ticker }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Failed to add ticker.");
      }
      if (payload.persisted === false || payload.guestMode) {
        setWatchlist(previous);
        setStatusMessage(
          payload.message || "Create an account to save your watchlist.",
        );
        setIsTickerSheetOpen(false);
        return;
      }
      setWatchlist(payload.data);
      setTickerQuery("");
      setSearchResults([]);
      setStatusMessage(`${result.ticker} added to your watchlist.`);
      setIsTickerSheetOpen(false);
    } catch (error) {
      setWatchlist(previous);
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to add ticker.",
      );
      const fallbackTicker = previous.items[0]?.ticker;
      if (fallbackTicker) navigateToTicker(fallbackTicker, true);
    } finally {
      setMutationTicker(null);
    }
  }

  async function removeTicker(ticker: string) {
    if (mutationTicker) return;
    const previous = watchlist;
    const nextItems = watchlist.items.filter((item) => item.ticker !== ticker);
    setMutationTicker(ticker);
    setStatusTone("neutral");
    setStatusMessage(`Removing ${ticker}…`);
    setWatchlist({
      ...watchlist,
      items: nextItems,
      usage: Math.max(0, watchlist.usage - 1),
    });
    if (
      selectionMode === "watchlist" &&
      selectedTicker === ticker &&
      nextItems[0]
    ) {
      navigateToTicker(nextItems[0].ticker, true);
    }

    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(ticker)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Failed to remove ticker.");
      }
      if (payload.persisted === false || payload.guestMode) {
        setWatchlist(previous);
        setStatusMessage(
          payload.message || "Create an account to save your watchlist.",
        );
        return;
      }
      setWatchlist(payload.data);
      setStatusMessage(`${ticker} removed from your watchlist.`);
    } catch (error) {
      setWatchlist(previous);
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to remove ticker.",
      );
      navigateToTicker(ticker, true);
    } finally {
      setMutationTicker(null);
    }
  }

  function selectEvent(event: StockOverviewEvent, opener: HTMLElement) {
    setSelectedEventId(event.id);
    previewOpenerRef.current = opener;
    if (window.matchMedia("(max-width: 1180px)").matches) {
      setIsPreviewOpen(true);
    }
  }

  function handleSortMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setIsSortOpen(false);
      sortTriggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nextIndex =
      event.key === "ArrowDown"
        ? (currentIndex + 1 + options.length) % options.length
        : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  const watchlistRail = (
    <WatchlistRail
      isSortOpen={isSortOpen}
      limitReached={limitReached}
      mutationTicker={mutationTicker}
      onAdd={addTicker}
      onCloseSort={() => setIsSortOpen(false)}
      onQueryChange={setTickerQuery}
      onRemove={removeTicker}
      onSelect={(ticker) => {
        navigateToTicker(ticker);
        setIsTickerSheetOpen(false);
      }}
      onSortChange={(nextSort) => {
        setSortMode(nextSort);
        setIsSortOpen(false);
        sortTriggerRef.current?.focus();
      }}
      onSortKeyDown={handleSortMenuKeyDown}
      onToggleSort={() => setIsSortOpen((value) => !value)}
      query={tickerQuery}
      searchResults={searchResults}
      searchState={searchState}
      selectedTicker={selectedTicker}
      sortMenuRef={sortMenuRef}
      sortMode={sortMode}
      sortTriggerRef={sortTriggerRef}
      watchlist={watchlist}
      watchlistItems={sortedWatchlist}
    />
  );

  return (
    <StockRadarAppShell
      activeNavigationItem="watchlist"
      themeMode="user-selectable"
    >
      <div className={styles.page}>
        <div className={styles.pageTopline}>
          <div>
            <span>
              {selectionMode === "stock"
                ? "Stock research workspace"
                : "Personal market workspace"}
            </span>
            <h1>
              {selectionMode === "stock" ? "Stock Overview" : "Watchlist"}
            </h1>
          </div>
          <button
            aria-controls="watchlist-ticker-sheet"
            aria-expanded={isTickerSheetOpen}
            className={styles.tickerSheetTrigger}
            onClick={() => setIsTickerSheetOpen(true)}
            ref={tickerSheetOpenerRef}
            type="button"
          >
            <Menu aria-hidden="true" size={16} />
            {selectedTicker || "Choose ticker"}
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        </div>

        <p
          aria-live={statusTone === "error" ? "assertive" : "polite"}
          className={
            statusTone === "error" ? styles.statusError : styles.statusMessage
          }
        >
          {statusMessage ||
            (watchlist.guestMode
              ? "Preview mode. Create an account to save tickers and sync alerts."
              : `${watchlist.usage} saved · Unlimited watchlist on ${watchlist.planLabel}.`)}
        </p>

        {selectedTicker &&
        (selectionMode === "stock" || selectedWatchlistItem) ? (
          <>
            <StockHeader
              companyName={
                overviewState === "unavailable"
                  ? "Ticker unavailable"
                  : profile.companyName ||
                    selectedWatchlistItem?.companyName ||
                    (overviewState === "loading" || overviewState === "idle"
                      ? "Loading company profile…"
                      : "Company profile unavailable")
              }
              exchange={profile.exchange}
              isSaved={Boolean(selectedWatchlistItem)}
              isUnavailable={overviewState === "unavailable"}
              isQuoteUnavailable={
                !Object.values(quote).some((value) => value !== null)
              }
              limitReached={limitReached}
              mutationTicker={mutationTicker}
              onToggleWatchlist={() => {
                if (selectedWatchlistItem) {
                  void removeTicker(selectedTicker);
                  return;
                }
                void addTicker({
                  assetType: null,
                  companyName: profile.companyName,
                  exchange: profile.exchange || null,
                  marketCap: profile.marketCap,
                  ticker: selectedTicker,
                });
              }}
              quote={quote}
              ticker={selectedTicker}
            />
            <div className={styles.overviewLayout}>
              <aside className={styles.desktopLeftRail}>{watchlistRail}</aside>

              <div className={styles.overviewContent}>
                <nav
                  aria-label="Watchlist stock sections"
                  className={styles.sectionNavigation}
                  ref={sectionNavigationRef}
                >
                  {sectionItems.map((item, index) => (
                    <a
                      aria-current={
                        activeSectionId === item.id ? "location" : undefined
                      }
                      href={`#${item.id}`}
                      key={item.id}
                      onClick={() => setActiveSectionId(item.id)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {item.label}
                    </a>
                  ))}
                </nav>

                <div className={styles.heroGrid}>
                  <RadarBrief event={latestEvent} ticker={selectedTicker} />
                  <section
                    aria-labelledby="watchlist-chart-title"
                    className={styles.chartPanel}
                  >
                    <div className={styles.panelHeading}>
                      <div>
                        <span>PRICE ACTION</span>
                        <h2 id="watchlist-chart-title">{selectedTicker} chart</h2>
                      </div>
                      <span className={styles.dataState}>
                        {chartState === "loading"
                          ? "Loading"
                          : chartState === "ready"
                            ? "Market data"
                            : "Unavailable"}
                      </span>
                    </div>
                    <div
                      aria-label={`${selectedTicker} chart range`}
                      className={styles.rangeControl}
                      role="radiogroup"
                    >
                      {(["1D", "5D", "1M", "3M", "1Y"] as const).map((range) => (
                        <button
                          aria-checked={range === chartRange}
                          key={range}
                          onClick={() => setChartRange(range)}
                          role="radio"
                          type="button"
                        >
                          {range}
                        </button>
                      ))}
                    </div>
                    {chartState === "loading" ? (
                      <div className={styles.loadingPanel} role="status">
                        <LoaderCircle aria-hidden="true" size={22} />
                        Loading price history…
                      </div>
                    ) : (
                      <WatchlistStockChart
                        points={chartPoints}
                        ticker={selectedTicker}
                      />
                    )}
                    <MarketStats quote={quote} profile={profile} />
                  </section>
                </div>

                <div className={styles.promoRow}>
                  {allowAds ? (
                    <>
                      <AdSenseSlot
                        className={styles.desktopInlineAd}
                        enabledForViewer
                        format="horizontal"
                        height={90}
                        inventory="dashboard-desktop-inline"
                        mediaQuery="(min-width: 761px) and (max-width: 1180px)"
                        placeholderSize="Responsive · max 970 × 90"
                        width={970}
                      />
                      <AdSenseSlot
                        className={styles.mobileInlineAd}
                        enabledForViewer
                        format="responsive"
                        height={100}
                        inventory="dashboard-mobile-inline"
                        mediaQuery="(max-width: 760px)"
                        placeholderSize="320 × 100"
                        width={320}
                      />
                    </>
                  ) : null}
                  <WatchlistUpgradeCard watchlist={watchlist} />
                </div>

                <div className={styles.detailGrid}>
                  <div className={styles.detailMain}>
                    <section
                      aria-labelledby="watchlist-events-title"
                      className={styles.section}
                      id="watchlist-events"
                    >
                      <SectionHeading
                        id="watchlist-events-title"
                        number="01"
                        title="News & Events"
                      />
                      <EventList
                        events={visibleEvents}
                        eventFilter={eventFilter}
                        eventsState={eventsState}
                        onFilterChange={(filter) => {
                          setEventFilter(filter);
                          setVisibleEventCount(10);
                        }}
                        onSelect={selectEvent}
                        remainingCount={Math.max(
                          0,
                          filteredEvents.length - visibleEvents.length,
                        )}
                        selectedEventId={selectedEvent?.id ?? null}
                        ticker={selectedTicker}
                        totalCount={filteredEvents.length}
                        onViewMore={() =>
                          setVisibleEventCount((count) => count + 10)
                        }
                      />
                    </section>

                    <StockFundamentalsSections
                      dilutionEvents={dilutionEvents}
                      financialEvents={financialEvents}
                      loadState={fundamentalsState}
                      ownershipEvents={ownershipEvents}
                      snapshot={fundamentals}
                    />
                  </div>

                  <aside
                    aria-label={`${selectedTicker} event context`}
                    className={styles.contextRail}
                  >
                    <EventPreview event={selectedEvent} variant="desktop" />
                    {allowAds ? (
                      <AdSenseSlot
                        className={styles.railAd}
                        enabledForViewer
                        height={250}
                        inventory="dashboard-rail"
                        mediaQuery="(min-width: 1181px)"
                        placeholderSize="300 × 250"
                        width={300}
                      />
                    ) : null}
                    <CompanyContext profile={profile} ticker={selectedTicker} />
                  </aside>
                </div>
              </div>
            </div>
          </>
        ) : (
          <EmptyWatchlist
            guestMode={watchlist.guestMode === true}
            onOpenTickerSheet={() => setIsTickerSheetOpen(true)}
          />
        )}

        <BottomSheetShell
          aria-label="Choose a watchlist ticker"
          closeLabel="Close watchlist"
          id="watchlist-ticker-sheet"
          isOpen={isTickerSheetOpen}
          layout="full-scroll"
          onDismiss={() => setIsTickerSheetOpen(false)}
          openerRef={tickerSheetOpenerRef}
          overlayLabel="Close watchlist"
          viewport="tablet"
        >
          <div className={styles.sheetContent}>
            <div className={styles.sheetHeading}>
              <span>WATCHLIST</span>
              <h2>Choose a stock</h2>
            </div>
            {watchlistRail}
          </div>
        </BottomSheetShell>

        <BottomSheetShell
          aria-label={`${selectedTicker || "Stock"} event preview`}
          closeLabel="Close event preview"
          id="watchlist-event-preview-sheet"
          isOpen={isPreviewOpen && Boolean(selectedEvent)}
          layout="full-scroll"
          onDismiss={() => setIsPreviewOpen(false)}
          openerRef={previewOpenerRef}
          overlayLabel="Close event preview"
          viewport="tablet"
        >
          <div className={styles.sheetContent}>
            <EventPreview event={selectedEvent} variant="mobile" />
          </div>
        </BottomSheetShell>
      </div>
    </StockRadarAppShell>
  );
}

function WatchlistRail({
  isSortOpen,
  limitReached,
  mutationTicker,
  onAdd,
  onCloseSort,
  onQueryChange,
  onRemove,
  onSelect,
  onSortChange,
  onSortKeyDown,
  onToggleSort,
  query,
  searchResults,
  searchState,
  selectedTicker,
  sortMenuRef,
  sortMode,
  sortTriggerRef,
  watchlist,
  watchlistItems,
}: {
  isSortOpen: boolean;
  limitReached: boolean;
  mutationTicker: string | null;
  onAdd: (result: TickerSearchResult) => void;
  onCloseSort: () => void;
  onQueryChange: (value: string) => void;
  onRemove: (ticker: string) => void;
  onSelect: (ticker: string) => void;
  onSortChange: (sort: SortMode) => void;
  onSortKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onToggleSort: () => void;
  query: string;
  searchResults: TickerSearchResult[];
  searchState: LoadState;
  selectedTicker: string | null;
  sortMenuRef: React.RefObject<HTMLDivElement | null>;
  sortMode: SortMode;
  sortTriggerRef: React.RefObject<HTMLButtonElement | null>;
  watchlist: WatchlistViewModel;
  watchlistItems: WatchlistTickerItem[];
}) {
  return (
    <div className={styles.watchlistRail}>
      <div className={styles.watchlistRailHeader}>
        <div>
          <strong>Watchlist</strong>
          <span>
            {watchlist.guestMode ? "Account required" : `${watchlist.usage}/${formatLimit(watchlist.limit)}`}
          </span>
        </div>
        <div className={styles.sortControl}>
          <button
            aria-controls="watchlist-sort-menu"
            aria-expanded={isSortOpen}
            aria-label="Sort watchlist"
            onClick={onToggleSort}
            ref={sortTriggerRef}
            type="button"
          >
            <ArrowDownAZ aria-hidden="true" size={15} />
          </button>
          {isSortOpen ? (
            <div
              aria-label="Watchlist sort options"
              className={styles.sortMenu}
              id="watchlist-sort-menu"
              onKeyDown={onSortKeyDown}
              ref={sortMenuRef}
              role="menu"
            >
              {([
                ["saved", "Saved order"],
                ["symbol", "Symbol A–Z"],
              ] as const).map(([value, label]) => (
                <button
                  aria-checked={sortMode === value}
                  autoFocus={sortMode === value}
                  key={value}
                  onBlur={(event) => {
                    if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
                      onCloseSort();
                    }
                  }}
                  onClick={() => onSortChange(value)}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{label}</span>
                  {sortMode === value ? <Check aria-hidden="true" size={14} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <label className={styles.tickerSearch}>
        <span aria-hidden="true" className={styles.searchIconCell}>
          <Search size={15} />
        </span>
        <input
          aria-label="Search stocks to add"
          autoCapitalize="characters"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search ticker or company"
          value={query}
        />
      </label>

      {query ? (
        <div className={styles.searchResults} role="listbox">
          {searchState === "loading" ? (
            <span className={styles.inlineLoading}>
              <LoaderCircle aria-hidden="true" size={14} /> Searching…
            </span>
          ) : searchResults.length ? (
            searchResults.map((result) => {
              const isSaved = watchlist.items.some(
                (item) => item.ticker === result.ticker,
              );
              return (
                <button
                  aria-label={`${isSaved ? "Open" : "Add"} ${result.ticker}`}
                  disabled={Boolean(mutationTicker) || (!isSaved && limitReached)}
                  key={result.ticker}
                  onClick={() => onAdd(result)}
                  role="option"
                  type="button"
                >
                  <span>
                    <strong>{result.ticker}</strong>
                    <small>{result.companyName}</small>
                  </span>
                  <span>{isSaved ? "Open" : <Plus aria-hidden="true" size={14} />}</span>
                </button>
              );
            })
          ) : (
            <span className={styles.searchEmpty}>
              {searchState === "unavailable"
                ? "Ticker search is unavailable."
                : "No matching active ticker."}
            </span>
          )}
        </div>
      ) : null}

      <ul className={styles.watchlistItems}>
        {watchlistItems.map((item) => (
          <li key={item.id}>
            <button
              aria-current={item.ticker === selectedTicker ? "page" : undefined}
              className={styles.watchlistSelect}
              onClick={() => onSelect(item.ticker)}
              type="button"
            >
              <span>
                <strong>{item.ticker}</strong>
                <small>{item.companyName || "Company profile loads on selection"}</small>
              </span>
              <span>View</span>
            </button>
            {!watchlist.guestMode ? (
              <button
                aria-label={`Remove ${item.ticker} from watchlist`}
                className={styles.watchlistRemove}
                disabled={mutationTicker === item.ticker}
                onClick={() => onRemove(item.ticker)}
                type="button"
              >
                {mutationTicker === item.ticker ? (
                  <LoaderCircle aria-hidden="true" size={14} />
                ) : (
                  <Trash2 aria-hidden="true" size={14} />
                )}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {!watchlistItems.length ? (
        <div className={styles.railEmpty}>
          <Bookmark aria-hidden="true" size={18} />
          <strong>No saved tickers</strong>
          <span>Use search above to add your first stock.</span>
        </div>
      ) : null}

      <div className={styles.railFooter}>
        <span>{watchlist.planLabel} plan</span>
        <Link href={watchlist.guestMode ? "/signup" : "/premium"}>
          {watchlist.guestMode ? "Create account" : "Manage plan"}
        </Link>
      </div>
    </div>
  );
}

function StockHeader({
  companyName,
  exchange,
  isSaved,
  isQuoteUnavailable,
  isUnavailable,
  limitReached,
  mutationTicker,
  onToggleWatchlist,
  quote,
  ticker,
}: {
  companyName: string;
  exchange: string;
  isSaved: boolean;
  isQuoteUnavailable: boolean;
  isUnavailable: boolean;
  limitReached: boolean;
  mutationTicker: string | null;
  onToggleWatchlist: () => void;
  quote: StockOverviewQuote;
  ticker: string;
}) {
  const isPositive = (quote.changePercent ?? 0) >= 0;
  return (
    <header className={styles.stockHeader}>
      <div className={styles.stockIdentity}>
        <span aria-hidden="true">{ticker.slice(0, 4)}</span>
        <div>
          <div>
            <h2>{ticker}</h2>
            <small>{exchange || "Exchange unavailable"}</small>
          </div>
          <p>{companyName || "Company profile unavailable"}</p>
        </div>
      </div>
      <div className={styles.stockQuote}>
        <strong>
          {quote.price === null ? "—" : formatCurrency(quote.price)}
        </strong>
        <span data-tone={isPositive ? "positive" : "negative"}>
          {quote.changePercent === null
            ? "—"
            : `${isPositive ? "+" : ""}${quote.changePercent.toFixed(2)}%`}
        </span>
        <small>
          {quote.change === null
            ? "Change unavailable"
            : `${quote.change >= 0 ? "+" : ""}${formatCurrency(quote.change)}`}
        </small>
      </div>
      <div className={styles.stockStatus}>
        <span>
          {isUnavailable
            ? "TICKER UNAVAILABLE"
            : isQuoteUnavailable
              ? "QUOTE UNAVAILABLE"
              : "MARKET DATA"}
        </span>
        <small>
          {isUnavailable
            ? "No profile, quote, news, or filing data found"
            : isQuoteUnavailable
              ? "Other available stock data remains visible"
              : "Latest available quote"}
        </small>
      </div>
      <div className={styles.stockActions}>
        <button
          aria-pressed={isSaved}
          disabled={
            mutationTicker === ticker || (!isSaved && limitReached)
          }
          onClick={onToggleWatchlist}
          type="button"
        >
          {mutationTicker === ticker ? (
            <LoaderCircle aria-hidden="true" size={15} />
          ) : isSaved ? (
            <Check aria-hidden="true" size={15} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )}
          {isSaved ? "Watching" : "Add to Watchlist"}
        </button>
        <LiveRoomEntryButton issuer={companyName} ticker={ticker} />
        <Link href="/alerts">
          <Bell aria-hidden="true" size={15} />
          Set Alert
        </Link>
      </div>
    </header>
  );
}

function RadarBrief({
  event,
  ticker,
}: {
  event: StockOverviewEvent | null;
  ticker: string;
}) {
  return (
    <aside className={styles.radarBrief}>
      <div className={styles.briefTopline}>
        <span>RADAR BRIEF</span>
        <span>{event ? formatStockOverviewEt(event.detectedAt, "date") : "—"}</span>
      </div>
      {event ? (
        <>
          <div className={styles.briefBadges}>
            <span>{event.category}</span>
            <span data-signal={event.signal}>{event.signal}</span>
          </div>
          <h2>{event.title}</h2>
          <p>{event.summary}</p>
          <small>
            {event.source} · {formatStockOverviewEt(event.detectedAt)}
          </small>
          {event.detailHref ? (
            <Link href={event.detailHref}>
              View event analysis
              <ExternalLink aria-hidden="true" size={13} />
            </Link>
          ) : null}
        </>
      ) : (
        <div className={styles.briefEmpty}>
          <strong>No recent tracked event</strong>
          <span>
            New {ticker} news and filings will appear here when available.
          </span>
        </div>
      )}
    </aside>
  );
}

function MarketStats({
  profile,
  quote,
}: {
  profile: StockOverviewProfile;
  quote: StockOverviewQuote;
}) {
  const items = [
    ["Open", formatCurrencyOrDash(quote.open)],
    ["Prev close", formatCurrencyOrDash(quote.previousClose)],
    ["Day high", formatCurrencyOrDash(quote.dayHigh)],
    ["Day low", formatCurrencyOrDash(quote.dayLow)],
    ["Volume", formatCompactMarketValue(quote.volume)],
    ["Market cap", formatCompactMarketValue(profile.marketCap)],
    ["52W high", formatCurrencyOrDash(quote.yearHigh)],
    ["52W low", formatCurrencyOrDash(quote.yearLow)],
  ];
  return (
    <dl className={styles.marketStats}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventList({
  eventFilter,
  events,
  eventsState,
  onFilterChange,
  onSelect,
  onViewMore,
  remainingCount,
  selectedEventId,
  ticker,
  totalCount,
}: {
  eventFilter: EventFilter;
  events: StockOverviewEvent[];
  eventsState: LoadState;
  onFilterChange: (filter: EventFilter) => void;
  onSelect: (event: StockOverviewEvent, opener: HTMLElement) => void;
  onViewMore: () => void;
  remainingCount: number;
  selectedEventId: string | null;
  ticker: string;
  totalCount: number;
}) {
  return (
    <div className={styles.eventPanel}>
      <div className={styles.eventToolbar}>
        <div aria-label={`${ticker} event filters`} role="tablist">
          {(["all", "news", "filings"] as const).map((filter) => (
            <button
              aria-selected={eventFilter === filter}
              key={filter}
              onClick={() => onFilterChange(filter)}
              role="tab"
              type="button"
            >
              {filter[0].toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <span>{totalCount} events</span>
      </div>
      {eventsState === "loading" ? (
        <div className={styles.loadingPanel} role="status">
          <LoaderCircle aria-hidden="true" size={20} />
          Loading tracked events…
        </div>
      ) : events.length ? (
        <div className={styles.eventList}>
          {events.map((event) => (
            <button
              aria-pressed={event.id === selectedEventId}
              className={styles.eventRow}
              key={event.id}
              onClick={(clickEvent) => onSelect(event, clickEvent.currentTarget)}
              type="button"
            >
              <span className={styles.eventMobileIdentity}>
                <strong>{event.ticker || ticker}</strong>
                <b
                  data-event-emphasis={
                    event.category.toLowerCase().includes("dilution")
                      ? "dilution"
                      : undefined
                  }
                >
                  {event.category}
                </b>
              </span>
              <time className={styles.eventTime} dateTime={event.detectedAt}>
                <span>{formatStockOverviewEt(event.detectedAt, "date")}</span>
                <small>{formatStockOverviewEt(event.detectedAt, "time")}</small>
              </time>
              <span className={styles.eventCopy}>
                <span>
                  <b
                    data-event-emphasis={
                      event.category.toLowerCase().includes("dilution")
                        ? "dilution"
                        : undefined
                    }
                  >
                    {event.category}
                  </b>
                  <small className={styles.eventDesktopMeta}>
                    {event.formType || event.source}
                  </small>
                  <small className={styles.eventMobileSource}>{event.source}</small>
                </span>
                <strong>{event.title}</strong>
              </span>
              <span className={styles.eventSignal}>
                <span data-signal={event.signal}>{event.signal}</span>
                <strong data-score-tone={event.scoreTone}>
                  {event.score ?? "—"}
                </strong>
              </span>
            </button>
          ))}
          {remainingCount ? (
            <button className={styles.viewMore} onClick={onViewMore} type="button">
              <span>View more events</span>
              <small>{Math.min(10, remainingCount)} more</small>
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.sectionEmpty}>
          <strong>No events in this view</strong>
          <span>
            {eventsState === "unavailable"
              ? "Event data is temporarily unavailable."
              : `No tracked ${ticker} events match this filter.`}
          </span>
        </div>
      )}
    </div>
  );
}

function EventPreview({
  event,
  variant,
}: {
  event: StockOverviewEvent | null;
  variant: "desktop" | "mobile";
}) {
  if (!event) {
    return (
      <section className={styles.previewEmpty}>
        <strong>No event selected</strong>
        <span>Select a news or filing row to open its context.</span>
      </section>
    );
  }
  return (
    <article
      className={`${styles.eventPreview} ${variant === "mobile" ? styles.eventPreviewMobile : ""}`}
    >
      <header>
        <div>
          <span>{event.ticker || "MARKET"}</span>
          <small>{event.companyName || event.source}</small>
        </div>
        <span data-signal={event.signal}>{event.signal}</span>
      </header>
      <div className={styles.previewClassification}>
        <b>{event.category}</b>
        <span>{event.formType || event.sourceGroup}</span>
      </div>
      <h3>{event.title}</h3>
      <p>{event.summary}</p>
      <dl>
        <div>
          <dt>Impact</dt>
          <dd data-score-tone={event.scoreTone}>{event.score ?? "—"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{event.source}</dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>{formatStockOverviewEt(event.detectedAt)}</dd>
        </div>
      </dl>
      {event.detailHref ? (
        <Link href={event.detailHref}>
          Open full analysis
          <ExternalLink aria-hidden="true" size={13} />
        </Link>
      ) : (
        <span className={styles.previewUnavailable}>
          Analysis route unavailable for this event.
        </span>
      )}
    </article>
  );
}

function SectionHeading({
  id,
  number,
  title,
}: {
  id: string;
  number: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <span>{number}</span>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function CompanyContext({
  profile,
  ticker,
}: {
  profile: StockOverviewProfile;
  ticker: string;
}) {
  return (
    <section className={styles.companyContext}>
      <span>COMPANY CONTEXT</span>
      <h2>{profile.companyName || ticker}</h2>
      <dl>
        <div>
          <dt>Sector</dt>
          <dd>{profile.sector || "—"}</dd>
        </div>
        <div>
          <dt>Industry</dt>
          <dd>{profile.industry || "—"}</dd>
        </div>
        <div>
          <dt>Country</dt>
          <dd>{profile.country || "—"}</dd>
        </div>
      </dl>
      {profile.description ? <p>{profile.description}</p> : null}
      {profile.website ? (
        <a href={profile.website} rel="noreferrer" target="_blank">
          Company website
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      ) : null}
    </section>
  );
}

function WatchlistUpgradeCard({
  watchlist,
}: {
  watchlist: WatchlistViewModel;
}) {
  if (!watchlist.guestMode) return null;
  return (
    <aside className={styles.upgradeCard}>
      <span>WATCHLIST PREVIEW</span>
      <strong>Save your market workspace</strong>
      <p>Create an account to save unlimited tickers and keep Watchlist Alerts in sync.</p>
      <Link href="/signup">Create account</Link>
    </aside>
  );
}

function EmptyWatchlist({
  guestMode,
  onOpenTickerSheet,
}: {
  guestMode: boolean;
  onOpenTickerSheet: () => void;
}) {
  return (
    <section className={styles.emptyWatchlist}>
      <Bookmark aria-hidden="true" size={28} />
      <span>{guestMode ? "WATCHLIST PREVIEW" : "YOUR WATCHLIST"}</span>
      <h2>{guestMode ? "Build a watchlist that follows you" : "Add your first stock"}</h2>
      <p>
        {guestMode
          ? "Sign in to save tickers, connect Watchlist Alerts, and open the stock overview workspace."
          : "Search for an active US ticker to open its quote, chart, news, filings, and tracked disclosure history."}
      </p>
      {guestMode ? (
        <Link href="/signup">Create account</Link>
      ) : (
        <button onClick={onOpenTickerSheet} type="button">
          <Plus aria-hidden="true" size={16} />
          Add ticker
        </button>
      )}
    </section>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatCurrencyOrDash(value: number | null) {
  return value === null ? "—" : formatCurrency(value);
}

async function readJsonResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload;
}

function readFundamentalsSnapshot(
  payload: unknown,
  expectedSymbol: string,
): StockFundamentalsSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const candidate = data as Partial<StockFundamentalsSnapshot>;
  if (
    candidate.symbol !== expectedSymbol ||
    !candidate.financials ||
    !candidate.ownership ||
    !candidate.sources
  ) {
    return null;
  }
  return candidate as StockFundamentalsSnapshot;
}
