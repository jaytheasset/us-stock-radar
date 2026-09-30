import assert from "node:assert/strict";
import test from "node:test";
import { fetchSec13fOfficialList } from "./fetch.ts";
import { parseSec13f2025Q3PdfRow } from "./pdf2025q3.ts";

function row(cusip: string, description: string, status = "", option = false) {
  return parseSec13f2025Q3PdfRow([
    { x: 70, text: `${cusip.slice(0, 6)} ${cusip.slice(6, 8)} ${cusip.slice(8)}${option ? " *" : ""}` },
    { x: 164.75, text: "CMB.TECH NV" },
    { x: 349.5, text: description },
    ...(status ? [{ x: 486.25, text: status }] : []),
  ], 3, 1);
}

test("PDF rows retain page, class, option marker, and printed status", () => {
  const ordinary = row("B38564108", "SHS", "", true);
  const call = row("B38564908", "CALL", "ADDED");
  const put = row("B38564958", "PUT", "DELETED");
  assert.equal(ordinary.sourcePage, 3);
  assert.equal(ordinary.optionIndicator, "*");
  assert.equal(ordinary.securityDescription, "SHS");
  assert.deepEqual([call.securityDescription, put.securityDescription], ["CALL", "PUT"]);
  assert.deepEqual([call.statusRaw, put.statusRaw], ["ADDED", "DELETED"]);
  assert.deepEqual([call.status, put.status], ["added", "deleted"]);
  assert.match(call.rawLine, /B38564 90 8 CMB\.TECH NV CALL ADDED/);
});

test("PDF row extraction rejects missing security fields or unknown status", () => {
  assert.throws(() => row("B38564908", "", "ADDED"));
  assert.throws(() => row("B38564908", "CALL", "UNKNOWN"));
});

test("the known duplicated 2025 Q3 TXT cannot enter the normal TXT fetch path", async () => {
  await assert.rejects(
    fetchSec13fOfficialList({
      sourceUrl: "https://www.sec.gov/files/investment/13flist2025q3-txt.txt",
      expectedQuarter: "2025Q3", userAgent: "test-user-agent",
    }),
    /official Q3 PDF fallback/,
  );
});
