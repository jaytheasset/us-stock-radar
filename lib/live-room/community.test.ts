import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE,
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_INDUSTRY_OPTIONS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_TOPICS,
  COMMUNITY_ROOM_THEME_OPTIONS,
  createCommunityRoomSlug,
  getCommunityRoomSlugOrNull,
  normalizeCommunityRoomCreateInput,
  normalizeCommunityRoomDirectoryFilters,
} from "./community.ts";
import {
  COMMUNITY_ROOM_CREATE_LOGIN_HREF,
  resolveCommunityRoomCreateEligibility,
} from "./communityCreateEligibility.ts";

const root = process.cwd();
const communityMigrationPath =
  "docs/db/migration-archive/pre-canonical-baseline/20260727215804_live_room_community_rooms.sql";
const migration = read(communityMigrationPath);
const discoveryMigrationPath =
  "docs/db/migration-archive/pre-canonical-baseline/20260728034730_community_room_discovery_anchors.sql";
const discoveryMigration = read(discoveryMigrationPath);
const foundationMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727101129_live_room_realtime_foundation.sql",
);
const blockModerationMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727121025_fix_live_room_block_moderation.sql",
);
const communityRepository = read(
  "lib/live-room/communityServerRepository.ts",
);
const liveRoomRepository = read("lib/live-room/serverRepository.ts");
const communityRoute = read("app/api/live-room/community/route.ts");
const createEligibilityRoute = read(
  "app/api/live-room/community/create-eligibility/route.ts",
);
const communityMessagesRoute = read(
  "app/api/live-room/community/[slug]/messages/route.ts",
);
const communityReportsRoute = read(
  "app/api/live-room/community/[slug]/reports/route.ts",
);
const communityBlocksRoute = read(
  "app/api/live-room/community/[slug]/blocks/route.ts",
);
const communityModerationRoute = read(
  "app/api/live-room/community/[slug]/moderation/route.ts",
);
const directoryPage = read("app/live/page.tsx");
const createDialog = read(
  "components/live-room/CommunityRoomCreateDialog.tsx",
);
const communityStyles = read(
  "components/live-room/CommunityRooms.module.css",
);
const communityClient = read(
  "components/live-room/CommunityRoomClient.tsx",
);
const unreadMenu = read("components/shell/LiveRoomUnreadMenu.tsx");
const productHeader = read(
  "components/shell/StockRadarProductHeader.tsx",
);
const mobileNavigation = read(
  "components/shell/StockRadarMobileNavigationMenu.tsx",
);
const liveRoomClient = read(
  "components/live-room/LiveRoomClient.tsx",
);
const messageComposer = read(
  "components/live-room/MessageComposer.tsx",
);
const postsPanel = read("components/live-room/PostsPanel.tsx");

test("Community Room classification values are closed canonical allowlists", () => {
  assert.deepEqual(
    COMMUNITY_ROOM_TOPICS.map(({ value }) => value),
    [
      "market_macro",
      "sector_industry",
      "events_catalysts",
      "trading_strategy",
      "learning_qna",
      "creator_community",
    ],
  );
  assert.deepEqual(
    COMMUNITY_ROOM_STYLES.map(({ value }) => value),
    [
      "live_reaction",
      "deep_research",
      "beginner_friendly",
      "open_discussion",
    ],
  );
  assert.deepEqual(
    COMMUNITY_ROOM_LANGUAGES.map(({ value }) => value),
    ["en", "ko", "ja"],
  );
  assert.deepEqual(
    COMMUNITY_ROOM_FOCUS_TAGS.map(({ value }) => value),
    [
      "company_news",
      "sec_filings",
      "earnings",
      "fda_clinical",
      "dilution_listing",
      "legal_financial_risk",
      "macro_policy",
      "mna_strategy",
      "product_leadership",
    ],
  );
});

