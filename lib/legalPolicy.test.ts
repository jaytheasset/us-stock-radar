import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

test("root permanently redirects to the current Markets route", () => {
  const rootPage = read("app/page.tsx");

  assert.match(rootPage, /permanentRedirect\(\"\/dashboard-v2\"\)/);
  assert.doesNotMatch(rootPage, /FeedShell|getLiveFeedViewModel/);
});

test("legacy feed UI is removed without deleting live-feed data or compatibility routes", () => {
  const globalStyles = read("app/globals.css");

  assert.equal(existsSync(path.join(projectRoot, "components/FeedShell.tsx")), false);
  assert.equal(
    existsSync(path.join(projectRoot, "components/FeedCandleChart.tsx")),
    false,
  );
  assert.equal(existsSync(path.join(projectRoot, "lib/liveFeed.ts")), true);

  assert.match(read("app/feed/page.tsx"), /StockRadarFeedV2/);
  assert.match(read("app/feed-v2/page.tsx"), /redirect\(\"\/feed\"\)/);
  assert.match(read("app/dashboard-v2/page.tsx"), /StockRadarDashboardV2/);

  for (const retiredSelector of [
    "feed-layout",
    "feed-row",
    "feed-sidebar",
    "candle-chart",
    "situation-card",
    "market-pulse-card",
  ]) {
    assert.doesNotMatch(globalStyles, new RegExp(`\\.${retiredSelector}\\b`));
  }

  assert.match(globalStyles, /\.feed-nav\s*\{/);
  assert.match(globalStyles, /\.brand-lockup\s*\{/);
});

test("legal pages use the current shell, dates, cross-links, and complete policy anchors", () => {
  const terms = read("app/terms/page.tsx");
  const privacy = read("app/privacy/page.tsx");
  const sharedDocument = read("components/legal/LegalDocument.tsx");
  const policyConfig = read("lib/legalPolicy.ts");

  for (const source of [terms, privacy]) {
    assert.match(source, /StockRadarAppShell/);
    assert.match(source, /themeMode="user-selectable"/);
    assert.doesNotMatch(source, /brand-lockup|brand-mark|being prepared/i);
  }

  for (const anchor of [
    "acceptance-eligibility",
    "market-information",
    "community-content",
    "verification",
    "brokerage",
    "plans",
    "third-parties",
    "intellectual-property",
    "suspension-termination",
    "disclaimers",
    "changes",
    "contact",
  ]) {
    assert.match(terms, new RegExp(`id: \"${anchor}\"`));
  }

  for (const anchor of [
    "information-collected",
    "sources",
    "purposes",
    "public-private",
    "service-providers",
    "snaptrade",
    "advertising",
    "retention",
    "security",
    "choices-rights",
    "children",
    "international",
    "changes",
    "contact",
  ]) {
    assert.match(privacy, new RegExp(`id: \"${anchor}\"`));
  }

  assert.match(terms, /at least 18 years old/);
  assert.match(terms, /not a broker-dealer, investment adviser/);
  assert.match(terms, /does not place orders, execute trades, hold assets, or/);
  assert.match(privacy, /does not sell personal information for money/);
  assert.match(privacy, /California residents may/);
  assert.match(privacy, /The Service is for adults age 18 and older/);
  assert.match(privacy, /International processing/);
  assert.match(privacy, /Supabase/);
  assert.match(privacy, /Vercel/);
  assert.match(privacy, /SnapTrade/);
  assert.match(privacy, /Web Push/);
  assert.match(sharedDocument, /href="\/dashboard-v2"/);
  assert.match(sharedDocument, /effectiveDate/);
  assert.match(sharedDocument, /updatedDate/);
  assert.match(policyConfig, /July 30, 2026/g);
  assert.match(policyConfig, /Counsel must review/);
});

test("legal layout has responsive, theme-token-only overflow protection", () => {
  const styles = read("components/legal/LegalDocument.module.css");

  assert.match(styles, /@media \(max-width: 960px\)/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /min-width: 0/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
});
