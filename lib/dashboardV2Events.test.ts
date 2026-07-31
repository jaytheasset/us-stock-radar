import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eventTypeDefinitions } from "./eventTypeRegistry.ts";
import {
  getDashboardV2ShortEventLabel,
  includesDashboardV2EventDeliveryLevel,
  normalizeDashboardV2EventScore,
  selectDashboardV2EventTypeBadges,
  sortDashboardV2Events,
} from "./dashboardV2Events.ts";
import {
  getDashboardV2TickerDetail,
  type DashboardV2Event,
  type DashboardV2MarketMover,
} from "./dashboardV2Types.ts";

test("includes Feed and Alert events while excluding Archive", () => {
  const fixtures = [
    { deliveryLevel: "feed", included: true },
    { deliveryLevel: "alert", included: true },
    { deliveryLevel: "archive", included: false },
  ];
  for (const fixture of fixtures) {
    assert.equal(
      includesDashboardV2EventDeliveryLevel(fixture.deliveryLevel),
      fixture.included,
    );
  }
});

test("normalizes invalid scores and sorts score, timestamp, then id", () => {
  assert.equal(normalizeDashboardV2EventScore(null), 0);
  assert.equal(normalizeDashboardV2EventScore("bad"), 0);
  assert.equal(normalizeDashboardV2EventScore(101), 0);
  assert.equal(normalizeDashboardV2EventScore("75"), 75);

  const events = [
    fixtureEvent("d", "earnings", 70, "2026-07-30T12:00:00Z"),
    fixtureEvent("c", "legal_risk", 90, "2026-07-29T12:00:00Z"),
    fixtureEvent("b", "product_update", 70, "2026-07-31T12:00:00Z"),
    fixtureEvent("a", "dilution_risk", 70, "2026-07-31T12:00:00Z"),
  ];

  assert.deepEqual(
    sortDashboardV2Events(events).map((event) => event.id),
    ["c", "a", "b", "d"],
  );
});

test("selects one highest-priority representative per event type and caps unique types", () => {
  const events = [
    fixtureEvent("earn-low", "earnings", 55, "2026-07-31T15:00:00Z"),
    fixtureEvent("legal", "legal_risk", 88, "2026-07-31T14:00:00Z"),
    fixtureEvent("earn-high", "earnings", 95, "2026-07-30T10:00:00Z"),
    fixtureEvent("product", "product_update", 80, "2026-07-31T13:00:00Z"),
    fixtureEvent("vote", "shareholder_vote", 75, "2026-07-31T12:00:00Z"),
    fixtureEvent("insider", "insider_ownership", 60, "2026-07-31T11:00:00Z"),
  ];

  const desktop = selectDashboardV2EventTypeBadges(events, 4);
  const mobile = selectDashboardV2EventTypeBadges(events, 2);

  assert.deepEqual(
    desktop.representatives.map((event) => event.id),
    ["earn-high", "legal", "product", "vote", "insider"],
  );
  assert.deepEqual(
    desktop.visible.map((event) => event.id),
    ["earn-high", "legal", "product", "vote"],
  );
  assert.equal(desktop.hidden.length, 1);
  assert.deepEqual(
    mobile.visible.map((event) => event.id),
    ["earn-high", "legal"],
  );
  assert.equal(mobile.hidden.length, 3);
});

test("keeps the sorted raw event list for filters and the top four detail events", () => {
  const sortedEvents = sortDashboardV2Events([
    fixtureEvent("earn-older", "earnings", 90, "2026-07-29T12:00:00Z"),
    fixtureEvent("earn-newer", "earnings", 90, "2026-07-30T12:00:00Z"),
    fixtureEvent("legal", "legal_risk", 80, "2026-07-31T12:00:00Z"),
    fixtureEvent("product", "product_update", 70, "2026-07-31T12:00:00Z"),
    fixtureEvent("vote", "shareholder_vote", 60, "2026-07-31T12:00:00Z"),
  ]);
  const mover: DashboardV2MarketMover = {
    changePercent: "+1.00%",
    company: "Fixture",
    events: sortedEvents,
    marketCap: "$1B",
    price: "$10.00",
    priceValue: 10,
    rank: 1,
    ticker: "FIX",
    volume: "1M",
  };

  const detail = getDashboardV2TickerDetail(mover);
  assert.equal(mover.events.length, 5);
  assert.deepEqual(
    detail.recentEvents.map((event) => event.id),
    ["earn-newer", "earn-older", "legal", "product"],
  );
});

test("defines compact labels for all 17 registered event types", () => {
  assert.equal(eventTypeDefinitions.length, 17);
  for (const definition of eventTypeDefinitions) {
    const shortLabel = getDashboardV2ShortEventLabel(
      fixtureEvent(
        definition.code,
        definition.code,
        50,
        "2026-07-31T12:00:00Z",
        definition.label,
      ),
    );
    assert.ok(shortLabel.length > 0, definition.code);
    assert.ok(shortLabel.length <= 10, `${definition.code}: ${shortLabel}`);
  }
});

test("dashboard query selects score and preserves the non-Archive contract", async () => {
  const source = await readFile(
    new URL("./supabase.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /select: "id,ticker,event_type,score,signal,impact,title,detected_at,published_at,delivery_level"/,
  );
  assert.match(source, /delivery_level: "neq\.archive"/);
  assert.doesNotMatch(source, /delivery_level: "eq\.alert"/);
});

function fixtureEvent(
  id: string,
  code: string,
  score: number,
  timestamp: string,
  label = code,
): DashboardV2Event {
  return {
    code,
    id,
    label,
    score,
    timestamp,
    title: id,
    tone: "neutral",
  };
}
