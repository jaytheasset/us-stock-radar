export type Plan = "free" | "ad_free" | "pro" | "advanced" | "ultimate";

export type PlanLimitValue = number | null;

export type AlertChannel = "web" | "telegram" | "email" | "webhook" | "api";

export type AlertCategory =
  | "listing_risk"
  | "dilution_risk"
  | "earnings"
  | "sales_performance"
  | "product_update"
  | "leadership_governance"
  | "insider_ownership"
  | "shareholder_vote"
  | "strategic_transaction"
  | "financial_risk"
  | "legal_risk"
  | "dividends"
  | "capital_return"
  | "fda_clinical"
  | "policy_regulation"
  | "macro_market"
  | "other";

export type PlanLimits = {
  watchlistLimit: PlanLimitValue;
  discoveryCategoryLimit: number;
  alertDelayMinutes: number;
  channels: readonly AlertChannel[];
  realTime: boolean;
  advancedFilters: boolean;
  customRules: boolean;
  webhookApi: boolean;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    watchlistLimit: 3,
    discoveryCategoryLimit: 1,
    alertDelayMinutes: 5,
    channels: ["web"],
    realTime: false,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  ad_free: {
    watchlistLimit: 5,
    discoveryCategoryLimit: 2,
    alertDelayMinutes: 5,
    channels: ["web"],
    realTime: false,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  pro: {
    watchlistLimit: 30,
    discoveryCategoryLimit: 6,
    alertDelayMinutes: 0,
    channels: ["web", "telegram"],
    realTime: true,
    advancedFilters: false,
    customRules: false,
    webhookApi: false,
  },
  advanced: {
    watchlistLimit: 150,
    discoveryCategoryLimit: 17,
    alertDelayMinutes: 0,
    channels: ["web", "telegram", "email"],
    realTime: true,
    advancedFilters: true,
    customRules: false,
    webhookApi: false,
  },
  ultimate: {
    watchlistLimit: null,
    discoveryCategoryLimit: 17,
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

export const ALERT_CATEGORIES: readonly {
  code: AlertCategory;
  label: string;
  description: string;
}[] = [
  {
    code: "listing_risk",
    label: "Listing Risk",
    description: "Delisting notices, compliance issues, exchange warnings.",
  },
  {
    code: "dilution_risk",
    label: "Dilution Risk",
    description: "Offerings, ATM programs, shelf registrations, warrants.",
  },
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
    code: "fda_clinical",
    label: "FDA / Clinical",
    description: "FDA approvals, rejections, CRLs, trial updates, and clinical milestones.",
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
  {
    code: "other",
    label: "Other",
    description: "Important events that do not fit a primary category.",
  },
] as const;

export type PlanKey = Plan;
export type AlertCategoryKey = AlertCategory;

const CATEGORY_BY_CODE = new Map(ALERT_CATEGORIES.map((category) => [category.code, category]));

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

export function getAllAlertCategoryValues(): AlertCategory[] {
  return ALERT_CATEGORIES.map((category) => category.code);
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
