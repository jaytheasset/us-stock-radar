import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("product header keeps core tools and replaces horizontal scrolling with More", () => {
  const header = readProjectFile("components/shell/StockRadarProductHeader.tsx");
  const desktop = readProjectFile(
    "components/shell/StockRadarDesktopNavigation.tsx",
  );
  const mobile = readProjectFile(
    "components/shell/StockRadarMobileNavigationMenu.tsx",
  );
  const navigation = readProjectFile(
    "components/shell/stockRadarNavigation.ts",
  );
  const styles = readProjectFile(
    "components/shell/StockRadarProductHeader.module.css",
  );

  assert.match(header, /href="\/dashboard-v2"/);
  assert.match(header, /Markets dashboard/);
  assert.match(header, /<LiveRoomUnreadMenu \/>/);
  assert.match(header, /<AlertNotificationsMenu loginHref=\{loginHref\} \/>/);
  assert.match(header, /<StockRadarTickerSearch/);
  assert.match(header, /<StockRadarThemeToggle \/>/);
  assert.doesNotMatch(header, /Settings|settingsButton/);
  assert.doesNotMatch(mobile, /Settings/);

  for (const key of ["markets", "feed", "watchlist"]) {
    assert.match(navigation, new RegExp(`"${key}"`));
  }
  assert.match(desktop, /aria-haspopup="menu"/);
  assert.match(desktop, /aria-label="More navigation"/);
  assert.match(desktop, /event\.key !== "Escape"/);
  assert.match(desktop, /document\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
  assert.match(styles, /@media \(min-width: 821px\) and \(max-width: 1340px\)/);
  assert.match(
    styles,
    /\.primaryNavigation\s*>\s*a\.navigationSecondary\s*\{\s*display:\s*none/,
  );
  assert.match(styles, /\.moreNavigation\s*\{\s*display:\s*flex/);
  assert.match(styles, /@media \(max-width: 820px\)/);
});

test("mobile menu retains focus, dismissal, and body-scroll safeguards", () => {
  const header = readProjectFile("components/shell/StockRadarProductHeader.tsx");

  assert.match(header, /body\.style\.overflow = "hidden"/);
  assert.match(header, /body\.style\.overflow = previousBodyOverflow/);
  assert.match(header, /body\.style\.paddingRight = previousBodyPaddingRight/);
  assert.match(header, /aria-label="Dashboard actions"[\s\S]{0,100}role="group"/);
  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /event\.key === "Tab"/);
  assert.match(header, /querySelectorAll<HTMLElement>/);
  assert.match(header, /document\.addEventListener\("pointerdown"/);
  assert.match(header, /mobileMenuButtonRef\.current\?\.focus/);
});

test("authenticated account menu reuses canonical routes and shared logout", () => {
  const authStatus = readProjectFile("components/AuthStatus.tsx");
  const memberPage = readProjectFile(
    "app/live/members/[publicProfileId]/page.tsx",
  );
  const memberClient = readProjectFile(
    "components/live-room/PublicMemberProfileClient.tsx",
  );

  for (const label of [
    "View profile",
    "Edit profile",
    "Account settings",
    "Brokerage verification",
    "Manage plan",
    "Log out",
  ]) {
    assert.match(authStatus, new RegExp(label));
  }
  assert.match(authStatus, /\/api\/live-room\/profile/);
  assert.match(authStatus, /`\/live\/members\/\$\{publicProfileId\}`/);
  assert.match(authStatus, /href="\/account"/);
  assert.match(authStatus, /href="\/account\/brokerage"/);
  assert.match(authStatus, /href="\/premium"/);
  assert.match(authStatus, /logoutAndReloadCurrentPage/);
  assert.match(authStatus, /aria-label="Account menu"/);
  assert.match(authStatus, /aria-label="Account actions"[\s\S]{0,100}role="group"/);
  assert.match(authStatus, /event\.key !== "Escape"/);
  assert.match(authStatus, /document\.addEventListener\("pointerdown"/);
  assert.match(memberPage, /query\.edit === "profile"/);
  assert.match(memberClient, /if \(editOnLoad\) setProfileOpen\(true\)/);
});
