import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareSourceHydrationBatch,
  type SourceHydrationItem,
} from "./sourceHydrationIngestPlan.ts";

type Item = SourceHydrationItem & { id: string };
type Raw = Record<string, unknown> & { id: string };
type Event = { id: string };

test("FDA existing events and terminal raws skip all article hydration", async () => {
  const items = Array.from({ length: 10 }, (_, index) =>
    item(`fda-${index + 1}`),
  );
  let hydrationCalls = 0;

  const batch = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items,
    sourceCode: "fda",
    loadExistingState: async (current) => {
      const index = Number(current.id.split("-").at(-1));
      if (index <= 7) {
        return {
          raw: { id: `raw-${current.id}`, body_text: null },
          event: { id: `event-${current.id}` },
        };
      }
      return {
        raw: {
          id: `raw-${current.id}`,
          body_text: null,
          analysis_text: null,
          metadata: {
            workflow_analysis_status: "skipped",
            ingest_decision: "low_value_raw_prefilter",
          },
          raw_payload: { candidate_class: "low_value_filtered" },
        },
        event: null,
      };
    },
    hydrateItems: async () => {
      hydrationCalls += 1;
      return { items: [], diagnostics: {} };
    },
    mergeExistingRaw: (current) => current,
  });

  assert.equal(hydrationCalls, 0);
  assert.equal(batch.skipped.length, 10);
  assert.equal(batch.processingItems.length, 0);
  assert.equal(batch.stats.preexistingCount, 10);
  assert.equal(batch.stats.hydrationRequestedCount, 0);
});

test("FDA non-terminal failed raw retries hydration", async () => {
  let hydrationCalls = 0;
  const batch = await prepareSourceHydrationBatch<Item, Raw, Event>({
    items: [item("retry")],
    sourceCode: "fda",
    loadExistingState: async () => ({
      raw: {
        id: "raw-retry",
        body_text: null,
        analysis_text: null,
        metadata: {
          article_fetch_error: "timeout",
          article_fetch_retryable: true,
        },
      },
      event: null,
    }),
    hydrateItems: async (items) => {
      hydrationCalls += 1;
      return {
        items: items.map((current) => ({
          ...current,
          body_text: "FDA body fetched on retry",
        })),
        diagnostics: { articleBodiesFetched: 1 },
      };
    },
    mergeExistingRaw: (current) => current,
  });

  assert.equal(hydrationCalls, 1);
  assert.equal(batch.processingItems.length, 1);
  assert.equal(batch.retryableFailures.length, 0);
  assert.equal(batch.stats.hydrationRequestedCount, 1);
});

function item(id: string): Item {
  return {
    id,
    source_code: "fda",
    body_text: null,
    raw_payload: {},
  };
}
