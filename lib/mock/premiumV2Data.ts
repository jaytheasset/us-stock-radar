export type PremiumV2PlanKey =
  | "free"
  | "adFree"
  | "pro"
  | "advanced"
  | "ultimate";

export type PremiumV2BillingCycle = "monthly";
export type PremiumV2CategoryTone =
  | "governance"
  | "performance"
  | "policy"
  | "risk"
  | "transaction";

export type PremiumV2Plan = {
  badge?: string;
  benefits: readonly string[];
  cta: string;
  description: string;
  monthlyPrice: string;
  name: string;
};

export type PremiumV2ComparisonRow = {
  details?: Partial<Record<PremiumV2PlanKey, readonly {
    label: string;
    tone: PremiumV2CategoryTone;
  }[]>>;
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

export const premiumV2PlanOrder = [
  "free",
  "adFree",
  "pro",
  "advanced",
  "ultimate",
] as const satisfies readonly PremiumV2PlanKey[];

export const premiumV2Plans: Record<PremiumV2PlanKey, PremiumV2Plan> = {
  free: {
    benefits: [
      "Ticker Alerts for 1 ticker",
      "5-minute delivery delay",
      "Web + App alerts",
      "Unlimited watchlist",
      "Ads included",
    ],
    cta: "Start Free",
    description: "Experience alerts for one company.",
    monthlyPrice: "$0",
    name: "Free",
  },
  adFree: {
    benefits: [
      "Ticker Alerts for 5 tickers",
      "5-minute delivery delay",
      "Web + App alerts",
      "Unlimited watchlist",
      "Ads removed",
    ],
    cta: "Choose Ad-Free",
    description: "Cleaner alerts for a small ticker list.",
    monthlyPrice: "$4.99",
    name: "Ad-Free",
  },
  pro: {
    benefits: [
      "Ticker Alerts for 15 tickers",
      "All event types for selected tickers",
      "Core Market Events",
      "Market alerts scoring 75+",
      "Web + App + Telegram",
    ],
    cta: "Upgrade to Pro",
    description: "Alerts for your selected tickers and core market events.",
    monthlyPrice: "$19",
    name: "Pro",
  },
  advanced: {
    badge: "Full Market Scanner",
    benefits: [
      "Unlimited Ticker Alerts",
      "Full Market Coverage",
      "Dilution, listing, financial, legal, and FDA / Clinical",
      "Advanced filters and score controls",
      "Web + App + Telegram + Email",
    ],
    cta: "Go Advanced",
    description: "Full-market risk and catalyst detection for active traders.",
    monthlyPrice: "$49",
    name: "Advanced",
  },
  ultimate: {
    benefits: [
      "Full Market Coverage",
      "Custom Rules",
      "API / Webhook delivery",
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
    context: "Market-wide scan",
    lane: "Not on your watchlist",
    signal: "Bearish 94",
    signalTone: "negative",
    title: "MULN files $150M mixed-shelf offering",
    tone: "critical",
    type: "Dilution Risk",
  },
  {
    context: "Market-wide scan",
    lane: "Not on your watchlist",
    signal: "Bearish 88",
    signalTone: "negative",
    title: "WE receives Nasdaq delisting notice",
    tone: "warning",
    type: "Listing Risk",
  },
  {
    context: "Market-wide scan",
    lane: "Not on your watchlist",
    signal: "Bullish 82",
    signalTone: "positive",
    title: "MRNA reports FDA fast-track designation",
    tone: "earnings",
    type: "FDA Catalyst",
  },
] as const;

export const premiumV2MarketCoverageGroups: readonly PremiumV2MarketCoverageGroup[] = [
  {
    badge: "Pro+",
    description: "Major news and filings across core event types.",
    items: [
      { label: "Earnings", tone: "performance" },
      { label: "Sales Performance", tone: "performance" },
      { label: "Product Updates", tone: "performance" },
      { label: "Leadership & Governance", tone: "governance" },
      { label: "Insider Ownership", tone: "governance" },
      { label: "Shareholder Vote", tone: "governance" },
      { label: "Strategic Transactions", tone: "transaction" },
      { label: "Dividends", tone: "performance" },
      { label: "Capital Return", tone: "performance" },
      { label: "IPO / Listing", tone: "transaction" },
      { label: "Policy & Regulation", tone: "policy" },
      { label: "Macro Market", tone: "policy" },
    ],
    planKey: "pro",
    title: "Core Market Events",
  },
  {
    badge: "Advanced+",
    description: "Full-market risk and catalyst coverage.",
    items: [
      { label: "Dilution Risk", tone: "risk" },
      { label: "Listing Risk", tone: "risk" },
      { label: "Financial Risk", tone: "risk" },
      { label: "Legal Risk", tone: "risk" },
      { label: "FDA / Clinical", tone: "policy" },
    ],
    planKey: "advanced",
    title: "Risk & Catalyst Events",
  },
];

export const premiumV2ComparisonRows: readonly PremiumV2ComparisonRow[] = [
  {
    feature: "Ticker Alerts",
    values: { free: "1", adFree: "5", pro: "15", advanced: "Unlimited", ultimate: "Unlimited" },
  },
  {
    feature: "Selected Ticker Coverage",
    values: { free: "All alert categories", adFree: "All alert categories", pro: "All alert categories", advanced: "All alert categories", ultimate: "All alert categories" },
  },
  {
    feature: "Market-Wide Core Events",
    values: { free: "—", adFree: "—", pro: "Included", advanced: "Included", ultimate: "Included" },
  },
  {
    details: {
      advanced: [
        { label: "Dilution Risk", tone: "risk" },
        { label: "Listing Risk", tone: "risk" },
        { label: "Financial Risk", tone: "risk" },
        { label: "Legal Risk", tone: "risk" },
        { label: "FDA / Clinical", tone: "policy" },
      ],
      ultimate: [
        { label: "Dilution Risk", tone: "risk" },
        { label: "Listing Risk", tone: "risk" },
        { label: "Financial Risk", tone: "risk" },
        { label: "Legal Risk", tone: "risk" },
        { label: "FDA / Clinical", tone: "policy" },
      ],
    },
    feature: "Market-Wide Risk & Catalyst",
    values: { free: "—", adFree: "—", pro: "—", advanced: "5 types", ultimate: "5 types + rules" },
  },
  {
    feature: "Alert Score",
    values: { free: "—", adFree: "—", pro: "75+", advanced: "Adjustable", ultimate: "Custom" },
  },
  {
    feature: "Filter Controls",
    values: { free: "—", adFree: "—", pro: "Standard", advanced: "Advanced", ultimate: "Custom" },
  },
  {
    feature: "Delivery Delay",
    values: { free: "5 min", adFree: "5 min", pro: "No delay", advanced: "No delay", ultimate: "No delay" },
  },
  {
    feature: "Delivery Channels",
    values: { free: "Web + App", adFree: "Web + App", pro: "+ Telegram", advanced: "+ Telegram + Email", ultimate: "All + Webhook/API" },
  },
  {
    feature: "Custom Rules",
    values: { free: "—", adFree: "—", pro: "—", advanced: "—", ultimate: "Included" },
  },
];

export const premiumV2FaqItems = [
  {
    answer: "Ticker Alerts follow companies you select. Market-wide alerts follow the core or risk-and-catalyst coverage included in your plan.",
    question: "What is the difference between Ticker Alerts and Market-Wide Alerts?",
  },
  {
    answer: "No. Watchlist storage is unlimited on every plan. Your plan only limits how many tickers can have alerts enabled at the same time.",
    question: "Is my watchlist limited?",
  },
  {
    answer: "Pro adds Core Market Events. Advanced adds the five Risk & Catalyst event types shown above, with broader score and filter controls.",
    question: "Why choose Advanced instead of Pro?",
  },
  {
    answer: "No artificial delay means Stock Radar does not intentionally hold the alert after it is generated. Source publication, ingestion, analysis, processing, network, and third-party delivery may add latency.",
    question: "What does no artificial delivery delay mean?",
  },
  {
    answer: "No. Every CTA on this page is a local preview interaction. Checkout, payment, billing, and account changes are not connected.",
    question: "Does the upgrade button start payment?",
  },
] as const;
