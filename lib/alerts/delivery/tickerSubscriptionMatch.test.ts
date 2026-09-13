import assert from "node:assert/strict";
import test from "node:test";
import { createAlertTickerMatcher, parseAlertTickerMatch, survivingAlertTickerBindings } from "./tickerSubscriptionMatch.ts";
import type { AlertTickerMatchReaders } from "./tickerSubscriptionMatch.ts";
import type { NormalizedAlertEvent } from "./types.ts";
import type { SecXbrlDimension } from "../../sec-structured-data/filingXbrlContext.ts";
import { buildTelegramAlertPresentation } from "../../telegram/telegramAlertMessage.ts";

const old = { id: "00000000-0000-4000-8000-000000000001", ticker: "GGRP" };
const current = { id: "00000000-0000-4000-8000-000000000002", ticker: "BTLN" };
const event: NormalizedAlertEvent = { id: "event", title: "Synthetic boundary", tickers: ["BTLN"],
  primaryTicker: "BTLN", category: "earnings", sourceType: "filing", marketScope: "company",
  metadata: { source_code: "sec_edgar", cik: "123456", accession_number: "0000123456-26-000001",
    source_url: "https://www.sec.gov/Archives/edgar/data/123456/1/a.htm", raw_item_id: "raw" } };
// Synthetic reader payloads only; the isolated suite exercises actual SEC bytes and official readers.
function readers(): AlertTickerMatchReaders {
  return {
    projection: async () => ({ status: "available", currentTicker: "BTLN", historicalTickers: ["VRAR", "GGRP"], issuerCik: "0000123456",
      sourceFilings: [{ historicalTicker: "BTLN", currentTicker: "BTLN", accessionNumber: "0000123456-26-000001",
        issuerCik: "0000123456", sourceUrl: event.metadata!.source_url as string, exchange: "NASDAQ", securityTitle: "Common Stock",
        acceptedAt: "2026-09-11T12:00:00Z", filedDate: "2026-09-11", formType: "8-K", sourceDocument: "a.htm", detailHref: "/source" }] }),
    cover: async () => ({ status: "available", results: [{ result: {}, observations: [], payload: {
      identity: { issuerCik: "0000123456", rawItemId: "raw" }, extractionStatus: "available",
      source: { url: event.metadata!.source_url }, observations: [{ issuerCik: "0000123456", context: { dimensions: [] },
        tradingSymbol: { status: "observed", parsedTextValue: "BTLN" }, securityTitle: { status: "observed", parsedTextValue: "Common Stock" },
        exchange: { status: "observed", parsedTextValue: "NASDAQ" } }],
    } }] } as unknown as Awaited<ReturnType<AlertTickerMatchReaders["cover"]>>),
  };
}

test("one matcher keeps old/new originals and event ticker with both provenances", async () => {
  const subscriptions = [old, current];
  const before = JSON.stringify(subscriptions);
  const match = await createAlertTickerMatcher(readers())(event, subscriptions);
  assert.deepEqual(match.matchedTickers, ["BTLN"]);
  assert.deepEqual(match.provenance.bindings.map((b) => b.kind).sort(), ["literal", "projection"]);
  assert.equal(JSON.stringify(subscriptions), before);
  assert.equal(event.primaryTicker, "BTLN");
});

test("rejected/not-found projection blocks old while retaining literal new binding", async () => {
  const r = readers(); const before = await createAlertTickerMatcher(r)(event, [old, current]);
  r.projection = async () => ({ status: "not_found" });
  const rejected = await createAlertTickerMatcher(r)(event, [old, current]);
  assert.deepEqual(survivingAlertTickerBindings(before.provenance, rejected.provenance).map((b) => b.savedTicker), ["BTLN"]);
  assert.deepEqual((await createAlertTickerMatcher(r)(event, [old])).matchedTickers, []);
});

