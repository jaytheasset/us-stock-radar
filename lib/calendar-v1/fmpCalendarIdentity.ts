import { parseDateOnly } from "./dateUtils.ts";

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const TBA_SYMBOLS = new Set(["", "-", "N/A", "NA", "NONE", "TBA", "TBD"]);

export function normalizeFmpCalendarTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  if (TBA_SYMBOLS.has(symbol) || !TICKER_PATTERN.test(symbol)) return null;
  return symbol;
}

export function normalizeFmpCalendarExchange(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, " ")
    .replaceAll(/\s+/g, " ");

  if (
    normalized.includes("NASDAQ") ||
    normalized === "NMS" ||
    normalized === "NGM" ||
    normalized === "NCM"
  ) {
    return "NASDAQ";
  }
  if (
    normalized === "NYSE" ||
    normalized.startsWith("NYSE") ||
    normalized.includes("NEW YORK STOCK EXCHANGE")
  ) {
    return normalized.includes("AMERICAN") ? "AMEX" : "NYSE";
  }
  if (
    normalized === "AMEX" ||
    normalized.includes("NYSE AMERICAN") ||
    normalized.includes("AMERICAN STOCK EXCHANGE")
  ) {
    return "AMEX";
  }
  return null;
}

export function isAllowedFmpCompanyExchange(value: unknown) {
  return normalizeFmpCalendarExchange(value) !== null;
}

export function buildEarningsIdentity(symbol: string, eventDate: string) {
  const { year, quarter } = calendarQuarter(eventDate);
  return `fmp:company:earnings:${symbol}:${year}:q${quarter}`;
}

export function buildDividendIdentity(input: {
  amount: number;
  frequency: string;
  occurrenceDate: string;
  occurrenceKind: "declaration" | "payment" | "record";
  symbol: string;
}) {
  parseDateOnly(input.occurrenceDate);
  const frequency = identityText(input.frequency);
  if (!frequency) return null;
  return [
    "fmp:company:dividend",
    input.symbol,
    input.occurrenceKind,
    input.occurrenceDate,
    canonicalNumber(input.amount),
    frequency,
  ].join(":");
}

export function buildSplitIdentity(input: {
  denominator: number;
  eventDate: string;
  numerator: number;
  symbol: string;
}) {
  const ratio = normalizeSplitRatio(input.numerator, input.denominator);
  if (!ratio) return null;
  const year = parseDateOnly(input.eventDate).getFullYear();
  return `fmp:company:split:${input.symbol}:${year}:${ratio.numerator}:${ratio.denominator}`;
}

export function buildIpoIdentity(input: {
  company: string;
  exchange: string;
  symbol: string | null;
}) {
  const company = identityText(input.company);
  const exchange = identityText(input.exchange);
  if (!company || !exchange) return null;
  return `fmp:company:ipo:${input.symbol ?? "tba"}:${exchange}:${company}`;
}

export function normalizeSplitRatio(numerator: number, denominator: number) {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0 ||
    numerator === denominator
  ) {
    return null;
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  const normalizedNumerator = numerator / divisor;
  const normalizedDenominator = denominator / divisor;
  return {
    denominator: normalizedDenominator,
    kind:
      normalizedNumerator > normalizedDenominator
        ? ("forward" as const)
        : ("reverse" as const),
    numerator: normalizedNumerator,
    ratio: `${normalizedNumerator}:${normalizedDenominator}`,
  };
}

export function validateRelatedDate(
  value: unknown,
  eventDate: string,
  bounds: { maxDays: number; minDays: number },
) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const related = parseDateOnly(value.trim());
    const event = parseDateOnly(eventDate);
    const days = Math.round((related.getTime() - event.getTime()) / 86_400_000);
    return days >= bounds.minDays && days <= bounds.maxDays
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}

function calendarQuarter(eventDate: string) {
  const date = parseDateOnly(eventDate);
  return {
    quarter: Math.floor(date.getMonth() / 3) + 1,
    year: date.getFullYear(),
  };
}

function identityText(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function canonicalNumber(value: number) {
  return value.toFixed(8).replaceAll(/0+$/g, "").replaceAll(/\.$/g, "");
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a;
}
