export const CALENDAR_EVENT_TYPES = ["earnings", "dividend", "split", "ipo"] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_MARKET_SESSIONS = ["bmo", "market-hours", "amc", "tna"] as const;
export type CalendarMarketSession = (typeof CALENDAR_MARKET_SESSIONS)[number];

export const CALENDAR_EVENT_STATUSES = ["confirmed", "estimated", "completed"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export type CalendarProvider = "mock";

type CalendarEventCommon = {
  id: string;
  provider: CalendarProvider;
  providerEventKey: string;
  ticker: string | null;
  companyName: string;
  title: string;
  eventDate: string;
  eventTime: string | null;
  marketSession: CalendarMarketSession;
  status: CalendarEventStatus;
  isWatchlisted: boolean;
  source: string;
  lastUpdatedAt: string;
};

export type EarningsCalendarEvent = CalendarEventCommon & {
  eventType: "earnings";
  details: {
    fiscalQuarter: string;
    epsEstimate: number | null;
    revenueEstimate: number | null;
    actualEps: number | null;
    actualRevenue: number | null;
    outcome: "beat" | "miss" | "in-line" | null;
  };
};

export type DividendCalendarEvent = CalendarEventCommon & {
  eventType: "dividend";
  details: {
    dividendPerShare: number | null;
    exDividendDate: string;
    recordDate: string | null;
    paymentDate: string | null;
    frequency: string | null;
    currency: string | null;
  };
};

export type SplitCalendarEvent = CalendarEventCommon & {
  eventType: "split";
  details: {
    ratio: string;
    splitKind: "forward" | "reverse";
    effectiveDate: string;
    relatedTicker: string | null;
  };
};

export type IpoCalendarEvent = CalendarEventCommon & {
  eventType: "ipo";
  details: {
    exchange: string | null;
    priceRangeLow: number | null;
    priceRangeHigh: number | null;
    offerPrice: number | null;
    raiseAmount: number | null;
    ipoStage:
      | "expected"
      | "date-estimated"
      | "range-announced"
      | "priced"
      | "trading";
  };
};

export type CalendarEvent =
  | EarningsCalendarEvent
  | DividendCalendarEvent
  | SplitCalendarEvent
  | IpoCalendarEvent;

export type CalendarRangePreset = "today" | "this-week" | "next-week" | "custom";
export type CalendarViewMode = "calendar" | "list";

export type CalendarDateRange = {
  from: string;
  to: string;
};

export type CalendarFilters = {
  eventType: CalendarEventType | "all";
  watchlistOnly: boolean;
  marketSession: CalendarMarketSession | "all";
  status: CalendarEventStatus | "all";
  query: string;
};

export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = {
  eventType: "all",
  watchlistOnly: false,
  marketSession: "all",
  status: "all",
  query: "",
};

export const eventTypeLabels: Record<CalendarEventType, string> = {
  earnings: "Earnings",
  dividend: "Dividends",
  split: "Splits",
  ipo: "IPO",
};

export const marketSessionLabels: Record<CalendarMarketSession, string> = {
  bmo: "Before Market Open",
  "market-hours": "Market Hours",
  amc: "After Market Close",
  tna: "Time Not Announced",
};

export const marketSessionShortLabels: Record<CalendarMarketSession, string> = {
  bmo: "BMO",
  "market-hours": "Market Hours",
  amc: "AMC",
  tna: "TNA",
};

export const eventStatusLabels: Record<CalendarEventStatus, string> = {
  confirmed: "Confirmed",
  estimated: "Estimated",
  completed: "Completed",
};
