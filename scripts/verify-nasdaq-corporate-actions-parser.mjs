import { fetchNasdaqCorporateActionsRawItems } from "../lib/sources/nasdaqtrader/corporateActionsParser.ts";

const limit = readLimit(process.argv[2], 6);
const summaryOnly = process.argv.includes("--summary");
const samplesOnly = process.argv.includes("--samples");

const sampleIds = [
  "ECA2025-510",
  "ECA2026-321",
  "ECA2026-216",
  "ECA2026-188",
  "ECA2026-296",
  "ECA2025-300",
];

const results = samplesOnly
  ? await Promise.all(sampleIds.map((sourceUniqueId) => fetchNasdaqCorporateActionsRawItems({ sourceUniqueId })))
  : [await fetchNasdaqCorporateActionsRawItems({ limit, includeArticleBody: true, articleBodyLimit: limit })];

const failures = [];
const allItems = results.flatMap((result) => {
  if (!result.ok) failures.push(`fetch failed: ${result.error || result.status}`);
  return result.items;
});

if (!allItems.length) failures.push("no Nasdaq corporate action items parsed");

const familyCounts = new Map();
const classCounts = new Map();

for (let index = 0; index < allItems.length; index += 1) {
  const item = allItems[index];
  const payload = item.raw_payload || {};
  const corporateAction = readRecord(payload.corporate_action) || {};
  const eventFamily = String(payload.corporate_action_event_family || "unknown");
  const candidateClass = String(payload.candidate_class || "unknown");
  const analysisText = String(payload.analysis_text || "");
  const fullTextHtml = String(payload.full_text_html || "");
  const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];

  familyCounts.set(eventFamily, (familyCounts.get(eventFamily) || 0) + 1);
  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);

  if (!item.source_unique_id) failures.push(`${item.title || item.source_url}: source_unique_id missing`);
  if (!item.source_url) failures.push(`${item.source_unique_id || item.title}: source_url missing`);
  if (!item.title) failures.push(`${item.source_unique_id || item.source_url}: title missing`);
  if (!item.body_text) failures.push(`${item.source_unique_id || item.title}: body_text missing`);
  if (!analysisText) failures.push(`${item.source_unique_id || item.title}: analysis_text missing`);
  if (/market maker/i.test(analysisText)) {
    failures.push(`${item.source_unique_id || item.title}: analysis_text still contains market-maker boilerplate`);
  }
  if (/<script/i.test(fullTextHtml)) {
    failures.push(`${item.source_unique_id || item.title}: full_text_html contains script tag`);
  }
  if (!tickers.length) failures.push(`${item.source_unique_id || item.title}: no ticker parsed`);

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`Title: ${item.title}`);
    console.log(`Published: ${item.published_at || "(none)"}`);
    console.log(`Family: ${eventFamily}`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Ticker(s): ${tickers.map((ticker) => ticker.symbol || ticker.raw).filter(Boolean).join(", ") || "(none)"}`);
    console.log(`Company: ${corporateAction.company_name || "(none)"}`);
    console.log(`CUSIP: ${corporateAction.cusip || "(none)"}`);
    console.log(`Symbol: ${corporateAction.symbol || "(none)"}`);
    console.log(`Effective: ${corporateAction.marketplace_effective_date || corporateAction.marketplace_effective_date_for_suspension || "(none)"}`);
    console.log(`Record/Payment/Ex: ${corporateAction.record_date || "(none)"} / ${corporateAction.payment_date || "(none)"} / ${corporateAction.ex_date || "(none)"}`);
    console.log(`Ratio: ${corporateAction.ratio || "(none)"}`);
    console.log(`Consideration: ${corporateAction.merger_consideration || corporateAction.redemption_amount || "(none)"}`);
    console.log(`Text: ${analysisText.replace(/\n/g, " / ")}`);
  }
}

console.log("Nasdaq Corporate Actions parser verification");
console.log(`Items parsed: ${allItems.length}`);
for (const result of results) {
  console.log(`Source URL: ${result.diagnostics.sourceUrl}`);
  console.log(`Feed items parsed: ${result.diagnostics.parsedFromFeed}`);
  console.log(`ECA items from feed: ${result.diagnostics.ecaItemsFromFeed}`);
  console.log(`Article bodies: ${result.diagnostics.articleBodiesFetched}/${result.diagnostics.articleBodiesRequested}`);
}

console.log("\nEvent family counts:");
printCounts(familyCounts);
console.log("\nCandidate class counts:");
printCounts(classCounts);

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

function printCounts(counts) {
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${key}: ${count}`);
  }
}
