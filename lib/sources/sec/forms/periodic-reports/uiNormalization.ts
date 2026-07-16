export type PeriodicComparisonBasis = "yoy" | "qoq" | "other";

type ParsedPeriod =
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "annual"; year: number };

export function normalizePeriodicComparisonBasis(
  currentLabel: string,
  comparisonLabel: string,
  suppliedBasis: PeriodicComparisonBasis,
): PeriodicComparisonBasis {
  const current = parsePeriod(currentLabel);
  const comparison = parsePeriod(comparisonLabel);
  if (!current || !comparison || current.kind !== comparison.kind) return suppliedBasis;

  if (current.kind === "annual" && comparison.kind === "annual") {
    return current.year !== comparison.year ? "yoy" : "other";
  }

  if (current.kind === "quarter" && comparison.kind === "quarter") {
    if (current.quarter === comparison.quarter && current.year !== comparison.year) return "yoy";
    const currentIndex = current.year * 4 + current.quarter;
    const comparisonIndex = comparison.year * 4 + comparison.quarter;
    return currentIndex - comparisonIndex === 1 ? "qoq" : "other";
  }

  return suppliedBasis;
}

export function normalizePeriodicChartNumber(displayValue: string, fallback: number) {
  const text = displayValue.trim();
  if (!text || hasNumericRange(text)) return fallback;

  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;

  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) return fallback;

  const negative = numeric < 0 || /\([^)]*\d[^)]*\)/.test(text);
  const magnitude = Math.abs(numeric) * periodicMagnitudeMultiplier(text);
  return negative ? -magnitude : magnitude;
}

export function clipPeriodicDisplayText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text || text.length <= maxLength) return text;

  const available = Math.max(1, maxLength - 1);
  const candidate = text.slice(0, available);
  const sentenceBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "));
  const wordBoundary = candidate.lastIndexOf(" ");
  const boundary = sentenceBoundary >= Math.floor(available * 0.55)
    ? sentenceBoundary + 1
    : wordBoundary >= Math.floor(available * 0.55)
      ? wordBoundary
      : available;
  return `${candidate.slice(0, boundary).trimEnd()}…`;
}

function parsePeriod(value: string): ParsedPeriod | null {
  const text = value.toUpperCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const quarterFirst = text.match(/\bQ([1-4])\s*(?:FY\s*)?'?(\d{2,4})\b/);
  const numberFirst = text.match(/\b([1-4])Q\s*(?:FY\s*)?'?(\d{2,4})\b/);
  const quarterMatch = quarterFirst || numberFirst;
  if (quarterMatch) {
    return {
      kind: "quarter",
      quarter: Number(quarterMatch[1]),
      year: normalizeYear(Number(quarterMatch[2])),
    };
  }

  const annualMatch = text.match(/\bFY\s*'?(\d{2,4})\b/);
  if (annualMatch) return { kind: "annual", year: normalizeYear(Number(annualMatch[1])) };
  return null;
}

function normalizeYear(value: number) {
  if (value >= 100) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function hasNumericRange(value: string) {
  return /\d\s*(?:-|–|—|to)\s*[$€£¥]?\s*\d/i.test(value);
}

function periodicMagnitudeMultiplier(value: string) {
  if (/\b(?:trillion|tn)\b/i.test(value) || /\d\s*T\b/i.test(value)) return 1_000_000_000_000;
  if (/\b(?:billion|bn)\b/i.test(value) || /\d\s*B\b/i.test(value)) return 1_000_000_000;
  if (/\b(?:million|mn)\b/i.test(value) || /\d\s*M\b/i.test(value)) return 1_000_000;
  if (/\bthousand\b/i.test(value) || /\d\s*K\b/i.test(value)) return 1_000;
  return 1;
}
