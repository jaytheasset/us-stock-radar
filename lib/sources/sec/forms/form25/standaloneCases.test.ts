import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSecForm25Filing } from "./parser";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25", "fixtures");

const cases = [
  {
    fixture: "common-share-delisting.json",
    expected_case: "exchange_forced_delisting",
    required_source: /no longer qualified for listing[\s\S]*did not appeal[\s\S]*suspended/i,
  },
  {
    fixture: "voluntary-withdrawal-continued-listing.json",
    expected_case: "voluntary_withdrawal_with_continued_listing",
    required_source: /eliminate duplicative administrative burdens[\s\S]*continue to be listed/i,
  },
  {
    fixture: "merger-completion-removal.json",
    expected_case: "completed_merger_cleanup",
    required_source: /merger between Hess Corporation and Chevron Corporation[\s\S]*1\.025 shares/i,
  },
  {
    fixture: "matured-debt-removal.json",
    expected_case: "matured_or_retired_non_common_security",
    required_source: /matur|redeem|retir|paid/i,
  },
  {
    fixture: "rule-a3-warrant-substitution-needs-analysis.json",
    expected_case: "security_substitution",
    required_source: /12d2-2\(a\)\(3\)|substitut|warrant/i,
  },
  {
    fixture: "missing-reason-requires-llm.json",
    expected_case: "standalone_reason_unclear",
    required_source: /Form 25|25-NSE|12d2-2/i,
  },
] as const;

for (const testCase of cases) {
  const parsed = parseSecForm25Filing(readFixture(testCase.fixture));
  const directSourceText = parsed.raw.directSourceBlocks.map((block) => block.text).join("\n");

  assert.ok(parsed.raw.directSourceBlocks.length > 0, `${testCase.expected_case}: direct source blocks required`);
  assert.match(directSourceText, testCase.required_source, `${testCase.expected_case}: required original context missing`);
  assert.deepEqual(parsed.signals, [], `${testCase.expected_case}: parser must not classify the event`);
}

console.log("sec form25 standalone source cases passed");

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}
