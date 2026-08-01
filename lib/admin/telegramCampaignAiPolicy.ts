import {
  isAdminTelegramNoticeType,
  type AdminTelegramNoticeType,
} from "./telegramCampaignPolicy.ts";

export type AdminTelegramAiFacts = {
  noticeType: AdminTelegramNoticeType | null;
  title: string | null;
  body: string | null;
  ticker: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  analysisUrl: string | null;
  liveRoomUrl: string | null;
  scheduledForEt: string | null;
};

export type AdminTelegramAiDraft = {
  title: string;
  body: string;
  recommendedCtas: Array<"live_room" | "analysis" | "source">;
};

export const ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA = {
  name: "admin_telegram_channel_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "body", "recommended_ctas"],
    properties: {
      title: { type: "string", maxLength: 160 },
      body: { type: "string", maxLength: 1200 },
      recommended_ctas: {
        type: "array",
        maxItems: 3,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["live_room", "analysis", "source"],
        },
      },
    },
  },
} as const;

export function normalizeAdminTelegramAiFacts(value: unknown) {
  const input = asRecord(value);
  const noticeType = readString(input.noticeType);
  const facts: AdminTelegramAiFacts = {
    noticeType: isAdminTelegramNoticeType(noticeType) ? noticeType : null,
    title: optional(input.title, 160),
    body: optional(input.body, 3500),
    ticker: normalizeTicker(input.ticker),
    sourceLabel: optional(input.sourceLabel, 120),
    sourceUrl: optionalSafeUrl(input.sourceUrl),
    analysisUrl: optionalSafeUrl(input.analysisUrl),
    liveRoomUrl: optionalSafeUrl(input.liveRoomUrl),
    scheduledForEt: optional(input.scheduledForEt, 80),
  };
  if (
    !facts.noticeType &&
    !facts.title &&
    !facts.body &&
    !facts.ticker &&
    !facts.sourceLabel &&
    !facts.sourceUrl &&
    !facts.scheduledForEt
  ) {
    throw new Error("ADMIN_TELEGRAM_AI_FACTS_REQUIRED");
  }
  return facts;
}

export function buildAdminTelegramAiPrompt(facts: AdminTelegramAiFacts) {
  return {
    instructions: [
      "You write short operational notices for the Stock Radar free public Telegram channel.",
      "Use only the facts in the supplied JSON. Do not infer or invent prices, scores, dates, times, company claims, policy outcomes, or market impact.",
      "If a fact is absent, omit it. Never turn a scheduled time into a confirmed outcome.",
      "Keep the title direct and the body concise, factual, and neutral. Do not include HTML or Markdown.",
      "Return only the requested JSON schema.",
      "CTA recommendations must refer only to URLs supplied in the facts.",
      "For ticker or company notices, recommend live_room before analysis when those destinations exist.",
      "For macro or policy notices, recommend live_room only when liveRoomUrl is explicitly supplied.",
    ].join(" "),
    input: JSON.stringify({
      task: "Draft a Telegram channel notice for administrator review.",
      facts,
    }),
  };
}

export function parseAdminTelegramAiDraft(value: unknown): AdminTelegramAiDraft {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  const row = asRecord(parsed);
  const title = readString(row.title);
  const body = readString(row.body);
  if (!title || title.length > 160 || !body || body.length > 1200) {
    throw new Error("ADMIN_TELEGRAM_AI_RESPONSE_INVALID");
  }
  const allowed = new Set(["live_room", "analysis", "source"]);
  const recommendedCtas = Array.isArray(row.recommended_ctas)
    ? [...new Set(row.recommended_ctas.filter((item) => allowed.has(readString(item))))]
    : [];
  return {
    title,
    body,
    recommendedCtas: recommendedCtas as AdminTelegramAiDraft["recommendedCtas"],
  };
}

function optional(value: unknown, max: number) {
  const text = readString(value);
  return text ? text.slice(0, max) : null;
}

function optionalSafeUrl(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTicker(value: unknown) {
  const ticker = readString(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : null;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
