import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  directionalScoreThreshold,
  getDirectionalScoreTone,
  normalizeDirectionalScoreSignal,
} from "./directionalScore.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("scores below 75 always use the strong default foreground", () => {
  assert.equal(directionalScoreThreshold, 75);

  for (const signal of ["bullish", "bearish", "volatile", "neutral"]) {
    assert.equal(getDirectionalScoreTone(74, signal), "default");
  }
});

test("scores at 75 and above use the normalized signal direction", () => {
  assert.equal(getDirectionalScoreTone(75, "Bullish"), "bullish");
  assert.equal(getDirectionalScoreTone(75, "BEARISH"), "bearish");
  assert.equal(getDirectionalScoreTone(75, " volatile "), "volatile");
  assert.equal(getDirectionalScoreTone(75, "Neutral"), "neutral");
  assert.equal(getDirectionalScoreTone(99, "bullish"), "bullish");
});

test("invalid scores are safe and unknown high-score signals are neutral", () => {
  assert.equal(getDirectionalScoreTone(null, "bullish"), "default");
  assert.equal(getDirectionalScoreTone(undefined, "bearish"), "default");
  assert.equal(getDirectionalScoreTone(Number.NaN, "volatile"), "default");
  assert.equal(getDirectionalScoreTone(Number.POSITIVE_INFINITY, "bullish"), "default");
  assert.equal(getDirectionalScoreTone(75, "unknown"), "neutral");
  assert.equal(normalizeDirectionalScoreSignal(null), "neutral");
});

test("news, filings, feed, and shared analysis surfaces use the common score tone", () => {
  const sources = [
    "components/news-v2/NewsV2Row.tsx",
    "components/filings-v2/FilingsV2ImpactScore.tsx",
    "components/feed-v2/FeedEventList.tsx",
    "components/feed-v2/FeedPreviewShared.tsx",
    "components/feed-v2/FeedContextRail.tsx",
    "components/filing-analysis-v2/GenericFilingAnalysis.tsx",
    "components/filing-analysis-v2/ScoreRationale.tsx",
    "app/events/[id]/page.tsx",
    "app/filings/[id]/page.tsx",
  ].map(readSource);

  for (const source of sources) {
    assert.match(source, /getDirectionalScoreTone/);
    assert.match(source, /data-score-tone/);
  }
});

test("score styles use product tokens and no longer use news score bands", () => {
  const styleSources = [
    "components/news-v2/StockRadarNewsV2.module.css",
    "components/filings-v2/StockRadarFilingsV2.module.css",
    "components/feed-v2/StockRadarFeedV2.module.css",
    "components/feed-v2/FeedFilingPreview.module.css",
    "components/filing-analysis-v2/GenericFilingAnalysis.module.css",
    "components/filing-analysis-v2/ScoreRationale.module.css",
    "app/globals.css",
  ].map(readSource).join("\n");

  assert.doesNotMatch(styleSources, /data-score-band/);
  for (const token of [
    "--sr-color-text-heading",
    "--sr-color-positive",
    "--sr-color-negative",
    "--sr-color-warning",
    "--sr-color-event-neutral",
  ]) {
    assert.match(styleSources, new RegExp(token));
  }
});
