import { fetchFdaRawItems } from "../lib/sources/fda/parser.ts";

const limit = readLimit(process.argv[2], 20);
const summaryOnly = process.argv.includes("--summary");
const result = await fetchFdaRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
if (!result.ok) failures.push(`FDA fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no FDA items parsed");
if (!result.diagnostics.articleBodiesFetched) failures.push("no FDA article bodies parsed");

console.log("FDA parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Feed items parsed: ${result.diagnostics.parsedFromFeeds}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);

const classCounts = new Map();
const signalCounts = new Map();
const feedCounts = new Map();

for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  const candidateClass = String(item.raw_payload.candidate_class || "unknown");
  const feedLabel = String(item.raw_payload.feed_label || "unknown");
  const candidateSignals = Array.isArray(item.raw_payload.candidate_signals)
    ? item.raw_payload.candidate_signals
    : [];
  const analysisText = String(item.raw_payload.analysis_text || "");
  const fullTextHtml = String(item.raw_payload.full_text_html || "");
  const isLowValue = candidateClass === "low_value_filtered";

  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  feedCounts.set(feedLabel, (feedCounts.get(feedLabel) || 0) + 1);
  for (const signal of candidateSignals) {
    signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
  }

  if (!item.source_unique_id) {
    failures.push(`${item.source_url}: source_unique_id missing`);
  }
  if (index < limit && !isLowValue && !item.body_text) {
    failures.push(`${item.source_unique_id || item.source_url}: body_text missing`);
  }
  if (item.body_text && !analysisText) {
    failures.push(`${item.source_unique_id || item.source_url}: analysis_text missing`);
  }
  if (fullTextHtml.includes("<script")) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html contains script tag`);
  }
  if (/The FDA, an agency within the U\.S\. Department of Health and Human Services/i.test(analysisText)) {
    failures.push(`${item.source_unique_id || item.source_url}: FDA boilerplate remains in analysis_text`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`URL: ${item.source_url}`);
    console.log(`Title: ${item.title}`);
    console.log(`Published: ${item.published_at || "(none)"}`);
    console.log(`Feed: ${feedLabel}`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Signals: ${candidateSignals.join(", ") || "(none)"}`);
    console.log(`Body chars: ${item.body_text?.length || 0}`);
    console.log(`Analysis chars: ${analysisText.length}`);
    console.log(`Tickers: ${formatTickers(Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [])}`);
    console.log(`Body first 260: ${(item.body_text || "").slice(0, 260).replace(/\n/g, " / ")}`);
  }
}

console.log("\nFeed counts:");
printCounts(feedCounts);
console.log("\nCandidate class counts:");
printCounts(classCounts);
console.log("\nCandidate signal counts:");
printCounts(signalCounts);

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

function printCounts(counts) {
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${key}: ${count}`);
  }
}

function formatTickers(tickers) {
  return tickers.length
    ? tickers.map((ticker) => `${ticker.exchange}:${ticker.symbol}`).join(", ")
    : "(none)";
}
