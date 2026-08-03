import {
  LiveRoomPolicyError,
  normalizeLiveRoomTicker,
} from "./policy.ts";
import {
  sectorMappings,
  themeGroups,
  themeSubThemes,
} from "../taxonomyRegistry.ts";

export const COMMUNITY_ROOM_TOPICS = [
  { label: "Market & macro", value: "market_macro" },
  { label: "Sector & industry", value: "sector_industry" },
  { label: "Events & catalysts", value: "events_catalysts" },
  { label: "Trading strategy", value: "trading_strategy" },
  { label: "Learning & Q&A", value: "learning_qna" },
  { label: "Creator community", value: "creator_community" },
] as const;

export const COMMUNITY_ROOM_STYLES = [
  { label: "Live reaction", value: "live_reaction" },
  { label: "Deep research", value: "deep_research" },
  { label: "Beginner friendly", value: "beginner_friendly" },
  { label: "Open discussion", value: "open_discussion" },
] as const;

export const COMMUNITY_ROOM_FOCUS_TAGS = [
  { label: "Company news", value: "company_news" },
  { label: "SEC filings", value: "sec_filings" },
  { label: "Earnings", value: "earnings" },
  { label: "FDA & clinical", value: "fda_clinical" },
  { label: "Dilution & listing", value: "dilution_listing" },
  { label: "Legal & financial risk", value: "legal_financial_risk" },
  { label: "Macro & policy", value: "macro_policy" },
  { label: "M&A & strategy", value: "mna_strategy" },
  { label: "Product & leadership", value: "product_leadership" },
] as const;

export const COMMUNITY_ROOM_LANGUAGES = [
  { label: "English", value: "en" },
  { label: "한국어", value: "ko" },
  { label: "日本語", value: "ja" },
] as const;

export const COMMUNITY_ROOM_SORTS = [
  { label: "Recent activity", value: "activity" },
  { label: "Newest rooms", value: "newest" },
] as const;

export const COMMUNITY_ROOM_THEME_OPTIONS = themeGroups.flatMap((group) => [
  {
    groupLabel: group.name,
    groupSlug: group.slug,
    kind: "main" as const,
    label: group.name,
    value: group.slug,
  },
  ...themeSubThemes
    .filter((theme) => theme.themeGroupSlug === group.slug)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((theme) => ({
      groupLabel: group.name,
      groupSlug: group.slug,
      kind: "specific" as const,
      label: theme.name,
      value: theme.slug,
    })),
]);

export const COMMUNITY_ROOM_INDUSTRY_OPTIONS = sectorMappings.map(
  (industry) => ({
    groupLabel: industry.sector,
    label: industry.subCategory,
    value: industry.slug,
  }),
);

export const COMMUNITY_ROOM_NAME_MIN_LENGTH = 4;
export const COMMUNITY_ROOM_NAME_MAX_LENGTH = 60;
export const COMMUNITY_ROOM_SUMMARY_MIN_LENGTH = 12;
export const COMMUNITY_ROOM_SUMMARY_MAX_LENGTH = 160;
export const COMMUNITY_ROOM_SEARCH_MAX_LENGTH = 80;
export const COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE = 20;

export type CommunityRoomTopic =
  (typeof COMMUNITY_ROOM_TOPICS)[number]["value"];
export type CommunityRoomStyle =
  (typeof COMMUNITY_ROOM_STYLES)[number]["value"];
export type CommunityRoomFocusTag =
  (typeof COMMUNITY_ROOM_FOCUS_TAGS)[number]["value"];
export type CommunityRoomLanguage =
  (typeof COMMUNITY_ROOM_LANGUAGES)[number]["value"];
export type CommunityRoomSort =
  (typeof COMMUNITY_ROOM_SORTS)[number]["value"];
export type CommunityRoomTheme =
  (typeof COMMUNITY_ROOM_THEME_OPTIONS)[number]["value"];
export type CommunityRoomIndustry =
  (typeof COMMUNITY_ROOM_INDUSTRY_OPTIONS)[number]["value"];

