import "server-only";

import {
  ALERT_CATEGORIES,
  type AlertChannel,
  type Plan,
  type PublicAlertCategory,
  getAllAlertCategoryValues,
  getDiscoveryCategoriesForPlan,
  getPlanDisplayName,
  getPlanLimits,
  isValidPublicAlertCategory,
} from "@/lib/subscriptionPolicy";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";

export const ALL_ALERT_CHANNELS: AlertChannel[] = ["web", "telegram", "email", "webhook", "api"];
export const IMPLEMENTED_ALERT_CHANNELS: AlertChannel[] = ["web", "telegram"];
export const ALERT_MARKET_CAP_FILTERS = ["mega", "large", "mid", "small", "micro"] as const;
export const ALERT_FILING_TYPE_FILTERS = [
  "8-k", "10-q", "10-k", "6-k", "20-f",
  "s-1", "s-3", "s-4", "s-8", "f-1", "f-3", "f-4",
  "424b", "424b3", "424b4", "424b5",
  "def-14a", "pre-14a", "defa14a",
  "sc-13d", "sc-13g", "form-4", "144",
  "sc-to-i", "sc-to-t", "sc-14d9", "25-nse", "pos-am", "effect",
  "8-k-a", "10-q-a", "10-k-a", "nt-10-k", "nt-10-q",
] as const;

export const DEFAULT_ALERT_PREFERENCES = {
  watchlistNewsEnabled: true,
  watchlistFilingsEnabled: true,
  watchlistCalendarEnabled: true,
  watchlistRiskEnabled: true,
  discoveryEnabled: true,
  groupDuplicates: true,
  cooldownMinutes: 60,
  marketCapFilters: [...ALERT_MARKET_CAP_FILTERS],
  filingTypeFilters: [...ALERT_FILING_TYPE_FILTERS],
} as const;

export const ALERT_PREFERENCE_FIELDS = [
  "watchlistNewsEnabled",
  "watchlistFilingsEnabled",
  "watchlistCalendarEnabled",
  "watchlistRiskEnabled",
  "discoveryEnabled",
  "groupDuplicates",
  "cooldownMinutes",
  "marketCapFilters",
  "filingTypeFilters",
] as const;

export async function getUserPlan(userId: string): Promise<Plan> {
  const state = await getEffectiveUserPlan(userId);
  return state.effectivePlan;
}

export function assertValidCategories(categories: unknown): PublicAlertCategory[] {
  if (!Array.isArray(categories)) {
    throw new AlertValidationError("INVALID_CATEGORIES", "categories must be an array.");
  }

  const normalized: PublicAlertCategory[] = [];
  for (const item of categories) {
    if (typeof item !== "string") {
      throw new AlertValidationError("INVALID_CATEGORY", "Each category must be a string.");
    }
    const category = item.trim();
    if (!isValidPublicAlertCategory(category)) {
      throw new AlertValidationError("INVALID_CATEGORY", `${category || "Empty category"} is not a supported alert category.`);
    }
    if (!normalized.includes(category)) {
      normalized.push(category);
    }
  }

  return normalized;
}

export function assertDiscoveryCategoriesAllowed(plan: Plan, categories: PublicAlertCategory[]) {
  const allowed = new Set(getDiscoveryCategoriesForPlan(plan));
  const unavailable = categories.filter((category) => !allowed.has(category));
  if (unavailable.length > 0) {
    throw new AlertValidationError("CATEGORY_NOT_AVAILABLE_ON_PLAN", buildCategoryAvailabilityMessage(plan), {
      unavailable,
      allowed: [...allowed],
    });
  }
}

export function buildCategoryAvailabilityMessage(plan: Plan) {
  const planName = getPlanDisplayName(plan);
  const upgradeText =
    plan === "free" || plan === "ad_free" || plan === "pro"
      ? " Upgrade to Advanced to unlock all 17 market-wide Discovery categories."
      : "";
  return `${planName} includes the approved Discovery category set for this plan.${upgradeText}`;
}

export function getChannelLockState(plan: Plan, channel: AlertChannel) {
  return !getPlanLimits(plan).channels.includes(channel);
}

export function getChannelAvailabilityLabel(plan: Plan, channel: AlertChannel) {
  const available = !getChannelLockState(plan, channel);

  if (channel === "web") return "Available on all plans";
  if (channel === "telegram") {
    return available ? "Included in Pro and higher" : "Available on Pro and higher";
  }
  if (channel === "email") {
    return available ? "Included in Advanced and higher" : "Available on Advanced and higher";
  }
  if (channel === "webhook" || channel === "api") {
    return available ? "Included in Ultimate" : "Available on Ultimate";
  }

  return "";
}

