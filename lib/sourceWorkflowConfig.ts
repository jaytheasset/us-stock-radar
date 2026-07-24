/**
 * Workflow 4.x retries a failed step without returning to workflow orchestration
 * between attempts. Two hours covers four 800-second Vercel invocations plus
 * the configured retry backoff with more than an hour of additional margin.
 */
export const WORKFLOW_STEP_LEASE_TTL_SECONDS = 2 * 60 * 60;

export const SOURCE_INGEST_WORKFLOW_LANES = {
  news_fast: {
    cronSchedule: "*/5 * * * *",
    label: "Fast news and exchange sources",
    limit: 5,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
    sourceIds: [
      "globe",
      "businesswire",
      "prnewswire",
      "newsfile",
      "accesswire",
      "nasdaq_trader",
      "nasdaq_corporate_actions",
    ],
  },
  news_slow: {
    cronSchedule: "2,32 * * * *",
    label: "Government and regulatory news sources",
    limit: 10,
    lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
    sourceIds: ["ofac", "doj", "dea", "whitehouse", "fda"],
  },
} as const;

export type NewsWorkflowLane = keyof typeof SOURCE_INGEST_WORKFLOW_LANES;
export type WorkflowNewsSource =
  (typeof SOURCE_INGEST_WORKFLOW_LANES)[NewsWorkflowLane]["sourceIds"][number];

export const SEC_WORKFLOW_CONFIG = {
  cronSchedule: "*/5 * * * *",
  lockTtlSeconds: WORKFLOW_STEP_LEASE_TTL_SECONDS,
} as const;

export type SourceIngestCronLane = "sec" | NewsWorkflowLane;

export function isNewsWorkflowLane(value: string): value is NewsWorkflowLane {
  return value in SOURCE_INGEST_WORKFLOW_LANES;
}

export function isSourceIngestCronLane(value: string): value is SourceIngestCronLane {
  return value === "sec" || isNewsWorkflowLane(value);
}

export function newsWorkflowLaneForSource(source: string): NewsWorkflowLane | null {
  for (const [lane, config] of Object.entries(SOURCE_INGEST_WORKFLOW_LANES)) {
    if ((config.sourceIds as readonly string[]).includes(source)) {
      return lane as NewsWorkflowLane;
    }
  }
  return null;
}
