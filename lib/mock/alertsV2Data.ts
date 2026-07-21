import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
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
  title: string;
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
  { id: "email", title: "Email", icon: Mail, enabled: false },
  { id: "web", title: "Web Push", icon: MonitorSmartphone, enabled: true },
  { id: "after-hours", title: "After-hours alerts", icon: Clock3, enabled: true },
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
];
