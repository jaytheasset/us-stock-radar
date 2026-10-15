import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import * as integrations from "./integrations.ts";
import { getServerEnv, envStatus } from "./env.ts";
import { sourceIngestAuthResponse } from "./sourceIngestRouteAuth.ts";
import { fetchSecTenderDevFmpMarketContext } from "./sources/sec/forms/tender/devMarketContext.ts";
import { deriveMarketRangeMovement } from "./marketChartMovement.ts";
import { fetchStockFundamentals } from "./watchlist/stockFundamentalsServer.ts";
import { normalizeStockTicker } from "./watchlist/stockOverview.ts";
import { loadAnalysisPeerProviderCompanies } from "./analysisPeerProvider.ts";
import { refreshMarketPulseCache } from "./marketPulseRefresh.ts";
import { resolveDashboardV2MoverObservation } from "./dashboardV2MoverObservation.ts";

// Execute the actual handlers without a server, provider, DB or persistent cache.
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const source = readFileSync(path.resolve(file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    URL,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    process,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    require(name: string) {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `unexpected dependency: ${name}`,
      );
      return dependencies[name];
    },
  });
  return exports;
}

async function withEnv(
  values: Record<string, string>,
  run: () => Promise<void>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("leftover FMP credentials and batch flags cannot activate integrations or helpers", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected network");
  });
  await withEnv(
    {
      FMP_API_KEY: "retired-test-key",
      FMP_BATCH_QUOTE_ENABLED: "true",
      POLYGON_API_KEY: "",
    },
    async () => {
      for (const call of [
        () => integrations.fetchFmpQuote("AMD"),
        () => integrations.fetchFmpQuotes(["AMD", "AAPL"]),
        () => integrations.fetchFmpProfile("AMD"),
        () => integrations.fetchFmpSharesFloat("AMD"),
        () => integrations.fetchFmpDailyBars("AMD"),
        () => integrations.probeFmp(),
      ]) {
        const result = await call();
        assert.equal(result.ok, false);
        assert.equal(result.status, 410);
        assert.equal(result.error, "FMP_RETIRED");
      }
      assert.equal((await integrations.fetchDailyBars("AMD")).ok, false);
      assert.equal((await loadAnalysisPeerProviderCompanies(["AMD"])).size, 0);
      const pulse = await refreshMarketPulseCache();
      assert.equal(pulse.ok, false);
      assert.deepEqual(pulse.refreshed, []);
      assert.ok(pulse.unavailable.some(item => item.symbol === "^DJI" && item.error === "FMP_RETIRED"));
      const context = await fetchSecTenderDevFmpMarketContext("AMD", {
        apiKey: "retired-test-key",
      });
      assert.equal(context.ok, false);
      assert.equal(context.market_context, null);
      assert.equal("fmpApiKey" in getServerEnv(), false);
      assert.equal(JSON.stringify(envStatus()).includes("FMP"), false);
      assert.equal(calls, 0);
    },
  );
});

test("retired direct APIs return unavailable and calendar auth still fails closed", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected network");
  });
  await withEnv(
    {
      SOURCE_INGEST_INTERNAL_SECRET: "retirement-test-secret",
      CRON_SECRET: "",
      FMP_API_KEY: "retired-test-key",
    },
    async () => {
      for (const kind of ["quote", "profile", "shares-float"]) {
        const route = load(`app/api/market/fmp/${kind}/route.ts`, {
          "next/server": { NextRequest, NextResponse },
          "@/lib/integrations": integrations,
        });
        const response = await route.GET(
          new NextRequest(`http://localhost/api/market/fmp/${kind}?symbol=AMD`),
        );
        assert.equal(response.status, 410);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.data, null);
      }
      for (const name of ["fmp-calendar", "fmp-economic-calendar"]) {
        const route = load(`app/api/sources/${name}/ingest/route.ts`, {
          "next/server": { NextRequest, NextResponse },
          "@/lib/sourceIngestRouteAuth": { sourceIngestAuthResponse },
        });
        for (const method of ["GET", "POST"]) {
          for (const authorization of [
            "",
            "Bearer wrong",
            "Bearer retirement-test-secret",
          ]) {
            const request = new NextRequest(
              `http://localhost/api/sources/${name}/ingest?dryRun=false&persist=true`,
              { method, headers: { authorization } },
            );
            request.json = async () => {
              throw new Error("retired route must not read the body");
            };
            const response = await route[method](request);
            assert.equal(
              response.status,
              authorization.endsWith("retirement-test-secret") ? 410 : 401,
            );
            assert.equal((await response.json()).ok, false);
          }
        }
      }
      const chart = load("app/api/dashboard-v2/chart/route.ts", {
        "next/server": { NextRequest, NextResponse },
      });
      const response = await chart.GET(
        new NextRequest(
          "http://localhost/api/dashboard-v2/chart?symbol=AMD&range=1D",
        ),
      );
      assert.equal(response.status, 410);
      assert.equal((await response.json()).ok, false);
      assert.equal(calls, 0);
    },
  );
});

