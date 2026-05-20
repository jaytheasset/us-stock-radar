import { fetchNasdaqTraderRawItems } from "../lib/sources/nasdaqtrader/parser.ts";

const args = process.argv.slice(2);
const limit = readLimit(args.find((arg) => /^\d+$/.test(arg)), 25);
const summaryOnly = args.includes("--summary");
const haltDate = readArgValue("--halt-date") || readArgValue("--haltDate");
const resumptionDate = readArgValue("--resumption-date") || readArgValue("--resumptionDate");

const result = await fetchNasdaqTraderRawItems({
  limit,
  haltDate,
  resumptionDate,
});

const failures = [];
if (!result.ok) failures.push(`fetch failed: ${result.error || result.status}`);
if (!result.items.length) failures.push("no Nasdaq Trader halt items parsed");

const classCounts = new Map();
const reasonCounts = new Map();
const actionCounts = new Map();

for (const [index, item] of result.items.entries()) {
  const payload = item.raw_payload || {};
  const halt = readRecord(payload.trade_halt) || {};
  const candidateClass = String(payload.candidate_class || "unknown");
  const policy = readRecord(payload.halt_feed_policy) || {};
  const reasonCode = String(halt.reasonCode || "unknown");
  const action = String(policy.event_action || "unknown");
  const text = String(payload.analysis_text || "");
  const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];

  classCounts.set(candidateClass, (classCounts.get(candidateClass) || 0) + 1);
  reasonCounts.set(reasonCode, (reasonCounts.get(reasonCode) || 0) + 1);
  actionCounts.set(action, (actionCounts.get(action) || 0) + 1);

  if (!item.source_unique_id) failures.push(`${item.title || index}: source_unique_id missing`);
  if (!item.title) failures.push(`${item.source_unique_id || index}: title missing`);
  if (!text) failures.push(`${item.source_unique_id || item.title}: analysis_text missing`);
  if (!tickers.length) failures.push(`${item.source_unique_id || item.title}: ticker missing`);
  if (["LUDP", "LUDS", "M", "T5", "T6"].includes(reasonCode) && candidateClass !== "halt_status_log") {
    failures.push(`${item.source_unique_id}: volatility code ${reasonCode} is not status-log only`);
  }
  if (["T3", "R4", "R9", "C3", "C4", "C9", "C11", "R1", "R2", "MWCQ"].includes(reasonCode) && candidateClass !== "halt_update_only") {
    failures.push(`${item.source_unique_id}: update code ${reasonCode} is not update-only`);
  }
  if (["T1", "T2", "T12", "H4", "H9", "H10", "H11", "D", "M1", "IPO1", "IPOQ", "IPOE"].includes(reasonCode) && candidateClass !== "company_event") {
    failures.push(`${item.source_unique_id}: material code ${reasonCode} is not a company_event`);
  }

  if (!summaryOnly) {
    console.log(`\n#${index + 1} ${item.source_unique_id || "(no id)"}`);
    console.log(`Title: ${item.title}`);
    console.log(`Published: ${item.published_at || "(none)"}`);
    console.log(`Symbol: ${halt.issueSymbol || "(none)"}`);
    console.log(`Reason: ${reasonCode} (${payload.reason_description || "unknown"})`);
    console.log(`Candidate: ${candidateClass}`);
    console.log(`Action: ${action}`);
    console.log(`Text: ${text.replace(/\n/g, " / ")}`);
  }
}

console.log("Nasdaq Trader halt parser verification");
console.log(`Items parsed: ${result.items.length}`);
console.log(`Source URL: ${result.diagnostics.sourceUrl}`);
console.log(`Feed items parsed: ${result.diagnostics.parsedFromFeed}`);

console.log("\nReason counts:");
printCounts(reasonCounts);
console.log("\nCandidate class counts:");
printCounts(classCounts);
console.log("\nFeed action counts:");
printCounts(actionCounts);

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

function readArgValue(name) {
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function printCounts(counts) {
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${key}: ${count}`);
  }
}
