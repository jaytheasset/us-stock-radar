import {
  fetchPRNewswireRawItems,
  stripPRNewswireAnalysisBoilerplate,
} from "../lib/sources/prnewswire/parser.ts";

const limit = readLimit(process.argv[2], 5);
const summaryOnly = process.argv.includes("--summary");
const result = await fetchPRNewswireRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
const synthetic = stripPRNewswireAnalysisBoilerplate(
  [
    "Company announces a material commercial update.",
    "The new agreement expands contracted revenue coverage for 2026.",
    "",
    "Forward-Looking Statements",
    "This press release contains forward-looking statements within the meaning of federal securities laws.",
    "The company assumes no obligation to update forward-looking statements.",
  ].join("\n"),
);
const syntheticCaution = stripPRNewswireAnalysisBoilerplate(
  [
    "Company reports quarterly results and announces an earnings call.",
    "Management will host a conference call at 8:30 a.m. Eastern Time.",
    "",
    "Cautionary Note Regarding Forward-Looking Statements",
    "Certain statements in this press release are forward-looking statements under the Private Securities Litigation Reform Act.",
  ].join("\n"),
);

if (!synthetic.text?.includes("material commercial update")) {
  failures.push("synthetic boilerplate test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(synthetic.text || "")) {
  failures.push("synthetic boilerplate test: forward-looking section was not removed");
}
if (synthetic.removedSections.length !== 1) {
  failures.push("synthetic boilerplate test: removed section was not recorded");
}
if (!syntheticCaution.text?.includes("announces an earnings call")) {
  failures.push("synthetic caution test: article content was removed");
}
if (/Private Securities Litigation Reform Act/i.test(syntheticCaution.text || "")) {
  failures.push("synthetic caution test: legal boilerplate was not removed");
}
if (syntheticCaution.removedSections.length !== 1) {
  failures.push("synthetic caution test: removed section was not recorded");
}

if (!result.ok) failures.push(`PR Newswire fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no PR Newswire items parsed");
if (!result.diagnostics.articleBodiesFetched) failures.push("no PR Newswire article bodies fetched");

console.log("PR Newswire parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);
console.log(`Skipped non-English: ${result.diagnostics.skippedNonEnglish}`);
console.log(`Feeds ok: ${result.diagnostics.feedStats.filter((feed) => feed.ok).length}/${result.diagnostics.feedCount}`);

for (const feed of result.diagnostics.feedStats) {
  console.log(`- ${feed.label}: ${feed.ok ? "ok" : "failed"} ${feed.status} items=${feed.itemCount}`);
}

const classCounts = new Map();
const signalCounts = new Map();
const lowValueCounts = new Map();

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
  const candidateClass = String(item.raw_payload.candidate_class || "(none)");
  const candidateSignals = Array.isArray(item.raw_payload.candidate_signals)
    ? item.raw_payload.candidate_signals
    : [];
  const lowValueReasons = Array.isArray(item.raw_payload.low_value_reasons)
    ? item.raw_payload.low_value_reasons
    : [];
  const bodyKeys = new Set(bodyTickers.map(tickerKey));
  const finalHasMetadataOnlyTicker = item.body_text
    ? finalTickers.some((ticker) => !bodyKeys.has(tickerKey(ticker)))
    : false;
  increment(classCounts, candidateClass);
  for (const signal of candidateSignals) increment(signalCounts, String(signal));
  for (const reason of lowValueReasons) increment(lowValueCounts, String(reason));

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
  if (/Request a Demo|more press release views with/i.test(analysisText)) {
    failures.push(`${item.source_unique_id || item.source_url}: PR Newswire widget text appears in analysis_text`);
  }
  if (fullTextHtml.includes("edge.prnewswire.com/c/link")) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html contains PR Newswire tracking links`);
  }

  if (summaryOnly) continue;

  console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
  console.log(`URL: ${item.source_url}`);
  console.log(`Title: ${item.title}`);
  console.log(`Body chars: ${item.body_text?.length || 0}`);
  console.log(`Analysis chars: ${analysisText.length || 0}`);
  console.log(`Removed analysis sections: ${removedSections.length}`);
  console.log(`Ticker source: ${item.raw_payload.ticker_source}`);
  console.log(`Candidate class: ${item.raw_payload.candidate_class || "(none)"}`);
  console.log(`Candidate signals: ${formatArray(item.raw_payload.candidate_signals)}`);
  console.log(`Final tickers: ${formatTickers(finalTickers)}`);
  console.log(`Body tickers: ${formatTickers(bodyTickers)}`);
  console.log(`Metadata tickers kept for debug only: ${formatTickers(metadataTickers)}`);
  console.log(`Industries: ${formatArray(item.raw_payload.industries)}`);
  console.log(`Body first 240: ${(item.body_text || "").slice(0, 240).replace(/\n/g, " / ")}`);
}

console.log("\nCandidate class counts:");
for (const [key, value] of sortedCounts(classCounts)) console.log(`- ${key}: ${value}`);

console.log("\nLow-value reason counts:");
for (const [key, value] of sortedCounts(lowValueCounts)) console.log(`- ${key}: ${value}`);

console.log("\nCandidate signal counts:");
for (const [key, value] of sortedCounts(signalCounts).slice(0, 40)) console.log(`- ${key}: ${value}`);

if (failures.length) {
  console.error("\nVerification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nVerification passed.");

function readLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.floor(parsed))) : fallback;
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

function formatArray(value) {
  return Array.isArray(value) && value.length ? value.join(", ") : "(none)";
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedCounts(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function hasLegalBoilerplate(value) {
  return [
    /(?:^|\n)\s*(?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information|Language)/i,
    /(?:^|\n)\s*(?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?/i,
    /(?:^|\n)\s*This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?/i,
    /\bPrivate Securities Litigation Reform Act\b/i,
  ].some((pattern) => pattern.test(value));
}
