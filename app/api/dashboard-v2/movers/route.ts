import { NextRequest, NextResponse } from "next/server";
import type { BadgeTone } from "@/components/ui/Badge";
import type {
  DashboardV2Event,
  DashboardV2Impact,
  DashboardV2MarketMover,
} from "@/lib/dashboardV2Types";
import { getServerEnv } from "@/lib/env";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { fetchEvents } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const moverModes = ["gainers", "losers", "volume"] as const;
const sessions = ["Pre", "Regular", "After"] as const;
const rowLimit = 25;

type MoverMode = (typeof moverModes)[number];
type Session = (typeof sessions)[number];
type EventRow = Record<string, unknown>;

export async function GET(request: NextRequest) {
  const session = normalizeSession(request.nextUrl.searchParams.get("session"));
  const mode = normalizeMode(request.nextUrl.searchParams.get("mode"));

  if (session !== "Regular") {
    return json({
      asOf: null,
      available: false,
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

  const response = await fetch(`https://financialmodelingprep.com/stable/${endpointFor(mode)}`, {
    cache: "no-store",
    headers: { Accept: "application/json", apikey: fmpApiKey },
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;

  if (!response?.ok || !Array.isArray(payload)) {
    return json(
      {
        asOf: null,
        available: false,
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

  const normalizedRows = payload
    .map(normalizeMover)
    .filter((row): row is Omit<DashboardV2MarketMover, "rank" | "events" | "maxImpact"> => row !== null)
    .slice(0, rowLimit);
  const eventsByTicker = await loadRecentEventsByTicker();
  const rows = normalizedRows.map((row, index) => {
    const events = eventsByTicker.get(row.ticker) || [];
    return {
      ...row,
      events,
      maxImpact: maxImpact(events),
      rank: index + 1,
    } satisfies DashboardV2MarketMover;
  });

  return json({
    asOf: readProviderAsOf(payload),
    available: true,
    mode,
    ok: true,
    reason: rows.length ? "ready" : "empty",
    receivedAt: new Date().toISOString(),
    rows,
    session,
    sourceCount: payload.length,
  });
}

async function loadRecentEventsByTicker() {
  const detectedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await fetchEvents({ detectedAfter, excludeDeliveryLevel: "archive", limit: 100 });
  const lookup = new Map<string, DashboardV2Event[]>();
  if (!result.ok) return lookup;

  for (const raw of result.data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as EventRow;
    const ticker = textValue(row.ticker).toUpperCase();
    if (!ticker) continue;
    const event = normalizeEvent(row);
    if (!event) continue;
    const current = lookup.get(ticker) || [];
    if (current.length < 4) lookup.set(ticker, [...current, event]);
  }

  return lookup;
}

function normalizeEvent(row: EventRow): DashboardV2Event | null {
  const id = textValue(row.id);
  const code = textValue(row.event_type) || "other";
  const title = textValue(row.title) || textValue(row.quick_take);
  const timestamp = textValue(row.detected_at) || textValue(row.published_at);
  if (!id || !title || !timestamp) return null;
  const badge = getEventTypeBadge(code);

  return {
    code,
    id,
    impact: normalizeImpact(row.impact),
    label: badge.label,
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

function normalizeImpact(value: unknown): DashboardV2Impact {
  const impact = textValue(value).toLowerCase();
  return impact === "high" || impact === "low" ? impact : "medium";
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
  const price = numberValue(row.price);
  if (!ticker || !Number.isFinite(price)) return null;

  return {
    changePercent: formatSignedPercent(numberValue(row.changesPercentage)),
    company: textValue(row.name) || ticker,
    logoUrl: `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`,
    marketCap: "—",
    price: formatCurrency(price),
    ticker,
    volume: formatVolume(numberValue(row.volume)),
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

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" }, status });
}