test("create validation requires structure, trims copy, and canonicalizes tickers", () => {
  assert.deepEqual(
    normalizeCommunityRoomCreateInput({
      focusTags: ["earnings", "macro_policy"],
      industries: ["capital_markets_exchanges"],
      language: "en",
      name: "  Earnings desk  ",
      relatedTickers: [" aapl ", "MSFT", "AAPL"],
      roomStyle: "deep_research",
      summary: "  Compare earnings quality across large caps.  ",
      themes: ["ai_data_center", "quantum_computing"],
      topic: "events_catalysts",
    }),
    {
      focusTags: ["earnings", "macro_policy"],
      industries: ["capital_markets_exchanges"],
      language: "en",
      name: "Earnings desk",
      relatedTickers: ["AAPL", "MSFT"],
      roomStyle: "deep_research",
      summary: "Compare earnings quality across large caps.",
      themes: ["ai_data_center", "quantum_computing"],
      topic: "events_catalysts",
    },
  );

  for (const missing of ["topic", "roomStyle", "language"] as const) {
    const input: Record<string, unknown> = {
      focusTags: ["earnings"],
      industries: [],
      language: "en",
      name: "Earnings desk",
      relatedTickers: [],
      roomStyle: "deep_research",
      summary: "Compare earnings quality across large caps.",
      themes: ["ai_data_center"],
      topic: "events_catalysts",
    };
    delete input[missing];
    assert.throws(() => normalizeCommunityRoomCreateInput(input));
  }
});

test("create validation rejects free tags, cardinality overflow, links, HTML, and multiline copy", () => {
  const valid = {
    focusTags: ["earnings"],
    industries: [],
    language: "en",
    name: "Earnings desk",
    relatedTickers: [],
    roomStyle: "deep_research",
    summary: "Compare earnings quality across large caps.",
    themes: ["ai_data_center"],
    topic: "events_catalysts",
  };
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      focusTags: [],
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      focusTags: [
        "earnings",
        "macro_policy",
        "company_news",
        "sec_filings",
      ],
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      focusTags: ["custom_tag"],
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      name: "<b>Join here</b>",
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      summary: "Read https://example.com before joining.",
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      summary: "Join the room at community.example.xyz now.",
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      summary: "Open javascript:alert(1) to continue.",
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      summary: "First line\nSecond line",
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      relatedTickers: ["A", "B", "C", "D", "E", "F"],
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      themes: ["ai_data_center", "bitcoin", "inflation", "short_squeeze"],
    }),
  );
  assert.throws(() =>
    normalizeCommunityRoomCreateInput({
      ...valid,
      industries: [
        "software_cloud",
        "biotechnology",
        "banks",
        "oil_gas_refining",
      ],
    }),
  );
});

test("discovery anchors use canonical themes and industry slugs", () => {
  assert.equal(
    COMMUNITY_ROOM_THEME_OPTIONS.some(
      (option) =>
        option.value === "quantum_computing" &&
        option.kind === "specific" &&
        option.groupSlug === "retail_momentum_flows",
    ),
    true,
  );
  assert.equal(
    COMMUNITY_ROOM_THEME_OPTIONS.some(
      (option) => option.value === "oil_supply_refining_margins",
    ),
    true,
  );
  assert.equal(
    COMMUNITY_ROOM_INDUSTRY_OPTIONS.some(
      (option) =>
        option.value === "oil_gas_refining" &&
        option.label === "Oil, Gas & Refining",
    ),
    true,
  );
  assert.doesNotThrow(() =>
    normalizeCommunityRoomCreateInput({
      focusTags: ["company_news"],
      industries: [],
      language: "en",
      name: "Quantum watch",
      relatedTickers: [],
      roomStyle: "live_reaction",
      summary: "Track quantum computing catalysts and market moves.",
      themes: ["quantum_computing"],
      topic: "sector_industry",
    }),
  );
  assert.throws(
    () =>
      normalizeCommunityRoomCreateInput({
        focusTags: ["company_news"],
        industries: [],
        language: "en",
        name: "Anchorless room",
        relatedTickers: [],
        roomStyle: "live_reaction",
        summary: "This room deliberately has no discovery anchor.",
        themes: [],
        topic: "sector_industry",
      }),
    /Choose at least one ticker, theme, or industry/,
  );
});

