import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSecForm25Filing } from "./parser";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25");
const fixturesDir = join(roomDir, "fixtures");

const cases = [
  "common-share-delisting",
  "merger-completion-removal",
  "matured-debt-removal",
  "voluntary-withdrawal-continued-listing",
  "ambiguous-units-requires-llm",
  "missing-reason-requires-llm",
  "rule-a2-warrant-retired-from-xml",
  "rule-a3-merger-not-listing-failure",
  "rule-a3-warrant-substitution-needs-analysis",
];

for (const name of cases) {
  const parsed = parseSecForm25Filing(readFixture(`${name}.json`));

  assert.equal(parsed.parserVersion, "sec_form25_parser_v1", name);
  assert.equal(parsed.parserGroup, "form25", name);
  assert.equal(parsed.formType, "Form 25 / 25-NSE", name);
  assert.equal(parsed.isSupported, true, name);
  assert.ok(parsed.facts.source_form_type, name);
  assert.ok(parsed.facts.extracted_field_count > 0, name);
  assert.ok(parsed.facts.extracted_field_count > 0, name);
  assert.ok(parsed.raw.sourceInventory.documents.length > 0, name);
  assert.ok(parsed.raw.sourceInventory.source_text_char_count > 0, name);
  assert.ok(Array.isArray(parsed.raw.sourceInventory.truncation_notes), name);
  assert.ok(parsed.raw.directSourceBlocks.length > 0, `${name}: direct source blocks required`);
  assert.ok(parsed.raw.directSourceBlocks.length <= 8, `${name}: direct source block limit`);
  assert.equal(
    new Set(parsed.raw.directSourceBlocks.map((block) => block.block_id)).size,
    parsed.raw.directSourceBlocks.length,
    `${name}: stable block IDs must be unique`,
  );
  assert.equal(
    parsed.raw.directSourceBlocks.some((block) => block.text.length > 4_500),
    false,
    `${name}: direct source block character limit`,
  );
  assert.equal(
    parsed.raw.directSourceBlocks.some((block) => block.text.includes("RAW_FORM25_FULL_TEXT_SENTINEL")),
    false,
    `${name}: fixture sentinel must not enter direct source blocks`,
  );
  assert.ok(Array.isArray(parsed.raw.selectedEvidenceSnippets), name);
  assert.deepEqual(parsed.signals, [], "parser must not preselect analysis signals");
  assert.equal(Object.hasOwn(parsed.facts, "security_category"), false, "parser must not store security judgment");
  assert.equal(Object.hasOwn(parsed.facts, "removal_reason_category"), false, "parser must not store reason judgment");
  assert.equal(Object.hasOwn(parsed.facts, "common_equity_affected"), false, "parser must not store equity-impact judgment");
  assert.equal(Object.hasOwn(parsed.facts, "filing_meaning"), false, "parser must not store deterministic case");
  assert.equal(Object.hasOwn(parsed.facts, "routing"), false, "parser must not store routing judgment");
  assert.equal(Object.hasOwn(parsed.facts, "score"), false, "parser must not score");
  assert.equal(Object.hasOwn(parsed.facts, "delivery_level"), false, "parser must not decide delivery level");
}

const commonShare = parseSecForm25Filing(readFixture("common-share-delisting.json"));
assert.ok(commonShare.raw.sourceInventory.table_counts.total >= 1);
assert.ok(commonShare.raw.selectedTableSnippets.length >= 1);
assert.ok(commonShare.facts.removed_security?.value);
assert.equal(commonShare.raw.directSourceBlocks[0]?.block_type, "form25_exchange_determination");
assert.match(commonShare.raw.directSourceBlocks[0]?.text || "", /Listing Rules 5101/);

const merger = parseSecForm25Filing(readFixture("merger-completion-removal.json"));
assert.equal(merger.facts.primary_ticker?.value, "HES");
assert.equal(merger.facts.successor_or_acquirer?.value, "Hess Corporation / Chevron Corporation");
assert.match(merger.raw.directSourceBlocks.map((block) => block.text).join("\n"), /1\.025 shares of Chevron/);

const ruleA2Warrant = parseSecForm25Filing(readFixture("rule-a2-warrant-retired-from-xml.json"));
assert.ok(ruleA2Warrant.facts.rule_provision?.value);
assert.equal(ruleA2Warrant.facts.removal_reason_text, null);

const ruleA3Merger = parseSecForm25Filing(readFixture("rule-a3-merger-not-listing-failure.json"));
assert.equal(ruleA3Merger.warnings.includes("listing_standards_failure"), false);
assert.ok(ruleA3Merger.facts.removal_reason_text?.value);

