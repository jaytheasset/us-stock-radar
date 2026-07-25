import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareSourceHydrationBatch,
  type SourceHydrationItem,
} from "./sourceHydrationIngestPlan.ts";

type Item = SourceHydrationItem & { id: string };
type Raw = Record<string, unknown> & { id: string };
type Event = { id: string };

test("five existing AccessWire events do zero hydration and yield no processing work", async () => {
  const items = Array.from({ length: 5 }, (_, index) =>
    item(`existing-${index + 1}`),
  );
  let hydrationCalls = 0;
  let mergeCalls = 0;

  const batch = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items,
    sourceCode: "accesswire",
    loadExistingState: async (current) => ({
      raw: {
        id: `raw-${current.id}`,
        body_text: "stored body",
      },
      event: { id: `event-${current.id}` },
    }),
    hydrateItems: async () => {
      hydrationCalls += 1;
      return { items: [], diagnostics: {} };
    },
    mergeExistingRaw: (current) => {
      mergeCalls += 1;
      return current;
    },
  });

  assert.equal(hydrationCalls, 0);
  assert.equal(mergeCalls, 0);
  assert.equal(batch.skipped.length, 5);
  assert.equal(batch.processingItems.length, 0);
  assert.equal(batch.retryableFailures.length, 0);
  assert.equal(batch.stats.preexistingCount, 5);
  assert.equal(batch.stats.hydrationRequestedCount, 0);
});

test("existing AccessWire body or analysis text is reused without article hydration", async () => {
  const items = [item("body"), item("analysis")];
  let hydrationCalls = 0;

  const batch = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items,
    sourceCode: "accesswire",
    loadExistingState: async (current) => ({
      raw:
        current.id === "body"
          ? { id: "raw-body", body_text: "stored body" }
          : {
              id: "raw-analysis",
              body_text: null,
              analysis_text: "stored analysis text",
            },
      event: null,
    }),
    hydrateItems: async () => {
      hydrationCalls += 1;
      return { items: [], diagnostics: {} };
    },
    mergeExistingRaw: (current, raw) => ({
      ...current,
      body_text:
        typeof raw.body_text === "string"
          ? raw.body_text
          : null,
      raw_payload: {
        ...current.raw_payload,
        analysis_text: raw.analysis_text,
      },
    }),
  });

  assert.equal(hydrationCalls, 0);
  assert.equal(batch.processingItems.length, 2);
  assert.equal(batch.stats.hydrationReusedCount, 2);
  assert.equal(
    batch.processingItems[1].raw_payload.analysis_text,
    "stored analysis text",
  );
});

test("completed low-value AccessWire raw is skipped before hydration and re-upsert", async () => {
  let hydrationCalls = 0;
  const batch = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items: [item("low-value")],
    sourceCode: "accesswire",
    loadExistingState: async () => ({
      raw: {
        id: "raw-low-value",
        body_text: "previously hydrated low-value body",
        raw_payload: {
          candidate_class: "low_value_filtered",
        },
      },
      event: null,
    }),
    hydrateItems: async () => {
      hydrationCalls += 1;
      return { items: [], diagnostics: {} };
    },
    mergeExistingRaw: (current) => current,
  });

  assert.equal(hydrationCalls, 0);
  assert.equal(batch.processingItems.length, 0);
  assert.equal(batch.retryableFailures.length, 0);
  assert.deepEqual(
    batch.skipped.map(({ reason }) => reason),
    ["existing_raw_terminal"],
  );
});

test("AccessWire hydration failure cannot reach event processing and retries next run", async () => {
  const listing = item("retry");
  let firstHydrationCalls = 0;
  const failed = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items: [listing],
    sourceCode: "accesswire",
    loadExistingState: async () => ({ raw: null, event: null }),
    hydrateItems: async (items) => {
      firstHydrationCalls += 1;
      return {
        items: items.map((current) => ({
          ...current,
          raw_payload: {
            ...current.raw_payload,
            article_fetch_error: "request timed out",
            article_fetch_retryable: true,
          },
        })),
        diagnostics: { articleBodiesFailed: 1 },
      };
    },
    mergeExistingRaw: (current) => current,
  });

  assert.equal(firstHydrationCalls, 1);
  assert.equal(failed.processingItems.length, 0);
  assert.equal(failed.retryableFailures.length, 1);
  assert.equal(failed.stats.hydrationFailedCount, 1);

  let retryHydrationCalls = 0;
  const retried = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items: [listing],
    sourceCode: "accesswire",
    loadExistingState: async () => ({
      raw: {
        id: "raw-retry",
        body_text: null,
        analysis_text: null,
        metadata: {
          article_fetch_error: "request timed out",
          article_fetch_retryable: true,
        },
      },
      event: null,
    }),
    hydrateItems: async (items) => {
      retryHydrationCalls += 1;
      return {
        items: items.map((current) => ({
          ...current,
          body_text: "body fetched on retry",
        })),
        diagnostics: { articleBodiesFetched: 1 },
      };
    },
    mergeExistingRaw: (current) => current,
  });

  assert.equal(retryHydrationCalls, 1);
  assert.equal(retried.processingItems.length, 1);
  assert.equal(retried.retryableFailures.length, 0);
});

function item(id: string): Item {
  return {
    id,
    source_code: "accesswire",
    body_text: null,
    raw_payload: {},
  };
}
