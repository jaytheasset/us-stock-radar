import {
  getCategoryLabel,
  isValidPublicAlertCategory,
} from "../../subscriptionPolicy.ts";
import type { NormalizedAlertEvent } from "./types.ts";
import {
  formatEventTimeEt,
  getCanonicalAlertAnalysisPath,
} from "../../telegram/telegramAlertMessage.ts";
import type { TelegramInlineKeyboardMarkup } from "../../telegram/sendTelegramMessage.ts";

export const PUBLIC_TELEGRAM_SCORE_THRESHOLD = 75;
export const PUBLIC_TELEGRAM_DELAY_MINUTES = 5;

const PRESS_RELEASE_SOURCE_CODES = new Set([
  "accesswire",
  "businesswire",
  "globe",
  "globenewswire",
  "newsfile",
  "prnewswire",
]);

export type PublicTelegramBroadcastEligibility = {
  due: boolean;
  eligible: boolean;
  reason?:
    | "SCORE_BELOW_THRESHOLD"
    | "CATEGORY_NOT_PUBLIC"
    | "ANALYSIS_INCOMPLETE"
    | "EVENT_TIME_MISSING";
  scheduledFor?: string;
};

export type PublicTelegramBroadcastPresentation = {
  parseMode: "HTML";
  replyMarkup?: TelegramInlineKeyboardMarkup;
  text: string;
};

export function evaluatePublicTelegramBroadcast(
  event: NormalizedAlertEvent,
  now = new Date(),
): PublicTelegramBroadcastEligibility {
  if (
    typeof event.score !== "number" ||
    event.score < PUBLIC_TELEGRAM_SCORE_THRESHOLD
  ) {
    return { due: false, eligible: false, reason: "SCORE_BELOW_THRESHOLD" };
  }
  if (!isValidPublicAlertCategory(event.category)) {
    return { due: false, eligible: false, reason: "CATEGORY_NOT_PUBLIC" };
  }
  if (!oneLine(event.quickTake || "", 400)) {
    return { due: false, eligible: false, reason: "ANALYSIS_INCOMPLETE" };
  }

  const eventTime = Date.parse(event.publishedAt || "");
  if (!Number.isFinite(eventTime)) {
    return { due: false, eligible: false, reason: "EVENT_TIME_MISSING" };
  }
  const scheduledFor = new Date(
    eventTime + PUBLIC_TELEGRAM_DELAY_MINUTES * 60 * 1000,
  ).toISOString();
  return {
    due: now.getTime() >= Date.parse(scheduledFor),
    eligible: true,
    scheduledFor,
  };
}

export function buildPublicTelegramBroadcastPresentation(
  event: NormalizedAlertEvent,
  options: { baseUrl: string },
): PublicTelegramBroadcastPresentation {
  const ticker = normalizeTicker(
    event.primaryTicker || event.tickers[0] || "",
  );
  const category = getCategoryLabel(event.category);
  const title = oneLine(event.title, 220) || "New market event detected.";
  const quickTake = oneLine(event.quickTake || "", 320);
  const source = buildPublicTelegramSourceLabel(event);
  const eventTime = formatEventTimeEt(event.publishedAt);
  const eventLabel = ticker ? `${category} · $${ticker}` : category;
  const lines = [
    "📡 <b>STOCK RADAR</b>",
    `<b>${escapeTelegramHtml(eventLabel)}</b>`,
    escapeTelegramHtml(title),
    "",
    `<b>Quick Take:</b> ${escapeTelegramHtml(quickTake)}`,
    `Source: ${escapeTelegramHtml(source)}`,
  ];
  if (eventTime) lines.push(`Event time: ${escapeTelegramHtml(eventTime)}`);

  const replyMarkup = buildPublicTelegramBroadcastKeyboard(event, options);
  return {
    text: lines.join("\n"),
    parseMode: "HTML",
    ...(replyMarkup ? { replyMarkup } : {}),
  };
}

export function buildPublicTelegramBroadcastKeyboard(
  event: NormalizedAlertEvent,
  options: { baseUrl: string },
): TelegramInlineKeyboardMarkup | undefined {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return undefined;

  const ticker = normalizeTicker(
    event.primaryTicker || event.tickers[0] || "",
  );
  const buttons: TelegramInlineKeyboardMarkup["inline_keyboard"][number] = [];
  const analysisPath = getCanonicalAlertAnalysisPath(event);
  if (analysisPath) {
    buttons.push({
      text: "View Analysis",
      url: buildAbsoluteUrl(baseUrl, analysisPath),
    });
  }
  if (ticker && event.marketScope === "company") {
    buttons.push({
      text: `Enter ${ticker} Live Room`,
      url: buildAbsoluteUrl(
        baseUrl,
        `/live/${encodeURIComponent(ticker)}`,
        { event: event.id, src: "telegram" },
      ),
    });
  }
  return buttons.length ? { inline_keyboard: [buttons] } : undefined;
}

export function buildPublicTelegramSourceLabel(event: NormalizedAlertEvent) {
  const sourceCode = metadataString(event, "source_code").toLowerCase();
  if (event.sourceType === "filing") {
    const form = safeSourceDetail(
      metadataString(event, "form_type") ||
        metadataString(event, "sec_form_type") ||
        metadataString(event, "formType"),
      24,
    );
    return form ? `SEC Filing · ${form}` : "SEC Filing";
  }

  const agency = safeSourceDetail(
    metadataString(event, "agency") || event.sourceLabel || "",
    48,
  );
  if (event.category === "macro_market") {
    return agency ? `Macro · ${agency}` : "Macro";
  }
  if (event.category === "policy_regulation") {
    return agency ? `Policy · ${agency}` : "Policy";
  }

  const provider = safeSourceDetail(
    metadataString(event, "provider") || event.sourceLabel || "",
    48,
  );
  if (PRESS_RELEASE_SOURCE_CODES.has(sourceCode)) {
    return provider ? `Press Release · ${provider}` : "Press Release";
  }
  return provider ? `News · ${provider}` : "News";
}

export function normalizePublicTelegramDestination(value: unknown) {
  const destination = typeof value === "string" ? value.trim() : "";
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(destination)) {
    return destination;
  }
  return /^-100\d{6,16}$/.test(destination) ? destination : "";
}

function metadataString(event: NormalizedAlertEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function safeSourceDetail(value: string, maxLength: number) {
  const normalized = oneLine(value, maxLength + 1);
  return normalized.length <= maxLength ? normalized : "";
}

function buildAbsoluteUrl(
  baseUrl: string,
  pathname: string,
  search?: Record<string, string>,
) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(search || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeBaseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.origin}/`
      : "";
  } catch {
    return "";
  }
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function oneLine(value: string, maxLength: number) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
