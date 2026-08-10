import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./sync-fmp-universe.js", import.meta.url),
  "utf8",
);

test("FMP ticker upsert preserves SEC CIK evidence while refreshing FMP metadata", () => {
  assert.match(
    source,
    /metadata\s*=\s*tickers\.metadata\s*\|\|\s*excluded\.metadata/,
  );
  assert.doesNotMatch(source, /metadata\s*=\s*excluded\.metadata\s*,/);

  const existingMetadata = {
    sec_cik: "0001652044",
    source: "sec",
    provider: "legacy",
    raw: { version: "old" },
  };
  const incomingFmpMetadata = {
    country: "US",
    provider: "fmp",
    raw: { version: "latest" },
  };
  const mergedLikePostgresJsonbConcat = {
    ...existingMetadata,
    ...incomingFmpMetadata,
  };

  assert.equal(mergedLikePostgresJsonbConcat.sec_cik, "0001652044");
  assert.equal(mergedLikePostgresJsonbConcat.provider, "fmp");
  assert.deepEqual(mergedLikePostgresJsonbConcat.raw, { version: "latest" });
  assert.equal(mergedLikePostgresJsonbConcat.country, "US");
});
