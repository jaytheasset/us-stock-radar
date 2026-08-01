import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET as unsubscribeGet, POST as unsubscribePost } from "../../app/api/alerts/email/unsubscribe/route.ts";
import { createEmailUnsubscribeToken, verifyEmailUnsubscribeToken } from "./emailUnsubscribeToken.ts";

const userId = "00000000-0000-4000-8000-000000000601";
const secret = "email-test-secret-with-enough-entropy";

test("email unsubscribe tokens are signed, scoped, reusable until expiry, and reject tampering", () => {
  const token = createEmailUnsubscribeToken(userId, secret, 1_800_000_000_000);
  assert.equal(verifyEmailUnsubscribeToken(token, secret, 1_800_000_001_000)?.userId, userId);
  assert.equal(verifyEmailUnsubscribeToken(token, secret, 1_800_000_002_000)?.userId, userId);
  assert.equal(verifyEmailUnsubscribeToken(`${token}x`, secret, 1_800_000_001_000), null);
  assert.equal(verifyEmailUnsubscribeToken(token, secret, 1_802_700_000_000), null);
});

test("email unsubscribe route confirms GET and processes one-click POST with the same token URL", async () => {
  const previousEnv = {
    secret: process.env.ALERT_EMAIL_UNSUBSCRIBE_SECRET,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  process.env.ALERT_EMAIL_UNSUBSCRIBE_SECRET = secret;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  };

  try {
    const token = createEmailUnsubscribeToken(userId, secret);
    const routeUrl = `https://stock-radar.test/api/alerts/email/unsubscribe?token=${encodeURIComponent(token)}`;

    const confirmation = await unsubscribeGet(new Request(routeUrl));
    const confirmationHtml = await confirmation.text();
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.headers.get("content-type") || "", /text\/html/);
    assert.match(confirmation.headers.get("cache-control") || "", /no-store/);
    assert.match(confirmationHtml, /method="post"/);
    assert.match(confirmationHtml, /\/api\/alerts\/email\/unsubscribe\?token=/);
    assert.doesNotMatch(confirmationHtml, /unsubscribe=/);

    const oneClick = await unsubscribePost(new Request(routeUrl, { method: "POST" }));
    assert.equal(oneClick.status, 200);
    assert.equal(requests.length, 1);
    const updateUrl = new URL(requests[0].url);
    assert.equal(updateUrl.pathname, "/rest/v1/user_delivery_channels");
    assert.equal(updateUrl.searchParams.get("user_id"), `eq.${userId}`);
    assert.equal(updateUrl.searchParams.get("channel"), "eq.email");
    assert.equal(requests[0].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { enabled: false });

    const invalid = await unsubscribePost(
      new Request("https://stock-radar.test/api/alerts/email/unsubscribe?token=invalid", { method: "POST" }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("ALERT_EMAIL_UNSUBSCRIBE_SECRET", previousEnv.secret);
    restoreEnv("SUPABASE_URL", previousEnv.url);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousEnv.key);
  }
});

test("email template includes both render formats, safe links, facts, and information-only copy", () => {
  const source = readFileSync(new URL("./StockRadarAlertEmail.tsx", import.meta.url), "utf8");
  const renderSource = readFileSync(new URL("./renderAlertEmail.tsx", import.meta.url), "utf8");
  assert.match(source, /STOCK RADAR/);
  assert.match(source, /For information only/);
  assert.match(source, /unsubscribe from alert emails/);
  assert.match(renderSource, /toPlainText\(html\)/);
  assert.match(renderSource, /src: "email"/);
  assert.match(renderSource, /getCanonicalAlertAnalysisPath/);
  assert.match(renderSource, /event\.score >= 75/);
});

test("Resend adapter is fail-closed, idempotent, one-click unsubscribe aware, and blocks uncertain retries", () => {
  const source = readFileSync(new URL("./sendAlertEmail.ts", import.meta.url), "utf8");
  assert.match(source, /config\.sendingEnabled/);
  assert.match(source, /idempotencyKey: `alert-email\/\$\{input\.deliveryId\}`/);
  assert.match(source, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
  assert.match(source, /outcome: "uncertain"/);
  assert.doesNotMatch(source, /console\./);
});

test("email webhook verifies raw Svix payload and suppresses only the Email channel", () => {
  const route = readFileSync(new URL("../../app/api/webhooks/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260801155839_alert_email_delivery.sql", import.meta.url), "utf8");
  assert.match(route, /await request\.text\(\)/);
  assert.match(route, /svix-signature/);
  assert.match(route, /webhooks\.verify/);
  assert.match(migration, /where user_id = v_user_id and channel = 'email'/);
  assert.match(migration, /on conflict \(webhook_id\) do nothing/);
  assert.match(migration, /from public\.alert_email_webhook_events[\s\S]*order by event_created_at desc/);
  assert.doesNotMatch(route, /console\./);
});

test("Alerts UI exposes real Email state without Coming later copy", () => {
  const ui = readFileSync(new URL("../../components/alerts-v2/StockRadarAlertsV2.tsx", import.meta.url), "utf8");
  const validation = readFileSync(new URL("./alertValidation.ts", import.meta.url), "utf8");
  assert.match(validation, /IMPLEMENTED_ALERT_CHANNELS[^\n]+"email"/);
  assert.match(ui, /recentStatusLabel/);
  assert.doesNotMatch(ui, /Coming later|Coming soon/i);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
