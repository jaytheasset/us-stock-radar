import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  rolesHavePermission,
  visibleAdminNavigation,
} from "./policy.ts";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "supabase/migrations/20260729195029_admin_foundation_v1.sql",
);
const operationsMigration = read(
  "supabase/migrations/20260730040144_admin_operations_v2.sql",
);
const orphanBackfillMigration = read(
  "supabase/migrations/20260730051040_admin_moderation_orphan_backfill.sql",
);
const roomControlsMigration = read(
  "supabase/migrations/20260730110605_admin_room_controls_v3.sql",
);
const telegramCampaignMigration = read(
  "supabase/migrations/20260801105641_admin_telegram_campaigns.sql",
);
const telegramLeaseMigration = read(
  "supabase/migrations/20260801124443_admin_telegram_delivery_leases.sql",
);
const adminLayout = read("app/admin/layout.tsx");
const adminServer = read("lib/admin/server.ts");
const adminApi = read("lib/admin/api.ts");
const dashboardRepository = read("lib/admin/dashboard.ts");
const dashboardPage = read("app/admin/page.tsx");
const usersRepository = read("lib/admin/users.ts");
const moderationRepository = read("lib/admin/moderation.ts");
const auditRepository = read("lib/admin/audit.ts");
const operationsRepository = read("lib/admin/operations.ts");
const adminListApi = read("app/api/admin/creator-verifications/route.ts");
const adminMutationApi = read(
  "app/api/admin/creator-verifications/[requestId]/route.ts",
);
const userCommunityMutationApi = read(
  "app/api/admin/users/[userId]/community-status/route.ts",
);
const moderationMutationApi = read(
  "app/api/admin/moderation/[caseId]/route.ts",
);
const roleMutationApi = read("app/api/admin/roles/route.ts");
const globeRunApi = read("app/api/admin/sources/globe/run/route.ts");
const globeIngestPanel = read("app/admin/news-ingest/GlobeIngestPanel.tsx");
const roomMutationApi = read(
  "app/api/admin/rooms/[roomId]/status/route.ts",
);
const telegramCreateApi = read("app/api/admin/telegram-campaigns/route.ts");
const telegramMutationApi = read(
  "app/api/admin/telegram-campaigns/[campaignId]/route.ts",
);
const telegramAiApi = read(
  "app/api/admin/telegram-campaigns/ai-draft/route.ts",
);
const telegramLocalDueApi = read(
  "app/api/admin/telegram-campaigns/run-due/route.ts",
);
const telegramDelivery = read("lib/admin/telegramCampaignDelivery.ts");
const telegramEditor = read(
  "components/admin/AdminTelegramCampaignEditor.tsx",
);
const telegramAiRuntime = read("lib/admin/telegramCampaignAi.ts");
const roomsRepository = read("lib/admin/rooms.ts");
const adminShell = read("components/admin/AdminShell.tsx");
const legacyAdminPages = [
  "app/admin/creator-verifications/page.tsx",
  "app/admin/db/page.tsx",
  "app/admin/event-types/page.tsx",
  "app/admin/integrations/page.tsx",
  "app/admin/news-ingest/page.tsx",
  "app/admin/prompts/page.tsx",
  "app/admin/prompts/news-event-test/page.tsx",
  "app/admin/sources/page.tsx",
  "app/admin/taxonomy/page.tsx",
].map(read);
const v2AdminPages = [
  "app/admin/alerts/page.tsx",
  "app/admin/audit/page.tsx",
  "app/admin/moderation/page.tsx",
  "app/admin/moderation/[caseId]/page.tsx",
  "app/admin/roles/page.tsx",
  "app/admin/users/page.tsx",
  "app/admin/users/[userId]/page.tsx",
].map(read);

test("anonymous users and ordinary members are rejected before admin content renders", () => {
  assert.match(adminLayout, /requireAdminPageAccess\(\)/);
  assert.match(adminServer, /redirect\("\/login\?next=%2Fadmin"\)/);
  assert.match(
    adminServer,
    /if \(!access\) redirect\("\/login\?next=%2Fadmin&reason=admin_required"\)/,
  );
  assert.doesNotMatch(adminServer, /redirect\("\/"\)/);
  assert.doesNotMatch(adminServer, /user_metadata|app_metadata/);
});

