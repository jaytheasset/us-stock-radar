import {
  currentReferenceTables,
  canonicalTables,
  eventScoringPolicy,
  liveFeedEventFieldContract,
  taxonomyTickerFlow,
} from "@/lib/dbRegistry";
import { getServerEnv } from "@/lib/env";

type ReadoutQuery = {
  group: string;
  label: string;
  table: string;
  filters?: Record<string, string>;
};

const liveReadoutQueries: ReadoutQuery[] = [
  { group: "Events", label: "All events", table: "events" },
  { group: "Events", label: "News events", table: "events", filters: { source_group: "eq.news" } },
  { group: "Events", label: "Filing events", table: "events", filters: { source_group: "eq.filings" } },
  { group: "Events", label: "Market events", table: "events", filters: { source_group: "eq.market" } },
  {
    group: "Events",
    label: "Market-moving news",
    table: "events",
    filters: { source_group: "eq.news", market_scope: "in.(sector,theme,macro)" },
  },
  { group: "Event detail", label: "Event analysis", table: "event_analysis" },
  { group: "Event detail", label: "Event tickers", table: "event_tickers" },
  { group: "Event detail", label: "Event links", table: "event_links" },
  { group: "Market cache", label: "Quote cache", table: "market_quotes" },
  { group: "Market cache", label: "Bar cache", table: "market_bars" },
  {
    group: "Market cache",
    label: "Sector snapshots",
    table: "market_group_snapshots",
    filters: { scope: "eq.sector" },
  },
  {
    group: "Market cache",
    label: "Industry-group snapshots",
    table: "market_group_snapshots",
    filters: { scope: "eq.industry_group" },
  },
  { group: "Ticker taxonomy", label: "Ticker universe", table: "tickers" },
  { group: "Ticker taxonomy", label: "Ticker classifications", table: "ticker_classifications" },
  { group: "Ticker taxonomy", label: "FMP industry mappings", table: "fmp_industry_mappings" },
  { group: "Sources", label: "Source catalog", table: "sources" },
  { group: "Sources", label: "Source runs", table: "source_runs" },
  { group: "Raw ingest", label: "Raw items", table: "raw_items" },
];

export async function getDbReadout() {
  const [counts, liveSnapshot] = await Promise.all([
    Promise.all(currentReferenceTables.map((table) => countTable({ group: "Reference", label: table, table }))),
    Promise.all(liveReadoutQueries.map((query) => countTable(query))),
  ]);

  return {
    ok: [...counts, ...liveSnapshot].every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    eventScoringPolicy,
    liveFeedEventFieldContract,
    taxonomyTickerFlow,
    canonicalTables,
    currentReference: counts,
    liveSnapshot,
  };
}

async function countTable(query: ReadoutQuery) {
  const env = getServerEnv();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return {
      ...query,
      ok: false,
      status: 0,
      count: null,
      error: "Supabase env is missing",
    };
  }

  const baseUrl = env.supabaseUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/rest/v1/${query.table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "0");
  for (const [name, value] of Object.entries(query.filters || {})) {
    url.searchParams.set(name, value);
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        Accept: "application/json",
        Prefer: "count=exact",
      },
    });
    const body = await response.text();
    const contentRange = response.headers.get("content-range") || "";
    const count = contentRange.includes("/")
      ? Number(contentRange.split("/").pop())
      : null;

    return {
      ...query,
      ok: response.ok,
      status: response.status,
      count: Number.isFinite(count) ? count : null,
      error: response.ok ? undefined : readError(body),
    };
  } catch (error) {
    return {
      ...query,
      ok: false,
      status: 0,
      count: null,
      error: error instanceof Error ? error.message : "Count request failed",
    };
  }
}

function readError(body: string) {
  try {
    const parsed = JSON.parse(body);
    return parsed.message || parsed.error || body.slice(0, 160);
  } catch {
    return body.slice(0, 160);
  }
}
