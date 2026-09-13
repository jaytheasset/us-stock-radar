import assert from "node:assert/strict";
import {
  readSecTickerProductProjectionForTicker,
  readSecTickerSourceFiling,
} from "../lib/sec-ticker-resolution/productProjection.ts";
import { supabaseSelect } from "../lib/supabase.ts";

const verificationNow = new Date("2026-09-13T00:00:00.000Z");
const expectedSources = [
  ["2026-09-11", "BTLN", "8-K", "0001493152-26-042421"],
  ["2026-08-19", "GGRP", "8-K", "0001493152-26-039128"],
  ["2026-05-14", "GGRP", "10-Q", "0001493152-26-023049"],
  ["2026-02-17", "VRAR", "10-Q", "0001493152-26-006951"],
] as const;

const projections = await Promise.all(
  ["VRAR", "GGRP", "BTLN"].map((ticker) =>
    readSecTickerProductProjectionForTicker({ ticker, now: verificationNow })),
);

for (const projection of projections) {
  assert.equal(
    projection.status,
    "available",
    projection.status === "unavailable" ? projection.reason : projection.status,
  );
  if (projection.status !== "available") continue;
  assert.equal(projection.currentTicker, "BTLN");
  assert.equal(projection.issuerCik, "0001854445");
  assert.deepEqual(projection.historicalTickers, ["VRAR", "GGRP"]);
  assert.deepEqual(
    projection.sourceFilings.map((filing) => [
      filing.filedDate,
      filing.historicalTicker,
      filing.formType,
      filing.accessionNumber,
    ]),
    expectedSources,
  );
}

const current = projections[2];
assert.equal(current?.status, "available");
if (current?.status === "available") {
  for (const source of current.sourceFilings) {
    const match = source.detailHref.match(
      /^\/filings\/source\/([0-9a-f-]{36})\/(before|after)$/,
    );
    assert.ok(match);
    const detail = await readSecTickerSourceFiling({
      decisionId: match[1]!,
      side: match[2] as "before" | "after",
      now: verificationNow,
    });
    assert.deepEqual(detail, source);
  }
}

const warrant = await readSecTickerProductProjectionForTicker({
  ticker: "VEEAW",
  now: verificationNow,
});
assert.equal(warrant.status, "not_found");

for (const [table, key] of [["events", "id"], ["event_analysis", "event_id"]] as const) {
  const result = await supabaseSelect(table, { select: key, limit: "1" });
  assert.equal(result.ok, true, `${table} read must be available`);
  assert.deepEqual(result.data, [], `${table} must remain empty in the isolated database`);
}

console.log(JSON.stringify({
  currentTicker: "BTLN",
  historicalTickers: ["VRAR", "GGRP"],
  sourceFilings: expectedSources.length,
  status: "ok",
  syntheticEventRows: 0,
  warrantLinked: false,
}));