export function buildChannelNotAvailableMessage(channel: AlertChannel) {
  if (channel === "telegram") return "Telegram alerts are available on Pro and higher plans.";
  if (channel === "email") return "Email alerts are available on Advanced and Ultimate plans.";
  if (channel === "webhook") return "Webhook alerts are available on Ultimate plans.";
  if (channel === "api") return "API alerts are available on Ultimate plans.";
  return "This channel is not available on your current plan.";
}

export function assertValidAlertChannel(channel: unknown): AlertChannel {
  if (typeof channel !== "string") {
    throw new AlertValidationError("INVALID_CHANNEL", "channel must be a string.");
  }

  const normalized = channel.trim().toLowerCase();
  if (normalized === "web" || normalized === "telegram" || normalized === "email" || normalized === "webhook" || normalized === "api") {
    return normalized;
  }

  throw new AlertValidationError("INVALID_CHANNEL", `${channel || "Empty channel"} is not a supported alert channel.`);
}

export function normalizeChannelPatch(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AlertValidationError("INVALID_BODY", "Request body must be an object.");
  }

  const input = body as Record<string, unknown>;
  const channel = assertValidAlertChannel(input.channel);

  if (typeof input.enabled !== "boolean") {
    throw new AlertValidationError("INVALID_CHANNEL_STATE", "enabled must be a boolean.");
  }

  return {
    channel,
    enabled: input.enabled,
  };
}

export function getAllCategoryRowsForUser(userId: string, enabledCategories: PublicAlertCategory[]) {
  const enabled = new Set(enabledCategories);
  return getAllAlertCategoryValues().map((category) => ({
    user_id: userId,
    category,
    enabled: enabled.has(category),
  }));
}

export function normalizePreferencePatch(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AlertValidationError("INVALID_BODY", "Request body must be an object.");
  }

  const input = body as Record<string, unknown>;
  const patch: Record<string, boolean | number | string[]> = {};

  for (const field of ALERT_PREFERENCE_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (field === "cooldownMinutes") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new AlertValidationError("INVALID_COOLDOWN", "cooldownMinutes must be a number between 5 and 1440.");
      }
      patch.cooldownMinutes = Math.max(5, Math.min(1440, Math.floor(numeric)));
      continue;
    }
    if (field === "marketCapFilters") {
      patch.marketCapFilters = normalizeFilterValues(
        value,
        ALERT_MARKET_CAP_FILTERS,
        "market cap filter",
      );
      continue;
    }
    if (field === "filingTypeFilters") {
      patch.filingTypeFilters = normalizeFilterValues(
        value,
        ALERT_FILING_TYPE_FILTERS,
        "filing type filter",
      );
      continue;
    }
    if (typeof value !== "boolean") {
      throw new AlertValidationError("INVALID_PREFERENCE", `${field} must be a boolean.`);
    }
    patch[field] = value;
  }

  return patch;
}

export function assertAdvancedAlertFiltersAllowed(
  plan: Plan,
  patch: Record<string, boolean | number | string[]>,
) {
  const limits = getPlanLimits(plan);
  if ("marketCapFilters" in patch && !limits.advancedFilters) {
    throw new AlertValidationError(
      "ADVANCED_FILTERS_NOT_AVAILABLE",
      "Market cap filters are available on Advanced and Ultimate plans.",
    );
  }
  if ("filingTypeFilters" in patch && !limits.customRules) {
    throw new AlertValidationError(
      "CUSTOM_RULES_NOT_AVAILABLE",
      "Form-level filing rules are available on Ultimate.",
    );
  }
}

function normalizeFilterValues(
  value: unknown,
  allowedValues: readonly string[],
  label: string,
) {
  if (!Array.isArray(value)) {
    throw new AlertValidationError(
      "INVALID_ALERT_FILTER",
      `${label} values must be an array.`,
    );
  }
  const allowed = new Set(allowedValues);
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new AlertValidationError(
        "INVALID_ALERT_FILTER",
        `${String(item || "Empty value")} is not a supported ${label}.`,
      );
    }
    if (!normalized.includes(item)) normalized.push(item);
  }
  return normalized;
}

export class AlertValidationError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AlertValidationError";
    this.code = code;
    this.details = details;
  }
}

export function getCategoryDisplayRows() {
  return ALERT_CATEGORIES;
}
