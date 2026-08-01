import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import type {
  SavedContentListItem,
  SavedContentPage,
  SavedContentReference,
  SavedContentTab,
  SavedContentType,
} from "@/lib/saved/types";
import { contentTypeForSavedTab } from "@/lib/saved/types";

type SavedRow = {
  content_id?: unknown;
  content_type?: unknown;
  created_at?: unknown;
  id?: unknown;
};

type EventRow = {
  id?: unknown;
  source_group?: unknown;
  ticker?: unknown;
  title?: unknown;
};

type PostRow = {
  author_user_id?: unknown;
  id?: unknown;
  related_tickers?: unknown;
  room_id?: unknown;
  title?: unknown;
  visibility_status?: unknown;
};

type RoomRow = {
  id?: unknown;
  room_kind?: unknown;
  ticker?: unknown;
};

type TickerRow = {
  name?: unknown;
  symbol?: unknown;
};

export type ViewerContentState = {
  authenticated: boolean;
  savedKeys: Set<string>;
  watchedTickers: Set<string>;
};

export async function getViewerContentState({
  references,
  tickers,
  userId,
}: {
  references: readonly SavedContentReference[];
  tickers: readonly string[];
  userId: string | null;
}): Promise<ViewerContentState> {
  if (!userId) {
    return {
      authenticated: false,
      savedKeys: new Set(),
      watchedTickers: new Set(),
    };
  }

  const uniqueReferences = dedupeReferences(references);
  const normalizedTickers = normalizeTickers(tickers);
  const [savedResult, watchlistResult] = await Promise.all([
    uniqueReferences.length
      ? supabaseSelect("saved_content", {
          select: "content_type,content_id",
          user_id: `eq.${userId}`,
          content_id: `in.(${uniqueReferences
            .map((reference) => reference.contentId)
            .join(",")})`,
          limit: String(Math.max(uniqueReferences.length, 1)),
        })
      : Promise.resolve({ ok: true, data: [] }),
    normalizedTickers.length
      ? supabaseSelect("watchlist_tickers", {
          select: "ticker",
          user_id: `eq.${userId}`,
          ticker: `in.(${normalizedTickers.join(",")})`,
          limit: String(normalizedTickers.length),
        })
      : Promise.resolve({ ok: true, data: [] }),
  ]);

  if (!savedResult.ok) {
    throw new Error(
      ("error" in savedResult && savedResult.error) ||
        "Failed to read saved content state.",
    );
  }
  if (!watchlistResult.ok) {
    throw new Error(
      ("error" in watchlistResult && watchlistResult.error) ||
        "Failed to read Watchlist state.",
    );
  }

  return {
    authenticated: true,
    savedKeys: new Set(
      readRows(savedResult.data)
        .map((row) => {
          const type = readString(row.content_type) as SavedContentType;
          const id = readString(row.content_id);
          return type && id ? savedContentKey(type, id) : "";
        })
        .filter(Boolean),
    ),
    watchedTickers: new Set(
      readRows(watchlistResult.data)
        .map((row) => normalizeTicker(row.ticker))
        .filter((ticker): ticker is string => Boolean(ticker)),
    ),
  };
}

export async function getSavedContentPage({
  page,
  pageSize = 20,
  tab,
  userId,
}: {
  page: number;
  pageSize?: number;
  tab: SavedContentTab;
  userId: string;
}): Promise<SavedContentPage> {
  const safePageSize = Math.min(50, Math.max(10, Math.trunc(pageSize)));
  const safePage = Math.max(1, Math.trunc(page));
  const contentType = contentTypeForSavedTab(tab);
  const result = await supabaseSelect("saved_content", {
    select: "id,content_type,content_id,created_at",
    user_id: `eq.${userId}`,
    ...(contentType ? { content_type: `eq.${contentType}` } : {}),
    order: "created_at.desc,id.desc",
    offset: String((safePage - 1) * safePageSize),
    limit: String(safePageSize),
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to read saved content.");
  }

  const rows = readRows(result.data) as SavedRow[];
  const totalCount = result.count ?? rows.length;
  const items = await hydrateSavedRows(userId, rows);

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safePageSize)),
  };
}

export async function isContentAvailable(
  contentType: SavedContentType,
  contentId: string,
) {
  if (contentType === "live_room_post") {
    const result = await supabaseSelect("live_room_posts", {
      select: "id",
      id: `eq.${contentId}`,
      visibility_status: "eq.visible",
      limit: "1",
    });
    return result.ok && readRows(result.data).length === 1;
  }

  const result = await supabaseSelect("events", {
    select: "id,source_group",
    id: `eq.${contentId}`,
    source_group: `eq.${contentType === "filing" ? "filings" : "news"}`,
    limit: "1",
  });
  return result.ok && readRows(result.data).length === 1;
}

export function savedContentKey(type: SavedContentType, id: string) {
  return `${type}:${id.toLowerCase()}`;
}

