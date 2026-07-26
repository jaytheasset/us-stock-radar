import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mapStockOverviewChart,
  mapStockOverviewEvents,
  mapStockOverviewProfile,
  mapStockOverviewQuote,
  resolveWatchlistTicker,
  selectStockOverviewEvents,
} from "./stockOverview.ts";

test("URL ticker selects a saved item and otherwise falls back to the first saved item", () => {
  assert.equal(resolveWatchlistTicker(" amd ", ["NVDA", "AMD"]), "AMD");
  assert.equal(resolveWatchlistTicker("TSLA", ["NVDA", "AMD"]), "NVDA");
  assert.equal(resolveWatchlistTicker(undefined, ["NVDA", "AMD"]), "NVDA");
  assert.equal(resolveWatchlistTicker("AMD", []), null);
});

test("profile and quote mappers keep real values and preserve missing values as null", () => {
  const profile = mapStockOverviewProfile({
    ok: true,
    data: [
      {
        companyName: "Advanced Micro Devices, Inc.",
        exchangeShortName: "NASDAQ",
        industry: "Semiconductors",
        mktCap: 301_000_000_000,
        sector: "Technology",
        website: "https://www.amd.com/",
      },
    ],
  });
  const quote = mapStockOverviewQuote({
    ok: true,
    data: [{ change: 2.4, changesPercentage: 1.25, price: 194.2 }],
  });

  assert.equal(profile.companyName, "Advanced Micro Devices, Inc.");
  assert.equal(profile.exchange, "NASDAQ");
  assert.equal(profile.marketCap, 301_000_000_000);
  assert.equal(quote.price, 194.2);
  assert.equal(quote.changePercent, 1.25);
  assert.equal(quote.dayHigh, null);
});

test("chart mapper rejects incomplete points instead of inventing a line", () => {
  assert.deepEqual(
    mapStockOverviewChart({
      points: [
        { close: 10, high: 11, low: 9, open: 9.5, time: "9:30 AM", volume: 12 },
        { close: null, high: 12, low: 10, open: 11, time: "9:35 AM" },
      ],
    }),
    [
      {
        close: 10,
        high: 11,
        low: 9,
        open: 9.5,
        time: "9:30 AM",
        volume: 12,
      },
    ],
  );
});

test("event mapper creates real analysis routes only for persistent UUIDs and applies score tones", () => {
  const events = mapStockOverviewEvents({
    data: [
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
        ticker: "AMD",
        source_group: "news",
        source_code: "reuters",
        event_type: "earnings",
        score: 75,
        signal: "bullish",
        title: "Company raises guidance",
        summary: "Guidance moved higher.",
        detected_at: "2026-07-25T14:30:00Z",
      },
      {
        id: "synthetic-AMD-2026",
        ticker: "AMD",
        source_group: "filings",
        event_type: "offering",
        score: 74,
        signal: "bearish",
        title: "Registration statement",
        detected_at: "2026-07-24T14:30:00Z",
      },
    ],
  });

  assert.equal(
    events[0]?.detailHref,
    "/events/4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
  );
  assert.equal(events[0]?.scoreTone, "bullish");
  assert.equal(events[1]?.detailHref, null);
  assert.equal(events[1]?.scoreTone, "default");
  assert.equal(selectStockOverviewEvents(events, "financials").length, 1);
  assert.equal(selectStockOverviewEvents(events, "dilution").length, 1);
});

test("watchlist page preserves auth/API contracts and uses the current product shell", async () => {
  const [pageSource, componentSource, addRoute, deleteRoute] = await Promise.all([
    readFile(new URL("../../app/watchlist/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../components/watchlist-v2/StockRadarWatchlistV2.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../app/api/watchlist/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../app/api/watchlist/[ticker]/route.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /getOptionalCurrentUserId/);
  assert.match(pageSource, /getWatchlistViewModel/);
  assert.match(componentSource, /StockRadarAppShell/);
  assert.match(componentSource, /\/api\/watchlist/);
  assert.match(componentSource, /method: "POST"/);
  assert.match(componentSource, /method: "DELETE"/);
  assert.match(componentSource, /payload\.persisted === false/);
  assert.match(componentSource, /viewport="tablet"/);
  assert.match(componentSource, /viewerPlan|watchlist\.plan === "free"/);
  assert.match(addRoute, /persisted: false/);
  assert.match(addRoute, /DUPLICATE_TICKER/);
  assert.match(addRoute, /assertWatchlistLimit/);
  assert.match(deleteRoute, /persisted: false/);
});