export type CommunityRoom = {
  createdAt: string;
  focusTags: CommunityRoomFocusTag[];
  industries: CommunityRoomIndustry[];
  language: CommunityRoomLanguage;
  lastActivityAt: string;
  name: string;
  relatedTickers: string[];
  roomStyle: CommunityRoomStyle;
  slug: string;
  summary: string;
  themes: CommunityRoomTheme[];
  topic: CommunityRoomTopic;
};

export type CommunityRoomDirectoryFilters = {
  cursor: string | null;
  focusTag: CommunityRoomFocusTag | null;
  industry: CommunityRoomIndustry | null;
  language: CommunityRoomLanguage | null;
  roomStyle: CommunityRoomStyle | null;
  search: string;
  sort: CommunityRoomSort;
  topic: CommunityRoomTopic | null;
  theme: CommunityRoomTheme | null;
};

export type CommunityRoomDirectoryPage = {
  filters: CommunityRoomDirectoryFilters;
  items: CommunityRoom[];
  nextCursor: string | null;
};

export type CompanyLiveRoomDirectoryResult = {
  companyName: string;
  exchange: string | null;
  ticker: string;
};

export type CompanyLiveRoomDirectoryResolution =
  | { status: "found"; value: CompanyLiveRoomDirectoryResult }
  | { status: "missing" }
  | { status: "unavailable" };

export function resolveCompanyLiveRoomDirectoryResult({
  registry,
  room,
  ticker,
}: {
  registry: {
    available: boolean;
    companyName: string | null;
    exchange: string | null;
    exists: boolean;
  };
  room: {
    adminStatus: string | null;
    available: boolean;
    exists: boolean;
  };
  ticker: string;
}): CompanyLiveRoomDirectoryResolution {
  if (!room.available && !registry.available) {
    return { status: "unavailable" };
  }
  if (
    room.available &&
    room.exists &&
    room.adminStatus?.toLowerCase() === "archived"
  ) {
    return { status: "missing" };
  }
  if (!room.exists && !registry.exists) {
    return { status: "missing" };
  }

  return {
    status: "found",
    value: {
      companyName: registry.companyName?.trim() || `${ticker} company`,
      exchange: registry.exchange?.trim() || null,
      ticker,
    },
  };
}

export type CommunityRoomCreateInput = {
  focusTags: CommunityRoomFocusTag[];
  industries: CommunityRoomIndustry[];
  language: CommunityRoomLanguage;
  name: string;
  relatedTickers: string[];
  roomStyle: CommunityRoomStyle;
  summary: string;
  themes: CommunityRoomTheme[];
  topic: CommunityRoomTopic;
};

const blockedRoomTextPattern =
  /<[^>]*>|(?:https?|ftp):\/\/|mailto:|javascript:|data:[a-z0-9.+-]+\/|www\.|discord\.gg|t\.me\/|wa\.me\/|(?:^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d+)?(?:\/|\s|$)/i;

