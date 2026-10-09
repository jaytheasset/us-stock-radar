import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const component = readFileSync('components/filing-analysis-v2/ProjectedOfferingDilution.tsx', 'utf8');
const compiled = ts.transpileModule(component, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} as { ProjectedOfferingDilution: (props: unknown) => unknown } };
new Function('require', 'module', 'exports', compiled)((name: string) => name.endsWith('.module.css') ? { default: {} } : require(name), module, module.exports);
const render = (read: unknown) => renderToStaticMarkup(React.createElement(module.exports.ProjectedOfferingDilution, { read }));
const read = {
  status: 'available', sourceUrl: 'https://www.sec.gov/example', evidence: [{ id: 'e1', text: 'Pré-funded £ — underlying evidence' }],
  facts: {
    accession: '0000000001-26-991100', pre_offering_os: [{ quantity: '1000000', share_class: 'Ordinary Pré-funded £ shares', as_of_date: '2026-10-08' }],
    issuer_new_shares_base: 200000, resale_shares: 50000, calculated_post_os_base: 1200000, projected_increase_percent_base: 20,
    issuer_new_shares_full_overallotment: 230000, calculated_post_os_full_overallotment: 1230000, projected_increase_percent_full_overallotment: 23,
    potential_warrant_shares: 0, resale_components: [], unavailable_reason: [], direct_post_offering_os: [],
  },
};

test('projected screen keeps base, full option, resale and evidence in distinct labeled sections', () => {
  const html = render(read);
  for (const text of ['기본 시나리오', '초과배정 전량 행사 시', '기존 주주 재판매량', '200,000주', '50,000주', '1,200,000주', '1,230,000주', '20%', '23%', '공모 계획 기준', '실제 O/S 증가를 의미하지 않습니다.', 'Pré-funded £', read.facts.accession]) assert.ok(html.includes(text), text);
});

test('unavailable and private facts never render a zero-percent projection', () => {
  assert.equal(render({ status: 'not_ready', reason: 'public_pair_unavailable' }), '');
  const html = render({ ...read, facts: { ...read.facts, issuer_new_shares_base: null, calculated_post_os_base: null, projected_increase_percent_base: null, issuer_new_shares_full_overallotment: null, calculated_post_os_full_overallotment: null, projected_increase_percent_full_overallotment: null, unavailable_reason: ['issuer_quantity_or_role_unavailable'] } });
  assert.ok(html.includes('계산 불가'));
  assert.ok(html.includes('회사 신규 발행 수량 또는 증권 역할이 명확하지 않습니다.'));
  assert.ok(!html.includes('0%'));
});

test('projected facts preserve both current filing layouts and follow the title', () => {
  const route = readFileSync('app/filings/[id]/page.tsx', 'utf8');
  const layout = readFileSync('components/filing-analysis-v2/GenericFilingAnalysis.tsx', 'utf8');
  assert.equal((route.match(/<ProjectedOfferingDilution/g) || []).length, 2);
  assert.match(route, /filingFactsRenderer=\{projected/);
  assert.ok(layout.indexOf('{filingFactsRenderer}', layout.indexOf('<h1>')) > layout.indexOf('</header>', layout.indexOf('<h1>')));
  const document = readFileSync('components/filing-analysis-v2/AnalysisDetailDocument.tsx', 'utf8');
  assert.ok(document.indexOf('{children}') > document.indexOf('<h1>'));
  for (const path of ['app/filings/[id]/page.tsx', 'app/filings/archive/[id]/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /<AnalysisDetailDocument/);
    assert.match(source, /<\/AnalysisDetailCard><\/>}>\s*\{projected|\) : null}<\/>}>\s*\{projected/);
  }
});
