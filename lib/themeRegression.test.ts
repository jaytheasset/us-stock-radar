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
});

test("root layout owns the single beforeInteractive theme initializer", () => {
  const source = readSource("app/layout.tsx");

  assert.match(source, /import Script from "next\/script"/);
  assert.match(source, /<Script/);
  assert.match(source, /strategy="beforeInteractive"/);
  assert.match(source, /localStorage\.getItem\("sr-theme"\)/);
  assert.match(source, /localStorage\.getItem\("stock-radar-theme"\)/);
  assert.match(source, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(source, /document\.documentElement\.style\.colorScheme = theme/);
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

test("labeled shell theme control remains provider-driven and token-only", () => {
  const shellToggleSource = readSource(
    "components/shell/StockRadarThemeToggle.tsx",
  );
  const shellToggleStyles = readSource(
    "components/shell/StockRadarThemeToggle.module.css",
  );

  assert.match(shellToggleSource, /labeled\?: boolean/);
  assert.match(shellToggleSource, /<span>\{nextTheme === "light" \? "Light" : "Dark"\}<\/span>/);
  assert.match(shellToggleSource, /onClick=\{toggleTheme\}/);
  assert.match(shellToggleStyles, /var\(--sr-color-border-control\)/);
  assert.match(shellToggleStyles, /var\(--sr-color-surface-overlay-control\)/);
  assert.match(shellToggleStyles, /var\(--sr-color-text-control-strong\)/);
  assert.doesNotMatch(shellToggleStyles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(shellToggleStyles, /\brgba?\(/i);
});
