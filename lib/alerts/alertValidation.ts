import "server-only";

import {
  ALERT_CATEGORIES,
  type AlertCategory,
  type AlertChannel,
  type Plan,
  formatLimit,
  getAllAlertCategoryValues,
  getPlanDisplayName,
  getPlanLimits,
  getPlanUpgradeTarget,
  isValidAlertCategory,
} from "@/lib/subscriptionPolicy";
import { supabaseSelect } from "@/lib/supabase";

export const ALL_ALERT_CHANNELS: AlertChannel[] = ["web", "telegram", "email", "webhook", "api"];

export const DEFAULT_ALERT_PREFERENCES = {
  watchlistNewsEnabled: true,
  watchlistFilingsEnabled: true,
  watchlistCalendarEnabled: true,
  watchlistRiskEnabled: true,
  discoveryEnabled: true,
  groupDuplicates: true,
  cooldownMinutes: 60,
} as const;

export const ALERT_PREFERENCE_FIELDS = [
  "watchlistNewsEnabled",
  "watchlistFilingsEnabled",
  "watchlistCalendarEnabled",
  "watchlistRiskEnabled",
  "discoveryEnabled",
  "groupDuplicates",
  "cooldownMinutes",
] as const;

export async function getUserPlan(userId: string): Promise<Plan> {
  const result = await supabaseSelect("user_plan_subscriptions", {
    select: "plan,status",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const row = Array.isArray(result.data) ? (result.data[0] as { plan?: unknown; status?: unknown } | undefined) : undefined;
  const plan = typeof row?.plan === "string" ? row.plan : "";
  const status = typeof row?.status === "string" ? row.status : "";

  if (status && status !== "active") return "free";
  if (isValidPlan(plan)) return plan;
  return "free";
}

export function assertValidCategories(categories: unknown): AlertCategory[] {
  if (!Array.isArray(categories)) {
    throw new AlertValidationError("INVALID_CATEGORIES", "categories must be an array.");
  }

  const normalized: AlertCategory[] = [];
  for (const item of categories) {
    if (typeof item !== "string") {
      throw new AlertValidationError("INVALID_CATEGORY", "Each category must be a string.");
    }
    const category = item.trim();
    if (!isValidAlertCategory(category)) {
      throw new AlertValidationError("INVALID_CATEGORY", `${category || "Empty category"} is not a supported alert category.`);
    }
    if (!normalized.includes(category)) {
      normalized.push(category);
    }
  }

  return normalized;
}

export function assertDiscoveryCategoryLimit(plan: Plan, categories: AlertCategory[]) {
  const limit = getPlanLimits(plan).discoveryCategoryLimit;
  if (categories.length > limit) {
    throw new AlertValidationError("CATEGORY_LIMIT_EXCEEDED", buildCategoryLimitMessage(plan, limit), {
      limit,
      selected: categories.length,
    });
  }
}

export function buildCategoryLimitMessage(plan: Plan, limit: number) {
  const planName = getPlanDisplayName(plan);
  const upgradeTarget = getPlanUpgradeTarget(plan);
  const upgradeText = upgradeTarget ? ` Upgrade to ${getPlanDisplayName(upgradeTarget)} to unlock more coverage.` : "";
  return `${planName} includes ${formatLimit(limit)} active Discovery categories.${upgradeText}`;
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

export function getAllCategoryRowsForUser(userId: string, enabledCategories: AlertCategory[]) {
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
  const patch: Record<string, boolean | number> = {};

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
    if (typeof value !== "boolean") {
      throw new AlertValidationError("INVALID_PREFERENCE", `${field} must be a boolean.`);
    }
    patch[field] = value;
  }

  return patch;
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

function isValidPlan(value: string): value is Plan {
  return value === "free" || value === "ad_free" || value === "pro" || value === "advanced" || value === "ultimate";
}

export function getCategoryDisplayRows() {
  return ALERT_CATEGORIES;
}
