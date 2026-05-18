import {
  fetchAccesswireRawItems,
  stripAccesswireAnalysisBoilerplate,
} from "../lib/sources/accesswire/parser.ts";

const sampleUrls = [
  "https://www.accessnewswire.com/newsroom/en/metals-and-mining/united-states-antimony-corporation-reports-first-quarter-2026-financial-and-opera-1167043",
  "https://www.accessnewswire.com/newsroom/en/computers-technology-and-internet/healthy-extracts-q1-2026-net-revenue-up-73-to-record-1.6-million-1166822",
  "https://www.accessnewswire.com/newsroom/en/metals-and-mining/solitario-resources-announces-share-issuance-to-newmont-under-the-amended-investo-1166347",
  "https://www.accessnewswire.com/newsroom/en/aerospace-and-defense/unusual-machines-to-announce-first-quarter-2026-financial-results-and-provide-1163531",
  "https://www.accessnewswire.com/newsroom/en/computers-technology-and-internet/access-newswire-launches-access-insights-and-analytics-ai-powered-1164679",
];

const limit = readLimit(process.argv[2], sampleUrls.length);
const summaryOnly = process.argv.includes("--summary");
const samples = sampleUrls.slice(0, limit);
const failures = [];

const syntheticForward = stripAccesswireAnalysisBoilerplate(
  [
    "Company announces quarterly results and a material government contract milestone.",
    "Management also scheduled a conference call to discuss the quarter.",
    "",
    "Forward-Looking Statements",
    "This press release contains forward-looking statements within the meaning of federal securities laws.",
  ].join("\n"),
);

if (!syntheticForward.text?.includes("government contract milestone")) {
  failures.push("synthetic forward-looking test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticForward.text || "")) {
  failures.push("synthetic forward-looking test: boilerplate was not removed");
}
if (syntheticForward.removedSections.length !== 1) {
  failures.push("synthetic forward-looking test: removed section was not recorded");
}

console.log("Access Newswire parser verification");
console.log(`Direct article samples: ${samples.length}`);

const classCounts = new Map();
let articleBodiesFetched = 0;

for (let index = 0; index < samples.length; index += 1) {
  const url = samples[index];
  const result = await fetchAccesswireRawItems({
    sourceUniqueId: url,
    includeArticleBody: true,
    articleBodyLimit: 1,
  });

  if (!result.ok) {
    failures.push(`${url}: fetch failed: ${result.error || result.status}`);
    continue;
  }
  if (result.count !== 1 || !result.items.length) {
    failures.push(`${url}: expected exactly one parsed item`);
    continue;
  }

  const item = result.items[0];
  const articlePayload = readRecord(item.raw_payload.article_payload) || {};
  const bodyTickers = Array.isArray(articlePayload.body_tickers) ? articlePayload.body_tickers : [];
  const metadataTickers = Array.isArray(item.raw_payload.metadata_tickers)
    ? item.raw_payload.metadata_tickers
    : [];
  const finalTickers = Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [];
  const analysisText = String(item.raw_payload.analysis_text || articlePayload.analysis_text || "");
  const fullTextHtml = String(item.raw_payload.full_text_html || articlePayload.full_text_html || "");
  const removedSections = Array.isArray(item.raw_payload.removed_analysis_sections)
    ? item.raw_payload.removed_analysis_sections
    : [];
  const candidateClass = String(item.raw_payload.candidate_class || "unknown");
  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  articleBodiesFetched += item.body_text ? 1 : 0;

  const bodyKeys = new Set(bodyTickers.map(tickerKey));
  const finalHasMetadataOnlyTicker = item.body_text
    ? finalTickers.some((ticker) => !bodyKeys.has(tickerKey(ticker)))
    : false;

  if (!item.body_text) {
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
  if (!fullTextHtml || !/<p|<table|<ul|<ol/i.test(fullTextHtml)) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html missing article markup`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`URL: ${item.source_url}`);
    console.log(`Title: ${item.title}`);
    console.log(`Candidate: ${candidateClass}`);
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

console.log(`\nArticle bodies fetched: ${articleBodiesFetched}/${samples.length}`);
console.log("Candidate class counts:");
for (const [key, count] of [...classCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
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
  return Number.isFinite(parsed) ? Math.max(1, Math.min(sampleUrls.length, Math.floor(parsed))) : fallback;
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
    /\bPrivate Securities Litigation Reform Act\b/i,
  ].some((pattern) => pattern.test(value));
}
