import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import type { BadgeTone } from "@/components/ui/Badge";
import type {
  DashboardV2Event,
  DashboardV2Impact,
  DashboardV2MarketMover,
  DashboardV2Signal,
} from "@/lib/dashboardV2Types";
import { getServerEnv } from "@/lib/env";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { fetchRecentEventsByTickers } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const moverModes = ["gainers", "losers", "volume"] as const;
const sessions = ["Pre", "Regular", "After"] as const;
const rowLimit = 25;
const moverCacheSeconds = 60;

type MoverMode = (typeof moverModes)[number];
type Session = (typeof sessions)[number];
type EventRow = Record<string, unknown>;
type DataStatus = "ready" | "partial" | "empty" | "unavailable";

const loadCachedRegularMovers = unstable_cache(
  async (mode: MoverMode) => loadRegularMarketMovers(mode),
  ["dashboard-v2-regular-movers-v2"],
  { revalidate: moverCacheSeconds },
);

export async function GET(request: NextRequest) {
  const session = normalizeSession(request.nextUrl.searchParams.get("session"));
  const mode = normalizeMode(request.nextUrl.searchParams.get("mode"));

  if (session !== "Regular") {
    return json({
      asOf: null,
      available: false,
      dataAvailability: unavailableData(),
      mode,
      ok: true,
      reason: "session_unavailable",
      receivedAt: new Date().toISOString(),
      rows: [],
      session,
      sourceCount: 0,
    });
  }

  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) {
    return json(
      {
        asOf: null,
        available: false,
        dataAvailability: unavailableData(),
        error: "FMP_API_KEY is not configured",
        mode,
        ok: false,
        reason: "missing_key",
        receivedAt: new Date().toISOString(),
        rows: [],
        session,
        sourceCount: 0,
      },
      503,
    );
  }

  try {
    const result = await loadCachedRegularMovers(mode);
    return json({
      ...result,
      available: true,
      mode,
      ok: true,
      reason: result.rows.length ? "ready" : "empty",
      receivedAt: result.fetchedAt,
      session,
    });
  } catch {
    return json(
      {
        asOf: null,
        available: false,
        dataAvailability: unavailableData(),
        error: "FMP market movers are unavailable",
        mode,
        ok: false,
        reason: "upstream_error",
        receivedAt: new Date().toISOString(),
        rows: [],
        session,
        sourceCount: 0,
      },
      502,
    );
  }
}

async function loadRegularMarketMovers(mode: MoverMode) {
  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const response = await fetch(`https://financialmodelingprep.com/stable/${endpointFor(mode)}`, {
    cache: "no-store",
    headers: { Accept: "application/json", apikey: fmpApiKey },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) throw new Error("FMP movers request failed");

  const baseRows = payload
    .map(normalizeMover)
    .filter((row): row is Omit<DashboardV2MarketMover, "rank" | "events" | "maxImpact"> => row !== null)
    .slice(0, rowLimit);
  const tickers = baseRows.map((row) => row.ticker);
  const [marketCaps, recentEvents] = await Promise.all([
    loadBatchMarketCaps(tickers, fmpApiKey),
    loadRecentEventsByTicker(tickers),
  ]);
  const rows = baseRows.map((row, index) => {
    const marketCapValue = marketCaps.values.get(row.ticker) ?? row.marketCapValue;
    const events = recentEvents.values.get(row.ticker) || [];
    return {
      ...row,
      events,
      marketCap: marketCapValue === undefined ? "—" : formatMarketCap(marketCapValue),
      marketCapValue,
      maxImpact: maxImpact(events),
      rank: index + 1,
    } satisfies DashboardV2MarketMover;
  });
  const marketCapCount = rows.filter((row) => row.marketCapValue !== undefined).length;
  const volumeCount = rows.filter((row) => row.volumeValue !== undefined).length;

  return {
    asOf: readProviderAsOf(payload),
    dataAvailability: {
      events: recentEvents.status,
      marketCap:
        marketCapCount === rows.length && rows.length
          ? "ready"
          : marketCapCount
            ? "partial"
            : "unavailable",
      volume: volumeCount ? (volumeCount === rows.length ? "ready" : "partial") : "unavailable",
    } satisfies Record<"events" | "marketCap" | "volume", DataStatus>,
    fetchedAt: new Date().toISOString(),
    rows,
    sourceCount: payload.length,
  };
}

async function loadBatchMarketCaps(tickers: string[], apiKey: string) {
  const values = new Map<string, number>();
  if (!tickers.length) return { status: "empty" as const, values };

  const url = new URL("https://financialmodelingprep.com/stable/market-capitalization-batch");
  url.searchParams.set("symbols", tickers.join(","));

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", apikey: apiKey },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) return { status: "unavailable" as const, values };

    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const ticker = textValue(row.symbol).toUpperCase();
      const marketCap = numberValue(row.marketCap);
      if (ticker && Number.isFinite(marketCap) && marketCap >= 0) values.set(ticker, marketCap);
    }

    return { status: values.size ? "ready" as const : "empty" as const, values };
  } catch {
    return { status: "unavailable" as const, values };
  }
}

