export type LiveRoomPostQueryCursor = {
  createdAt: string;
  id: string;
};

export type LiveRoomPostQueryRoom = {
  id: string;
  kind: "company" | "community";
  ticker: string | null;
};

export function applyLiveRoomPostScopeAndCursorFilters({
  ascending,
  cursor,
  includeMentionedCompanyPosts,
  room,
  search,
}: {
  ascending: boolean;
  cursor: LiveRoomPostQueryCursor | null;
  includeMentionedCompanyPosts: boolean;
  room: LiveRoomPostQueryRoom | null;
  search: Record<string, string>;
}) {
  const companyCrossPostScope =
    room?.kind === "company" &&
    room.ticker &&
    includeMentionedCompanyPosts
      ? `or(room_id.eq.${room.id},related_tickers.cs.{${room.ticker}})`
      : null;
  const cursorScope = cursor
    ? ascending
      ? `or(created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`
      : `or(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`
    : null;

  if (room && !companyCrossPostScope) {
    search.room_id = `eq.${room.id}`;
  }

  if (companyCrossPostScope) {
    search.select +=
      ",source_room:live_room_rooms!inner(room_kind)";
    search["source_room.room_kind"] = "eq.company";
  }

  if (companyCrossPostScope && cursorScope) {
    search.and = `(${companyCrossPostScope},${cursorScope})`;
  } else if (companyCrossPostScope) {
    search.or = `(${companyCrossPostScope.slice(3, -1)})`;
  } else if (cursorScope) {
    search.or = `(${cursorScope.slice(3, -1)})`;
  }
}

export function shouldExposeLiveRoomCompanyPost({
  currentTicker,
  relatedTickers,
  sourceRoomKind,
  sourceTicker,
}: {
  currentTicker: string;
  relatedTickers: readonly string[];
  sourceRoomKind: "company" | "community";
  sourceTicker: string | null;
}) {
  return (
    sourceRoomKind === "company" &&
    (sourceTicker === currentTicker || relatedTickers.includes(currentTicker))
  );
}
