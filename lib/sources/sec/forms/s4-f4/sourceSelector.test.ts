import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectS4F4Sources, renderS4F4SourceHtml, type S4F4SourceDocument } from "./sourceSelector.ts";

const doc = (html: string): S4F4SourceDocument => ({ accession: "test-accession", url: "https://example.test/source.htm",
  filename: "source.htm", role: "current", html });
const select = (html: string) => selectS4F4Sources({ form: "S-4", documents: [doc(html)] });

test("TOC resolves body and retains section including tables, following notes and conditions", () => {
  const html = `<a href="#deal">THE MERGER AGREEMENT</a><a href="#other">OTHER INFORMATION</a>
    <h1 id="deal">THE MERGER AGREEMENT</h1><h2>Closing Conditions</h2><p>Approval unless waived.</p>
    <table><tr><th colspan="2">No redemptions</th></tr><tr><td>Holders</td><td>42</td></tr></table>
    <p>(1) Assumes funding, subject to adjustment.</p><h2>Representations</h2><p>Exceptions remain.</p>
    <h1 id="other">OTHER INFORMATION</h1><p>Excluded unrelated body</p>`;
  const result = select(html), d = result.documents[0], s = d.sections[0];
  assert.equal(d.tocBodyMatches, 2);
  assert.equal(d.sections.length, 1);
  assert.match(s.text, /colspan=2/);
  assert.match(s.text, /Holders\|\|42/);
  assert.match(s.text, /Assumes funding/);
  assert.match(s.text, /Exceptions remain/);
  assert.doesNotMatch(s.text, /Excluded unrelated/);
  assert.equal(s.text, renderS4F4SourceHtml(html.slice(s.htmlStart, s.htmlEnd)));
  assert.equal(d.sha256, createHash("sha256").update(html).digest("hex"));
});

test("body heading fallback preserves context beyond old 240KB cap", () => {
  const body = "A contractual condition with exception. ".repeat(8000);
  const r = select(`<h2>Conditions to Closing</h2><p>${body}</p><h2>Other information</h2>`);
  assert.ok(r.metrics.utf8Bytes > 240000);
  assert.ok(r.documents[0].sections[0].text.includes(body.trim()));
  assert.match(r.metrics.localTokenEstimate.method, /NOT Gemini/);
});

test("missing TOC target does not establish absence or select TOC-only evidence", () => {
  const r = select('<p><a href="#missing">Conditions to Closing</a></p><p>No body heading available.</p>');
  assert.equal(r.documents[0].coverage, "no-core-heading-selected");
  assert.equal(r.documents[0].sections.length, 0);
});

test("current amendment works without parent; explicit comparison remains separately attributed", () => {
  const current = doc('<h1>Extension</h1><p>Proposed deadline, subject to approval.</p>');
  const r = selectS4F4Sources({ form: "S-4/A", documents: [current] });
  assert.equal(r.amendmentComparison, "parent-not-provided-current-still-selectable");
  assert.equal(r.documents[0].sections.length, 1);
  assert.throws(() => selectS4F4Sources({ form: "S-4/A", documents: [current, { ...current, role: "parent" }] }));
  const compared = selectS4F4Sources({ form: "S-4/A", documents: [current,
    { ...current, role: "parent", purpose: "amendment-comparison", accession: "parent" }] });
  assert.equal(compared.documents[1].role, "parent");
  assert.equal(compared.documents[1].accession, "parent");
});

test("direct economic definitions remain bounded; output never embeds original HTML", () => {
  const html = '<p>“Available Closing Cash” means trust cash plus funding less redemptions.</p><p>UNSELECTED_RAW_MARKER</p>';
  const r = select(html);
  assert.match(r.documents[0].sections[0].text, /less redemptions/);
  assert.doesNotMatch(JSON.stringify(r), /UNSELECTED_RAW_MARKER/);
  assert.ok(!("html" in r.documents[0]));
});

test("rejects other forms and implicit exhibit use", () => {
  assert.throws(() => selectS4F4Sources({ form: "425" as "S-4", documents: [doc("")] }));
  assert.throws(() => selectS4F4Sources({ form: "F-4", documents: [doc(""), { ...doc(""), role: "exhibit" }] }));
});

test("ownership Q&A retains column captions and separate footnote tables", () => {
  const r = select(`<!DOCTYPE html><table><tr><td>Q.</td><td><p><b>What equity stake will holders own after closing?</b></p></td></tr></table>
    <table><tr><th><p><b>COMMON STOCK</b></p></th><th><p><b>OWNERSHIP</b></p></th></tr>
    <tr><td>Holders</td><td>42%</td></tr></table>
    <table><tr><td>(1)</td><td><p><b>Subject to funding</b></p><p>Full condition and exception.</p></td></tr></table>
    <h2>Other information</h2><p>Unrelated</p>`);
  assert.equal(r.documents[0].sections.length,1);
  const s = r.documents[0].sections[0];
  assert.match(s.text,/COMMON STOCK/);
  assert.match(s.text,/Full condition and exception/);
  assert.doesNotMatch(s.text,/Unrelated/);
});

test("direct definition keeps continuation across page furniture, stops before next definition", () => {
  const r = select('<p>“Base Purchase Price” means the base less converted debt. For avoidance of</p><p>77</p><p>Table of Contents</p><p>doubt, exclude converted shares.</p><p>“Other Term” means unrelated.</p>');
  assert.match(r.documents[0].sections[0].text,/exclude converted shares/);
  assert.doesNotMatch(r.documents[0].sections[0].text,/unrelated/);
});
