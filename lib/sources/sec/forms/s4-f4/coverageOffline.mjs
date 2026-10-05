// Explicit local archive only. No fetch, provider, environment or database imports.
// node --experimental-strip-types lib/sources/sec/forms/s4-f4/coverageOffline.mjs <archive-dir> <new-output-dir>
import { readFileSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument, DomUtils } from 'htmlparser2';
import { selectS4F4Sources, renderS4F4SourceHtml } from './sourceSelector.ts';

const [archiveArg, outputArg] = process.argv.slice(2);
if (!archiveArg || !outputArg) throw new Error('Provide existing archive and NEW external output directory');
const archive = realpathSync(archiveArg), output = resolve(outputArg);
const inside = (base, path) => { const r = relative(base, path); return !r || (!r.startsWith('..') && !isAbsolute(r)); };
if (existsSync(output) || inside(archive, output) || inside(process.cwd(), output)) throw new Error('Output must be new and outside archive/repository');
const audit = JSON.parse(readFileSync(resolve(archive, 'coverage-audit.json'), 'utf8'));
if (audit.evidence.length !== 42) throw new Error('Expected unchanged 42 evidence audit');
const cases = [
  ['capitalone', 'S-4', '0001193125-24-101304'],
  ['kodiak', 'S-4', '0001193125-25-119920'],
  ['freenome-current', 'S-4/A', '0001140361-26-023561'],
  ['firstmajestic', 'F-4', '0001193125-24-236901'],
  ['debt', 'S-4', '0001193125-25-324922'],
];
const normalize = (s) => s.replace(/\[\/?TABLE\]|\[(?:colspan|rowspan)=[^\]]+\]/g, ' ')
  .replace(/[|\s]+/g, ' ').replace(/[\u0091\u0092‘’]/g, "'").replace(/[\u0093\u0094“”]/g, '"')
  .replace(/[\u0096\u0097–—]/g, '-').trim();
mkdirSync(output, { recursive: true });
const report = { version: 1, originalAuditSha256: createHash('sha256').update(readFileSync(resolve(archive,'coverage-audit.json'))).digest('hex'),
  scope: 'Phrase presence is a review locator, NOT semantic sufficiency. Current-only selection; optional documents are not automatically added.',
  llmCalls: 0, networkCalls: 0, databaseAccess: false, cases: [], evidence: [], sourceAbsences: [], tableChecks: [] };
const tableAudit = JSON.parse(readFileSync(resolve(archive, 'table-evidence.json'), 'utf8'));
const review = [];
for (const [id, form, accession] of cases) {
  const html = readFileSync(resolve(archive, `${id}-primary.html`), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(archive, `${id}-primary-acquisition.json`), 'utf8'));
  const pkg = selectS4F4Sources({ form, documents: [{ accession, url: manifest.url,
    filename: basename(new URL(manifest.url).pathname), role: 'current', html }] });
  const d = pkg.documents[0];
  if (d.sha256 !== manifest.sha256) throw new Error(`Archive hash mismatch: ${id}`);
  const renderedSource = normalize(renderS4F4SourceHtml(html));
  const sections = d.sections.map((s) => ({ ...s, normalized: normalize(s.text) }));
  for (const s of sections) {
    if (s.text !== renderS4F4SourceHtml(html.slice(s.htmlStart,s.htmlEnd))) throw new Error('Section coordinate mismatch');
  }
  const tables = DomUtils.findAll((n) => n.name === 'table', parseDocument(html, { withStartIndices:true, withEndIndices:true }).children);
  for (const t of tableAudit.filter((t) => t.case === id)) {
    if (t.rawDocumentSha256 !== d.sha256) throw new Error('Table archive hash mismatch');
    const table = tables[t.tableOrdinalZeroBased];
    const tableStart = table.startIndex, tableEnd = table.endIndex + 1;
    const selectedSection = sections.findIndex((s) => s.htmlStart <= tableStart && s.htmlEnd >= tableEnd);
    report.tableChecks.push({ case:id, ordinal:t.tableOrdinalZeroBased, tableStart, tableEnd, selectedSection,
      wholeTablePreserved: selectedSection >= 0,
      historicalTableTextMatches: normalize(DomUtils.textContent(table)).replace(/\s/g,'') === normalize(t.text).replace(/\s/g,'') });
  }
  writeFileSync(resolve(output, `${id}-selected.json`), JSON.stringify(pkg, null, 2));
  report.cases.push({ id, accession, sha256: d.sha256, sections: sections.length, tocBodyMatches: d.tocBodyMatches,
    metrics: pkg.metrics, serializedPackageUtf8Bytes: Buffer.byteLength(JSON.stringify(pkg)),
    selectedHeadings: sections.map(({ heading, htmlStart, htmlEnd, text }) => ({ heading, htmlStart, htmlEnd, chars: text.length })) });
  for (const e of audit.evidence.filter((e) => e.case === id)) {
    const probe = normalize(e.probe), matches = [];
    sections.forEach((s, sectionIndex) => {
      const index = s.normalized.indexOf(probe);
      if (index >= 0) matches.push({ sectionIndex, heading: s.heading, htmlStart: s.htmlStart, htmlEnd: s.htmlEnd,
        context: s.normalized.slice(Math.max(0, index - 1200), index + probe.length + 2000) });
    });
    const sourceIndex = renderedSource.indexOf(probe);
    report.evidence.push({ id: e.auditEvidenceId, case: id, topic: e.topic, probe: e.probe,
      sourcePresent: sourceIndex >= 0, selectedPresent: matches.length > 0, matches,
      sourceContext: sourceIndex < 0 ? null : renderedSource.slice(Math.max(0,sourceIndex-1200),sourceIndex+probe.length+2000),
      reviewStatus: 'requires-direct-context-review' });
    review.push(`## ${e.auditEvidenceId} ${id} ${e.topic}\nProbe: ${e.probe}\nSelected matches: ${matches.length}\n` +
      (matches.length ? matches.map((m) => `${m.heading} [HTML ${m.htmlStart}:${m.htmlEnd}]\n${m.context}`).join('\n\n') :
        `SOURCE ONLY:\n${renderedSource.slice(Math.max(0,sourceIndex-1200),sourceIndex+probe.length+2000)}`));
  }
  for (const a of audit.sourceAbsences.filter((a) => a.case === id)) {
    report.sourceAbsences.push({ ...a, retainedExactQuote: sections.some((s) => s.normalized.includes(normalize(a.quote))),
      sourceExactQuote: renderedSource.includes(normalize(a.quote)), reviewStatus: 'requires-placeholder-context-review' });
  }
}
writeFileSync(resolve(output, 'coverage-locators.json'), JSON.stringify(report,null,2));
writeFileSync(resolve(output, 'context-review.md'), review.join('\n\n'));
console.log(JSON.stringify({ output, retainedPhraseLocators: report.evidence.filter((e) => e.selectedPresent).length,
  total: report.evidence.length, cases: report.cases.map(({id,sections,tocBodyMatches,metrics}) => ({id,sections,tocBodyMatches,metrics})),
  missing: report.evidence.filter((e) => !e.selectedPresent).map(({id,case:c,probe,sourcePresent})=>({id,case:c,probe,sourcePresent})) },null,2));
