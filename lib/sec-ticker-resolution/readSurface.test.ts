import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

const adminPage = read("app/admin/data/ticker-resolution/page.tsx");
const secPage = read("app/development/sec/TickerResolutionEvidence.tsx");
const secClient = read("app/development/sec/SecDevelopmentClient.tsx");
const secRoute = read("app/api/development/sec-form-room/route.ts");

test("admin resolution page uses system.read and the official validated reader", () => {
  assert.match(adminPage, /requireAdminPermission\("system\.read"\)/);
  assert.match(adminPage, /listSecTickerResolutions/);
  assert.match(adminPage, /readSecTickerResolutionByDecisionId/);
  assert.match(adminPage, /Read only/);
  assert.doesNotMatch(adminPage, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("SEC console keeps ticker resolution in a separate read-only tab", () => {
  assert.match(secClient, /\["resolution", "Ticker Resolution"\]/);
  assert.match(secClient, /tab !== "filing-ui" && tab !== "resolution"/);
  assert.match(secClient, /TickerResolutionEvidence/);
  assert.match(
    secClient,
    /function isTabKey[\s\S]*?"filing-ui",\s*"resolution",[\s\S]*?\.includes\(value\)/,
  );
  assert.match(secPage, /independently of site AI analysis results/);
  assert.match(secPage, /sourceDocument/);
  assert.match(secPage, /sourceSha256/);
  assert.match(secPage, /<dt>Source URL<\/dt>/);
  assert.match(secPage, /tradingSymbolStatus/);
  assert.doesNotMatch(secPage, /fetch\([^)]*\{[\s\S]*method:\s*"(POST|PUT|PATCH|DELETE)"/);
});

test("resolution API is development-only, system.read guarded, exact-ID bound, and GET-only", () => {
  assert.match(secRoute, /process\.env\.NODE_ENV === "production"/);
  assert.match(secRoute, /respondWithAdminReadAccess\(request, "system\.read"/);
  assert.match(secRoute, /readSecTickerResolutionByDecisionId\(\{ decisionId: resolutionId \}\)/);
  assert.match(secRoute, /view === "resolution"/);
  assert.match(secRoute, /resolution\.reason === "invalid_decision_id"/);
  assert.doesNotMatch(secRoute, /export async function (POST|PUT|PATCH|DELETE)/);
});
