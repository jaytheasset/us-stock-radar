import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import type { DashboardV2MarketMover } from "@/lib/mock/dashboardV2Data";

export const dynamic = "force-dynamic";

const moverModes = ["gainers", "losers", "volume"] as const;
const sessions = ["Pre", "Regular", "After"] as const;
const rowLimit = 50;

type MoverMode = (typeof moverModes)[number];
type Session = (typeof sessions)[number];

export async function GET(request: NextRequest) {
  const session = normalizeSession(request.nextUrl.searchParams.get("session"));
  const mode = normalizeMode(request.nextUrl.searchParams.get("mode"));

  if (session !== "Regular") {
    return NextResponse.json(
      {
        available: false,
        mode,
        ok: true,
        rows: [],
        session,
        sourceCount: 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) {
    return NextResponse.json(
      { available: false, error: "Market movers unavailable", mode, ok: false, rows: [], session, sourceCount: 0 },
      { status: 503 },
    );
  }

  const response = await fetch(`https://financialmodelingprep.com/stable/${endpointFor(mode)}`, {
    cache: "no-store",
    headers: { Accept: "application/json", apikey: fmpApiKey },
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;

  if (!response?.ok || !Array.isArray(payload)) {
    return NextResponse.json(
      { available: false, error: "Market movers unavailable", mode, ok: false, rows: [], session, sourceCount: 0 },
      { status: 502 },
    );
  }

  const rows = payload
    .map(normalizeMover)
    .filter((row): row is Omit<DashboardV2MarketMover, "rank"> => row !== null)
    .slice(0, rowLimit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return NextResponse.json(
    {
      available: true,
      mode,
      ok: true,
      rows,
      session,
      sourceCount: payload.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function endpointFor(mode: MoverMode) {
  if (mode === "gainers") return "biggest-gainers";
  if (mode === "losers") return "biggest-losers";
  return "most-actives";
}

function normalizeMover(value: unknown): Omit<DashboardV2MarketMover, "rank"> | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  const ticker = String(row.symbol ?? "").trim().toUpperCase();
  const price = numberValue(row.price);
  if (!ticker || !Number.isFinite(price)) return null;

  const changePercent = numberValue(row.changesPercentage);

  return {
    changePercent: formatSignedPercent(changePercent),
    company: String(row.name ?? ticker).trim() || ticker,
    events: [],
    logoUrl: `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`,
    marketCap: "—",
    maxImpact: undefined,
    price: formatCurrency(price),
    ticker,
    volume: "—",
  };
}

function normalizeMode(value: string | null): MoverMode {
  return moverModes.includes(value as MoverMode) ? (value as MoverMode) : "gainers";
}

function normalizeSession(value: string | null): Session {
  return sessions.includes(value as Session) ? (value as Session) : "Regular";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Number.NaN;

  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.replace(/[$,%]/g, "").replace(/[()]/g, "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return trimmed.startsWith("(") ? -Math.abs(parsed) : parsed;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}
