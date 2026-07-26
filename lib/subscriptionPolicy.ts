export type Plan = "free" | "ad_free" | "pro" | "advanced" | "ultimate";

export type PlanLimitValue = number | null;

export type AlertChannel = "web" | "telegram" | "email" | "webhook" | "api";

export type CoreAlertCategory =
  | "earnings"
  | "sales_performance"
  | "product_update"
  | "leadership_governance"
  | "insider_ownership"
  | "shareholder_vote"
  | "strategic_transaction"
  | "dividends"
  | "capital_return"
  | "ipo_listing"
  | "policy_regulation"
  | "macro_market";

export type RiskCatalystAlertCategory =
  | "dilution_risk"
  | "listing_risk"
  | "financial_risk"
  | "legal_risk"
  | "fda_clinical";

export type PublicAlertCategory = CoreAlertCategory | RiskCatalystAlertCategory;
export type InternalAlertCategory = "other";
export type AlertCategory = PublicAlertCategory | InternalAlertCategory;

export type AlertCategoryDefinition<TCategory extends AlertCategory = AlertCategory> = {
  code: TCategory;
  label: string;
  description: string;
};

export type PlanLimits = {
  watchlistLimit: PlanLimitValue;
  alertTickerLimit: PlanLimitValue;
  discoveryCategories: readonly PublicAlertCategory[];
  alertDelayMinutes: number;
  channels: readonly AlertChannel[];
  realTime: boolean;
  advancedFilters: boolean;
  customRules: boolean;
  webhookApi: boolean;
};

export const CORE_ALERT_CATEGORIES: readonly AlertCategoryDefinition<CoreAlertCategory>[] = [
  {
    code: "earnings",
    label: "Earnings",
    description: "Earnings reports, guidance changes, and conference calls.",
  },
  {
    code: "sales_performance",
    label: "Sales Performance",
    description: "Revenue updates, bookings, demand signals, and operating momentum.",
  },
  {
    code: "product_update",
    label: "Product Updates",
    description: "Product launches, platform updates, roadmap changes, and rollout news.",
  },
  {
    code: "leadership_governance",
    label: "Leadership & Governance",
    description: "Executive changes, board updates, governance actions, and control matters.",
  },
  {
    code: "insider_ownership",
    label: "Insider Ownership",
    description: "Insider buying, selling, ownership changes, and beneficial holder filings.",
  },
  {
    code: "shareholder_vote",
    label: "Shareholder Vote",
    description: "Proxy votes, annual meetings, special meetings, and shareholder approvals.",
  },
  {
    code: "strategic_transaction",
    label: "Strategic Transactions",
    description: "M&A, mergers, asset sales, strategic investments, and major deal activity.",
  },
  {
    code: "dividends",
    label: "Dividends",
    description: "Dividend declarations, changes, record dates, and payment dates.",
  },
  {
    code: "capital_return",
    label: "Capital Return",
    description: "Buybacks, repurchase authorizations, and broader capital return programs.",
  },
  {
    code: "ipo_listing",
    label: "IPO / Listing",
    description: "Traditional IPOs, SPAC IPOs, direct listings, IPO pricing, and first-trading updates.",
  },
  {
    code: "policy_regulation",
    label: "Policy & Regulation",
    description: "Policy decisions, agency actions, regulation changes, and official rulings.",
  },
  {
    code: "macro_market",
    label: "Macro Market",
    description: "Rates, inflation, jobs, sanctions, geopolitics, and market-wide catalysts.",
  },
] as const;

export const RISK_CATALYST_ALERT_CATEGORIES: readonly AlertCategoryDefinition<RiskCatalystAlertCategory>[] = [
  {
    code: "dilution_risk",
    label: "Dilution Risk",
    description: "Offerings, ATM programs, shelf registrations, warrants.",
  },
  {
    code: "listing_risk",
    label: "Listing Risk",
    description: "Delisting notices, compliance issues, exchange warnings.",
  },
  {
    code: "financial_risk",
    label: "Financial Risk",
    description: "Liquidity issues, going-concern language, restatements, and accounting risk.",
  },
  {
    code: "legal_risk",
    label: "Legal Risk",
    description: "Lawsuits, investigations, settlements, enforcement actions, and legal exposure.",
  },
  {
    code: "fda_clinical",
    label: "FDA / Clinical",
    description: "FDA approvals, rejections, CRLs, trial updates, and clinical milestones.",
  },
] as const;

export const PUBLIC_ALERT_CATEGORIES: readonly AlertCategoryDefinition<PublicAlertCategory>[] = [
  ...CORE_ALERT_CATEGORIES,
  ...RISK_CATALYST_ALERT_CATEGORIES,
] as const;

export const INTERNAL_ALERT_CATEGORIES: readonly AlertCategoryDefinition<InternalAlertCategory>[] = [
  {
    code: "other",
    label: "Other",
    description: "Internal parser fallback for events that do not fit a public alert category.",
  },
] as const;

/**
 * User-facing alert categories. Internal parser fallbacks intentionally do not
 * belong in Premium, Alerts settings, category counts, or entitlement checks.
 */
export const ALERT_CATEGORIES = PUBLIC_ALERT_CATEGORIES;