const ruleA3Warrant = parseSecForm25Filing(readFixture("rule-a3-warrant-substitution-needs-analysis.json"));
assert.equal(ruleA3Warrant.warnings.includes("listing_standards_failure"), false);
assert.ok(ruleA3Warrant.facts.rule_provision?.value);

const missingReason = parseSecForm25Filing(readFixture("missing-reason-requires-llm.json"));
assert.ok(missingReason.warnings.includes("missing_or_unclear_reason"));

const ambiguousUnits = parseSecForm25Filing(readFixture("ambiguous-units-requires-llm.json"));
assert.ok(ambiguousUnits.facts.removed_security?.value);

const voluntaryWithdrawal = parseSecForm25Filing(readFixture("voluntary-withdrawal-continued-listing.json"));
assert.match(
  voluntaryWithdrawal.raw.directSourceBlocks.map((block) => block.text).join("\n"),
  /continue to be listed on the New York Stock Exchange/i,
);

const unicodeCheckboxRuleC = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-unicode-checkbox-rule-c",
  title: "TuSimple Holdings Form 25",
  publishedAt: "2024-01-29",
  bodyText: `
FORM 25
TuSimple Holdings Inc. / The Nasdaq Stock Market LLC
Class A Common Stock
(Description of class of securities)
|
\u2610 |
Pursuant to 17 CFR 240.12d2-2(a)(1)
|
\u2610 |
Pursuant to 17 CFR 240.12d2-2(b)
|
\u2612 |
Pursuant to 17 CFR 240.12d2-2(c), the Issuer has complied with the rules of the Exchange and the requirements governing the voluntary withdrawal of the class of securities from listing and registration on the Exchange.
`,
  rawPayload: {
    form_type: "25",
  },
});
assert.equal(unicodeCheckboxRuleC.facts.rule_provision?.value, "17 CFR 240.12d2-2(c)");
assert.equal(unicodeCheckboxRuleC.facts.removal_reason_text?.value.includes("voluntary withdrawal"), true);
assert.equal(unicodeCheckboxRuleC.warnings.includes("missing_or_unclear_reason"), false);

const plainXRuleC = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-plain-x-rule-c",
  title: "Cutera Form 25",
  publishedAt: "2025-03-20",
  bodyText: `
FORM 25
Cutera Inc. / The Nasdaq Stock Market LLC
Common Stock
(Description of class of securities)
\u2610    17 CFR 240.12d2-2(a)(1)
\u2610    Pursuant to 17 CFR 240.12d2-2(b), the Exchange has complied with its rules.
x      Pursuant to 17 CFR 240.12d2-2(c), the Issuer has complied with the rules of the Exchange and the requirements governing the voluntary withdrawal of the class of securities from listing and registration on the Exchange.
`,
  rawPayload: {
    form_type: "25",
  },
});
assert.equal(plainXRuleC.facts.rule_provision?.value, "17 CFR 240.12d2-2(c)");
assert.equal(plainXRuleC.facts.removal_reason_text?.value.includes("voluntary withdrawal"), true);
assert.equal(plainXRuleC.warnings.includes("missing_or_unclear_reason"), false);

const issuerFiledRuleCHeader = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-issuer-header-cik",
  title: "TuSimple Holdings Form 25",
  publishedAt: "2024-01-29",
  bodyText: `
CONFORMED SUBMISSION TYPE: 25
COMPANY CONFORMED NAME: TuSimple Holdings Inc.
CENTRAL INDEX KEY: 0001823593
FORM 25
TuSimple Holdings Inc. / The Nasdaq Stock Market LLC
Class A Common Stock
(Description of class of securities)
x Pursuant to 17 CFR 240.12d2-2(c), the Issuer has complied with the requirements governing voluntary withdrawal from listing and registration.
  `,
  rawPayload: {
    form_type: "25",
    cik: "1823593",
    company_name: "TuSimple Holdings Inc.",
  },
});
assert.equal(issuerFiledRuleCHeader.facts.subject_company_cik?.value, "1823593");
assert.equal(issuerFiledRuleCHeader.facts.filed_by_cik?.value, "1823593");
assert.equal(issuerFiledRuleCHeader.facts.filed_by_name?.value, "TuSimple Holdings Inc.");

const exchangeFiledHeaderMustNotBecomeSubject = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-exchange-header-cik",
  title: "Nasdaq Form 25-NSE",
  publishedAt: "2025-07-16",
  bodyText: `
CONFORMED SUBMISSION TYPE: 25-NSE
COMPANY CONFORMED NAME: Nasdaq Stock Market LLC
CENTRAL INDEX KEY: 0001354457
FORM 25-NSE
Common Stock
17 CFR 240.12d2-2(a)(3)
  `,
  rawPayload: {
    form_type: "25-NSE",
    cik: "1354457",
    company_name: "Nasdaq Stock Market LLC",
  },
});
assert.equal(exchangeFiledHeaderMustNotBecomeSubject.facts.subject_company_cik, null);
assert.equal(exchangeFiledHeaderMustNotBecomeSubject.facts.filed_by_cik?.value, "1354457");
assert.equal(exchangeFiledHeaderMustNotBecomeSubject.facts.filed_by_name?.value, "Nasdaq Stock Market LLC");

