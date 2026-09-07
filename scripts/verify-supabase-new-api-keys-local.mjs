import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
  supabaseServiceHeaders,
} from "./supabase-service-headers.mjs";

const local = readLocalSupabaseStatus();
const baseUrl = String(local.API_URL || "").replace(/\/$/, "");
const parsedUrl = new URL(baseUrl);
assert.match(parsedUrl.hostname, /^(127\.0\.0\.1|localhost)$/);

const publishableKey = resolveSupabasePublishableKey(local);
const secretKey = resolveSupabaseSecretKey(local);
const legacyPublishableKey = resolveSupabasePublishableKey({ ANON_KEY: local.ANON_KEY });
const legacySecretKey = resolveSupabaseSecretKey({ SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY });
assert.match(publishableKey, /^sb_publishable_/);
assert.match(secretKey, /^sb_secret_/);
assert.ok(legacyPublishableKey);
assert.ok(legacySecretKey);

const results = [];
let userId = "";
let signupUserId = "";
const appOrigin = readOptionalLocalAppOrigin();

try {
  await check("public_auth_settings", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
    });
    return response.status;
  });

  await check("legacy_public_fallback", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/settings`, {
      headers: supabaseServiceHeaders(legacyPublishableKey),
    });
    return response.status;
  });

  await check("public_rest_grant_boundary", async () => {
    const response = await fetch(`${baseUrl}/rest/v1/events?select=id&limit=1`, {
      headers: { apikey: publishableKey, Accept: "application/json" },
    });
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.match(body, /permission denied for table events/i);
    return response.status;
  }, false);

  await check("privileged_rest", async () => {
    const response = await fetch(`${baseUrl}/rest/v1/user_profiles?select=id&limit=1`, {
      headers: supabaseServiceHeaders(secretKey, { Accept: "application/json" }),
    });
    return response.status;
  });

  await check("legacy_privileged_fallback", async () => {
    const response = await fetch(`${baseUrl}/rest/v1/user_profiles?select=id&limit=1`, {
      headers: supabaseServiceHeaders(legacySecretKey, { Accept: "application/json" }),
    });
    return response.status;
  });

  await check("privileged_rpc", async () => {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/get_filings_v2_facets`, {
      method: "POST",
      headers: supabaseServiceHeaders(secretKey, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: "{}",
    });
    return response.status;
  });

  await check("public_key_rejected_by_admin", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: publishableKey, Accept: "application/json" },
    });
    assert.ok(response.status === 401 || response.status === 403);
    return response.status;
  }, false);

  await check("public_sign_up", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `new-key-signup-${randomUUID()}@example.test`,
        password: `Verify-${randomUUID()}-Aa1!`,
      }),
    });
    assert.ok(response.ok);
    const payload = await response.json();
    signupUserId = String(payload.user?.id || payload.id || "");
    assert.ok(signupUserId);
    return response.status;
  });

  const email = `new-key-verification-${randomUUID()}@example.test`;
  const password = `Verify-${randomUUID()}-Aa1!`;
  await check("privileged_auth_create", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: supabaseServiceHeaders(secretKey, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    assert.ok(response.ok);
    const payload = await response.json();
    userId = String(payload.id || "");
    assert.ok(userId);
    return response.status;
  });

  let accessToken = "";
  let refreshToken = "";
  await check("public_sign_in", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    assert.ok(response.ok);
    const payload = await response.json();
    accessToken = String(payload.access_token || "");
    refreshToken = String(payload.refresh_token || "");
    assert.ok(accessToken && refreshToken);
    return response.status;
  });

  await check("authenticated_user_jwt", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    assert.ok(response.ok);
    return response.status;
  });

  await check("public_refresh", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.ok(response.ok);
    const payload = await response.json();
    accessToken = String(payload.access_token || "");
    refreshToken = String(payload.refresh_token || "");
    assert.ok(accessToken && refreshToken);
    return response.status;
  });

  if (appOrigin) {
    let appCookie = "";
    await check("app_privileged_events", async () => {
      const response = await fetch(`${appOrigin}/api/events?limit=1`);
      return response.status;
    });
    await check("app_sign_in", async () => {
      const response = await fetch(`${appOrigin}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: appOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      assert.ok(response.ok);
      appCookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      assert.ok(appCookie);
      return response.status;
    });
    await check("app_authenticated_session", async () => {
      const response = await fetch(`${appOrigin}/api/auth/me`, {
        headers: { Cookie: appCookie },
      });
      assert.ok(response.ok);
      const payload = await response.json();
      assert.ok(payload.user?.id);
      return response.status;
    });
    await check("app_logout", async () => {
      const response = await fetch(`${appOrigin}/api/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: appCookie,
          Origin: appOrigin,
          "Sec-Fetch-Site": "same-origin",
        },
      });
      return response.status;
    });
  }

  await check("authenticated_logout", async () => {
    const response = await fetch(`${baseUrl}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.status;
  });

  await check("storage_secret_sdk", async () => {
    const client = createClient(baseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const { error } = await client.storage.listBuckets();
    assert.equal(error, null);
    return 200;
  });

  await check("realtime_publishable_sdk", async () => {
    const client = createClient(baseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const channel = client.channel(`new-key-verification-${randomUUID()}`, {
      config: { private: false },
    });
    try {
      const status = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 10_000);
        channel.subscribe((value) => {
          if (value === "SUBSCRIBED") {
            clearTimeout(timeout);
            resolve(value);
          } else if (value === "CHANNEL_ERROR" || value === "TIMED_OUT") {
            clearTimeout(timeout);
            reject(new Error(`Realtime subscription failed: ${value}`));
          }
        });
      });
      assert.equal(status, "SUBSCRIBED");
      return 200;
    } finally {
      await client.removeChannel(channel);
      client.realtime.disconnect();
    }
  });
} finally {
  if (signupUserId) {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(signupUserId)}`, {
      method: "DELETE",
      headers: supabaseServiceHeaders(secretKey),
    });
    results.push({ check: "local_signup_cleanup", ok: response.ok, status: response.status });
  }
  if (userId) {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: supabaseServiceHeaders(secretKey),
    });
    results.push({ check: "local_auth_cleanup", ok: response.ok, status: response.status });
  }
}

assert.equal(results.every((item) => item.ok), true);
console.log(JSON.stringify({ ok: true, checks: results }, null, 2));

async function check(name, run, requireSuccess = true) {
  const status = await run();
  if (requireSuccess) assert.ok(status >= 200 && status < 300, `${name} returned HTTP ${status}`);
  results.push({ check: name, ok: true, status });
}

function readLocalSupabaseStatus() {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx supabase status -o json"]
    : ["supabase", "status", "-o", "json"];
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function readOptionalLocalAppOrigin() {
  const value = String(process.env.APP_ORIGIN || "").replace(/\/$/, "");
  if (!value) return "";
  const url = new URL(value);
  assert.match(url.hostname, /^(127\.0\.0\.1|localhost)$/);
  assert.notEqual(url.port, "3110");
  return url.origin;
}
