import type {
  TelegramInlineKeyboardMarkup,
  TelegramMessageOptions,
} from "../telegram/sendTelegramMessage.ts";

export const ADMIN_TELEGRAM_NOTICE_TYPES = [
  "general",
  "special_issue",
  "company_event",
  "macro_policy",
  "live_room",
] as const;

export const ADMIN_TELEGRAM_CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "canceled",
  "failed",
] as const;

export type AdminTelegramNoticeType =
  (typeof ADMIN_TELEGRAM_NOTICE_TYPES)[number];
export type AdminTelegramCampaignStatus =
  (typeof ADMIN_TELEGRAM_CAMPAIGN_STATUSES)[number];

export type AdminTelegramCampaignContent = {
  noticeType: AdminTelegramNoticeType | null;
  title: string | null;
  body: string | null;
  ticker: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  analysisUrl: string | null;
  liveRoomUrl: string | null;
};

export type AdminTelegramCampaignPresentation = TelegramMessageOptions & {
  text: string;
};

export class AdminTelegramCampaignPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "AdminTelegramCampaignPolicyError";
  }
}

const ET_TIME_ZONE = "America/New_York";
const ET_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function normalizeAdminTelegramCampaignContent(
  value: unknown,
  options: { baseUrl: string },
): AdminTelegramCampaignContent {
  const input = asRecord(value);
  const noticeType = normalizeNoticeType(input.noticeType);
  const title = optionalText(input.title, 160, "ADMIN_TELEGRAM_TITLE_TOO_LONG");
  const body = optionalBody(input.body);
  if (!title && !body) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_CONTENT_REQUIRED",
    );
  }
  const ticker = normalizeTicker(input.ticker);
  const sourceLabel = optionalText(
    input.sourceLabel,
    120,
    "ADMIN_TELEGRAM_SOURCE_LABEL_TOO_LONG",
  );
  return {
    noticeType,
    title,
    body,
    ticker,
    sourceLabel,
    sourceUrl: normalizeSafeUrl(input.sourceUrl, options.baseUrl),
    analysisUrl: normalizeSafeUrl(input.analysisUrl, options.baseUrl),
    liveRoomUrl: normalizeSafeUrl(input.liveRoomUrl, options.baseUrl),
  };
}

export function buildAdminTelegramCampaignPresentation(
  content: AdminTelegramCampaignContent,
  options: { baseUrl: string },
): AdminTelegramCampaignPresentation {
  const label = noticeTypeLabel(content.noticeType);
  const heading = content.ticker ? `${label} · $${content.ticker}` : label;
  const lines = ["📡 <b>STOCK RADAR</b>", `<b>${escapeHtml(heading)}</b>`];
  if (content.title) lines.push(`<b>${escapeHtml(content.title)}</b>`);
  if (content.body) {
    lines.push("", escapeHtml(content.body));
  }
  if (content.sourceUrl) {
    lines.push(
      "",
      `Source: <a href="${escapeHtmlAttribute(content.sourceUrl)}">${escapeHtml(content.sourceLabel || "Open source")}</a>`,
    );
  } else if (content.sourceLabel) {
    lines.push("", `Source: ${escapeHtml(content.sourceLabel)}`);
  }

  const replyMarkup = buildAdminTelegramCampaignKeyboard(content, options);
  return {
    text: lines.join("\n"),
    parseMode: "HTML",
    disableWebPagePreview: true,
    ...(replyMarkup ? { replyMarkup } : {}),
  };
}

