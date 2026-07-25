import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SEC_WORKFLOW_CONFIG,
  SOURCE_INGEST_AUTOMATIC_CRONS_ENABLED,
  SOURCE_INGEST_WORKFLOW_LANES,
  SOURCE_INGEST_WORKFLOW_SOURCES,
  WORKFLOW_STEP_LEASE_TTL_SECONDS,
  isSourceIngestCronLane,
  isSourceIngestCronTarget,
  isWorkflowNewsSourceEnabled,
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

test("every news source is an independent cron target", () => {
  for (const source of Object.keys(SOURCE_INGEST_WORKFLOW_SOURCES)) {
    assert.equal(isSourceIngestCronTarget(source), true);
  }
  assert.equal(isSourceIngestCronTarget("unknown"), false);
});

test("legacy lane tokens enable their sources for deployment compatibility", () => {
  const fastOnly = new Set(["news_fast"]);
  const slowOnly = new Set(["news_slow"]);

  assert.equal(isWorkflowNewsSourceEnabled("businesswire", fastOnly), true);
  assert.equal(isWorkflowNewsSourceEnabled("fda", fastOnly), false);
  assert.equal(isWorkflowNewsSourceEnabled("fda", slowOnly), true);
  assert.equal(
    isWorkflowNewsSourceEnabled("businesswire", new Set(["businesswire"])),
    true,
  );
});

test("every lane keeps the lock for the complete Workflow 4.x step retry window", () => {
  assert.equal(WORKFLOW_STEP_LEASE_TTL_SECONDS, 2 * 60 * 60);
  assert.equal(
    SEC_WORKFLOW_CONFIG.lockTtlSeconds,
    WORKFLOW_STEP_LEASE_TTL_SECONDS,
  );
  for (const config of Object.values(SOURCE_INGEST_WORKFLOW_SOURCES)) {
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
  assert.equal(workflowSource.includes("for (const source of config.sourceIds)"), false);
  assert.equal(workflowSource.includes("runNewsSourceIngestStep(input.source"), true);
});

test("news workflow emits structured source duration and outcome logs", () => {
  const workflowSource = readFileSync(
    new URL("../workflows/source-ingest.ts", import.meta.url),
    "utf8",
  );

  assert.match(workflowSource, /event:\s*"news_source_ingest_step"/);
  assert.match(workflowSource, /phase:\s*"START"/);
  assert.match(workflowSource, /phase:\s*"DONE"/);
  assert.match(workflowSource, /phase:\s*"FAIL"/);
  assert.match(workflowSource, /duration_ms:/);
  assert.match(workflowSource, /run_id:/);
  assert.match(workflowSource, /stats:/);
  assert.match(workflowSource, /success:/);
});

test("Vercel keeps source ingest automation disabled during prelaunch", () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as {
    regions?: string[];
    crons?: Array<{ path: string; schedule: string }>;
  };
  const crons = vercelConfig.crons || [];
  const sourceCrons = crons.filter((cron) =>
    cron.path.startsWith("/api/cron/source-ingest/"),
  );
  const marketCacheCrons = crons.filter(
    (cron) => cron.path === "/api/cron/market-cache",
  );

  assert.deepEqual(vercelConfig.regions, ["iad1"]);
  assert.equal(SOURCE_INGEST_AUTOMATIC_CRONS_ENABLED, false);
  assert.deepEqual(sourceCrons, []);
  assert.deepEqual(
    marketCacheCrons,
    [{ path: "/api/cron/market-cache", schedule: "*/5 * * * *" }],
  );
  assert.equal(crons.length, 1);
});
