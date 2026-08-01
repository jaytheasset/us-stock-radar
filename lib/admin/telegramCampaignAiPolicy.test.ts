import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA,
  buildAdminTelegramAiPrompt,
  normalizeAdminTelegramAiFacts,
  parseAdminTelegramAiDraft,
} from "./telegramCampaignAiPolicy.ts";

test("AI drafting requires at least one supplied fact", () => {
  assert.throws(
    () => normalizeAdminTelegramAiFacts({}),
    /ADMIN_TELEGRAM_AI_FACTS_REQUIRED/,
  );
});

test("AI facts strip invalid URLs and keep only verified operator input", () => {
  const facts = normalizeAdminTelegramAiFacts({
    noticeType: "company_event",
    ticker: "bblg",
    sourceLabel: "SEC EDGAR",
    sourceUrl: "javascript:alert(1)",
    analysisUrl: "https://stockradar.example/analysis/filing",
    liveRoomUrl: "/live/BBLG",
  });
  assert.equal(facts.ticker, "BBLG");
  assert.equal(facts.sourceUrl, null);
  assert.equal(
    facts.analysisUrl,
    "https://stockradar.example/analysis/filing",
  );
  assert.equal(facts.liveRoomUrl, "/live/BBLG");
});

test("AI prompt explicitly forbids invented price, score, date, and outcomes", () => {
  const facts = normalizeAdminTelegramAiFacts({
    noticeType: "macro_policy",
    title: "FOMC statement reminder",
    scheduledForEt: "2026-08-02T14:00",
  });
  const prompt = buildAdminTelegramAiPrompt(facts);
  assert.match(prompt.instructions, /Do not infer or invent prices, scores, dates, times/i);
  assert.match(prompt.instructions, /Never turn a scheduled time into a confirmed outcome/i);
  assert.match(prompt.instructions, /macro or policy notices, recommend live_room only when liveRoomUrl is explicitly supplied/i);
  assert.doesNotMatch(prompt.input, /API_KEY|bot token|channel id/i);
});

test("AI response schema is strict and produces a review-only draft", () => {
  assert.equal(ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA.strict, true);
  assert.equal(
    ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA.schema.additionalProperties,
    false,
  );
  assert.deepEqual(
    parseAdminTelegramAiDraft(
      JSON.stringify({
        title: "Verified issuer update",
        body: "The issuer published a filing through the supplied source.",
        recommended_ctas: ["live_room", "analysis", "invented"],
      }),
    ),
    {
      title: "Verified issuer update",
      body: "The issuer published a filing through the supplied source.",
      recommendedCtas: ["live_room", "analysis"],
    },
  );
});

test("invalid or failed AI output never becomes usable campaign text", () => {
  for (const output of ["not json", "{}", '{"title":"Only title"}']) {
    assert.throws(
      () => parseAdminTelegramAiDraft(output),
      /ADMIN_TELEGRAM_AI_RESPONSE_INVALID/,
    );
  }
});
