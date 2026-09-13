import assert from "node:assert/strict";
import test from "node:test";
import { readMonitorCurrentPrice, type MonitorCurrentPriceProjectionReaders } from "./currentPrice.ts";
import { evaluateListingMonitorEvent } from "../listingMonitorMatcher.ts";
import { consumeListingMonitorAlertsForEvent } from "./listingMonitorAlertConsumer.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";
import type { CurrentPrice } from "../market-data/marketDataProvider.ts";

const EVENT = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const RAW = "696bc839-6355-57e8-a758-98954c23acb6";
const ACCESSION = "0001493152-26-037944";
const ANCHOR = "0001493152-26-042421";
const CIK = "0001854445";
const TITLE = "Common Stock, par value $0.001 per share";
const NOW = "2026-09-14T00:00:00.000Z";
const url = (accession: string) => `https://www.sec.gov/Archives/edgar/data/1854445/${accession.replaceAll("-", "")}/form.htm`;
const condition = { key: "market.price", operator: "lt", value: 1 };
function price(symbol: string): Extract<CurrentPrice, { availability: "available" }> {
  return { symbol, price: .82, asOf: NOW, availability: "available", dataMode: "realtime" };
}
function harness(symbol = "GGRP") {
  const event = { id: EVENT, ticker: symbol, source_code: "sec_edgar", source_group: "filings", raw_item_id: RAW,
    metadata: { cik: CIK, accession_number: ACCESSION, primary_document_url: url(ACCESSION) } };
  const projection = { status: "available", currentTicker: "BTLN", historicalTickers: ["VRAR", "GGRP"], issuerCik: CIK,
    sourceFilings: [{ historicalTicker: symbol, accessionNumber: ACCESSION, securityTitle: TITLE, exchange: "Nasdaq", sourceUrl: url(ACCESSION) },
      { historicalTicker: "BTLN", accessionNumber: ANCHOR, securityTitle: TITLE, exchange: "Nasdaq", sourceUrl: url(ANCHOR) }] };
  const observation = { issuerCik: CIK, tradingSymbol: { status: "observed", parsedTextValue: symbol },
    securityTitle: { status: "observed", parsedTextValue: TITLE }, exchange: { status: "observed", parsedTextValue: "Nasdaq" },
    context: { dimensions: [] } };
  const eventCover = { status: "available", results: [{ payload: { identity: { issuerCik: CIK, rawItemId: RAW },
    extractionStatus: "available", source: { url: url(ACCESSION) }, observations: [structuredClone(observation)] } }] };
  const anchorCover = structuredClone(eventCover);
  anchorCover.results[0]!.payload.source.url = url(ANCHOR);
  anchorCover.results[0]!.payload.observations[0]!.tradingSymbol.parsedTextValue = "BTLN";
  const readers: MonitorCurrentPriceProjectionReaders = {
    projection: async () => projection as never,
    event: async () => event,
    cover: async (accession) => (accession === ACCESSION ? eventCover : anchorCover) as never,
  };
  return { readers, event, projection, eventCover, anchorCover };
}
const listing = () => ({ status: "available", eventId: EVENT, sourceExecutionId: RAW, persistedAt: NOW,
  facts: { affected_security: { ticker: { value: "GGRP", availability: "available" } },
    classification: { event_kind: "deficiency_notice" } } } as const);
async function both(readers: MonitorCurrentPriceProjectionReaders, quote: (s: string) => Promise<CurrentPrice> = async s => price(s),
  ownership?: CurrentOwnershipReadResult) {
  const args: string[] = [];
  const readCurrentPrice = async (symbol: string) => { args.push(symbol); return quote(symbol); };
  const conditions = [condition, ownership
    ? { key: ownership.status === "available" && ownership.form === "form144" ? "ownership.form144.proposed_sale_shares" : "ownership.form4.shares", operator: "gt", value: 0 }
    : { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }];
  const dependencies = { readFacts: async () => listing() as never, readOwnershipFacts: async () => ownership!,
    currentPriceProjectionReaders: readers, readCurrentPrice, now: () => new Date(NOW), readEventTicker: async () => "GGRP" };
  const matcher = await evaluateListingMonitorEvent({ eventId: EVENT, evaluationDate: NOW.slice(0, 10), evaluatedAt: NOW,
    conditionSets: [{ id: "test", conditions }] }, dependencies);
  const consumer = await consumeListingMonitorAlertsForEvent({ eventId: EVENT }, { ...dependencies,
    listActiveMonitors: async () => ({ monitors: [{ id: "test", userId: "user", conditions }] as never, diagnostics: [] }),
    createAlert: async () => ({ status: "created", monitorId: "test" }),
  });
  return { args, matcher: matcher.evaluations[0]!.result, consumer: consumer.evaluations[0]! };
}

test("both product evaluation paths pass BTLN to the provider while keeping the historical event/facts unchanged", async () => {
  const h = harness(); const before = structuredClone(h.event);
  const result = await both(h.readers);
  assert.deepEqual(result.args, ["BTLN", "BTLN"]);
  assert.deepEqual([result.matcher.status, result.consumer.status], ["match", "match"]);
  assert.deepEqual(h.event, before);
  assert.equal(listing().facts.affected_security.ticker.value, "GGRP");
});

test("effective reject, REVIEW, UNRESOLVED and reconsideration absence stay literal; a fresh subsequent effective relation restores projection", async () => {
  const h = harness();
  for (const state of ["Human rejected", "REVIEW", "UNRESOLVED", "reconsideration"]) {
    const blocked = await both({ ...h.readers, projection: async () => ({ status: "not_found" }) });
    assert.deepEqual(blocked.args, ["GGRP", "GGRP"], state);
  }
  assert.deepEqual((await both(h.readers)).args, ["BTLN", "BTLN"], "withdrawal/approved relation re-read without cache");
});

