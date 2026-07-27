import {
  ADVANCED_TRIAL_POLICY,
  CORE_ALERT_CATEGORIES,
  RISK_CATALYST_ALERT_CATEGORIES,
  formatChannels,
  formatLimit,
  getPlanLimits,
  type AlertCategory,
  type Plan,
} from "@/lib/subscriptionPolicy";

export type PremiumV2PlanKey = "free" | "adFree" | "pro" | "advanced" | "ultimate";

export type PremiumV2CategoryTone = "earnings" | "insider" | "legal" | "product" | "transaction";

export type PremiumV2Plan = {
  badge?: string;
  benefits: readonly string[];
  cta: string;
  description: string;
  monthlyPrice: string;
  name: string;
};

export type PremiumV2ComparisonRow = {
  feature: string;
  values: Record<PremiumV2PlanKey, string>;
};

export type PremiumV2MarketCoverageGroup = {
  badge: string;
  description: string;
  items: readonly {
    label: string;
    tone: PremiumV2CategoryTone;
  }[];
  planKey: Extract<PremiumV2PlanKey, "pro" | "advanced">;
  title: string;
};

export const premiumV2PlanOrder = ["free", "adFree", "pro", "advanced", "ultimate"] as const satisfies readonly PremiumV2PlanKey[];

const CANONICAL_PLAN_BY_KEY: Record<PremiumV2PlanKey, Plan> = {
  free: "free",
  adFree: "ad_free",
  pro: "pro",
  advanced: "advanced",
  ultimate: "ultimate",
};

function tickerLimit(planKey: PremiumV2PlanKey) {
  return formatLimit(getPlanLimits(CANONICAL_PLAN_BY_KEY[planKey]).alertTickerLimit);
}

function channels(planKey: PremiumV2PlanKey) {
  return formatChannels(getPlanLimits(CANONICAL_PLAN_BY_KEY[planKey]).channels);
}

function discoveryCount(planKey: PremiumV2PlanKey) {
  return getPlanLimits(CANONICAL_PLAN_BY_KEY[planKey]).discoveryCategories.length;
}

export const premiumV2Plans: Record<PremiumV2PlanKey, PremiumV2Plan> = {
  free: {
    benefits: [
      `Ticker Alerts for ${tickerLimit("free")} ticker`,
      "All 17 event types for that alert ticker",
      "5-minute delivery delay",
      channels("free"),
      "Unlimited watchlist · Ads included",
    ],
    cta: "Start Free",
    description: "Follow one company with complete event coverage.",
    monthlyPrice: "$0",
    name: "Free",
  },
  adFree: {
    benefits: [
      `Ticker Alerts for ${tickerLimit("adFree")} tickers`,
      "All 17 event types for enabled tickers",
      "5-minute delivery delay",
      channels("adFree"),
      "Unlimited watchlist · No ads",
    ],
    cta: "Choose Ad-Free",
    description: "Cleaner alerts for a focused ticker list.",
    monthlyPrice: "$6.99",
    name: "Ad-Free",
  },
  pro: {
    benefits: [
      `Ticker Alerts for ${tickerLimit("pro")} tickers`,
      "All 17 event types for enabled tickers",
      `${discoveryCount("pro")} Core categories for market-wide Discovery`,
      "Real-time alerts",
      channels("pro"),
    ],
    cta: "Upgrade to Pro",
    description: "Real-time company alerts with Telegram delivery.",
    monthlyPrice: "$19",
    name: "Pro",
  },
  advanced: {
    badge: "Full Market Scanner",
    benefits: [
      "Unlimited Ticker Alerts",
      "All 17 event types for enabled tickers",
      `${discoveryCount("advanced")} categories across market-wide Discovery`,
      "Advanced filters",
      channels("advanced"),
    ],
    cta: "Start 14-day Advanced Trial",
    description: "Full-market risk and catalyst detection for active traders.",
    monthlyPrice: "$49",
    name: "Advanced",
  },
  ultimate: {
    benefits: [
      "Unlimited Ticker Alerts",
      "All 17 market-wide Discovery categories",
      "Custom rules",
      channels("ultimate"),
      "Professional configuration",
    ],
    cta: "Contact Sales",
    description: "Build professional custom scanning and delivery workflows.",
    monthlyPrice: "From $199",
    name: "Ultimate",
  },
};

export const premiumV2CurrentPlan: PremiumV2PlanKey = "free";
export const premiumV2RecommendedPlan: PremiumV2PlanKey = "advanced";

export const premiumV2SampleAlerts = [
  {
    signal: "Bearish 94",
    signalTone: "negative",
    title: "MULN files $150M mixed-shelf offering",
    tone: "critical",
    type: "Dilution Risk",
  },
  {
    signal: "Bearish 88",
    signalTone: "negative",
    title: "WE receives Nasdaq delisting notice",
    tone: "warning",
    type: "Listing Risk",
  },
  {
    signal: "Bullish 82",
    signalTone: "positive",
    title: "MRNA reports FDA fast-track designation",
    tone: "earnings",
    type: "FDA Catalyst",
  },
] as const;

