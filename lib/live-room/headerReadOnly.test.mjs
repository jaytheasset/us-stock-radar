// Real routes, actor/session resolution, repositories and bootstrap; synthetic HTTP only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const root = process.cwd();
const member = "12345678-1234-4234-8234-123456789012";
const guest = "22345678-1234-4234-8234-123456789012";
const publicId = "32345678-1234-4234-8234-123456789012";
function fixture() {
  const state = { writes: [], calls: [], member, guestExists: false, profileExists: false, blockWrites: true, authStatus: 200, refreshStatus: 200, failPath: "", profile: { user_id: member, public_profile_id: publicId, display_name: "Custom name", is_display_name_custom: true, bio: "Custom bio", avatar_path: `${publicId}/${guest}.webp`, emoji: "✨" } };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const http = async (url, options = {}) => {
    const u = new URL(url), method = options.method || "GET";
    assert.equal(u.origin, "https://fixture.invalid");
    state.calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), method, body: options.body ? JSON.parse(options.body) : null });
    if (u.pathname === state.failPath) return json({ message: "synthetic unavailable" }, 503);
    if (u.pathname === "/auth/v1/user") {
      if (state.authStatus !== 200) return json({ message: "synthetic auth failure" }, state.authStatus);
      if (new Headers(options.headers).get("authorization") === "Bearer expired") return json({ message: "expired" }, 401);
      return json({ id: state.member, email: "fixture@example.invalid" });
    }
    if (u.pathname === "/auth/v1/token") {
      assert.equal(u.searchParams.get("grant_type"), "refresh_token");
      return state.refreshStatus === 200 ? json({ access_token: "renewed", refresh_token: "rotated", expires_in: 1800, user: { id: state.member } }) : json({ message: "refresh failed" }, state.refreshStatus);
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const bodies = {
        get_live_room_activity_summary: { rooms: [{ ticker: "AAPL", unreadCount: 3 }], totalUnreadCount: 3, peopleUnreadCount: 0 },
        get_live_room_post_activity_summary: { items: [], unreadCount: 0 },
        get_live_room_followed_rooms: { items: [{ kind: "company", ticker: "AAPL", label: "AAPL Live Room", unreadCount: 3 }], totalUnreadCount: 3 },
      };
      const name = u.pathname.split("/").at(-1);
      assert(name in bodies, `unexpected RPC ${name}`);
      return json(bodies[name]);
    }
    const table = u.pathname.split("/").at(-1);
    if (!["GET", "HEAD"].includes(method)) {
      state.writes.push({ table, method });
      if (state.blockWrites) return json({ message: "synthetic write guard" }, 502);
      if (table === "live_room_guest_sessions") { state.guestExists = true; return json([{ id: guest }]); }
      if (table === "live_room_member_profiles" || table === "live_room_guest_profiles") { state.profileExists = true; return json([{ ...JSON.parse(options.body), public_profile_id: publicId }]); }
      return json([]);
    }
    if (table === "live_room_guest_sessions") return json(state.guestExists ? [{ id: guest, last_seen_at: "2020-01-01T00:00:00Z" }] : []);
    if (table === "live_room_member_profiles" || table === "live_room_guest_profiles") return json(state.profileExists ? [state.profile] : []);
    if (table === "user_plan_subscriptions") return json([{ plan: "pro", status: "active" }]);
    if (table === "live_room_moderators") return json([{ user_id: state.member }]);
    throw new Error(`unexpected table ${table}`);
  };
  const modules = new Map();
  function load(filename) {
    if (filename === path.join(root, "lib/env.ts")) return { getServerEnv: () => ({ supabaseUrl: "https://fixture.invalid", supabaseSecretKey: "sb_secret_fixture", supabasePublishableKey: "sb_publishable_fixture" }) };
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      if (name === "react") return { cache: fn => fn };
      if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load([base, `${base}.ts`].find(existsSync) ?? base);
    };
    new Function("require", "module", "exports", "fetch", code)(localRequire, module, module.exports, http);
    return module.exports;
  }
  return { state, load, request: (endpoint, cookie = "") => new NextRequest(`http://localhost:3126/api/live-room/${endpoint}`, { headers: { cookie } }), route: name => load(path.join(root, `app/api/live-room/${name}/route.ts`)), actor: () => load(path.join(root, "lib/live-room/serverActor.ts")) };
}

