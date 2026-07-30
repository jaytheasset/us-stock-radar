import type {
  CalendarImpactLevel,
  CalendarLifecycleStatus,
  CalendarScheduleConfidence,
  CompanyCalendarEventType,
} from "./model.ts";

export const FMP_COMPANY_CALENDAR_EVENT_TYPES = [
  "earnings",
  "dividend",
  "split",
  "ipo",
] as const satisfies readonly CompanyCalendarEventType[];

export type FmpCompanyCalendarEventType =
  (typeof FMP_COMPANY_CALENDAR_EVENT_TYPES)[number];

export const FMP_CALENDAR_ENDPOINTS = {
  earnings: "earnings-calendar",
  dividend: "dividends-calendar",
  split: "splits-calendar",
  ipo: "ipos-calendar",
} as const satisfies Record<FmpCompanyCalendarEventType, string>;

export const FMP_CALENDAR_DAILY_CAP = 4_000;
export const FMP_CALENDAR_FETCH_CONCURRENCY = 2;
export const FMP_CALENDAR_FETCH_TIMEOUT_MS = 15_000;
export const FMP_CALENDAR_READ_LIMIT = 2_000;
export const FMP_CALENDAR_UNIVERSE_REFERENCE_COUNT = 5_492;

export const FMP_CALENDAR_WEEKLY_REFERENCE = {
  accepted: {
    dividend: 96,
    earnings: 967,
    ipoListed: 1,
    split: 12,
  },
  fetched: {
    dividend: 557,
    earnings: 2_294,
    ipo: 28,
    split: 17,
  },
  from: "2026-07-27",
  to: "2026-08-02",
} as const;

export type FmpCalendarIngestMode = "backfill";

export type FmpCalendarIngestRequest = {
  dryRun: boolean;
  eventTypes: FmpCompanyCalendarEventType[];
  from: string;
  mode: FmpCalendarIngestMode;
  persist: boolean;
  to: string;
};

export type FmpTickerUniverseEntry = {
  assetType: "stock" | "adr_or_class";
  exchange: string;
  name: string;
  symbol: string;
};

export type FmpCalendarFetchResult = {
  date: string;
  eventType: FmpCompanyCalendarEventType;
  fetchedAt: string;
  rows: unknown[];
  truncated: boolean;
};

export type FmpCalendarObservation = {
  canonicalIdentityKey: string;
  companyName: string;
  details: Record<string, unknown>;
  eventDate: string;
  eventType: FmpCompanyCalendarEventType;
  fetchedAt: string;
  impactLevel: CalendarImpactLevel;
  lifecycleStatus: CalendarLifecycleStatus;
  observationFingerprint: string;
  rawChecksum: string;
  rawPayload: Record<string, unknown>;
  requestDate: string;
  runId: string;
  scheduleConfidence: CalendarScheduleConfidence;
  sourceEventKey: string;
  sourceModifiedAt: string | null;
  ticker: string | null;
  title: string;
};

export type FmpCalendarAdapterOutcome =
  | {
      kind: "accepted";
      observation: FmpCalendarObservation;
      universeClass: "listed" | "ipo-candidate";
      warnings: string[];
    }
  | {
      kind: "filtered";
      reason: string;
      warnings: string[];
    }
  | {
      kind: "rejected" | "quarantined";
      reason: string;
      warnings: string[];
    };

export type FmpCalendarEndpointStats = {
  accepted: number;
  deduplicated: number;
  fetched: number;
  filtered: number;
  history: number;
  ipoCandidates: number;
  listed: number;
  quarantined: number;
  rejected: number;
  truncated: boolean;
  unchanged: number;
  upserted: number;
};

export type FmpCalendarIngestStats = {
  accepted: number;
  deduplicated: number;
  endpointErrors: number;
  endpoints: Record<FmpCompanyCalendarEventType, FmpCalendarEndpointStats>;
  fetched: number;
  filtered: number;
  history: number;
  ipoCandidates: number;
  listed: number;
  quarantined: number;
  readLimitRisk: boolean;
  rejected: number;
  truncated: boolean;
  unchanged: number;
  universeSize: number;
  upserted: number;
};

export type FmpCalendarPersistResult = {
  eventId: string;
  historyCreated: boolean;
  revision: number;
  unchanged: boolean;
  upserted: boolean;
};

export type FmpCalendarIngestResult = {
  dryRun: boolean;
  eventTypes: FmpCompanyCalendarEventType[];
  from: string;
  mode: FmpCalendarIngestMode;
  ok: boolean;
  persist: boolean;
  stage: "dry-run" | "persisted" | "fetch-failed" | "truncated";
  stats: FmpCalendarIngestStats;
  to: string;
  warnings: string[];
};
