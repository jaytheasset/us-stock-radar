import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramMuteAction = "prompt" | "confirm" | "cancel";

const ACTION_CODES: Record<TelegramMuteAction, string> = {
  prompt: "p",
  confirm: "c",
  cancel: "x",
};
const ACTIONS_BY_CODE = new Map(
  Object.entries(ACTION_CODES).map(([action, code]) => [code, action as TelegramMuteAction]),
);
const CALLBACK_PREFIX = "sr:m";
const TOKEN_LENGTH = 16;

export function buildTelegramMuteCallbackData(
  ticker: string,
  action: TelegramMuteAction,
  secret: string,
  subject: string,
) {
  const token = buildTelegramMuteToken(ticker, secret, subject);
  return token ? `${CALLBACK_PREFIX}:${ACTION_CODES[action]}:${token}` : "";
}

export function parseTelegramMuteCallbackData(value: unknown): {
  action: TelegramMuteAction;
  token: string;
} | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^sr:m:([pcx]):([A-Za-z0-9_-]{16})$/);
  const action = match ? ACTIONS_BY_CODE.get(match[1]) : undefined;
  return action && match ? { action, token: match[2] } : null;
}

export function matchesTelegramMuteToken(ticker: string, token: string, secret: string, subject: string) {
  const expected = buildTelegramMuteToken(ticker, secret, subject);
  if (!expected || !token || expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function resolveTelegramMuteTicker(
  tickers: readonly string[],
  token: string,
  secret: string,
  subject: string,
) {
  return tickers
    .map(normalizeTicker)
    .find((ticker) => ticker && matchesTelegramMuteToken(ticker, token, secret, subject)) || "";
}

function buildTelegramMuteToken(ticker: string, secret: string, subject: string) {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedSecret = secret.trim();
  const normalizedSubject = subject.trim();
  if (!normalizedTicker || !normalizedSecret || !normalizedSubject) return "";
  return createHmac("sha256", normalizedSecret)
    .update(`stock-radar:telegram:mute:${normalizedSubject}:${normalizedTicker}`)
    .digest("base64url")
    .slice(0, TOKEN_LENGTH);
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}
