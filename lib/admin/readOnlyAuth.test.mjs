// Real admin/session/Auth/bootstrap functions; only HTTP, database and request context are isolated.
// All identities/tokens/rows below are synthetic. No network or real database is used.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const actor = "12345678-1234-4234-8234-123456789012";
const other = "22345678-1234-4234-8234-123456789012";
const { NextRequest } = require("next/server");

function fixture() {
  const state = {
    access: "valid", refresh: "refresh-fixture", roles: ["operations"],
    authStatus: 200, refreshStatus: 200, refreshedUser: actor,
    calls: [], writes: [],
    rows: {
      user_profiles: { id: actor, email: "admin@example.invalid", updated_at: "before" },
      alert_preferences: { user_id: actor, updated_at: "before", enabled: false },
    },
  };
  const before = structuredClone(state.rows);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const http = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, "https://auth.example.invalid");
    const token = new Headers(options.headers).get("authorization");
    state.calls.push({ path: u.pathname + u.search, method: options.method, token });
    if (u.pathname === "/auth/v1/user") {
      if (state.authStatus !== 200) return json({ message: "synthetic auth failure" }, state.authStatus);
      if (token === "Bearer expired") return json({ message: "expired" }, 401);
      return json({ id: token === "Bearer renewed" ? state.refreshedUser : actor, email: "admin@example.invalid" });
    }
    assert.equal(u.pathname + u.search, "/auth/v1/token?grant_type=refresh_token");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { refresh_token: "refresh-fixture" });
    return state.refreshStatus === 200
      ? json({ access_token: "renewed", refresh_token: "rotated-fixture", expires_in: 1800, user: { id: actor } })
      : json({ message: "synthetic refresh failure" }, state.refreshStatus);
  };
  const overrides = {
    "lib/subscription/effectivePlan.ts": { getEffectiveUserPlan: async () => ({ effectivePlan: "free" }) },
    "lib/env.ts": { getServerEnv: () => ({ supabaseUrl: "https://auth.example.invalid", supabasePublishableKey: "sb_publishable_fixture" }) },
    "lib/supabase.ts": {
      supabaseUpsert: async (table, data, options) => {
        state.writes.push({ table, options });
        if (state.rows[table]) Object.assign(state.rows[table], data, { updated_at: `write-${state.writes.length}` });
        return { ok: true, data: [] };
      },
      supabaseSelect: async (table, query) => {
        assert.equal(table, "admin_role_assignments");
        assert.equal(query.user_id, `eq.${actor}`);
        assert.equal(query.active, "eq.true");
        return { ok: true, data: state.roles.map(role => ({ role })) };
      },
    },
  };
  const modules = new Map();
  function load(filename) {
    const relative = path.relative(root, filename).replaceAll("\\", "/");
    if (overrides[relative]) return overrides[relative];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      // No React render dispatcher in node:test: keep the real role reader, without render memoization.
      if (name === "react") return { cache: fn => fn };
      if (name === "next/headers") return { cookies: async () => ({ get: name => ({ value: name === "sr_access_token" ? state.access : state.refresh }) }) };
      if (name === "next/navigation") return { redirect: url => { throw new Error(`REDIRECT:${url}`); } };
      if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load([base, `${base}.ts`].find(existsSync) ?? base);
    };
    new Function("require", "module", "exports", "fetch", code)(localRequire, module, module.exports, http);
    return module.exports;
  }
  const api = load(path.join(root, "lib/admin/api.ts"));
  const server = load(path.join(root, "lib/admin/server.ts"));
  const session = load(path.join(root, "lib/auth/sessionResolution.ts"));
  const request = () => new NextRequest("http://localhost:3199/api/admin/data/kiwoom-verification", {
    headers: { cookie: `sr_access_token=${state.access}; sr_refresh_token=${state.refresh}` },
  });
  const unchanged = () => {
    assert.deepEqual(state.writes, [], "admin identity check must not bootstrap application rows");
    assert.deepEqual(state.rows, before, "whole profile/preferences rows must remain equal");
  };
  return { state, api, server, session, request, unchanged, load };
}

test("valid admin API identity and role read never merge-upserts protected rows", async () => {
  const h = fixture();
  const result = await h.api.resolveAdminApiAccess(h.request(), "system.read");
  assert.equal(result.access.userId, actor);
  assert.deepEqual(result.access.roles, ["operations"]);
  assert.equal(result.auth.refreshedSession, null);
  assert.equal(h.state.calls.length, 1);
  h.unchanged();
});

