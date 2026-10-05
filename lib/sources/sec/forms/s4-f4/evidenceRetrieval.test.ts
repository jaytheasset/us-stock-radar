import test from "node:test";
import assert from "node:assert/strict";
import { selectS4F4Sources } from "./sourceSelector.ts";
import { buildS4F4EvidenceIndex } from "./evidenceRetrieval.ts";

const source = (html: string) => ({ accession: "current-accession", url: "https://example.test/current.htm",
  filename: "current.htm", role: "current" as const, html });
const packet = (html: string) => selectS4F4Sources({ form: "S-4", documents: [source(html)] });

test("exact named terms return separate original definitions, never computed facts", () => {
  const p = packet('<h2>Closing Conditions</h2><p>😀 Net Cash means proceeds less expenses.</p><h2>Other Information</h2>'
    + '<h2>Merger Consideration</h2><p>Gross Cash means proceeds before expenses.</p><h2>End Information</h2>');
  const index = buildS4F4EvidenceIndex(p);
  const result = index.search({ query: '"Net Cash"' });
  assert.equal(result.hits.length, 1);
  const read = index.read(result.hits[0].ref);
  assert.equal(read.text, p.documents[0].sections[0].text);
  assert.doesNotMatch(read.text, /Gross Cash/);
  assert.equal(read.section.htmlStart, p.documents[0].sections[0].htmlStart);
  assert.match(read.coordinates, /UTF-16/);
  assert.ok(!JSON.stringify(index.map).includes("less expenses"));
  assert.ok(!JSON.stringify(index.map).includes("<h2>"));
});

test("current is the default; parent and exhibit need explicit isolated retrieval", () => {
  const s = source('<h1>Closing Conditions</h1><p>Cash condition may be waived.</p>');
  const p = selectS4F4Sources({ form: "S-4/A", documents: [s,
    { ...s, accession: "parent", role: "parent", purpose: "amendment-comparison" },
    { ...s, accession: "exhibit", role: "exhibit", purpose: "direct-supplement" }] });
  const index = buildS4F4EvidenceIndex(p);
  for (const role of [undefined, "parent", "exhibit"] as const) {
    const r = index.search({ query: "Cash", role });
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].document.role, role ?? "current");
    assert.equal(index.read(r.hits[0].ref).document.role, role ?? "current");
  }
  assert.equal(index.search({ query: "Cash", accession: "parent" }).hits.length, 0);
});

test("stable references survive section order changes and exported metadata mutation", () => {
  const p = packet('<h2>Closing Conditions</h2><p>Cash condition.</p><h2>Merger Consideration</h2><p>Share exchange.</p>');
  const first = buildS4F4EvidenceIndex(p);
  const copied = structuredClone(p);
  copied.documents[0].sections.reverse();
  const second = buildS4F4EvidenceIndex(copied);
  const ref = first.search({ query: "Cash" }).hits[0].ref;
  assert.equal(second.search({ query: "Cash" }).hits[0].ref, ref);
  first.map.units[0].textStart = 10000;
  assert.match(first.read(ref).text, /Cash condition/);
  assert.throws(() => first.read("section:missing"), /Unknown/);
});

test("mutated text, document identity and HTML coordinates fail closed", () => {
  for (const mutate of [
    (p: ReturnType<typeof packet>) => { p.documents[0].sections[0].text += "tampered"; },
    (p: ReturnType<typeof packet>) => { p.documents[0].accession = "wrong"; },
    (p: ReturnType<typeof packet>) => { p.documents[0].sections[0].htmlStart++; },
  ]) {
    const p = packet('<h1>Closing Conditions</h1><p>Cash required.</p>'), index = buildS4F4EvidenceIndex(p);
    const ref = index.map.units[0].ref;
    mutate(p);
    assert.throws(() => index.read(ref), /Stale/);
    assert.throws(() => index.search({ query: "Cash" }), /Stale/);
  }
});

test("long text is partitioned only outside tables; all rows, notes and exact characters survive", () => {
  const p = packet('<h1>Merger Consideration</h1><p>Introduction.</p>');
  const table = '[TABLE]\n\n|Scenario Heading|\n\n|[colspan=2]Amount|\n\n|42|\n[/TABLE]';
  p.documents[0].sections[0].text = 'Transaction Overview\n\n' + 'Original context. '.repeat(1500)
    + '\n\nOwnership Scenarios\n\n' + table + '\n\n(1) Assumes funding; exceptions remain.\n\n'
    + 'Termination Conditions\n\nTwenty days, unless the earlier deadline applies.';
  const index = buildS4F4EvidenceIndex(p);
  const sourceText = p.documents[0].sections[0].text;
  assert.equal(index.map.units.map((u) => index.read(u.ref).text).join(""), sourceText);
  const r = index.search({ query: '"Ownership Scenarios"', limit: 1 });
  const read = index.read(r.hits[0].ref);
  assert.ok(read.text.includes(table));
  assert.match(read.text, /\(1\) Assumes funding; exceptions remain/);
  assert.equal(read.range?.tables.length, 1);
  assert.equal(index.read(read.section.ref).text, sourceText);
});

test("context budgets defer intact evidence and never silently truncate large sections", () => {
  const p = packet('<h1>Closing Conditions</h1><p>' + 'Unbroken condition. '.repeat(2000) + '</p>');
  const index = buildS4F4EvidenceIndex(p), r = index.search({ query: "condition", maxChars: 100 });
  assert.equal(r.status, "needs-larger-context-budget");
  assert.equal(r.hits.length, 0);
  assert.equal(r.deferred.length, 1);
  assert.equal(index.read(r.deferred[0].ref).text, p.documents[0].sections[0].text);
});

test("no match, placeholders and external references never become absence or inferred facts", () => {
  const p = packet('<h1>Closing Conditions</h1><p>Meeting date [●]. See separate subscription agreement.</p>');
  const index = buildS4F4EvidenceIndex(p);
  assert.equal(index.search({ query: '"outside date"' }).status, "no-match-in-selected-source");
  assert.equal(index.search({ query: "" }).hits.length, 0);
  const read = index.read(index.search({ query: "meeting date" }).hits[0].ref);
  assert.match(read.text, /\[●\]/);
  assert.match(read.limitations.join(" "), /remain unresolved/);
});

test("Primary analysis and extra packet fields are never evidence inputs", () => {
  const p = { ...packet('<h1>Closing Conditions</h1><p>Unresolved pending approval.</p>'),
    summary: 'secret_primary_marker approved', score: 99, signal: 'secret_primary_marker',
    rawPayload: { analysis_text: 'secret_primary_marker' } };
  const index = buildS4F4EvidenceIndex(p);
  assert.equal(index.search({ query: '"secret_primary_marker"' }).hits.length, 0);
  assert.doesNotMatch(JSON.stringify(index.map), /secret_primary_marker|rawPayload/);
});

test("unsupported form and ambiguous table boundaries are rejected", () => {
  const p = packet('<h1>Closing Conditions</h1><p>Cash required.</p>');
  assert.throws(() => buildS4F4EvidenceIndex({ ...p, form: "425" as never }), /Invalid/);
  p.documents[0].sections[0].text = '[TABLE]missing end';
  assert.throws(() => buildS4F4EvidenceIndex(p), /Unbalanced/);
});
