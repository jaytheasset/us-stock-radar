import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  KlipyProviderError,
  normalizeKlipySearchInput,
  parseKlipyResponse,
} from "./policy.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const validResult = {
  content_description: "Stocks going up",
  id: "klipy_123",
  itemurl: "https://klipy.com/gifs/stocks",
  media_formats: {
    mediumgif: {
      dims: [640, 360],
      url: "https://static.klipy.com/abc/stock.gif",
    },
    tinygifpreview: {
      dims: [220, 124],
      url: "https://static.klipy.com/abc/stock-preview.gif",
    },
  },
  title: "Stock market",
};

test("KLIPY parser returns the public-safe DTO and cursor", () => {
  const page = parseKlipyResponse({
    next: "cursor:2",
    results: [validResult],
  });
  assert.equal(page.provider, "klipy");
  assert.equal(page.nextCursor, "cursor:2");
  assert.deepEqual(page.items[0], {
    alt: "Stocks going up",
    aspect: 640 / 360,
    description: "Stocks going up",
    displayUrl: "https://static.klipy.com/abc/stock.gif",
    height: 360,
    itemUrl: "https://klipy.com/gifs/stocks",
    kind: "gif",
    previewUrl: "https://static.klipy.com/abc/stock-preview.gif",
    provider: "klipy",
    providerMediaId: "klipy_123",
    title: "Stock market",
    width: 640,
  });
  assert.doesNotMatch(JSON.stringify(page), /tags|key|media_formats/);
});

test("KLIPY parser rejects missing formats, malicious URLs, HTTP and oversized dimensions", () => {
  const variants = [
    { ...validResult, media_formats: {} },
    {
      ...validResult,
      media_formats: {
        ...validResult.media_formats,
        mediumgif: {
          dims: [640, 360],
          url: "https://evil.example/stock.gif",
        },
      },
    },
    {
      ...validResult,
      media_formats: {
        ...validResult.media_formats,
        mediumgif: {
          dims: [640, 360],
          url: "http://static.klipy.com/stock.gif",
        },
      },
    },
    {
      ...validResult,
      media_formats: {
        ...validResult.media_formats,
        mediumgif: {
          dims: [5000, 360],
          url: "https://static.klipy.com/stock.gif",
        },
      },
    },
  ];
  for (const result of variants) {
    assert.equal(parseKlipyResponse({ results: [result] }).items.length, 0);
  }
  assert.throws(
    () => parseKlipyResponse({ nope: [] }),
    (error) =>
      error instanceof KlipyProviderError &&
      error.code === "KLIPY_RESPONSE_INVALID",
  );
});

test("KLIPY search policy enforces minimum query and bounded defaults", () => {
  assert.deepEqual(normalizeKlipySearchInput({}), {
    cursor: null,
    limit: 15,
    query: "",
  });
  assert.equal(normalizeKlipySearchInput({ limit: 999 }).limit, 18);
  assert.throws(
    () => normalizeKlipySearchInput({ query: "a" }),
    (error) =>
      error instanceof KlipyProviderError &&
      error.code === "KLIPY_QUERY_TOO_SHORT",
  );
});

test("provider and route keep the API key server-only and normalize failures", () => {
  const provider = read("lib/klipy/serverProvider.ts");
  const route = read("app/api/media/klipy/search/route.ts");
  const rate = read("lib/klipy/serverRateLimit.ts");
  assert.match(provider, /https:\/\/api\.klipy\.com\/v2/);
  assert.match(provider, /CONTENT_FILTER = "high"/);
  assert.match(provider, /AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/);
  assert.match(provider, /MAX_RESPONSE_BYTES = 1_000_000/);
  assert.match(provider, /\/posts/);
  assert.match(route, /assertSameOriginAuthRequest/);
  assert.match(route, /sec-fetch-site"\) === "same-origin"/);
  assert.match(route, /actor\.kind !== "member"/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.match(route, /Retry-After/);
  assert.match(rate, /MEMBER_LIMIT = 20/);
  assert.match(rate, /GLOBAL_LIMIT = 90/);
  assert.doesNotMatch(route, /KLIPY_API_KEY|apiKey|key=/);
});

test("composer and timeline implement picker, attribution, media-only and reply preview contracts", () => {
  const picker = read("components/klipy/KlipyPicker.tsx");
  const composer = read("components/live-room/MessageComposer.tsx");
  const timeline = read("components/live-room/ChatTimeline.tsx");
  const clients = [
    read("components/live-room/LiveRoomClient.tsx"),
    read("components/live-room/CommunityRoomClient.tsx"),
  ].join("\n");
  assert.match(picker, /placeholder="Search KLIPY"/);
  assert.match(picker, /Powered by KLIPY/);
  assert.match(picker, /425/);
  assert.match(picker, /AbortController/);
  assert.match(picker, /requestAnimationFrame/);
  assert.match(picker, /focus\(\{ preventScroll: true \}\)/);
  assert.match(picker, /BottomSheetShell/);
  assert.match(composer, /KlipySelectedMedia/);
  assert.match(timeline, /KlipyMessageMedia/);
  assert.match(timeline, /KlipyReplyMedia/);
  assert.match(timeline, /item\.body \? <p>/);
  assert.match(clients, /allowEmpty: Boolean\(klipyMedia\)/);
  assert.match(clients, /mediaId: klipyMedia\?\.providerMediaId/);
  assert.match(clients, /setKlipyMedia\(null\)/);
  assert.equal((clients.match(/if \(!profile \|\| sending\) return;/g) || []).length, 2);
  assert.match(composer, /disabled=\{disabled \|\| sending\}/);
});

test("message writes resolve a provider id and use one atomic DB wrapper", () => {
  const repository = read("lib/live-room/serverRepository.ts");
  const migration = read(
    "supabase/migrations/20260730122220_live_room_klipy_media.sql",
  );
  assert.match(repository, /resolveKlipyMedia\(rawMediaId\)/);
  assert.match(repository, /insert_live_room_message_with_attachments/);
  assert.doesNotMatch(repository, /displayUrl:\s*raw|previewUrl:\s*raw/);
  assert.match(migration, /create table public\.live_room_message_media/);
  assert.match(migration, /message_id uuid primary key/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table[\s\S]*anon, authenticated/);
  assert.match(migration, /grant select, insert, delete[\s\S]*service_role/);
  assert.match(migration, /p_allow_empty/);
  assert.match(migration, /LIVE_ROOM_ATTACHMENT_CONFLICT/);
  assert.match(migration, /insert_live_room_message_with_attachments/);
  assert.match(migration, /content_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
});