test("missing or failed projection never guesses another ticker", async () => {
  const h = harness();
  for (const projection of [async () => ({ status: "unavailable", reason: "offline" } as const), async () => { throw Error("offline"); }]) {
    assert.deepEqual((await both({ ...h.readers, projection })).args, ["GGRP", "GGRP"]);
  }
});

test("wrong issuer, raw identity, URL, ticker and class/context cannot authorize a different quote security", async () => {
  const variants = [
    (h: ReturnType<typeof harness>) => { h.event.metadata.cik = "0000000001"; },
    (h: ReturnType<typeof harness>) => { h.event.raw_item_id = "other"; },
    (h: ReturnType<typeof harness>) => { h.event.metadata.primary_document_url = url(ANCHOR); },
    (h: ReturnType<typeof harness>) => { h.event.ticker = "VEEAW"; },
    (h: ReturnType<typeof harness>) => { h.eventCover.results[0]!.payload.observations[0]!.securityTitle.parsedTextValue = "Class B common stock"; },
    (h: ReturnType<typeof harness>) => { h.eventCover.results[0]!.payload.observations[0]!.securityTitle.parsedTextValue = "Warrants"; },
    (h: ReturnType<typeof harness>) => { h.eventCover.results[0]!.payload.observations.push(structuredClone(h.eventCover.results[0]!.payload.observations[0]!)); },
  ];
  for (const mutate of variants) { const h = harness(); mutate(h); assert.deepEqual((await both(h.readers)).args, ["GGRP", "GGRP"]); }
});

test("VEEA/VEEAW and already-current symbols are not converted", async () => {
  for (const symbol of ["VEEA", "VEEAW", "BTLN"]) {
    const h = harness(symbol); const args: string[] = [];
    await readMonitorCurrentPrice({ eventId: EVENT, historicalTicker: symbol }, {
      projectionReaders: symbol === "BTLN" ? h.readers : { ...h.readers, projection: async () => ({ status: "not_found" }) },
      readCurrentPrice: async s => { args.push(s); return price(s); },
    });
    assert.deepEqual(args, [symbol]);
  }
});

test("unavailable, provider failure, stale and EOD policies still reach the unchanged Monitor quality checks", async () => {
  const variants: [string, (s: string) => Promise<CurrentPrice>][] = [
    ["market_price_unavailable", async s => ({ symbol: s, availability: "unavailable", dataMode: null, price: null, asOf: null } as never)],
    ["market_price_unavailable", async () => { throw Error("provider down"); }],
    ["market_price_stale", async s => ({ ...price(s), asOf: "2026-09-13T23:54:59.000Z" })],
    ["market_price_data_mode_ineligible", async s => ({ ...price(s), dataMode: "end-of-day" })],
  ];
  for (const [reason, quote] of variants) {
    const result = await both(harness().readers, quote);
    assert.deepEqual(result.args, ["BTLN", "BTLN"]);
    assert.deepEqual([result.matcher.status, result.consumer.status], ["ineligible", "ineligible"]);
    assert.deepEqual([result.matcher.reasonCode, result.consumer.reasonCode], [reason, reason]);
  }
});

function ownership(form: "form4" | "form144"): CurrentOwnershipReadResult {
  return { status: "available", eventId: EVENT, rawItemId: RAW, accessionNumber: ACCESSION, form,
    sourceExecutionId: EVENT, parserVersion: "verified", persistedAt: NOW, rows: [{ event_id: EVENT, transaction_index: 0, proposed_sale_index: 0,
      symbol: "GGRP", security_title: TITLE, shares: 2, shares_availability: "available", shares_value_quality: "exact",
      securities_to_be_sold: 2, securities_to_be_sold_availability: "available", securities_to_be_sold_value_quality: "exact",
      provenance: { source_verified: true, issuer_identity: { xml_cik: CIK, target_cik: CIK },
        source_row: { group: form === "form4" ? "non_derivative_transactions" : "proposed_sale_rows" } },
    }] } as never;
}
test("Form4 and Form144 direct official rows use the same quote adapter; derivative/mixed-class rows remain literal", async () => {
  for (const form of ["form4", "form144"] as const) {
    const facts = ownership(form);
    let coverReads = 0;
    const allowed = await both({ ...harness().readers, cover: async () => { coverReads += 1; throw Error("Ownership must use XML, not cover identity"); } }, undefined, facts);
    assert.equal(coverReads, 0, "Form 4/144 uses the existing official XML identity and row security");
    assert.deepEqual(allowed.args, ["BTLN", "BTLN"]);
    assert.deepEqual([allowed.matcher.status, allowed.consumer.status], ["match", "match"]);
    const changed = structuredClone(facts) as any;
    changed.rows[0].security_title = "Warrants";
    assert.deepEqual((await both(harness().readers, undefined, changed)).args, ["GGRP", "GGRP"]);
    changed.rows[0].security_title = TITLE;
    changed.rows[0].provenance.issuer_identity.xml_cik = "0000000001";
    assert.deepEqual((await both(harness().readers, undefined, changed)).args, ["GGRP", "GGRP"]);
  }
  const derivative = structuredClone(ownership("form4")) as any;
  derivative.rows[0].provenance.source_row.group = "derivative_transactions";
  assert.deepEqual((await both(harness().readers, undefined, derivative)).args, ["GGRP", "GGRP"]);
});
