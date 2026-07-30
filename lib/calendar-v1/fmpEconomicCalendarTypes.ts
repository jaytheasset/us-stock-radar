import type {
  CalendarCategory,
  CalendarImpactLevel,
  CalendarLifecycleStatus,
  CalendarMarketSession,
  CalendarScheduleConfidence,
  CalendarTimeStatus,
  MacroCalendarEventType,
  MacroMetric,
  PolicyCalendarEventType,
  PolicySubcategory,
} from "./model.ts";

export const FMP_ECONOMIC_CALENDAR_EVENT_TYPES = [
  "cpi",
  "ppi",
  "pce",
  "employment-situation",
  "jolts",
  "gdp-advance",
  "retail-sales",
  "fomc-decision",
  "fomc-minutes",
  "treasury-refunding",
  "treasury-auction-10y",
  "treasury-auction-30y",
] as const satisfies readonly (
  | MacroCalendarEventType
  | PolicyCalendarEventType
)[];

export type FmpEconomicCalendarEventType =
  (typeof FMP_ECONOMIC_CALENDAR_EVENT_TYPES)[number];

export const FMP_ECONOMIC_CALENDAR_UNSUPPORTED_POLICY_TYPES = [
  "fed-chair-testimony",
  "treasury-borrowing-estimate",
  "sec-open-meeting",
  "sec-rule-milestone",
  "trade-policy-action",
  "fda-advisory-committee",
] as const satisfies readonly PolicyCalendarEventType[];

export const FMP_ECONOMIC_CALENDAR_ENDPOINT = "economic-calendar";
export const FMP_ECONOMIC_CALENDAR_ROW_CAP = 10_000;
export const FMP_ECONOMIC_CALENDAR_FETCH_TIMEOUT_MS = 20_000;

export type FmpEconomicCalendarIngestRequest = {
  dryRun: boolean;
  eventTypes: FmpEconomicCalendarEventType[];
  from: string;
  mode: "backfill";
  persist: boolean;
  to: string;
};

export type FmpEconomicCalendarFetchResult = {
  fetchedAt: string;
  from: string;
  rows: unknown[];
  to: string;
  truncated: boolean;
};

export type FmpEconomicCalendarMetric = MacroMetric & {
  metricKey: string;
};

export type FmpEconomicCalendarObservation = {
  canonicalIdentityKey: string;
  category: CalendarCategory;
  details: Record<string, unknown>;
  eventDate: string;
  eventInstant: string;
  eventTime: string;
  eventType: FmpEconomicCalendarEventType;
  fetchedAt: string;
  impactLevel: CalendarImpactLevel;
  lifecycleStatus: CalendarLifecycleStatus;
  marketSession: CalendarMarketSession;
  metrics: FmpEconomicCalendarMetric[];
  observationFingerprint: string;
  policySubcategory: PolicySubcategory | null;
  rawChecksum: string;
  rawPayload: Record<string, unknown>;
  requestFrom: string;
  requestTo: string;
  runId: string;
  scheduleConfidence: CalendarScheduleConfidence;
  sourceAgency: string;
  sourceEventKey: string;
  sourceName: string;
  timeStatus: CalendarTimeStatus;
  title: string;
};

export type FmpEconomicCalendarAdapterResult = {
  matchedRows: number;
  observations: FmpEconomicCalendarObservation[];
  rejectedRows: number;
  unsupportedRows: number;
  usRows: number;
  warnings: string[];
};

export type FmpEconomicCalendarPersistResult = {
  eventId: string;
  historyCreated: boolean;
  revision: number;
  unchanged: boolean;
  upserted: boolean;
};

export type FmpEconomicCalendarIngestStats = {
  accepted: number;
  fetched: number;
  history: number;
  matchedRows: number;
  rejected: number;
  truncated: boolean;
  unchanged: number;
  unsupported: number;
  upserted: number;
  usRows: number;
};

export type FmpEconomicCalendarIngestResult = {
  coverage: {
    supported: FmpEconomicCalendarEventType[];
    unsupportedPolicy: readonly PolicyCalendarEventType[];
  };
  dryRun: boolean;
  eventTypes: FmpEconomicCalendarEventType[];
  from: string;
  mode: "backfill";
  ok: boolean;
  persist: boolean;
  stage: "dry-run" | "persisted" | "fetch-failed" | "truncated";
  stats: FmpEconomicCalendarIngestStats;
  to: string;
  warnings: string[];
};
