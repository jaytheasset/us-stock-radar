import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBusinessWireIngestPlan,
  partitionBusinessWireHydrationItems,
} from "./businessWireIngestPlan.ts";

type Item = { id: string };
type Raw = Record<string, unknown> & { id: string };
type Event = { id: string };

test("existing events skip hydration entirely", async () => {
  let lookups = 0;
  const plan = await buildBusinessWireIngestPlan<Item, Raw, Event>(
    [{ id: "one" }, { id: "two" }],
    async (item) => {
      lookups += 1;
      return {
        raw: { id: `raw-${item.id}`, body_text: "already stored" },
        event: { id: `event-${item.id}` },
      };
    },
  );

  assert.equal(lookups, 2);
  assert.equal(plan.skipped.length, 2);
  assert.equal(plan.reused.length, 0);
  assert.equal(plan.hydrate.length, 0);
});

test("stored bodies are reused while failed hydration is retried", async () => {
  const plan = await buildBusinessWireIngestPlan<Item, Raw, Event>(
    [{ id: "body" }, { id: "failed" }, { id: "terminal" }, { id: "new" }],
    async (item) => {
      if (item.id === "body") {
        return {
          raw: { id: "raw-body", body_text: "stored article body" },
          event: null,
        };
      }
      if (item.id === "failed") {
        return {
          raw: {
            id: "raw-failed",
            body_text: null,
            raw_payload: { article_fetch_error: "timeout" },
          },
          event: null,
        };
      }
      if (item.id === "terminal") {
        return {
          raw: {
            id: "raw-terminal",
            body_text: null,
            analysis_text: null,
            metadata: { ingest_decision: "outside_coverage" },
          },
          event: null,
        };
      }
      return { raw: null, event: null };
    },
  );

  assert.deepEqual(plan.reused.map(({ item }) => item.id), ["body"]);
  assert.deepEqual(plan.hydrate.map((item) => item.id), ["failed", "new"]);
  assert.deepEqual(
    plan.skipped.map(({ item, reason }) => [item.id, reason]),
    [["terminal", "existing_raw_terminal"]],
  );
});

test("force mode hydrates every item without database lookups", async () => {
  let lookups = 0;
  const items = [{ id: "one" }, { id: "two" }];
  const plan = await buildBusinessWireIngestPlan<Item, Raw, Event>(
    items,
    async () => {
      lookups += 1;
      return { raw: null, event: null };
    },
    { force: true },
  );

  assert.equal(lookups, 0);
  assert.deepEqual(plan.hydrate, items);
});

test("failed hydration cannot enter event analysis and is retried on the next run", async () => {
  const failedItem = {
    source_code: "businesswire",
    body_text: null,
    raw_payload: {
      article_fetch_error: "Business Wire article request timed out",
      article_fetch_retryable: true,
    },
  };
  const hydratedItem = {
    source_code: "businesswire",
    body_text: "Complete article body",
    raw_payload: {},
  };

  const partition = partitionBusinessWireHydrationItems([
    failedItem,
    hydratedItem,
  ]);
  assert.deepEqual(partition.ready, [hydratedItem]);
  assert.deepEqual(partition.retryableFailures, [failedItem]);

  const nextRunPlan = await buildBusinessWireIngestPlan<
    Item,
    Raw,
    Event
  >(
    [{ id: "failed" }],
    async () => ({
      raw: {
        id: "raw-failed",
        body_text: null,
        metadata: {
          article_fetch_error: "Business Wire article request timed out",
          article_fetch_retryable: true,
        },
      },
      event: null,
    }),
  );

  assert.deepEqual(nextRunPlan.hydrate, [{ id: "failed" }]);
  assert.equal(nextRunPlan.skipped.length, 0);
  assert.equal(nextRunPlan.reused.length, 0);
});
