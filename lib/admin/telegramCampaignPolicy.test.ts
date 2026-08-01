import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminTelegramCampaignPolicyError,
  buildAdminTelegramCampaignKeyboard,
  buildAdminTelegramCampaignPresentation,
  etLocalDateTimeToUtc,
  normalizeAdminTelegramCampaignContent,
  utcToEtLocalDateTime,
} from "./telegramCampaignPolicy.ts";

const baseUrl = "https://stockradar.example/";

test("campaign content rejects executable and non-http URLs", () => {
  for (const unsafe of ["javascript:alert(1)", "data:text/html,test", "ftp://example.com/file"]) {
    assert.throws(
      () =>
        normalizeAdminTelegramCampaignContent(
          { title: "Verified notice", sourceUrl: unsafe },
          { baseUrl },
        ),
      (error) =>
        error instanceof AdminTelegramCampaignPolicyError &&
        error.code === "ADMIN_TELEGRAM_URL_INVALID",
    );
  }
});

test("ticker notices put Live Room before analysis using safe absolute URLs", () => {
  const content = normalizeAdminTelegramCampaignContent(
    {
      noticeType: "company_event",
      title: "Issuer event",
      ticker: "bblg",
      analysisUrl: "/analysis/issuer-event",
    },
    { baseUrl },
  );
  const keyboard = buildAdminTelegramCampaignKeyboard(content, { baseUrl });
  assert.deepEqual(
    keyboard?.inline_keyboard.map((row) => row[0].text),
    ["Enter BBLG Live Room", "View Analysis"],
  );
  assert.equal(
    keyboard?.inline_keyboard[0][0].url,
    "https://stockradar.example/live/BBLG",
  );
});

test("macro and policy notices never infer a Live Room from a ticker", () => {
  const withoutExplicitRoom = normalizeAdminTelegramCampaignContent(
    {
      noticeType: "macro_policy",
      title: "Policy announcement",
      ticker: "SPY",
      analysisUrl: "/analysis/policy",
    },
    { baseUrl },
  );
  assert.deepEqual(
    buildAdminTelegramCampaignKeyboard(withoutExplicitRoom, { baseUrl })
      ?.inline_keyboard.map((row) => row[0].text),
    ["View Analysis"],
  );

  const withExplicitRoom = {
    ...withoutExplicitRoom,
    liveRoomUrl: "https://stockradar.example/live/macro-policy",
  };
  assert.deepEqual(
    buildAdminTelegramCampaignKeyboard(withExplicitRoom, { baseUrl })
      ?.inline_keyboard.map((row) => row[0].text),
    ["Enter Live Room", "View Analysis"],
  );
});

test("Telegram presentation escapes administrator text and keeps native buttons", () => {
  const content = normalizeAdminTelegramCampaignContent(
    {
      noticeType: "special_issue",
      title: "A < B & verified",
      body: "Use verified facts only.",
      sourceLabel: "Official source",
      sourceUrl: "https://example.com/source",
    },
    { baseUrl },
  );
  const presentation = buildAdminTelegramCampaignPresentation(content, {
    baseUrl,
  });
  assert.match(presentation.text, /A &lt; B &amp; verified/);
  assert.equal(presentation.parseMode, "HTML");
  assert.equal(presentation.disableWebPagePreview, true);
  assert.equal(presentation.replyMarkup, undefined);
});

test("ET scheduling round-trips through UTC and rejects the DST spring gap", () => {
  const utc = etLocalDateTimeToUtc("2026-12-15T09:30");
  assert.equal(utc, "2026-12-15T14:30:00.000Z");
  assert.equal(utcToEtLocalDateTime(utc), "2026-12-15T09:30");
  assert.throws(
    () => etLocalDateTimeToUtc("2026-03-08T02:30"),
    /ADMIN_TELEGRAM_SCHEDULE_INVALID/,
  );
});
