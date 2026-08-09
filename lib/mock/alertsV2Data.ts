import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  FlaskConical,
  Landmark,
  LineChart,
  Lock,
  Mail,
  Megaphone,
  Merge,
  MonitorSmartphone,
  Search,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  ALERT_CATEGORIES,
  getPlanLimits,
  type AlertCategory,
  type Plan,
} from "@/lib/subscriptionPolicy";
import { marketCapRangeLabels } from "@/lib/marketCapBands";

export type AlertTicker = {
  company: string;
  enabled: boolean;
  id: string;
  ticker: string;
};

export type AlertsMockPlanId = "free" | "ad-free" | "pro" | "advanced" | "ultimate";

export type AlertsMockPlan = {
  hasCoverageControls: boolean;
  hasEmailDelivery: boolean;
  hasFilingTypeAlerts: boolean;
  hasMarketCapFilters: boolean;
  hasRiskAlerts: boolean;
  hasSourceFilters: boolean;
  id: AlertsMockPlanId;
  label: string;
  showsAds: boolean;
  tickerLimit: number | null;
};

export type CoverageItem = {
  description: string;
  enabled: boolean;
  icon: LucideIcon;
  id: string;
  locked?: boolean;
  title: string;
};

export type DeliveryItem = {
  enabled: boolean;
  icon: LucideIcon;
  id: string;
  lockedTier?: "ADVANCED" | "ULTIMATE";
  title: string;
};

export type AlertSource = {
  id: string;
  label: string;
};

export type FilingAlertType = {
  id: string;
  label: string;
};

export type FilingAlertGroup = {
  id: string;
  items: readonly FilingAlertType[];
  title: string;
};

export type MarketCapFilter = {
  id: string;
  label: string;
  range: string;
};

export type WatchlistCandidate = {
  company: string;
  id: string;
  ticker: string;
};

export const alertIconSet = {
  Bell,
  CheckCircle2,
  Lock,
  Search,
  Trash2,
} as const;

const CANONICAL_PLAN_BY_MOCK_ID: Record<AlertsMockPlanId, Plan> = {
  free: "free",
  "ad-free": "ad_free",
  pro: "pro",
  advanced: "advanced",
  ultimate: "ultimate",
};

function alertTickerLimit(plan: AlertsMockPlanId) {
  return getPlanLimits(CANONICAL_PLAN_BY_MOCK_ID[plan]).alertTickerLimit;
}

export const alertsMockPlans: Record<AlertsMockPlanId, AlertsMockPlan> = {
  free: {
    id: "free",
    label: "Free",
    tickerLimit: alertTickerLimit("free"),
    showsAds: true,
    hasCoverageControls: true,
    hasSourceFilters: false,
    hasMarketCapFilters: false,
    hasRiskAlerts: false,
    hasEmailDelivery: false,
    hasFilingTypeAlerts: false,
  },
  "ad-free": {
    id: "ad-free",
    label: "Ad-Free",
    tickerLimit: alertTickerLimit("ad-free"),
    showsAds: false,
    hasCoverageControls: true,
    hasSourceFilters: false,
    hasMarketCapFilters: false,
    hasRiskAlerts: false,
    hasEmailDelivery: false,
    hasFilingTypeAlerts: false,
  },
  pro: {
    id: "pro",
    label: "Pro",
    tickerLimit: alertTickerLimit("pro"),
    showsAds: false,
    hasCoverageControls: true,
    hasSourceFilters: true,
    hasMarketCapFilters: true,
    hasRiskAlerts: false,
    hasEmailDelivery: false,
    hasFilingTypeAlerts: false,
  },
  advanced: {
    id: "advanced",
    label: "Advanced",
    tickerLimit: alertTickerLimit("advanced"),
    showsAds: false,
    hasCoverageControls: true,
    hasSourceFilters: true,
    hasMarketCapFilters: true,
    hasRiskAlerts: true,
    hasEmailDelivery: true,
    hasFilingTypeAlerts: false,
  },
  ultimate: {
    id: "ultimate",
    label: "Ultimate",
    tickerLimit: alertTickerLimit("ultimate"),
    showsAds: false,
    hasCoverageControls: true,
    hasSourceFilters: true,
    hasMarketCapFilters: true,
    hasRiskAlerts: true,
    hasEmailDelivery: true,
    hasFilingTypeAlerts: true,
  },
};

export function getAlertsMockPlan(plan: string | null): AlertsMockPlan {
  if (plan && plan in alertsMockPlans) {
    return alertsMockPlans[plan as AlertsMockPlanId];
  }

  return alertsMockPlans.pro;
}

export const initialAlertTickers: readonly AlertTicker[] = [
  { id: "aapl", ticker: "AAPL", company: "Apple Inc.", enabled: true },
  { id: "nvda", ticker: "NVDA", company: "NVIDIA Corp.", enabled: true },
  { id: "rxrx", ticker: "RXRX", company: "Recursion Pharmaceuticals", enabled: true },
];

