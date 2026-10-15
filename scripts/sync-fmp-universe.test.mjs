import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
test("retired FMP CLI cannot fetch or overwrite SEC ticker metadata", () => {
  assert.equal(existsSync(new URL("./sync-fmp-universe.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("./verify-stock-fundamentals-live.mjs", import.meta.url)), false);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.equal(scripts["sync:market-universe"], undefined);
  assert.equal(scripts["sync:etf-universe"], undefined);
});
