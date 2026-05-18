import {
  fetchBusinessWireRawItems,
  stripBusinessWireAnalysisBoilerplate,
} from "../lib/sources/businesswire/parser.ts";

const limit = readLimit(process.argv[2], 5);
const result = await fetchBusinessWireRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
const synthetic = stripBusinessWireAnalysisBoilerplate(
  [
    "Company announces a material commercial update.",
    "The new agreement expands contracted revenue coverage for 2026.",
    "",
    "Forward-Looking Statements",
    "This press release contains forward-looking statements within the meaning of federal securities laws.",
    "The company assumes no obligation to update forward-looking statements.",
  ].join("\n"),
);
const syntheticCaution = stripBusinessWireAnalysisBoilerplate(
  [
    "Company reports quarterly results and announces an earnings call.",
    "Management will host a conference call at 8:30 a.m. Eastern Time.",
    "",
    "Cautionary Note Regarding Forward-Looking Statements",
    "Certain statements in this press release are forward-looking statements under the Private Securities Litigation Reform Act.",
  ].join("\n"),
);
const syntheticInformation = stripBusinessWireAnalysisBoilerplate(
  [
    "Company reports quarterly results and raises full year outlook.",
    "Revenue increased and management raised annual EPS guidance.",
    "",
    "This information to be made available in this press release may contain forward-looking statements based on management's current expectations.",
    "Forward-looking statements include statements under Financial Outlook and capital deployment plans.",
  ].join("\n"),
);
const syntheticForwardLookingHeading = stripBusinessWireAnalysisBoilerplate(
  [
    "Company announces a definitive agreement with a named commercial partner.",
    "The agreement adds supply coverage for the United States.",
    "",
    "Forward Looking Statements",
    "This press release contains forward-looking statements within the meaning of federal securities laws.",
  ].join("\n"),
);
const syntheticCautionConcerning = stripBusinessWireAnalysisBoilerplate(
  [
    "Company raises its dividend and authorizes a new repurchase program.",
    "Management said cash flow supports shareholder returns.",
    "",
    "CAUTION CONCERNING FORWARD-LOOKING STATEMENTS",
    "This release contains statements that we believe to be forward-looking statements within the meaning of federal securities laws.",
  ].join("\n"),
);
const syntheticCompanyPrefixHeading = stripBusinessWireAnalysisBoilerplate(
  [
    "Company launches a debt exchange offer with noteholder support.",
    "The exchange is intended to reduce outstanding debt by more than $120 million.",
    "",
    "Example Bio Forward Looking Statements",
    "The company cautions that statements regarding matters that are not historical facts are forward-looking statements.",
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
if (!syntheticInformation.text?.includes("raises full year outlook")) {
  failures.push("synthetic information test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticInformation.text || "")) {
  failures.push("synthetic information test: forward-looking section was not removed");
}
if (syntheticInformation.removedSections.length !== 1) {
  failures.push("synthetic information test: removed section was not recorded");
}
if (!syntheticForwardLookingHeading.text?.includes("definitive agreement")) {
  failures.push("synthetic forward-looking heading test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticForwardLookingHeading.text || "")) {
  failures.push("synthetic forward-looking heading test: heading was not removed");
}
if (syntheticForwardLookingHeading.removedSections.length !== 1) {
  failures.push("synthetic forward-looking heading test: removed section was not recorded");
}
if (!syntheticCautionConcerning.text?.includes("raises its dividend")) {
  failures.push("synthetic caution concerning test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticCautionConcerning.text || "")) {
  failures.push("synthetic caution concerning test: heading was not removed");
}
if (syntheticCautionConcerning.removedSections.length !== 1) {
  failures.push("synthetic caution concerning test: removed section was not recorded");
}
if (!syntheticCompanyPrefixHeading.text?.includes("debt exchange offer")) {
  failures.push("synthetic company-prefix heading test: article content was removed");
}
if (/forward[- ]looking statements?/i.test(syntheticCompanyPrefixHeading.text || "")) {
  failures.push("synthetic company-prefix heading test: heading was not removed");
}
if (syntheticCompanyPrefixHeading.removedSections.length !== 1) {
  failures.push("synthetic company-prefix heading test: removed section was not recorded");
}

if (!result.ok) failures.push(`Business Wire fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no Business Wire items parsed");
if (!result.diagnostics.articleBodiesFetched) failures.push("no Business Wire article bodies fetched");

console.log("Business Wire parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);
console.log(`Skipped non-English: ${result.diagnostics.skippedNonEnglish}`);
console.log(`Feeds ok: ${result.diagnostics.feedStats.filter((feed) => feed.ok).length}/${result.diagnostics.feedCount}`);

for (const feed of result.diagnostics.feedStats) {
  console.log(`- ${feed.label}: ${feed.ok ? "ok" : "failed"} ${feed.status} items=${feed.itemCount}`);
}

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
  if (fullTextHtml.includes('href="https://www.businesswire.com/ct/CT"')) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html contains a broken Business Wire tracking link`);
  }

  console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
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

function hasLegalBoilerplate(value) {
  return [
    /(?:^|\n)\s*(?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information)/i,
    /(?:^|\n)\s*(?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?/i,
    /(?:^|\n)\s*This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?/i,
    /\bPrivate Securities Litigation Reform Act\b/i,
  ].some((pattern) => pattern.test(value));
}
