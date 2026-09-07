import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  resolveSupabaseSecretKey,
  supabaseServiceHeaders,
} from "./supabase-service-headers.mjs";

const { Client } = pg;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:3110";
const ATPC_EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const CONDITIONS = [
  { key: "market.price", operator: "lt", value: 1 },
  { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
];
const UPDATED_CONDITIONS = [
  { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  { key: "corporate_action.action_stage", operator: "eq", value: "scheduled" },
];
const credentials = readLocalSupabaseCredentials();
const database = new Client({ connectionString: localDatabaseUrl() });
const users = [];
let monitorId = null;
let alertId = null;
await database.connect();

try {
  await assertHealth();
  const userA = await createUser("a");
  const userB = await createUser("b");
  users.push(userA, userB);
  const cookieA = await login(userA);
  const cookieB = await login(userB);

  const unauthenticated = await api("/api/monitors/listing");
  assert.equal(unauthenticated.status, 401);

  const validPreview = await api("/api/monitors/listing/validate", {
    method: "POST",
    cookie: cookieA,
    body: { conditions: CONDITIONS },
  });
  assert.equal(validPreview.status, 200, JSON.stringify(validPreview.body));
  assert.equal(validPreview.body.valid, true);
  assert.deepEqual(validPreview.body.conditions, CONDITIONS);

  const beforeCreate = await monitorList(cookieA);
  const created = await api("/api/monitors/listing", {
    method: "POST",
    cookie: cookieA,
    body: { conditions: CONDITIONS },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  monitorId = created.body.data.monitor.id;
  assert.equal(created.body.data.monitor.userId, userA.id);
  assert.equal(created.body.data.monitor.isActive, true);
  assert.deepEqual(created.body.data.monitor.conditions, CONDITIONS);
  const afterCreate = await monitorList(cookieA);
  assert.equal(afterCreate.monitors.length, beforeCreate.monitors.length + 1);
  assert.equal(afterCreate.monitors.some((item) => item.id === monitorId), true);

  const read = await api(`/api/monitors/listing/${monitorId}`, { cookie: cookieA });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.status, "available");

  const paused = await api(`/api/monitors/listing/${monitorId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { isActive: false },
  });
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  assert.equal(paused.body.data.monitor.isActive, false);

  const resumed = await api(`/api/monitors/listing/${monitorId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { isActive: true },
  });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.data.monitor.isActive, true);

  const updated = await api(`/api/monitors/listing/${monitorId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { conditions: UPDATED_CONDITIONS },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(updated.body.data.monitor.conditions, UPDATED_CONDITIONS);

  const countBeforeInvalid = (await monitorList(cookieA)).monitors.length;
  const invalidCases = [
    { conditions: [{ key: "listing.unsupported", operator: "eq", value: "adverse" }] },
    { conditions: [{ key: "listing.event_kind", operator: "within_days", value: 1 }] },
    { conditions: [{ key: "listing.event_kind", operator: "eq", value: "unsupported_value" }] },
    { conditions: [{ key: "corporate_action.event_kind", operator: "eq", value: "stock_dividend" }] },
    { conditions: [{ key: "corporate_action.action_stage", operator: "eq", value: "unknown" }] },
    { conditions: [{ operator: "eq", value: "adverse" }] },
    { domain: "offering", conditions: CONDITIONS },
    { conditions: CONDITIONS, userId: userB.id },
  ];
  for (const body of invalidCases) {
    const preview = await api("/api/monitors/listing/validate", { method: "POST", cookie: cookieA, body });
    assert.ok(preview.status >= 400 && preview.status < 500, JSON.stringify(preview.body));
    assert.equal(preview.body.valid, false);
    assert.deepEqual(preview.body.conditions, []);
    const rejected = await api("/api/monitors/listing", { method: "POST", cookie: cookieA, body });
    assert.ok(rejected.status >= 400 && rejected.status < 500, JSON.stringify(rejected.body));
  }
  const malformedJson = await api("/api/monitors/listing", {
    method: "POST",
    cookie: cookieA,
    rawBody: "{not-json",
  });
  assert.equal(malformedJson.status, 400);
  const malformedPreview = await api("/api/monitors/listing/validate", {
    method: "POST",
    cookie: cookieA,
    rawBody: "{not-json",
  });
  assert.equal(malformedPreview.status, 400);
  assert.equal(malformedPreview.body.valid, false);
  assert.deepEqual(malformedPreview.body.conditions, []);
  assert.equal((await monitorList(cookieA)).monitors.length, countBeforeInvalid);

  const crossOrigin = await api("/api/monitors/listing", {
    method: "POST",
    cookie: cookieA,
    body: { conditions: CONDITIONS },
    origin: "https://foreign.example",
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await monitorList(cookieA)).monitors.length, countBeforeInvalid);

  assert.equal((await monitorList(cookieB)).monitors.some((item) => item.id === monitorId), false);
  const foreignRead = await api(`/api/monitors/listing/${monitorId}`, { cookie: cookieB });
  assert.equal(foreignRead.status, 404);
  const foreignPatch = await api(`/api/monitors/listing/${monitorId}`, {
    method: "PATCH",
    cookie: cookieB,
    body: { isActive: false },
  });
  assert.equal(foreignPatch.status, 404);
  const foreignDelete = await api(`/api/monitors/listing/${monitorId}`, { method: "DELETE", cookie: cookieB });
  assert.equal(foreignDelete.status, 404);
  assert.equal((await api(`/api/monitors/listing/${monitorId}`, { cookie: cookieA })).status, 200);

  const event = await database.query("select id from public.events where id = $1", [ATPC_EVENT_ID]);
  assert.equal(event.rowCount, 1, "preserved local ATPC event is required");
  const insertedAlert = await database.query(
    `insert into public.user_alert_deliveries (
       user_id, alert_event_id, title, category, source_type, source_label,
       alert_lane, delivered_channels, delivery_status, delivered_at,
       scheduled_for, sent_at, attempted_at, last_error, dedupe_key,
       listing_monitor_id, alert_domain, listing_source_execution_id
     ) values (
       $1, $2, 'Listing monitor matched', 'listing_risk', 'other', 'Listing Monitor',
       'listing_monitor', array[]::text[], 'queued', now(),
       null, null, null, null, null, $3, 'listing', $4
     ) returning id`,
    [userA.id, ATPC_EVENT_ID, monitorId, randomUUID()],
  );
  alertId = insertedAlert.rows[0].id;

  const alertsA = await api(`/api/monitors/listing/alerts?monitorId=${monitorId}&limit=5&offset=0`, { cookie: cookieA });
  assert.equal(alertsA.status, 200, JSON.stringify(alertsA.body));
  assert.equal(alertsA.body.data.total, 1);
  assert.deepEqual(alertsA.body.data.alerts.map((item) => ({
    id: item.id,
    monitorId: item.monitorId,
    eventId: item.eventId,
  })), [{ id: alertId, monitorId, eventId: ATPC_EVENT_ID }]);
  assert.equal("sourceExecutionId" in alertsA.body.data.alerts[0], false);

  const alertsB = await api(`/api/monitors/listing/alerts?monitorId=${monitorId}`, { cookie: cookieB });
  assert.equal(alertsB.status, 200);
  assert.equal(alertsB.body.data.total, 0);
  assert.deepEqual(alertsB.body.data.alerts, []);

  const deleted = await api(`/api/monitors/listing/${monitorId}`, { method: "DELETE", cookie: cookieA });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.data.deleted, true);
  assert.equal((await api(`/api/monitors/listing/${monitorId}`, { cookie: cookieA })).status, 404);
  const retainedAlert = await api("/api/monitors/listing/alerts", { cookie: cookieA });
  assert.equal(retainedAlert.body.data.alerts.some((item) => item.id === alertId && item.monitorId === null), true);

  console.log(JSON.stringify({
    health: 200,
    auth: { unauthenticated: 401, ownerA: "allowed", ownerBForeignMonitor: 404 },
    monitor: { create: 201, list: "visible", pause: false, resume: true, update: "canonical", delete: true },
    validation: { invalidCases: invalidCases.length + 2, writes: 0, previewWrites: 0 },
    alerts: { ownerA: 1, ownerBForeign: 0, eventReference: ATPC_EVENT_ID, afterMonitorDelete: "retained_with_null_monitor" },
    geminiOrLlmCalls: 0,
  }, null, 2));
} finally {
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) await cleanup(database, userIds);
  const residue = userIds.length > 0 ? await residueCounts(database, userIds) : zeroResidue();
  console.log(JSON.stringify({ cleanup: residue }));
  assert.deepEqual(residue, zeroResidue());
  await database.end();
}

async function assertHealth() {
  const response = await fetch(`${APP_ORIGIN}/api/health`);
  assert.equal(response.status, 200);
}

async function createUser(label) {
  const password = `ApiV1-${randomUUID()}-aA1!`;
  const email = `monitor-api-v1-${label}-${randomUUID()}@example.test`;
  const response = await fetch(`${credentials.apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  assert.ok(body.id);
  return { id: body.id, email, password };
}

async function login(user) {
  const response = await fetch(`${APP_ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
  assert.match(cookie, /sr_access_token=/);
  return cookie;
}

async function monitorList(cookie) {
  const response = await api("/api/monitors/listing", { cookie });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.method && options.method !== "GET") {
    headers.Origin = options.origin || APP_ORIGIN;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method: options.method || "GET",
    headers,
    ...(options.rawBody !== undefined
      ? { body: options.rawBody }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function cleanup(client, userIds) {
  await client.query("delete from public.user_alert_deliveries where user_id = any($1::uuid[])", [userIds]);
  await client.query("delete from public.listing_monitors where user_id = any($1::uuid[])", [userIds]);
  await client.query("delete from public.user_delivery_channels where user_id = any($1::uuid[])", [userIds]);
  await client.query("delete from public.alert_preferences where user_id = any($1::uuid[])", [userIds]);
  await client.query("delete from public.user_plan_subscriptions where user_id = any($1::uuid[])", [userIds]);
  await client.query("delete from public.user_profiles where id = any($1::uuid[])", [userIds]);
  await client.query("delete from auth.users where id = any($1::uuid[])", [userIds]);
}

async function residueCounts(client, userIds) {
  const result = await client.query(
    `select
       (select count(*)::integer from auth.users where id = any($1::uuid[])) as users,
       (select count(*)::integer from public.user_profiles where id = any($1::uuid[])) as profiles,
       (select count(*)::integer from public.listing_monitors where user_id = any($1::uuid[])) as monitors,
       (select count(*)::integer from public.user_alert_deliveries where user_id = any($1::uuid[])) as alerts,
       (select count(*)::integer from public.user_delivery_channels where user_id = any($1::uuid[])) as channels,
       (select count(*)::integer from public.alert_preferences where user_id = any($1::uuid[])) as preferences,
       (select count(*)::integer from public.user_plan_subscriptions where user_id = any($1::uuid[])) as subscriptions`,
    [userIds],
  );
  return result.rows[0];
}

function zeroResidue() {
  return { users: 0, profiles: 0, monitors: 0, alerts: 0, channels: 0, preferences: 0, subscriptions: 0 };
}

function adminHeaders() {
  return supabaseServiceHeaders(credentials.secretKey, {
    "Content-Type": "application/json",
  });
}

function localDatabaseUrl() {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const port = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
  if (!port) throw new Error("Local Supabase database port is unavailable");
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

function readLocalSupabaseCredentials() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const output = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    return match ? [[match[1], match[2].replace(/"$/, "")]] : [];
  }));
  const apiUrl = values.API_URL || "";
  const secretKey = resolveSupabaseSecretKey(values);
  const parsed = new URL(apiUrl);
  assert.ok(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  assert.ok(secretKey);
  return { apiUrl: apiUrl.replace(/\/$/, ""), secretKey };
}
