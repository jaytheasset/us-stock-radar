import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  authorizeMarketCacheCron,
  authorizeMarketCacheRefresh,
} from "./marketCacheCronAuth.ts";
import {
  MARKET_CACHE_ROTATING_RANGES,
  getMarketCacheRefreshPlan,
  splitMarketCacheThemeBatches,
} from "./marketCacheSchedule.ts";
import { resolveSnapshotCache } from "./marketGroupCachePolicy.ts";
import { startWithMarketCacheLock } from "./marketCacheWorkflowStarter.ts";

const sectors = ["Technology", "Healthcare", "Energy"];

test("uses New York regular hours across DST and skips weekends", () => {
  const summerOpen = getMarketCacheRefreshPlan(
    new Date("2026-07-23T13:30:00.000Z"),
    sectors,
  );
  assert.equal(summerOpen.marketDate, "2026-07-23");
  assert.equal(summerOpen.marketMinute, 9 * 60 + 30);
  assert.equal(summerOpen.marketPhase, "regular");
  assert.equal(summerOpen.oneDaySector, "Technology");
  assert.equal(summerOpen.refreshOneDayThemes, true);
  assert.equal(summerOpen.refreshMarketPulse, true);
  assert.ok(summerOpen.rotatingTarget);

  const winterOpen = getMarketCacheRefreshPlan(
    new Date("2026-12-21T14:30:00.000Z"),
    sectors,
  );
  assert.equal(winterOpen.marketDate, "2026-12-21");
  assert.equal(winterOpen.marketMinute, 9 * 60 + 30);
  assert.equal(winterOpen.marketPhase, "regular");

  const weekend = getMarketCacheRefreshPlan(
    new Date("2026-07-25T15:00:00.000Z"),
    sectors,
  );
  assert.equal(weekend.marketPhase, "closed");
  assert.equal(weekend.oneDaySector, null);
  assert.equal(weekend.refreshOneDayThemes, false);
  assert.equal(weekend.refreshMarketPulse, false);
  assert.equal(weekend.rotatingTarget, null);
});

test("runs one post-close 1D slot and respects exchange holidays", () => {
  const close = getMarketCacheRefreshPlan(
    new Date("2026-07-23T20:00:00.000Z"),
    sectors,
  );
  assert.equal(close.marketPhase, "post_close");
  assert.ok(close.oneDaySector);
  assert.equal(close.refreshOneDayThemes, true);
  assert.equal(close.refreshMarketPulse, true);

  const afterFinalSlot = getMarketCacheRefreshPlan(
    new Date("2026-07-23T20:05:00.000Z"),
    sectors,
  );
  assert.equal(afterFinalSlot.marketPhase, "closed");
  assert.equal(afterFinalSlot.oneDaySector, null);
  assert.equal(afterFinalSlot.refreshMarketPulse, false);

  const holiday = getMarketCacheRefreshPlan(
    new Date("2026-12-25T15:00:00.000Z"),
    sectors,
  );
  assert.equal(holiday.marketPhase, "closed");
  assert.equal(holiday.oneDaySector, null);
});

test("rotates one deterministic range and sector per long-range slot", () => {
  const firstDate = new Date("2026-07-23T13:30:00.000Z");
  const first = getMarketCacheRefreshPlan(firstDate, sectors);
  const repeated = getMarketCacheRefreshPlan(firstDate, sectors);
  const next = getMarketCacheRefreshPlan(
    new Date("2026-07-23T13:45:00.000Z"),
    sectors,
  );

  assert.deepEqual(first.rotatingTarget, repeated.rotatingTarget);
  assert.ok(first.rotatingTarget);
  assert.ok(next.rotatingTarget);
  assert.notDeepEqual(first.rotatingTarget, next.rotatingTarget);
  assert.ok(
    MARKET_CACHE_ROTATING_RANGES.includes(first.rotatingTarget!.range),
  );

  const offSlot = getMarketCacheRefreshPlan(
    new Date("2026-07-23T13:35:00.000Z"),
    sectors,
  );
  assert.equal(offSlot.rotatingTarget, null);
});

