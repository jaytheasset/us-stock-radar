export type PremiumV2PlanKey =
  | "free"
  | "adFree"
  | "pro"
  | "advanced"
  | "ultimate";

export type PremiumV2CategoryTone =
  | "earnings"
  | "insider"
  | "legal"
  | "product"
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
  emphasized?: boolean;
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
    monthlyPrice: "$6.99",
    name: "Ad-Free",
  },
  pro: {
    benefits: [
      "Ticker Alerts for 15 tickers",
      "12 core event types for selected tickers",
      "5 risk & catalyst types for selected tickers",
      "Market alerts scoring 75+",
      "Web + App + Telegram",
    ],
    cta: "Upgrade to Pro",
    description: "Twelve core and five risk & catalyst event types for your selected tickers.",
    monthlyPrice: "$19",
    name: "Pro",
  },
  advanced: {
    badge: "Full Market Scanner",
    benefits: [
      "Unlimited Ticker Alerts",
      "12 core + 5 risk & catalyst types across all market tickers",
      "Dilution, listing, financial, legal, and FDA / Clinical",
      "Advanced filters",
      "Web + App + Telegram + Email",
    ],
    cta: "Go Advanced",
    description: "Full-market risk and catalyst detection for active traders.",
    monthlyPrice: "$49",
    name: "Advanced",
  },
  ultimate: {
    benefits: [
      "12 core + 5 risk & catalyst types across all market tickers",
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

export const premiumV2MarketCoverageGroups: readonly PremiumV2MarketCoverageGroup[] = [
  {
    badge: "Pro+",
    description: "Twelve core event types for your selected ticker alerts.",
    items: [
      { label: "Earnings", tone: "earnings" },
      { label: "Sales Performance", tone: "earnings" },
      { label: "Product Updates", tone: "product" },
      { label: "Leadership & Governance", tone: "insider" },
      { label: "Insider Ownership", tone: "insider" },
      { label: "Shareholder Vote", tone: "insider" },
      { label: "Strategic Transactions", tone: "transaction" },
      { label: "Dividends", tone: "earnings" },
      { label: "Capital Return", tone: "earnings" },
      { label: "IPO / Listing", tone: "transaction" },
      { label: "Policy & Regulation", tone: "transaction" },
      { label: "Macro Market", tone: "transaction" },
    ],
    planKey: "pro",
    title: "Core Market Events",
  },
  {
    badge: "Advanced+",
    description: "Full-market risk and catalyst coverage.",
    items: [
      { label: "Dilution Risk", tone: "legal" },
      { label: "Listing Risk", tone: "legal" },
      { label: "Financial Risk", tone: "legal" },
      { label: "Legal Risk", tone: "legal" },
      { label: "FDA / Clinical", tone: "product" },
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
    feature: "Core Event Alerts",
    values: {
      free: "12 types · selected 1 ticker only",
      adFree: "12 types · selected 5 tickers only",
      pro: "12 types · selected 15 tickers",
      advanced: "12 types · all market tickers",
      ultimate: "12 types · all market tickers + rules",
    },
  },
  {
    details: {
      pro: [
        { label: "Dilution Risk", tone: "legal" },
        { label: "Listing Risk", tone: "legal" },
        { label: "Financial Risk", tone: "legal" },
        { label: "Legal Risk", tone: "legal" },
        { label: "FDA / Clinical", tone: "product" },
      ],
      advanced: [
        { label: "Dilution Risk", tone: "legal" },
        { label: "Listing Risk", tone: "legal" },
        { label: "Financial Risk", tone: "legal" },
        { label: "Legal Risk", tone: "legal" },
        { label: "FDA / Clinical", tone: "product" },
      ],
      ultimate: [
        { label: "Dilution Risk", tone: "legal" },
        { label: "Listing Risk", tone: "legal" },
        { label: "Financial Risk", tone: "legal" },
        { label: "Legal Risk", tone: "legal" },
        { label: "FDA / Clinical", tone: "product" },
      ],
    },
    feature: "Risk & Catalyst Alerts",
    emphasized: true,
    values: {
      free: "5 types · selected 1 ticker only",
      adFree: "5 types · selected 5 tickers only",
      pro: "5 types · selected 15 tickers",
      advanced: "5 types · all market tickers",
      ultimate: "5 types · all market tickers + rules",
    },
  },
  {
    feature: "Alert Score",
    values: { free: "75+", adFree: "75+", pro: "75+", advanced: "75+", ultimate: "75+" },
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
    answer: "Ticker Alerts cover the companies you choose. Pro covers 12 Core Event types and 5 Risk & Catalyst types for up to 15 selected tickers. Advanced extends that coverage across all market tickers.",
    question: "What is the difference between Ticker Alerts and Market-Wide Alerts?",
  },
  {
    answer: "No. Watchlist storage is unlimited on every plan. Your plan only limits how many tickers can have alerts enabled at the same time.",
    question: "Is my watchlist limited?",
  },
  {
    answer: "Pro covers 12 Core Event types and 5 Risk & Catalyst types for 15 selected tickers. Advanced scans those same event types across all market tickers, with unlimited ticker alerts, advanced filters, and email delivery.",
    question: "Why choose Advanced instead of Pro?",
  },
  {
    answer: "Yes. Enabled tickers receive all 12 Core Event types and all 5 Risk & Catalyst types available for their plan.",
    question: "Do selected tickers receive Risk & Catalyst Alerts?",
  },
  {
    answer: "No artificial delay means Stock Radar does not intentionally hold the alert after it is generated. Source publication, ingestion, analysis, processing, network, and third-party delivery may add latency.",
    question: "What does no artificial delivery delay mean?",
  },
  {
    answer: "Not in this preview. Selecting a plan only updates the local page state and does not start checkout.",
    question: "Does the upgrade button start payment?",
  },
] as const;
