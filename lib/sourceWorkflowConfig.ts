export const SOURCE_INGEST_WORKFLOW_LANES = {
  news_fast: {
    cronSchedule: "*/5 * * * *",
    label: "Fast news and exchange sources",
    limit: 5,
    lockTtlSeconds: 60 * 60,
    sourceIds: [
      "globe",
      "businesswire",
      "prnewswire",
      "newsfile",
      "accesswire",
      "nasdaq_trader",
      "nasdaq_corporate_actions",
    ],
    stepTimeout: "12m",
  },
  news_slow: {
    cronSchedule: "2,32 * * * *",
    label: "Government and regulatory news sources",
    limit: 10,
    lockTtlSeconds: 60 * 60,
    sourceIds: ["ofac", "doj", "dea", "whitehouse", "fda"],
    stepTimeout: "12m",
  },
} as const;

export type NewsWorkflowLane = keyof typeof SOURCE_INGEST_WORKFLOW_LANES;
export type WorkflowNewsSource =
  (typeof SOURCE_INGEST_WORKFLOW_LANES)[NewsWorkflowLane]["sourceIds"][number];

export const SEC_WORKFLOW_CONFIG = {
  cronSchedule: "*/5 * * * *",
  lockTtlSeconds: 2 * 60 * 60,
  rawStepTimeout: "8m",
  analysisStepTimeout: "12m",
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
