import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock detail Events exposes one safe section-scoped DOM contract", async () => {
  const [componentSource, observationSource] = await Promise.all([
    readFile(
      new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../lib/watchlist/stockEventsObservation.ts", import.meta.url),
      "utf8",
    ),
  ]);
  const section =
    componentSource.match(
      /<section\s+aria-labelledby="watchlist-events-title"[\s\S]*?id="watchlist-events"[\s\S]*?>/,
    )?.[0] ?? "";

  assert.match(componentSource, /resolveStockEventsObservation\(\{/);
  assert.match(componentSource, /const eventsApiHref = getStockEventsRequestHref\(selectedTicker\)/);
  assert.match(
    componentSource,
    /fetch\(eventsApiHref,[\s\S]*?\.then\(readStockEventsResponse\)/,
  );
  assert.match(section, /data-stock-events-ticker=\{eventsObservation\.ticker\}/);
  assert.match(section, /data-stock-events-filter=\{eventsObservation\.filter\}/);
  assert.match(section, /data-stock-events-request-href=\{/);
  assert.match(section, /data-stock-events-request-state=\{/);
  assert.match(section, /data-stock-events-http-status=\{/);
  assert.match(section, /data-stock-events-api-ok=\{/);
  assert.match(section, /data-stock-events-response-status=\{/);
  assert.match(section, /data-stock-events-source-count=\{/);
  assert.match(section, /data-stock-events-filtered-count=\{/);
  assert.match(section, /data-stock-events-rendered-count=\{/);
  assert.match(section, /data-stock-events-state=\{eventsObservation\.status\}/);
  assert.match(section, /data-stock-events-render-state=\{/);
  assert.doesNotMatch(section, /error|response-body|cookie|key|user|profile|quote/);

  assert.match(componentSource, /<span>\{resultLabel\}<\/span>/);
  assert.match(componentSource, /<strong>\{title\}<\/strong>/);
  assert.match(componentSource, /<span>\{message\}<\/span>/);
  assert.match(componentSource, /observation\.visibleEvents\.map/);
  assert.doesNotMatch(observationSource, /profile|quote|fundamentals|chart/i);
});

test("Events filters, rows, title, and Watchlist behavior keep their accessible contracts", async () => {
  const componentSource = await readFile(
    new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
    "utf8",
  );

  assert.match(componentSource, /title="News & Events"/);
  assert.match(componentSource, /aria-label=\{`\$\{ticker\} event filters`\} role="tablist"/);
  assert.match(componentSource, /aria-selected=\{observation\.filter === filter\}/);
  assert.match(componentSource, /role="tab"/);
  assert.match(componentSource, /aria-pressed=\{event\.id === selectedEventId\}/);
  assert.match(componentSource, /className=\{styles\.watchDesktopLabel\}>Add to Watchlist/);
  assert.match(componentSource, /className=\{styles\.watchMobileLabel\}>Watch/);
  assert.match(componentSource, /href=\{event\.detailHref\}/);
});
