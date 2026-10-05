// Fixture expectations live ONLY here, never in retrieval/selector code.
// Usage: node --experimental-strip-types <this-file> <selected-packets> <original-archive> <NEW-external-output>
// Offline only: original HTML is read transiently to verify provenance, never re-saved or searched.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { renderS4F4SourceHtml } from './sourceSelector.ts';
import { buildS4F4EvidenceIndex } from './evidenceRetrieval.ts';

const [packetsArg, archiveArg, outputArg] = process.argv.slice(2);
if (!packetsArg || !archiveArg || !outputArg) throw new Error('Provide packet directory, archive directory, NEW output directory');
const packets = realpathSync(packetsArg), archive = realpathSync(archiveArg), output = resolve(outputArg);
const inside = (base, path) => { const r = relative(base, path); return !r || (!r.startsWith('..') && !isAbsolute(r)); };
if (existsSync(output) || [packets, archive, process.cwd()].some((p) => inside(p, output))) throw new Error('Output must be new and external');
const fold = (s) => s.toLowerCase().replace(/[|\s]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
const hash = (s) => createHash('sha256').update(s).digest('hex');

// Questions use source-language terms; this is lexical retrieval, not an LLM query translator.
// Each group must occur together in ONE returned unit, avoiding false passes from unrelated fragments.
const questions = [
  { case: 'kodiak', id: 'cash-net', query: '"Available Closing Cash"', limit: 2,
    groups: [['Available Closing Cash', 'transaction expenses of Legacy Kodiak and AACT', 'actually received', '11:59 p.m.']],
    excludes: ['Available Purchaser Closing Cash'] },
  { case: 'kodiak', id: 'cash-purchaser', query: '"Available Purchaser Closing Cash"', limit: 1,
    groups: [['prior to the payment of any Purchaser Transaction Costs and Company Transaction Costs', 'less amounts required for the Redemptions', 'actually received', '11:59 p.m.']],
    excludes: ['"Available Closing Cash"'] },
  { case: 'kodiak', id: 'termination', query: 'termination cure "Outside Date"', limit: 2,
    groups: [['January 26, 2026', 'such other date as may be agreed in writing', 'primary cause of', 'earlier of', '20 days after written notice', 'prior to the Outside Date', 'Company is in material breach', 'Purchaser or Merger Sub is in material breach'],
      ['as the Extension has been obtained, this termination right no longer applies']] },
  { case: 'kodiak', id: 'proposal-dependency', query: 'proposals cross-conditioned adjournment', limit: 2,
    groups: [['Each of the Condition Precedent Proposals is cross-conditioned on the approval of each other',
      'The Advisory Organizational Documents Proposals are conditioned on the approval',
      'The Adjournment Proposal is not conditioned upon the approval of any other proposal']] },
  { case: 'kodiak', id: 'pipe-obligations', query: '"Open Market Purchase Shares" PIPE subscription obligations', limit: 1,
    groups: [['one-for-one basis', 'not sell or otherwise transfer any Open Market Purchase Shares', 'submit a proxy abstaining',
      'not exercise any such redemption rights', 'With respect to Currently Owned Shares', 'vote all of its Currently Owned Shares in favor',
      'Closing occurring substantially concurrently']] },
  { case: 'kodiak', id: 'ownership', query: 'ownership redemption scenarios footnotes', limit: 1, wholeSection: 9,
    groups: [['Footnotes for both tables are set forth below the second table', '289,573,567', '410,123,567',
      'Assumes (i) completion of the contemplated $100.0 million PIPE Investment', '2.34']] },
  { case: 'capitalone', id: 'separate-votes', query: 'Capital One Discover stockholder vote required majority approval', limit: 1,
    groups: [['affirmative vote of a majority of the votes cast by Capital One stockholders',
      'affirmative vote of the holders of a majority of outstanding shares of Discover common stock entitled to vote',
      'will have no effect', 'same effect as a vote cast “AGAINST”']] },
  { case: 'capitalone', id: 'regulatory', query: 'regulatory approvals merger closing conditions', limit: 1,
    groups: [['no such requisite regulatory approval having resulted in the imposition of any materially burdensome regulatory condition',
      'remaining in full force and effect', 'all statutory waiting periods', 'expired or been terminated']] },
  { case: 'capitalone', id: 'termination-extension', query: 'termination merger agreement deadline extension', limit: 1,
    groups: [['February 19, 2025', 'May 19, 2025', 'all other closing conditions', 'are then capable of being satisfied',
      'terminating party is not then in material breach', 'such fewer days as remain prior to the termination date']] },
  { case: 'freenome-current', id: 'cash-waiver', query: '"Aggregate Transaction Proceeds Condition" waiver satisfied notice', limit: 1,
    groups: [['has not been satisfied', 'Freenome may, in its sole discretion, waive', 'within four business days',
      'including after the deadline for submitting redemption requests', 'may not be notified before the deadline']] },
  { case: 'freenome-current', id: 'ownership', query: '"Ownership of New Freenome" redemption footnotes', limit: 1, wholeSection: 21,
    groups: [['113,611,714', '107,021,669', 'do not reflect the impact of any redemptions in connection with the approval of the Extension Amendment Proposal', '(6)', '(9)']] },
  { case: 'firstmajestic', id: 'termination-cure', query: 'termination merger agreement cured outside date', limit: 1,
    groups: [['45 days', 'one business day before the outside date', 'then in material breach', 'April 30, 2025', 'May 31, 2025',
      'to the extent related to antitrust clearances', 'so long as such condition remains capable of being satisfied']] },
  { case: 'firstmajestic', id: 'consideration', query: 'merger consideration exchange ratio', limit: 1,
    groups: [['2.55', 'First Majestic', 'fractional']] },
  { case: 'debt', id: 'exchange-tender', query: 'exchange offer principal amount tendered withdrawn', limit: 2,
    groups: [['equal principal amount of New Notes', 'validly tendered and not properly withdrawn']] },
  { case: 'debt', id: 'waiver-notice', query: 'conditions exchange offer waive five business days', limit: 2,
    groups: [['We may decide to waive any of the conditions in our discretion']],
    acrossHits: ['at least five business days remain in the exchange offer period'] },
];

mkdirSync(output, { recursive: true });
const report = { version: 1, scope: '15 representative source-term queries; context review required in addition to assertions. Not unrestricted natural-language recall.',
  providerCalls: 0, networkCalls: 0, databaseAccess: false, cases: [], questions: [] };
for (const name of [...new Set(questions.map((q) => q.case))]) {
  const packetBytes = readFileSync(resolve(packets, `${name}-selected.json`));
  const packet = JSON.parse(packetBytes.toString('utf8'));
  assert.equal(packet.documents.length, 1);
  const d = packet.documents[0], html = readFileSync(resolve(archive, `${name}-primary.html`), 'utf8');
  assert.equal(d.role, 'current');
  assert.equal(hash(html), d.sha256);
  const index = buildS4F4EvidenceIndex(packet);
  for (const s of index.map.sections) {
    const read = index.read(s.ref);
    assert.equal(read.text, renderS4F4SourceHtml(html.slice(s.htmlStart, s.htmlEnd)));
    const units = index.map.units.filter((u) => u.sectionRef === s.ref);
    assert.equal(units.map((u) => index.read(u.ref).text).join(''), read.text);
  }
  const packetChars = d.sections.reduce((n, s) => n + s.text.length, 0);
  report.cases.push({ case: name, accession: d.accession, htmlSha256: d.sha256, packetFileSha256: hash(packetBytes),
    sections: index.map.sections.length, units: index.map.units.length, packetChars,
    allOriginalSectionCoordinatesVerified: true, allReadUnitsReassembleExactly: true });
  // Metadata only, no packet/text/raw HTML snapshots.
  writeFileSync(resolve(output, `${name}-evidence-map.json`), JSON.stringify(index.map, null, 2));
  for (const q of questions.filter((q) => q.case === name)) {
    const result = index.search({ query: q.query, limit: q.limit, maxChars: 30_000 });
    const reads = result.hits.map((h) => index.read(h.ref));
    const groups = q.groups.map((needles) => ({ needles,
      ref: reads.find((r) => needles.every((n) => fold(r.text).includes(fold(n))))?.ref ?? null }));
    const missingAcross = (q.acrossHits ?? []).filter((n) => !reads.some((r) => fold(r.text).includes(fold(n))));
    const unwanted = (q.excludes ?? []).filter((n) => reads.some((r) => fold(r.text).includes(fold(n))));
    const wholeSection = q.wholeSection === undefined || reads.some((r) => r.text === d.sections[q.wholeSection].text);
    const pass = result.status === 'retrieved' && groups.every((g) => g.ref) && !missingAcross.length
      && !unwanted.length && wholeSection && result.returnedChars < packetChars / 4;
    report.questions.push({ case: name, id: q.id, query: q.query, limit: q.limit, pass, groups, missingAcross, unwanted,
      wholeSectionPreserved: q.wholeSection === undefined ? null : wholeSection,
      returnedChars: result.returnedChars, packetPercent: Number((100 * result.returnedChars / packetChars).toFixed(2)),
      result, excerpts: groups.filter((g) => g.ref).map((g) => {
        const r = reads.find((r) => r.ref === g.ref), at = fold(r.text).indexOf(fold(g.needles[0]));
        return { ref: g.ref, normalizedLocatorOnly: fold(r.text).slice(Math.max(0, at - 80), at + 450) };
      }) });
  }
}
report.assertionPass = report.questions.every((q) => q.pass);
writeFileSync(resolve(output, 'retrieval-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, pass: report.assertionPass,
  questions: report.questions.map(({case: c, id, pass, returnedChars, packetPercent, groups, missingAcross, unwanted, wholeSectionPreserved}) =>
    ({case: c, id, pass, returnedChars, packetPercent, missingGroups: groups.filter((g) => !g.ref), missingAcross, unwanted, wholeSectionPreserved})) }, null, 2));
if (!report.assertionPass) process.exitCode = 1;
