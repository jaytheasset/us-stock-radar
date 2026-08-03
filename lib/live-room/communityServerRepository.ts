import "server-only";

import { randomBytes } from "node:crypto";
import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import type { Plan } from "@/lib/subscriptionPolicy";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import { normalizeLiveRoomTicker } from "./adapters";
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
  resolveCompanyLiveRoomDirectoryResult,
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
  type CompanyLiveRoomDirectoryResult,
} from "./community";
export type { CompanyLiveRoomDirectoryResult } from "./community";
import {
  COMMUNITY_ROOM_CREATE_WINDOW_MS,
  resolveCommunityRoomCreateEligibility,
  type CommunityRoomCreateEligibility,
} from "./communityCreateEligibility";
import {
  LiveRoomPolicyError,
  type LiveRoomActor,
} from "./policy";

type CommunityCursor = {
  at: string;
  slug: string;
  sort: CommunityRoomSort;
};

export async function getCommunityRoomCreateEligibility(
  actor: LiveRoomActor,
): Promise<CommunityRoomCreateEligibility> {
  if (actor.kind !== "member") {
    return resolveCommunityRoomCreateEligibility({
      effectivePlan: null,
      history: [],
      isMember: false,
    });
  }

  await ensureUserBootstrap({ id: actor.userId, email: actor.email });
  const now = new Date();
  const [stateResult, historyResult] = await Promise.all([
    supabaseRpc("get_live_room_community_creator_eligibility", {
      p_owner_user_id: actor.userId,
    }),
    supabaseSelect("live_room_community_rooms", {
      select: "slug,created_at",
      owner_user_id: `eq.${actor.userId}`,
      created_at: `gte.${new Date(
        now.getTime() - COMMUNITY_ROOM_CREATE_WINDOW_MS,
      ).toISOString()}`,
      order: "created_at.desc",
      limit: "6",
    }),
  ]);
  if (!stateResult.ok || !historyResult.ok) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_ELIGIBILITY_UNAVAILABLE",
      "Room-creation eligibility is temporarily unavailable.",
      stateResult.status || historyResult.status || 502,
    );
  }
  const state = readRecord(stateResult.data);
  const effectivePlan = readPlan(
    state?.effectivePlan ?? state?.effective_plan,
  );
  if (!state || !effectivePlan) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_ELIGIBILITY_UNAVAILABLE",
      "Room-creation eligibility is temporarily unavailable.",
      502,
    );
  }

  return resolveCommunityRoomCreateEligibility({
    effectivePlan,
    followerCount: readNonnegativeCount(
      state.followerCount ?? state.follower_count,
    ),
    history: readRows(historyResult.data).map((row) => ({
      createdAt: readDate(row.created_at),
      slug: readString(row.slug),
    })),
    isMember: true,
    now,
  });
}

export async function findCompanyLiveRoomDirectoryResult(
  rawSearch: unknown,
): Promise<CompanyLiveRoomDirectoryResult | null> {
  const ticker = normalizeLiveRoomTicker(rawSearch);
  if (!ticker) return null;

  const [roomLookup, registryLookup] = await Promise.allSettled([
    supabaseSelect("live_room_rooms", {
      select: "admin_status",
      room_kind: "eq.company",
      ticker: `eq.${ticker}`,
      limit: "1",
    }),
    supabaseSelect("tickers", {
      select: "symbol,name,exchange",
      symbol: `eq.${ticker}`,
      is_active: "eq.true",
      limit: "1",
    }),
  ]);
  const roomResult =
    roomLookup.status === "fulfilled" ? roomLookup.value : null;
  const registryResult =
    registryLookup.status === "fulfilled" ? registryLookup.value : null;
  const room = roomResult?.ok ? readRecord(roomResult.data) : null;
  const registry = registryResult?.ok
    ? readRecord(registryResult.data)
    : null;
  const registrySymbol = normalizeLiveRoomTicker(registry?.symbol);
  const resolution = resolveCompanyLiveRoomDirectoryResult({
    registry: {
      available: registryResult?.ok === true,
      companyName: readString(registry?.name) || null,
      exchange: readString(registry?.exchange) || null,
      exists: Boolean(registry) && registrySymbol === ticker,
    },
    room: {
      adminStatus: readString(room?.admin_status) || null,
      available: roomResult?.ok === true,
      exists: Boolean(room),
    },
    ticker,
  });
  if (resolution.status === "unavailable") {
    throw new LiveRoomPolicyError(
      "COMMUNITY_ROOM_COMPANY_LOOKUP_UNAVAILABLE",
      "The matching Company Live Room could not be checked.",
      roomResult?.status || registryResult?.status || 502,
    );
  }
  return resolution.status === "found" ? resolution.value : null;
}

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

  const eligibility = await getCommunityRoomCreateEligibility(actor);
  if (!eligibility.canCreate) {
    throw new LiveRoomPolicyError(
      eligibility.reason || "COMMUNITY_ROOM_UNAVAILABLE",
      eligibility.message,
      eligibility.reason === "COMMUNITY_ROOM_MEMBER_REQUIRED"
        ? 401
        : eligibility.reason === "COMMUNITY_ROOM_CREATE_COOLDOWN" ||
            eligibility.reason === "COMMUNITY_ROOM_CREATE_DAILY_LIMIT"
          ? 429
          : 403,
    );
  }

  const input = normalizeCommunityRoomCreateInput(rawInput);
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

  const rows = await filterArchivedCommunityRoomRows(
    readRows(result.data),
  );
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

async function filterArchivedCommunityRoomRows(
  rows: Array<Record<string, unknown>>,
) {
  const slugs = [
    ...new Set(rows.map((row) => readString(row.slug)).filter(Boolean)),
  ];
  if (!slugs.length) return rows;
  const communityResult = await supabaseSelect("live_room_community_rooms", {
    select: "room_id,slug",
    slug: `in.(${slugs.join(",")})`,
    limit: String(slugs.length),
  });
  if (!communityResult.ok) return rows;
  const communities = readRows(communityResult.data);
  const roomIds = communities
    .map((row) => readString(row.room_id))
    .filter(Boolean);
  if (!roomIds.length) return rows;
  const roomResult = await supabaseSelect("live_room_rooms", {
    select: "id,admin_status",
    id: `in.(${roomIds.join(",")})`,
    limit: String(roomIds.length),
  });
  if (!roomResult.ok) return rows;
  const archivedIds = new Set(
    readRows(roomResult.data)
      .filter((row) => readString(row.admin_status) === "archived")
      .map((row) => readString(row.id)),
  );
  const archivedSlugs = new Set(
    communities
      .filter((row) => archivedIds.has(readString(row.room_id)))
      .map((row) => readString(row.slug)),
  );
  return rows.filter((row) => !archivedSlugs.has(readString(row.slug)));
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
    COMMUNITY_ROOM_ADVANCED_REQUIRED: [
      "COMMUNITY_ROOM_ADVANCED_REQUIRED",
      "Creating a Community Room requires an Advanced or Ultimate plan.",
      403,
    ],
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
    COMMUNITY_ROOM_FOLLOWERS_REQUIRED: [
      "COMMUNITY_ROOM_FOLLOWERS_REQUIRED",
      "At least 100 active member followers are required to create a Community Room.",
      403,
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

function readNonnegativeCount(value: unknown) {
  const count =
    typeof value === "number" ? value : Number.parseInt(readString(value), 10);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function readPlan(value: unknown): Plan | null {
  const plan = readString(value);
  return plan === "free" ||
    plan === "ad_free" ||
    plan === "pro" ||
    plan === "advanced" ||
    plan === "ultimate"
    ? plan
    : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
