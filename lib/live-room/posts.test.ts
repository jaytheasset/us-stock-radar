import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertLiveRoomPostMentionTargets,
  createLiveRoomPostBodyPreview,
  createLiveRoomPostEventOptionLabel,
  LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH,
  LIVE_ROOM_POST_EVENT_OPTION_MAX_LENGTH,
  normalizeLiveRoomPostDraft,
  normalizeLiveRoomPostPageLimit,
} from "./postPolicy.ts";
import {
  getLiveRoomPostTickerInputContext,
  LIVE_ROOM_POST_TICKER_SUGGESTION_LIMIT,
  parseLiveRoomPostMentionedTickers,
  replaceLiveRoomPostTickerInputToken,
  selectLiveRoomPostTickerSuggestions,
} from "./postTickerAutocomplete.ts";
import {
  applyLiveRoomPostScopeAndCursorFilters,
  shouldExposeLiveRoomCompanyPost,
} from "./postQuery.ts";
import { createLiveRoomMemberLoginHref } from "./memberActions.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("post drafts enforce bounded title, body, and unique canonical tickers", () => {
  assert.deepEqual(
    normalizeLiveRoomPostDraft({
      title: "AI infrastructure demand",
      body: "A durable thesis with enough detail for a Live Room post.",
      relatedTickers: ["$nvda", "AMD"],
      eventId: "",
    }),
    {
      title: "AI infrastructure demand",
      body: "A durable thesis with enough detail for a Live Room post.",
      direction: null,
      relatedTickers: ["NVDA", "AMD"],
      eventId: null,
      signalLabels: [],
    },
  );
  assert.throws(() =>
    normalizeLiveRoomPostDraft({
      title: "Bad",
      body: "A durable thesis with enough detail for a Live Room post.",
    }),
  );
  assert.throws(() =>
    normalizeLiveRoomPostDraft({
      title: "Duplicate tickers",
      body: "A durable thesis with enough detail for a Live Room post.",
      relatedTickers: ["NVDA", "nvda"],
    }),
  );
  assert.throws(() =>
    assertLiveRoomPostMentionTargets(["AMD", "NVDA"], "AMD"),
  );
  assert.doesNotThrow(() =>
    assertLiveRoomPostMentionTargets(["AMD", "NVDA"], "MSFT"),
  );
  assert.equal(normalizeLiveRoomPostPageLimit(500), 50);
  assert.equal(normalizeLiveRoomPostPageLimit(0), 1);
});

test("post ticker autocomplete parses and replaces only the active token", () => {
  assert.deepEqual(getLiveRoomPostTickerInputContext("$am"), {
    atLimit: false,
    query: "AM",
    selectedTickers: [],
    tokenStart: 0,
  });
  assert.deepEqual(getLiveRoomPostTickerInputContext("$AMD, nv"), {
    atLimit: false,
    query: "NV",
    selectedTickers: ["AMD"],
    tokenStart: 6,
  });
  assert.deepEqual(getLiveRoomPostTickerInputContext("AMD NV"), {
    atLimit: false,
    query: "NV",
    selectedTickers: ["AMD"],
    tokenStart: 4,
  });
  assert.equal(
    replaceLiveRoomPostTickerInputToken("$AMD, $nv", "nvda"),
    "$AMD, $NVDA, ",
  );
  assert.deepEqual(
    parseLiveRoomPostMentionedTickers("$amd, NVDA amd invalid/ticker"),
    ["AMD", "NVDA", "INVALID/TICKER"],
  );
});

test("post ticker autocomplete excludes duplicates, current room, and stops at five", () => {
  const results = [
    { ticker: "AMD" },
    { ticker: "BBLG" },
    { ticker: "NVDA" },
    { ticker: "NVDA" },
    { ticker: "AAPL" },
    { ticker: "MSFT" },
    { ticker: "META" },
    { ticker: "GOOG" },
    { ticker: "TSLA" },
    { ticker: "INTC" },
  ];
  const context = getLiveRoomPostTickerInputContext("$AMD, $n");
  const suggestions = selectLiveRoomPostTickerSuggestions(
    results,
    context,
    "BBLG",
  );

  assert.deepEqual(
    suggestions.map((result) => result.ticker),
    ["NVDA", "AAPL", "MSFT", "META", "GOOG", "TSLA"],
  );
  assert.equal(
    suggestions.length,
    LIVE_ROOM_POST_TICKER_SUGGESTION_LIMIT,
  );

  const atLimit = getLiveRoomPostTickerInputContext(
    "$AMD, $NVDA, $AAPL, $MSFT, $META, $t",
  );
  assert.equal(atLimit.atLimit, true);
  assert.deepEqual(
    selectLiveRoomPostTickerSuggestions(results, atLimit, "BBLG"),
    [],
  );
});

