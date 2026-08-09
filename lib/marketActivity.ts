import type { MarketQuoteCachePayload } from "@/lib/marketDataCache";

export const marketActivityIndexDefinitions = [
  { label: "S&P 500", symbol: "^GSPC" },
  { label: "Nasdaq 100", symbol: "^NDX" },
  { label: "Dow", symbol: "^DJI" },
  { label: "Russell 2000", symbol: "^RUT" },
  { label: "SOX", symbol: "^SOX" },
  { label: "VIX", symbol: "^VIX" },
] as const;

export type MarketActivityIndexItem = {
  changePercent: number;
  label: string;
  symbol: string;
  value: number;
};

export type MarketActivityChatItem = {
  createdAt: string;
  href: string;
  message: string;
  roomLabel: string;
  roomName: string | null;
};

export type MarketActivityPayload = {
  chats: MarketActivityChatItem[];
  indices: MarketActivityIndexItem[];
};

type CachedQuote = Omit<MarketQuoteCachePayload, "rawPayload" | "symbol">;

export function buildMarketActivityIndexItems(
  quoteMap: ReadonlyMap<string, CachedQuote>,
): MarketActivityIndexItem[] {
  return marketActivityIndexDefinitions.flatMap((definition) => {
    const quote = quoteMap.get(definition.symbol);
    const value = finiteNumber(quote?.price);
    const directChangePercent = finiteNumber(quote?.changePercent);
    const previousClose = finiteNumber(quote?.previousClose);
    const changePercent =
      directChangePercent ??
      (value !== null && previousClose !== null && previousClose !== 0
        ? ((value - previousClose) / previousClose) * 100
        : null);

    if (value === null || changePercent === null) return [];
    return [{ ...definition, changePercent, value }];
  });
}

export function normalizeMarketActivityChatRows(
  value: unknown,
): MarketActivityChatItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap<MarketActivityChatItem>((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const kind = readText(item.room_kind);
    const ticker = readText(item.ticker).toUpperCase();
    const slug = readText(item.slug).toLowerCase();
    const roomName = clipText(readText(item.room_name), 60);
    const message = clipText(readText(item.body), 60);
    const createdAt = readText(item.created_at);

    if (!message || !isValidDate(createdAt)) return [];

    if (kind === "company" && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)) {
      return [
        {
          createdAt,
          href: `/live/${ticker}`,
          message,
          roomLabel: ticker,
          roomName: `${ticker} Live Room`,
        },
      ];
    }

    if (
      kind === "community" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
      roomName
    ) {
      return [
        {
          createdAt,
          href: `/live/community/${slug}`,
          message,
          roomLabel: roomName,
          roomName: null,
        },
      ];
    }

    return [];
  });
}

export function formatMarketActivityValue(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value < 100 ? 2 : 0,
  });
}

export function formatMarketActivityChange(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function formatMarketActivityElapsed(
  value: string,
  now = Date.now(),
) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function clipText(value: string, maximumLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, maximumLength).join("");
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isValidDate(value: string) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