test("regular movers cannot revive saved FMP snapshots", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected network");
  });
  const source = readFileSync("app/api/dashboard-v2/movers/route.ts", "utf8");
  const dependencies: Record<string, unknown> = {};
  for (const match of source.matchAll(/from "([^"]+)"/g))
    dependencies[match[1]] = {};
  Object.assign(dependencies, {
    "next/server": { NextRequest, NextResponse },
    "next/cache": { unstable_cache: (fn: unknown) => fn },
    "@/lib/dashboardV2Types": {
      dashboardV2Sessions: ["Pre", "Regular", "After"],
    },
    "@/lib/dashboardV2ExtendedMovers": {
      dashboardV2MoverModes: ["gainers", "losers", "active"],
    },
    "@/lib/dashboardV2MoverLifecycle": {
      getDashboardMoverLifecycle: () => ({ phase: "active" }),
    },
    "@/lib/env": {
      getServerEnv: () => {
        throw new Error("retired regular session must not read credentials");
      },
    },
  });
  const route = load("app/api/dashboard-v2/movers/route.ts", dependencies);
  const response = await route.GET(
    new NextRequest(
      "http://localhost/api/dashboard-v2/movers?session=Regular&mode=gainers",
    ),
  );
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.equal(body.error, "FMP_RETIRED");
  assert.deepEqual(body.rows, []);
  const observation = resolveDashboardV2MoverObservation({ httpStatus: 410, moverTab: "Top Gainers", renderedResultCount: 0, requestState: "received", response: body, session: "Regular" });
  assert.equal(observation.status, "unavailable");
  assert.equal(observation.renderTitle, "Market data unavailable");
  assert.equal(observation.renderMessage.includes("FMP_RETIRED"), false);
  assert.equal(calls, 0);
});

test("market chart keeps Polygon success but never falls back to FMP on failure", async (t) => {
  const requests: string[] = [];
  let succeeds = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    requests.push(String(input));
    return succeeds
      ? Response.json({
          results: [{ t: 1700000000000, o: 10, h: 12, l: 9, c: 11, v: 100 }],
        })
      : new Response("unavailable", { status: 503 });
  });
  const route = load("app/api/market/chart/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/env": {
      getServerEnv: () => ({
        polygonApiKey: "existing-polygon-test-key",
        fmpApiKey: "leftover-retired-key",
      }),
    },
    "@/lib/marketDataCache": {
      chartIntervalForRange: () => "1day",
      readMarketBarCache: async () => ({ hit: false }),
      readMarketQuoteCache: async () => ({ hit: false }),
      writeMarketBarCache: async () => ({ ok: true }),
    },
    "@/lib/marketChartMovement": { deriveMarketRangeMovement },
    "@/lib/marketRequestCoalescing": {
      marketChartRequestKey: () => "test",
      coalesceMarketChartRequest: (_key: string, fn: () => unknown) => fn(),
    },
  });
  const request = () =>
    new NextRequest(
      "http://localhost/api/market/chart?symbol=AMD&range=1Y&refresh=1",
    );
  const failure = await route.GET(request());
  assert.equal(failure.status, 502);
  assert.equal((await failure.json()).ok, false);
  assert.equal(requests.length, 1);
  succeeds = true;
  const success = await route.GET(request());
  assert.equal(success.status, 200);
  const body = await success.json();
  assert.equal(body.provider, "polygon");
  assert.equal(body.latestPrice, 11);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every((url) => new URL(url).hostname === "api.polygon.io"),
  );
});

