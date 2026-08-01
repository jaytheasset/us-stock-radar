import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAllPublicAlertCategoryValues } from "../../subscriptionPolicy.ts";
import type { NormalizedAlertEvent } from "./types.ts";
import {
  buildPublicTelegramBroadcastPresentation,
  buildPublicTelegramSourceLabel,
  evaluatePublicTelegramBroadcast,
  normalizePublicTelegramDestination,
} from "./publicTelegramBroadcastPolicy.ts";

const baseEvent: NormalizedAlertEvent = {
  id: "6b54bb97-1de6-4ad0-9f87-6d44d46914e4",
  title: "AMD reports quarterly results",
  quickTake: "Revenue exceeded expectations and guidance increased.",
  tickers: ["AMD"],
  primaryTicker: "AMD",
  category: "earnings",
  sourceType: "filing",
  sourceLabel: "SEC EDGAR",
  score: 75,
  signal: "bullish",
  impact: "high",
  marketScope: "company",
  publishedAt: "2026-08-01T14:00:00.000Z",
  metadata: { source_code: "sec_edgar", form_type: "8-K" },
};

test("public Telegram score threshold excludes 74 and includes 75", () => {
  assert.equal(
    evaluatePublicTelegramBroadcast(
      { ...baseEvent, score: 74 },
      new Date("2026-08-01T14:05:00.000Z"),
    ).eligible,
    false,
  );
  assert.deepEqual(
    evaluatePublicTelegramBroadcast(
      baseEvent,
      new Date("2026-08-01T14:05:00.000Z"),
    ),
    {
      eligible: true,
      due: true,
      scheduledFor: "2026-08-01T14:05:00.000Z",
    },
  );
});

test("public Telegram waits five minutes and late analysis is immediately due", () => {
  assert.equal(
    evaluatePublicTelegramBroadcast(
      baseEvent,
      new Date("2026-08-01T14:04:59.999Z"),
    ).due,
    false,
  );
  assert.equal(
    evaluatePublicTelegramBroadcast(
      baseEvent,
      new Date("2026-08-01T14:30:00.000Z"),
    ).due,
    true,
  );
  assert.equal(
    evaluatePublicTelegramBroadcast(
      { ...baseEvent, quickTake: "" },
      new Date("2026-08-01T14:30:00.000Z"),
    ).reason,
    "ANALYSIS_INCOMPLETE",
  );
});

test("all 17 centralized public event types are eligible without plan filtering", () => {
  const categories = getAllPublicAlertCategoryValues();
  assert.equal(categories.length, 17);
  for (const category of categories) {
    assert.equal(
      evaluatePublicTelegramBroadcast(
        { ...baseEvent, category },
        new Date("2026-08-01T14:05:00.000Z"),
      ).eligible,
      true,
      category,
    );
  }
  assert.equal(
    evaluatePublicTelegramBroadcast(
      { ...baseEvent, category: "other" },
      new Date("2026-08-01T14:05:00.000Z"),
    ).reason,
    "CATEGORY_NOT_PUBLIC",
  );
});

test("public Telegram source labels follow filing, press, news, macro, and policy rules", () => {
  assert.equal(buildPublicTelegramSourceLabel(baseEvent), "SEC Filing · 8-K");
  assert.equal(
    buildPublicTelegramSourceLabel({
      ...baseEvent,
      sourceType: "news",
      sourceLabel: "Business Wire",
      metadata: { source_code: "businesswire" },
    }),
    "Press Release · Business Wire",
  );
  assert.equal(
    buildPublicTelegramSourceLabel({
      ...baseEvent,
      sourceType: "news",
      sourceLabel: "Reuters",
      metadata: { source_code: "reuters" },
    }),
    "News · Reuters",
  );
  assert.equal(
    buildPublicTelegramSourceLabel({
      ...baseEvent,
      sourceType: "news",
      sourceLabel: "A".repeat(49),
      metadata: { source_code: "general_news" },
    }),
    "News",
  );
  assert.equal(
    buildPublicTelegramSourceLabel({
      ...baseEvent,
      category: "macro_market",
      marketScope: "macro",
      sourceType: "other",
      sourceLabel: "Bureau of Labor Statistics",
    }),
    "Macro · Bureau of Labor Statistics",
  );
  assert.equal(
    buildPublicTelegramSourceLabel({
      ...baseEvent,
      category: "policy_regulation",
      marketScope: "macro",
      sourceType: "other",
      sourceLabel: "Federal Reserve",
    }),
    "Policy · Federal Reserve",
  );
});

