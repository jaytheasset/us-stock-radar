import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  chunkLiveRoomSocialBadgeMessageIds,
  mergeLiveRoomSocialBadgeEntries,
} from "./badgeBatch.ts";
import {
  normalizeSocialHandle,
  normalizeSocialPlatform,
  normalizeSocialUrl,
  socialBadgeLabel,
} from "./policy.ts";
import { createSocialProofCode } from "./proofCode.ts";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "docs/db/migration-archive/pre-canonical-baseline/20260727185802_live_room_social_account_verification.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const repository = readFileSync(
  path.join(root, "lib/social-verification/serverRepository.ts"),
  "utf8",
);
const liveRoomRepository = readFileSync(
  path.join(root, "lib/live-room/serverRepository.ts"),
  "utf8",
);
const memberRoute = readFileSync(
  path.join(root, "app/api/account/creator-verifications/route.ts"),
  "utf8",
);
const memberMutationRoute = readFileSync(
  path.join(
    root,
    "app/api/account/creator-verifications/[requestId]/route.ts",
  ),
  "utf8",
);
const adminRoute = readFileSync(
  path.join(root, "app/api/admin/creator-verifications/route.ts"),
  "utf8",
);
const adminMutationRoute = readFileSync(
  path.join(
    root,
    "app/api/admin/creator-verifications/[requestId]/route.ts",
  ),
  "utf8",
);
const publicTypes = readFileSync(
  path.join(root, "lib/social-verification/types.ts"),
  "utf8",
);
const memberUi = readFileSync(
  path.join(
    root,
    "components/social-verification/CreatorVerificationClient.tsx",
  ),
  "utf8",
);
const adminUi = readFileSync(
  path.join(
    root,
    "components/social-verification/AdminVerificationClient.tsx",
  ),
  "utf8",
);
const timelineUi = readFileSync(
  path.join(root, "components/live-room/ChatTimeline.tsx"),
  "utf8",
);
const composerUi = readFileSync(
  path.join(root, "components/live-room/MessageComposer.tsx"),
  "utf8",
);
const chatNameSetupUi = readFileSync(
  path.join(root, "components/live-room/ChatNameSetup.tsx"),
  "utf8",
);
const creatorPage = readFileSync(
  path.join(root, "app/account/creator/page.tsx"),
  "utf8",
);
const adminPage = readFileSync(
  path.join(root, "app/admin/creator-verifications/page.tsx"),
  "utf8",
);

test("platform and handle validation use closed normalized values", () => {
  assert.equal(normalizeSocialPlatform(" X "), "x");
  assert.equal(normalizeSocialPlatform("YouTube"), "youtube");
  assert.equal(normalizeSocialHandle(" @Stock.Radar_1 "), "stock.radar_1");
  assert.throws(() => normalizeSocialPlatform("tiktok"));
  assert.throws(() => normalizeSocialHandle("bad handle"));
  assert.throws(() => normalizeSocialHandle(""));
});

test("social URLs require HTTPS, exact allowlisted hosts, and no credentials", () => {
  assert.equal(
    normalizeSocialUrl("https://x.com/stockradar?lang=en#bio", "x", "profile"),
    "https://x.com/stockradar?lang=en",
  );
  assert.equal(
    normalizeSocialUrl(
      "https://www.youtube.com/@stockradar",
      "youtube",
      "profile",
    ),
    "https://www.youtube.com/@stockradar",
  );
  assert.equal(
    normalizeSocialUrl(
      "https://youtu.be/abc123",
      "youtube",
      "proof",
    ),
    "https://youtu.be/abc123",
  );
  assert.throws(() =>
    normalizeSocialUrl(
      "https://youtu.be/abc123",
      "youtube",
      "profile",
    ),
  );
  assert.equal(
    normalizeSocialUrl(
      "https://www.instagram.com/stockradar/",
      "instagram",
      "profile",
    ),
    "https://www.instagram.com/stockradar/",
  );

  for (const invalid of [
    "http://x.com/stockradar",
    "https://user:pass@x.com/stockradar",
    "https://x.com.evil.test/stockradar",
    "https://localhost/stockradar",
    "javascript:alert(1)",
    "data:text/plain,test",
    "https://xn--x-7ka.com/profile",
    "https://x.com/",
  ]) {
    assert.throws(() => normalizeSocialUrl(invalid, "x", "profile"), invalid);
  }
  assert.throws(() =>
    normalizeSocialUrl(
      "https://www.instagram.com/post",
      "youtube",
      "proof",
    ),
  );
});

