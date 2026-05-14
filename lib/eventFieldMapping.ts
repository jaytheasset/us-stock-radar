export type EventSourceGroup = "news" | "filings" | "market";
export type EventSignal = "bullish" | "bearish" | "volatile" | "neutral";
export type EventDeliveryLevel = "archive" | "feed" | "alert";
export type EventImpact = "high" | "medium" | "low";
export type EventMarketScope = "company" | "sector" | "theme" | "macro";

type EventRow = Record<string, unknown>;

export type CanonicalEventFields = {
  sourceGroup: EventSourceGroup;
  quickTake: string;
  score: number;
  deliveryLevel: EventDeliveryLevel;
  signal: EventSignal;
  impact: EventImpact;
  marketScope: EventMarketScope;
};

export function resolveCanonicalEventFields(row: EventRow): CanonicalEventFields {
  return {
    sourceGroup: normalizeSourceGroup(readString(row, ["source_group"])) || "news",
    quickTake: readString(row, ["quick_take"]),
    score: clampScore(readNumber(row, ["score"])),
    deliveryLevel: normalizeDeliveryLevel(readString(row, ["delivery_level"])) || "archive",
    signal: normalizeSignal(readString(row, ["signal"])) || "neutral",
    impact: normalizeImpact(readString(row, ["impact"])) || "medium",
    marketScope: normalizeMarketScope(readString(row, ["market_scope"])) || "company",
  };
}

function normalizeSourceGroup(value: string): EventSourceGroup | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "news" || normalized === "filings" || normalized === "market") {
    return normalized;
  }
  return null;
}

function normalizeDeliveryLevel(value: string): EventDeliveryLevel | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "archive" || normalized === "feed" || normalized === "alert") {
    return normalized;
  }
  return null;
}

function normalizeSignal(value: string): EventSignal | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bullish") return "bullish";
  if (normalized === "bearish") return "bearish";
  if (normalized === "volatile") return "volatile";
  if (normalized === "neutral") return "neutral";
  return null;
}

function normalizeImpact(value: string): EventImpact | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return null;
}

function normalizeMarketScope(value: string): EventMarketScope | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "company" || normalized === "sector" || normalized === "theme" || normalized === "macro") {
    return normalized;
  }
  return null;
}

function readString(row: EventRow | undefined, keys: string[]) {
  if (!row) return "";

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return "";
}

function readNumber(row: EventRow | undefined, keys: string[]) {
  if (!row) return Number.NaN;

  for (const key of keys) {
    const value = row[key];
    const number = numberFromUnknown(value);
    if (Number.isFinite(number)) return number;
  }

  return Number.NaN;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Number.NaN;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