function toneForCategory(category: AlertCategory): PremiumV2CategoryTone {
  if (category === "earnings" || category === "sales_performance" || category === "dividends" || category === "capital_return") {
    return "earnings";
  }
  if (
    category === "leadership_governance" ||
    category === "insider_ownership" ||
    category === "shareholder_vote"
  ) {
    return "insider";
  }
  if (
    category === "dilution_risk" ||
    category === "listing_risk" ||
    category === "financial_risk" ||
    category === "legal_risk"
  ) {
    return "legal";
  }
  if (category === "product_update" || category === "fda_clinical") return "product";
  return "transaction";
}

const coreCoverageItems = CORE_ALERT_CATEGORIES.map((category) => ({
  label: category.label,
  tone: toneForCategory(category.code),
}));
const riskCoverageItems = RISK_CATALYST_ALERT_CATEGORIES.map((category) => ({
  label: category.label,
  tone: toneForCategory(category.code),
}));

export const premiumV2MarketCoverageGroups: readonly PremiumV2MarketCoverageGroup[] = [
  {
    badge: "Free–Pro",
    description: "Twelve Core event types available for market-wide Discovery.",
    items: coreCoverageItems,
    planKey: "pro",
    title: "Core Market Events",
  },
  {
    badge: "Advanced+",
    description: "All five Risk & Catalyst types added to market-wide Discovery.",
    items: riskCoverageItems,
    planKey: "advanced",
    title: "Risk & Catalyst Events",
  },
];

export const premiumV2ComparisonRows: readonly PremiumV2ComparisonRow[] = [
  {
    feature: "Ticker Alerts",
    values: {
      free: tickerLimit("free"),
      adFree: tickerLimit("adFree"),
      pro: tickerLimit("pro"),
      advanced: tickerLimit("advanced"),
      ultimate: tickerLimit("ultimate"),
    },
  },
  {
    feature: "Enabled Ticker Coverage",
    values: {
      free: "All 17 types",
      adFree: "All 17 types",
      pro: "All 17 types",
      advanced: "All 17 types",
      ultimate: "All 17 types + rules",
    },
  },
  {
    feature: "Market-Wide Discovery",
    values: {
      free: "12 Core types",
      adFree: "12 Core types",
      pro: "12 Core types",
      advanced: "All 17 types",
      ultimate: "All 17 types + rules",
    },
  },
  {
    feature: "Watchlist",
    values: { free: "Unlimited", adFree: "Unlimited", pro: "Unlimited", advanced: "Unlimited", ultimate: "Unlimited" },
  },
  {
    feature: "Filter Controls",
    values: { free: "Basic", adFree: "Basic", pro: "Standard", advanced: "Advanced", ultimate: "Custom" },
  },
  {
    feature: "Delivery Delay",
    values: { free: "5 min", adFree: "5 min", pro: "Real-time", advanced: "Real-time", ultimate: "Real-time" },
  },
  {
    feature: "Delivery Channels",
    values: {
      free: channels("free"),
      adFree: channels("adFree"),
      pro: channels("pro"),
      advanced: channels("advanced"),
      ultimate: channels("ultimate"),
    },
  },
  {
    feature: "Custom Rules",
    values: { free: "No", adFree: "No", pro: "No", advanced: "No", ultimate: "Included" },
  },
];

export const premiumV2FaqItems = [
  {
    answer:
      "Ticker Alerts cover companies you choose and include all 17 public event types on every plan. Market-wide Discovery scans companies outside that list: Free through Pro include the 12 Core types, while Advanced and Ultimate include all 17.",
    question: "What is the difference between Ticker Alerts and Market-Wide Discovery?",
  },
  {
    answer:
      "No. Watchlist storage is unlimited for every logged-in plan. Your plan only limits how many tickers can have alerts enabled at once.",
    question: "Is my watchlist limited?",
  },
  {
    answer:
      "Pro includes 15 real-time alert tickers, the 12 Core Discovery types, and Telegram. Advanced adds unlimited alert tickers, all 17 Discovery types, advanced filters, and email.",
    question: "Why choose Advanced instead of Pro?",
  },
  {
    answer: "Yes. Every enabled ticker receives all 12 Core and all 5 Risk & Catalyst event types.",
    question: "Do enabled tickers receive Risk & Catalyst Alerts?",
  },
  {
    answer:
      "The Advanced trial lasts 14 days, requires a card, and converts to monthly Advanced unless cancelled. Cancellation keeps access through the trial end. Checkout is not connected in this preview.",
    question: "How does the Advanced trial work?",
  },
  {
    answer:
      "No artificial delay means Stock Radar does not intentionally hold the alert after it is generated. Source publication, ingestion, analysis, network, and third-party delivery may still add latency.",
    question: "What does real-time delivery mean?",
  },
  {
    answer: ADVANCED_TRIAL_POLICY.paymentMethodRequired
      ? "No. Plan buttons remain a preview until card-backed checkout is connected."
      : "No. Selecting a plan only updates the local preview.",
    question: "Does the upgrade button start payment?",
  },
] as const;