test("slugs are opaque canonical room identity rather than ticker identity", () => {
  const slug = createCommunityRoomSlug(
    "Market & Macro",
    "A1B2C3D4",
  );
  assert.equal(slug, "market-macro-a1b2c3d4");
  assert.equal(getCommunityRoomSlugOrNull(slug), slug);
  assert.equal(getCommunityRoomSlugOrNull("AAPL"), null);
  assert.equal(getCommunityRoomSlugOrNull("../admin"), null);
});

test("directory filters are closed, shareable, and page size is bounded to 20", () => {
  assert.equal(COMMUNITY_ROOM_DIRECTORY_PAGE_SIZE, 20);
  assert.deepEqual(
    normalizeCommunityRoomDirectoryFilters({
      q: "  macro data ",
      sort: "newest",
      style: "open_discussion",
      tag: "macro_policy",
      language: "ko",
      industry: "oil_gas_refining",
      theme: "oil_supply_refining_margins",
      topic: "market_macro",
    }),
    {
      cursor: null,
      focusTag: "macro_policy",
      industry: "oil_gas_refining",
      language: "ko",
      roomStyle: "open_discussion",
      search: "macro data",
      sort: "newest",
      topic: "market_macro",
      theme: "oil_supply_refining_margins",
    },
  );
  assert.throws(() =>
    normalizeCommunityRoomDirectoryFilters({ topic: "anything" }),
  );
  assert.throws(() =>
    normalizeCommunityRoomDirectoryFilters({ sort: "popular" }),
  );
  assert.throws(() =>
    normalizeCommunityRoomDirectoryFilters({ theme: "quantum" }),
  );
  assert.throws(() =>
    normalizeCommunityRoomDirectoryFilters({ industry: "oil" }),
  );
});

test("migration preserves company ticker uniqueness while adding nullable community identity", () => {
  assert.match(foundationMigration, /ticker text not null[\s\S]*unique \(ticker\)/i);
  assert.match(migration, /add column if not exists room_kind text not null default 'company'/i);
  assert.match(migration, /alter column ticker drop not null/i);
  assert.match(
    migration,
    /room_kind = 'company'[\s\S]*ticker is not null[\s\S]*room_kind = 'community'[\s\S]*ticker is null[\s\S]*issuer_id is null/i,
  );
  assert.match(
    liveRoomRepository,
    /room_kind: "eq\.company"[\s\S]*onConflict: "ticker"/,
  );
  assert.match(
    liveRoomRepository,
    /\{ room_kind: "company", ticker \}/,
  );
});

test("Community migration runs after the existing Live Room function migrations", () => {
  const migrationName = path.basename(communityMigrationPath);
  for (const priorMigration of [
    "20260727121025_fix_live_room_block_moderation.sql",
    "20260727151010_live_room_chat_follows_and_member_follows.sql",
    "20260727152803_live_room_member_activity.sql",
  ]) {
    assert.equal(
      migrationName > priorMigration,
      true,
      `${migrationName} must sort after ${priorMigration}`,
    );
  }
});