test("shared current quote and bar caches reject FMP rows and preserve other providers", async () => {
  let provider = "fmp";
  const cache = load("lib/marketDataCache.ts", {
    "@/lib/supabase": {
      supabaseSelect: async () => ({
        ok: true,
        data: [
          {
            symbol: "AMD",
            provider,
            price: 10,
            bars: [
              {
                time: "2026-10-01",
                open: 10,
                high: 10,
                low: 10,
                close: 10,
                volume: 100,
                vwap: 10,
              },
            ],
          },
        ],
      }),
    },
  });
  for (const name of [
    "readMarketQuoteCache",
    "readMarketQuoteProviderCache",
    "readMarketBarCache",
  ]) {
    assert.equal((await cache[name]("AMD", "1D")).hit, false);
  }
  assert.equal((await cache.readMarketQuoteCacheMap(["AMD"])).size, 0);
  assert.equal((await cache.readMarketBarCacheMap(["AMD"], "1D")).size, 0);
  provider = "polygon";
  assert.equal((await cache.readMarketQuoteCache("AMD")).hit, true);
  assert.equal((await cache.readMarketBarCache("AMD", "1D")).hit, true);
});

test("FMP live clients and CLIs are absent; SEC identity has no FMP lookup fallback", () => {
  for (const file of [
    "fmpCalendarClient",
    "fmpEconomicCalendarClient",
    "fmpCalendarIngest",
    "fmpEconomicCalendarIngest",
  ]) {
    assert.equal(existsSync(`lib/calendar-v1/${file}.ts`), false);
  }
  for (const file of [
    "lib/sources/sec/parser.ts",
    "lib/ai/secFilingAnalysisPreview.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /financialmodelingprep|fetchFmp|resolveFmpCusip|fmpApiKey/,
    );
  }
});

test("fundamentals API preserves unavailable data and cannot cache a successful response", async () => {
  const route = load("app/api/market/fmp/fundamentals/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/watchlist/stockFundamentalsServer": { fetchStockFundamentals },
    "@/lib/watchlist/stockOverview": { normalizeStockTicker },
  });
  const response = await route.GET(new NextRequest("http://localhost/api/market/fmp/fundamentals?symbol=AMD"));
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.data.ownership.institutionalSummary, null);
  assert.equal(body.data.sources.institutionalOwnership.state, "unavailable");
});

test("news market context does not persist null FMP results or claim a fresh observation", async () => {
  let writes = 0;
  const context = load("lib/newsMarketContext.ts", {
    "@/lib/integrations": integrations,
    "@/lib/marketDataCache": { writeMarketQuoteCache: async () => { writes++; } },
    "@/lib/supabase": { supabaseSelect: async () => ({ ok: true, data: [] }), supabaseUpsert: async () => { writes++; } },
  });
  const result = await context.resolveNewsPromptMarketContext(["AMD"], { refresh: true, persist: true });
  assert.equal(writes, 0);
  assert.equal(result.available, false);
  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].as_of, null);
});

test("movers cron skips retired Regular collection and keeps existing extended sessions", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    requests.push(input.searchParams.get("session")!);
    return Response.json({ ok: true, freshness: "final" });
  });
  const route = load("app/api/cron/dashboard-movers/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/dashboardV2Types": { dashboardV2Sessions: ["Pre", "Regular", "After"] },
    "@/lib/dashboardV2MoverLifecycle": { getDashboardMoverLifecycle: () => ({}), isDashboardMoverFinalizationEligible: () => true },
    "@/lib/prelaunchInternalAccess": { prelaunchInternalRequestHeaders: () => ({}) },
  });
  await withEnv({ DASHBOARD_MOVERS_CRON_SECRET: "retirement-cron-test" }, async () => {
    const response = await route.GET(new NextRequest("http://localhost/api/cron/dashboard-movers", { headers: { authorization: "Bearer retirement-cron-test" } }));
    assert.equal(response.status, 200);
    assert.deepEqual(requests.sort(), ["After", "Pre"]);
  });
});
