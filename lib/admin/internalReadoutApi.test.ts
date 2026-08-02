import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { rolesHavePermission } from "./policy.ts";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const adminApi = read("lib/admin/api.ts");
const publicHealth = read("app/api/health/route.ts");
const detailedHealth = read("app/api/admin/system/health/route.ts");

const protectedRoutes = [
  {
    path: "app/api/prompts/registry/route.ts",
    permission: "system.read",
    loader: "getPromptRegistry",
  },
  {
    path: "app/api/db/registry/route.ts",
    permission: "data.read",
    loader: "getDbReadout",
  },
  {
    path: "app/api/integrations/registry/route.ts",
    permission: "system.read",
    loader: "getIntegrationRegistry",
  },
  {
    path: "app/api/integrations/health/route.ts",
    permission: "system.read",
    loader: "probeAllIntegrations",
  },
  {
    path: "app/api/sources/registry/route.ts",
    permission: "data.read",
    loader: "getSourceJobRegistry",
  },
  {
    path: "app/api/openai/status/route.ts",
    permission: "system.read",
    loader: "probeOpenAI",
  },
] as const;

test("admin read access resolves anonymous, unauthorized, and permitted requests as 401/403/200", () => {
  assert.match(
    adminApi,
    /if \(!userId\)[\s\S]*"ADMIN_AUTH_REQUIRED"[\s\S]*401/,
  );
  assert.match(
    adminApi,
    /if \(!access \|\| !rolesHavePermission\(access\.roles, permission\)\)[\s\S]*"ADMIN_PERMISSION_REQUIRED"[\s\S]*403/,
  );
  assert.match(adminApi, /return \{ access, auth \};/);
  assert.equal(rolesHavePermission([], "system.read"), false);
  assert.equal(rolesHavePermission(["billing"], "system.read"), false);
  assert.equal(rolesHavePermission(["operations"], "system.read"), true);
  assert.equal(rolesHavePermission(["operations"], "data.read"), true);
  assert.equal(rolesHavePermission(["super_admin"], "system.read"), true);
});

test("the shared handler authenticates before invoking a protected loader", () => {
  const resolverIndex = adminApi.indexOf(
    "resolution = await resolveAdminApiAccess(request, permission)",
  );
  const loaderIndex = adminApi.indexOf("const data = await read()", resolverIndex);
  assert.ok(resolverIndex >= 0, "admin access resolver is missing");
  assert.ok(loaderIndex > resolverIndex, "loader must run only after authorization");
  assert.match(
    adminApi,
    /"Cache-Control": "private, no-store, max-age=0"/,
  );
  assert.match(adminApi, /Vary: "Cookie, Authorization"/);
});

for (const route of protectedRoutes) {
  test(`${route.path} uses a guarded GET and HEAD`, () => {
    const source = read(route.path);
    assert.match(source, /export async function GET\(request: NextRequest\)/);
    assert.match(source, /respondWithAdminReadAccess\(/);
    assert.match(source, new RegExp(`"${route.permission.replace(".", "\\.")}"`));
    assert.match(source, new RegExp(route.loader));
    assert.match(source, /export async function HEAD\(request: NextRequest\)/);
    assert.match(source, /respondToAdminReadHead\(request,/);
    assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)\(/);
  });
}

test("public health is liveness-only and explicitly non-cacheable", () => {
  assert.match(publicHealth, /NextResponse\.json\(\{ ok: true \}/);
  assert.match(publicHealth, /"Cache-Control": "no-store, max-age=0"/);
  assert.doesNotMatch(
    publicHealth,
    /envStatus|getServerEnv|probeEventsTable|supabase|targets|appBaseUrl|integration/i,
  );
  assert.match(publicHealth, /export async function HEAD\(\)/);
});

test("detailed health is available only behind system.read", () => {
  assert.match(detailedHealth, /respondWithAdminReadAccess\(/);
  assert.match(detailedHealth, /"system\.read"/);
  assert.match(detailedHealth, /getDetailedSystemHealth/);
  assert.match(detailedHealth, /respondToAdminReadHead\(request, "system\.read"\)/);
});
