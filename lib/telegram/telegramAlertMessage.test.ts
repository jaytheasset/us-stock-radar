import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCompanyLiveRoomEntryPath, createLiveRoomMemberLoginHref } from "../live-room/memberActions.ts";
import type { NormalizedAlertEvent } from "../alerts/delivery/types.ts";
import {
  buildTelegramAlertPresentation,
  buildTelegramMuteConfirmationKeyboard,
  formatEventTimeEt,
} from "./telegramAlertMessage.ts";
import {
  buildTelegramMuteCallbackData,
  matchesTelegramMuteToken,
  parseTelegramMuteCallbackData,
  resolveTelegramMuteTicker,
} from "./telegramCallbackPolicy.ts";

const secret = "telegram-webhook-secret-for-tests";
const callbackSubject = "stock-radar-user-a";
const companyEvent: NormalizedAlertEvent = {
  id: "6b54bb97-1de6-4ad0-9f87-6d44d46914e4",
  title: "AMD reports quarterly results",
  quickTake: "Revenue beats estimates & guidance rises <materially>.",
  tickers: ["AMD"],
  primaryTicker: "AMD",
  category: "earnings",
  sourceType: "filing",
  score: 88,
  signal: "bullish",
  impact: "high",
  marketScope: "company",
  publishedAt: "2026-08-01T14:30:00.000Z",
};

test("company Telegram alerts use actual event facts, ET time, and canonical actions", () => {
  const presentation = buildTelegramAlertPresentation(companyEvent, {
    baseUrl: "https://us-stock-radar.com/app-path-is-ignored",
    callbackSecret: secret,
    callbackSubject,
  });

  assert.equal(presentation.parseMode, "HTML");
  assert.match(presentation.text, /STOCK RADAR/);
  assert.match(presentation.text, /Earnings · \$AMD/);
  assert.match(presentation.text, /Revenue beats estimates &amp; guidance rises &lt;materially&gt;\./);
  assert.doesNotMatch(presentation.text, /AMD reports quarterly results/);
  assert.match(presentation.text, /Signal: Bullish · Score: 88 · Impact: High/);
  assert.match(presentation.text, /Event time: Aug 1, 2026, 10:30 AM ET/);
  assert.doesNotMatch(presentation.text, /price|change|%/i);

  const keyboard = presentation.replyMarkup?.inline_keyboard;
  assert.ok(keyboard);
  assert.equal(keyboard[0].length, 1);
  assert.equal(keyboard[0][0].text, "💬 Enter AMD Live Room");
  const liveUrl = new URL(keyboard[0][0].url || "");
  assert.equal(liveUrl.origin, "https://us-stock-radar.com");
  assert.equal(liveUrl.pathname, "/live/AMD");
  assert.equal(liveUrl.searchParams.get("event"), companyEvent.id);
  assert.equal(liveUrl.searchParams.get("src"), "telegram");
  assert.deepEqual(keyboard[1].map((button) => button.text), ["View Analysis", "Alert Settings"]);
  assert.equal(new URL(keyboard[1][0].url || "").pathname, `/filings/${companyEvent.id}`);
  assert.equal(new URL(keyboard[1][1].url || "").pathname, "/alerts");
  assert.equal(keyboard[2][0].text, "Mute AMD");
});

test("missing Telegram facts stay omitted and non-company events never invent a Live Room", () => {
  const marketEvent: NormalizedAlertEvent = {
    id: "market-event-id",
    title: "Federal Reserve publishes a policy statement",
    tickers: [],
    category: "policy_regulation",
    sourceType: "news",
    marketScope: "macro",
  };
  const presentation = buildTelegramAlertPresentation(marketEvent, {
    baseUrl: "https://us-stock-radar.com",
    callbackSecret: secret,
    callbackSubject,
  });

  assert.doesNotMatch(presentation.text, /Signal:|Score:|Impact:|Event time:/);
  const buttons = presentation.replyMarkup?.inline_keyboard.flat() || [];
  assert.deepEqual(buttons.map((button) => button.text), ["View Analysis", "Alert Settings"]);
  assert.equal(buttons.some((button) => /Live Room|Mute/.test(button.text)), false);
});

