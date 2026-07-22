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
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";

export type AlertTicker = {
  company: string;
  enabled: boolean;
  id: string;
  ticker: string;
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
  lockedTier?: "ADVANCED";
  title: string;
};

export type FeedAlertSetting = {
  description: string;
  id: string;
  title: string;
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

export type RecentAlert = {
  category: string;
  event: string;
  id: string;
  ticker: string;
  time: string;
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

export const coverageItems: readonly CoverageItem[] = [
  {
    id: "earnings",
    title: "Earnings & Guidance",
    description: "Earnings dates, results, outlook updates, and guidance changes.",
    icon: LineChart,
    enabled: true,
  },
  {
    id: "clinical",
    title: "FDA & Clinical",
    description: "Clinical trial updates, FDA decisions, and regulatory milestones.",
    icon: FlaskConical,
    enabled: true,
  },
  {
    id: "strategic",
    title: "M&A & Strategic Events",
    description: "Acquisitions, partnerships, strategic reviews, and major deals.",
    icon: Merge,
    enabled: true,
  },
  {
    id: "company",
    title: "Major Company Updates",
    description: "Material filings, leadership changes, launches, and company news.",
    icon: Megaphone,
    enabled: true,
  },
  {
    id: "dilution",
    title: "Dilution & Offerings",
    description: "Equity offerings, shelf registrations, ATM programs, and warrant risk.",
    icon: Building2,
    enabled: false,
    locked: true,
  },
  {
    id: "listing",
    title: "Listing Risk & Delisting",
    description: "Exchange notices, compliance failures, delisting, and listing risk.",
    icon: AlertTriangle,
    enabled: false,
    locked: true,
  },
  {
    id: "reverse",
    title: "Reverse Splits",
    description: "Reverse split proposals, approvals, and effective date filings.",
    icon: RotateCcw,
    enabled: false,
    locked: true,
  },
  {
    id: "bankruptcy",
    title: "Bankruptcy & Default",
    description: "Default notices, restructuring events, bankruptcy filings, and distress.",
    icon: Landmark,
    enabled: false,
    locked: true,
  },
];

export const deliveryItems: readonly DeliveryItem[] = [
  { id: "app", title: "App Push", icon: Smartphone, enabled: true },
  { id: "web", title: "Web Push", icon: MonitorSmartphone, enabled: true },
  { id: "telegram", title: "Telegram", icon: Send, enabled: false },
  { id: "email", title: "Email", icon: Mail, enabled: false, lockedTier: "ADVANCED" },
];

export const feedAlertSettings: readonly FeedAlertSetting[] = [
  {
    id: "feed-wide",
    title: "Feed Alert settings",
    description: "Receive alerts from qualifying Live Feed events, not only enabled tickers.",
  },
  {
    id: "market-scan",
    title: "Market-wide scanner",
    description: "Scan all market tickers for high-score feed events.",
  },
  {
    id: "priority-routing",
    title: "Priority routing",
    description: "Send urgent feed alerts to selected delivery channels first.",
  },
];

export const marketCapFilters: readonly MarketCapFilter[] = [
  { id: "mega", label: "Mega", range: "$50B+" },
  { id: "large", label: "Large", range: "$10B-$50B" },
  { id: "mid", label: "Mid", range: "$1B-$10B" },
  { id: "small", label: "Small", range: "$50M-$1B" },
  { id: "micro", label: "Micro", range: "<$50M" },
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

export const recentAlerts: readonly RecentAlert[] = [
  {
    id: "rxrx-clinical",
    ticker: "RXRX",
    category: "FDA & Clinical",
    event: "Clinical trial update filed",
    time: "8 min ago",
  },
  {
    id: "nvda-guidance",
    ticker: "NVDA",
    category: "Earnings & Guidance",
    event: "Guidance update detected",
    time: "2 hours ago",
  },
  {
    id: "aapl-company",
    ticker: "AAPL",
    category: "Major Company Update",
    event: "New material filing detected",
    time: "Yesterday",
  },
  {
    id: "msft-company",
    ticker: "MSFT",
    category: "Major Company Update",
    event: "Leadership update identified",
    time: "Yesterday",
  },
  {
    id: "tsla-strategic",
    ticker: "TSLA",
    category: "M&A & Strategic Events",
    event: "Strategic partnership filing detected",
    time: "2 days ago",
  },
  {
    id: "amd-earnings",
    ticker: "AMD",
    category: "Earnings & Guidance",
    event: "Earnings date confirmed",
    time: "2 days ago",
  },
];
