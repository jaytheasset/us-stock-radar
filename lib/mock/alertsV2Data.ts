import type { MarketImpact } from "@/components/market/MarketImpactLabel";

export type AlertsV2Mode = "Alert Feed" | "Rules" | "History";
export type AlertsV2Signal = "bearish" | "bullish" | "neutral";
export type AlertsV2StatusFilter = "all" | "read" | "unread";
export type AlertsV2ImpactFilter = "all" | MarketImpact;
export type AlertsV2ScopeFilter = "all" | "market" | "watchlist";
export type AlertsV2EventType =
  | "dilution"
  | "earnings"
  | "filing"
  | "insider"
  | "legal"
  | "listing"
  | "macro"
  | "volume";

export type AlertsV2Alert = {
  company?: string;
  dateGroup: string;
  eventType: AlertsV2EventType;
  headline: string;
  id: string;
  impact: MarketImpact;
  matchedRule: string;
  scope: Exclude<AlertsV2ScopeFilter, "all">;
  signal: AlertsV2Signal;
  source: string;
  summary: string;
  ticker?: string;
  time: string;
  timestampLabel: string;
  unread: boolean;
};

export type AlertsV2Rule = {
  channel: "Email" | "Telegram" | "Web";
  enabled: boolean;
  eventType: AlertsV2EventType;
  id: string;
  lastTriggered: string;
  minimumImpact: MarketImpact;
  name: string;
  scope: "All Market" | "Selected Ticker" | "Watchlist";
  signal: AlertsV2Signal;
  ticker?: string;
};

export type AlertsV2FilterState = {
  eventType: "all" | AlertsV2EventType;
  impact: AlertsV2ImpactFilter;
  scope: AlertsV2ScopeFilter;
  status: AlertsV2StatusFilter;
};

export const alertsV2Modes = ["Alert Feed", "Rules", "History"] as const satisfies readonly AlertsV2Mode[];

export const alertsV2DefaultFilters: AlertsV2FilterState = {
  eventType: "all",
  impact: "all",
  scope: "all",
  status: "all",
};

export const alertsV2StatusOptions = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
] as const satisfies readonly { label: string; value: AlertsV2StatusFilter }[];