test("splits theme warming into bounded deterministic batches", () => {
  const slugs = Array.from({ length: 45 }, (_, index) => `theme-${index}`);
  const batches = splitMarketCacheThemeBatches(slugs);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [30, 15],
  );
  assert.deepEqual(batches.flat(), slugs);
});

test("returns fresh snapshots first and stale snapshots before a live miss", () => {
  const hydrate = (items: Array<{ id: string }>) =>
    items.map((item) => item.id);
  const usable = (items: string[]) => items.includes("required");

  assert.deepEqual(
    resolveSnapshotCache(
      [{ id: "required" }],
      [{ id: "required" }],
      hydrate,
      usable,
    ),
    { state: "hit", value: ["required"] },
  );
  assert.deepEqual(
    resolveSnapshotCache(
      [],
      [{ id: "required" }],
      hydrate,
      usable,
    ),
    { state: "stale", value: ["required"] },
  );
  assert.deepEqual(
    resolveSnapshotCache([], [], hydrate, usable),
    { state: "miss", value: null },
  );
});

test("cron authorization is timing-safe, bearer-only, and fails closed", () => {
  const secret = "market-cache-secret";
  assert.deepEqual(
    authorizeMarketCacheCron(
      requestWithHeaders({ authorization: `Bearer ${secret}` }),
      secret,
    ),
    { ok: true },
  );
  assert.deepEqual(
    authorizeMarketCacheCron(
      requestWithHeaders({ "x-cron-secret": secret }),
      secret,
    ),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
  assert.deepEqual(
    authorizeMarketCacheCron(
      requestWithHeaders({ authorization: "Bearer wrong" }),
      secret,
    ),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
  assert.deepEqual(
    authorizeMarketCacheCron(requestWithHeaders({}), ""),
    { ok: false, status: 500, error: "CRON_SECRET_MISSING" },
  );
});

test("market refresh authorization protects bypass writes but keeps reads public", () => {
  const secret = "market-refresh-secret";
  const authorized = requestWithHeaders({
    authorization: `Bearer ${secret}`,
  });

  assert.deepEqual(
    authorizeMarketCacheRefresh(requestWithHeaders({}), false, ""),
    { ok: true },
  );
  assert.deepEqual(
    authorizeMarketCacheRefresh(authorized, true, secret),
    { ok: true },
  );
  assert.deepEqual(
    authorizeMarketCacheRefresh(requestWithHeaders({}), true, ""),
    { ok: false, status: 500, error: "CRON_SECRET_MISSING" },
  );
  assert.deepEqual(
    authorizeMarketCacheRefresh(
      requestWithHeaders({ authorization: "Bearer wrong-secret" }),
      true,
      secret,
    ),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
});

test("a duplicate or overlapping lock never starts another workflow", async () => {
  let startCalls = 0;
  let releaseCalls = 0;
  const result = await startWithMarketCacheLock({
    acquire: async () => ({ ok: true, acquired: false }),
    onStartFailure: async () => {
      releaseCalls += 1;
    },
    start: async () => {
      startCalls += 1;
      return { runId: "should-not-run" };
    },
  });

  assert.deepEqual(result, { status: "locked" });
  assert.equal(startCalls, 0);
  assert.equal(releaseCalls, 0);
});

test("a workflow start failure releases the acquired lock", async () => {
  let releaseCalls = 0;
  const result = await startWithMarketCacheLock({
    acquire: async () => ({ ok: true, acquired: true }),
    onStartFailure: async () => {
      releaseCalls += 1;
    },
    start: async () => {
      throw new Error("start failed");
    },
  });

  assert.deepEqual(result, { status: "failed", error: "start failed" });
  assert.equal(releaseCalls, 1);
});

test("workflow and cron wiring use durable retry steps and one minimal cron", () => {
  const workflow = readProjectFile("workflows/market-cache-refresh.ts");
  const cronRoute = readProjectFile("app/api/cron/market-cache/route.ts");
  const marketCache = readProjectFile("lib/marketDataCache.ts");
  const marketPulse = readProjectFile("lib/marketPulse.ts");
  const marketPulseRefresh = readProjectFile("lib/marketPulseRefresh.ts");
  const sectorRoute = readProjectFile(
    "app/api/market/sector-performance/route.ts",
  );
  const themeRoute = readProjectFile(
    "app/api/market/theme-performance/route.ts",
  );
  const refreshScript = readProjectFile(
    "scripts/refresh-market-group-snapshots.js",
  );
  const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.match(workflow, /"use workflow"/);
  assert.ok((workflow.match(/"use step"/g) || []).length >= 4);
  assert.match(workflow, /refreshSectorPerformanceStep\.maxRetries = 3/);
  assert.match(workflow, /refreshThemePerformanceStep\.maxRetries = 3/);
  assert.match(workflow, /refreshMarketPulseStep\.maxRetries = 3/);
  assert.match(workflow, /if \(input\.plan\.refreshMarketPulse\)/);
  assert.match(workflow, /ensureMarketCacheLockStep\(input\)/);
  assert.match(cronRoute, /authorizeMarketCacheCron\(request\)/);
  assert.match(cronRoute, /start\(marketCacheRefreshWorkflow/);
  assert.doesNotMatch(cronRoute, /export async function POST/);
  assert.doesNotMatch(
    marketCache.slice(
      marketCache.indexOf("readMarketGroupSnapshotCache"),
      marketCache.indexOf("writeMarketGroupSnapshots"),
    ),
    /expires_at:\s*`gt\./,
  );
  assert.match(sectorRoute, /resolveSnapshotCache\(/);
  assert.match(themeRoute, /resolveSnapshotCache\(/);
  assert.match(sectorRoute, /authorizeMarketCacheRefresh\(/);
  assert.match(themeRoute, /authorizeMarketCacheRefresh\(/);
  assert.match(sectorRoute, /forceRefresh \? "bypass" : "miss"/);
  assert.match(themeRoute, /forceRefresh \? "bypass" : "miss"/);
  assert.match(marketPulse, /label: "US 10Y"[\s\S]*unit: "yield"/);
  assert.match(marketPulseRefresh, /providerSymbol: "I:SOX"/);
  assert.match(marketPulseRefresh, /providerSymbol: "I:NDX"/);
  assert.match(
    marketPulseRefresh,
    /unavailableWithCurrentProviderPlan: \["NQUSD", "RTYUSD"\]/,
  );
  assert.match(
    marketPulseRefresh,
    /marketPulseCacheTtlSeconds = 4 \* 24 \* 60 \* 60/,
  );
  assert.match(marketCache, /ttlSeconds = quoteTtlSeconds\(\)/);
  assert.match(marketCache, /ttlSeconds = barTtlSeconds\(payload\.range\)/);
  assert.match(marketPulse, /changeAmount \* 100/);
  assert.ok(
    (workflow.match(/process\.env\.CRON_SECRET/g) || []).length >= 2,
  );
  assert.ok(
    (
      workflow.match(
        /new FatalError\("CRON_SECRET is missing in the Workflow step environment"\)/g,
      ) || []
    ).length >= 2,
  );
  assert.ok(
    (workflow.match(/Authorization:\s*`Bearer \$\{cronSecret\}`/g) || [])
      .length >= 2,
  );
  const workflowInput = workflow.match(
    /export type MarketCacheRefreshWorkflowInput[\s\S]*?\n};/,
  )?.[0] || "";
  assert.doesNotMatch(workflowInput, /secret/i);
  assert.match(refreshScript, /process\.env\.CRON_SECRET/);
  assert.match(
    refreshScript,
    /headers\.Authorization = `Bearer \$\{cronSecret\}`/,
  );
  assert.deepEqual(
    vercelConfig.crons?.filter(
      (cron) => cron.path === "/api/cron/market-cache",
    ),
    [{ path: "/api/cron/market-cache", schedule: "*/5 * * * *" }],
  );
});

function requestWithHeaders(values: HeadersInit) {
  return { headers: new Headers(values) };
}

function readProjectFile(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