export function buildAdminTelegramCampaignKeyboard(
  content: AdminTelegramCampaignContent,
  options: { baseUrl: string },
): TelegramInlineKeyboardMarkup | undefined {
  const rows: TelegramInlineKeyboardMarkup["inline_keyboard"] = [];
  const explicitLiveRoom = normalizeSafeUrl(content.liveRoomUrl, options.baseUrl);
  const tickerLiveRoom =
    content.ticker && content.noticeType !== "macro_policy"
    ? normalizeSafeUrl(
        `/live/${encodeURIComponent(content.ticker)}`,
        options.baseUrl,
      )
    : null;
  const liveRoomUrl = content.ticker && content.noticeType !== "macro_policy"
    ? explicitLiveRoom || tickerLiveRoom
    : explicitLiveRoom;

  if (liveRoomUrl) {
    rows.push([
      {
        text: content.ticker
          && content.noticeType !== "macro_policy"
          ? `Enter ${content.ticker} Live Room`
          : "Enter Live Room",
        url: liveRoomUrl,
      },
    ]);
  }
  if (content.analysisUrl) {
    rows.push([{ text: "View Analysis", url: content.analysisUrl }]);
  }
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export function etLocalDateTimeToUtc(value: unknown) {
  const local = readString(value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_SCHEDULE_INVALID",
    );
  }
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (
    desired.month < 1 ||
    desired.month > 12 ||
    desired.day < 1 ||
    desired.day > 31 ||
    desired.hour > 23 ||
    desired.minute > 59
  ) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_SCHEDULE_INVALID",
    );
  }

  const desiredEpoch = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let candidate = desiredEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = etDateParts(new Date(candidate));
    const observedEpoch = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    candidate += desiredEpoch - observedEpoch;
  }
  const roundTrip = etDateParts(new Date(candidate));
  if (!sameDateParts(desired, roundTrip)) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_SCHEDULE_INVALID",
    );
  }
  return new Date(candidate).toISOString();
}

export function utcToEtLocalDateTime(value: unknown) {
  const date = validDate(value);
  if (!date) return "";
  const parts = etDateParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatEtDateTime(value: unknown) {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function isAdminTelegramNoticeType(
  value: unknown,
): value is AdminTelegramNoticeType {
  return ADMIN_TELEGRAM_NOTICE_TYPES.includes(
    value as AdminTelegramNoticeType,
  );
}

export function isAdminTelegramCampaignStatus(
  value: unknown,
): value is AdminTelegramCampaignStatus {
  return ADMIN_TELEGRAM_CAMPAIGN_STATUSES.includes(
    value as AdminTelegramCampaignStatus,
  );
}

export function noticeTypeLabel(value: AdminTelegramNoticeType | null) {
  const labels: Record<AdminTelegramNoticeType, string> = {
    general: "Channel Notice",
    special_issue: "Special Issue",
    company_event: "Company Event",
    macro_policy: "Macro & Policy",
    live_room: "Live Room",
  };
  return value ? labels[value] : "Channel Notice";
}

export function campaignStatusLabel(value: AdminTelegramCampaignStatus) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function normalizeNoticeType(value: unknown) {
  const normalized = readString(value);
  if (!normalized) return null;
  if (!isAdminTelegramNoticeType(normalized)) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_NOTICE_TYPE_INVALID",
    );
  }
  return normalized;
}

function normalizeTicker(value: unknown) {
  const ticker = readString(value).toUpperCase();
  if (!ticker) return null;
  if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_TICKER_INVALID",
    );
  }
  return ticker;
}

function optionalText(value: unknown, max: number, code: string) {
  const normalized = readString(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new AdminTelegramCampaignPolicyError(code);
  }
  return normalized;
}

function optionalBody(value: unknown) {
  const normalized = readString(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return null;
  if (normalized.length > 3500) {
    throw new AdminTelegramCampaignPolicyError(
      "ADMIN_TELEGRAM_BODY_TOO_LONG",
    );
  }
  return normalized;
}

function normalizeSafeUrl(value: unknown, baseUrl: string) {
  const raw = readString(value);
  if (!raw) return null;
  try {
    const url = raw.startsWith("/") ? new URL(raw, baseUrl) : new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    throw new AdminTelegramCampaignPolicyError("ADMIN_TELEGRAM_URL_INVALID");
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function etDateParts(date: Date) {
  const parts = new Map(
    ET_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.get("year")),
    month: Number(parts.get("month")),
    day: Number(parts.get("day")),
    hour: Number(parts.get("hour")),
    minute: Number(parts.get("minute")),
  };
}

function sameDateParts(
  left: ReturnType<typeof etDateParts>,
  right: ReturnType<typeof etDateParts>,
) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function validDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(readString(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