test("post body previews normalize whitespace and truncate to a safe compact length", () => {
  assert.equal(
    createLiveRoomPostBodyPreview(
      "  First line\n\nSecond\tline   with spacing.  ",
    ),
    "First line Second line with spacing.",
  );

  const preview = createLiveRoomPostBodyPreview(
    "A".repeat(LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH + 40),
  );
  assert.equal(preview.length, LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH);
  assert.equal(preview.endsWith("…"), true);
});

test("post event option labels stay deterministic and native-popup safe", () => {
  const filing = createLiveRoomPostEventOptionLabel({
    kind: "filing",
    occurredAt: "2026-07-17T14:30:00.000Z",
    title:
      "Bone Biologics Corporation Announces an Exceptionally Long Filing Title",
  });
  const news = createLiveRoomPostEventOptionLabel({
    kind: "news",
    occurredAt: "not-a-date",
    title:
      "  A very long   company announcement with normalized whitespace and more detail  ",
  });
  const untitled = createLiveRoomPostEventOptionLabel({
    kind: "filing",
    occurredAt: null,
    title: "   ",
  });

  assert.match(filing, /^Filing · Jul 17 · Bone Biologics/);
  assert.equal(filing.endsWith("…"), true);
  assert.equal(
    Array.from(filing).length,
    LIVE_ROOM_POST_EVENT_OPTION_MAX_LENGTH,
  );
  assert.match(news, /^News · A very long company announcement/);
  assert.equal(news.includes("not-a-date"), false);
  assert.ok(
    Array.from(news).length <= LIVE_ROOM_POST_EVENT_OPTION_MAX_LENGTH,
  );
  assert.equal(untitled, "Filing · Untitled event");
});

test("company posts appear once in their canonical and mentioned rooms only", () => {
  const posts = [
    {
      id: "canonical",
      relatedTickers: ["AMD"],
      sourceRoomKind: "company" as const,
      sourceTicker: "NVDA",
    },
    {
      id: "unrelated",
      relatedTickers: ["MSFT"],
      sourceRoomKind: "company" as const,
      sourceTicker: "AAPL",
    },
    {
      id: "community",
      relatedTickers: ["AMD"],
      sourceRoomKind: "community" as const,
      sourceTicker: null,
    },
  ];

  assert.deepEqual(
    posts
      .filter((post) =>
        shouldExposeLiveRoomCompanyPost({
          currentTicker: "NVDA",
          relatedTickers: post.relatedTickers,
          sourceRoomKind: post.sourceRoomKind,
          sourceTicker: post.sourceTicker,
        }),
      )
      .map((post) => post.id),
    ["canonical"],
  );
  assert.deepEqual(
    posts
      .filter((post) =>
        shouldExposeLiveRoomCompanyPost({
          currentTicker: "AMD",
          relatedTickers: post.relatedTickers,
          sourceRoomKind: post.sourceRoomKind,
          sourceTicker: post.sourceTicker,
        }),
      )
      .map((post) => post.id),
    ["canonical"],
  );
  assert.equal(
    posts.filter((post) =>
      shouldExposeLiveRoomCompanyPost({
        currentTicker: "TSLA",
        relatedTickers: post.relatedTickers,
        sourceRoomKind: post.sourceRoomKind,
        sourceTicker: post.sourceTicker,
      }),
    ).length,
    0,
  );
});