test("public Telegram includes Quick Take and at most the two canonical buttons", () => {
  const presentation = buildPublicTelegramBroadcastPresentation(baseEvent, {
    baseUrl: "https://us-stock-radar.com",
  });
  assert.match(presentation.text, /Quick Take:/);
  assert.match(presentation.text, /SEC Filing · 8-K/);
  assert.doesNotMatch(presentation.text, /Alert Settings|Mute/);
  const buttons = presentation.replyMarkup?.inline_keyboard.flat() || [];
  assert.deepEqual(
    buttons.map((button) => button.text),
    ["Enter AMD Live Room", "View Analysis"],
  );
  const liveUrl = new URL(buttons[0].url || "");
  assert.equal(liveUrl.pathname, "/live/AMD");
  assert.equal(liveUrl.searchParams.get("event"), baseEvent.id);
  assert.equal(liveUrl.searchParams.get("src"), "telegram");
  assert.equal(new URL(buttons[1].url || "").pathname, `/filings/${baseEvent.id}`);

  const analysisOnly = buildPublicTelegramBroadcastPresentation(
    {
      ...baseEvent,
      sourceType: "news",
      marketScope: "macro",
      tickers: [],
      primaryTicker: undefined,
    },
    { baseUrl: "https://us-stock-radar.com" },
  );
  assert.deepEqual(
    analysisOnly.replyMarkup?.inline_keyboard.flat().map((button) => button.text),
    ["View Analysis"],
  );

  const liveOnly = buildPublicTelegramBroadcastPresentation(
    { ...baseEvent, sourceType: "other" },
    { baseUrl: "https://us-stock-radar.com" },
  );
  assert.deepEqual(
    liveOnly.replyMarkup?.inline_keyboard.flat().map((button) => button.text),
    ["Enter AMD Live Room"],
  );

  const noButtons = buildPublicTelegramBroadcastPresentation(
    {
      ...baseEvent,
      sourceType: "other",
      marketScope: "macro",
      tickers: [],
      primaryTicker: undefined,
    },
    { baseUrl: "https://us-stock-radar.com" },
  );
  assert.equal(noButtons.replyMarkup, undefined);
});

test("public Telegram destination accepts only a server-configured channel identifier", () => {
  assert.equal(
    normalizePublicTelegramDestination("@TestPublicChannel"),
    "@TestPublicChannel",
  );
  assert.equal(
    normalizePublicTelegramDestination("-1001234567890"),
    "-1001234567890",
  );
  assert.equal(normalizePublicTelegramDestination("https://t.me/example"), "");
  assert.equal(normalizePublicTelegramDestination("@bad/path"), "");
});

test("public broadcast storage is server-only, atomic, retryable, and separate from member alerts", () => {
  const migration = read(
    "supabase/migrations/20260801085414_public_telegram_broadcast_delivery.sql",
  );
  const runtime = read(
    "lib/alerts/delivery/publicTelegramBroadcast.ts",
  );
  const scheduler = read(
    "lib/alerts/delivery/runAlertDeliveryScheduler.ts",
  );
  const normalization = read(
    "lib/alerts/delivery/normalizeAlertEvent.ts",
  );

  assert.match(migration, /unique \(event_id, channel\)/);
  assert.match(migration, /channel = 'telegram_public'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /status in \('pending', 'failed'\)/);
  assert.match(migration, /p_status = 'failed'[\s\S]*interval '5 minutes'/);
  assert.match(migration, /status = 'attempting'[\s\S]*attempt_token = p_attempt_token/);
  assert.match(
    migration,
    /on conflict \(event_id, channel\) do update[\s\S]*status = 'pending'[\s\S]*attempt_count = 0/,
  );
  assert.match(runtime, /normalizeAlertEvent\(row\.event_id\)/);
  assert.match(runtime, /sendTelegramMessage\(destination/);
  assert.match(runtime, /ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC|alertDeliverySendTelegramPublic/);
  assert.doesNotMatch(runtime, /user_delivery_channels|user_alert_deliveries|callback_data/);
  assert.match(scheduler, /await runPublicTelegramBroadcastDelivery/);
  assert.match(normalization, /source_code:[\s\S]*form_type:[\s\S]*provider:[\s\S]*agency:/);
});

function read(path: string) {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}
