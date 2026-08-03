import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

const disclaimer =
  "Information only. Not investment advice. Market data may be delayed, incomplete, or inaccurate. Investing involves risk, including loss of principal.";

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
  assert.match(footerStyles, /font-size: var\(--sr-font-size-sm\)/);
  assert.doesNotMatch(footerStyles, /position:\s*(?:fixed|sticky|absolute)/);
  assert.doesNotMatch(footerStyles, /#[0-9a-f]{3,8}\b/i);
});

test("mobile footer hiding is an explicit opt-in reserved for the company Live Room", () => {
  const shell = read("components/shell/StockRadarAppShell.tsx");
  const shellStyles = read("components/shell/StockRadarAppShell.module.css");
  const companyRoom = read("components/live-room/LiveRoomClient.tsx");
  const communityRoom = read("components/live-room/CommunityRoomClient.tsx");

  assert.match(shell, /hideFooterOnMobile\?: boolean/);
  assert.match(shell, /hideFooterOnMobile = false/);
  assert.match(
    shell,
    /hideFooterOnMobile \? ` \$\{styles\.hideFooterOnMobile\}` : ""/,
  );
  assert.equal(shell.match(/<StockRadarProductFooter \/>/g)?.length, 1);
  assert.match(
    shellStyles,
    /@media \(max-width: 760px\)\s*\{\s*\.hideFooterOnMobile > footer\s*\{\s*display: none;/,
  );
  assert.match(
    companyRoom,
    /<StockRadarAppShell[\s\S]{0,160}activeNavigationItem=\{null\}[\s\S]{0,80}hideFooterOnMobile/,
  );
  assert.doesNotMatch(communityRoom, /hideFooterOnMobile/);
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

test("the shared App Shell hides scrollbar chrome only on mobile", () => {
  const shellStyles = read("components/shell/StockRadarAppShell.module.css");

  assert.match(
    shellStyles,
    /\.shell,\s*\.shell \*\s*\{[\s\S]*?scrollbar-width: thin;/,
  );
  assert.match(
    shellStyles,
    /\.shell ::-webkit-scrollbar\s*\{\s*width: 10px;\s*height: 10px;/,
  );
  assert.match(
    shellStyles,
    /@media \(max-width: 760px\)\s*\{[\s\S]*?:global\(html\):has\(\.shell\),\s*:global\(body\):has\(\.shell\),\s*\.shell,\s*\.shell \*\s*\{[\s\S]*?-ms-overflow-style: none;[\s\S]*?scrollbar-width: none;[\s\S]*?:global\(html\):has\(\.shell\)::-webkit-scrollbar,\s*:global\(body\):has\(\.shell\)::-webkit-scrollbar,\s*\.shell::-webkit-scrollbar,\s*\.shell ::-webkit-scrollbar\s*\{[\s\S]*?display: none;[\s\S]*?width: 0;[\s\S]*?height: 0;/,
  );
  assert.doesNotMatch(
    shellStyles,
    /@media \(max-width: 760px\)[\s\S]*overflow-(?:x|y):\s*(?:hidden|clip)/,
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
    assert.doesNotMatch(read(surface), /StockRadarProductFooter|Information only\./);
  }
});
