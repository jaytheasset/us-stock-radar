import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