async function loadRecentEventsByTicker(tickers: string[]) {
  const detectedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await fetchRecentEventsByTickers({ detectedAfter, tickers });
  const values = new Map<string, DashboardV2Event[]>();
  if (!result.ok) return { status: "unavailable" as const, values };

  for (const raw of result.data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as EventRow;
    const ticker = textValue(row.ticker).toUpperCase();
    if (!ticker || !tickers.includes(ticker)) continue;
    const event = normalizeEvent(row);
    if (!event) continue;
    values.set(ticker, [...(values.get(ticker) || []), event]);
  }

  return { status: values.size ? "ready" as const : "empty" as const, values };
}

function normalizeEvent(row: EventRow): DashboardV2Event | null {
  const id = textValue(row.id);
  const code = textValue(row.event_type).toLowerCase();
  const title = textValue(row.title);
  const timestamp = textValue(row.detected_at) || textValue(row.published_at);
  if (!id || !code || !title || !timestamp) return null;
  const badge = getEventTypeBadge(code);

  return {
    code,
    id,
    impact: normalizeImpact(row.impact),
    label: badge.label,
    signal: normalizeSignal(row.signal),
    timestamp,
    title,
    tone: badgeTone(badge.tone),
  };
}

function badgeTone(tone: EventTypeBadgeTone): BadgeTone {
  if (tone === "earnings") return "earnings";
  if (tone === "risk" || tone === "dilution") return "legal";
  if (tone === "deal" || tone === "market") return "transaction";
  if (tone === "regulatory") return "insider";
  if (tone === "clinical") return "product";
  return "neutral";
}

function maxImpact(events: DashboardV2Event[]): DashboardV2Impact | undefined {
  if (events.some((event) => event.impact === "high")) return "high";
  if (events.some((event) => event.impact === "medium")) return "medium";
  if (events.some((event) => event.impact === "low")) return "low";
  return undefined;
}

function normalizeImpact(value: unknown): DashboardV2Impact | undefined {
  const impact = textValue(value).toLowerCase();
  return impact === "high" || impact === "medium" || impact === "low" ? impact : undefined;
}

function normalizeSignal(value: unknown): DashboardV2Signal | undefined {
  const signal = textValue(value).toLowerCase();
  return signal === "bullish" || signal === "bearish" || signal === "volatile" || signal === "neutral"
    ? signal
    : undefined;
}

function endpointFor(mode: MoverMode) {
  if (mode === "gainers") return "biggest-gainers";
  if (mode === "losers") return "biggest-losers";
  return "most-actives";
}

function normalizeMover(value: unknown): Omit<DashboardV2MarketMover, "rank" | "events" | "maxImpact"> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const ticker = textValue(row.symbol).toUpperCase();
  const priceValue = numberValue(row.price);
  if (!ticker || !Number.isFinite(priceValue)) return null;
  const marketCapValue = optionalNumber(row.marketCap);
  const volumeValue = optionalNumber(row.volume);

  return {
    changePercent: formatSignedPercent(numberValue(row.changesPercentage)),
    company: textValue(row.name) || ticker,
    logoUrl: `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`,
    marketCap: marketCapValue === undefined ? "—" : formatMarketCap(marketCapValue),
    marketCapValue,
    price: formatCurrency(priceValue),
    priceValue,
    ticker,
    volume: volumeValue === undefined ? "—" : formatVolume(volumeValue),
    volumeValue,
  };
}

function readProviderAsOf(payload: unknown[]) {
  const timestamps = payload
    .map((item) => (item && typeof item === "object" ? textValue((item as EventRow).timestamp) : ""))
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return timestamps[0]?.toISOString() || null;
}

function normalizeMode(value: string | null): MoverMode {
  return moverModes.includes(value as MoverMode) ? (value as MoverMode) : "gainers";
}

function normalizeSession(value: string | null): Session {
  return sessions.includes(value as Session) ? (value as Session) : "Regular";
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Number.NaN;
  const normalized = value.replace(/[$,%]/g, "").replace(/[()]/g, "").trim();
  if (!normalized || !Number.isFinite(Number(normalized))) return Number.NaN;
  return value.trim().startsWith("(") ? -Math.abs(Number(normalized)) : Number(normalized);
}

function optionalNumber(value: unknown) {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function unavailableData() {
  return { events: "unavailable", marketCap: "unavailable", volume: "unavailable" } as const;
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" }, status });
}