async function hydrateSavedRows(
  userId: string,
  savedRows: SavedRow[],
): Promise<SavedContentListItem[]> {
  const eventIds = savedRows
    .filter((row) => readString(row.content_type) !== "live_room_post")
    .map((row) => readString(row.content_id))
    .filter(Boolean);
  const postIds = savedRows
    .filter((row) => readString(row.content_type) === "live_room_post")
    .map((row) => readString(row.content_id))
    .filter(Boolean);

  const [eventsResult, postsResult, blocksResult] = await Promise.all([
    eventIds.length
      ? supabaseSelect("events", {
          select: "id,source_group,ticker,title",
          id: `in.(${eventIds.join(",")})`,
          limit: String(eventIds.length),
        })
      : Promise.resolve({ ok: true, data: [] }),
    postIds.length
      ? supabaseSelect("live_room_posts", {
          select:
            "id,room_id,author_user_id,title,related_tickers,visibility_status",
          id: `in.(${postIds.join(",")})`,
          visibility_status: "eq.visible",
          limit: String(postIds.length),
        })
      : Promise.resolve({ ok: true, data: [] }),
    postIds.length
      ? supabaseSelect("live_room_actor_blocks", {
          select: "blocked_member_user_id",
          blocker_kind: "eq.member",
          blocker_member_user_id: `eq.${userId}`,
          blocked_kind: "eq.member",
          limit: "200",
        })
      : Promise.resolve({ ok: true, data: [] }),
  ]);

  if (!eventsResult.ok || !postsResult.ok || !blocksResult.ok) {
    throw new Error("Saved content could not be checked safely.");
  }

  const blockedAuthors = new Set(
    readRows(blocksResult.data)
      .map((row) => readString(row.blocked_member_user_id))
      .filter(Boolean),
  );
  const events = new Map(
    (readRows(eventsResult.data) as EventRow[]).map((row) => [
      readString(row.id),
      row,
    ]),
  );
  const posts = new Map(
    (readRows(postsResult.data) as PostRow[])
      .filter((row) => !blockedAuthors.has(readString(row.author_user_id)))
      .map((row) => [readString(row.id), row]),
  );
  const roomIds = Array.from(
    new Set(
      Array.from(posts.values())
        .map((row) => readString(row.room_id))
        .filter(Boolean),
    ),
  );
  const roomsResult = roomIds.length
    ? await supabaseSelect("live_room_rooms", {
        select: "id,room_kind,ticker",
        id: `in.(${roomIds.join(",")})`,
        limit: String(roomIds.length),
      })
    : { ok: true, data: [] };
  if (!roomsResult.ok) throw new Error("Saved post rooms could not be checked safely.");
  const rooms = new Map(
    (readRows(roomsResult.data) as RoomRow[]).map((row) => [
      readString(row.id),
      row,
    ]),
  );

  const tickers = normalizeTickers([
    ...Array.from(events.values()).map((row) => readString(row.ticker)),
    ...Array.from(posts.values()).flatMap((row) => {
      const room = rooms.get(readString(row.room_id));
      return [readString(room?.ticker), ...readStringArray(row.related_tickers)];
    }),
  ]);
  const tickerResult = tickers.length
    ? await supabaseSelect("tickers", {
        select: "symbol,name",
        symbol: `in.(${tickers.join(",")})`,
        limit: String(tickers.length),
      })
    : { ok: true, data: [] };
  if (!tickerResult.ok) throw new Error("Saved content tickers are unavailable.");
  const companies = new Map(
    (readRows(tickerResult.data) as TickerRow[]).map((row) => [
      normalizeTicker(row.symbol) || "",
      readString(row.name) || null,
    ]),
  );

  return savedRows.map((savedRow) => {
    const contentId = readString(savedRow.content_id);
    const contentType = readString(savedRow.content_type) as SavedContentType;
    const savedAt = readString(savedRow.created_at);
    if (contentType === "live_room_post") {
      const post = posts.get(contentId);
      const room = post ? rooms.get(readString(post.room_id)) : null;
      const ticker = post
        ? normalizeTicker(room?.ticker) ||
          readStringArray(post.related_tickers)
            .map(normalizeTicker)
            .find(Boolean) ||
          null
        : null;
      return post
        ? {
            available: true,
            companyName: ticker ? companies.get(ticker) || null : null,
            contentId,
            contentType,
            href: `/live/posts/${contentId}`,
            savedAt,
            ticker,
            title: readString(post.title) || "Live Room post",
          }
        : unavailableItem(contentId, contentType, savedAt);
    }

    const event = events.get(contentId);
    const expectedGroup = contentType === "filing" ? "filings" : "news";
    if (!event || readString(event.source_group) !== expectedGroup) {
      return unavailableItem(contentId, contentType, savedAt);
    }
    const ticker = normalizeTicker(event.ticker);
    return {
      available: true,
      companyName: ticker ? companies.get(ticker) || null : null,
      contentId,
      contentType,
      href:
        contentType === "filing"
          ? `/filings/${contentId}`
          : `/events/${contentId}`,
      savedAt,
      ticker,
      title: readString(event.title) || "Saved market content",
    };
  });
}

function unavailableItem(
  contentId: string,
  contentType: SavedContentType,
  savedAt: string,
): SavedContentListItem {
  return {
    available: false,
    companyName: null,
    contentId,
    contentType,
    href: null,
    savedAt,
    ticker: null,
    title: "Content unavailable",
  };
}

function dedupeReferences(references: readonly SavedContentReference[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = savedContentKey(reference.contentType, reference.contentId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTickers(values: readonly string[]) {
  return Array.from(
    new Set(
      values
        .map(normalizeTicker)
        .filter((ticker): ticker is string => Boolean(ticker)),
    ),
  );
}

function normalizeTicker(value: unknown) {
  const ticker = readString(value).trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : null;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
