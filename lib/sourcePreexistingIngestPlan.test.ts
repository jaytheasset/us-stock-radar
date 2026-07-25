import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourcePreexistingIngestPlan,
  isTerminalSourceRawItem,
} from "./sourceHydrationIngestPlan.ts";

type Item = {
  source_code: string;
  source_unique_id: string;
};

const terminalSources = [
  "prnewswire",
  "ofac",
  "doj",
  "dea",
  "whitehouse",
] as const;

test("terminal general-source raws skip raw, event, and LLM processing", async () => {
  let stateReads = 0;
  const items = terminalSources.map((source, index) =>
    item(source, `terminal-${index}`),
  );
  const terminalRaws = [
    { metadata: { ingest_decision: "outside_us_market_coverage" } },
    { metadata: { workflow_analysis_status: "completed" } },
    { metadata: { workflow_analysis_status: "skipped" } },
    { metadata: { event_created: true } },
    { raw_payload: { candidate_class: "low_value_filtered" } },
  ];

  const plan = await buildSourcePreexistingIngestPlan(
    items,
    async (_current) => {
      const raw = terminalRaws[stateReads];
      stateReads += 1;
      return { raw, event: null };
    },
  );

  assert.equal(stateReads, terminalSources.length);
  assert.equal(plan.skipped.length, terminalSources.length);
  assert.equal(plan.processing.length, 0);
  assert.deepEqual(
    plan.skipped.map((entry) => entry.reason),
    Array(terminalSources.length).fill("existing_raw_terminal"),
  );
});

test("unfinished general-source raws remain eligible for retry", async () => {
  const items = terminalSources.map((source, index) =>
    item(source, `retry-${index}`),
  );
  const plan = await buildSourcePreexistingIngestPlan(
    items,
    async (current) => ({
      raw: {
        source_unique_id: current.source_unique_id,
        metadata: {
          workflow_analysis_status: "failed",
          article_fetch_retryable: true,
        },
      },
      event: null,
    }),
  );

  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(
    plan.processing.map(({ item: current }) => current.source_code),
    terminalSources,
  );
});

test("new Newsfile source IDs continue through processing independently", async () => {
  const stateReads: string[] = [];
  const plan = await buildSourcePreexistingIngestPlan(
    [
      item("newsfile", "archive-2026-07-25-a"),
      item("newsfile", "archive-2026-07-25-b"),
    ],
    async (current) => {
      stateReads.push(current.source_unique_id);
      return { raw: null, event: null };
    },
  );

  assert.deepEqual(stateReads, [
    "archive-2026-07-25-a",
    "archive-2026-07-25-b",
  ]);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.processing.length, 2);
});

test("force mode keeps all items and performs no existing-state reads", async () => {
  let stateReads = 0;
  const plan = await buildSourcePreexistingIngestPlan(
    [item("prnewswire", "forced")],
    async () => {
      stateReads += 1;
      return {
        raw: { metadata: { workflow_analysis_status: "skipped" } },
        event: null,
      };
    },
    { force: true },
  );

  assert.equal(stateReads, 0);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.processing.length, 1);
});

test("terminal detection accepts persisted fields from legacy row shapes", () => {
  assert.equal(
    isTerminalSourceRawItem({
      workflow_analysis_status: "completed",
    }),
    true,
  );
  assert.equal(
    isTerminalSourceRawItem({
      metadata: { candidate_class: "low_value_filtered" },
    }),
    true,
  );
  assert.equal(
    isTerminalSourceRawItem({
      metadata: { workflow_analysis_status: "failed" },
    }),
    false,
  );
});

function item(sourceCode: string, sourceUniqueId: string): Item {
  return {
    source_code: sourceCode,
    source_unique_id: sourceUniqueId,
  };
}