test("projection read failure is not an identity fallback", async () => {
  const r = readers(); r.projection = async () => { throw new Error("unavailable"); };
  const match = await createAlertTickerMatcher(r)(event, [old]);
  assert.deepEqual(match.matchedTickers, []);
  assert.deepEqual(match.failures, ["ticker_projection_read_failed"]);
});

for (const [label, changed] of [
  ["ticker only", { metadata: {} }], ["CIK only", { metadata: { cik: "123456" } }],
  ["news", { sourceType: "news" }], ["other issuer", { metadata: { ...event.metadata, cik: "999999" } }],
  ["different source", { metadata: { ...event.metadata, source_url: "https://www.sec.gov/Archives/other" } }],
  ["different raw item", { metadata: { ...event.metadata, raw_item_id: "other" } }],
] as const) test(`${label} does not authorize projection`, async () => {
  const match = await createAlertTickerMatcher(readers())({ ...event, ...changed } as NormalizedAlertEvent, [old]);
  assert.deepEqual(match.matchedTickers, []);
});

test("no CIK-only bridge between common and warrant symbols", async () => {
  const match = await createAlertTickerMatcher(readers())({ ...event, tickers: ["VEEAW"] }, [{ ...old, ticker: "VEEA" }]);
  assert.deepEqual(match.matchedTickers, []);
});

test("per-evaluation memo expires; future reads observe reject then withdraw", async () => {
  const r = readers(); const allowed = r.projection; let calls = 0;
  r.projection = async (ticker) => { calls++; return allowed(ticker); };
  const match = createAlertTickerMatcher(r);
  await Promise.all([match(event, [old]), match(event, [old])]); assert.equal(calls, 1);
  r.projection = async () => ({ status: "not_found" });
  assert.deepEqual((await createAlertTickerMatcher(r)(event, [old])).matchedTickers, []);
  r.projection = allowed;
  assert.deepEqual((await createAlertTickerMatcher(r)(event, [old])).matchedTickers, ["BTLN"]);
});

test("deleted original UUID cannot be revived by a replacement row with the same ticker", async () => {
  const match = createAlertTickerMatcher(readers());
  const first = await match(event, [old]);
  const replacement = await match(event, [{ ...old, id: current.id }]);
  assert.deepEqual(survivingAlertTickerBindings(first.provenance, replacement.provenance), []);
  assert.deepEqual(survivingAlertTickerBindings(first.provenance, { version: 1, bindings: [] }), []);
});

test("malformed/new-version provenance never becomes legacy", () => {
  for (const value of [null, {}, { version: 2, bindings: [] }, { version: 1, bindings: [{ subscriptionId: "x" }] }]) {
    assert.equal(parseAlertTickerMatch(value), null);
  }
});

test("Telegram body and links retain event ticker while mute buttons target saved literals", () => {
  const message = buildTelegramAlertPresentation(event, { baseUrl: "http://localhost:3118", callbackSecret: "synthetic-secret",
    callbackSubject: old.id, muteTickers: ["GGRP", "BTLN", "GGRP"] });
  assert.match(message.text, /BTLN/);
  const buttons = message.replyMarkup!.inline_keyboard.flat();
  assert.deepEqual(buttons.filter((b) => b.text.startsWith("Mute ")).map((b) => b.text), ["Mute GGRP", "Mute BTLN"]);
  assert.match(buttons[0]!.url!, /\/live\/BTLN/);
  const noSurvivor = buildTelegramAlertPresentation(event, { baseUrl: "http://localhost:3118", callbackSecret: "synthetic-secret",
    callbackSubject: old.id, muteTickers: [] });
  assert.equal(noSurvivor.replyMarkup!.inline_keyboard.flat().some((b) => b.callback_data), false);
});

