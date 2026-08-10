import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const migrationPath =
  "supabase/migrations/20260729090000_live_room_member_summary.sql";

test("member summaries use one bounded service-only bulk RPC", () => {
  const migration = read(migrationPath);
  const server = read("lib/live-room/serverRepository.ts");
  const route = read(
    "app/api/live-room/[ticker]/members/route.ts",
  );
  const browser = read("lib/live-room/apiRepository.ts");

  assert.match(
    migration,
    /create function public\.get_live_room_member_summaries\([\s\S]*p_public_profile_ids uuid\[\][\s\S]*p_limit integer default 8[\s\S]*security invoker[\s\S]*set search_path = ''/i,
  );
  assert.match(
    migration,
    /least\(greatest\(coalesce\(p_limit, 8\), 1\), 12\)/i,
  );
  assert.match(
    migration,
    /requested as \([\s\S]*unnest\([\s\S]*p_public_profile_ids[\s\S]*with ordinality/i,
  );
  assert.match(
    migration,
    /follower_counts as \([\s\S]*group by follow\.followed_user_id[\s\S]*post_stats as \([\s\S]*group by post\.author_user_id[\s\S]*verification_badges as \([\s\S]*group by verification\.member_user_id/i,
  );
  assert.doesNotMatch(
    migration,
    /foreach|for\s+\w+\s+in\s+(?:array|select)/i,
  );
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|greatest|least)\s*\(/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_live_room_member_summaries\([\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.get_live_room_member_summaries\([\s\S]*to service_role/i,
  );
  assert.match(
    server,
    /export async function listLiveRoomMemberSummaries\([\s\S]*slice\(0, 12\)[\s\S]*supabaseRpc\("get_live_room_member_summaries"/,
  );
  assert.equal(
    server.match(
      /supabaseRpc\("get_live_room_member_summaries"/g,
    )?.length,
    1,
  );
  assert.match(
    route,
    /resolveLiveRoomActor\(request\)[\s\S]*listLiveRoomMemberSummaries\([\s\S]*getAll\("publicProfileId"\)/,
  );
  assert.match(
    browser,
    /listMemberSummaries\(publicProfileIds: readonly string\[\]\)[\s\S]*publicProfileIds\.slice\(0, 12\)[\s\S]*\/members\?\$\{search\.toString\(\)\}/,
  );
});

test("bulk summary definitions preserve public counts, plans, verification, presence, and blocks", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /count\(\*\)::bigint as follower_count[\s\S]*live_room_member_follows as follow/i,
  );
  assert.match(
    migration,
    /live_room_posts as post[\s\S]*post\.visibility_status = 'visible'[\s\S]*count\(\*\)::bigint as post_count[\s\S]*sum\(post\.like_count\)[\s\S]*received_like_count/i,
  );
  assert.match(
    migration,
    /subscription\.status = 'active'[\s\S]*subscription\.plan[\s\S]*subscription\.trial_plan in \('pro', 'advanced'\)[\s\S]*subscription\.trial_ends_at > pg_catalog\.now\(\)/i,
  );
  assert.match(
    migration,
    /verification\.status = 'verified'[\s\S]*verification\.show_on_profile = true[\s\S]*verification\.expires_at is null/i,
  );
  assert.match(
    migration,
    /candidate\.show_presence[\s\S]*presence\.member_user_id is not null as is_online/i,
  );
  assert.match(
    migration,
    /presence\.room_id = p_room_id[\s\S]*presence\.last_seen_at[\s\S]*interval '2 minutes'/i,
  );
  assert.match(
    migration,
    /p_requester_kind = 'member'[\s\S]*block\.blocker_member_user_id[\s\S]*block\.blocked_member_user_id[\s\S]*or \([\s\S]*block\.blocker_member_user_id = profile\.user_id/i,
  );
  assert.match(
    migration,
    /p_requester_kind = 'guest'[\s\S]*block\.blocker_guest_session_id[\s\S]*block\.blocked_member_user_id[\s\S]*block\.blocked_guest_session_id/i,
  );
  assert.match(
    migration,
    /message\.room_id = p_room_id[\s\S]*message\.visibility_status = 'visible'[\s\S]*post\.room_id = p_room_id[\s\S]*post\.visibility_status = 'visible'/i,
  );
});

test("browser-facing member summaries expose only opaque public presentation fields", () => {
  const migration = read(migrationPath);
  const types = read("lib/live-room/types.ts");
  const jsonProjection =
    migration.match(
      /'publicProfileId', member\.public_profile_id[\s\S]*?'receivedLikeCount', member\.received_like_count/,
    )?.[0] ?? "";

  assert.ok(jsonProjection);
  assert.doesNotMatch(
    jsonProjection,
    /user_id|member_user_id|email|guest_session|actor_id/i,
  );
  assert.match(
    types,
    /export type LiveRoomMemberSummary = \{[\s\S]*publicProfileId: string;[\s\S]*displayName: string;|export type LiveRoomMemberSummary = \{[\s\S]*displayName: string;[\s\S]*publicProfileId: string;/,
  );
  assert.match(
    types,
    /LiveRoomMemberSummary[\s\S]*followerCount: number;[\s\S]*isOnline: boolean;[\s\S]*plan: Plan;[\s\S]*postCount: number;[\s\S]*receivedLikeCount: number;[\s\S]*socialBadges: LiveRoomSocialBadge\[\]/,
  );
  assert.doesNotMatch(
    types.match(
      /export type LiveRoomMemberSummary = \{[\s\S]*?\n\};/,
    )?.[0] ?? "",
    /userId|email|actorId|guestSession/i,
  );
});

test("desktop and mobile share compact 340px-safe member rows", () => {
  const panel = read(
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
  );
  const client = read("components/live-room/LiveRoomClient.tsx");
  const styles = read("components/live-room/LiveRoom.module.css");

  assert.match(
    styles,
    /\.workspaceLayout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 340px;/,
  );
  assert.match(
    panel,
    /BadgeCheck[\s\S]*Verified creator:[\s\S]*<MemberPlanBadge plan=\{summary\.plan\}[\s\S]*summary\.isOnline/,
  );
  assert.match(
    panel,
    /visibleMembers = members\.flatMap\([\s\S]*summaries\.get\(member\.publicProfileId\)[\s\S]*return summary \? \[\{ member, summary \}\] : \[\]/,
  );
  assert.match(
    panel,
    /Followers[\s\S]*FileText[\s\S]*Posts[\s\S]*Heart[\s\S]*Received likes/i,
  );
  assert.match(
    panel,
    /aria-label=\{`\$\{summary\.followerCount\} followers,[\s\S]*received likes`\}/,
  );
  assert.match(
    client,
    /<LiveRoomDesktopSidePanel[\s\S]*memberSummaries=\{memberSummaries\}/,
  );
  assert.match(
    client,
    /mobileSheet === "members"[\s\S]*<LiveRoomMemberList[\s\S]*memberSummaries=\{memberSummaries\}/,
  );
  assert.match(
    styles,
    /\.sidePanelMemberProfile \.sidePanelAvatar\s*\{[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;/,
  );
  assert.match(
    styles,
    /\.sidePanelMember\s*\{[\s\S]*display:\s*flex;[\s\S]*min-width:\s*0;[\s\S]*align-items:\s*center;/,
  );
  assert.match(
    styles,
    /\.sidePanelMemberActions\s*\{[\s\S]*display:\s*flex;[\s\S]*flex:\s*0 0 auto;/,
  );
  assert.match(
    styles,
    /\.sidePanelMemberActions a,\s*\.sidePanelMemberActions button\s*\{[\s\S]*width:\s*30px;[\s\S]*min-width:\s*30px;[\s\S]*padding:\s*0;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*\.sidePanelMemberActions a,\s*\.sidePanelMemberActions button\s*\{[\s\S]*width:\s*28px;[\s\S]*min-width:\s*28px;[\s\S]*padding:\s*0;/,
  );
  assert.match(
    styles,
    /\.sidePanelMemberStats\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*white-space:\s*nowrap;/,
  );
});

test("actual member-grade surfaces share one compact six-plan badge contract", () => {
  const timeline = read("components/live-room/ChatTimeline.tsx");
  const panel = read(
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
  );
  const directMessage = read(
    "components/direct-messages/DirectMessageClient.tsx",
  );
  const community = read("components/community/CommunityHubClient.tsx");
  const account = read("app/account/page.tsx");
  const badge = read("components/ui/MemberPlanBadge.tsx");
  const styles = read("components/ui/MemberPlanBadge.module.css");
  const tokens = read("app/stock-radar-tokens.css");

  const planContracts = [
    ["free", "free", "#fafbfc", "#e7ebf0", "#c9d0d9", "#5f6875"],
    ["ad_free", "ad-free", "#ecfbf8", "#d0f0e9", "#83ccbe", "#21796d"],
    ["pro", "pro", "#eff5ff", "#d3e2ff", "#7fa8ea", "#315f9f"],
    ["advanced", "advanced", "#fff4e5", "#ffd39c", "#f2a34a", "#b85a08"],
    ["ultimate", "ultimate", "#f6efff", "#dec9ff", "#a982e4", "#7042af"],
  ] as const;

  assert.match(
    styles,
    /\.badge\s*\{[\s\S]*height:\s*var\(--sr-space-4-5\);[\s\S]*border:[\s\S]*var\(--sr-color-text-meta\);[\s\S]*border-radius:\s*var\(--sr-radius-chat-control\);[\s\S]*color:\s*var\(--sr-color-text-meta\);[\s\S]*background:\s*var\(--sr-color-surface-control-strong\);[\s\S]*font-size:\s*var\(--sr-font-size-plan-badge\);/,
  );
  assert.match(badge, /data-plan=\{plan\}/);
  assert.match(badge, /plan === "visitor" \? "Visitor" : getPlanDisplayName\(plan\)/);
  assert.match(
    timeline,
    /<MemberPlanBadge[\s\S]*item\.author\.isGuest \? "visitor" : item\.author\.plan/,
  );
  assert.match(panel, /<MemberPlanBadge plan=\{summary\.plan\}/);
  assert.match(
    directMessage,
    /<MemberPlanBadge plan=\{conversation\.peer\.plan\}/,
  );
  assert.match(community, /<MemberPlanBadge plan=\{plan\}/);
  assert.match(
    account,
    /<MemberPlanBadge[\s\S]*className=\{styles\.accountPlanBadge\}[\s\S]*plan=\{plan\.effectivePlan\}[\s\S]*suffix=\{plan\.planSource === "trial" \? " trial" : ""\}/,
  );
  for (const [plan, token, start, end, border, text] of planContracts) {
    assert.match(
      styles,
      new RegExp(
        `\\.badge\\[data-plan="${plan}"\\] \\{[\\s\\S]*--member-plan-gradient-start:\\s*var\\(--sr-color-plan-${token}-gradient-start\\);[\\s\\S]*--member-plan-gradient-end:\\s*var\\(--sr-color-plan-${token}-gradient-end\\);[\\s\\S]*--member-plan-border:\\s*var\\(--sr-color-plan-${token}-border\\);[\\s\\S]*--member-plan-text:\\s*var\\(--sr-color-plan-${token}-text\\);`,
      ),
    );
    for (const [suffix, value] of [
      ["gradient-start", start],
      ["gradient-end", end],
      ["border", border],
      ["text", text],
    ] as const) {
      assert.match(
        tokens,
        new RegExp(
          `--sr-color-plan-${token}-${suffix}:\\s*${value}`,
          "i",
        ),
      );
    }
  }
  assert.match(styles, /background:\s*linear-gradient\(/);
  assert.match(styles, /box-shadow:\s*var\(--sr-shadow-plan-badge-highlight\)/);
  assert.match(tokens, /--sr-font-size-plan-badge:\s*10px/);
  assert.doesNotMatch(
    styles,
    /#[\da-f]{3,8}|font-size:\s*\d/i,
  );
});

function read(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