export const watchlistCandidates: readonly WatchlistCandidate[] = [
  { id: "msft", ticker: "MSFT", company: "Microsoft Corp." },
  { id: "tsla", ticker: "TSLA", company: "Tesla Inc." },
  { id: "amd", ticker: "AMD", company: "Advanced Micro Devices" },
];

const RISK_CATALYST_CATEGORY_CODES = new Set<AlertCategory>([
  "dilution_risk",
  "listing_risk",
  "financial_risk",
  "legal_risk",
  "fda_clinical",
]);

const COVERAGE_ICON_BY_CATEGORY: Partial<Record<AlertCategory, LucideIcon>> = {
  earnings: LineChart,
  sales_performance: LineChart,
  product_update: Megaphone,
  leadership_governance: Landmark,
  insider_ownership: Building2,
  shareholder_vote: Building2,
  strategic_transaction: Merge,
  dividends: LineChart,
  capital_return: LineChart,
  ipo_listing: Building2,
  policy_regulation: Landmark,
  macro_market: Landmark,
  dilution_risk: AlertTriangle,
  listing_risk: AlertTriangle,
  financial_risk: AlertTriangle,
  legal_risk: AlertTriangle,
  fda_clinical: FlaskConical,
};

export const coverageItems: readonly CoverageItem[] = ALERT_CATEGORIES.map((category) => {
  const locked = RISK_CATALYST_CATEGORY_CODES.has(category.code);
  return {
    id: category.code,
    title: category.label,
    description: category.description,
    icon: COVERAGE_ICON_BY_CATEGORY[category.code] ?? Bell,
    enabled: !locked,
    ...(locked ? { locked: true } : {}),
  };
});

export const deliveryItems: readonly DeliveryItem[] = [
  { id: "web", title: "Web", icon: MonitorSmartphone, enabled: true },
  { id: "telegram", title: "Telegram", icon: Send, enabled: false },
  { id: "email", title: "Email", icon: Mail, enabled: false, lockedTier: "ADVANCED" },
  { id: "webhook", title: "Webhook", icon: Smartphone, enabled: false, lockedTier: "ULTIMATE" },
  { id: "api", title: "API", icon: Bell, enabled: false, lockedTier: "ULTIMATE" },
];

export const alertSources: readonly AlertSource[] = [
  { id: "news", label: "News" },
  { id: "filings", label: "SEC filings" },
];

export const marketCapFilters: readonly MarketCapFilter[] = [
  { id: "mega", label: "Mega", range: marketCapRangeLabels.Mega },
  { id: "large", label: "Large", range: marketCapRangeLabels.Large },
  { id: "mid", label: "Mid", range: marketCapRangeLabels.Mid },
  { id: "small", label: "Small", range: marketCapRangeLabels.Small },
  { id: "micro", label: "Micro", range: marketCapRangeLabels.Micro },
];

export const filingAlertGroups: readonly FilingAlertGroup[] = [
  {
    id: "current-periodic",
    title: "Current & periodic reports",
    items: [
      { id: "8-k", label: "8-K" },
      { id: "10-q", label: "10-Q" },
      { id: "10-k", label: "10-K" },
      { id: "6-k", label: "6-K" },
      { id: "20-f", label: "20-F" },
    ],
  },
  {
    id: "registration-offering",
    title: "Registration & offerings",
    items: [
      { id: "s-1", label: "S-1" },
      { id: "s-3", label: "S-3" },
      { id: "s-4", label: "S-4" },
      { id: "s-8", label: "S-8" },
      { id: "f-1", label: "F-1" },
      { id: "f-3", label: "F-3" },
      { id: "f-4", label: "F-4" },
      { id: "424b", label: "424B" },
      { id: "424b3", label: "424B3" },
      { id: "424b4", label: "424B4" },
      { id: "424b5", label: "424B5" },
    ],
  },
  {
    id: "proxy-vote",
    title: "Proxy & shareholder vote",
    items: [
      { id: "def-14a", label: "DEF 14A" },
      { id: "pre-14a", label: "PRE 14A" },
      { id: "defa14a", label: "DEFA14A" },
    ],
  },
  {
    id: "ownership-insider",
    title: "Ownership & insider",
    items: [
      { id: "sc-13d", label: "SC 13D" },
      { id: "sc-13g", label: "SC 13G" },
      { id: "form-4", label: "Form 4" },
      { id: "144", label: "144" },
    ],
  },
  {
    id: "tender-listing-admin",
    title: "Tender, listing & SEC admin",
    items: [
      { id: "sc-to-i", label: "SC TO-I" },
      { id: "sc-to-t", label: "SC TO-T" },
      { id: "sc-14d9", label: "SC 14D9" },
      { id: "25-nse", label: "25-NSE" },
      { id: "pos-am", label: "POS AM" },
      { id: "effect", label: "EFFECT" },
    ],
  },
  {
    id: "amendments-late",
    title: "Amendments & late notices",
    items: [
      { id: "8-k-a", label: "8-K/A" },
      { id: "10-q-a", label: "10-Q/A" },
      { id: "10-k-a", label: "10-K/A" },
      { id: "nt-10-k", label: "NT 10-K" },
      { id: "nt-10-q", label: "NT 10-Q" },
    ],
  },
];