test("admin exit links return to the current markets dashboard", () => {
  assert.equal(
    (adminShell.match(/href="\/dashboard-v2"/g) || []).length,
    2,
  );
  assert.doesNotMatch(adminShell, /href="\/"/);
});

test("legacy active admins retain access during RBAC migration", () => {
  assert.match(
    migration,
    /from public\.live_room_moderators[\s\S]*role = 'admin'[\s\S]*active = true/i,
  );
  assert.match(migration, /'super_admin'/);
  assert.match(
    adminServer,
    /legacy[\s\S]*active admins[\s\S]*roles: \["super_admin"\]/i,
  );
});

test("roles expose only their intended navigation and permissions", () => {
  assert.equal(rolesHavePermission(["super_admin"], "billing.read"), true);
  assert.equal(rolesHavePermission(["operations"], "data.read"), true);
  assert.equal(rolesHavePermission(["operations"], "billing.read"), false);
  assert.equal(rolesHavePermission(["moderator"], "moderation.read"), true);
  assert.equal(
    rolesHavePermission(["verification_reviewer"], "verifications.review"),
    true,
  );
  assert.equal(rolesHavePermission(["support"], "users.read"), true);
  assert.equal(rolesHavePermission(["billing"], "users.read"), false);

  const moderationNavigation = visibleAdminNavigation(["moderator"]);
  assert.deepEqual(
    moderationNavigation.map((item) => item.href),
    [
      "/admin",
      "/admin/users",
      "/admin/moderation",
      "/admin/rooms",
      "/admin/audit",
    ],
  );
  assert.equal(rolesHavePermission(["moderator"], "moderation.write"), true);
  assert.equal(rolesHavePermission(["support"], "users.enforce"), false);
  assert.equal(rolesHavePermission(["operations"], "roles.manage"), false);
  assert.deepEqual(
    visibleAdminNavigation(["super_admin"]).map((item) => item.href),
    [
      "/admin",
      "/admin/users",
      "/admin/moderation",
      "/admin/rooms",
      "/admin/telegram-channel",
      "/admin/creator-verifications",
      "/admin/data",
      "/admin/alerts",
      "/admin/billing",
      "/admin/integrations",
      "/admin/audit",
      "/admin/roles",
    ],
  );
});

test("Telegram Channel operations use dedicated permissions and server-only mutations", () => {
  assert.equal(rolesHavePermission(["operations"], "telegram.read"), true);
  assert.equal(rolesHavePermission(["operations"], "telegram.write"), true);
  assert.equal(rolesHavePermission(["operations"], "telegram.send"), true);
  assert.equal(rolesHavePermission(["moderator"], "telegram.read"), false);
  assert.equal(rolesHavePermission(["support"], "telegram.send"), false);
  assert.match(
    telegramCreateApi,
    /resolveAdminApiAccess\(request, "telegram\.write"\)/,
  );
  assert.match(
    telegramMutationApi,
    /"send_now",[\s\S]*"mark_delivered",[\s\S]*"confirm_not_delivered"[\s\S]*\? "telegram\.send"/,
  );
  assert.match(
    telegramAiApi,
    /resolveAdminApiAccess\(request, "telegram\.write"\)/,
  );
  assert.match(
    telegramLocalDueApi,
    /resolveAdminApiAccess\(request, "telegram\.send"\)/,
  );
  for (const route of [
    telegramCreateApi,
    telegramMutationApi,
    telegramAiApi,
    telegramLocalDueApi,
  ]) {
    assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  }
});

