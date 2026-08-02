export const stockRadarProductName = "STOCK RADAR";

export type StockRadarPrimaryNavigationKey =
  | "alerts"
  | "calendar"
  | "feed"
  | "filings"
  | "markets"
  | "news"
  | "premium"
  | "watchlist";

export type StockRadarLinkNavigationItem = {
  href: string;
  key: StockRadarPrimaryNavigationKey;
  kind: "link";
  label: string;
  premium?: boolean;
};

export type StockRadarNavigationItem = StockRadarLinkNavigationItem;

export const stockRadarPrimaryNavigationItems = [
  { href: "/dashboard-v2", key: "markets", kind: "link", label: "Markets" },
  { href: "/feed", key: "feed", kind: "link", label: "Live Feed" },
  { href: "/watchlist", key: "watchlist", kind: "link", label: "Watchlist" },
  { href: "/news", key: "news", kind: "link", label: "News" },
  { href: "/filings", key: "filings", kind: "link", label: "Filings" },
  { href: "/alerts", key: "alerts", kind: "link", label: "Alerts" },
  { href: "/calendar", key: "calendar", kind: "link", label: "Calendar" },
  {
    href: "/premium",
    key: "premium",
    kind: "link",
    label: "Premium",
    premium: true,
  },
] as const satisfies readonly StockRadarLinkNavigationItem[];

export const stockRadarMobileNavigationItems = stockRadarPrimaryNavigationItems;
