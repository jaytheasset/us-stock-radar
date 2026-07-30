export const CALENDAR_CATEGORIES = ["company", "macro", "policy"] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

export const COMPANY_EVENT_TYPES = [
  "earnings",
  "dividend",
  "split",
  "ipo",
] as const;
export type CompanyCalendarEventType = (typeof COMPANY_EVENT_TYPES)[number];

export const MACRO_EVENT_TYPES = [
  "cpi",
  "ppi",
  "pce",
  "employment-situation",
  "jolts",
  "gdp-advance",
  "retail-sales",
] as const;
export type MacroCalendarEventType = (typeof MACRO_EVENT_TYPES)[number];

export const POLICY_EVENT_TYPES = [
  "fomc-decision",
  "fomc-minutes",
  "fed-chair-testimony",
  "treasury-borrowing-estimate",
  "treasury-refunding",
  "treasury-auction-10y",
  "treasury-auction-30y",
  "sec-open-meeting",
  "sec-rule-milestone",
  "trade-policy-action",
  "fda-advisory-committee",
] as const;
export type PolicyCalendarEventType = (typeof POLICY_EVENT_TYPES)[number];

export const CALENDAR_EVENT_TYPES = [
  ...COMPANY_EVENT_TYPES,
  ...MACRO_EVENT_TYPES,
  ...POLICY_EVENT_TYPES,
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const POLICY_SUBCATEGORIES = [
  "monetary-policy",
  "treasury",
  "sec-regulation",
  "trade-policy",
  "industry-regulation",
] as const;
export type PolicySubcategory = (typeof POLICY_SUBCATEGORIES)[number];

export const CALENDAR_MARKET_SESSIONS = [
  "bmo",
  "market-hours",
  "amc",
  "tna",
] as const;
export type CalendarMarketSession = (typeof CALENDAR_MARKET_SESSIONS)[number];

export const CALENDAR_EVENT_STATUSES = [
  "confirmed",
  "estimated",
  "completed",
  "postponed",
  "cancelled",
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const CALENDAR_PROVIDERS = [
  "mock",
  "fmp",
  "bls",
  "bea",
  "census",
  "federal-reserve",
  "us-treasury",
  "sec",
  "federal-register",
  "ustr",
  "bis",
  "ofac",
  "fda",
  "other",
  "unknown",
] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
export type CalendarTimezone = "America/New_York";
export type CalendarTimeStatus = "exact" | "time-not-announced" | "all-day";
export type CalendarLifecycleStatus =
  | "scheduled"
  | "released"
  | "postponed"
  | "cancelled";
export type CalendarScheduleConfidence = "confirmed" | "tentative";
export type CalendarImpactLevel = "high" | "medium" | "low";
export type CalendarImpactScope = "market-wide" | "sector" | "company";

type CalendarEventCommon = {
  id: string;
  provider: CalendarProvider;
  category: CalendarCategory;
  eventType: CalendarEventType;
  title: string;
  eventDate: string;
  eventEndDate: string | null;
  eventTime: string | null;
  timezone: CalendarTimezone;
  timeStatus: CalendarTimeStatus;
  marketSession: CalendarMarketSession;
  lifecycleStatus: CalendarLifecycleStatus;
  scheduleConfidence: CalendarScheduleConfidence;
  impactLevel: CalendarImpactLevel;
  impactScope: CalendarImpactScope;
  sourceAgency: string;
  sourceName: string;
  sourceUrl: string | null;
  affectedSectors: string[];
  relatedTickers: string[];
  status: CalendarEventStatus;
  source: string;
  lastUpdatedAt: string;
};

type CompanyCalendarEventCommon = CalendarEventCommon & {
  category: "company";
  eventType: CompanyCalendarEventType;
  ticker: string | null;
  companyName: string;
  isWatchlisted: boolean;
};

export type EarningsCalendarEvent = CompanyCalendarEventCommon & {
  eventType: "earnings";
  details: {
    fiscalQuarter: string | null;
    epsEstimate: number | null;
    revenueEstimate: number | null;
    actualEps: number | null;
    actualRevenue: number | null;
    outcome: "beat" | "miss" | "in-line" | null;
  };
};

export type DividendCalendarEvent = CompanyCalendarEventCommon & {
  eventType: "dividend";
  details: {
    dividendPerShare: number | null;
    exDividendDate: string | null;
    recordDate: string | null;
    paymentDate: string | null;
    frequency: string | null;
    currency: string | null;
  };
};

export type SplitCalendarEvent = CompanyCalendarEventCommon & {
  eventType: "split";
  details: {
    ratio: string | null;
    splitKind: "forward" | "reverse" | null;
    effectiveDate: string | null;
    relatedTicker: string | null;
  };
};

export type IpoCalendarEvent = CompanyCalendarEventCommon & {
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
      | "trading"
      | null;
  };
};

export type CompanyCalendarEvent =
  | EarningsCalendarEvent
  | DividendCalendarEvent
  | SplitCalendarEvent
  | IpoCalendarEvent;

export type MacroMetric = {
  name: string;
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  unit: "percent" | "thousands" | "index" | "billions-usd";
  releaseStage: "monthly" | "advance" | "preliminary" | "final";
  released: boolean;
};

export type MacroCalendarEvent = CalendarEventCommon & {
  category: "macro";
  eventType: MacroCalendarEventType;
  details: {
    referencePeriod: string | null;
    metrics: MacroMetric[];
    releaseNote: string | null;
  };
};

type PolicyCalendarEventCommon = CalendarEventCommon & {
  category: "policy";
  eventType: PolicyCalendarEventType;
  policySubcategory: PolicySubcategory;
  primaryTicker: string | null;
};

export type FomcDecisionCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "fomc-decision";
  policySubcategory: "monetary-policy";
  details: {
    decisionTime: string | null;
    pressConferenceTime: string | null;
    includesSep: boolean | null;
    targetRangeLower: number | null;
    targetRangeUpper: number | null;
  };
};