export function normalizeCommunityRoomCreateInput(
  value: unknown,
): CommunityRoomCreateInput {
  const input = readRecord(value);
  const name = readTrimmedString(input.name);
  const summary = readTrimmedString(input.summary);
  const topic = readChoice(
    input.topic,
    COMMUNITY_ROOM_TOPICS,
    "COMMUNITY_ROOM_INVALID_TOPIC",
    "Choose one room topic.",
  );
  const roomStyle = readChoice(
    input.roomStyle,
    COMMUNITY_ROOM_STYLES,
    "COMMUNITY_ROOM_INVALID_STYLE",
    "Choose one room style.",
  );
  const language = readChoice(
    input.language,
    COMMUNITY_ROOM_LANGUAGES,
    "COMMUNITY_ROOM_INVALID_LANGUAGE",
    "Choose one room language.",
  );
  const focusTags = readChoiceArray(
    input.focusTags,
    COMMUNITY_ROOM_FOCUS_TAGS,
    1,
    3,
    "COMMUNITY_ROOM_INVALID_FOCUS_TAGS",
    "Choose between 1 and 3 focus tags.",
  );
  const relatedTickers = [
    ...new Set(
      (Array.isArray(input.relatedTickers)
        ? input.relatedTickers
        : []
      ).map((ticker) => {
        try {
          return normalizeLiveRoomTicker(ticker);
        } catch {
          throw new LiveRoomPolicyError(
            "COMMUNITY_ROOM_INVALID_RELATED_TICKERS",
            "Add up to 5 valid related tickers.",
          );
        }
      }),
    ),
  ];
  const themes = readChoiceArray(
    input.themes,
    COMMUNITY_ROOM_THEME_OPTIONS,
    0,
    3,
    "COMMUNITY_ROOM_INVALID_THEMES",
    "Choose up to 3 canonical market themes.",
  ) as CommunityRoomTheme[];
  const industries = readChoiceArray(
    input.industries,
    COMMUNITY_ROOM_INDUSTRY_OPTIONS,
    0,
    3,
    "COMMUNITY_ROOM_INVALID_INDUSTRIES",
    "Choose up to 3 canonical industries.",
  ) as CommunityRoomIndustry[];

  assertPlainRoomText(
    name,
    COMMUNITY_ROOM_NAME_MIN_LENGTH,
    COMMUNITY_ROOM_NAME_MAX_LENGTH,
    "COMMUNITY_ROOM_INVALID_NAME",
    `Room names must be ${COMMUNITY_ROOM_NAME_MIN_LENGTH}-${COMMUNITY_ROOM_NAME_MAX_LENGTH} plain-text characters.`,
  );
  assertPlainRoomText(
    summary,
    COMMUNITY_ROOM_SUMMARY_MIN_LENGTH,
    COMMUNITY_ROOM_SUMMARY_MAX_LENGTH,
    "COMMUNITY_ROOM_INVALID_SUMMARY",
    `Room descriptions must be ${COMMUNITY_ROOM_SUMMARY_MIN_LENGTH}-${COMMUNITY_ROOM_SUMMARY_MAX_LENGTH} plain-text characters.`,
  );
  if (relatedTickers.length > 5) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_INVALID_RELATED_TICKERS",
      "Add up to 5 related tickers.",
    );
  }
  if (
    relatedTickers.length === 0 &&
    themes.length === 0 &&
    industries.length === 0
  ) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED",
      "Choose at least one ticker, theme, or industry.",
    );
  }

  return {
    focusTags,
    industries,
    language,
    name,
    relatedTickers,
    roomStyle,
    summary,
    themes,
    topic,
  };
}

export function normalizeCommunityRoomDirectoryFilters(
  value: unknown,
): CommunityRoomDirectoryFilters {
  const input = readRecord(value);
  const search = readTrimmedString(input.search ?? input.q);
  if (search.length > COMMUNITY_ROOM_SEARCH_MAX_LENGTH) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_INVALID_SEARCH",
      `Search can be up to ${COMMUNITY_ROOM_SEARCH_MAX_LENGTH} characters.`,
    );
  }

  return {
    cursor: readOptionalString(input.cursor),
    focusTag: readOptionalChoice(
      input.focusTag ?? input.tag,
      COMMUNITY_ROOM_FOCUS_TAGS,
      "COMMUNITY_ROOM_INVALID_FOCUS_TAGS",
    ),
    industry: readOptionalChoice(
      input.industry,
      COMMUNITY_ROOM_INDUSTRY_OPTIONS,
      "COMMUNITY_ROOM_INVALID_INDUSTRIES",
    ) as CommunityRoomIndustry | null,
    language: readOptionalChoice(
      input.language,
      COMMUNITY_ROOM_LANGUAGES,
      "COMMUNITY_ROOM_INVALID_LANGUAGE",
    ),
    roomStyle: readOptionalChoice(
      input.roomStyle ?? input.style,
      COMMUNITY_ROOM_STYLES,
      "COMMUNITY_ROOM_INVALID_STYLE",
    ),
    search,
    sort:
      readOptionalChoice(
        input.sort,
        COMMUNITY_ROOM_SORTS,
        "COMMUNITY_ROOM_INVALID_SORT",
      ) ?? "activity",
    topic: readOptionalChoice(
      input.topic,
      COMMUNITY_ROOM_TOPICS,
      "COMMUNITY_ROOM_INVALID_TOPIC",
    ),
    theme: readOptionalChoice(
      input.theme,
      COMMUNITY_ROOM_THEME_OPTIONS,
      "COMMUNITY_ROOM_INVALID_THEMES",
    ) as CommunityRoomTheme | null,
  };
}

