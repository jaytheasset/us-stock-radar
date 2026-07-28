import "server-only";

import { randomBytes } from "node:crypto";
import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE,
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_INDUSTRY_OPTIONS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_SORTS,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_THEME_OPTIONS,
  COMMUNITY_ROOM_TOPICS,
  createCommunityRoomSlug,
  normalizeCommunityRoomCreateInput,
  normalizeCommunityRoomDirectoryFilters,
  normalizeCommunityRoomSlug,
  type CommunityRoom,
  type CommunityRoomCreateInput,
  type CommunityRoomDirectoryFilters,
  type CommunityRoomDirectoryPage,
  type CommunityRoomFocusTag,
  type CommunityRoomLanguage,
  type CommunityRoomIndustry,
  type CommunityRoomSort,
  type CommunityRoomStyle,
  type CommunityRoomTheme,
  type CommunityRoomTopic,
} from "./community";
import {
  LiveRoomPolicyError,
  type LiveRoomActor,
} from "./policy";

type CommunityCursor = {
  at: string;
  slug: string;
  sort: CommunityRoomSort;
};

export async function createCommunityRoom(
  actor: LiveRoomActor,
  rawInput: unknown,
): Promise<CommunityRoom> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_MEMBER_REQUIRED",
      "Sign in to create a Community Room.",
      401,
    );
  }

  const input = normalizeCommunityRoomCreateInput(rawInput);
  await ensureUserBootstrap({ id: actor.userId, email: actor.email });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = createCommunityRoomSlug(
      input.name,
      randomBytes(4).toString("hex"),
    );
    const result = await supabaseRpc(
      "create_live_room_community_room",
      {
        p_focus_tags: input.focusTags,
        p_industries: input.industries,
        p_language: input.language,
        p_name: input.name,
        p_owner_user_id: actor.userId,
        p_related_tickers: input.relatedTickers,
        p_room_style: input.roomStyle,
        p_slug: slug,
        p_summary: input.summary,
        p_themes: input.themes,
        p_topic: input.topic,
      },
    );

    if (result.ok) {
      return mapCommunityRoom(result.data);
    }
    if (
      String(result.error || "").includes(
        "COMMUNITY_ROOM_SLUG_TAKEN",
      )
    ) {
      continue;
    }
    throw mapCommunityRoomDatabaseError(result.error, result.status);
  }

  throw new LiveRoomPolicyError(
    "COMMUNITY_ROOM_SLUG_TAKEN",
    "A unique room address could not be reserved. Try again.",
    409,
  );
}

export async function getCommunityRoom(
  rawSlug: unknown,
): Promise<CommunityRoom> {
  const slug = normalizeCommunityRoomSlug(rawSlug);
  const result = await supabaseRpc("get_live_room_community_room", {
    p_slug: slug,
  });
  const row = readRecord(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_NOT_FOUND",
      "That Community Room is unavailable.",
      404,
    );
  }
  return mapCommunityRoom(row);
}

export async function getCommunityRoomIdentity(
  rawSlug: unknown,
): Promise<{ id: string; slug: string }> {
  const slug = normalizeCommunityRoomSlug(rawSlug);
  const result = await supabaseSelect("live_room_community_rooms", {
    select: "room_id,slug",
    slug: `eq.${slug}`,
    limit: "1",
  });
  const row = readRecord(result.data);
  const id = readString(row?.room_id);
  if (!result.ok || !row || !isUuid(id)) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_NOT_FOUND",
      "That Community Room is unavailable.",
      404,
    );
  }
  return { id, slug };
}

