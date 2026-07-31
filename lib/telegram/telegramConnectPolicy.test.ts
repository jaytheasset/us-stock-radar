import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTelegramConnectToken,
  isPrivateTelegramChat,
  isTelegramDestinationUniqueConflict,
  normalizeTelegramDestination,
  normalizeTelegramUsername,
  parseTelegramStartToken,
  TELEGRAM_DESTINATION_CONFLICT_MESSAGE,
} from "./telegramConnectPolicy.ts";

test("Telegram destination ownership uses the exact public conflict message", () => {
  assert.equal(
    TELEGRAM_DESTINATION_CONFLICT_MESSAGE,
    "This Telegram account is already connected to another Stock Radar account.",
  );
  assert.equal(normalizeTelegramDestination(" 123456 "), "123456");
  assert.equal(normalizeTelegramDestination(-123456), "-123456");
  assert.equal(normalizeTelegramDestination(null), "");
  assert.equal(
    isTelegramDestinationUniqueConflict({
      status: 409,
      error: "duplicate key value violates unique constraint",
    }),
    true,
  );
});

test("Telegram connect tokens reject expiry, reuse, and malformed start payloads", () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  assert.equal(
    classifyTelegramConnectToken({ expiresAt: "2026-08-01T00:15:00.000Z", usedAt: null, now }),
    "valid",
  );
  assert.equal(
    classifyTelegramConnectToken({ expiresAt: "2026-08-01T00:00:00.000Z", usedAt: null, now }),
    "expired",
  );
  assert.equal(
    classifyTelegramConnectToken({ expiresAt: "2026-08-01T00:15:00.000Z", usedAt: "2026-08-01T00:00:01.000Z", now }),
    "used",
  );
  const token = "abcdefghijklmnop";
  assert.equal(parseTelegramStartToken(`/start ${token}`), token);
  assert.equal(parseTelegramStartToken(`/start@StockRadarBot ${token}`), token);
  assert.equal(parseTelegramStartToken(`/start ${token} unexpected`), "");
});

test("Telegram account labels expose only a validated username", () => {
  assert.equal(normalizeTelegramUsername(" radar_user "), "@radar_user");
  assert.equal(normalizeTelegramUsername("@radar_user"), "@radar_user");
  assert.equal(normalizeTelegramUsername(""), null);
  assert.equal(normalizeTelegramUsername("private chat 123"), null);
  assert.equal(normalizeTelegramUsername(undefined), null);
});

test("Telegram webhook accepts only a human sender in their matching private chat", () => {
  assert.equal(
    isPrivateTelegramChat({ chatId: 42, chatType: "private", senderId: 42, senderIsBot: false }),
    true,
  );
  assert.equal(
    isPrivateTelegramChat({ chatId: 42, chatType: "group", senderId: 42, senderIsBot: false }),
    false,
  );
  assert.equal(
    isPrivateTelegramChat({ chatId: 42, chatType: "private", senderId: 43, senderIsBot: false }),
    false,
  );
  assert.equal(
    isPrivateTelegramChat({ chatId: 42, chatType: "private", senderId: 42, senderIsBot: true }),
    false,
  );
});