export function normalizeCommunityRoomSlug(value: unknown) {
  const slug = readTrimmedString(value).toLowerCase();
  if (
    slug.length < 8 ||
    slug.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_NOT_FOUND",
      "That Community Room is unavailable.",
      404,
    );
  }
  return slug;
}

export function getCommunityRoomSlugOrNull(value: unknown) {
  try {
    return normalizeCommunityRoomSlug(value);
  } catch {
    return null;
  }
}

export function createCommunityRoomSlug(name: string, suffix: string) {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "community";
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizeCommunityRoomSlug(`${base}-${safeSuffix}`);
}

export function getCommunityRoomTopicLabel(value: CommunityRoomTopic) {
  return readLabel(COMMUNITY_ROOM_TOPICS, value);
}

export function getCommunityRoomStyleLabel(value: CommunityRoomStyle) {
  return readLabel(COMMUNITY_ROOM_STYLES, value);
}

export function getCommunityRoomFocusLabel(value: CommunityRoomFocusTag) {
  return readLabel(COMMUNITY_ROOM_FOCUS_TAGS, value);
}

export function getCommunityRoomLanguageLabel(
  value: CommunityRoomLanguage,
) {
  return readLabel(COMMUNITY_ROOM_LANGUAGES, value);
}

export function getCommunityRoomThemeLabel(value: CommunityRoomTheme) {
  return readLabel(COMMUNITY_ROOM_THEME_OPTIONS, value);
}

export function getCommunityRoomIndustryLabel(
  value: CommunityRoomIndustry,
) {
  return readLabel(COMMUNITY_ROOM_INDUSTRY_OPTIONS, value);
}

export const getCommunityTopicLabel = getCommunityRoomTopicLabel;
export const getCommunityFocusTagLabel = getCommunityRoomFocusLabel;
export const getCommunityLanguageLabel = getCommunityRoomLanguageLabel;

function assertPlainRoomText(
  value: string,
  minLength: number,
  maxLength: number,
  code: string,
  message: string,
) {
  if (
    value.length < minLength ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    blockedRoomTextPattern.test(value)
  ) {
    throw new LiveRoomPolicyError(code, message);
  }
}

function readChoice<
  T extends readonly { label: string; value: string }[],
>(
  value: unknown,
  choices: T,
  code: string,
  message: string,
) {
  const normalized = readTrimmedString(value);
  if (!choices.some((choice) => choice.value === normalized)) {
    throw new LiveRoomPolicyError(code, message);
  }
  return normalized as T[number]["value"];
}

function readOptionalChoice<
  T extends readonly { label: string; value: string }[],
>(
  value: unknown,
  choices: T,
  code: string,
) {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readChoice(value, choices, code, "Choose a valid filter.");
}

function readChoiceArray<
  T extends readonly { label: string; value: string }[],
>(
  value: unknown,
  choices: T,
  minLength: number,
  maxLength: number,
  code: string,
  message: string,
) {
  const values = [
    ...new Set(
      (Array.isArray(value) ? value : []).map(readTrimmedString),
    ),
  ];
  if (
    values.length < minLength ||
    values.length > maxLength ||
    values.some(
      (item) => !choices.some((choice) => choice.value === item),
    )
  ) {
    throw new LiveRoomPolicyError(code, message);
  }
  return values as T[number]["value"][];
}

function readLabel<
  T extends readonly { label: string; value: string }[],
>(choices: T, value: T[number]["value"]) {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const normalized = readTrimmedString(value);
  return normalized || null;
}
