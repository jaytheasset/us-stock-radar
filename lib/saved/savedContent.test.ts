import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  contentTypeForSavedTab,
  isSavedContentType,
  normalizeSavedContentTab,
} from "./types.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("Saved content types and tabs stay explicit", () => {
  assert.equal(isSavedContentType("news"), true);
  assert.equal(isSavedContentType("filing"), true);
  assert.equal(isSavedContentType("live_room_post"), true);
  assert.equal(isSavedContentType("calendar"), false);
  assert.equal(contentTypeForSavedTab("posts"), "live_room_post");
  assert.equal(normalizeSavedContentTab("unknown"), "all");
});

test("Saved migration is private, user-scoped, indexed, and idempotent", () => {
  const migration = read("supabase/migrations/20260801111801_saved_content.sql");
  assert.match(migration, /on delete cascade/i);
  assert.match(migration, /unique \(user_id, content_type, content_id\)/i);
  assert.match(migration, /content_type in \('news', 'filing', 'live_room_post'\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.saved_content from public, anon, authenticated/i,
  );
  assert.match(migration, /grant select, insert, delete on table public\.saved_content to authenticated/i);
  assert.match(migration, /\(select auth\.uid\(\)\) = user_id/g);
  assert.doesNotMatch(migration, /grant update/i);
});

test("Saved mutations preserve same-origin auth, ownership, and idempotency", () => {
  const route = read("app/api/saved/[contentType]/[contentId]/route.ts");
  assert.match(route, /assertSameOriginAuthRequest\(request\)/g);
  assert.match(route, /getOptionalCurrentUserId\(\)/g);
  assert.match(route, /onConflict: "user_id,content_type,content_id"/);
  assert.match(route, /user_id: `eq\.\$\{userId\}`/g);
  assert.match(route, /getLiveRoomPost\(resolution\.actor, contentId\)/);
});

test("Watchlist, Save, and Follow Event remain separate actions", () => {
  const savedButton = read("components/actions/SavedContentButton.tsx");
  const watchlistButton = read("components/actions/WatchlistButton.tsx");
  const actionStyles = read("components/actions/ContentActionButtons.module.css");
  const calendar = read("components/calendar-v1/CalendarEventDetail.tsx");
  const dashboardDetail = read("components/dashboard-v2/TickerDetailContent.tsx");
  const filingsDetail = read("components/filings-v2/FilingsV2Detail.tsx");
  const stockPage = read("components/watchlist-v2/StockRadarWatchlistV2.tsx");

  assert.match(savedButton, /Bookmark/);
  assert.doesNotMatch(savedButton, /localStorage/);
  assert.match(watchlistButton, /Star/);
  assert.match(calendar, /Bell/);
  assert.match(calendar, /Star/);
  assert.doesNotMatch(calendar, /SavedContentButton|Bookmark/);
  assert.match(stockPage, /Star/);
  assert.doesNotMatch(stockPage, /SavedContentButton/);
  for (const watchlistSurface of [dashboardDetail, filingsDetail]) {
    assert.match(watchlistSurface, /Star/);
    assert.doesNotMatch(watchlistSurface, /Bookmark/);
  }
  assert.match(
    actionStyles,
    /\.button \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*border: 0;[\s\S]*color: var\(--sr-color-text-control-strong\);[\s\S]*background: transparent;/,
  );
  assert.match(
    actionStyles,
    /\.button\[aria-pressed="true"\] \{[\s\S]*color: var\(--sr-color-accent-text\);[\s\S]*background: var\(--sr-color-accent-selected\);/,
  );
  assert.doesNotMatch(actionStyles, /var\(--sr-color-warning\)/);
});

test("Feed actions are preview-only and Live Room saves posts, not messages", () => {
  const feed = read("components/feed-v2/StockRadarFeedV2.tsx");
  const newsPreview = read("components/feed-v2/FeedCompanyNewsPreview.tsx");
  const filingPreview = read("components/feed-v2/FeedFilingPreview.tsx");
  const posts = read("components/live-room/PostsPanel.tsx");
  const postDetail = read("components/live-room/PostDetailClient.tsx");
  const messages = read("components/live-room/ChatTimeline.tsx");

  assert.doesNotMatch(feed, /SavedContentButton|WatchlistButton/);
  for (const preview of [newsPreview, filingPreview]) {
    assert.match(preview, /SavedContentButton/);
    assert.match(preview, /WatchlistButton/);
  }
  assert.match(posts, /contentType="live_room_post"/);
  assert.match(postDetail, /contentType="live_room_post"/);
  assert.doesNotMatch(messages, /SavedContentButton/);
});

test("Saved page uses server pagination and account navigation only", () => {
  const page = read("app/saved/page.tsx");
  const server = read("lib/saved/server.ts");
  const accountMenu = read("components/AuthStatus.tsx");
  const shell = read("components/shell/StockRadarAppShell.tsx");

  assert.match(page, /getSavedContentPage/);
  assert.match(server, /pageSize = 20/);
  assert.match(accountMenu, /href="\/saved"/);
  assert.doesNotMatch(shell, /href="\/saved"/);
});