const CORE_CATEGORY_VALUES = CORE_ALERT_CATEGORIES.map((category) => category.code);
const PUBLIC_CATEGORY_VALUES = PUBLIC_ALERT_CATEGORIES.map((category) => category.code);

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    watchlistLimit: null,
    alertTickerLimit: 1,
    discoveryCategories: CORE_CATEGORY_VALUES,
    alertDelayMinutes: 5,
    channels: ["web"],
    realTime: false,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  ad_free: {
    watchlistLimit: null,
    alertTickerLimit: 5,
    discoveryCategories: CORE_CATEGORY_VALUES,
    alertDelayMinutes: 5,
    channels: ["web"],
    realTime: false,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  pro: {
    watchlistLimit: null,
    alertTickerLimit: 15,
    discoveryCategories: CORE_CATEGORY_VALUES,
    alertDelayMinutes: 0,
    channels: ["web", "telegram"],
    realTime: true,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  advanced: {
    watchlistLimit: null,
    alertTickerLimit: null,
    discoveryCategories: PUBLIC_CATEGORY_VALUES,
    alertDelayMinutes: 0,
    channels: ["web", "telegram", "email"],
    realTime: true,
    advancedFilters: true,
    customRules: false,
    webhookApi: false,
  },
  ultimate: {
    watchlistLimit: null,
    alertTickerLimit: null,
    discoveryCategories: PUBLIC_CATEGORY_VALUES,
    alertDelayMinutes: 0,
    channels: ["web", "telegram", "email", "webhook", "api"],
    realTime: true,
    advancedFilters: true,
    customRules: true,
    webhookApi: true,
  },
} as const;

export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  free: "Free",
  ad_free: "Ad-Free",
  pro: "Pro",
  advanced: "Advanced",
  ultimate: "Ultimate",
} as const;

export const ADVANCED_TRIAL_POLICY = {
  plan: "advanced",
  durationDays: 14,
  paymentMethodRequired: true,
  autoConvertsToPaid: true,
  oncePerAccount: true,
  cancellationKeepsAccessUntilEnd: true,
  failedPaymentFallbackPlan: "free",
  preservesUserDataOnFallback: true,
  reminderDaysBeforeCharge: [3, 1],
} as const;

export const LEGACY_TRIAL_PLAN = "pro" as const;

export type PlanKey = Plan;
export type AlertCategoryKey = AlertCategory;

const CATEGORY_BY_CODE = new Map(
  [...PUBLIC_ALERT_CATEGORIES, ...INTERNAL_ALERT_CATEGORIES].map((category) => [category.code, category]),
);
const PUBLIC_CATEGORY_CODES = new Set(PUBLIC_CATEGORY_VALUES);

const CHANNEL_LABELS: Record<AlertChannel, string> = {
  web: "Web",
  telegram: "Telegram",
  email: "Email",
  webhook: "Webhook",
  api: "API",
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function getPlanDisplayName(plan: Plan): string {
  return PLAN_DISPLAY_NAMES[plan];
}

export function getCategoryLabel(category: AlertCategory): string {
  return CATEGORY_BY_CODE.get(category)?.label ?? category;
}

export function getCategoryDescription(category: AlertCategory): string {
  return CATEGORY_BY_CODE.get(category)?.description ?? "";
}

export function isValidAlertCategory(category: string): category is AlertCategory {
  return CATEGORY_BY_CODE.has(category as AlertCategory);
}

export function isValidPublicAlertCategory(category: string): category is PublicAlertCategory {
  return PUBLIC_CATEGORY_CODES.has(category as PublicAlertCategory);
}

export function getAllAlertCategoryValues(): PublicAlertCategory[] {
  return [...PUBLIC_CATEGORY_VALUES];
}

export function getAllPublicAlertCategoryValues(): PublicAlertCategory[] {
  return getAllAlertCategoryValues();
}

export function getDiscoveryCategoriesForPlan(plan: Plan): PublicAlertCategory[] {
  return [...PLAN_LIMITS[plan].discoveryCategories];
}

export function isDiscoveryCategoryAllowed(plan: Plan, category: string): category is PublicAlertCategory {
  return (
    isValidPublicAlertCategory(category) &&
    PLAN_LIMITS[plan].discoveryCategories.includes(category)
  );
}

export function getAvailablePlanChannels(plan: Plan): AlertChannel[] {
  return [...PLAN_LIMITS[plan].channels];
}

export function getPlanUpgradeTarget(plan: Plan): Plan | null {
  if (plan === "free" || plan === "ad_free") return "pro";
  if (plan === "pro") return "advanced";
  if (plan === "advanced") return "ultimate";
  return null;
}

export function isUnlimited(value: PlanLimitValue): value is null {
  return value === null;
}

export function formatLimit(value: PlanLimitValue): string {
  return isUnlimited(value) ? "Unlimited" : String(value);
}

export function formatAlertSpeed(plan: Plan): string {
  const limits = getPlanLimits(plan);
  if (plan === "ultimate") return "Fastest alerts";
  if (plan === "advanced") return "Priority real-time";
  return limits.realTime ? "Real-time" : `${limits.alertDelayMinutes}-minute delay`;
}

export function formatChannels(channels: readonly AlertChannel[]): string {
  return channels.map((channel) => CHANNEL_LABELS[channel]).join(" + ");
}
