export type BusinessWireExistingState<TRaw, TEvent> = {
  raw: TRaw | null;
  event: TEvent | null;
};

export type BusinessWireIngestPlan<TItem, TRaw, TEvent> = {
  skipped: Array<{
    item: TItem;
    raw: TRaw | null;
    event: TEvent | null;
    reason: "existing_event" | "existing_raw_terminal";
  }>;
  reused: Array<{ item: TItem; raw: TRaw }>;
  hydrate: TItem[];
};

export type BusinessWireHydrationItem = {
  source_code: string;
  body_text: string | null;
  raw_payload: Record<string, unknown>;
};

export function partitionBusinessWireHydrationItems<
  TItem extends BusinessWireHydrationItem,
>(items: TItem[]) {
  const ready: TItem[] = [];
  const retryableFailures: TItem[] = [];

  for (const item of items) {
    if (isRetryableBusinessWireHydrationFailure(item)) {
      retryableFailures.push(item);
    } else {
      ready.push(item);
    }
  }

  return { ready, retryableFailures };
}

export async function buildBusinessWireIngestPlan<
  TItem,
  TRaw extends Record<string, unknown>,
  TEvent,
>(
  items: TItem[],
  loadExistingState: (
    item: TItem,
  ) => Promise<BusinessWireExistingState<TRaw, TEvent>>,
  options: { force?: boolean } = {},
): Promise<BusinessWireIngestPlan<TItem, TRaw, TEvent>> {
  const plan: BusinessWireIngestPlan<TItem, TRaw, TEvent> = {
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

    if (existing.raw && hasReusableBody(existing.raw)) {
      plan.reused.push({ item, raw: existing.raw });
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

    plan.hydrate.push(item);
  }

  return plan;
}

function isRetryableBusinessWireHydrationFailure(
  item: BusinessWireHydrationItem,
) {
  return (
    item.source_code === "businesswire" &&
    !stringValue(item.body_text) &&
    Boolean(stringValue(item.raw_payload.article_fetch_error))
  );
}

function hasReusableBody(raw: Record<string, unknown>) {
  return typeof raw.body_text === "string" && raw.body_text.trim().length > 0;
}

function isTerminalRawItem(raw: Record<string, unknown>) {
  const metadata = readRecord(raw.metadata);
  const workflowStatus = stringValue(metadata?.workflow_analysis_status);
  return (
    Boolean(stringValue(metadata?.ingest_decision)) ||
    workflowStatus === "completed" ||
    workflowStatus === "skipped" ||
    metadata?.event_created === true
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
