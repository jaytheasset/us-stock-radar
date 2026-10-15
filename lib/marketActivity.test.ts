import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketActivityIndexItems,
  formatMarketActivityElapsed,
  normalizeMarketActivityChatRows,
} from "./marketActivity.ts";

test("market activity indices omit incomplete cache rows instead of showing placeholders", () => {
  const items = buildMarketActivityIndexItems(
    new Map([
      ["^GSPC", { changePercent: 1.25, price: 6400.5, provider: "fmp" }],
      ["^NDX", { price: 23000, previousClose: 22500, provider: "polygon" }],
      ["^DJI", { changePercent: -0.2, provider: "fmp" }],
    ]),
  );

  assert.deepEqual(
    items.map((item) => item.symbol),
    ["^GSPC", "^NDX"],
  );
  assert.equal(items[1].changePercent, (500 / 22500) * 100);
});

test("public chat rows are route-safe, clipped to 60 characters, and reject malformed rooms", () => {
  const createdAt = "2026-08-09T13:00:00.000Z";
  const rows = normalizeMarketActivityChatRows([
    {
      body: `  ${"가".repeat(70)}  `,
      created_at: createdAt,
      room_kind: "company",
      ticker: "aapl",
    },
    {
      body: "A public community update",
      created_at: createdAt,
      room_kind: "community",
      room_name: "Semiconductor Research",
      slug: "semiconductor-research",
    },
    {
      body: "Must not escape the route",
      created_at: createdAt,
      room_kind: "community",
      room_name: "Unsafe",
      slug: "../private",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].href, "/live/AAPL");
  assert.equal(Array.from(rows[0].message).length, 60);
  assert.equal(rows[1].href, "/live/community/semiconductor-research");
});

test("elapsed labels remain compact for a one-line rail", () => {
  const now = Date.parse("2026-08-09T14:00:00.000Z");
  assert.equal(formatMarketActivityElapsed("2026-08-09T13:59:40.000Z", now), "now");
  assert.equal(formatMarketActivityElapsed("2026-08-09T13:31:00.000Z", now), "29m");
  assert.equal(formatMarketActivityElapsed("2026-08-09T11:00:00.000Z", now), "3h");
});

test("the chat activity RPC is service-only and applies every public safety gate", () => {
  const migration = readFileSync(
    "supabase/migrations/20260809090000_market_activity_public_chat_rail.sql",
    "utf8",
  );

  assert.match(migration, /security definer/i);
  assert.match(migration, /message\.visibility_status = 'visible'/i);
  assert.match(migration, /live_room_message_reports[\s\S]*report\.message_id = message\.id/i);
  assert.match(migration, /live_room_actor_blocks[\s\S]*block\.blocked_actor_id = message\.actor_id/i);
  assert.match(migration, /date_trunc\('day'[\s\S]*America\/New_York/i);
  assert.match(migration, /room\.room_kind = 'company'[\s\S]*room\.room_kind = 'community'/i);
  assert.doesNotMatch(migration, /from public\.live_room_direct_/i);
  assert.match(migration, /revoke all[\s\S]*from public/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});

test("Dow remains unavailable after FMP retirement; other activity uses the shared cache", () => {
  const refresh = readFileSync("lib/marketPulseRefresh.ts", "utf8");
  const server = readFileSync("lib/marketActivity.server.ts", "utf8");
  const route = readFileSync("app/api/market-activity/route.ts", "utf8");

  assert.match(refresh, /retiredSymbols = .*"\^DJI"/);
  assert.doesNotMatch(refresh, /refreshFmpQuote/);
  assert.match(route, /readMarketQuoteCacheMap/);
  assert.doesNotMatch(server, /financialmodelingprep|polygon\.io|fetch\(/i);
});
