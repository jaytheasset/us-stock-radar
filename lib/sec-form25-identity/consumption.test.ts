import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isSecForm25IdentityForm, readSecForm25EventIdentity, readStoredSecForm25EventIdentity,
  type Form25IdentityConsumerReaders, type Form25IdentityGate,
} from "./consumption.ts";
import { evaluateListingMonitorEvent } from "../listingMonitorMatcher.ts";
import { consumeListingMonitorAlertsForEvent } from "../monitor/listingMonitorAlertConsumer.ts";

const rawId = "5d0212b8-60e0-4fc0-ac1b-20d31228ec13";
const event = { id: "9d8cebdc-4673-4e40-ad30-d67abadff75b", raw_item_id: rawId,
  ticker: "TTWO", metadata: { form_type: "25-NSE/A", related_tickers: ["TTWO"],
    display_payload: { data: { primary_ticker: "TTWO" } } } };
const approved = { status: "available", state: "HUMAN_APPROVED", ticker: "TTOO", exchange: "Nasdaq", reason: "official_evidence_approved" };
const unavailable: Form25IdentityGate = { status: "blocked", ticker: null, exchange: null, reason: "subject_not_in_sec_catalog" };
const now = "2026-09-14T00:00:00.000Z";
const priceCondition = { key: "market.price", operator: "lt" as const, value: 1 };

test("Form 25 variants are scoped without changing other SEC forms", () => {
  for (const form of ["25", "25/A", "25-NSE", "25-NSE/A", "Form 25-NSE"]) assert.equal(isSecForm25IdentityForm(form), true);
  for (const form of ["4", "144", "8-K", "S-25", null]) assert.equal(isSecForm25IdentityForm(form), false);
  assert.equal(readStoredSecForm25EventIdentity({ metadata: { form_type: "4" }, ticker: "AAPL" }).status, "not_applicable");
});

test("legacy TTOO analysis TTWO never supplies identity; analysis/raw snapshot is untouched", async () => {
  const original = JSON.stringify(event);
  assert.equal(readStoredSecForm25EventIdentity(event).ticker, null);
  const readers: Form25IdentityConsumerReaders = { event: async () => event,
    identity: async id => { assert.equal(id, rawId); return { status: "available", state: "UNRESOLVED", ticker: "TTWO" }; } };
  assert.equal((await readSecForm25EventIdentity(event, readers)).status, "blocked");
  assert.equal(JSON.stringify(event), original);
});

test("only current AUTO / Human approval passes; REVIEW, hold, unavailable and read failure fail closed", async () => {
  for (const state of ["AUTO", "HUMAN_APPROVED", "REVIEW", "UNRESOLVED", "HELD", "HUMAN_REJECTED"]) {
    const identity = { ...approved, state };
    const allowed = state === "AUTO" || state === "HUMAN_APPROVED";
    const stored = readStoredSecForm25EventIdentity({ ...event, metadata: { ...event.metadata, form25_ticker_identity: identity } });
    assert.equal(stored.ticker, allowed ? "TTOO" : null, state);
    const fresh = await readSecForm25EventIdentity(event, { event: async () => event, identity: async () => identity });
    assert.equal(fresh.ticker, allowed ? "TTOO" : null, state);
  }
  const staleAuto = { ...event, metadata: { ...event.metadata, form25_ticker_identity: { ...approved, state: "AUTO" } } };
  const fresh = await readSecForm25EventIdentity(staleAuto, { event: async () => event,
    identity: async () => ({ ...approved, state: "HELD", ticker: null }) });
  assert.equal(fresh.status, "blocked", "cached AUTO cannot override a new Human hold");
  assert.equal((await readSecForm25EventIdentity(event, { event: async () => event,
    identity: async () => { throw Error("offline"); } })).status, "blocked");
});

test("unresolved identity blocks product Matcher before facts and price providers", async () => {
  let touched = 0;
  const outcome = await evaluateListingMonitorEvent({ eventId: event.id,
    evaluationDate: now.slice(0, 10), conditionSets: [{ id: "m", conditions: [priceCondition] }] }, {
    readEventIdentity: async () => unavailable,
    readFacts: async () => { touched++; throw Error("should not read"); },
    readCurrentPrice: async () => { touched++; throw Error("should not query"); },
  });
  assert.equal(outcome.evaluations[0].result.status, "ineligible");
  assert.equal(outcome.evaluations[0].result.readerReason, unavailable.reason);
  assert.equal(touched, 0);
});

test("missing event reread cannot reuse a stale filing ticker", async () => {
  const result = await readSecForm25EventIdentity(event.id, {
    event: async () => null,
    identity: async () => { throw Error("must not read missing event identity"); },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.ticker, null);
  assert.match(readFileSync(new URL("../../app/filings/[id]/page.tsx", import.meta.url), "utf8"), /readSecForm25EventIdentity\(eventRow \|\| item\.id\)/);
});

test("unresolved identity blocks product Alert consumer and price-only condition", async () => {
  let touched = 0;
  const result = await consumeListingMonitorAlertsForEvent({ eventId: event.id }, {
    readEventIdentity: async () => unavailable,
    listActiveMonitors: async () => ({ diagnostics: [], monitors: [{ id: "m", userId: "u", domain: "listing",
      isActive: true, createdAt: now, updatedAt: now, conditions: [priceCondition] }] }),
    readFacts: async () => { touched++; throw Error("should not read"); },
    readCurrentPrice: async () => { touched++; throw Error("should not query"); },
    createAlert: async () => { touched++; throw Error("must not alert"); },
    now: () => new Date(now),
  });
  assert.equal(result.createdCount, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.evaluations[0].status, "ineligible");
  assert.equal(touched, 0);
});

test("approved identity supplies TTOO to actual price-provider boundary, not stored TTWO", async () => {
  const symbols: string[] = [];
  const result = await evaluateListingMonitorEvent({ eventId: event.id, evaluationDate: now.slice(0, 10),
    conditionSets: [{ id: "m", conditions: [priceCondition] }] }, {
    readEventIdentity: async () => ({ status: "available", ticker: "TTOO", exchange: "Nasdaq", reason: "approved" }),
    readEventTicker: async () => "TTWO",
    readCurrentPrice: async symbol => { symbols.push(symbol); return { symbol, price: .8, asOf: now, availability: "available", dataMode: "realtime" }; },
    currentPriceProjectionReaders: { event: async () => ({ status: "not_applicable" }) } as never,
    now: () => new Date(now),
  });
  assert.deepEqual(symbols, ["TTOO"]);
  assert.equal(result.evaluations[0].result.status, "match");
});

test("server, event CLI and queued-send paths share identity gate; storage never uses LLM context links for Form 25", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../alerts/delivery/normalizeAlertEvent.ts"), /readSecForm25EventIdentity\(row\)/);
  assert.match(source("../../scripts/run-alert-delivery-for-event.mjs"), /runtime\.readSecForm25EventIdentity\(event\)/);
  assert.match(source("../alerts/delivery/revalidateTickerDelivery.ts"), /readSecForm25EventIdentity\(row\.alert_event_id\)/);
  assert.match(source("../secStores/eventStore.ts"), /identityOnly \? \[\] : readSecAnalysisContextTickers/);
  assert.match(source("../liveFeed.ts"), /if \(form25Identity.status !== "not_applicable"\) return form25Identity.ticker \|\| ""/);
});
