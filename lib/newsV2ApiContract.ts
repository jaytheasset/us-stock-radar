import type {
  NewsV2Item,
  NewsV2SourceActivity,
  NewsV2Statistics,
  NewsV2ThemeActivity,
} from "@/lib/newsV2";

type UnknownRecord = Record<string, unknown>;

export function parseNewsV2Statistics(value: unknown): NewsV2Statistics | null {
  const payload = asRecord(value);
  const asOf = readString(payload?.as_of);
  if (
    !payload ||
    !asOf ||
    !Number.isFinite(Date.parse(asOf)) ||
    payload.range_time_zone !== "America/New_York"
  ) {
    return null;
  }

  return {
    asOf,
    rangeTimeZone: "America/New_York",
    sourceActivity: Array.isArray(payload.source_activity)
      ? payload.source_activity
        .map(parseSourceActivity)
        .filter((item): item is NewsV2SourceActivity => Boolean(item))
      : [],
    themeActivity: Array.isArray(payload.theme_activity)
      ? payload.theme_activity
        .map(parseThemeActivity)
        .filter((item): item is NewsV2ThemeActivity => Boolean(item))
      : [],
  };
}

export function parseSourceActivity(value: unknown): NewsV2SourceActivity | null {
  const row = asRecord(value);
  const source = readString(row?.source);
  const rangeCounts = asRecord(row?.range_counts);
  if (!row || !source) return null;

  return {
    source,
    count: finiteNumber(row.count) ?? 0,
    averageScore: finiteNumber(row.average_score) ?? 0,
    rangeCounts: {
      Today: finiteNumber(rangeCounts?.Today) ?? 0,
      "5D": finiteNumber(rangeCounts?.["5D"]) ?? 0,
      "1M": finiteNumber(rangeCounts?.["1M"]) ?? 0,
      "3M": finiteNumber(rangeCounts?.["3M"]) ?? 0,
    },
  };
}

export function parseThemeActivity(value: unknown): NewsV2ThemeActivity | null {
  const row = asRecord(value);
  const themeGroup = readString(row?.theme_group);
  if (!row || !themeGroup) return null;

  const subThemes = Array.isArray(row.sub_themes)
    ? row.sub_themes
      .map((subTheme): NewsV2ThemeActivity["subThemes"][number] | null => {
        const subThemeRow = asRecord(subTheme);
        const subThemeName = readString(subThemeRow?.sub_theme);
        if (!subThemeRow || !subThemeName) return null;
        return {
          subTheme: subThemeName,
          count: finiteNumber(subThemeRow.count) ?? 0,
          averageScore: finiteNumber(subThemeRow.average_score) ?? 0,
          highImpactCount: finiteNumber(subThemeRow.high_impact_count) ?? 0,
          signalCounts: readSignalCounts(subThemeRow.signal_counts),
        };
      })
      .filter((item): item is NewsV2ThemeActivity["subThemes"][number] => Boolean(item))
    : [];

  return {
    themeGroup,
    count: finiteNumber(row.count) ?? 0,
    averageScore: finiteNumber(row.average_score) ?? 0,
    highImpactCount: finiteNumber(row.high_impact_count) ?? 0,
    signalCounts: readSignalCounts(row.signal_counts),
    subThemes,
  };
}

function readSignalCounts(value: unknown): Record<NewsV2Item["sentiment"], number> {
  const row = asRecord(value);
  return {
    Bullish: finiteNumber(row?.bullish) ?? 0,
    Bearish: finiteNumber(row?.bearish) ?? 0,
    Neutral: finiteNumber(row?.neutral) ?? 0,
    Volatile: finiteNumber(row?.volatile) ?? 0,
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