export async function listCommunityRooms(
  rawFilters: unknown,
): Promise<CommunityRoomDirectoryPage> {
  const filters = normalizeCommunityRoomDirectoryFilters(rawFilters);
  const cursor = decodeCommunityCursor(filters.cursor, filters.sort);
  const result = await supabaseRpc(
    "list_live_room_community_rooms",
    {
      p_after_at: cursor?.at ?? null,
      p_after_slug: cursor?.slug ?? null,
      p_focus_tag: filters.focusTag,
      p_industry: filters.industry,
      p_language: filters.language,
      p_limit: COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE,
      p_room_style: filters.roomStyle,
      p_search: filters.search || null,
      p_sort: filters.sort,
      p_topic: filters.topic,
      p_theme: filters.theme,
    },
  );
  if (!result.ok) {
    throw mapCommunityRoomDatabaseError(result.error, result.status);
  }

  const rows = readRows(result.data);
  const hasMore = rows.length > COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE;
  const items = rows
    .slice(0, COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE)
    .map(mapCommunityRoom);
  const last = items[items.length - 1];

  return {
    filters,
    items,
    nextCursor:
      hasMore && last
        ? encodeCommunityCursor({
            at:
              filters.sort === "newest"
                ? last.createdAt
                : last.lastActivityAt,
            slug: last.slug,
            sort: filters.sort,
          })
        : null,
  };
}

export function communityFiltersToSearchParams(
  filters: CommunityRoomDirectoryFilters,
  options: { includeCursor?: boolean } = {},
) {
  const search = new URLSearchParams();
  if (filters.topic) search.set("topic", filters.topic);
  if (filters.roomStyle) search.set("style", filters.roomStyle);
  if (filters.focusTag) search.set("tag", filters.focusTag);
  if (filters.theme) search.set("theme", filters.theme);
  if (filters.industry) search.set("industry", filters.industry);
  if (filters.language) search.set("language", filters.language);
  if (filters.search) search.set("q", filters.search);
  if (filters.sort !== "activity") search.set("sort", filters.sort);
  if (options.includeCursor && filters.cursor) {
    search.set("cursor", filters.cursor);
  }
  return search;
}

function mapCommunityRoomDatabaseError(
  error: string | undefined,
  status: number,
) {
  const value = error || "";
  const mappings: Record<string, [string, string, number]> = {
    COMMUNITY_ROOM_CREATE_RATE_LIMIT: [
      "COMMUNITY_ROOM_CREATE_RATE_LIMIT",
      "Too many rooms were created recently. Try again later.",
      429,
    ],
    COMMUNITY_ROOM_INVALID_FOCUS_TAGS: [
      "COMMUNITY_ROOM_INVALID_FOCUS_TAGS",
      "Choose between 1 and 3 focus tags.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_LANGUAGE: [
      "COMMUNITY_ROOM_INVALID_LANGUAGE",
      "Choose one room language.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_INDUSTRIES: [
      "COMMUNITY_ROOM_INVALID_INDUSTRIES",
      "Choose up to 3 canonical industries.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_NAME: [
      "COMMUNITY_ROOM_INVALID_NAME",
      "Enter a plain-text room name without links or HTML.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_RELATED_TICKERS: [
      "COMMUNITY_ROOM_INVALID_RELATED_TICKERS",
      "Add up to 5 valid related tickers.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_THEMES: [
      "COMMUNITY_ROOM_INVALID_THEMES",
      "Choose up to 3 canonical market themes.",
      400,
    ],
    COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED: [
      "COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED",
      "Choose at least one ticker, theme, or industry.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_SEARCH: [
      "COMMUNITY_ROOM_INVALID_SEARCH",
      "The Community Room search is invalid.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_STYLE: [
      "COMMUNITY_ROOM_INVALID_STYLE",
      "Choose one room style.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_SUMMARY: [
      "COMMUNITY_ROOM_INVALID_SUMMARY",
      "Enter a plain-text one-line description without links or HTML.",
      400,
    ],
    COMMUNITY_ROOM_INVALID_TOPIC: [
      "COMMUNITY_ROOM_INVALID_TOPIC",
      "Choose one room topic.",
      400,
    ],
    COMMUNITY_ROOM_MEMBER_REQUIRED: [
      "COMMUNITY_ROOM_MEMBER_REQUIRED",
      "Sign in to create a Community Room.",
      401,
    ],
  };
  const match = Object.entries(mappings).find(([code]) =>
    value.includes(code),
  );
  if (match) {
    const [code, message, mappedStatus] = match[1];
    return new LiveRoomPolicyError(code, message, mappedStatus);
  }
  return new LiveRoomPolicyError(
    "COMMUNITY_ROOM_UNAVAILABLE",
    "Community Rooms are temporarily unavailable.",
    status || 502,
  );
}

