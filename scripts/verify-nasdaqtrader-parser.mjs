import { fetchNasdaqTraderRawItems } from "../lib/sources/nasdaqtrader/parser.ts";

const limit = readLimit(process.argv[2], 20);
const summaryOnly = process.argv.includes("--summary");
const result = await fetchNasdaqTraderRawItems({ limit });

const failures = [];
if (!result.ok) failures.push(`Nasdaq Trader fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no Nasdaq Trader trade halt items parsed");

console.log("Nasdaq Trader parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Feed items parsed: ${result.diagnostics.parsedFromFeed}`);
console.log(`Source URL: ${result.diagnostics.sourceUrl}`);

const classCounts = new Map();
const codeCounts = new Map();

for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  const candidateClass = String(item.raw_payload.candidate_class || "unknown");
  const halt = item.raw_payload.trade_halt && typeof item.raw_payload.trade_halt === "object"
    ? item.raw_payload.trade_halt
    : {};
  const reasonCode = String(halt.reasonCode || "unknown");
  const analysisText = String(item.raw_payload.analysis_text || "");
  const fullTextHtml = String(item.raw_payload.full_text_html || "");

  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  codeCounts.set(reasonCode, (codeCounts.get(reasonCode) || 0) + 1);

  if (!item.source_unique_id) {
    failures.push(`${item.title || item.source_url}: source_unique_id missing`);
  }
  if (!item.body_text) {
    failures.push(`${item.source_unique_id || item.title}: body_text missing`);
  }
  if (!analysisText) {
    failures.push(`${item.source_unique_id || item.title}: analysis_text missing`);
  }
  if (fullTextHtml.includes("<script")) {
    failures.push(`${item.source_unique_id || item.title}: full_text_html contains script tag`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`Title: ${item.title}`);
    console.log(`Published: ${item.published_at || "(none)"}`);
    console.log(`Symbol: ${halt.issueSymbol || "(none)"}`);
    console.log(`Issue: ${halt.issueName || "(none)"}`);
    console.log(`Market: ${halt.market || "(none)"}`);
    console.log(`Reason: ${reasonCode} - ${item.raw_payload.reason_description || "(none)"}`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Text: ${analysisText.replace(/\n/g, " / ")}`);
  }
}

console.log("\nReason code counts:");
printCounts(codeCounts);
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

function printCounts(counts) {
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${key}: ${count}`);
  }
}
