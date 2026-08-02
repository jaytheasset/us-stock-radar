import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("product header measures available desktop space before moving links into More", () => {
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
  assert.match(header, /aria-label=\{`\$\{stockRadarProductName\} 홈`\}/);
  assert.match(header, /className=\{styles\.brandFull\}/);
  assert.match(header, /className=\{styles\.brandMonogram\}/);
  assert.match(header, /<LiveRoomUnreadMenu \/>/);
  assert.match(header, /<AlertNotificationsMenu loginHref=\{loginHref\} \/>/);
  assert.match(header, /<StockRadarTickerSearch/);
  assert.match(header, /<StockRadarThemeToggle \/>/);
  assert.match(header, /showThemeToggle=\{showThemeToggle\}/);
  assert.match(mobile, /className=\{styles\.mobileMenuTheme\}/);
  assert.match(mobile, /<StockRadarThemeToggle \/>/);
  assert.doesNotMatch(header, /Settings|settingsButton/);
  assert.doesNotMatch(mobile, /Settings/);

  for (const key of [
    "markets",
    "feed",
    "watchlist",
    "news",
    "filings",
    "alerts",
    "calendar",
    "premium",
  ]) {
    assert.match(navigation, new RegExp(`"${key}"`));
  }
  assert.match(desktop, /navigation\.getBoundingClientRect\(\)/);
  assert.match(desktop, /actions\.getBoundingClientRect\(\)/);
  assert.match(desktop, /measurementItemRefs\.current\.map/);
  assert.match(desktop, /measurementMoreRef/);
  assert.match(desktop, /new ResizeObserver\(measure\)/);
  assert.match(desktop, /getVisibleNavigationItemCount/);
  assert.match(desktop, /moreNavigationItems\.length > 0 \? \(/);
  assert.match(desktop, /aria-haspopup="menu"/);
  assert.match(desktop, /aria-label="More navigation"/);
  assert.match(desktop, /event\.key !== "Escape"/);
  assert.match(desktop, /document\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
  assert.match(styles, /@media \(min-width: 821px\) and \(max-width: 1340px\)/);
  assert.match(
    styles,
    /\.moreNavigation\s*\{[\s\S]*?display:\s*flex[\s\S]*?\}/,
  );
  assert.match(
    styles,
    /\.primaryNavigation > a,\s*\.navigationMeasurementItem,\s*\.moreNavigationButton\s*\{[\s\S]*?height: var\(--sr-size-nav-item\);[\s\S]*?border-radius: var\(--sr-radius-sm\);[\s\S]*?padding: 0 var\(--sr-space-2-25\);[\s\S]*?font-size: var\(--sr-font-size-md\);[\s\S]*?font-weight: var\(--sr-font-weight-nav\);/,
  );
  assert.match(
    styles,
    /\.moreNavigationButton\s*\{[\s\S]*?border-color: var\(--sr-color-product-accent-border\);[\s\S]*?color: var\(--sr-color-product-accent\);[\s\S]*?background: var\(--sr-color-product-accent-selected\);[\s\S]*?box-shadow: inset 0 -1px 0 var\(--sr-color-product-accent-nav-line\);/,
  );
  assert.match(
    styles,
    /\.moreNavigationButton\[aria-expanded="true"\] svg\s*\{\s*transform: rotate\(180deg\);/,
  );
  assert.match(
    styles,
    /\.moreNavigationMenu\s*\{[\s\S]*?border: var\(--sr-border-width\) solid var\(--sr-color-border-product-menu\);[\s\S]*?border-radius: var\(--sr-radius-popover\);[\s\S]*?background:[\s\S]*?var\(--sr-color-surface-product-menu\);[\s\S]*?box-shadow: var\(--sr-shadow-product-menu\);/,
  );
  assert.match(
    styles,
    /\.moreNavigationMenu a\s*\{[\s\S]*?min-height: 36px;[\s\S]*?border-radius: var\(--sr-radius-action\);[\s\S]*?padding: 0 var\(--sr-space-3\);[\s\S]*?font-size: var\(--sr-font-size-md\);/,
  );
  assert.doesNotMatch(styles, /navigationSecondary/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*\.brandFull,[\s\S]*\.headerThemeToggle\s*\{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*\.brand \.brandMonogram\s*\{[\s\S]*display: inline-flex;[\s\S]*width: 30px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*\.mobileMenuTheme\s*\{[\s\S]*display: flex;/,
  );
});

test("desktop measurement waits until the sibling actions ref is attached", () => {
  const header = readProjectFile("components/shell/StockRadarProductHeader.tsx");
  const desktop = readProjectFile(
    "components/shell/StockRadarDesktopNavigation.tsx",
  );

  assert.match(header, /const actionsRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(header, /<StockRadarDesktopNavigation[\s\S]*actionsRef=\{actionsRef\}/);
  assert.match(
    header,
    /className=\{styles\.actions\}[\s\S]{0,80}ref=\{actionsRef\}/,
  );
  assert.match(
    desktop,
    /useEffect\(\(\) => \{[\s\S]{0,240}const actions = actionsRef\.current;/,
  );
  assert.doesNotMatch(desktop, /useLayoutEffect/);
});

test("mobile menu retains focus, dismissal, and body-scroll safeguards", () => {
  const header = readProjectFile("components/shell/StockRadarProductHeader.tsx");
  const styles = readProjectFile(
    "components/shell/StockRadarProductHeader.module.css",
  );

  assert.match(header, /body\.style\.overflow = "hidden"/);
  assert.match(header, /body\.style\.overflow = previousBodyOverflow/);
  assert.match(header, /body\.style\.paddingRight = previousBodyPaddingRight/);
  assert.match(header, /aria-label="Dashboard actions"[\s\S]{0,100}role="group"/);
  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /event\.key === "Tab"/);
  assert.match(header, /querySelectorAll<HTMLElement>/);
  assert.match(header, /document\.addEventListener\("pointerdown"/);
  assert.match(header, /mobileMenuButtonRef\.current\?\.focus/);
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*\.mobileMenuList a,[\s\S]*?min-height: 40px;[\s\S]*?font-size: 16px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*\.mobileMenuAccount :global\(\.auth-link-secondary\),[\s\S]*?min-height: 40px;[\s\S]*?font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*\.mobileMenuAccount :global\(\.auth-user-pill strong\),[\s\S]*?\.mobileMenuAccount :global\(\.auth-account-popover button\)\s*\{\s*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styles,
    /\.header \.desktopAccount :global\(\.auth-link-secondary\),[\s\S]*?font-size: var\(--sr-font-size-sm\);/,
  );
});

test("mobile alert and search panels use isolated elevated surfaces and dismissible backdrops", () => {
  const tokens = readProjectFile("app/stock-radar-tokens.css");
  const search = readProjectFile(
    "components/shell/StockRadarTickerSearch.tsx",
  );
  const headerStyles = readProjectFile(
    "components/shell/StockRadarProductHeader.module.css",
  );
  const alerts = readProjectFile(
    "components/shell/AlertNotificationsMenu.tsx",
  );
  const alertStyles = readProjectFile(
    "components/shell/AlertNotificationsMenu.module.css",
  );

  assert.match(
    tokens,
    /--sr-color-surface-product-popover-elevated: #18212a;/,
  );
  assert.match(
    tokens,
    /--sr-color-border-product-popover-elevated: rgba\(104, 116, 130, 0\.28\);/,
  );
  assert.match(
    tokens,
    /--sr-color-backdrop-product-popover-mobile: rgba\(3, 5, 8, 0\.38\);/,
  );

  assert.match(
    search,
    /aria-hidden="true"[\s\S]{0,120}className=\{styles\.globalSearchBackdrop\}[\s\S]{0,120}onClick=\{\(\) => closeSearch\(true\)\}/,
  );
  assert.match(search, /role="dialog"/);
  assert.match(search, /event\.key === "Escape"/);
  assert.match(
    headerStyles,
    /\.globalSearchBackdrop\s*\{\s*display: none;/,
  );
  assert.match(
    headerStyles,
    /@media \(max-width: 760px\)[\s\S]*\.globalSearchPanel\s*\{[\s\S]*border-color: var\(--sr-color-border-product-popover-elevated\);[\s\S]*background: var\(--sr-color-surface-product-popover-elevated\);[\s\S]*\.globalSearchBackdrop\s*\{[\s\S]*z-index: calc\(var\(--sr-z-mobile-menu\) - 1\);[\s\S]*top: var\(--sr-size-header\);[\s\S]*background: var\(--sr-color-backdrop-product-popover-mobile\);/,
  );

  assert.match(
    alerts,
    /aria-hidden="true"[\s\S]{0,120}className=\{styles\.mobileBackdrop\}[\s\S]{0,120}onClick=\{\(\) => closeAlerts\(true\)\}/,
  );
  assert.match(alerts, /role="dialog"/);
  assert.match(alerts, /event\.key === "Escape"[\s\S]*closeAlerts\(true\)/);
  assert.match(alertStyles, /\.mobileBackdrop\s*\{\s*display: none;/);
  assert.match(
    alertStyles,
    /@media \(max-width: 760px\)[\s\S]*\.popover\s*\{[\s\S]*border-color: var\(--sr-color-border-product-popover-elevated\);[\s\S]*background: var\(--sr-color-surface-product-popover-elevated\);[\s\S]*\.mobileBackdrop\s*\{[\s\S]*z-index: calc\(var\(--sr-z-mobile-menu\) - 1\);[\s\S]*background: var\(--sr-color-backdrop-product-popover-mobile\);/,
  );
  assert.doesNotMatch(
    tokens,
    /--sr-color-surface-product-popover-(?:section|unread):/,
  );
  assert.doesNotMatch(
    alertStyles,
    /product-popover-(?:section|unread)|\.list li\[data-read="false"\]/,
  );
  assert.match(
    alertStyles,
    /\.heading\s*\{[\s\S]*border-bottom: var\(--sr-border-width\) solid[\s\S]*var\(--sr-color-border-product-menu\);/,
  );
  assert.match(
    alertStyles,
    /\.footer\s*\{[\s\S]*border-top: var\(--sr-border-width\) solid[\s\S]*var\(--sr-color-border-product-menu\);/,
  );
  assert.doesNotMatch(
    headerStyles,
    /\.mobileMenuPopover\s*\{[^}]*product-popover-elevated/,
  );
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
