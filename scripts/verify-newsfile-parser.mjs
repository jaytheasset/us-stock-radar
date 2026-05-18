import {
  fetchNewsfileRawItems,
  stripNewsfileAnalysisBoilerplate,
} from "../lib/sources/newsfile/parser.ts";

const limit = readLimit(process.argv[2], 10);
const summaryOnly = process.argv.includes("--summary");
const result = await fetchNewsfileRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
const syntheticForward = stripNewsfileAnalysisBoilerplate(
  [
    "Company announces a material financing and expansion plan.",
    "The project adds contracted capacity for North American customers.",
    "",
    "Forward-Looking Statements",
    "This news release contains forward-looking statements within the meaning of applicable securities laws.",
  ].join("\n"),
);
const syntheticSourceTail = stripNewsfileAnalysisBoilerplate(
  [
    "Company reports clinical trial enrollment completion.",
    "Management expects topline data after the follow-up period.",
    "",
    "To view the source version of this press release, please visit https://www.newsfilecorp.com/release/123456",
    "Source: Example Corp.",
  ].join("\n"),
);

if (!syntheticForward.text?.includes("material financing")) {
  failures.push("synthetic forward-looking test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticForward.text || "")) {
  failures.push("synthetic forward-looking test: boilerplate was not removed");
}
if (syntheticForward.removedSections.length !== 1) {
  failures.push("synthetic forward-looking test: removed section was not recorded");
}
if (!syntheticSourceTail.text?.includes("clinical trial enrollment")) {
  failures.push("synthetic source-tail test: article content was removed");
}
if (/source version of this press release/i.test(syntheticSourceTail.text || "")) {
  failures.push("synthetic source-tail test: Newsfile source tail was not removed");
}
if (syntheticSourceTail.removedSections.length !== 1) {
  failures.push("synthetic source-tail test: removed section was not recorded");
}

if (!result.ok) failures.push(`Newsfile fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no Newsfile items parsed");
if (!result.diagnostics.articleBodiesFetched) failures.push("no Newsfile article bodies fetched");

console.log("Newsfile parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);
console.log(`Skipped non-English: ${result.diagnostics.skippedNonEnglish}`);
console.log(`Feeds ok: ${result.diagnostics.feedStats.filter((feed) => feed.ok).length}/${result.diagnostics.feedCount}`);

for (const feed of result.diagnostics.feedStats) {
  console.log(`- ${feed.label}: ${feed.ok ? "ok" : "failed"} ${feed.status} items=${feed.itemCount}`);
}

const classCounts = new Map();
const signalCounts = new Map();

for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  const articlePayload = readRecord(item.raw_payload.article_payload) || {};
  const bodyTickers = Array.isArray(articlePayload.body_tickers) ? articlePayload.body_tickers : [];
  const metadataTickers = Array.isArray(articlePayload.metadata_tickers)
    ? articlePayload.metadata_tickers
    : [];
  const finalTickers = Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [];
  const analysisText = String(item.raw_payload.analysis_text || articlePayload.analysis_text || "");
  const fullTextHtml = String(item.raw_payload.full_text_html || articlePayload.full_text_html || "");
  const removedSections = Array.isArray(item.raw_payload.removed_analysis_sections)
    ? item.raw_payload.removed_analysis_sections
    : [];
  const candidateClass = String(item.raw_payload.candidate_class || "unknown");
  const candidateSignals = Array.isArray(item.raw_payload.candidate_signals)
    ? item.raw_payload.candidate_signals
    : [];
  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  for (const signal of candidateSignals) {
    signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
  }

  const bodyKeys = new Set(bodyTickers.map(tickerKey));
  const finalHasMetadataOnlyTicker = item.body_text
    ? finalTickers.some((ticker) => !bodyKeys.has(tickerKey(ticker)))
    : false;

  if (index < limit && !item.body_text) {
    failures.push(`${item.source_unique_id || item.source_url}: body_text missing`);
  }
  if (item.body_text && item.raw_payload.ticker_source !== "article_body") {
    failures.push(`${item.source_unique_id || item.source_url}: ticker_source is ${item.raw_payload.ticker_source}`);
  }
  if (finalHasMetadataOnlyTicker) {
    failures.push(`${item.source_unique_id || item.source_url}: final tickers include metadata/search-only ticker`);
  }
  if (hasLegalBoilerplate(analysisText)) {
    failures.push(`${item.source_unique_id || item.source_url}: legal boilerplate still appears in analysis_text`);
  }
  if (fullTextHtml.includes("api.newsfilecorp.com/newsinfo")) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html contains Newsfile tracking pixel`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`URL: ${item.source_url}`);
    console.log(`Title: ${item.title}`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Signals: ${candidateSignals.join(", ") || "(none)"}`);
    console.log(`Body chars: ${item.body_text?.length || 0}`);
    console.log(`Analysis chars: ${analysisText.length || 0}`);
    console.log(`Removed analysis sections: ${removedSections.length}`);
    console.log(`Ticker source: ${item.raw_payload.ticker_source}`);
    console.log(`Final tickers: ${formatTickers(finalTickers)}`);
    console.log(`Body tickers: ${formatTickers(bodyTickers)}`);
    console.log(`Metadata tickers kept for debug only: ${formatTickers(metadataTickers)}`);
    console.log(`Body first 240: ${(item.body_text || "").slice(0, 240).replace(/\n/g, " / ")}`);
  }
}

console.log("\nCandidate class counts:");
for (const [key, count] of [...classCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`- ${key}: ${count}`);
}

console.log("\nCandidate signal counts:");
for (const [key, count] of [...signalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`- ${key}: ${count}`);
}

if (failures.length) {
  console.error("\nVerification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nVerification passed.");

function readLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(25, Math.floor(parsed))) : fallback;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tickerKey(ticker) {
  return `${ticker.exchange || ""}:${ticker.symbol || ""}`.toUpperCase();
}

function formatTickers(tickers) {
  return tickers.length
    ? tickers.map((ticker) => `${ticker.exchange}:${ticker.symbol}`).join(", ")
    : "(none)";
}

function hasLegalBoilerplate(value) {
  return [
    /(?:^|\n)\s*(?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information)/i,
    /(?:^|\n)\s*(?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?/i,
    /(?:^|\n)\s*This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?/i,
    /(?:^|\n)\s*To view the source version of this press release\b/i,
  ].some((pattern) => pattern.test(value));
}