test("company Rooms and People activity exclude Community messages after room_kind exists", () => {
  const unreadFunction =
    migration.match(
      /function public\.get_live_room_unread_summary\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  const setMemberFollowFunction =
    migration.match(
      /function public\.set_live_room_member_follow\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  const markMemberReadFunction =
    migration.match(
      /function public\.mark_live_room_member_activity_read\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  const activityFunction =
    migration.match(
      /function public\.get_live_room_activity_summary\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";

  assert.match(unreadFunction, /where room\.room_kind = 'company'/i);
  assert.match(
    setMemberFollowFunction,
    /join public\.live_room_rooms as room[\s\S]+where room\.room_kind = 'company'/i,
  );
  assert.match(
    markMemberReadFunction,
    /join public\.live_room_rooms as room[\s\S]+where room\.room_kind = 'company'/i,
  );
  assert.equal(
    (activityFunction.match(/room\.room_kind = 'company'/gi) ?? []).length,
    3,
  );
  assert.doesNotMatch(activityFunction, /room\.room_kind = 'community'/i);

  // The 211500 functions are intentionally room-id scoped so block and
  // moderation behavior is shared by Company and Community Rooms.
  assert.doesNotMatch(
    blockModerationMigration,
    /join public\.live_room_rooms as room/i,
  );
});

test("Community Room metadata is default-deny with owner FK and covering indexes", () => {
  assert.match(
    migration,
    /owner_user_id uuid not null[\s\S]*references public\.user_profiles\(id\) on delete restrict/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_community_rooms enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all privileges[\s\S]*on table public\.live_room_community_rooms[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]*to service_role/i,
  );
  assert.match(
    migration,
    /live_room_community_rooms_owner_created_idx[\s\S]*\(owner_user_id, created_at desc\)/i,
  );
  assert.match(
    migration,
    /live_room_community_rooms_(activity|created)_idx/i,
  );
  assert.match(
    migration,
    /using gin \(focus_tags\)[\s\S]*using gin \(search_document\)/i,
  );
});

test("discovery migration preserves old rooms and validates new canonical arrays", () => {
  assert.match(
    discoveryMigration,
    /add column if not exists themes text\[\] not null default array\[\]::text\[\]/i,
  );
  assert.match(
    discoveryMigration,
    /add column if not exists industries text\[\] not null default array\[\]::text\[\]/i,
  );
  assert.match(
    discoveryMigration,
    /cardinality\(p_values\) between 0 and 3/gi,
  );
  assert.deepEqual(
    readSqlAllowlist("live_room_community_themes_valid").sort(),
    COMMUNITY_ROOM_THEME_OPTIONS.map((option) => option.value).sort(),
  );
  assert.deepEqual(
    readSqlAllowlist("live_room_community_industries_valid").sort(),
    COMMUNITY_ROOM_INDUSTRY_OPTIONS.map((option) => option.value).sort(),
  );
  assert.match(
    discoveryMigration,
    /live_room_community_rooms_themes_check[\s\S]*not valid/i,
  );
  assert.match(
    discoveryMigration,
    /live_room_community_rooms_industries_check[\s\S]*not valid/i,
  );
  assert.match(
    discoveryMigration,
    /cardinality\(v_related_tickers\) = 0[\s\S]*cardinality\(v_themes\) = 0[\s\S]*cardinality\(v_industries\) = 0[\s\S]*COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED/i,
  );
  assert.doesNotMatch(
    discoveryMigration,
    /add constraint\s+\w*discovery\w*/i,
  );
});

test("discovery migration filters through GIN indexes and keeps RPCs service-role only", () => {
  assert.match(
    discoveryMigration,
    /live_room_community_rooms_themes_gin_idx[\s\S]*using gin \(themes\)/i,
  );
  assert.match(
    discoveryMigration,
    /live_room_community_rooms_industries_gin_idx[\s\S]*using gin \(industries\)/i,
  );
  assert.equal(
    (
      discoveryMigration.match(
        /room\.themes @> array\[p_theme\]::text\[\]/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (
      discoveryMigration.match(
        /room\.industries @> array\[p_industry\]::text\[\]/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    discoveryMigration,
    /revoke all privileges[\s\S]*create_live_room_community_room\([\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    discoveryMigration,
    /grant execute[\s\S]*list_live_room_community_rooms\([\s\S]*to service_role/i,
  );
});

test("migration validates tag/ticker cardinality and plain text again inside PostgreSQL", () => {
  assert.match(migration, /cardinality\(p_values\) between 1 and 3/i);
  assert.match(migration, /cardinality\(p_values\) between 0 and 5/i);
  assert.match(migration, /count\(distinct tag\)/i);
  assert.match(migration, /count\(distinct ticker\)/i);
  assert.match(migration, /name !~\* '\(<\[\^>\]\*>/i);
  assert.match(migration, /summary !~ '\[\[:cntrl:\]\]'/i);
  assert.match(migration, /topic in \([\s\S]*'creator_community'/i);
  assert.match(migration, /language in \('en', 'ko', 'ja'\)/i);
});

test("creation is member-only, transactionally rate-limited, and collision-safe", () => {
  assert.match(communityRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(communityRoute, /resolveLiveRoomActor\(request\)/);
  assert.match(communityRepository, /actor\.kind !== "member"/);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /interval '5 minutes'/i);
  assert.match(migration, /interval '24 hours'/i);
  assert.match(migration, />= 5/);
  assert.match(migration, /when unique_violation[\s\S]*COMMUNITY_ROOM_SLUG_TAKEN/i);
  assert.match(communityRepository, /attempt < 4/);
  assert.doesNotMatch(communityRepository, /ownerUserId|owner_user_id[^:]/);
});

test("create entry routes guests through one safe login return without exposing owner input", () => {
  const guest = resolveCommunityRoomCreateEligibility({
    history: [],
    isMember: false,
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.equal(guest.canCreate, false);
  assert.equal(guest.reason, "COMMUNITY_ROOM_MEMBER_REQUIRED");
  assert.equal(
    guest.nextActionHref,
    "/login?next=%2Flive%3Fcreate%3Droom",
  );
  assert.equal(COMMUNITY_ROOM_CREATE_LOGIN_HREF, guest.nextActionHref);
  assert.match(
    createEligibilityRoute,
    /resolveLiveRoomActor\(request\)[\s\S]*getCommunityRoomCreateEligibility\(\s*resolution\.actor/,
  );
  assert.match(
    createDialog,
    /COMMUNITY_ROOM_MEMBER_REQUIRED[\s\S]*window\.location\.assign\([\s\S]*COMMUNITY_ROOM_CREATE_LOGIN_HREF/,
  );
  assert.match(directoryPage, /openOnLoad=\{openCreateOnLoad\}/);
  assert.doesNotMatch(
    createEligibilityRoute,
    /ownerUserId|owner_user_id|memberUserId|member_user_id/,
  );
});

test("signed-in ineligible members receive the exact cooldown or rolling-day condition", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const cooldown = resolveCommunityRoomCreateEligibility({
    history: [
      {
        createdAt: "2026-07-29T11:58:00.000Z",
        slug: "recent-room-1234",
      },
    ],
    isMember: true,
    now,
  });
  const dailyLimit = resolveCommunityRoomCreateEligibility({
    history: Array.from({ length: 5 }, (_, index) => ({
      createdAt: new Date(
        now.getTime() - (index + 1) * 60 * 60 * 1_000,
      ).toISOString(),
      slug: `daily-room-${index + 1000}`,
    })),
    isMember: true,
    now,
  });

  assert.equal(cooldown.reason, "COMMUNITY_ROOM_CREATE_COOLDOWN");
  assert.match(cooldown.message, /once every 5 minutes/i);
  assert.equal(
    cooldown.retryAt,
    "2026-07-29T12:03:00.000Z",
  );
  assert.equal(
    dailyLimit.reason,
    "COMMUNITY_ROOM_CREATE_DAILY_LIMIT",
  );
  assert.match(dailyLimit.message, /at most 5[\s\S]*rolling 24-hour/i);
  assert.match(createDialog, /24-hour creation limit reached/);
  assert.match(createDialog, /Creation cooldown is active/);
  assert.match(createDialog, /eligibility\.retryAt/);
});

test("eligible members receive the canonical form and success enters the new room", () => {
  const eligible = resolveCommunityRoomCreateEligibility({
    history: [
      {
        createdAt: "2026-07-29T11:00:00.000Z",
        slug: "older-room-1234",
      },
    ],
    isMember: true,
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.equal(eligible.canCreate, true);
  assert.equal(eligible.reason, null);
  assert.match(
    communityRepository,
    /owner_user_id:\s*`eq\.\$\{actor\.userId\}`[\s\S]*created_at:\s*`gte\./,
  );
  assert.match(
    createDialog,
    /eligibility\?\.canCreate[\s\S]*<form className=\{styles\.createForm\}[\s\S]*COMMUNITY_ROOM_TOPICS\.map[\s\S]*COMMUNITY_ROOM_FOCUS_TAGS\.map/,
  );
  assert.match(
    createDialog,
    /requestJson<CommunityRoom>[\s\S]*"\/api\/live-room\/community"[\s\S]*router\.push\(`\/live\/community\/\$\{encodeURIComponent\(room\.slug\)\}`\)/,
  );
  assert.doesNotMatch(createDialog, /ownerUserId|owner_user_id|role:/);
  assert.match(
    communityStyles,
    /\.eligibilityPanel\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
  );
  assert.match(
    communityStyles,
    /@media \(max-width:\s*700px\)[\s\S]*\.createDialog\s*\{[\s\S]*width:\s*100%[\s\S]*\.formGrid\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  );
});

test("directory query uses FTS, stable cursors, filters, and a bounded one-query RPC", () => {
  assert.match(migration, /search_document tsvector generated always/i);
  assert.match(migration, /websearch_to_tsquery/i);
  assert.match(migration, /room\.focus_tags @> array\[p_focus_tag\]::text\[\]/i);
  assert.match(migration, /\(room\.created_at, room\.slug\) </i);
  assert.match(migration, /\(room\.last_activity_at, room\.slug\) </i);
  assert.match(migration, /limit v_limit \+ 1/gi);
  assert.match(
    communityRepository,
    /supabaseRpc\([\s\S]*"list_live_room_community_rooms"/,
  );
  assert.doesNotMatch(communityRepository, /\.map\([^)]*supabase/i);
  assert.match(directoryPage, /name="topic"/);
  assert.match(directoryPage, /name="style"/);
  assert.match(directoryPage, /name="tag"/);
  assert.match(directoryPage, /name="language"/);
  assert.match(directoryPage, /name="theme"/);
  assert.match(directoryPage, /name="industry"/);
  assert.match(directoryPage, /name="sort"/);
});

test("ticker search labels and links the matching Company Live Room beside Community results", () => {
  assert.match(
    communityRepository,
    /findCompanyLiveRoomDirectoryResult[\s\S]*normalizeLiveRoomTicker\(rawSearch\)[\s\S]*supabaseSelect\("tickers", \{[\s\S]*symbol:\s*`eq\.\$\{ticker\}`[\s\S]*is_active:\s*"eq\.true"/,
  );
  assert.match(
    directoryPage,
    /Promise\.allSettled\(\[[\s\S]*listCommunityRooms\(requestedFilters\)[\s\S]*findCompanyLiveRoomDirectoryResult\(requestedFilters\.search\)/,
  );
  assert.match(directoryPage, />Company Live Room</);
  assert.match(
    directoryPage,
    /href=\{`\/live\/\$\{companyRoom\.ticker\}`\}[\s\S]*companyRoom\.ticker\} Company Live Room/,
  );
  assert.match(
    directoryPage,
    /separate from[\s\S]*member-created Community Rooms/,
  );
  assert.match(
    directoryPage,
    /\)\s*:\s*!companyRoom && !companyLookupUnavailable \? \([\s\S]*No member-created Community Room or matching Company Live[\s\S]*Room was found/,
  );
  assert.match(
    directoryPage,
    /companyLookupUnavailable[\s\S]*The Company Live Room match could not be checked right now/,
  );
  assert.doesNotMatch(
    directoryPage,
    /companyRoom\.(?:id|issuerId|roomId|ownerUserId)/,
  );
  assert.match(
    communityStyles,
    /\.companyRoomResult\s*\{[\s\S]*min-width:\s*0[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/,
  );
  assert.match(
    communityStyles,
    /\.companyRoomResult p\s*\{[\s\S]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    communityStyles,
    /@media \(max-width:\s*700px\)[\s\S]*\.companyRoomResult\s*\{[\s\S]*grid-template-columns:\s*1fr[\s\S]*\.openCompanyRoomLink\s*\{[\s\S]*width:\s*100%/,
  );
});

test("every company Live Room sign-in CTA preserves the exact ticker room return", () => {
  assert.match(
    liveRoomClient,
    /const roomLoginHref = createLiveRoomMemberLoginHref\(\s*`\/live\/\$\{ticker\}`/,
  );
  assert.equal(
    liveRoomClient.match(/loginHref=\{roomLoginHref\}/g)?.length,
    5,
  );
  assert.match(
    productHeader,
    /const authReturnPath =[\s\S]*pathname\.startsWith\("\/"\)[\s\S]*const loginHref = `\/login\?next=\$\{encodeURIComponent\(authReturnPath\)\}`[\s\S]*<AuthStatus loginHref=\{loginHref\} signupHref=\{signupHref\}/,
  );
  assert.match(
    mobileNavigation,
    /loginHref:\s*string[\s\S]*signupHref:\s*string[\s\S]*<AuthStatus loginHref=\{loginHref\} signupHref=\{signupHref\}/,
  );
  assert.match(
    messageComposer,
    /profile\.isGuest[\s\S]*\? loginHref[\s\S]*: "\/account\/creator"/,
  );
  assert.doesNotMatch(
    messageComposer,
    /profile\.isGuest[\s\S]{0,120}\/login\?next=%2Faccount/,
  );
  assert.match(
    postsPanel,
    /profile\?\.isGuest[\s\S]*href=\{loginHref\}>Sign in and return to this room/,
  );
});

test("Community messages reuse message moderation, report, and block server contracts", () => {
  assert.match(communityMessagesRoute, /getLiveRoomMessagePage/);
  assert.match(communityMessagesRoute, /getLiveRoomMessageChanges/);
  assert.match(communityMessagesRoute, /sendLiveRoomMessage/);
  assert.match(communityMessagesRoute, /eventId: null/);
  assert.match(communityMessagesRoute, /replyToMessageId\?: unknown/);
  assert.match(
    communityMessagesRoute,
    /normalizeOptionalLiveRoomReplyMessageId\(\s*input\?\.replyToMessageId/,
  );
  assert.match(communityReportsRoute, /reportLiveRoomMessage/);
  assert.match(communityBlocksRoute, /blockLiveRoomMessageAuthor/);
  assert.match(
    communityModerationRoute,
    /listHiddenLiveRoomMessages/,
  );
  assert.match(communityModerationRoute, /moderateLiveRoomMessage/);
  assert.match(communityClient, /evaluateLiveRoomMessage/);
  assert.match(communityClient, /repository\.report/);
  assert.match(communityClient, /repository\.block/);
  assert.match(
    communityClient,
    /replyToMessageId: replyingTo\?\.id \|\| null/,
  );
  assert.match(communityClient, /onReply=\{handleReply\}/);
  assert.match(
    communityClient,
    /setBody\(""\);[\s\S]*?setReplyingTo\(null\)/,
  );
  assert.match(
    liveRoomRepository,
    /Community Room messages cannot attach company event cards/,
  );
  assert.match(
    liveRoomRepository,
    /LIVE_ROOM_INVALID_MODERATION_ACTION[\s\S]*resolveLiveRoom\(\{ slug, ticker: rawTicker \}\)/,
  );
});

test("Community realtime topics stay separate while preserving company topics", () => {
  assert.match(
    migration,
    /when room\.room_kind = 'company' then room\.ticker/i,
  );
  assert.match(
    migration,
    /when room\.room_kind = 'community' then[\s\S]*'community:' \|\| community\.slug/i,
  );
  assert.match(migration, /'live-room:' \|\| v_room_topic/i);
  assert.match(
    communityClient,
    /\{ kind: "community", slug: room\.slug \}/,
  );
});

test("public API presentation omits owner and internal room identifiers", () => {
  assert.doesNotMatch(
    read("lib/live-room/community.ts"),
    /ownerUserId|owner_user_id|roomId|room_id/,
  );
  assert.doesNotMatch(
    migration.match(/return pg_catalog\.jsonb_build_object\([\s\S]*?\n  \);/)?.[0] ?? "",
    /owner_user_id|room_id/,
  );
  assert.match(
    migration,
    /'slug', v_slug[\s\S]*'createdAt', v_now/,
  );
  const discoveryPublicFunctions = discoveryMigration.match(
    /create function public\.create_live_room_community_room[\s\S]*?create or replace function public\.get_live_room_community_room[\s\S]*?create function public\.list_live_room_community_rooms/,
  )?.[0] ?? "";
  assert.doesNotMatch(
    discoveryPublicFunctions,
    /'ownerUserId'|'owner_user_id'|'roomId'|'room_id'/,
  );
});

test("directory creation UI enforces required fields without free-form tags", () => {
  assert.match(createDialog, /Room name/);
  assert.match(createDialog, /One-line introduction/);
  assert.match(createDialog, /Topic/);
  assert.match(createDialog, /Room style/);
  assert.match(createDialog, /Language/);
  assert.match(createDialog, /Focus tags/);
  assert.match(createDialog, /Free-form tags are not supported/);
  assert.match(createDialog, /Up to 5 tickers/);
  assert.match(createDialog, /Market themes/);
  assert.match(createDialog, /Industries/);
  assert.match(
    createDialog,
    /Choose at least one ticker, theme, or industry/,
  );
  assert.match(createDialog, /aria-pressed/);
  assert.match(createDialog, /MAIN theme/);
  assert.match(createDialog, /required/);
});

test("header adds one deliberate Community Room directory entry", () => {
  const matches = unreadMenu.match(/Browse Community Rooms/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(unreadMenu, /href="\/live"/);
});

test("public pg_catalog qualifications are actual functions, not SQL syntax elements", () => {
  const allowed = new Set([
    "array_position",
    "btrim",
    "cardinality",
    "char_length",
    "count",
    "hashtextextended",
    "jsonb_agg",
    "jsonb_build_object",
    "left",
    "lower",
    "now",
    "pg_advisory_xact_lock",
    "regexp_replace",
    "regconfig",
    "setweight",
    "to_tsvector",
    "unnest",
    "upper",
    "websearch_to_tsquery",
  ]);
  const qualified = [
    ...migration.matchAll(/pg_catalog\.([a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]!.toLowerCase());
  assert.equal(
    qualified.every((name) => allowed.has(name)),
    true,
    `Unexpected pg_catalog symbol: ${qualified
      .filter((name) => !allowed.has(name))
      .join(", ")}`,
  );
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(coalesce|greatest|least|nullif)\s*\(/i,
  );
  assert.match(migration, /\bcoalesce\(/i);
  assert.match(migration, /\bgreatest\(/i);
  assert.match(migration, /\bleast\(/i);
  assert.match(migration, /\bnullif\(/i);
});

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readSqlAllowlist(functionName: string) {
  const body =
    discoveryMigration.match(
      new RegExp(
        `function public\\.${functionName}\\([\\s\\S]+?\\$\\$;`,
        "i",
      ),
    )?.[0] ?? "";
  const arrayBody =
    body.match(/p_values <@ array\[([\s\S]+?)\]::text\[\]/i)?.[1] ??
    "";
  return [...arrayBody.matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );
}