// A new filing must compare its own bound cover with a different verified anchor accession.
async function nonAnchorMatch(input: {
  eventExchange: string; anchorExchange: string; eventTitle?: string; dimensions?: SecXbrlDimension[];
}) {
  const accession = "0000123456-26-999991";
  const sourceUrl = "https://www.sec.gov/Archives/edgar/data/123456/999991/b.htm";
  const future: NormalizedAlertEvent = { ...event, id: "new-filing", metadata: { ...event.metadata,
    accession_number: accession, primary_document_url: sourceUrl, source_url: sourceUrl, raw_item_id: "new-raw" } };
  const r = readers();
  const originalCover = r.cover;
  const reads: string[] = [];
  r.cover = async (requested) => {
    reads.push(requested);
    const base = await originalCover(requested);
    if (base.status !== "available") throw new Error("Synthetic cover unavailable");
    const isNew = requested === accession;
    return { ...base, results: base.results.map((result) => ({ ...result, payload: {
      ...result.payload,
      identity: { ...result.payload.identity, rawItemId: isNew ? "new-raw" : "raw" },
      source: { ...result.payload.source, url: isNew ? sourceUrl : event.metadata!.source_url as string },
      observations: result.payload.observations.map((o) => ({ ...o,
        securityTitle: { ...o.securityTitle, parsedTextValue: isNew ? input.eventTitle ?? "Common Stock" : "Common Stock" },
        exchange: { ...o.exchange, parsedTextValue: isNew ? input.eventExchange : input.anchorExchange },
        context: { ...o.context, dimensions: isNew ? input.dimensions ?? [] : [] },
      })),
    } })) };
  };
  const result = await createAlertTickerMatcher(r)(future, [old]);
  assert.deepEqual(reads, [accession, "0000123456-26-000001"]);
  return result;
}

for (const [eventExchange, anchorExchange] of [
  ["NASDAQ", "The Nasdaq Stock Market LLC"],
  ["The Nasdaq Stock Market LLC", "NASDAQ"],
  ["NYSE", "New York Stock Exchange"],
  ["NYSE American", "American Stock Exchange"],
]) test(`new non-anchor cover reuses official exchange equivalence: ${eventExchange} / ${anchorExchange}`, async () => {
  const match = await nonAnchorMatch({ eventExchange, anchorExchange });
  assert.deepEqual(match.matchedTickers, ["BTLN"]);
  assert.deepEqual(match.provenance.bindings, [{ subscriptionId: old.id, savedTicker: "GGRP",
    eventTicker: "BTLN", kind: "projection", issuerCik: "0000123456" }]);
});

for (const [eventExchange, anchorExchange] of [["NYSE", "NASDAQ"], ["NYSE American", "NYSE"]]) {
  test(`new non-anchor cover rejects distinct exchanges: ${eventExchange} / ${anchorExchange}`, async () => {
    const match = await nonAnchorMatch({ eventExchange, anchorExchange });
    assert.deepEqual(match.matchedTickers, []);
    assert.deepEqual(match.provenance.bindings, []);
  });
}

for (const eventTitle of ["Class A Common Stock", "Warrants"]) {
  test(`exchange alias cannot join new non-anchor ${eventTitle} with common stock`, async () => {
    const match = await nonAnchorMatch({ eventExchange: "NASDAQ", anchorExchange: "The Nasdaq Stock Market LLC", eventTitle });
    assert.deepEqual(match.matchedTickers, []);
    assert.deepEqual(match.provenance.bindings, []);
  });
}

test("exchange alias cannot join a new non-anchor cover with different security dimensions", async () => {
  const qname = (name: string) => ({ qname: `test:${name}`, prefix: "test", localName: name, namespaceUri: "urn:synthetic" });
  const match = await nonAnchorMatch({ eventExchange: "NASDAQ", anchorExchange: "The Nasdaq Stock Market LLC",
    dimensions: [{ kind: "explicit", axis: qname("SecurityClassAxis"), member: qname("ClassAMember") }] });
  assert.deepEqual(match.matchedTickers, []);
  assert.deepEqual(match.provenance.bindings, []);
});