test("admin page permission check uses verified identity without bootstrap", async () => {
  const h = fixture();
  assert.deepEqual(await h.server.requireAdminPermission("system.read"), { userId: actor, roles: ["operations"] });
  assert.equal(h.state.calls[0].path, "/auth/v1/user");
  h.unchanged();
});

test("expired admin access refreshes, revalidates identity and sets rotated cookies without bootstrap", async () => {
  const h = fixture(); h.state.access = "expired";
  const response = await h.api.respondWithAdminReadAccess(h.request(), "system.read", async () => ({ ok: true }));
  assert.equal(response.status, 200);
  assert.equal(response.cookies.get("sr_access_token").value, "renewed");
  assert.equal(response.cookies.get("sr_refresh_token").value, "rotated-fixture");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(h.state.calls.map(c => c.path), ["/auth/v1/user", "/auth/v1/token?grant_type=refresh_token", "/auth/v1/user"]);
  h.unchanged();
});

test("anonymous and unauthorized admin requests remain denied before loading data and without writes", async () => {
  for (const roles of [null, [], ["support"]]) {
    const h = fixture();
    if (roles === null) { h.state.access = ""; h.state.refresh = ""; } else h.state.roles = roles;
    let loaded = false;
    const response = await h.api.respondWithAdminReadAccess(h.request(), "system.read", async () => { loaded = true; });
    assert.equal(response.status, roles === null ? 401 : 403);
    assert.equal(loaded, false);
    h.unchanged();
  }
});

test("page anonymous/no-role/insufficient-role redirects keep existing destinations", async () => {
  for (const [roles, expected] of [[null, "/login?next=%2Fadmin"], [[], "/login?next=%2Fadmin&reason=admin_required"], [["support"], "/admin"]]) {
    const h = fixture();
    if (roles === null) h.state.access = ""; else h.state.roles = roles;
    await assert.rejects(h.server.requireAdminPermission("system.read"), { message: `REDIRECT:${expected}` });
    h.unchanged();
  }
});

test("unavailable Auth fails closed without refreshing or clearing cookies", async () => {
  const h = fixture(); h.state.authStatus = 503;
  const result = await h.session.resolveAuthSession({ accessToken: "valid", refreshToken: "refresh-fixture", bootstrap: false });
  assert.equal(result.user, null); assert.equal(result.shouldClearCookies, false);
  assert.equal(h.state.calls.length, 1);
  const response = await h.api.respondToAdminReadHead(h.request(), "system.read");
  assert.equal(response.status, 401); // Existing admin envelope for unresolved identity, unchanged.
  assert.equal(response.headers.get("set-cookie"), null);
  h.unchanged();
});

test("refresh failure and refreshed-subject mismatch keep invalid-session rejection", async () => {
  for (const failure of ["invalid-refresh", "subject-mismatch"]) {
    const h = fixture(); h.state.access = "expired";
    if (failure === "invalid-refresh") h.state.refreshStatus = 401;
    else h.state.refreshedUser = other;
    const result = await h.session.resolveAuthSession({ accessToken: "expired", refreshToken: "refresh-fixture", bootstrap: false });
    assert.equal(result.user, null); assert.equal(result.shouldClearCookies, true);
    const response = await h.api.respondToAdminReadHead(h.request(), "system.read");
    assert.equal(response.status, 401);
    h.unchanged();
  }
});

test("ordinary session bootstrap default is preserved, including after refresh", async () => {
  for (const accessToken of ["valid", "expired"]) {
    const h = fixture();
    const result = await h.session.resolveAuthSession({ accessToken, refreshToken: "refresh-fixture" });
    assert.equal(result.user.id, actor);
    assert.deepEqual(h.state.writes.map(w => w.table), ["user_profiles", "user_plan_subscriptions", "alert_preferences", "user_delivery_channels"]);
    assert.notEqual(h.state.rows.user_profiles.updated_at, "before");
    assert.notEqual(h.state.rows.alert_preferences.updated_at, "before");
  }
});

test("remaining page blocker: unchanged root viewer-plan read still bootstraps ordinary user rows", async () => {
  const h = fixture();
  const viewer = h.load(path.join(root, "lib/currentViewerPlan.ts"));
  assert.match(readFileSync(path.join(root, "app/layout.tsx"), "utf8"), /await getCurrentViewerPlan\(\)/);
  assert.equal(await viewer.getCurrentViewerPlan(), "free");
  assert.deepEqual(h.state.writes.map(w => w.table), ["user_profiles", "user_plan_subscriptions", "alert_preferences", "user_delivery_channels"]);
});
