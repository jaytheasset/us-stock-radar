import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("client theme provider contains no inline script and reconciles both storage keys before paint", () => {
  const source = readSource(
    "components/shell/StockRadarThemeProvider.tsx",
  );

  assert.doesNotMatch(source, /<script\b/i);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /initialThemeScript/);
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /stockRadarThemeStorageKey = "sr-theme"/);
  assert.match(source, /legacyThemeStorageKey = "stock-radar-theme"/);
  assert.match(source, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(source, /document\.documentElement\.style\.colorScheme = theme/);
  assert.match(source, /data-sr-theme=\{theme\}/);
  assert.match(source, /data-sr-theme-mode=\{mode\}/);
});

test("root layout emits a parser-executed native theme initializer before body paint", () => {
  const source = readSource("app/layout.tsx");

  assert.doesNotMatch(source, /import Script from "next\/script"/);
  assert.doesNotMatch(source, /<Script\b/);
  assert.doesNotMatch(source, /strategy="beforeInteractive"/);
  assert.doesNotMatch(source, /self\.__next_s/);
  assert.match(source, /<html[\s\S]*data-theme="light"/);
  assert.match(source, /style=\{\{ colorScheme: "light" \}\}/);
  assert.match(
    source,
    /<head>[\s\S]*<script[\s\S]*id="theme-init"[\s\S]*dangerouslySetInnerHTML=\{\{ __html: themeScript \}\}[\s\S]*<\/head>[\s\S]*<body>/,
  );
  assert.match(source, /localStorage\.getItem\("sr-theme"\)/);
  assert.match(source, /localStorage\.getItem\("stock-radar-theme"\)/);
  assert.match(source, /primaryTheme === "dark" \|\| primaryTheme === "light"/);
  assert.match(source, /legacyTheme === "dark" \|\| legacyTheme === "light"/);
  assert.match(source, /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(source, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(source, /document\.documentElement\.style\.colorScheme = theme/);
});

test("stored light theme styles user-selectable shells before hydration without changing fixed-dark shells", () => {
  const tokenSource = readSource("app/stock-radar-tokens.css");

  assert.match(
    tokenSource,
    /\[data-sr-theme="light"\]\s*,\s*html\[data-theme="light"\]\s+\[data-sr-theme-mode="user-selectable"\]\s*\{/,
  );
  assert.doesNotMatch(
    tokenSource,
    /html\[data-theme="light"\]\s+\[data-sr-theme-mode="fixed-dark"\]/,
  );
});

test("both theme controls preserve the shared persistence and accessible toggle contract", () => {
  const providerSource = readSource(
    "components/shell/StockRadarThemeProvider.tsx",
  );
  const shellToggleSource = readSource(
    "components/shell/StockRadarThemeToggle.tsx",
  );
  const legacyToggleSource = readSource("components/ThemeToggle.tsx");

  assert.match(
    providerSource,
    /localStorage\.setItem\(stockRadarThemeStorageKey, nextTheme\)/,
  );
  assert.match(
    providerSource,
    /localStorage\.setItem\(legacyThemeStorageKey, nextTheme\)/,
  );
  assert.match(shellToggleSource, /useStockRadarTheme\(\)/);
  assert.match(shellToggleSource, /aria-label=\{`Switch to \$\{nextTheme\} theme`\}/);
  assert.match(legacyToggleSource, /const storageKey = "sr-theme"/);
  assert.match(
    legacyToggleSource,
    /const legacyStorageKey = "stock-radar-theme"/,
  );
  assert.match(
    legacyToggleSource,
    /window\.localStorage\.setItem\(legacyStorageKey, nextTheme\)/,
  );
});
