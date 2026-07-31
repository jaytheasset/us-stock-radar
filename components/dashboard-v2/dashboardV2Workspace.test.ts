import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

test("Markets uses the established centered 1600px workspace contract", () => {
  const dashboardStyles = read(
    "components/dashboard-v2/StockRadarDashboardV2.module.css",
  );

  assert.match(
    dashboardStyles,
    /\.workspace\s*{[\s\S]*?width: min\(100%, 1600px\);[\s\S]*?margin: 0 auto;/,
  );
  assert.match(
    dashboardStyles,
    /\.dashboard-v2-left\)\s*{[\s\S]*?padding: var\(--sr-space-5\) var\(--sr-page-gutter-desktop\) var\(--sr-space-4-5\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 1320px\)[\s\S]*?\.workspace\s*{\s*grid-template-columns: minmax\(690px, 1fr\) minmax\(390px, 420px\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 1180px\)[\s\S]*?\.workspace\s*{[\s\S]*?grid-template-columns: 1fr;/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dashboard-v2-left\)\s*{\s*padding: var\(--sr-page-gutter-mobile\);/,
  );
});

test("existing 1600px product workspaces remain the read-only reference", () => {
  for (const stylesheet of [
    "components/watchlist-v2/StockRadarWatchlistV2.module.css",
    "components/news-v2/StockRadarNewsV2.module.css",
    "components/filings-v2/StockRadarFilingsV2.module.css",
  ]) {
    const source = read(stylesheet);

    assert.match(source, /width: min\(100%, 1600px\);/);
    assert.match(source, /margin: 0 auto;/);
  }
});
