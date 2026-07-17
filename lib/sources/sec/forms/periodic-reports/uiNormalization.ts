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
    return current.year - comparison.year === 1 ? "yoy" : "other";
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
  const text = normalizePeriodicNarrativeText(value);
  if (!text || text.length <= maxLength) return text;

  const suffix = "...";
  const available = Math.max(1, maxLength - suffix.length);
  const candidate = text.slice(0, available);
  const sentenceBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "));
  const wordBoundary = candidate.lastIndexOf(" ");
  const boundary = sentenceBoundary >= Math.floor(available * 0.55)
    ? sentenceBoundary + 1
    : wordBoundary >= Math.floor(available * 0.55)
      ? wordBoundary
      : available;
  return `${candidate.slice(0, boundary).trimEnd()}${suffix}`;
}

export function normalizePeriodicNarrativeText(value: unknown) {
  return typeof value === "string"
    ? normalizePeriodicDisplayEncoding(value).trim().replace(/\s+/g, " ")
    : "";
}

export function fitPeriodicNarrativeText(value: unknown, maxLength: number) {
  const text = normalizePeriodicNarrativeText(value);
  if (!text || text.length <= maxLength) return text;

  const sentences = text.match(/.*?(?:[.!?](?:[\"')\]]+)?(?=\s|$)|$)/g) || [];
  let fitted = "";
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const candidate = fitted ? `${fitted} ${sentence}` : sentence;
    if (candidate.length > maxLength) break;
    fitted = candidate;
  }
  if (fitted) return fitted;

  // A single overlong sentence cannot be shortened safely without rewriting.
  // Preserve it rather than corrupting an amount, date, or investor conclusion.
  return text;
}

function normalizePeriodicDisplayEncoding(value: string) {
  return normalizePeriodicPunctuation(repairPeriodicUtf8Mojibake(value));
}

function repairPeriodicUtf8Mojibake(value: string) {
  if (!/[\u00c2\u00c3\u00e2]/.test(value)) return value;

  const characters = Array.from(value);
  let repaired = "";
  for (let index = 0; index < characters.length; index += 1) {
    const leadByte = periodicWindows1252Byte(characters[index]);
    const sequenceLength = periodicUtf8SequenceLength(leadByte);
    if (sequenceLength <= 1 || index + sequenceLength > characters.length) {
      repaired += characters[index];
      continue;
    }

    const bytes = characters.slice(index, index + sequenceLength).map(periodicWindows1252Byte);
    if (bytes.some((byte) => byte === null) || bytes.slice(1).some((byte) => byte! < 0x80 || byte! > 0xbf)) {
      repaired += characters[index];
      continue;
    }

    try {
      const encoded = bytes.map((byte) => `%${byte!.toString(16).padStart(2, "0")}`).join("");
      repaired += decodeURIComponent(encoded);
      index += sequenceLength - 1;
    } catch {
      repaired += characters[index];
    }
  }
  return repaired;
}

function periodicUtf8SequenceLength(leadByte: number | null) {
  if (leadByte === null) return 0;
  if (leadByte >= 0xc2 && leadByte <= 0xdf) return 2;
  if (leadByte >= 0xe0 && leadByte <= 0xef) return 3;
  if (leadByte >= 0xf0 && leadByte <= 0xf4) return 4;
  return 1;
}

function periodicWindows1252Byte(character: string): number | null {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return null;
  if (codePoint <= 0xff) return codePoint;
  return PERIODIC_WINDOWS_1252_SPECIAL_BYTES[codePoint] ?? null;
}

const PERIODIC_WINDOWS_1252_SPECIAL_BYTES: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function normalizePeriodicPunctuation(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");
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
