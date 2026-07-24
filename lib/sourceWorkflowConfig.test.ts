import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SEC_WORKFLOW_CONFIG,
  SOURCE_INGEST_WORKFLOW_LANES,
  WORKFLOW_STEP_LEASE_TTL_SECONDS,
  isSourceIngestCronLane,
  newsWorkflowLaneForSource,
} from "./sourceWorkflowConfig.ts";

test("workflow news lanes contain unique sources", () => {
  const sources = Object.values(SOURCE_INGEST_WORKFLOW_LANES).flatMap(
    (lane) => [...lane.sourceIds],
  );

  assert.equal(new Set(sources).size, sources.length);
});

test("fast and slow sources resolve to their configured lane", () => {
  for (const [lane, config] of Object.entries(SOURCE_INGEST_WORKFLOW_LANES)) {
    for (const source of config.sourceIds) {
      assert.equal(newsWorkflowLaneForSource(source), lane);
    }
  }
});

test("only supported cron lanes validate", () => {
  assert.equal(isSourceIngestCronLane("sec"), true);
  assert.equal(isSourceIngestCronLane("news_fast"), true);
  assert.equal(isSourceIngestCronLane("news_slow"), true);
  assert.equal(isSourceIngestCronLane("news"), false);
});

test("every lane keeps the lock for the complete Workflow 4.x step retry window", () => {
  assert.equal(WORKFLOW_STEP_LEASE_TTL_SECONDS, 2 * 60 * 60);
  assert.equal(
    SEC_WORKFLOW_CONFIG.lockTtlSeconds,
    WORKFLOW_STEP_LEASE_TTL_SECONDS,
  );
  for (const config of Object.values(SOURCE_INGEST_WORKFLOW_LANES)) {
    assert.equal(config.lockTtlSeconds, WORKFLOW_STEP_LEASE_TTL_SECONDS);
  }
});

test("Workflow 4.x never races an in-flight step against a durable sleep", () => {
  const workflowSource = readFileSync(
    new URL("../workflows/source-ingest.ts", import.meta.url),
    "utf8",
  );

  assert.equal(workflowSource.includes("Promise.race"), false);
  assert.equal(workflowSource.includes("withStepTimeout"), false);
});

test("Vercel cron schedules and region match the workflow configuration", () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as {
    regions?: string[];
    crons?: Array<{ path: string; schedule: string }>;
  };
  const schedules = new Map(
    (vercelConfig.crons || []).map((cron) => [cron.path, cron.schedule]),
  );

  assert.deepEqual(vercelConfig.regions, ["iad1"]);
  assert.equal(
    schedules.get("/api/cron/source-ingest/sec"),
    SEC_WORKFLOW_CONFIG.cronSchedule,
  );
  for (const [lane, config] of Object.entries(SOURCE_INGEST_WORKFLOW_LANES)) {
    assert.equal(
      schedules.get(`/api/cron/source-ingest/${lane}`),
      config.cronSchedule,
    );
  }
});