export type FomcMinutesCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "fomc-minutes";
  policySubcategory: "monetary-policy";
  details: {
    meetingPeriod: string | null;
    documentTitle: string | null;
  };
};

export type FedChairTestimonyCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "fed-chair-testimony";
  policySubcategory: "monetary-policy";
  details: {
    witness: string | null;
    committee: string | null;
    topic: string | null;
  };
};

export type TreasuryCalendarEvent = PolicyCalendarEventCommon & {
  eventType:
    | "treasury-borrowing-estimate"
    | "treasury-refunding"
    | "treasury-auction-10y"
    | "treasury-auction-30y";
  policySubcategory: "treasury";
  details: {
    kind: "announcement" | "auction" | null;
    maturity: string | null;
    amountBillions: number | null;
    result: string | null;
  };
};

export type SecCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "sec-open-meeting" | "sec-rule-milestone";
  policySubcategory: "sec-regulation";
  details: {
    ruleOrMeetingTitle: string | null;
    agenda: string[];
    milestone:
      | "meeting"
      | "comment-deadline"
      | "effective-date"
      | "compliance-date"
      | null;
    documentOrDocket: string | null;
  };
};

export type TradePolicyCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "trade-policy-action";
  policySubcategory: "trade-policy";
  details: {
    actionType: "tariff" | "export-control" | "sanctions" | null;
    targetCountries: string[];
    affectedIndustries: string[];
    tariffOrRestriction: string | null;
    actionDateKind: "effective-date" | "comment-deadline" | null;
  };
};

export type FdaAdvisoryCalendarEvent = PolicyCalendarEventCommon & {
  eventType: "fda-advisory-committee";
  policySubcategory: "industry-regulation";
  details: {
    committee: string | null;
    product: string | null;
    sponsor: string | null;
    indication: string | null;
    meetingStartDate: string | null;
    meetingEndDate: string | null;
  };
};

export type PolicyCalendarEvent =
  | FomcDecisionCalendarEvent
  | FomcMinutesCalendarEvent
  | FedChairTestimonyCalendarEvent
  | TreasuryCalendarEvent
  | SecCalendarEvent
  | TradePolicyCalendarEvent
  | FdaAdvisoryCalendarEvent;

export type CalendarEvent =
  | CompanyCalendarEvent
  | MacroCalendarEvent
  | PolicyCalendarEvent;

export type CalendarRangePreset =
  | "today"
  | "this-week"
  | "next-week"
  | "custom";
export type CalendarViewMode = "calendar" | "list";

export type CalendarDateRange = {
  from: string;
  to: string;
};

export type CalendarFilters = {
  category: CalendarCategory | "all";
  eventType: CalendarEventType | "all";
  watchlistOnly: boolean;
  marketSession: CalendarMarketSession | "all";
  status: CalendarEventStatus | "all";
  query: string;
};

export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = {
  category: "all",
  eventType: "all",
  watchlistOnly: false,
  marketSession: "all",
  status: "all",
  query: "",
};

export const calendarCategoryLabels: Record<CalendarCategory, string> = {
  company: "Company",
  macro: "Macro",
  policy: "Policy",
};

export const eventTypeLabels: Record<CalendarEventType, string> = {
  earnings: "Earnings",
  dividend: "Dividends",
  split: "Splits",
  ipo: "IPO",
  cpi: "CPI",
  ppi: "PPI",
  pce: "PCE",
  "employment-situation": "Employment Situation",
  jolts: "JOLTS",
  "gdp-advance": "GDP Advance Estimate",
  "retail-sales": "Retail Sales",
  "fomc-decision": "FOMC Decision",
  "fomc-minutes": "FOMC Minutes",
  "fed-chair-testimony": "Fed Chair Semiannual Testimony",
  "treasury-borrowing-estimate": "Treasury Quarterly Borrowing Estimate",
  "treasury-refunding": "Treasury Quarterly Refunding",
  "treasury-auction-10y": "10-Year Treasury Auction",
  "treasury-auction-30y": "30-Year Treasury Auction",
  "sec-open-meeting": "SEC Major Open Meeting",
  "sec-rule-milestone": "SEC Rule Milestone",
  "trade-policy-action": "Trade Policy Action",
  "fda-advisory-committee": "FDA Advisory Committee",
};

export const calendarEventTypeGroups = {
  company: COMPANY_EVENT_TYPES,
  macro: MACRO_EVENT_TYPES,
  policy: POLICY_EVENT_TYPES,
} as const satisfies Record<CalendarCategory, readonly CalendarEventType[]>;

export const eventTypeCategories: Record<CalendarEventType, CalendarCategory> =
  Object.fromEntries(
    Object.entries(calendarEventTypeGroups).flatMap(([category, eventTypes]) =>
      eventTypes.map((eventType) => [eventType, category]),
    ),
  ) as Record<CalendarEventType, CalendarCategory>;

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
  postponed: "Postponed",
  cancelled: "Cancelled",
};

export const impactLevelLabels: Record<CalendarImpactLevel, string> = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
};

export const calendarProviderLabels: Record<CalendarProvider, string> = {
  mock: "Mock",
  fmp: "Financial Modeling Prep",
  bls: "BLS",
  bea: "BEA",
  census: "U.S. Census Bureau",
  "federal-reserve": "Federal Reserve",
  "us-treasury": "U.S. Treasury",
  sec: "SEC",
  "federal-register": "Federal Register",
  ustr: "USTR",
  bis: "BIS",
  ofac: "OFAC",
  fda: "FDA",
  other: "Other source",
  unknown: "Not announced",
};
