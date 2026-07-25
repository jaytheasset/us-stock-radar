export type SourceHydrationExistingState<TRaw, TEvent> = {
  raw: TRaw | null;
  event: TEvent | null;
};

export type SourceHydrationIngestPlan<TItem, TRaw, TEvent> = {
  skipped: Array<{
    item: TItem;
    raw: TRaw | null;
    event: TEvent | null;
    reason: "existing_event" | "existing_raw_terminal";
  }>;
  reused: Array<{ item: TItem; raw: TRaw }>;
  hydrate: TItem[];
};

export type SourceHydrationItem = {
  source_code: string;
  body_text: string | null;
  raw_payload: Record<string, unknown>;
};

export type SourceHydrationResult<TItem> = {
  items: TItem[];
  diagnostics: Record<string, unknown>;
};

export async function buildSourceHydrationIngestPlan<
  TItem,
  TRaw extends Record<string, unknown>,
  TEvent,
>(
  items: TItem[],
  loadExistingState: (
    item: TItem,
  ) => Promise<SourceHydrationExistingState<TRaw, TEvent>>,
  options: { force?: boolean } = {},
): Promise<SourceHydrationIngestPlan<TItem, TRaw, TEvent>> {
  const plan: SourceHydrationIngestPlan<TItem, TRaw, TEvent> = {
    skipped: [],
    reused: [],
    hydrate: [],
  };

  for (const item of items) {
    if (options.force) {
      plan.hydrate.push(item);
      continue;
    }

    const existing = await loadExistingState(item);
    if (existing.event) {
      plan.skipped.push({
        item,
        raw: existing.raw,
        event: existing.event,
        reason: "existing_event",
      });
      continue;
    }

    if (existing.raw && isTerminalRawItem(existing.raw)) {
      plan.skipped.push({
        item,
        raw: existing.raw,
        event: null,
        reason: "existing_raw_terminal",
      });
      continue;
    }

    if (existing.raw && hasReusableAnalysis(existing.raw)) {
      plan.reused.push({ item, raw: existing.raw });
      continue;
    }

    plan.hydrate.push(item);
  }

  return plan;
}

export function partitionSourceHydrationItems<
  TItem extends SourceHydrationItem,
>(items: TItem[], sourceCode: string) {
  const ready: TItem[] = [];
  const retryableFailures: TItem[] = [];

  for (const item of items) {
    if (
      item.source_code === sourceCode &&
      !hasUsableItemAnalysis(item)
    ) {
      retryableFailures.push(item);
    } else {
      ready.push(item);
    }
  }

  return { ready, retryableFailures };
}

export async function prepareSourceHydrationBatch<
  TItem extends SourceHydrationItem,
  TRaw extends Record<string, unknown>,
  TEvent,
>({
  items,
  sourceCode,
  loadExistingState,
  hydrateItems,
  mergeExistingRaw,
  force = false,
}: {
  items: TItem[];
  sourceCode: string;
  loadExistingState: (
    item: TItem,
  ) => Promise<SourceHydrationExistingState<TRaw, TEvent>>;
  hydrateItems: (items: TItem[]) => Promise<SourceHydrationResult<TItem>>;
  mergeExistingRaw: (item: TItem, raw: TRaw) => TItem;
  force?: boolean;
}) {
  const plan = await buildSourceHydrationIngestPlan(
    items,
    loadExistingState,
    { force },
  );
  const reusedItems = plan.reused.map(({ item, raw }) =>
    mergeExistingRaw(item, raw),
  );
  const hydration = plan.hydrate.length
    ? await hydrateItems(plan.hydrate)
    : {
        items: [] as TItem[],
        diagnostics: emptyHydrationDiagnostics(),
      };
  const partition = partitionSourceHydrationItems(
    hydration.items,
    sourceCode,
  );

  return {
    skipped: plan.skipped,
    processingItems: [...reusedItems, ...partition.ready],
    retryableFailures: partition.retryableFailures,
    hydrationDiagnostics: hydration.diagnostics,
    stats: {
      preexistingCount: plan.skipped.length,
      hydrationRequestedCount: plan.hydrate.length,
      hydrationReusedCount: reusedItems.length,
      hydrationFailedCount: partition.retryableFailures.length,
    },
  };
}

function hasReusableAnalysis(raw: Record<string, unknown>) {
  return Boolean(
    stringValue(raw.body_text) ||
      stringValue(raw.analysis_text) ||
      stringValue(readRecord(raw.raw_payload)?.analysis_text),
  );
}

function hasUsableItemAnalysis(item: SourceHydrationItem) {
  return Boolean(
    stringValue(item.body_text) ||
      stringValue(item.raw_payload.analysis_text),
  );
}

function isTerminalRawItem(raw: Record<string, unknown>) {
  const metadata = readRecord(raw.metadata);
  const rawPayload = readRecord(raw.raw_payload);
  const workflowStatus = stringValue(metadata?.workflow_analysis_status);
  return (
    Boolean(stringValue(metadata?.ingest_decision)) ||
    workflowStatus === "completed" ||
    workflowStatus === "skipped" ||
    metadata?.event_created === true ||
    stringValue(rawPayload?.candidate_class) === "low_value_filtered"
  );
}

function emptyHydrationDiagnostics() {
  return {
    articleBodiesRequested: 0,
    articleBodiesFetched: 0,
    articleBodiesFailed: 0,
    articleBodiesTimedOut: 0,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