export const alertsV2ImpactOptions = [
  { label: "All", value: "all" },
  { label: "Major", value: "major" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
] as const satisfies readonly { label: string; value: AlertsV2ImpactFilter }[];

export const alertsV2EventOptions = [
  { label: "All Events", value: "all" },
  { label: "Filings", value: "filing" },
  { label: "Earnings", value: "earnings" },
  { label: "Insider", value: "insider" },
  { label: "Legal", value: "legal" },
  { label: "Listing", value: "listing" },
  { label: "Dilution", value: "dilution" },
  { label: "Price / Volume", value: "volume" },
  { label: "Macro", value: "macro" },
] as const satisfies readonly { label: string; value: AlertsV2FilterState["eventType"] }[];

export const alertsV2ScopeOptions = [
  { label: "All", value: "all" },
  { label: "Watchlist", value: "watchlist" },
  { label: "Market", value: "market" },
] as const satisfies readonly { label: string; value: AlertsV2ScopeFilter }[];

export const alertsV2Alerts: readonly AlertsV2Alert[] = [
  {
    company: "CrowdStrike Holdings, Inc.",
    dateGroup: "Today",
    eventType: "legal",
    headline: "Legal filing matched your high-impact watchlist rule",
    id: "alert-crwd-legal",
    impact: "high",
    matchedRule: "High-impact filings",
    scope: "watchlist",
    signal: "neutral",
    source: "Court filing • Mock fixture",
    summary: "A deterministic legal-category fixture matched the CRWD watchlist rule. No legal conclusion or live filing analysis is implied.",
    ticker: "CRWD",
    time: "09:42",
    timestampLabel: "Today, 9:42 AM ET",
    unread: true,
  },
  {
    company: "NVIDIA Corporation",
    dateGroup: "Today",
    eventType: "earnings",
    headline: "Earnings release matched your watchlist condition",
    id: "alert-nvda-earnings",
    impact: "major",
    matchedRule: "Earnings for Watchlist",
    scope: "watchlist",
    signal: "bullish",
    source: "Earnings release • Mock fixture",
    summary: "The fixture represents an earnings-category match for a saved ticker. It contains no live estimates, guidance, or price conclusion.",
    ticker: "NVDA",
    time: "09:18",
    timestampLabel: "Today, 9:18 AM ET",
    unread: true,
  },
  {
    company: "Palantir Technologies Inc.",
    dateGroup: "Today",
    eventType: "volume",
    headline: "Unusual volume condition matched the selected rule",
    id: "alert-pltr-volume",
    impact: "high",
    matchedRule: "Unusual volume",
    scope: "market",
    signal: "bullish",
    source: "Market signal • Mock fixture",
    summary: "A local mock volume condition crossed its preset threshold. No market feed, quote provider, or trading signal is connected.",
    ticker: "PLTR",
    time: "08:56",
    timestampLabel: "Today, 8:56 AM ET",
    unread: true,
  },
  {
    company: "Rivian Automotive, Inc.",
    dateGroup: "Today",
    eventType: "filing",
    headline: "S-1 filing type matched High-impact filings",
    id: "alert-rivn-s1",
    impact: "major",
    matchedRule: "High-impact filings",
    scope: "watchlist",
    signal: "bearish",
    source: "SEC form S-1 • Mock fixture",
    summary: "This deterministic example demonstrates filing-type presentation only. It is not connected to SEC ingestion or filing analysis.",
    ticker: "RIVN",
    time: "08:31",
    timestampLabel: "Today, 8:31 AM ET",
    unread: true,
  },
  {
    company: "Apple Inc.",
    dateGroup: "Today",
    eventType: "insider",
    headline: "Form 4 activity matched your insider activity rule",
    id: "alert-aapl-form4",
    impact: "medium",
    matchedRule: "Insider activity",
    scope: "watchlist",
    signal: "neutral",
    source: "SEC form 4 • Mock fixture",
    summary: "A mock Form 4 category event matched the rule. No ownership interpretation or transaction recommendation is provided.",
    ticker: "AAPL",
    time: "07:48",
    timestampLabel: "Today, 7:48 AM ET",
    unread: false,
  },
  {
    company: "International Consolidated Data Infrastructure Systems Holdings",
    dateGroup: "Today",
    eventType: "listing",
    headline: "A deliberately long listing-event headline tests dense row truncation without changing the underlying mock rule",
    id: "alert-long-listing",
    impact: "medium",
    matchedRule: "Listing and dilution risk",
    scope: "market",
    signal: "neutral",
    source: "Listing notice • Mock fixture",
    summary: "This long deterministic fixture exists to verify company and headline truncation at every canonical viewport.",
    ticker: "VERYLONG",
    time: "07:12",
    timestampLabel: "Today, 7:12 AM ET",
    unread: false,
  },
  {
    dateGroup: "Today",
    eventType: "macro",
    headline: "Macro condition matched an all-market monitoring rule",
    id: "alert-macro",
    impact: "low",
    matchedRule: "Macro market monitor",
    scope: "market",
    signal: "neutral",
    source: "Macro calendar • Mock fixture",
    summary: "A tickerless macro fixture demonstrates market-wide alert presentation without claiming a live economic release.",
    time: "06:40",
    timestampLabel: "Today, 6:40 AM ET",
    unread: false,
  },
  {
    company: "Aurora Innovation, Inc.",
    dateGroup: "Yesterday",
    eventType: "dilution",
    headline: "424B5 filing type matched the dilution-risk preset",
    id: "alert-aur-dilution",
    impact: "high",
    matchedRule: "Listing and dilution risk",
    scope: "market",
    signal: "bearish",
    source: "SEC form 424B5 • Mock fixture",
    summary: "The local fixture demonstrates a dilution-category match. It does not evaluate offering terms or investment impact.",
    ticker: "AUR",
    time: "16:21",
    timestampLabel: "Yesterday, 4:21 PM ET",
    unread: true,
  },
  {
    company: "Microsoft Corporation",
    dateGroup: "Yesterday",
    eventType: "filing",
    headline: "Quarterly filing category matched your watchlist rule",
    id: "alert-msft-filing",
    impact: "low",
    matchedRule: "High-impact filings",
    scope: "watchlist",
    signal: "neutral",
    source: "SEC form 10-Q • Mock fixture",
    summary: "A deterministic 10-Q category fixture matched a saved ticker rule. No live document or analysis is attached.",
    ticker: "MSFT",
    time: "15:37",
    timestampLabel: "Yesterday, 3:37 PM ET",
    unread: false,
  },
];

export const alertsV2HistoryAlerts: readonly AlertsV2Alert[] = [
  ...alertsV2Alerts.filter((alert) => !alert.unread),
  {
    company: "Tesla, Inc.",
    dateGroup: "Jul 13, 2026",
    eventType: "volume",
    headline: "Price and volume preset matched a watchlist ticker",
    id: "history-tsla-volume",
    impact: "medium",
    matchedRule: "Unusual volume",
    scope: "watchlist",
    signal: "bullish",
    source: "Market signal • Mock fixture",
    summary: "Historical mock item used to verify grouped history and pagination.",
    ticker: "TSLA",
    time: "14:08",
    timestampLabel: "Jul 13, 2026, 2:08 PM ET",
    unread: false,
  },
  {
    company: "Coinbase Global, Inc.",
    dateGroup: "Jul 13, 2026",
    eventType: "legal",
    headline: "Legal category matched an all-market rule",
    id: "history-coin-legal",
    impact: "high",
    matchedRule: "High-impact filings",
    scope: "market",
    signal: "neutral",
    source: "Legal notice • Mock fixture",
    summary: "Historical mock item with no connected legal source or delivery record.",
    ticker: "COIN",
    time: "11:26",
    timestampLabel: "Jul 13, 2026, 11:26 AM ET",
    unread: false,
  },
  {
    company: "Advanced Micro Devices, Inc.",
    dateGroup: "Jul 12, 2026",
    eventType: "earnings",
    headline: "Earnings category matched the watchlist preset",
    id: "history-amd-earnings",
    impact: "major",
    matchedRule: "Earnings for Watchlist",
    scope: "watchlist",
    signal: "neutral",
    source: "Earnings release • Mock fixture",
    summary: "Historical fixture used only for local page separation.",
    ticker: "AMD",
    time: "17:02",
    timestampLabel: "Jul 12, 2026, 5:02 PM ET",
    unread: false,
  },
];

export const alertsV2Rules: readonly AlertsV2Rule[] = [
  {
    channel: "Web",
    enabled: true,
    eventType: "filing",
    id: "rule-high-impact-filings",
    lastTriggered: "Today, 9:42 AM ET",
    minimumImpact: "high",
    name: "High-impact filings",
    scope: "All Market",
    signal: "neutral",
  },
  {
    channel: "Email",
    enabled: true,
    eventType: "earnings",
    id: "rule-watchlist-earnings",
    lastTriggered: "Today, 9:18 AM ET",
    minimumImpact: "medium",
    name: "Earnings for Watchlist",
    scope: "Watchlist",
    signal: "neutral",
  },
  {
    channel: "Web",
    enabled: true,
    eventType: "volume",
    id: "rule-unusual-volume",
    lastTriggered: "Today, 8:56 AM ET",
    minimumImpact: "high",
    name: "Unusual volume",
    scope: "All Market",
    signal: "bullish",
  },
  {
    channel: "Telegram",
    enabled: false,
    eventType: "dilution",
    id: "rule-listing-dilution",
    lastTriggered: "Yesterday, 4:21 PM ET",
    minimumImpact: "high",
    name: "Listing and dilution risk",
    scope: "All Market",
    signal: "bearish",
  },
  {
    channel: "Web",
    enabled: true,
    eventType: "insider",
    id: "rule-insider-activity",
    lastTriggered: "Today, 7:48 AM ET",
    minimumImpact: "medium",
    name: "Insider activity",
    scope: "Watchlist",
    signal: "neutral",
  },
];

export function getAlertsV2EventLabel(eventType: AlertsV2EventType) {
  const labels: Record<AlertsV2EventType, string> = {
    dilution: "DILUTION",
    earnings: "EARN",
    filing: "FILING",
    insider: "INSIDER",
    legal: "LEGAL",
    listing: "LISTING",
    macro: "MACRO",
    volume: "VOLUME",
  };

  return labels[eventType];
}

export function getAlertsV2SignalLabel(signal: AlertsV2Signal) {
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)}`;
}
