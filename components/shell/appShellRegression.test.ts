import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

const disclaimer =
  "Information only — not investment advice. Market data may be delayed, incomplete, or inaccurate. Investing involves risk, including loss of principal.";

test("the shared App Shell renders one compact market-information footer", () => {
  const shell = read("components/shell/StockRadarAppShell.tsx");
  const footer = read("components/shell/StockRadarProductFooter.tsx");
  const normalizedFooter = footer.replace(/\s+/g, " ");

  assert.equal(shell.match(/<StockRadarProductFooter \/>/g)?.length, 1);
  assert.ok(shell.indexOf("</main>") < shell.indexOf("<StockRadarProductFooter />"));
  assert.match(footer, /<footer/);
  assert.match(footer, /aria-label="Market information disclaimer"/);
  assert.match(normalizedFooter, new RegExp(disclaimer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(footer, /href="\/terms#market-information"/);
  assert.match(footer, />Full disclaimer<\/Link>/);
});

test("the shared footer stays in normal flow and uses only Stock Radar tokens", () => {
  const shellStyles = read("components/shell/StockRadarAppShell.module.css");
  const footerStyles = read("components/shell/StockRadarProductFooter.module.css");

  assert.match(shellStyles, /\.shell\s*{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
  assert.match(shellStyles, /\.main\s*{[\s\S]*?flex: 1 0 auto;/);
  assert.match(footerStyles, /\.footer\s*{[\s\S]*?flex: 0 0 auto;/);
  assert.match(footerStyles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(footerStyles, /position:\s*(?:fixed|sticky|absolute)/);
  assert.doesNotMatch(footerStyles, /#[0-9a-f]{3,8}\b/i);
});

test("extra-small viewports release the legacy 320px document minimum", () => {
  const globalStyles = read("app/globals.css");

  assert.match(
    globalStyles,
    /html,\s*body\s*\{[\s\S]*?min-width: 320px;[\s\S]*?margin: 0;[\s\S]*?\}/,
  );
  assert.match(
    globalStyles,
    /@media \(max-width: 360px\)\s*\{[\s\S]*?html,\s*body\s*\{[\s\S]*?min-width: 0;[\s\S]*?\}/,
  );
  assert.doesNotMatch(
    globalStyles,
    /@media \(max-width: 360px\)\s*\{[\s\S]{0,160}overflow-x:\s*(?:hidden|clip)/,
  );
});

test("auth-only and admin routes remain outside the shared App Shell", () => {
  for (const route of [
    "app/login/page.tsx",
    "app/signup/page.tsx",
    "app/forgot-password/page.tsx",
    "app/auth/callback/page.tsx",
    "app/account/update-password/page.tsx",
    "app/admin/layout.tsx",
  ]) {
    assert.doesNotMatch(read(route), /StockRadarAppShell|StockRadarProductFooter/);
  }
});

test("the footer is not duplicated in the header or Live Room surfaces", () => {
  for (const surface of [
    "components/shell/StockRadarProductHeader.tsx",
    "components/live-room/LiveRoomClient.tsx",
    "components/live-room/CommunityRoomClient.tsx",
  ]) {
    assert.doesNotMatch(read(surface), /StockRadarProductFooter|Information only —/);
  }
});