test("proof codes are crypto-generated public challenges with the fixed shape", () => {
  const codes = new Set(
    Array.from({ length: 20 }, () => createSocialProofCode()),
  );
  assert.equal(codes.size, 20);
  for (const code of codes) {
    assert.match(code, /^SR-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  }
});

test("migration keeps the table service-only with RLS and explicit function grants", () => {
  assert.match(
    migration,
    /create table public\.live_room_social_verifications/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_social_verifications enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all privileges[\s\S]*live_room_social_verifications[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update[\s\S]*live_room_social_verifications[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant [^;\n]*delete[^;\n]*on table public\.live_room_social_verifications/i,
  );
  const functions = [
    "create_live_room_social_verification",
    "mutate_live_room_social_verification",
    "review_live_room_social_verification",
    "list_live_room_social_verification_reviews",
    "get_live_room_social_badges",
  ];
  for (const functionName of functions) {
    assert.match(
      migration,
      new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all[\\s\\S]*?function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute[\\s\\S]*?function public\\.${functionName}[\\s\\S]*?to service_role`,
        "i",
      ),
    );
  }
});

test("migration qualifies only real pg_catalog functions and leaves SQL syntax elements unqualified", () => {
  const qualified = [
    ...migration.matchAll(/pg_catalog\.([a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(qualified)].sort(),
    [
      "btrim",
      "cardinality",
      "char_length",
      "count",
      "gen_random_uuid",
      "left",
      "lower",
      "now",
    ],
  );
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|greatest|least)\s*\(/i,
  );
  assert.match(migration, /\bCOALESCE\(/);
  assert.match(migration, /\bGREATEST\(/);
  assert.match(migration, /\bLEAST\(/);
});

test("migration enforces ownership FKs, active uniqueness, review conflict, and bounded indexes", () => {
  assert.match(
    migration,
    /member_user_id uuid not null[\s\S]*references public\.user_profiles\(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /reviewed_by uuid references public\.user_profiles\(id\) on delete set null/i,
  );
  assert.match(
    migration,
    /unique index live_room_social_verifications_member_platform_active_uidx[\s\S]*member_user_id, platform[\s\S]*where status in \('draft', 'proof_ready', 'pending_review', 'verified'\)/i,
  );
  assert.match(
    migration,
    /unique index live_room_social_verifications_handle_review_uidx[\s\S]*platform, normalized_handle[\s\S]*where status in \('pending_review', 'verified'\)/i,
  );
  assert.match(
    migration,
    /live_room_social_verifications_pending_idx[\s\S]*where status = 'pending_review'/i,
  );
  assert.match(migration, /limit LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 50\)/);
});

test("proof lifecycle is rate-limited, expires in 24 hours, and rechecked in review transaction", () => {
  assert.match(migration, /v_now \+ interval '24 hours'/i);
  assert.match(migration, /last_code_issued_at > v_now - interval '24 hours'/i);
  assert.match(migration, /last_code_issued_at > v_now - interval '5 minutes'/i);
  assert.match(migration, /if v_recent_count >= 5/i);
  assert.match(migration, /v_request\.code_issue_count >= 5/i);
  assert.match(
    migration,
    /update public\.live_room_social_verifications[\s\S]*status = 'expired'[\s\S]*where member_user_id = p_member_user_id[\s\S]*platform = p_platform[\s\S]*expires_at <= v_now/i,
  );
  assert.match(
    migration,
    /where request\.public_request_id = p_public_request_id[\s\S]*for update/i,
  );
  assert.match(
    migration,
    /if v_request\.status <> 'pending_review'/i,
  );
  assert.match(
    migration,
    /if v_request\.expires_at <= v_now[\s\S]*SOCIAL_VERIFICATION_EXPIRED/i,
  );
  assert.match(migration, /when unique_violation[\s\S]*SOCIAL_VERIFICATION_HANDLE_CONFLICT/i);
});

test("member and admin APIs enforce session, same-origin mutations, ownership, and admin role", () => {
  assert.match(memberRoute, /resolveSocialMember\(request\)/);
  assert.match(memberRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(memberMutationRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(memberMutationRoute, /resolution\.userId/);
  assert.match(repository, /member_user_id: `eq\.\$\{userId\}`/);
  assert.match(adminRoute, /listSocialVerificationReviews/);
  assert.match(adminMutationRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(repository, /userHasAdminPermission\(userId, "verifications\.read"\)/);
  assert.match(
    migration,
    /moderator\.active = true[\s\S]*moderator\.role = 'admin'/i,
  );
});

test("public contracts do not expose member UUID, email, reviewer, or internal id", () => {
  assert.doesNotMatch(publicTypes, /\bmemberUserId\b|\bemail\b|\breviewedBy\b|\binternalId\b/);
  assert.doesNotMatch(memberUi + adminUi + timelineUi, /\bmember_user_id\b|\breviewed_by\b|\bguest_token\b/i);
  assert.match(publicTypes, /publicRequestId: string/);
});

test("Live Room badge enrichment is bounded, bulk, visible-only, and block-aware", () => {
  const messageIds = Array.from(
    { length: 105 },
    (_, index) => `message-${index + 1}`,
  );
  const chunks = chunkLiveRoomSocialBadgeMessageIds([
    messageIds[0],
    ...messageIds,
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50]);
  assert.equal(chunks[0][0], "message-1");
  assert.equal(chunks[1][49], "message-100");
  assert.equal(chunks.flat().includes("message-101"), false);

  const badgeMap = mergeLiveRoomSocialBadgeEntries([
    [
      {
        label: "Verified X",
        messageId: "message-1",
        platform: "x",
        profileUrl: "https://x.com/member",
      },
    ],
    [
      {
        label: "Verified YouTube",
        messageId: "message-100",
        platform: "youtube",
        profileUrl: "https://www.youtube.com/@member",
      },
    ],
  ]);
  assert.equal(badgeMap.get("message-1")?.[0]?.platform, "x");
  assert.equal(
    badgeMap.get("message-100")?.[0]?.platform,
    "youtube",
  );

  assert.match(repository, /Promise\.all\(/);
  assert.match(repository, /chunks\.map\(\(chunk\)/);
  assert.match(repository, /mergeLiveRoomSocialBadgeEntries\(entryBatches\)/);
  assert.match(repository, /supabaseRpc\("get_live_room_social_badges"/);
  assert.equal(
    (liveRoomRepository.match(/getLiveRoomSocialBadgeMap\(/g) || []).length,
    1,
  );
  assert.match(liveRoomRepository, /Promise\.all\(\[/);
  assert.match(migration, /message\.visibility_status = 'visible'/);
  assert.match(migration, /verification\.status = 'verified'/);
  assert.match(migration, /verification\.show_on_profile = true/);
  assert.match(migration, /block\.blocker_member_user_id = p_member_user_id/);
  assert.match(migration, /block\.blocker_member_user_id = message\.member_user_id/);
  assert.match(migration, /block\.blocker_guest_session_id = p_guest_session_id/);
});

test("badge language describes social ownership without endorsement wording", () => {
  assert.equal(socialBadgeLabel("x"), "Verified X");
  assert.equal(socialBadgeLabel("youtube"), "Verified YouTube");
  assert.equal(socialBadgeLabel("instagram"), "Verified Instagram");
  const productCopy = memberUi + adminUi + timelineUi;
  for (const forbidden of [
    ["Expert"].join(""),
    ["Trusted", " investor"].join(""),
    ["Official", " analyst"].join(""),
  ]) {
    assert.doesNotMatch(productCopy, new RegExp(forbidden, "i"));
  }
  assert.match(timelineUi, /rel="noopener noreferrer"/);
  assert.match(timelineUi, /target="_blank"/);
});

test("creator verification entry and guidance describe the existing ownership review", () => {
  assert.match(chatNameSetupUi, /import Link from "next\/link"/);
  assert.match(chatNameSetupUi, /BadgeCheck/);
  assert.match(chatNameSetupUi, /href="\/account\/creator"/);
  assert.doesNotMatch(chatNameSetupUi, /\/login\?next=%2Faccount%2Fcreator/);
  assert.match(chatNameSetupUi, /Apply for creator verification/);
  assert.match(chatNameSetupUi, /Instagram, X, or YouTube/);

  assert.match(memberUi, /<h1>Creator verification<\/h1>/);
  assert.match(memberUi, /How verification works/);
  assert.match(memberUi, /Instagram, X, or YouTube/);
  assert.match(memberUi, /valid for 24 hours/);
  assert.match(memberUi, /public bio, post, or video description/);
  assert.match(memberUi, /Submit for review/);
  assert.match(memberUi, /administrator checks the account and code/i);
  assert.match(memberUi, /verified social badge/);
  assert.match(
    memberUi,
    /does not verify investing experience, performance, or financial advice/i,
  );

  assert.match(
    creatorPage,
    /title: "Creator verification \| Stock Radar"/,
  );
  assert.match(
    creatorPage,
    /redirect\("\/login\?next=%2Faccount%2Fcreator"\)/,
  );
  assert.match(adminPage, /AdminVerificationClient/);
});
