import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateAnalysisPeers,
  selectAnalysisPeers,
  type AnalysisPeerCandidate,
} from "./analysisPeerSelection.ts";

function peers(
  symbols: string[],
  source: AnalysisPeerCandidate["source"] = "related",
): AnalysisPeerCandidate[] {
  return symbols.map((symbol, index) => ({
    companyName: `${symbol} Company`,
    relevanceScore: 100 - index,
    sortOrder: index + 1,
    source,
    symbol,
  }));
}

test("related peers stay first and taxonomy fills only the missing two slots", () => {
  const selected = selectAnalysisPeers({
    primaryTicker: "ROOT",
    related: peers(["REL1", "REL2", "REL3", "REL4"]),
    fillerBuckets: {
      sub_theme: peers(["SUB1", "SUB2"], "filler"),
      industry_group: peers(["IND1"], "filler"),
    },
  });

  assert.deepEqual(selected.map((peer) => peer.symbol), [
    "REL1",
    "REL2",
    "REL3",
    "REL4",
    "SUB1",
    "SUB2",
  ]);
  assert.deepEqual(selected.map((peer) => peer.source), [
    "related",
    "related",
    "related",
    "related",
    "filler",
    "filler",
  ]);
});

test("eight related peers are relevance-ranked and capped at six without filler", () => {
  const related = peers(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);
  related[7].relevanceScore = 101;
  const selected = selectAnalysisPeers({
    primaryTicker: "ROOT",
    related,
    fillerBuckets: { sub_theme: peers(["FILL"], "filler") },
  });

  assert.deepEqual(selected.map((peer) => peer.symbol), ["R8", "R1", "R2", "R3", "R4", "R5"]);
  assert.ok(selected.every((peer) => peer.source === "related"));
});

test("zero related peers fills six in sub-theme, theme, industry, sector order", () => {
  const selected = selectAnalysisPeers({
    primaryTicker: "ROOT",
    related: [],
    fillerBuckets: {
      sub_theme: peers(["S1", "S2"], "filler"),
      theme: peers(["T1"], "filler"),
      industry_group: peers(["I1", "I2"], "filler"),
      sector: peers(["SEC1", "SEC2"], "filler"),
    },
  });

  assert.deepEqual(selected.map((peer) => peer.symbol), ["S1", "S2", "T1", "I1", "I2", "SEC1"]);
  assert.ok(selected.every((peer) => peer.source === "filler"));
});

test("primary ticker, invalid tickers, and duplicates are removed across sources", () => {
  const selected = selectAnalysisPeers({
    primaryTicker: "ROOT",
    related: [
      ...peers(["ROOT", "DUP", "dup", "N/A"]),
      { source: "related", symbol: "OK" },
    ],
    fillerBuckets: {
      sub_theme: peers(["DUP", "F1", "ROOT"], "filler"),
      sector: peers(["F1", "F2"], "filler"),
    },
  });

  assert.deepEqual(selected.map((peer) => peer.symbol), ["DUP", "OK", "F1", "F2"]);
});

test("mobile peer pagination makes 6 -> 3 pages, 5 -> 3 pages, and 2 -> 1 page", () => {
  assert.deepEqual(paginateAnalysisPeers([1, 2, 3, 4, 5, 6]).map((page) => page.length), [2, 2, 2]);
  assert.deepEqual(paginateAnalysisPeers([1, 2, 3, 4, 5]).map((page) => page.length), [2, 2, 1]);
  assert.deepEqual(paginateAnalysisPeers([1, 2]).map((page) => page.length), [2]);
});