test("mute callbacks are short opaque HMAC actions and replays resolve the same ticker", () => {
  const prompt = buildTelegramMuteCallbackData("AMD", "prompt", secret, callbackSubject);
  const confirm = buildTelegramMuteCallbackData("AMD", "confirm", secret, callbackSubject);
  const cancel = buildTelegramMuteCallbackData("AMD", "cancel", secret, callbackSubject);

  for (const value of [prompt, confirm, cancel]) {
    assert.ok(Buffer.byteLength(value, "utf8") <= 64);
    assert.doesNotMatch(value, /AMD|user|chat|secret/i);
  }
  assert.deepEqual(parseTelegramMuteCallbackData(confirm)?.action, "confirm");
  assert.equal(matchesTelegramMuteToken("AMD", parseTelegramMuteCallbackData(confirm)?.token || "", secret, callbackSubject), true);
  assert.equal(matchesTelegramMuteToken("NVDA", parseTelegramMuteCallbackData(confirm)?.token || "", secret, callbackSubject), false);
  assert.equal(
    matchesTelegramMuteToken(
      "AMD",
      parseTelegramMuteCallbackData(confirm)?.token || "",
      secret,
      "stock-radar-user-b",
    ),
    false,
  );
  assert.equal(
    resolveTelegramMuteTicker(["NVDA"], parseTelegramMuteCallbackData(confirm)?.token || "", secret, callbackSubject),
    "",
  );
  assert.equal(
    resolveTelegramMuteTicker(["NVDA", "AMD"], parseTelegramMuteCallbackData(confirm)?.token || "", secret, callbackSubject),
    "AMD",
  );
  assert.equal(parseTelegramMuteCallbackData(`${confirm}tampered`), null);

  const confirmation = buildTelegramMuteConfirmationKeyboard("AMD", secret, callbackSubject);
  assert.deepEqual(confirmation?.inline_keyboard[0].map((button) => button.text), [
    "Confirm mute AMD",
    "Cancel",
  ]);
});

test("Telegram Live Room login round-trip preserves event and source query values", () => {
  const returnPath = createCompanyLiveRoomEntryPath({
    ticker: "amd",
    eventId: companyEvent.id,
    source: "telegram",
  });
  assert.equal(returnPath, `/live/AMD?event=${companyEvent.id}&src=telegram`);
  const loginHref = createLiveRoomMemberLoginHref(returnPath);
  const next = new URL(loginHref, "https://us-stock-radar.com").searchParams.get("next");
  assert.equal(next, returnPath);
  assert.equal(
    createCompanyLiveRoomEntryPath({ ticker: "AMD", eventId: "https://evil.example", source: "evil" }),
    "/live/AMD",
  );
});

test("ET formatter is deterministic across daylight saving time", () => {
  assert.equal(formatEventTimeEt("2026-01-15T14:30:00.000Z"), "Jan 15, 2026, 9:30 AM ET");
  assert.equal(formatEventTimeEt("not-a-date"), "");
});

test("webhook and delivery wiring keep callbacks server-owned and Telegram sends gated", () => {
  const webhook = read("app/api/telegram/webhook/route.ts");
  const interactions = read("lib/telegram/telegramInteractions.ts");
  const sender = read("lib/telegram/sendTelegramMessage.ts");
  const queued = read("lib/alerts/delivery/processQueuedDeliveries.ts");
  const eventCli = read("scripts/run-alert-delivery-for-event.mjs");
  const livePage = read("app/live/[ticker]/page.tsx");
  const liveClient = read("components/live-room/LiveRoomClient.tsx");

  assert.match(webhook, /export const runtime = "nodejs"/);
  assert.match(webhook, /update\?\.callback_query/);
  assert.match(webhook, /isPrivateTelegramChat/);
  assert.match(webhook, /answerTelegramCallbackQuery/);
  assert.match(webhook, /command\.name === "settings"/);
  assert.match(webhook, /command\.name === "help"/);
  assert.doesNotMatch(webhook, /user_metadata/);
  assert.match(interactions, /normalizeTelegramDestination\(destination\)/);
  assert.match(interactions, /destination: `eq\.\$\{normalizedDestination\}`/);
  assert.match(interactions, /user_id: `eq\.\$\{userId\}`/);
  assert.match(interactions, /ticker: `eq\.\$\{ticker\}`/);
  assert.match(interactions, /\{ enabled: false \}/);
  assert.doesNotMatch(interactions, /user_metadata|NEXT_PUBLIC|console\./);
  assert.match(sender, /Buffer\.byteLength\(button\.callback_data/);
  assert.match(sender, /"HTML" \| "MarkdownV2"/);
  assert.doesNotMatch(sender, /console\./);
  assert.match(queued, /ALERT_DELIVERY_SEND_TELEGRAM !== "true"/);
  assert.match(eventCli, /runtime\.processQueuedDeliveryById/);
  assert.doesNotMatch(eventCli, /api\.telegram\.org|async function sendTelegramMessage/);
  assert.match(livePage, /createCompanyLiveRoomEntryPath\(\{[\s\S]*eventId: query\.event,[\s\S]*source: query\.src/);
  assert.match(livePage, /loginReturnPath=\{loginReturnPath\}/);
  assert.match(liveClient, /createLiveRoomMemberLoginHref\(\s*`\/live\/\$\{ticker\}`,\s*loginReturnPath/);
});

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