test("company cross-post scope and cursor remain combined in one PostgREST and filter", () => {
  const search: Record<string, string> = {
    select: "id,room_id,related_tickers,created_at",
  };
  applyLiveRoomPostScopeAndCursorFilters({
    ascending: false,
    cursor: {
      createdAt: "2026-07-28T05:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    },
    includeMentionedCompanyPosts: true,
    room: {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "company",
      ticker: "AMD",
    },
    search,
  });

  assert.equal(search.or, undefined);
  assert.match(
    search.and,
    /^[(]or[(]room_id[.]eq[.].+related_tickers[.]cs[.][{]AMD[}][)][,]or[(]created_at[.]lt[.]/,
  );
  assert.equal(search["source_room.room_kind"], "eq.company");
  assert.match(search.select, /live_room_rooms!inner[(]room_kind[)]/);
});

test("canonical-only timeline reads do not inherit company post cross-exposure", () => {
  const search: Record<string, string> = { select: "id" };
  applyLiveRoomPostScopeAndCursorFilters({
    ascending: false,
    cursor: null,
    includeMentionedCompanyPosts: false,
    room: { id: "room-a", kind: "company", ticker: "A" },
    search,
  });

  assert.equal(search.room_id, "eq.room-a");
  assert.equal(search.or, undefined);
  assert.equal(search.and, undefined);
});

test("post migration is RLS default-deny, service-only, indexed, and invoker-only", () => {
  const migrationName = readdirSync(
    path.join(
      projectRoot,
      "docs",
      "db",
      "migration-archive",
      "pre-canonical-baseline",
    ),
  ).find((name) => name.endsWith("_live_room_posts.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(
      "docs",
      "db",
      "migration-archive",
      "pre-canonical-baseline",
      migrationName,
    ),
  );

  for (const table of [
    "live_room_posts",
    "live_room_post_reports",
    "live_room_post_moderation_actions",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}[\\s\\S]{0,60}enable row level security`, "i"),
    );
  }
  assert.match(
    migration,
    /live_room_posts_room_created_idx[\s\S]+room_id, created_at desc, id desc/i,
  );
  assert.match(
    migration,
    /live_room_posts_author_created_idx[\s\S]+author_user_id, created_at desc, id desc/i,
  );
  assert.match(migration, /public_profile_id uuid/i);
  assert.match(migration, /public_profile_id set default gen_random_uuid\(\)/i);
  assert.match(migration, /from public, anon, authenticated/gi);
  assert.match(migration, /to service_role/gi);
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /set search_path = ''/gi);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(
    migration,
    /auth\.jwt\(\)[\s\S]{0,120}(?:user_metadata|raw_user_meta_data)/i,
  );
});

test("cross-post migration adds a partial GIN index and server-only listed ticker guard", () => {
  const migration = readSource(
    "docs/db/migration-archive/pre-canonical-baseline/20260728055733_live_room_post_cross_posts.sql",
  );

  assert.match(
    migration,
    /live_room_posts_related_tickers_gin_idx[\s\S]+using gin \(related_tickers\)[\s\S]+visibility_status = 'visible'/i,
  );
  assert.match(
    migration,
    /from public\.tickers[\s\S]+ticker\.is_active is true/i,
  );
  assert.match(
    migration,
    /v_room\.room_kind = 'company'[\s\S]+v_room\.ticker = any\(new\.related_tickers\)/i,
  );
  assert.match(migration, /security invoker/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy|security definer/i);
});

test("Live Room post RPCs repair schema-qualified COALESCE for PostgreSQL 17", () => {
  const migrationName = readdirSync(
    path.join(
      projectRoot,
      "docs",
      "db",
      "migration-archive",
      "pre-canonical-baseline",
    ),
  ).find((name) => name.endsWith("_fix_live_room_pg17_coalesce.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(
      "docs",
      "db",
      "migration-archive",
      "pre-canonical-baseline",
      migrationName,
    ),
  );

  for (const signature of [
    "public.create_live_room_post(uuid,uuid,text,text,text[],uuid)",
    "public.update_live_room_post(uuid,uuid,text,text,text[],uuid)",
    "public.moderate_live_room_post(uuid,uuid,text,text)",
    "public.validate_live_room_post_cross_targets()",
  ]) {
    assert.match(migration, new RegExp(signature.replace(/[()[\]]/g, "\\$&")));
  }
  assert.match(migration, /pg_catalog\.pg_get_functiondef\(v_signature\)/);
  assert.match(
    migration,
    /'pg_catalog\.coalesce\(',[\s\S]+?'coalesce\('/,
  );
  assert.doesNotMatch(migration, /security definer|grant execute|create policy/i);
});

test("post mutations accept PostgREST single-composite object responses", () => {
  const repository = readSource("lib/live-room/postServerRepository.ts");

  assert.match(
    repository,
    /function readSingleRow\(value: unknown\)[\s\S]+Array\.isArray\(value\)[\s\S]+typeof value === "object"/,
  );
  assert.match(
    repository,
    /const row = readSingleRow\(result\.data\) as PostRow \| null/,
  );
});

test("post APIs derive actor and room context server-side without accepting owner IDs", () => {
  const companyRoute = readSource(
    "app/api/live-room/[ticker]/posts/route.ts",
  );
  const communityRoute = readSource(
    "app/api/live-room/community/[slug]/posts/route.ts",
  );
  const detailRoute = readSource(
    "app/api/live-room/posts/[postId]/route.ts",
  );
  const repository = readSource("lib/live-room/postServerRepository.ts");
  const browserTypes = readSource("lib/live-room/types.ts");

  assert.match(companyRoute, /resolveLiveRoomActor\(request\)/);
  assert.match(companyRoute, /createLiveRoomPost\([\s\S]+ticker/);
  assert.doesNotMatch(companyRoute, /ownerUserId|authorUserId|roomId/);
  assert.match(communityRoute, /createLiveRoomPost\([\s\S]+slug/);
  assert.doesNotMatch(communityRoute, /ownerUserId|authorUserId|roomId/);
  assert.match(detailRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(repository, /actor\.kind !== "member"/);
  assert.match(repository, /visibility_status:\s*"eq\.visible"/);
  assert.doesNotMatch(browserTypes, /authorUserId|ownerUserId|memberUserId|email/);
});

test("room, detail, and public profile surfaces keep posts separate from events and chat history", () => {
  const company = readSource("components/live-room/LiveRoomClient.tsx");
  const community = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const timeline = readSource("components/live-room/ChatTimeline.tsx");
  const timelineStyles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const postsPanel = readSource("components/live-room/PostsPanel.tsx");
  const postRepository = readSource(
    "lib/live-room/postServerRepository.ts",
  );
  const timelineRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const profile = readSource(
    "components/live-room/PublicMemberProfileClient.tsx",
  );

  assert.match(company, /Chat[\s\S]+Posts[\s\S]+Events/);
  assert.match(community, /Chat[\s\S]+Posts[\s\S]+About/);
  assert.match(timeline, /item\.kind === "post_preview"/);
  assert.match(timeline, /POST/);
  assert.match(timeline, /\/live\/posts\/\$\{item\.id\}/);
  assert.match(timeline, /\{item\.bodyPreview\}/);
  assert.match(timeline, /postPreviewTitle/);
  assert.match(timeline, /postPreviewExcerpt/);
  assert.match(timeline, /postPreviewMeta/);
  assert.doesNotMatch(
    timeline,
    /item\.kind === "post_preview"[\s\S]{0,1200}dangerouslySetInnerHTML/,
  );
  assert.match(
    timelineStyles,
    /\.postPreviewExcerpt\s*\{[\s\S]*?-webkit-line-clamp:\s*2/,
  );
  assert.match(
    timelineStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.postPreviewTitle,\s*\.postPreviewExcerpt\s*\{[\s\S]*?-webkit-line-clamp:\s*1/,
  );
  assert.match(
    postRepository,
    /bodyPreview:\s*createLiveRoomPostBodyPreview\(post\.body\)/,
  );
  assert.match(
    postsPanel,
    /bodyPreview:\s*createLiveRoomPostBodyPreview\(post\.body\)/,
  );
  assert.match(
    timelineRepository,
    /postPage\.items\.map\(toLiveRoomPostPreview\)/,
  );
  assert.match(
    timelineRepository,
    /postUpserts\.map\(toLiveRoomPostPreview\)/,
  );
  assert.match(
    company,
    /const handlePostCreated = \(preview: LiveRoomPostPreview\) => \{[\s\S]*?forceOwnTimelineScrollRef\.current = true;[\s\S]*?mergeLiveRoomTimeline\(current, \[preview\]\)[\s\S]*?setMobileSheet\(null\);[\s\S]*?setActiveTab\("chat"\)/,
  );
  assert.equal(
    company.match(/onCreated=\{handlePostCreated\}/g)?.length,
    2,
  );
  assert.match(
    community,
    /const handlePostCreated = \(preview: LiveRoomPostPreview\) => \{[\s\S]*?mergeLiveRoomTimeline\(current, \[preview\]\)[\s\S]*?setMobileSheet\(null\);[\s\S]*?setActiveTab\("chat"\)/,
  );
  assert.equal(
    community.match(/onCreated=\{handlePostCreated\}/g)?.length,
    2,
  );
  assert.match(postsPanel, /setNotice\("Post published\."\)/);
  assert.doesNotMatch(postsPanel, /compact preview/i);
  assert.match(profile, /Public posts only/);
  assert.doesNotMatch(profile, /ChatTimeline|live_room_messages/);
});

test("member action login links preserve one safe encoded return path", () => {
  assert.equal(
    createLiveRoomMemberLoginHref(
      "/live/members/6dd07aa8-9df8-4e78-8dde-90678c476021",
    ),
    "/login?next=%2Flive%2Fmembers%2F6dd07aa8-9df8-4e78-8dde-90678c476021",
  );
  assert.equal(
    createLiveRoomMemberLoginHref("/live/BBLG"),
    "/login?next=%2Flive%2FBBLG",
  );
  assert.equal(createLiveRoomMemberLoginHref("//external.test"), "/login?next=%2F");
});

test("public member actions resolve safe server targets and reuse follow and DM flows", () => {
  const route = readSource(
    "app/api/live-room/members/[publicProfileId]/actions/route.ts",
  );
  const repository = readSource(
    "lib/live-room/memberActionServerRepository.ts",
  );
  const apiRepository = readSource("lib/live-room/apiRepository.ts");
  const browserTypes = readSource("lib/live-room/types.ts");
  const profile = readSource(
    "components/live-room/PublicMemberProfileClient.tsx",
  );
  const actionType = browserTypes.match(
    /export type LiveRoomPublicMemberActions = \{[\s\S]*?\};/,
  )?.[0];
  const followResultType = browserTypes.match(
    /export type LiveRoomPublicMemberFollowResult = \{[\s\S]*?\};/,
  )?.[0];

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  assert.match(
    route,
    /const input =[\s\S]*followed\?: unknown[\s\S]*updateLiveRoomPublicMemberFollow/,
  );
  assert.doesNotMatch(route, /input\?\.(?:messageId|roomId|userId)/);

  assert.match(
    repository,
    /normalizeLiveRoomUuid\([\s\S]*LIVE_ROOM_INVALID_PUBLIC_PROFILE_ID/,
  );
  assert.match(
    repository,
    /supabaseSelect\(\s*"live_room_member_profiles"[\s\S]*public_profile_id: `eq\.\$\{publicProfileId\}`/,
  );
  assert.match(
    repository,
    /supabaseSelect\("live_room_messages"[\s\S]*member_user_id: `eq\.\$\{userId\}`[\s\S]*visibility_status: "eq\.visible"[\s\S]*order: "created_at\.desc,id\.desc"/,
  );
  assert.match(
    repository,
    /supabaseRpc\("set_live_room_member_follow", \{[\s\S]*p_room_id: target\.roomId[\s\S]*p_message_id: target\.sourceMessageId/,
  );
  assert.match(
    repository,
    /blocker_member_user_id\.eq\.\$\{requesterUserId\}[\s\S]*blocked_member_user_id\.eq\.\$\{targetUserId\}[\s\S]*blocker_member_user_id\.eq\.\$\{targetUserId\}[\s\S]*blocked_member_user_id\.eq\.\$\{requesterUserId\}/,
  );
  assert.match(repository, /actor\.userId === target\.userId/);
  assert.match(repository, /!target\.sourceMessageId \|\| !target\.roomId/);
  assert.match(
    repository,
    /actor\.kind === "guest"[\s\S]*isGuest: true[\s\S]*sourceMessageId: null/,
  );

  assert.ok(actionType);
  assert.ok(followResultType);
  assert.doesNotMatch(
    `${actionType}${followResultType}`,
    /\b(?:userId|roomId|email)\b/,
  );
  assert.match(apiRepository, /readMemberActions\(publicProfileId: string\)/);
  assert.match(
    apiRepository,
    /writeMemberFollow\(publicProfileId: string, followed: boolean\)/,
  );
  assert.match(profile, /DirectMessageRequestModal/);
  assert.match(profile, /directMessageRepository\.start/);
  assert.match(profile, /directMessageRepository\.request/);
  assert.match(profile, /result\.mode === "request_required"/);
  assert.match(
    profile,
    /createLiveRoomMemberLoginHref\(profilePath\)/,
  );
  assert.match(profile, /aria-pressed=\{actions\.isFollowing\}/);
  assert.match(profile, /actions\.isSelf/);
});

test("post composer exposes event linking only through real event choices", () => {
  const postsPanel = readSource("components/live-room/PostsPanel.tsx");
  const postsStyles = readSource("components/live-room/Posts.module.css");

  assert.match(postsPanel, /events\.length > 0 \? \(/);
  assert.match(postsPanel, /<option value="">No event attached<\/option>/);
  assert.match(
    postsPanel,
    /\{createLiveRoomPostEventOptionLabel\(event\)\}/,
  );
  assert.match(postsPanel, /title=\{selectedEvent\?\.title\}/);
  assert.match(
    postsPanel,
    /events\.some\(\(event\) => event\.eventId === eventId\)[\s\S]+eventId[\s\S]+null/,
  );
  assert.doesNotMatch(postsPanel, /News or filing event ID|Event UUID/);
  assert.match(postsPanel, /Mentioned tickers/);
  assert.match(
    postsPanel,
    /\/api\/tickers\/search\?q=\$\{encodeURIComponent\([\s\S]*tickerInputContext\.query/,
  );
  assert.match(postsPanel, /mapTickerSearchResults\(payload\)/);
  assert.match(postsPanel, /moveTickerSearchIndex\(/);
  assert.match(postsPanel, /}, 220\)/);
  assert.match(postsPanel, /new AbortController\(\)/);
  assert.match(postsPanel, /role="combobox"/);
  assert.match(postsPanel, /role="listbox"/);
  assert.match(postsPanel, /role="option"/);
  assert.match(postsPanel, /aria-activedescendant=/);
  assert.match(postsPanel, /aria-expanded=\{tickerSearchOpen\}/);
  assert.match(postsPanel, /onPointerDown=\{\(event\) =>/);
  assert.match(
    postsPanel,
    /replaceLiveRoomPostTickerInputToken\([\s\S]*input\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    postsStyles,
    /\.tickerSuggestions\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/,
  );
  assert.match(postsPanel, /Cross-posted from \$\{post\.room\.ticker\}/);
  assert.match(postsPanel, />\$\{ticker\}<\/Link>/);
});

test("company post reads validate mentioned tickers in one active ticker lookup without creating target rooms", () => {
  const repository = readSource("lib/live-room/postServerRepository.ts");
  const timelineRepository = readSource("lib/live-room/serverRepository.ts");

  assert.match(
    repository,
    /supabaseSelect\("tickers", \{[\s\S]+symbol: `in\.\(\$\{relatedTickers\.join\(","\)\}\)`[\s\S]+is_active: "eq\.true"/,
  );
  assert.match(
    repository,
    /applyLiveRoomPostScopeAndCursorFilters\(\{[\s\S]+includeMentionedCompanyPosts/,
  );
  assert.match(
    timelineRepository,
    /includeMentionedCompanyPosts: false/,
  );
  assert.doesNotMatch(
    repository,
    /relatedTickers[\s\S]{0,300}supabaseUpsert\([\s\S]{0,80}"live_room_rooms"/,
  );
});

test("public post history keeps the database's newest-first cursor order", () => {
  const repository = readSource("lib/live-room/postServerRepository.ts");

  assert.match(
    repository,
    /order:\s*ascending[\s\S]+created_at\.desc,id\.desc/,
  );
  assert.match(repository, /const items = await mapLiveRoomPostRows\(rows, actor\)/);
  assert.match(repository, /const oldest = rows\[rows\.length - 1\]/);
  assert.doesNotMatch(repository, /const orderedRows = ascending/);
});

test("hidden, deleted, and blocked posts disappear from room, profile, detail, and chat preview reads", () => {
  const postRepository = readSource(
    "lib/live-room/postServerRepository.ts",
  );
  const timelineRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );

  assert.match(postRepository, /visibility_status:\s*`eq\.\$\{visibility\}`/);
  assert.match(
    postRepository,
    /blockedMemberIds\.includes\(readString\(row\.author_user_id\)\)/,
  );
  assert.match(
    postRepository,
    /if \(authorUserId && blockedMemberIds\.includes\(authorUserId\)\)[\s\S]+items: \[\]/,
  );
  assert.match(
    timelineRepository,
    /row\.visibility_status === "visible" && !blocked\.has\(actorId\)/,
  );
  assert.match(timelineRepository, /removedIds\.push\(id\)/);
});

test("post originals remain canonical while Chat carries current ID-based previews", () => {
  const migration = readSource(
    "docs/db/migration-archive/pre-canonical-baseline/20260728040409_live_room_posts.sql",
  );
  const timelineRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const timeline = readSource("components/live-room/ChatTimeline.tsx");

  assert.match(
    migration,
    /create table public\.live_room_posts[\s\S]+title text not null[\s\S]+body text not null/,
  );
  assert.doesNotMatch(
    migration,
    /alter table public\.live_room_messages[\s\S]+post_(?:title|body)/,
  );
  assert.match(timelineRepository, /postUpserts\.map\(toLiveRoomPostPreview\)/);
  assert.match(timeline, /\/live\/posts\/\$\{item\.id\}/);
});
