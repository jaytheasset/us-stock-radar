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
const adminLayout = read("app/admin/layout.tsx");
const adminServer = read("lib/admin/server.ts");
const dashboardRepository = read("lib/admin/dashboard.ts");
const dashboardPage = read("app/admin/page.tsx");
const adminListApi = read("app/api/admin/creator-verifications/route.ts");
const adminMutationApi = read(
  "app/api/admin/creator-verifications/[requestId]/route.ts",
);
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

test("anonymous users and ordinary members are rejected before admin content renders", () => {
  assert.match(adminLayout, /requireAdminPageAccess\(\)/);
  assert.match(adminServer, /redirect\("\/login\?next=%2Fadmin"\)/);
  assert.match(adminServer, /if \(!access\) redirect\("\/"\)/);
  assert.doesNotMatch(adminServer, /user_metadata|app_metadata/);
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
    ["/admin", "/admin/moderation"],
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
    /revoke all on table public\.admin_audit_logs from public, anon, authenticated/i,
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
  for (const page of legacyAdminPages) {
    assert.doesNotMatch(page, /<\/?main\b/);
  }
});
