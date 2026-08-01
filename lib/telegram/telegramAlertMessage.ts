import { getCategoryLabel } from "../subscriptionPolicy.ts";
import type { NormalizedAlertEvent } from "../alerts/delivery/types.ts";
import { buildTelegramMuteCallbackData } from "./telegramCallbackPolicy.ts";
import type { TelegramInlineKeyboardMarkup } from "./sendTelegramMessage.ts";

export type TelegramAlertPresentation = {
  text: string;
  parseMode: "HTML";
  replyMarkup?: TelegramInlineKeyboardMarkup;
};

export function buildTelegramAlertPresentation(
  event: NormalizedAlertEvent,
  options: { baseUrl: string; callbackSecret: string; callbackSubject: string },
): TelegramAlertPresentation {
  const ticker = normalizeTicker(event.primaryTicker || event.tickers[0] || "");
  const category = getCategoryLabel(event.category);
  const headline = oneLine(event.quickTake || event.title, 260);
  const facts = [
    event.signal ? `Signal: ${titleCase(event.signal)}` : "",
    typeof event.score === "number" ? `Score: ${event.score}` : "",
    event.impact ? `Impact: ${titleCase(event.impact)}` : "",
  ].filter(Boolean);
  const time = formatEventTimeEt(event.publishedAt);
  const label = ticker ? `${category} · $${ticker}` : category;
  const lines = [
    "🚨 <b>STOCK RADAR</b>",
    `<b>${escapeTelegramHtml(label)}</b>`,
    escapeTelegramHtml(headline),
  ];
  if (facts.length) lines.push("", escapeTelegramHtml(facts.join(" · ")));
  if (time) lines.push(`Event time: ${escapeTelegramHtml(time)}`);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
    replyMarkup: buildTelegramAlertKeyboard(event, options),
  };
}

export function buildTelegramAlertKeyboard(
  event: NormalizedAlertEvent,
  options: { baseUrl: string; callbackSecret: string; callbackSubject: string },
): TelegramInlineKeyboardMarkup | undefined {
  const ticker = normalizeTicker(event.primaryTicker || event.tickers[0] || "");
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return undefined;

  const rows: TelegramInlineKeyboardMarkup["inline_keyboard"] = [];
  const isCompanyTickerEvent = Boolean(ticker && event.marketScope === "company");
  if (isCompanyTickerEvent) {
    const liveRoomUrl = buildAbsoluteUrl(baseUrl, `/live/${encodeURIComponent(ticker)}`, {
      event: event.id,
      src: "telegram",
    });
    rows.push([{ text: `💬 Enter ${ticker} Live Room`, url: liveRoomUrl }]);
  }

  const secondary = [];
  const analysisPath = getCanonicalAnalysisPath(event);
  if (analysisPath) {
    secondary.push({ text: "View Analysis", url: buildAbsoluteUrl(baseUrl, analysisPath) });
  }
  secondary.push({ text: "Alert Settings", url: buildAbsoluteUrl(baseUrl, "/alerts") });
  rows.push(secondary);

  if (isCompanyTickerEvent) {
    const callbackData = buildTelegramMuteCallbackData(
      ticker,
      "prompt",
      options.callbackSecret,
      options.callbackSubject,
    );
    if (callbackData) rows.push([{ text: `Mute ${ticker}`, callback_data: callbackData }]);
  }

  return { inline_keyboard: rows };
}

export function buildTelegramMuteConfirmationKeyboard(ticker: string, tokenSecret: string, callbackSubject: string) {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return undefined;
  return {
    inline_keyboard: [[
      {
        text: `Confirm mute ${normalizedTicker}`,
        callback_data: buildTelegramMuteCallbackData(normalizedTicker, "confirm", tokenSecret, callbackSubject),
      },
      {
        text: "Cancel",
        callback_data: buildTelegramMuteCallbackData(normalizedTicker, "cancel", tokenSecret, callbackSubject),
      },
    ]],
  } satisfies TelegramInlineKeyboardMarkup;
}

export function formatEventTimeEt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted} ET`;
}

function getCanonicalAnalysisPath(event: NormalizedAlertEvent) {
  if (!event.id.trim()) return "";
  if (event.sourceType === "filing") return `/filings/${encodeURIComponent(event.id)}`;
  if (event.sourceType === "news") return `/events/${encodeURIComponent(event.id)}`;
  return "";
}

function buildAbsoluteUrl(baseUrl: string, pathname: string, search?: Record<string, string>) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(search || {})) url.searchParams.set(key, value);
  return url.toString();
}

function normalizeBaseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/` : "";
  } catch {
    return "";
  }
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function oneLine(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim() || "New market event detected.";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
