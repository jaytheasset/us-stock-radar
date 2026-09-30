import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { officialListQuarterFromUrl, parseSec13fOfficialList } from "./parser.ts";

const q1Url = "https://www.sec.gov/files/investment/13flist2026q1.txt";
const q2Url = "https://www.sec.gov/files/investment/13flist2026q2-txt.txt";

function line(cusip: string, optionIndicator: string, issuer: string, description: string, status: string) {
  return cusip + optionIndicator + issuer.padEnd(30) + description.padEnd(27) + status + " ".repeat(9) + "E";
}

const lines = [
  line("123456789", "*", "EXAMPLE ISSUER", "COM CL A", "*A*"),
  line("123456900", " ", "EXAMPLE ISSUER", "CALL", "   "),
  line("123456901", " ", "EXAMPLE ISSUER", "WARRANT", "*D*"),
];

test("quarterly SEC list preserves raw source, fixed-width fields, and status", () => {
  const raw = Buffer.from(`${lines.join("\n")}\n`, "ascii");
  const snapshot = parseSec13fOfficialList({
    sourceUrl: q2Url, expectedQuarter: "2026Q2", sourceBytes: raw,
    fetchedAt: "2026-07-10T00:00:00Z",
  });
  assert.equal(snapshot.quarterEnd, "2026-06-30");
  assert.equal(snapshot.sourceSha256, createHash("sha256").update(raw).digest("hex"));
  assert.deepEqual(Buffer.from(snapshot.sourceBytes), raw);
  assert.deepEqual(snapshot.entries.map((entry) => entry.status), ["added", "unchanged", "deleted"]);
  assert.deepEqual(snapshot.entries.map((entry) => entry.optionIndicator), ["*", " ", " "]);
  assert.equal(snapshot.entries[0].issuerName, "EXAMPLE ISSUER");
  assert.equal(snapshot.entries[0].securityDescription, "COM CL A");
  assert.equal(snapshot.entries[2].rawLine, lines[2]);
});

test("different quarter versions remain distinct, even with identical rows", () => {
  const raw = Buffer.from(`${lines[0]}\n`, "ascii");
  const q1 = parseSec13fOfficialList({ sourceUrl: q1Url, sourceBytes: raw, fetchedAt: "2026-04-01" });
  const q2 = parseSec13fOfficialList({ sourceUrl: q2Url, sourceBytes: raw, fetchedAt: "2026-07-01" });
  assert.equal(q1.quarterEnd, "2026-03-31");
  assert.equal(q2.quarterEnd, "2026-06-30");
  assert.notEqual(q1.quarter, q2.quarter);
  assert.equal(q1.sourceSha256, q2.sourceSha256);
});

test("rejects unexpected URL, quarter, line width, and status", () => {
  assert.throws(() => officialListQuarterFromUrl("https://example.com/13flist2026q1.txt"));
  assert.throws(() => parseSec13fOfficialList({
    sourceUrl: q2Url, expectedQuarter: "2026Q1", sourceBytes: Buffer.from(`${lines[0]}\n`), fetchedAt: "2026-07-01",
  }));
  assert.throws(() => parseSec13fOfficialList({
    sourceUrl: q1Url, sourceBytes: Buffer.from("short\n"), fetchedAt: "2026-04-01",
  }));
  assert.throws(() => parseSec13fOfficialList({
    sourceUrl: q1Url, sourceBytes: Buffer.from(`${line("123456789", " ", "EXAMPLE", "COM", "*X*")}\n`),
    fetchedAt: "2026-04-01",
  }));
});
