/**
 * Workflow 4.x retries a failed step without returning to workflow orchestration
 * between attempts. Two hours covers four 800-second Vercel invocations plus
 * the configured retry backoff with more than an hour of additional margin.
 */
export const WORKFLOW_STEP_LEASE_TTL_SECONDS = 2 * 60 * 60;

/**
 * Source ingest routes and Workflows remain available for authenticated manual
 * verification, but no source-ingest paths are scheduled in vercel.json during
 * prelaunch.
 */
export const SOURCE_INGEST_AUTOMATIC_CRONS_ENABLED = false;

export const SOURCE_INGEST_WORKFLOW_SOURCES = {
  globe: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  businesswire: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  prnewswire: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  newsfile: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  accesswire: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  nasdaq_trader: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  nasdaq_corporate_actions: {
    lane: "news_fast",
    cronSchedule: "* * * * *",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  ofac: {
    lane: "news_slow",
    cronSchedule: "2,32 * * * *",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  doj: {
    lane: "news_slow",
    cronSchedule: "4,34 * * * *",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  dea: {
    lane: "news_slow",
    cronSchedule: "6,36 * * * *",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  whitehouse: {
    lane: "news_slow",
    cronSchedule: "8,38 * * * *",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
  fda: {
    lane: "news_slow",
    cronSchedule: "10,40 * * * *",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
  },
} as const;

export type WorkflowNewsSource = keyof typeof SOURCE_INGEST_WORKFLOW_SOURCES;
export type NewsWorkflowLane = "news_fast" | "news_slow";

export const SOURCE_INGEST_WORKFLOW_LANES = {
  news_fast: {
    label: "Fast news and exchange sources",
    sourceIds: [
      "globe",
      "businesswire",
      "prnewswire",
      "newsfile",
      "accesswire",
      "nasdaq_trader",
      "nasdaq_corporate_actions",
    ] satisfies WorkflowNewsSource[],
  },
  news_slow: {
    label: "Government and regulatory news sources",
    sourceIds: ["ofac", "doj", "dea", "whitehouse", "fda"] satisfies WorkflowNewsSource[],
  },
} as const;

export const SEC_WORKFLOW_CONFIG = {
  cronSchedule: "*/5 * * * *",
  lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
} as const;

export type SourceIngestCronLane = "sec" | NewsWorkflowLane;
export type SourceIngestCronTarget = SourceIngestCronLane | WorkflowNewsSource;

export function isNewsWorkflowLane(value: string): value is NewsWorkflowLane {
  return value in SOURCE_INGEST_WORKFLOW_LANES;
}

export function isWorkflowNewsSource(value: string): value is WorkflowNewsSource {
  return value in SOURCE_INGEST_WORKFLOW_SOURCES;
}

export function isSourceIngestCronLane(value: string): value is SourceIngestCronLane {
  return value === "sec" || isNewsWorkflowLane(value);
}

export function isSourceIngestCronTarget(value: string): value is SourceIngestCronTarget {
  return isSourceIngestCronLane(value) || isWorkflowNewsSource(value);
}

export function newsWorkflowLaneForSource(source: string): NewsWorkflowLane | null {
  return isWorkflowNewsSource(source)
    ? SOURCE_INGEST_WORKFLOW_SOURCES[source].lane
    : null;
}

export function isWorkflowNewsSourceEnabled(
  source: WorkflowNewsSource,
  enabledTargets: ReadonlySet<string>,
) {
  const config = SOURCE_INGEST_WORKFLOW_SOURCES[source];
  return enabledTargets.has(source) || enabledTargets.has(config.lane);
}