test("Telegram delivery claims expire safely and require operator reconciliation", () => {
  assert.match(
    telegramLeaseMigration,
    /pg_catalog\.make_interval\(mins => 10\)/,
  );
  assert.match(telegramLeaseMigration, /lease_expires_at timestamptz/i);
  assert.match(telegramLeaseMigration, /for update skip locked/i);
  assert.match(
    telegramLeaseMigration,
    /status = 'failed'[\s\S]*delivery_outcome = 'uncertain'[\s\S]*retry_allowed = false/i,
  );
  assert.match(
    telegramLeaseMigration,
    /telegram_campaign\.delivery_lease_expired/i,
  );
  assert.match(
    telegramLeaseMigration,
    /p_reconciliation not in \('delivered', 'not_delivered'\)/i,
  );
  assert.match(
    telegramLeaseMigration,
    /telegram_send_invoked', false/i,
  );
  assert.doesNotMatch(
    telegramLeaseMigration,
    /sendTelegramMessage|api\.telegram\.org/i,
  );
  assert.match(
    telegramLeaseMigration,
    /revoke all on function public\.expire_admin_telegram_campaign_leases[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(
    telegramDelivery,
    /runDueAdminTelegramCampaigns[\s\S]*const expiredLeases = await expireAdminTelegramCampaignLeases\(50\);[\s\S]*const configuration = resolveDeliveryConfiguration\(transport\);/,
  );
  assert.match(telegramMutationApi, /reconcileAdminTelegramCampaign/);
  assert.match(telegramEditor, /Mark as delivered/);
  assert.match(telegramEditor, /Confirm not delivered/);
  assert.match(telegramEditor, /leaseActive/);
  assert.match(telegramEditor, /Neither action sends a Telegram message/);
});

test("Telegram campaigns are service-only, audited, and claimed atomically", () => {
  assert.match(
    telegramCampaignMigration,
    /alter table public\.admin_telegram_campaigns enable row level security/i,
  );
  assert.match(
    telegramCampaignMigration,
    /revoke all on table public\.admin_telegram_campaigns\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    telegramCampaignMigration,
    /grant select, insert, update on table public\.admin_telegram_campaigns\s+to service_role/i,
  );
  assert.match(telegramCampaignMigration, /for update skip locked/i);
  assert.match(telegramCampaignMigration, /attempt_token uuid/i);
  assert.match(
    telegramCampaignMigration,
    /p_outcome not in \('sent', 'not_sent', 'uncertain'\)/i,
  );
  assert.match(telegramCampaignMigration, /retry_allowed = p_outcome = 'not_sent'/i);
  assert.match(
    telegramCampaignMigration,
    /insert into public\.admin_audit_logs/g,
  );
  assert.doesNotMatch(
    telegramCampaignMigration,
    /delete\s+from\s+public\.admin_telegram_campaigns/i,
  );
});

test("Telegram provider credentials stay server-side and tests cannot hit the public channel", () => {
  assert.match(telegramDelivery, /sendTelegramMessage/);
  assert.match(telegramDelivery, /createLocalAdminTelegramMockTransport/);
  assert.match(telegramLocalDueApi, /process\.env\.NODE_ENV === "production"/);
  assert.match(telegramLocalDueApi, /RUN LOCAL MOCK/);
  assert.match(telegramLocalDueApi, /createLocalAdminTelegramMockTransport\(\)/);
  assert.doesNotMatch(
    `${telegramCreateApi}\n${telegramMutationApi}\n${telegramAiApi}`,
    /telegramBotToken|telegramPublicChannelId|TELEGRAM_BOT_TOKEN|TELEGRAM_PUBLIC_CHANNEL_ID/,
  );
  assert.doesNotMatch(
    telegramCampaignMigration,
    /bot_token|channel_id|chat_id|api_key/i,
  );
});

test("AI drafting is rate-limited, schema-constrained, audited, and review-only", () => {
  assert.match(telegramCampaignMigration, /telegram_campaign\.ai_draft_requested/);
  assert.match(telegramCampaignMigration, /interval '1 hour'/);
  assert.match(telegramCampaignMigration, /v_count >= 20/);
  assert.match(telegramAiRuntime, /ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA/);
  assert.match(telegramAiRuntime, /claimAdminTelegramAiDraft/);
  assert.match(telegramAiRuntime, /finishAdminTelegramAiDraft/);
  assert.doesNotMatch(
    telegramAiRuntime,
    /saveAdminTelegramCampaign|scheduleAdminTelegramCampaign|sendAdminTelegramCampaignNow/,
  );
});

test("source runs use a reasoned admin server path without exposing ingest secrets", () => {
  assert.equal(rolesHavePermission(["operations"], "data.run"), true);
  assert.equal(rolesHavePermission(["moderator"], "data.run"), false);
  assert.match(
    globeRunApi,
    /resolveAdminApiAccess\(request, "data\.run"\)/,
  );
  assert.match(globeRunApi, /assertSameOriginAuthRequest\(request\)/);
  assert.match(globeRunApi, /runAdminGlobeIngest/);
  assert.doesNotMatch(
    globeIngestPanel,
    /\/api\/sources\/globe\/ingest|SOURCE_INGEST_INTERNAL_SECRET|CRON_SECRET/,
  );
  assert.match(
    globeIngestPanel,
    /\/api\/admin\/sources\/globe\/run/,
  );
  assert.match(globeIngestPanel, /FORCE REANALYZE/);
  assert.match(roomControlsMigration, /admin_record_source_run_audit/);
  assert.match(
    roomControlsMigration,
    /private\.admin_actor_role\([\s\S]*'super_admin', 'operations'/,
  );
  assert.match(roomControlsMigration, /admin_audit_logs/);
});

test("Live Room admin controls are permissioned, audited, and soft-state only", () => {
  assert.equal(rolesHavePermission(["operations"], "rooms.manage"), true);
  assert.equal(rolesHavePermission(["moderator"], "rooms.manage"), true);
  assert.equal(rolesHavePermission(["support"], "rooms.manage"), false);
  assert.match(
    roomMutationApi,
    /resolveAdminApiAccess\(request, "rooms\.manage"\)/,
  );
  assert.match(roomMutationApi, /assertSameOriginAuthRequest\(request\)/);
  assert.match(roomsRepository, /admin_list_live_rooms/);
  assert.match(roomsRepository, /admin_get_live_room_detail/);
  assert.match(roomsRepository, /admin_set_live_room_status/);
  assert.match(
    roomControlsMigration,
    /p_action not in \('lock', 'unlock', 'archive', 'restore'\)/,
  );
  assert.match(
    roomControlsMigration,
    /insert into public\.admin_audit_logs[\s\S]*'live_room\.' \|\| p_action/,
  );
  assert.doesNotMatch(
    `${roomControlsMigration}\n${roomsRepository}\n${roomMutationApi}`,
    /hard_delete|delete\s+from\s+public\.live_room_rooms|direct_message|account_number|user_secret/i,
  );
});

test("room state enforcement is additive and blocks every new public write path", () => {
  assert.match(
    roomControlsMigration,
    /add column if not exists admin_status text not null default 'active'/,
  );
  for (const table of [
    "live_room_messages",
    "live_room_posts",
    "live_room_post_comments",
    "live_room_memberships",
  ]) {
    assert.match(
      roomControlsMigration,
      new RegExp(`${table}_enforce_room_writable`, "i"),
    );
  }
  assert.match(roomControlsMigration, /LIVE_ROOM_LOCKED/);
  assert.match(roomControlsMigration, /LIVE_ROOM_ARCHIVED/);
  assert.match(
    roomControlsMigration,
    /revoke all on function public\.admin_set_live_room_status[\s\S]*from public, anon, authenticated/i,
  );
});

test("new admin tables are service-only, RLS-enabled, and audit logs are append-only", () => {
  assert.match(migration, /create table if not exists public\.admin_role_assignments/i);
  assert.match(migration, /create table if not exists public\.admin_audit_logs/i);
  assert.match(
    migration,
    /alter table public\.admin_role_assignments enable row level security/i,
  );
  assert.match(
    migration,
    /alter table public\.admin_audit_logs enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.admin_role_assignments\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.admin_audit_logs\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant select, insert on table public\.admin_audit_logs to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:all|update|delete)[^;]*admin_audit_logs\s+to\s+service_role/i,
  );
});

test("admin APIs perform a server permission check on every request", () => {
  assert.match(adminListApi, /assertSocialVerificationAdmin\(resolution\.userId\)/);
  assert.match(
    adminMutationApi,
    /assertSocialVerificationAdmin\(resolution\.userId\)/,
  );
  assert.match(adminMutationApi, /assertSameOriginAuthRequest\(request\)/);
  assert.match(
    userCommunityMutationApi,
    /resolveAdminApiAccess\(request, "users\.enforce"\)/,
  );
  assert.match(
    moderationMutationApi,
    /resolveAdminApiAccess\(request, "moderation\.write"\)/,
  );
  assert.match(
    roleMutationApi,
    /resolveAdminApiAccess\(request, "roles\.manage"\)/,
  );
  for (const mutation of [
    userCommunityMutationApi,
    moderationMutationApi,
    roleMutationApi,
  ]) {
    assert.match(mutation, /assertSameOriginAuthRequest\(request\)/);
  }
  assert.doesNotMatch(adminApi, /user_metadata|app_metadata/);
});

test("admin v2 operation tables are RLS protected and service-role only", () => {
  for (const table of [
    "user_community_status",
    "user_community_enforcement_actions",
    "admin_moderation_cases",
    "admin_moderation_case_events",
  ]) {
    assert.match(
      operationsMigration,
      new RegExp(`create table public\\.${table}`, "i"),
    );
    assert.match(
      operationsMigration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      operationsMigration,
      new RegExp(
        `revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    operationsMigration,
    /grant\s+(?:all|update|delete)[^;]*user_community_enforcement_actions\s+to\s+service_role/i,
  );
  assert.doesNotMatch(
    operationsMigration,
    /grant\s+(?:all|update|delete)[^;]*admin_moderation_case_events\s+to\s+service_role/i,
  );
});

test("community enforcement is reasoned, audited, and separate from Auth", () => {
  assert.match(
    operationsMigration,
    /p_action not in \('warning', 'temporary_suspend', 'permanent_suspend', 'unsuspend'\)/,
  );
  assert.match(operationsMigration, /ADMIN_REASON_REQUIRED/);
  assert.match(operationsMigration, /ADMIN_SELF_ENFORCEMENT_FORBIDDEN/);
  assert.match(
    operationsMigration,
    /insert into public\.admin_audit_logs[\s\S]*community_status/i,
  );
  assert.doesNotMatch(
    `${operationsMigration}\n${usersRepository}`,
    /auth\.admin\.deleteUser|\/auth\/v1\/admin\/users\/[^`'"]+\/password/i,
  );
  assert.match(usersRepository, /ADMIN_USER_ACTION_UNSUPPORTED/);
  assert.match(
    usersRepository,
    /temporary_suspend[\s\S]*permanent_suspend[\s\S]*unsuspend/,
  );
});

test("all four raw report sources feed one moderation queue without deleting evidence", () => {
  for (const source of [
    "live_room_message_reports",
    "live_room_post_reports",
    "live_room_post_comment_reports",
    "live_room_direct_message_reports",
  ]) {
    assert.match(
      operationsMigration,
      new RegExp(`${source}_create_admin_case`, "i"),
    );
    assert.doesNotMatch(
      operationsMigration,
      new RegExp(`delete\\s+from\\s+public\\.${source}`, "i"),
    );
  }
  assert.match(
    operationsMigration,
    /status in \('open', 'in_review', 'resolved', 'dismissed'\)/,
  );
  assert.match(
    operationsMigration,
    /severity in \('low', 'normal', 'high', 'critical'\)/,
  );
  assert.match(operationsMigration, /target_snapshot jsonb not null/);
  for (const action of [
    "dismiss",
    "hide_content",
    "restore_content",
    "warn_user",
    "temporary_suspend",
    "permanent_suspend",
  ]) {
    assert.match(operationsMigration, new RegExp(`'${action}'`));
  }
  assert.match(
    moderationRepository,
    /live_room_message_reports[\s\S]*live_room_post_reports[\s\S]*live_room_post_comment_reports[\s\S]*live_room_direct_message_reports/,
  );
  assert.equal(
    (orphanBackfillMigration.match(/left join public\.live_room_/g) || [])
      .length,
    4,
  );
  assert.equal(
    (orphanBackfillMigration.match(/'evidence_missing', true/g) || []).length,
    4,
  );
});

test("role mutations stay database-backed and are included in the audit trail", () => {
  assert.match(operationsMigration, /create function public\.admin_set_role_assignment/);
  assert.match(operationsMigration, /ADMIN_SELF_ROLE_CHANGE_FORBIDDEN/);
  assert.match(operationsMigration, /ADMIN_LAST_SUPER_ADMIN_REQUIRED/);
  assert.match(
    operationsMigration,
    /insert into public\.admin_audit_logs[\s\S]*admin_role_assignment/i,
  );
  assert.doesNotMatch(
    `${operationsMigration}\n${auditRepository}\n${roleMutationApi}`,
    /user_metadata|app_metadata/,
  );
});

test("user lookup includes required summaries and never queries brokerage secrets", () => {
  assert.match(usersRepository, /email: `ilike\.\*\$\{safeLike\}\*`/);
  assert.match(usersRepository, /display_name: `ilike\.\*\$\{safeLike\}\*`/);
  assert.match(usersRepository, /public_profile_id\.eq/);
  assert.match(usersRepository, /last_sign_in_at/);
  assert.match(usersRepository, /live_room_memberships/);
  assert.match(usersRepository, /live_room_member_follows/);
  assert.match(usersRepository, /live_room_social_verifications/);
  assert.match(usersRepository, /user_delivery_channels/);
  assert.match(usersRepository, /user_alert_tickers/);
  assert.match(
    usersRepository,
    /user_id,provider,status,has_live_account,has_paper_account,connected_at,last_synced_at,disconnected_at/,
  );
  assert.doesNotMatch(
    usersRepository,
    /userSecret|user_secret|account_number|accountNumber|position|balance|trade_history|transactions/,
  );
});

test("source and alert failure details remain read-only", () => {
  assert.match(operationsRepository, /status: "eq\.failed"/);
  assert.match(operationsRepository, /delivery_status: "eq\.failed"/);
  assert.doesNotMatch(
    operationsRepository,
    /supabaseRpc|insert|update|delete|retry/i,
  );
  assert.doesNotMatch(
    dashboardRepository,
    /trial_plan[\s\S]{0,120}Pro only/i,
  );
});

test("dashboard query failures degrade individual signals instead of crashing the page", () => {
  assert.match(dashboardRepository, /async function safeSelect/);
  assert.match(dashboardRepository, /catch \(error\)/);
  assert.match(dashboardRepository, /degradedSources/);
  assert.match(dashboardPage, /Some operational data is unavailable/);
  assert.match(dashboardPage, /item\.degraded \? "Unavailable"/);
});

test("admin routes are dynamic and excluded from indexing", () => {
  assert.match(adminLayout, /dynamic = "force-dynamic"/);
  assert.match(adminLayout, /revalidate = 0/);
  assert.match(adminLayout, /index: false/);
  assert.match(adminLayout, /nocache: true/);
});

test("AdminShell owns the only admin main landmark", () => {
  assert.equal((adminShell.match(/<main\b/g) || []).length, 1);
  assert.equal((adminShell.match(/<\/main>/g) || []).length, 1);
  for (const page of [...legacyAdminPages, ...v2AdminPages]) {
    assert.doesNotMatch(page, /<\/?main\b/);
  }
});

test("legacy data screens use the shared AdminShell surface", () => {
  for (const page of legacyAdminPages) {
    assert.doesNotMatch(page, /className="(?:shell|topbar)"/);
    assert.doesNotMatch(page, /\uFFFD/);
  }
});