test("reproduction: chat profile GET initializes missing member and hits a write guard", async () => {
  const h = fixture();
  const response = await h.route("profile").GET(h.request("profile", "sr_access_token=valid"));
  assert.equal(response.status, 502);
  assert.deepEqual(h.state.writes.map(w => w.table), ["user_profiles", "user_plan_subscriptions", "alert_preferences", "user_delivery_channels", "live_room_member_profiles"]);
});

test("reproduction: default chat actor creates unknown guests and refreshes existing last_seen", async () => {
  const h = fixture();
  await assert.rejects(h.actor().resolveLiveRoomActor(h.request("unread", `sr_live_room_guest=${"a".repeat(43)}`)));
  assert.deepEqual(h.state.writes, [{ table: "live_room_guest_sessions", method: "POST" }]);
  h.state.writes.length = 0; h.state.guestExists = true;
  const result = await h.actor().resolveLiveRoomActor(h.request("unread", `sr_live_room_guest=${"a".repeat(43)}`));
  assert.equal(result.actor.kind, "guest");
  assert.deepEqual(h.state.writes, [{ table: "live_room_guest_sessions", method: "PATCH" }]);
});

for (const profileExists of [false, true]) test(`account read keeps member profile ${profileExists ? 'present' : 'absent'} without any writes`, async () => {
  const h = fixture(); h.state.profileExists = profileExists;
  const before = structuredClone(h.state.profile);
  for (let i = 0; i < 2; i++) {
    const response = await h.route("profile").GET(h.request("profile?view=account", "sr_access_token=valid"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.deepEqual((await response.json()).data, profileExists ? { isGuest: false, publicProfileId: publicId } : null);
  }
  assert.deepEqual(h.state.writes, []); assert.deepEqual(h.state.profile, before);
  const reads = h.state.calls.filter(c => c.path.includes("member_profiles"));
  assert(reads.every(c => c.query.user_id === `eq.${member}` && c.query.select === "public_profile_id"));
});

for (const cookie of ["", "sr_live_room_guest=invalid", `sr_live_room_guest=${"a".repeat(43)}`, "sr_access_token=expired"]) test(`absent/invalid/unknown identities read as absent without guest creation: ${cookie.slice(0, 23)}`, async () => {
  const h = fixture();
  for (const endpoint of ["profile?view=account", "unread"]) {
    const response = await h.route(endpoint.split("?")[0]).GET(h.request(endpoint, cookie));
    assert.equal(response.status, 200); assert.equal(response.cookies.get("sr_live_room_guest"), undefined);
    const body = await response.json();
    if (endpoint === "unread") { assert.equal(body.data.totalUnreadCount, 0); assert.equal(body.data.isAuthenticated, false); }
    else assert.equal(body.data, null);
  }
  assert.deepEqual(h.state.writes, []);
  assert(!h.state.calls.some(c => c.path.includes("/rpc/")));
});

test("existing guest reads its unread summary without last_seen or profile writes", async () => {
  const h = fixture(); h.state.guestExists = true;
  const cookie = `sr_live_room_guest=${"a".repeat(43)}`;
  const response = await h.route("unread").GET(h.request("unread", cookie));
  assert.equal(response.status, 200); assert.equal((await response.json()).data.totalUnreadCount, 3);
  assert.deepEqual(h.state.writes, []);
  const query = h.state.calls.find(c => c.path.endsWith("guest_sessions")).query;
  assert.match(query.expires_at, /^gt\./); assert.match(query.token_hash, /^eq\.[a-f0-9]{64}$/);
  const rpc = h.state.calls.find(c => c.path.endsWith("get_live_room_activity_summary"));
  assert.equal(rpc.body.p_guest_session_id, guest); assert.equal(rpc.body.p_member_user_id, null);
  assert.equal(response.cookies.get("sr_live_room_guest"), undefined);
});

test("member identity takes precedence over guest; unread queries stay owner scoped", async () => {
  const h = fixture();
  for (const id of [member, "42345678-1234-4234-8234-123456789012"]) {
    h.state.member = id; h.state.calls.length = 0;
    const r = await h.route("unread").GET(h.request("unread", `sr_access_token=valid; sr_live_room_guest=${"a".repeat(43)}`));
    assert.equal(r.status, 200); assert.equal((await r.json()).data.isAuthenticated, true);
    assert(!h.state.calls.some(c => c.path.endsWith("guest_sessions")));
    for (const c of h.state.calls.filter(c => c.path.includes("/rpc/"))) {
      assert.equal(c.body.p_member_user_id ?? c.body.p_recipient_user_id ?? c.body.p_requester_user_id, id);
      assert(!c.body.p_guest_session_id);
    }
  }
  assert.deepEqual(h.state.writes, []);
});

for (const endpoint of ["profile?view=account", "unread"]) test(`normal refresh still rotates verified auth cookies: ${endpoint}`, async () => {
  const h = fixture();
  const r = await h.route(endpoint.split("?")[0]).GET(h.request(endpoint, "sr_access_token=expired; sr_refresh_token=refresh"));
  assert.equal(r.status, 200);
  assert.equal(r.cookies.get("sr_access_token").value, "renewed");
  assert.equal(r.cookies.get("sr_refresh_token").value, "rotated");
  assert.deepEqual(h.state.calls.filter(c => c.path.startsWith("/auth")).map(c => c.path), ["/auth/v1/user", "/auth/v1/token", "/auth/v1/user"]);
  assert.deepEqual(h.state.writes, []);
});

for (const endpoint of ["profile?view=account", "unread"]) for (const failure of ["auth", "refresh", "guest", "data"]) test(`outage is an error, never absence: ${endpoint} ${failure}`, async () => {
  const h = fixture();
  let cookie = "sr_access_token=valid";
  if (failure === "auth") h.state.authStatus = 503;
  if (failure === "refresh") { cookie = "sr_access_token=expired; sr_refresh_token=refresh"; h.state.refreshStatus = 503; }
  if (failure === "guest") { cookie = `sr_live_room_guest=${"a".repeat(43)}`; h.state.failPath = "/rest/v1/live_room_guest_sessions"; }
  if (failure === "data") h.state.failPath = endpoint === "unread" ? "/rest/v1/rpc/get_live_room_activity_summary" : "/rest/v1/live_room_member_profiles";
  const r = await h.route(endpoint.split("?")[0]).GET(h.request(endpoint, cookie));
  assert.equal(r.status, 503); const body = await r.json(); assert.equal(body.ok, false); assert.equal(body.data, undefined);
  assert.equal(r.headers.get("set-cookie"), null); assert.deepEqual(h.state.writes, []);
});

test("chat entry still initializes member/guest and existing custom member profile retains privileges", async () => {
  for (const isMember of [false, true]) {
    const h = fixture(); h.state.blockWrites = false;
    let r = await h.route("profile").GET(h.request("profile", isMember ? "sr_access_token=valid" : ""));
    assert.equal(r.status, 200); let profile = (await r.json()).data;
    assert.equal(profile.isGuest, !isMember);
    assert(h.state.writes.some(w => w.table === (isMember ? "live_room_member_profiles" : "live_room_guest_sessions")));
    if (!isMember) assert(r.cookies.get("sr_live_room_guest"));
    else {
      h.state.writes.length = 0;
      r = await h.route("profile").GET(h.request("profile", "sr_access_token=valid"));
      profile = (await r.json()).data;
      assert.equal(profile.displayName, "Custom name"); assert.equal(profile.bio, "Custom bio");
      assert.equal(profile.publicProfileId, publicId); assert.equal(profile.isDisplayNameCustom, true);
      assert.equal(profile.avatarUrl, `https://fixture.invalid/storage/v1/object/public/live-room-member-avatars/${publicId}/${guest}.webp`); assert.equal(profile.canModerate, true); assert.equal(profile.plan, "pro");
      assert(!h.state.writes.some(w => w.table === "live_room_member_profiles"));
    }
  }
});

for (const rpc of ['get_live_room_post_activity_summary', 'get_live_room_followed_rooms']) test(`unread secondary read failure remains an error: ${rpc}`, async () => {
  const h = fixture(); h.state.failPath = `/rest/v1/rpc/${rpc}`;
  const r = await h.route('unread').GET(h.request('unread', 'sr_access_token=valid'));
  assert.equal(r.status, 503); assert.equal((await r.json()).ok, false); assert.deepEqual(h.state.writes, []);
});

test('account lookup and chat repository use their distinct GET contracts', () => {
  const authStatus = readFileSync(path.join(root, 'components/AuthStatus.tsx'), 'utf8');
  const chatApi = readFileSync(path.join(root, 'lib/live-room/apiRepository.ts'), 'utf8');
  assert.match(authStatus, /fetch\("\/api\/live-room\/profile\?view=account"/);
  assert.match(chatApi, /requestJson<LiveRoomProfile>\("\/api\/live-room\/profile"\)/);
});