const exchangeFiledPollutedHeaderName = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-exchange-polluted-header-name",
  title: "Accelerate Diagnostics Inc 25-NSE",
  publishedAt: "2025-07-21",
  bodyText: `
CONFORMED SUBMISSION TYPE: 25-NSE
COMPANY CONFORMED NAME: Accelerate Diagnostics, Inc (Subject) CIK : 0000727207 (see all company filings)
CENTRAL INDEX KEY: 0001354457
FORM 25-NSE
Issuer:
Accelerate Diagnostics, Inc.
Exchange:
Nasdaq Stock Market LLC
Common Stock
17 CFR 240.12d2-2(a)(3)
  `,
  rawPayload: {
    form_type: "25-NSE",
    cik: "1354457",
    company_name: "Accelerate Diagnostics, Inc (Subject) CIK : 0000727207 (see all company filings)",
    subject_company_cik: "727207",
  },
});
assert.equal(exchangeFiledPollutedHeaderName.facts.issuer_name?.value, "Accelerate Diagnostics, Inc.");
assert.equal(exchangeFiledPollutedHeaderName.facts.subject_company_cik?.value, "727207");
assert.equal(exchangeFiledPollutedHeaderName.facts.filed_by_cik?.value, "1354457");
assert.equal(exchangeFiledPollutedHeaderName.facts.filed_by_name?.value, "Nasdaq Stock Market LLC");
assert.ok(exchangeFiledPollutedHeaderName.warnings.includes("filed_by_name_normalized_to_exchange"));

const structuredSubjectCik = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-structured-subject-cik",
  title: "ChampionX Corp 25-NSE",
  publishedAt: "2025-07-16",
  bodyText: `
25-NSE 1 primary_doc.xml X0203 0001354457 Nasdaq Stock Market LLC 0001723089 ChampionX Corp 001-38441 2445 Technology Forest Blvd The Woodlands TX TEXAS 77381 Common Stock 17 CFR 240.12d2-2(a)(3) Analyst, Market Watch 2025-07-16
`,
  rawPayload: {
    form_type: "25-NSE",
  },
});
assert.equal(structuredSubjectCik.facts.subject_company_cik?.value, "0001723089");

const structuredPunctuatedSubjectCik = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-structured-punctuated-subject-cik",
  title: "JVSPAC Acquisition Corp. 25-NSE",
  publishedAt: "2025-06-30",
  bodyText: `
25-NSE
Issuer:
JVSPAC Acquisition Corp.
Exchange:
Nasdaq Stock Market LLC
X0203
0001354457
Nasdaq Stock Market LLC
0001866001
JVSPAC Acquisition Corp.
333-275176
G/F Hang Tak Building
Class A Ordinary Share, Right, and Unit
17 CFR 240.12d2-2(a)(3)
Tara Petta
AVP
2025-06-30
`,
  rawPayload: {
    form_type: "25-NSE",
    cik: "1354457",
    company_name: "Nasdaq Stock Market LLC",
  },
});
assert.equal(structuredPunctuatedSubjectCik.facts.issuer_name?.value, "JVSPAC Acquisition Corp.");
assert.equal(structuredPunctuatedSubjectCik.facts.subject_company_cik?.value, "0001866001");
assert.equal(structuredPunctuatedSubjectCik.facts.filed_by_cik?.value, "1354457");
assert.equal(structuredPunctuatedSubjectCik.facts.filed_by_name?.value, "Nasdaq Stock Market LLC");

const wrappedDateRoles = parseSecForm25Filing({
  sourceUniqueId: "fixture-form25-wrapped-date-roles",
  title: "T2 Biosystems Form 25-NSE",
  publishedAt: "2025-07-10",
  bodyText: `
FORM 25-NSE
T2 Biosystems, Inc.
Common Stock
The Nasdaq Stock Market LLC has determined to remove
from listing the security of T2 Biosystems, Inc. effective at the opening
of the trading session on July 21, 2025.
The Company security was suspended
on February 12, 2025. The Staff determination to delist the Company
security became final on February 12, 2025.
  `,
  rawPayload: {
    form_type: "25-NSE",
  },
});
assert.equal(wrappedDateRoles.facts.delisting_or_removal_date?.value, "2025-07-21");
assert.equal(wrappedDateRoles.facts.trading_suspension_date?.value, "2025-02-12");

console.log("sec form25 parser fixtures passed");

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}
