import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

const adminPage = read("app/admin/data/ticker-resolution/page.tsx");
const secPage = read("app/development/sec/TickerResolutionEvidence.tsx");
const secClient = read("app/development/sec/SecDevelopmentClient.tsx");
const secRoute = read("app/api/development/sec-form-room/route.ts");
const humanClient = read("components/admin/TickerResolutionHumanReview.tsx");
const humanRoute = read("app/api/admin/data/ticker-resolution/[decisionId]/human-review/route.ts");
const humanReader = read("lib/sec-ticker-resolution/humanReview.ts");
const humanMigration = read(
  "supabase/migrations/20260913064018_sec_ticker_resolution_human_review_v1.sql",
);

test("admin resolution page uses system.read and the effective validated reader", () => {
  assert.match(adminPage, /requireAdminPermission\("system\.read"\)/);
  assert.match(adminPage, /rolesHavePermission\(access\.roles, "data\.run"\)/);
  assert.match(adminPage, /listSecTickerResolutions/);
  assert.match(adminPage, /readEffectiveSecTickerResolutionByDecisionId/);
  assert.match(adminPage, /TickerResolutionHumanReview/);
  assert.match(adminPage, /Controlled review/);
  assert.match(humanClient, /props\.canWrite[\s\S]*Record a decision/);
  assert.match(adminPage, /<form[^>]+key=\{filterHref\(\{ query, state \}\)\}/);
  assert.doesNotMatch(adminPage, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("human review write route reuses same-origin, data.run, and session actor protections", () => {
  assert.match(humanRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(humanRoute, /resolveAdminApiAccess\(request, "data\.run"\)/);
  assert.match(humanRoute, /actorUserId: resolution\.access\.userId/);
  assert.doesNotMatch(humanRoute, /body\?\.actor|actorUserId:\s*body/);
  assert.match(humanRoute, /X-Request-Id|x-request-id/i);
  assert.match(humanRoute, /readEffectiveSecTickerResolutionByDecisionId/);
});

test("human decisions are append-only, atomic with audit, and service-only", () => {
  assert.match(humanMigration, /create table public\.sec_ticker_resolution_human_decisions/);
  assert.match(humanMigration, /before update or delete[\s\S]*append-only/i);
  assert.match(humanMigration, /enable row level security/);
  assert.match(
    humanMigration,
    /revoke all on table public\.sec_ticker_resolution_human_decisions[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    humanMigration,
    /grant select, insert on table public\.sec_ticker_resolution_human_decisions to service_role/,
  );
  assert.match(
    humanMigration,
    /insert into public\.admin_audit_logs[\s\S]*insert into public\.sec_ticker_resolution_human_decisions/,
  );
  assert.match(humanMigration, /ADMIN_TICKER_IDEMPOTENCY_CONFLICT/);
  assert.match(humanMigration, /ADMIN_TICKER_HUMAN_REVISION_CONFLICT/);
  assert.doesNotMatch(humanMigration, /for update/i);
});

test("reviewed is non-decisive and approval has no free ticker escape hatch", () => {
  assert.match(humanReader, /action === "reviewed"[\s\S]*prior\?\.resultingEffectiveAction/);
  assert.match(humanReader, /APPROVABLE_REASONS = new Set\(\["EFFECTIVE_DATE_CONFLICT"\]\)/);
  assert.match(humanClient, /No ticker[\s\S]*can be entered manually/);
  assert.doesNotMatch(humanClient, /name=["']ticker|placeholder=["'](?:ticker|symbol)/i);
  assert.match(humanClient, /Withdraw current human decision/);
});

test("SEC console keeps ticker resolution in a separate read-only tab", () => {
  assert.match(secClient, /\["resolution", "Ticker Resolution"\]/);
  assert.match(secClient, /tab !== "filing-ui" && tab !== "resolution"/);
  assert.match(secClient, /TickerResolutionEvidence/);
  assert.match(
    secClient,
    /function isTabKey[\s\S]*?"filing-ui",\s*"resolution",[\s\S]*?\.includes\(value\)/,
  );
  assert.match(secPage, /independently of site AI analysis results/);
  assert.match(secPage, /sourceDocument/);
  assert.match(secPage, /sourceSha256/);
  assert.match(secPage, /<dt>Source URL<\/dt>/);
  assert.match(secPage, /tradingSymbolStatus/);
  assert.doesNotMatch(secPage, /fetch\([^)]*\{[\s\S]*method:\s*"(POST|PUT|PATCH|DELETE)"/);
});

test("resolution API is development-only, system.read guarded, exact-ID bound, and GET-only", () => {
  assert.match(secRoute, /process\.env\.NODE_ENV === "production"/);
  assert.match(secRoute, /respondWithAdminReadAccess\(request, "system\.read"/);
  assert.match(secRoute, /readSecTickerResolutionByDecisionId\(\{ decisionId: resolutionId \}\)/);
  assert.match(secRoute, /view === "resolution"/);
  assert.match(secRoute, /resolution\.reason === "invalid_decision_id"/);
  assert.doesNotMatch(secRoute, /export async function (POST|PUT|PATCH|DELETE)/);
});
