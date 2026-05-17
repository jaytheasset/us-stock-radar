import {
  fetchGlobeNewswireRawItems,
  parseGlobeNewswireSearchHtml,
  GLOBE_EXCHANGE_SEARCH_URL,
  stripGlobeNewswireAnalysisBoilerplate,
} from "../lib/sources/globe/parser.ts";

const limit = readLimit(process.argv[2], 5);
const headers = {
  accept: "text/html,*/*",
  "user-agent": "US-Stock-Radar/0.1 globe-parser-verify",
};

const searchResponse = await fetch(GLOBE_EXCHANGE_SEARCH_URL, { headers });
const searchHtml = await searchResponse.text();
const searchItems = parseGlobeNewswireSearchHtml(searchHtml, {
  searchUrl: GLOBE_EXCHANGE_SEARCH_URL,
  fetchedAt: new Date().toISOString(),
}).slice(0, limit);

const result = await fetchGlobeNewswireRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
const synthetic = stripGlobeNewswireAnalysisBoilerplate(
  [
    "Company announces a material commercial update.",
    "Revenue is expected to grow after the new customer rollout.",
    "",
    "Forward-Looking Statements",
    "This press release contains forward-looking statements and other legal disclaimers.",
    "Investor Contact",
    "example@example.com",
  ].join("\n"),
);
const syntheticCaution = stripGlobeNewswireAnalysisBoilerplate(
  [
    "Company authorizes a new share repurchase program.",
    "The board approved repurchases over a three-year period.",
    "",
    "CAUTION CONCERNING FORWARD-LOOKING STATEMENTS",
    "This press release contains statements that we believe to be forward-looking statements.",
    "These statements are subject to risks and uncertainties.",
  ].join("\n"),
);
const syntheticOutlook = stripGlobeNewswireAnalysisBoilerplate(
  [
    "Company reports quarterly results and provides business update.",
    "",
    "OUTLOOK",
    "The following forward-looking context is provided to assist investors in understanding management's operational priorities, and is subject to risks described under \"Cautionary Statement Regarding Forward-Looking Statements\" below.",
    "Management's operational priorities include expanding sales coverage and deploying contracted capacity.",
    "",
    "CAUTIONARY STATEMENT REGARDING FORWARD-LOOKING STATEMENTS",
    "This press release contains forward-looking statements within the meaning of the Private Securities Litigation Reform Act of 1995.",
  ].join("\n"),
);

if (!synthetic.text?.includes("material commercial update")) {
  failures.push("synthetic boilerplate test: article content was removed");
}
if (synthetic.text?.includes("Forward-Looking Statements")) {
  failures.push("synthetic boilerplate test: forward-looking section was not removed");
}
if (synthetic.removedSections.length !== 1) {
  failures.push("synthetic boilerplate test: removed section was not recorded");
}
if (!syntheticCaution.text?.includes("share repurchase program")) {
  failures.push("synthetic caution test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticCaution.text || "")) {
  failures.push("synthetic caution test: forward-looking section was not removed");
}
if (syntheticCaution.removedSections.length !== 1) {
  failures.push("synthetic caution test: removed section was not recorded");
}
if (!syntheticOutlook.text?.includes("operational priorities include expanding sales coverage")) {
  failures.push("synthetic outlook test: material outlook content was removed");
}
if (/Private Securities Litigation Reform Act/i.test(syntheticOutlook.text || "")) {
  failures.push("synthetic outlook test: legal boilerplate was not removed");
}
if (syntheticOutlook.removedSections.length !== 1) {
  failures.push("synthetic outlook test: removed section was not recorded");
}

console.log(`GlobeNewswire parser verification`);
console.log(`Search status: ${searchResponse.status}`);
console.log(`Search items parsed: ${searchItems.length}`);
console.log(`Raw items parsed: ${result.count}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);

for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  const articlePayload = item.raw_payload.article_payload || {};
  const bodyTickers = Array.isArray(articlePayload.body_tickers) ? articlePayload.body_tickers : [];
  const metadataTickers = Array.isArray(articlePayload.metadata_tickers)
    ? articlePayload.metadata_tickers
    : [];
  const finalTickers = Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [];
  const analysisText = item.raw_payload.analysis_text || articlePayload.analysis_text || "";
  const removedSections = Array.isArray(item.raw_payload.removed_analysis_sections)
    ? item.raw_payload.removed_analysis_sections
    : [];
  const bodyKeys = new Set(bodyTickers.map(tickerKey));
  const finalHasMetadataOnlyTicker = finalTickers.some((ticker) => !bodyKeys.has(tickerKey(ticker)));

  if (!item.body_text) failures.push(`${item.source_unique_id}: body_text missing`);
  if (item.raw_payload.ticker_source !== "article_body") {
    failures.push(`${item.source_unique_id}: ticker_source is ${item.raw_payload.ticker_source}`);
  }
  if (finalHasMetadataOnlyTicker) {
    failures.push(`${item.source_unique_id}: final tickers include metadata/search-only ticker`);
  }
  if (hasForwardLookingBoilerplate(item.body_text || "") && hasForwardLookingBoilerplate(analysisText)) {
    failures.push(`${item.source_unique_id}: forward-looking boilerplate still appears in analysis_text`);
  }

  console.log(`\n#${index + 1} ${item.source_unique_id}`);
  console.log(`URL: ${item.source_url}`);
  console.log(`Title: ${item.title}`);
  console.log(`Body chars: ${item.body_text?.length || 0}`);
  console.log(`Analysis chars: ${analysisText.length || 0}`);
  console.log(`Removed analysis sections: ${removedSections.length}`);
  console.log(`Ticker source: ${item.raw_payload.ticker_source}`);
  console.log(`Final tickers: ${formatTickers(finalTickers)}`);
  console.log(`Body tickers: ${formatTickers(bodyTickers)}`);
  console.log(`Metadata tickers kept for debug only: ${formatTickers(metadataTickers)}`);
  console.log(`Body first 240: ${(item.body_text || "").slice(0, 240).replace(/\n/g, " / ")}`);
}

if (failures.length) {
  console.error(`\nVerification failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nVerification passed.`);

function readLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.floor(parsed))) : fallback;
}

function tickerKey(ticker) {
  return `${ticker.exchange || ""}:${ticker.symbol || ""}`.toUpperCase();
}

function formatTickers(tickers) {
  return tickers.length
    ? tickers.map((ticker) => `${ticker.exchange}:${ticker.symbol}`).join(", ")
    : "(none)";
}

function hasForwardLookingBoilerplate(value) {
  return [
    /(?:^|\n)\s*((?:(?:Caution|Cautionary|Special Note|Notice|Note|Disclosure)(?:\s+(?:Note|Statement|Statements))?\s+(?:Concerning|Regarding|About|On|With Respect To)\s+)?Forward[- ]Looking (?:Statements?|Information)(?:\s+(?:and|&)\s+[A-Za-z -]+)?)[ \t.:;-]*(?:\n|$)/i,
    /(?:^|\n)\s*(Safe Harbor Statement)\s*(?:\n|$)/i,
    /(?:^|\n)\s*(This (?:press|news) release contains [^\n]{0,320}forward[- ]looking statements?)/i,
    /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[- ]looking statements?)/i,
    /\bPrivate Securities Litigation Reform Act\b/i,
  ].some((pattern) => pattern.test(value));
}
