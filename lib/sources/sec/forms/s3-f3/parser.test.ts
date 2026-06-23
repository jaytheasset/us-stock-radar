import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSecS3Filing, type SecS3ParseInput } from "./parser";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "s3-f3", "fixtures");

const f3Resale = parseSecS3Filing(readFixture("f3-resale.json"));
assert.equal(f3Resale.form_type, "F-3");
assert.equal(f3Resale.is_s3_family, true);
assert.equal(f3Resale.registration_status?.value, "filed_not_effective");
assert.equal(f3Resale.primary_or_resale?.value, "resale");
assert.equal(f3Resale.shares_registered?.value, 12345678);
assert.ok(f3Resale.securities_registered.some((security) => security.value === "ordinary_shares"));
assert.equal(f3Resale.current_shares_outstanding?.value, 50000000);
assert.ok(f3Resale.plan_of_distribution_section);
assert.ok(f3Resale.use_of_proceeds_section);

const f3Amendment = parseSecS3Filing(readFixture("f3a-routine-amendment.json"));
assert.equal(f3Amendment.form_type, "F-3/A");
assert.equal(f3Amendment.is_s3_family, true);
assert.equal(f3Amendment.amendment.is_amendment, true);
assert.equal(f3Amendment.amendment.amendment_number?.value, 1);
assert.equal(f3Amendment.amendment.registration_number?.value, "333-123456");
assert.equal(f3Amendment.amendment.unchanged_remainder_not_included, true);
assert.equal(f3Amendment.amendment.added_exhibits.length, 1);
assert.ok(f3Amendment.amendment.limited_scope_signal_candidates.some((signal) => signal.value === "no_other_changes"));

const f3Asr = parseSecS3Filing(readFixture("f3asr-automatic-shelf.json"));
assert.equal(f3Asr.form_type, "F-3ASR");
assert.equal(f3Asr.is_s3_family, true);
assert.equal(f3Asr.issuer, "Global Sample PLC");
assert.equal(f3Asr.registration_statement_kind?.value, "automatic_shelf_registration");
assert.equal(f3Asr.registration_status?.value, "automatically_effective");
assert.equal(f3Asr.offering_terms.offering_type?.value, "universal_shelf");
assert.ok(f3Asr.securities_registered.length >= 3);

const s3AtmSupplement = parseSecS3Filing({
  title: "Sample Bio files S-3",
  bodyText: `
### S-3
PROSPECTUS
Sample Bio Inc.
We may offer common stock, preferred stock, debt securities, warrants, rights and units from time to time.

PROSPECTUS SUPPLEMENT
Up to $100,000,000
Common Stock

THE OFFERING
Common stock offered by us: shares of common stock having an aggregate offering price of up to $100,000,000.
Manner of offering: "At the market offering" that may be made from time to time through our sales agent, Jefferies.

USE OF PROCEEDS
We plan to use the net proceeds from this offering for general corporate purposes.

PLAN OF DISTRIBUTION
We have entered into the Sale Agreement with Jefferies, under which we may offer and sell up to $100,000,000
of our shares of common stock from time to time through Jefferies acting as agent. Sales will be made by any method
deemed to be an "at the market offering" as defined in Rule 415(a)(4) under the Securities Act.
`,
});
const s3AtmBlocks = s3AtmSupplement.cleaned_source_blocks.map((block) => block.text).join("\n");
assert.ok(s3AtmBlocks.includes("Jefferies"));
assert.ok(s3AtmBlocks.includes("$100,000,000"));
assert.ok(/Rule 415\(a\)\(4\)/.test(s3AtmBlocks));
assert.ok(s3AtmSupplement.cleaned_source_blocks.some((block) => /ATM|Offering|Distribution/i.test(block.label)));

const s3PureShelf = parseSecS3Filing({
  title: "Sample Shelf files S-3",
  bodyText: `
### S-3
PROSPECTUS
Sample Shelf Inc.
We may offer from time to time common stock, preferred stock, debt securities, warrants, rights and units.
The securities may be offered on a delayed or continuous basis under Rule 415.
General Instruction I.B.6 may limit sales to one-third of our public float.
This filing does not launch an active sale.
`,
});
const pureShelfBlocks = s3PureShelf.cleaned_source_blocks.map((block) => block.text).join("\n");
assert.ok(pureShelfBlocks.includes("one-third of our public float"));
assert.equal(/Jefferies|at the market offering|Sale Agreement/i.test(pureShelfBlocks), false);

console.log("sec s3-f3 parser fixtures passed");

function readFixture(name: string): SecS3ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as SecS3ParseInput;
}
