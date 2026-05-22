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

console.log("sec s3-f3 parser fixtures passed");

function readFixture(name: string): SecS3ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as SecS3ParseInput;
}
