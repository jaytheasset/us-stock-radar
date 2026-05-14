export type EventSourceGroup = "news" | "filings" | "market";
export type EventSignal = "bullish" | "bearish" | "volatile" | "neutral";
export type EventDeliveryLevel = "archive" | "feed" | "alert";
export type EventImpact = "high" | "medium" | "low";

type EventRow = Record<string, unknown>;

export type CanonicalEventFields = {
  sourceGroup: EventSourceGroup;
  quickTake: string;
  score: number;
  deliveryLevel: EventDeliveryLevel;
  signal: EventSignal;
  impact: EventImpact;
};

export function resolveCanonicalEventFields(row: EventRow): CanonicalEventFields {
  const impact = resolveImpact(row);
  const score = resolveScore(row, impact);

  return {
    sourceGroup: resolveSourceGroup(row),
    quickTake: resolveQuickTake(row),
    score,
    deliveryLevel: resolveDeliveryLevel(row, score),
    signal: resolveSignal(row),
    impact,
  };
}

export function resolveSourceGroup(row: EventRow): EventSourceGroup {
  const direct = normalizeSourceGroup(
    readString(row, ["source_group"]) || readNestedString(row, ["metadata", "source_group"]),
  );
  if (direct) return direct;

  const source = [
    readString(row, ["source_code"]),
    readString(row, ["source_channel"]),
    readString(row, ["event_type"]),
  ]
    .join(" ")
    .toLowerCase();

  if (source.includes("sec") || source.includes("edgar") || /\b(8-k|10-k|10-q|s-1|form4|filing)\b/.test(source)) {
    return "filings";
  }
  if (source.includes("fmp") || source.includes("polygon") || source.includes("market")) {
    return "market";
  }

  return "news";
}

function resolveQuickTake(row: EventRow) {
  return (
    readString(row, ["quick_take", "quickTake", "quick_take_text"]) ||
    readNestedString(row, ["metadata", "quick_take"]) ||
    readNestedString(row, ["metadata", "quickTake"]) ||
    readNestedString(row, ["metadata", "quick_take_text"]) ||
    readString(row, ["summary"]) ||
    readNestedString(row, ["metadata", "summary"]) ||
    ""
  );
}

function resolveScore(row: EventRow, impact: EventImpact) {
  const directScore = firstFiniteNumber([
    readNumber(row, ["score"]),
    readNestedNumber(row, ["metadata", "score"]),
    readNestedNumber(row, ["metadata", "event_score"]),
    readNestedNumber(row, ["metadata", "alert_score"]),
  ]);

  if (Number.isFinite(directScore)) return clampScore(directScore);

  const confidence = (
    readString(row, ["confidence"]) ||
    readNestedString(row, ["metadata", "confidence"]) ||
    ""
  ).toLowerCase();
  const base = impact === "high" ? 82 : impact === "medium" ? 68 : 52;
  const confidenceBoost = confidence === "high" ? 4 : confidence === "low" ? -4 : 0;

  return clampScore(base + confidenceBoost);
}

function resolveDeliveryLevel(row: EventRow, score: number): EventDeliveryLevel {
  const direct = normalizeDeliveryLevel(
    readString(row, ["delivery_level"]) ||
      readNestedString(row, ["metadata", "delivery_level"]) ||
      readNestedString(row, ["metadata", "alert_policy", "visibility"]),
  );

  if (direct) return direct;
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function resolveSignal(row: EventRow): EventSignal {
  return (
    normalizeSignal(
      readString(row, ["signal"]) ||
        readNestedString(row, ["metadata", "signal"]) ||
        readString(row, ["market_direction", "direction"]) ||
        readNestedString(row, ["metadata", "market_direction"]) ||
        readNestedString(row, ["metadata", "direction"]),
    ) || "neutral"
  );
}

function resolveImpact(row: EventRow): EventImpact {
  return (
    normalizeImpact(
      readString(row, ["impact"]) ||
        readString(row, ["impact_level"]) ||
        readNestedString(row, ["metadata", "impact"]) ||
        readNestedString(row, ["metadata", "impact_level"]),
    ) || "medium"
  );
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
  if (normalized === "telegram") return "alert";
  return null;
}

function normalizeSignal(value: string): EventSignal | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bullish" || normalized === "up" || normalized === "positive") return "bullish";
  if (normalized === "bearish" || normalized === "down" || normalized === "negative") return "bearish";
  if (normalized === "volatile" || normalized === "volatility_watch" || normalized === "mixed") return "volatile";
  if (normalized === "neutral") return "neutral";
  return null;
}

function normalizeImpact(value: string): EventImpact | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
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

function readNestedString(row: EventRow | undefined, path: string[]) {
  const value = readNestedValue(row, path);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNestedNumber(row: EventRow | undefined, path: string[]) {
  return numberFromUnknown(readNestedValue(row, path));
}

function readNestedValue(row: EventRow | undefined, path: string[]) {
  let current: unknown = row;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Number.NaN;
}

function firstFiniteNumber(values: number[]) {
  return values.find((value) => Number.isFinite(value)) ?? Number.NaN;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