function mapCommunityRoom(value: unknown): CommunityRoom {
  const row = readRecord(value);
  if (!row) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_UNAVAILABLE",
      "The Community Room response was invalid.",
      502,
    );
  }

  const topic = readChoice(
    row.topic,
    COMMUNITY_ROOM_TOPICS,
  ) as CommunityRoomTopic;
  const roomStyle = readChoice(
    row.roomStyle ?? row.room_style,
    COMMUNITY_ROOM_STYLES,
  ) as CommunityRoomStyle;
  const language = readChoice(
    row.language,
    COMMUNITY_ROOM_LANGUAGES,
  ) as CommunityRoomLanguage;
  const focusTags = readChoiceArray(
    row.focusTags ?? row.focus_tags,
    COMMUNITY_ROOM_FOCUS_TAGS,
  ) as CommunityRoomFocusTag[];
  const slug = normalizeCommunityRoomSlug(row.slug);
  const createdAt = readDate(row.createdAt ?? row.created_at);
  const lastActivityAt = readDate(
    row.lastActivityAt ?? row.last_activity_at,
  );
  const name = readString(row.name).trim();
  const summary = readString(row.summary).trim();
  const rawRelatedTickers = row.relatedTickers ?? row.related_tickers;
  const relatedTickers = (
    Array.isArray(rawRelatedTickers) ? rawRelatedTickers : []
  )
    .map(readString)
    .filter((ticker) => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker))
    .slice(0, 5);
  const themes = readChoiceArray(
    row.themes,
    COMMUNITY_ROOM_THEME_OPTIONS,
  ).slice(0, 3) as CommunityRoomTheme[];
  const industries = readChoiceArray(
    row.industries,
    COMMUNITY_ROOM_INDUSTRY_OPTIONS,
  ).slice(0, 3) as CommunityRoomIndustry[];

  if (!name || !summary || !createdAt || !lastActivityAt) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_UNAVAILABLE",
      "The Community Room response was incomplete.",
      502,
    );
  }

  return {
    createdAt,
    focusTags,
    industries,
    language,
    lastActivityAt,
    name,
    relatedTickers,
    roomStyle,
    slug,
    summary,
    themes,
    topic,
  };
}

function encodeCommunityCursor(value: CommunityCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url",
  );
}

function decodeCommunityCursor(
  value: string | null,
  sort: CommunityRoomSort,
): CommunityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CommunityCursor>;
    if (
      parsed.sort !== sort ||
      typeof parsed.at !== "string" ||
      !Number.isFinite(Date.parse(parsed.at)) ||
      typeof parsed.slug !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return {
      at: parsed.at,
      slug: normalizeCommunityRoomSlug(parsed.slug),
      sort,
    };
  } catch {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_INVALID_CURSOR",
      "The Community Room page cursor is invalid.",
    );
  }
}

function readChoice(
  value: unknown,
  choices: readonly { label: string; value: string }[],
) {
  const normalized = readString(value);
  if (!choices.some((choice) => choice.value === normalized)) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_UNAVAILABLE",
      "The Community Room response was invalid.",
      502,
    );
  }
  return normalized;
}

function readChoiceArray(
  value: unknown,
  choices: readonly { label: string; value: string }[],
) {
  if (!Array.isArray(value)) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_UNAVAILABLE",
      "The Community Room response was invalid.",
      502,
    );
  }
  const values = value.map(readString);
  if (
    values.some(
      (item) => !choices.some((choice) => choice.value === item),
    )
  ) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_UNAVAILABLE",
      "The Community Room response was invalid.",
      502,
    );
  }
  return values;
}

function readDate(value: unknown) {
  const normalized = readString(value);
  return Number.isFinite(Date.parse(normalized)) ? normalized : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const [first] = value;
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object",
      )
    : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
