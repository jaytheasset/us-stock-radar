import { fetchOfacRawItems } from "../lib/sources/ofac/parser.ts";

const limit = readLimit(process.argv[2], 5);
const summaryOnly = process.argv.includes("--summary");
const result = await fetchOfacRawItems({
  limit,
  includeArticleBody: true,
  articleBodyLimit: limit,
});

const failures = [];
if (!result.ok) failures.push(`OFAC fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no OFAC items parsed");
if (result.count < limit) failures.push(`requested ${limit} OFAC items but parsed ${result.count}`);
if (!result.diagnostics.articleBodiesFetched) failures.push("no OFAC action bodies fetched");

console.log("OFAC parser verification");
console.log(`Raw items parsed: ${result.count}`);
console.log(`Article bodies fetched: ${result.diagnostics.articleBodiesFetched}/${limit}`);
console.log(`Treasury press release bodies fetched: ${result.diagnostics.pressReleaseBodiesFetched}/${limit}`);
console.log(`Source URL: ${result.diagnostics.sourceUrl}`);
console.log(`List pages fetched: ${result.diagnostics.listPagesFetched || 0}`);

const classCounts = new Map();
const signalCounts = new Map();

for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  const candidateClass = String(item.raw_payload.candidate_class || "unknown");
  const candidateSignals = Array.isArray(item.raw_payload.candidate_signals)
    ? item.raw_payload.candidate_signals
    : [];
  const analysisText = String(item.raw_payload.analysis_text || "");
  const fullTextHtml = String(item.raw_payload.full_text_html || "");

  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  for (const signal of candidateSignals) {
    signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
  }

  if (!item.source_unique_id) {
    failures.push(`${item.source_url}: source_unique_id missing`);
  }
  if (index < limit && !item.body_text) {
    failures.push(`${item.source_unique_id || item.source_url}: body_text missing`);
  }
  if (item.body_text && !analysisText) {
    failures.push(`${item.source_unique_id || item.source_url}: analysis_text missing`);
  }
  if (fullTextHtml.includes("<script")) {
    failures.push(`${item.source_unique_id || item.source_url}: full_text_html contains script tag`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`URL: ${item.source_url}`);
    console.log(`Title: ${item.title}`);
    console.log(`Published: ${item.published_at || "(none)"}`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Signals: ${candidateSignals.join(", ") || "(none)"}`);
    console.log(`Body chars: ${item.body_text?.length || 0}`);
    console.log(`Analysis chars: ${analysisText.length}`);
    console.log(`Press release URL: ${item.raw_payload.action_payload?.press_release_url || "(none)"}`);
    console.log(`Body first 260: ${(item.body_text || "").slice(0, 260).replace(/\n/g, " / ")}`);
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
