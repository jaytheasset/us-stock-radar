export type PremiumV2PlanKey =
  | "free"
  | "adFree"
  | "pro"
  | "advanced"
  | "ultimate";

export type PremiumV2BillingCycle = "annual" | "monthly";
export type PremiumV2CategoryTone =
  | "governance"
  | "neutral"
  | "performance"
  | "policy"
  | "risk"
  | "transaction";

export type PremiumV2Plan = {
  annualPrice: string | null;
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

export const premiumV2PlanOrder = [
  "free",
  "adFree",
  "pro",
  "advanced",
  "ultimate",
] as const satisfies readonly PremiumV2PlanKey[];

// Product names, monthly prices and limits mirror the existing /premium route
// and lib/subscriptionPolicy.ts. Annual pricing remains intentionally unset.
export const premiumV2Plans: Record<PremiumV2PlanKey, PremiumV2Plan> = {
  free: {
    annualPrice: "$0",
    benefits: [
      "3 watchlist tickers",
      "1 of 17 Market Discovery categories",
      "5-minute delay",
      "Web alerts",
      "Ads included",
    ],
    cta: "Start Free",
    description: "Start tracking the market.",
    monthlyPrice: "$0",
    name: "Free",
  },
  adFree: {
    annualPrice: null,
    benefits: [
      "5 watchlist tickers",
      "2 of 17 Market Discovery categories",
      "5-minute delay",
      "Web alerts",
      "Ads removed",
    ],
    cta: "Choose Ad-Free",
    description: "Cleaner experience for casual users.",
    monthlyPrice: "$4.99",
    name: "Ad-Free",
  },
  pro: {
    annualPrice: null,
    benefits: [
      "30 watchlist tickers",
      "6 of 17 Market Discovery categories",
      "Real-time alerts",
      "Web + Telegram alerts",
      "Standard filters",
    ],
    cta: "Upgrade to Pro",
    description: "Real-time alerts for your watchlist and selected market categories.",
    monthlyPrice: "$19",
    name: "Pro",
  },
  advanced: {
    annualPrice: null,
    benefits: [
      "150 watchlist tickers",
      "All 17 Market Discovery categories",
      "Priority real-time alerts",
      "Web + Telegram + Email alerts",
      "Advanced filters",
    ],
    cta: "Go Advanced",
    description: "All 17 categories with advanced filters.",
    monthlyPrice: "$49",
    name: "Advanced",
  },
  ultimate: {
    annualPrice: null,
    benefits: [
      "Unlimited watchlist",
      "17 categories + custom rules",
      "Fastest alerts",
      "Web + Telegram + Email + API alerts",
      "Custom Rules",
    ],
    cta: "Start Ultimate",
    description: "Full scanner access for professionals.",
    monthlyPrice: "$199+",
    name: "Ultimate",
  },
};

export const premiumV2CurrentPlan: PremiumV2PlanKey = "free";
export const premiumV2RecommendedPlan: PremiumV2PlanKey = "pro";

export const premiumV2LiveAlerts = [
  {
    age: "2m ago",
    severity: "Critical",
    source: "8-K filing",
    title: "XYZ Corp files $75M offering",
    tone: "critical",
    type: "Dilution Risk",
  },
  {
    age: "5m ago",
    severity: "High",
    source: "Press Release",
    title: "ABC receives FDA approval",
    tone: "positive",
    type: "FDA / Clinical",
  },
  {
    age: "6m ago",
    severity: "High",
    source: "8-K filing",
    title: "DEF receives Nasdaq deficiency notice",
    tone: "warning",
    type: "Listing Risk",
  },
  {
    age: "10m ago",
    severity: "Medium",
    source: "Press Release",
    title: "GHI reports Q1 earnings beat",
    tone: "earnings",
    type: "Earnings",
  },
] as const;

export const premiumV2Benefits = [
  {
    description: "Pro and higher plans remove the 5-minute delay for watchlist news and filing alerts.",
    title: "Real-time watchlist alerts",
  },
  {
    description: "Track selected event categories outside your watchlist without turning every source into noise.",
    title: "Market Discovery scanner",
  },
  {
    description: "Use plan-level filters for event type, signal, market cap, source, and category delivery.",
    title: "Advanced alert filters",
  },
  {
    description: "Higher tiers add delivery channels for traders who need alerts outside the website.",
    title: "Telegram, email, and API lanes",
  },
] as const;

export const premiumV2AlertModel = [
  {
    body: "Track matching news and filing events for saved tickers, within your plan limit.",
    detail: "Pro and higher plans remove the 5-minute delay.",
    title: "Watchlist alerts",
  },
  {
    body: "Monitor selected event categories outside your watchlist.",
    detail: "Your plan controls how many categories and filters can be active.",
    title: "Market Discovery alerts",
  },
  {
    body: "A broad public stream remains separate from personalized delivery.",
    detail: "Direct plan alerts are not the public Telegram channel.",
    title: "Public Telegram channel",
  },
] as const;

export const premiumV2CategoryLegend = [
  { count: "1", label: "Free" },
  { count: "2", label: "Ad-Free" },
  { count: "6", label: "Pro" },
  { count: "17", label: "Advanced" },
  { count: "17 + Custom", label: "Ultimate" },
] as const;

export const premiumV2Categories: readonly {
  label: string;
  tone: PremiumV2CategoryTone;
}[] = [
  { label: "Listing Risk", tone: "risk" },
  { label: "Dilution Risk", tone: "risk" },
  { label: "Earnings", tone: "performance" },
  { label: "Sales Performance", tone: "performance" },
  { label: "Product Updates", tone: "performance" },
  { label: "Leadership & Governance", tone: "governance" },
  { label: "Insider Ownership", tone: "governance" },
  { label: "Shareholder Vote", tone: "governance" },
  { label: "Strategic Transactions", tone: "transaction" },
  { label: "Financial Risk", tone: "risk" },
  { label: "Legal Risk", tone: "risk" },
  { label: "Dividends", tone: "performance" },
  { label: "Capital Return", tone: "performance" },
  { label: "FDA / Clinical", tone: "policy" },
  { label: "Policy & Regulation", tone: "policy" },
  { label: "Macro Market", tone: "policy" },
  { label: "Other", tone: "neutral" },
];

export const premiumV2ComparisonRows: readonly PremiumV2ComparisonRow[] = [
  {
    feature: "Watchlist tickers",
    values: { free: "3", adFree: "5", pro: "30", advanced: "150", ultimate: "Unlimited" },
  },
  {
    feature: "Market Discovery categories",
    values: { free: "1", adFree: "2", pro: "6", advanced: "17", ultimate: "17 + Custom" },
  },
  {
    feature: "Alert delay",
    values: { free: "5 min", adFree: "5 min", pro: "No delay", advanced: "No delay", ultimate: "No delay" },
  },
  {
    feature: "Watchlist news alerts",
    values: { free: "Delayed", adFree: "Delayed", pro: "Real-time", advanced: "Real-time", ultimate: "Real-time" },
  },
  {
    feature: "Watchlist filing alerts",
    values: { free: "Delayed", adFree: "Delayed", pro: "Real-time", advanced: "Real-time", ultimate: "Real-time" },
  },
  {
    feature: "Discovery news + filings",
    values: {
      free: "1 category, delayed",
      adFree: "2 categories, delayed",
      pro: "6 categories, real-time",
      advanced: "All categories",
      ultimate: "Full scanner",
    },
  },
  {
    feature: "Telegram",
    values: { free: "—", adFree: "—", pro: "Yes", advanced: "Yes", ultimate: "Yes" },
  },
  {
    feature: "Email",
    values: { free: "—", adFree: "—", pro: "—", advanced: "Yes", ultimate: "Yes" },
  },
  {
    feature: "Webhook / API",
    values: { free: "—", adFree: "—", pro: "—", advanced: "—", ultimate: "Yes" },
  },
  {
    feature: "Custom Rules",
    values: { free: "—", adFree: "—", pro: "—", advanced: "—", ultimate: "Yes" },
  },
];

// These answers describe the mock and confirmed product limits only. They do
// not define cancellation, refund, payment-method or checkout policy.
export const premiumV2FaqItems = [
  {
    answer: "This mock does not start an account change. It only records the selected plan in local page state.",
    question: "What happens if I choose a plan here?",
  },
  {
    answer: "The current product source assigns real-time alerts to Pro, Advanced and Ultimate. This mock does not change an account or delivery service.",
    question: "Which plans include real-time alerts?",
  },
  {
    answer: "A category is an event type monitored outside your watchlist. The current source defines 17 categories and plan-specific active-category limits.",
    question: "What counts as a Market Discovery category?",
  },
  {
    answer: "Yes. Watchlist alerts cover saved tickers; Market Discovery monitors selected event categories outside the watchlist.",
    question: "Are watchlist and Discovery alerts separate?",
  },
  {
    answer: "No. The current product source keeps a 5-minute delay on Ad-Free; real-time begins with Pro.",
    question: "Does Ad-Free include real-time alerts?",
  },
  {
    answer: "Ultimate is presented for professional scanning and automation workflows, with all 17 categories, custom rules and API/Webhook access.",
    question: "What is Ultimate for?",
  },
  {
    answer: "No annual price or discount is confirmed in the current source, so Annual is shown only as an unpriced mock selection.",
    question: "Is Annual pricing confirmed?",
  },
  {
    answer: "No. Every CTA on this page is a local interaction preview. Checkout, billing providers and payment methods are not connected.",
    question: "Does the upgrade button start payment?",
  },
] as const;
