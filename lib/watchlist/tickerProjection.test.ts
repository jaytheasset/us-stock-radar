import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createWatchlistProjectionReader, projectWatchlistViewModel } from "./tickerProjection.ts";
import { displayedWatchlistTicker, selectWatchlistItem, watchlistItemMatchesTicker } from "./tickerProjectionModel.ts";
import { getGuestWatchlistViewModel } from "./getWatchlistViewModel.ts";
import { readIssuerBoundPublicStockTickerProjection } from "../sec-ticker-resolution/publicTickerSearch.ts";
import { assertWatchlistLimit } from "./watchlistValidation.ts";
import { PLAN_LIMITS, type Plan } from "../subscriptionPolicy.ts";

const projection = {
  status: "available" as const,
  currentTicker: "BTLN",
  historicalTickers: ["VRAR", "GGRP"],
  issuerCik: "0001854445",
  sourceFilings: [],
};
const row = (ticker: string) => ({ id: `row-${ticker}`, ticker, companyName: "Saved company", createdAt: "2026-08-19", updatedAt: "2026-08-19" });
const base = { ...getGuestWatchlistViewModel(), guestMode: false, items: [row("GGRP")], usage: 1 };

test("read projection preserves every original row field and membership follows verified aliases", async () => {
  const original = structuredClone(base);
  const result = await projectWatchlistViewModel(base, "VRAR", createWatchlistProjectionReader(async () => projection));
  assert.deepEqual(base, original);
  assert.deepEqual(Object.fromEntries(Object.keys(base.items[0]!).map(key => [key, (result.items[0] as unknown as Record<string, unknown>)[key]])), base.items[0]);
  assert.equal(displayedWatchlistTicker(result.items[0]!), "BTLN");
  for (const ticker of ["VRAR", "GGRP", "BTLN"]) assert.equal(watchlistItemMatchesTicker(result.items[0]!, ticker), true);
  assert.equal(result.selection?.requestedTicker, "VRAR");
});

test("both saved rows remain visible, conflict is explicit, selection prefers the exact original", async () => {
  const result = await projectWatchlistViewModel({ ...base, items: [row("GGRP"), row("BTLN")], usage: 2 }, null, createWatchlistProjectionReader(async () => projection));
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.projectionConflict), [["BTLN"], ["GGRP"]]);
  assert.equal(selectWatchlistItem(result.items, "GGRP")?.id, "row-GGRP");
  assert.equal(selectWatchlistItem(result.items, "BTLN")?.id, "row-BTLN");
});

test("not_found is literal, and VEEA / VEEAW are never matched by spelling or issuer", async () => {
  const result = await projectWatchlistViewModel({ ...base, items: [row("VEEA"), row("VEEAW")] }, null, createWatchlistProjectionReader(async () => ({ status: "not_found" })));
  assert.deepEqual(result.items.map(displayedWatchlistTicker), ["VEEA", "VEEAW"]);
  assert.equal(watchlistItemMatchesTicker(result.items[0]!, "VEEAW"), false);
  assert.deepEqual(result.items.map(item => item.projectionConflict), [[], []]);
});

test("unavailable reads reject strict additions; they cannot become no-match permission", async () => {
  const read = createWatchlistProjectionReader(async () => ({ status: "unavailable", reason: "network_failed" }));
  await assert.rejects(read("GGRP"), /verification is unavailable/);
  await assert.rejects(projectWatchlistViewModel(base, "BTLN", read));
});

test("per-fetch reader cannot retain an earlier effective result after rejection or withdrawal", async () => {
  let effective = true;
  const readProjection = async () => effective ? projection : { status: "not_found" as const };
  assert.equal((await createWatchlistProjectionReader(readProjection)("GGRP")).currentTicker, "BTLN");
  effective = false;
  assert.equal((await createWatchlistProjectionReader(readProjection)("GGRP")).currentTicker, "GGRP");
  effective = true;
  assert.equal((await createWatchlistProjectionReader(readProjection)("GGRP")).currentTicker, "BTLN");
});

test("one fetch reuses the already verified component across saved and current aliases", async () => {
  let reads = 0;
  const read = createWatchlistProjectionReader(async () => { reads += 1; return projection; });
  for (const ticker of ["GGRP", "BTLN", "VRAR"]) await read(ticker);
  assert.equal(reads, 1);
});

test("current symbol belonging to another catalog issuer blocks the existing bound adapter", async () => {
  const read = createWatchlistProjectionReader(async ({ ticker }) => {
    const bound = await readIssuerBoundPublicStockTickerProjection(ticker, {
      readProjection: async () => projection,
      fetchCompanyTickers: async () => ({ ok: true, status: 200, count: 1, error: undefined, data: [{ ticker: "BTLN", title: "Different issuer", cik_str: 9999999 }] }),
    });
    return bound.status === "available" ? bound.projection : bound;
  });
  await assert.rejects(read("GGRP"));
});

test("the actual plan contract currently permits unlimited watchlist rows on every plan", () => {
  for (const plan of Object.keys(PLAN_LIMITS) as Plan[]) {
    assert.equal(PLAN_LIMITS[plan].watchlistLimit, null);
    assert.doesNotThrow(() => assertWatchlistLimit(plan, 500));
  }
});

test("shared default reader and delete remain literal; common buttons check unsuccessful adds", () => {
  const plain = readFileSync(new URL("./getWatchlistViewModel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(plain, /tickerProjection|currentTicker/);
  const remove = readFileSync(new URL("../../app/api/watchlist/[ticker]/route.ts", import.meta.url), "utf8");
  assert.match(remove, /user_id: `eq\.\$\{userId\}`,[\s\S]*ticker: `eq\.\$\{ticker\}`/);
  const button = readFileSync(new URL("../../components/actions/WatchlistButton.tsx", import.meta.url), "utf8");
  assert.match(button, /!response\.ok \|\| payload\.ok === false/);
  assert.match(button, /encodeURIComponent\(normalizedTicker\)/);
});
