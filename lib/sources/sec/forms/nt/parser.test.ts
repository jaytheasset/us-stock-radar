import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseNtFiling } from "./parser";
import type { NtFilingInput, NtRequiredOutputJson } from "./types";

const CASES = [
  "routine-nt-10q",
  "accounting-delay-nt-10k",
  "material-sales-change-nt-10q",
  "foreign-issuer-nt-20f",
] as const;

test("NT parser extracts source-backed facts from fixture JSON only", () => {
  for (const caseName of CASES) {
    const fixture = loadFixture(caseName);
    const expected = loadExpected(caseName).parser_output;
    const actual = parseNtFiling(fixture.source);

    assert.equal(actual.parserVersion, expected.parserVersion, caseName);
    assert.equal(actual.parserGroup, "nt", caseName);
    assert.equal(actual.formType, expected.formType, caseName);
    assert.equal(actual.accessionNumber, expected.accessionNumber, caseName);
    assert.equal(actual.isSupported, true, caseName);
    assert.deepEqual(actual.warnings, expected.warnings, caseName);
    assert.deepEqual(actual.calendarItems, expected.calendarItems, caseName);

    assert.equal(actual.facts.companyName, expected.facts.companyName, caseName);
    assert.equal(actual.facts.ticker, expected.facts.ticker, caseName);
    assert.equal(actual.facts.exchange, expected.facts.exchange, caseName);
    assert.equal(actual.facts.delayedReport, expected.facts.delayedReport, caseName);
    assert.equal(actual.facts.periodOfReport, expected.facts.periodOfReport, caseName);
    assert.equal(actual.facts.extensionDays, expected.facts.extensionDays, caseName);
    assert.equal(
      actual.facts.significantChangeExpected,
      expected.facts.significantChangeExpected,
      caseName,
    );
    assert.equal(
      actual.facts.anticipatedWithinExtension,
      expected.facts.anticipatedWithinExtension,
      caseName,
    );
    assert.ok(Array.isArray(actual.facts.sourceTextFlags), caseName);
    assert.ok(Array.isArray(actual.facts.rawDataQuality.missingCriticalFields), caseName);
    assert.ok(Array.isArray(actual.facts.rawDataQuality.ambiguousFields), caseName);
    assert.ok(Array.isArray(actual.facts.rawDataQuality.noiseCandidates), caseName);
    assert.equal("riskIndicators" in actual.facts, false, caseName);
    assert.equal("disclosedReasons" in actual.facts, false, caseName);
    assert.deepEqual(actual.signals, [], caseName);
  }
});

test("routine NT 10-Q fixture preserves facts for LLM analysis", () => {
  const fixture = loadFixture("routine-nt-10q");
  const actual = parseNtFiling(fixture.source);

  assert.equal(actual.facts.significantChangeExpected, false);
  assert.equal(actual.facts.anticipatedWithinExtension, true);
  assert.deepEqual(actual.facts.sourceTextFlags, [
    "significant_change_no",
    "extension_within",
  ]);
  assert.deepEqual(actual.signals, []);
  assert.deepEqual(actual.facts.rawDataQuality.missingCriticalFields, []);
});

test("NT parser extracts amendment metadata from follow-up filings", () => {
  const actual = parseNtFiling(loadFixture("amended-narrative-nt-10qa").source);

  assert.equal(actual.formType, "NT 10-Q");
  assert.equal(actual.facts.isAmendment, true);
  assert.equal(actual.facts.amendmentNumber, "1");
  assert.equal(actual.facts.originalAccessionNumber, "0001722556-26-000012");
  assert.match(actual.facts.amendmentPurpose ?? "", /solely to correct/i);
  assert.match(actual.facts.lateFilingReason ?? "", /unable to file its Quarterly Report/i);
  assert.equal(actual.facts.anticipatedWithinExtension, null);
  assert.equal(actual.facts.significantChangeExpected, true);
  assert.ok(actual.facts.sourceTextFlags.includes("amendment_marker_present"));
  assert.ok(actual.facts.rawDataQuality.ambiguousFields.includes("extensionExpectationPromptlyAsPracticable"));
});

test("NT parser preserves transition report facts and warns on blank transition period", () => {
  const actual = parseNtFiling(loadFixture("transition-nt-10q").source);

  assert.equal(actual.formType, "NT 10-Q");
  assert.deepEqual(actual.facts.checkedReports, ["10-Q"]);
  assert.equal(actual.facts.isTransitionReport, true);
  assert.equal(actual.facts.transitionReportType, "10-Q");
  assert.equal(actual.facts.transitionPeriodEnded, null);
  assert.equal(actual.facts.anticipatedWithinExtension, true);
  assert.equal(actual.facts.significantChangeExpected, false);
  assert.ok(actual.facts.sourceTextFlags.includes("transition_report_checked"));
  assert.ok(
    actual.warnings.some((warning) =>
      warning.includes("Transition report checkbox is checked"),
    ),
  );
  assert.ok(
    actual.warnings.some((warning) =>
      warning.includes("Both a regular report checkbox"),
    ),
  );
});

test("NT parser detects inline accountant statements and no-reliance/restatement language", () => {
  const accountant = parseNtFiling(loadFixture("accountant-statement-nt-10k").source);
  const restatement = parseNtFiling(loadFixture("restatement-no-reliance-nt-10k").source);

  assert.equal(accountant.facts.accountantStatementAttached, true);
  assert.match(accountant.facts.accountantStatementText ?? "", /agree with the stated reason/i);
  assert.ok(accountant.facts.sourceTextFlags.includes("accounting_audit_terms"));
  assert.ok(accountant.facts.sourceTextFlags.includes("significant_change_yes"));
  assert.ok(accountant.facts.sourceTextFlags.includes("accountant_statement_present"));

  assert.equal(restatement.facts.noRelianceOrRestatementDisclosed, true);
  assert.ok(restatement.facts.sourceTextFlags.includes("no_reliance_or_restatement_terms"));
});

test("routine NT 10-K no-change fixture preserves annual facts for LLM analysis", () => {
  const actual = parseNtFiling(loadFixture("routine-nt-10k-no-change").source);

  assert.equal(actual.formType, "NT 10-K");
  assert.equal(actual.facts.extensionDays, 15);
  assert.equal(actual.facts.significantChangeExpected, false);
  assert.equal(actual.facts.anticipatedWithinExtension, true);
  assert.equal(actual.facts.isAmendment, false);
  assert.equal(actual.facts.isTransitionReport, false);
  assert.deepEqual(actual.facts.sourceTextFlags, [
    "significant_change_no",
    "extension_within",
  ]);
  assert.deepEqual(actual.signals, []);
  assert.deepEqual(actual.facts.rawDataQuality.missingCriticalFields, []);
});

test("parser foundation selects and segments Form 12b-25 source bodies", () => {
  const cases = loadFoundationFixtures();

  const normal10k = parseNtFiling(cases.normalNt10k.source);
  assert.equal(normal10k.isSupported, true);
  assert.equal(normal10k.raw.selectedDocument?.confidence, "high");
  assert.match(normal10k.raw.sectionSegments?.partIII ?? "", /year-end close/i);
  assert.doesNotMatch(normal10k.raw.sectionSegments?.partIII ?? "", /Have all other periodic reports/i);
  assert.match(normal10k.raw.sectionSegments?.partIV ?? "", /significant change/i);
  assert.doesNotMatch(normal10k.raw.sectionSegments?.partIV ?? "", /SIGNATURES/i);

  const table10q = parseNtFiling(cases.tableHeavyNt10q.source);
  assert.match(table10q.raw.textExcerpt, /FORM 12b-25 \| NOTIFICATION OF LATE FILING/);
  assert.match(table10q.raw.sectionSegments?.partIII ?? "", /quarterly close procedures/i);
  assert.doesNotMatch(table10q.raw.sectionSegments?.partIII ?? "", /OTHER INFORMATION/i);

  const nt20f = parseNtFiling(cases.normalNt20f.source);
  assert.equal(nt20f.formType, "NT 20-F");
  assert.match(nt20f.raw.sectionSegments?.partIII ?? "", /Form 20-F/i);
});

test("parser foundation handles SGML and EDGAR document inventory", () => {
  const cases = loadFoundationFixtures();

  const sgml = parseNtFiling(cases.completeSubmissionMultipleDocuments.source);
  assert.equal(sgml.isSupported, true);
  assert.equal(sgml.raw.selectedDocument?.source, "sgml_document");
  assert.equal(sgml.raw.selectedDocument?.type, "NT 10-Q");
  assert.equal(sgml.raw.selectedDocument?.sequence, "2");
  assert.ok(
    sgml.raw.documentInventory?.some(
      (document) => document.type === "GRAPHIC" && document.primaryCandidate === false,
    ),
  );
  assert.ok(
    sgml.raw.documentInventory?.some(
      (document) => document.type === "EX-99.1" && document.excludedReason === "exhibit_document",
    ),
  );
  assert.doesNotMatch(sgml.raw.textExcerpt, /Exhibit text should not be selected/);

  const primaryNotFirst = parseNtFiling(cases.primaryDocumentNotFirst.source);
  assert.equal(primaryNotFirst.raw.selectedDocument?.source, "metadata_document");
  assert.equal(primaryNotFirst.raw.selectedDocument?.sequence, "2");
  assert.match(primaryNotFirst.raw.sectionSegments?.partIII ?? "", /annual closing procedures/i);
});

test("parser foundation preserves checkbox evidence through normalization", () => {
  const cases = loadFoundationFixtures();

  const unicode = parseNtFiling(cases.unicodeCheckboxTokens.source);
  for (const token of ["☒", "☑", "☐", "□", "✓", "✔", "■"]) {
    assert.match(unicode.raw.textExcerpt, new RegExp(escapeRegExp(token)), token);
  }

  const ascii = parseNtFiling(cases.asciiCheckboxTokens.source);
  for (const token of ["[X]", "[x]", "[ ]", "x raw lower", "X raw upper"]) {
    assert.match(ascii.raw.textExcerpt, new RegExp(escapeRegExp(token)), token);
  }
});

test("parser foundation recovers broken headings with low-confidence warnings", () => {
  const cases = loadFoundationFixtures();
  const actual = parseNtFiling(cases.brokenHeadingsFallback.source);

  assert.equal(actual.isSupported, true);
  assert.equal(actual.raw.sectionSegments?.confidence, "medium");
  assert.ok(
    actual.raw.sectionSegments?.warnings.some((warning) =>
      warning.includes("fallback anchor for Part III"),
    ),
  );
  assert.match(actual.raw.sectionSegments?.partIII ?? "", /compile quarterly financial information/i);
  assert.doesNotMatch(actual.raw.sectionSegments?.partIII ?? "", /Name and telephone number/i);
});

test("parser foundation keeps adjacent Part III and Part IV table cells separate", () => {
  const cases = loadFoundationFixtures();
  const actual = parseNtFiling(cases.closePartIIIAndIVTable.source);

  assert.match(actual.raw.sectionSegments?.partIII ?? "", /quarterly review procedures/i);
  assert.doesNotMatch(actual.raw.sectionSegments?.partIII ?? "", /significant change/i);
  assert.match(actual.raw.sectionSegments?.partIV ?? "", /significant change/i);
  assert.doesNotMatch(actual.raw.sectionSegments?.partIV ?? "", /SIGNATURES/i);
});

test("parser foundation reports low-confidence failure when no Form 12b-25 body exists", () => {
  const cases = loadFoundationFixtures();
  const actual = parseNtFiling(cases.noCredibleBody.source);

  assert.equal(actual.isSupported, false);
  assert.equal(actual.raw.selectedDocument?.confidence, "low");
  assert.ok(actual.warnings.some((warning) => warning.includes("No credible Form 12b-25 body found")));
  assert.ok(actual.facts.rawDataQuality.missingCriticalFields.includes("partIiiNarrative"));
});

test("NT parser phase 2 resolves target report checkboxes and periods locally", () => {
  const cases = loadPhase2Fixtures();

  const nt10k = parseNtFiling(cases.nt10kCleanPeriod.source);
  assert.equal(nt10k.facts.targetReportCheckboxGroup.selectedReport, "10-K");
  assert.equal(nt10k.facts.bodyFormType, "NT 10-K");
  assert.equal(nt10k.facts.periodOfReport, "December 31, 2025");
  assert.match(nt10k.facts.periodOfReportEvidence ?? "", /For Period Ended/i);

  const nt10q = parseNtFiling(cases.nt10qNumericPeriod.source);
  assert.equal(nt10q.facts.targetReportCheckboxGroup.selectedReport, "10-Q");
  assert.equal(nt10q.facts.periodOfReport, "03/31/2026");

  const nt20f = parseNtFiling(cases.nt20fForeignPeriod.source);
  assert.equal(nt20f.facts.targetReportCheckboxGroup.selectedReport, "20-F");
  assert.equal(nt20f.facts.periodOfReport, "31 December 2025");

  const transition = parseNtFiling(cases.transition10k.source);
  assert.equal(transition.facts.targetReportCheckboxGroup.selectedTransitionReport, "10-K");
  assert.equal(transition.facts.isTransitionReport, true);
  assert.equal(transition.facts.transitionReportType, "10-K");
  assert.equal(transition.facts.transitionPeriodEnded, "2025-12-31");
});

test("NT parser phase 2 preserves target checkbox ambiguity and mismatch warnings", () => {
  const cases = loadPhase2Fixtures();

  const multiple = parseNtFiling(cases.multipleTargetBoxes.source);
  assert.equal(multiple.facts.targetReportCheckboxGroup.ambiguous, true);
  assert.deepEqual(multiple.facts.targetReportCheckboxGroup.checkedReports, ["10-K", "10-Q"]);
  assert.ok(multiple.facts.rawDataQuality.ambiguousFields.includes("targetReportCheckboxGroup"));
  assert.ok(multiple.warnings.some((warning) => warning.includes("Multiple target report checkboxes")));

  const conflict = parseNtFiling(cases.bodySubmissionConflict.source);
  assert.equal(conflict.facts.bodyFormType, "NT 10-K");
  assert.equal(conflict.facts.submissionBodyFormMismatch, true);
  assert.ok(conflict.facts.rawDataQuality.ambiguousFields.includes("submissionBodyFormMismatch"));
  assert.ok(conflict.warnings.some((warning) => warning.includes("conflicts with EDGAR submission")));
});

test("NT parser phase 2 supports checkbox token variants without treating word x as checked", () => {
  const cases = loadPhase2Fixtures();

  const unicode = parseNtFiling(cases.unicodeTargetBoxes.source);
  assert.equal(unicode.facts.targetReportCheckboxGroup.selectedReport, "20-F");
  assert.equal(unicode.facts.partIi.rule12b25ReliefChecked, true);

  const ascii = parseNtFiling(cases.asciiTargetBoxes.source);
  assert.equal(ascii.facts.targetReportCheckboxGroup.selectedReport, "10-Q");

  const rawX = parseNtFiling(cases.rawXSafeTarget.source);
  assert.equal(rawX.facts.targetReportCheckboxGroup.selectedReport, "10-K");
  assert.equal(rawX.facts.targetReportCheckboxGroup.confidence, "medium");
  assert.equal(rawX.facts.partIi.rule12b25ReliefChecked, true);

  const wordNoise = parseNtFiling(cases.xInsideWords.source);
  assert.equal(wordNoise.facts.targetReportCheckboxGroup.selectedReport, null);
  assert.deepEqual(wordNoise.facts.targetReportCheckboxGroup.checkedReports, []);
  assert.ok(wordNoise.facts.rawDataQuality.ambiguousFields.includes("targetReportCheckboxMissing"));
});

test("NT parser phase 2 keeps period extraction anchor-local", () => {
  const cases = loadPhase2Fixtures();

  const omb = parseNtFiling(cases.ombDateNoise.source);
  assert.equal(omb.facts.periodOfReport, "March 31, 2026");
  assert.notEqual(omb.facts.periodOfReport, "December 31, 2025");

  const signatureOnly = parseNtFiling(cases.signatureDateOnly.source);
  assert.equal(signatureOnly.facts.periodOfReport, null);
  assert.ok(signatureOnly.facts.rawDataQuality.missingCriticalFields.includes("periodOfReport"));
});

test("NT parser phase 2 parses Part II relief as one local group only", () => {
  const cases = loadPhase2Fixtures();

  const checked = parseNtFiling(cases.partIiReliefChecked.source);
  assert.equal(checked.facts.partIi.rule12b25ReliefChecked, true);
  assert.match(checked.facts.partIi.rule12b25ReliefEvidence ?? "", /\(a\)/i);
  assert.equal(checked.facts.partIi.withinExtensionChecked, null);
  assert.equal(checked.facts.partIi.accountantStatementChecked, null);

  const unknown = parseNtFiling(cases.partIiUnknown.source);
  assert.equal(unknown.facts.partIi.rule12b25ReliefChecked, null);
  assert.equal(unknown.facts.partIi.unableWithoutUnreasonableEffortChecked, null);
});

test("NT parser phase 2 extracts Part III narrative and source-backed hints", () => {
  const cases = loadPhase2Fixtures();

  const clean = parseNtFiling(cases.partIiiNoContamination.source);
  assert.match(clean.facts.lateFilingReason ?? "", /quarterly review procedures/i);
  assert.match(clean.facts.lateFilingReason ?? "", /Additional schedules/i);
  assert.doesNotMatch(clean.facts.lateFilingReason ?? "", /Name and telephone number/i);

  const fallback = parseNtFiling(cases.partIiiFallbackInstruction.source);
  assert.match(fallback.facts.lateFilingReason ?? "", /waiting for final consolidation schedules/i);
  assert.doesNotMatch(fallback.facts.lateFilingReason ?? "", /Name and telephone number/i);

  const exhibit = parseNtFiling(cases.attachedExhibitNarrative.source);
  assert.match(exhibit.facts.lateFilingReason ?? "", /See attached exhibit/i);
  assert.ok(exhibit.facts.partIiiNarrativeFlags.includes("part_iii_attached_exhibit_reference"));

  const edgar = parseNtFiling(cases.electronicFilingDifficulty.source);
  assert.ok(edgar.facts.partIiiNarrativeFlags.includes("part_iii_electronic_filing_difficulty_terms"));
});

test("NT parser phase 2 detects partial NT amendments without hard failure", () => {
  const cases = loadPhase2Fixtures();
  const actual = parseNtFiling(cases.ntAmendmentPartial.source);

  assert.equal(actual.isSupported, true);
  assert.equal(actual.facts.isAmendment, true);
  assert.equal(actual.facts.amendmentNumber, "1");
  assert.equal(actual.facts.amendmentPartialBody, true);
  assert.ok(actual.facts.rawDataQuality.ambiguousFields.includes("amendmentPartialBody"));
  assert.ok(actual.warnings.some((warning) => warning.includes("Amendment body appears partial")));
});

test("NT parser phase 3 extracts Part IV Q1 contact facts cautiously", () => {
  const cases = loadPhase3Fixtures();

  const named = parseNtFiling(cases.q1ContactNamePhone.source);
  assert.equal(named.facts.partIv.contact.name, "Jane Doe");
  assert.equal(named.facts.partIv.contact.areaCode, "212");
  assert.equal(named.facts.partIv.contact.telephoneNumber, "555-1234");
  assert.match(named.facts.partIv.contact.rawContactLine ?? "", /Jane Doe/);

  const phoneOnly = parseNtFiling(cases.q1PhoneOnly.source);
  assert.equal(phoneOnly.facts.partIv.contact.name, null);
  assert.equal(phoneOnly.facts.partIv.contact.areaCode, "212");
  assert.equal(phoneOnly.facts.partIv.contact.telephoneNumber, "555-1234");
  assert.ok(phoneOnly.facts.rawDataQuality.ambiguousFields.includes("partIvContactName"));

  const noise = parseNtFiling(cases.q1NoPhoneFromNoise.source);
  assert.equal(noise.facts.partIv.contact.telephoneNumber, null);
});

test("NT parser phase 3 parses Part IV Q2 locally with explanation hints", () => {
  const cases = loadPhase3Fixtures();

  const yes = parseNtFiling(cases.q2YesUnicode.source);
  assert.equal(yes.facts.partIv.otherPeriodicReports.answer, true);
  assert.equal(yes.facts.otherPeriodicReportsFiled, true);

  const no = parseNtFiling(cases.q2NoExplanation.source);
  assert.equal(no.facts.partIv.otherPeriodicReports.answer, false);
  assert.match(no.facts.partIv.otherPeriodicReports.explanation ?? "", /Form 10-Q quarterly report/i);
  assert.ok(no.facts.partIv.otherPeriodicReports.missingReportHints.includes("10-Q"));
  assert.ok(no.facts.partIv.otherPeriodicReports.missingReportHints.includes("quarterly report"));

  const both = parseNtFiling(cases.q2BothChecked.source);
  assert.equal(both.facts.partIv.otherPeriodicReports.answer, null);
  assert.equal(both.facts.partIv.otherPeriodicReports.ambiguous, true);
  assert.ok(both.warnings.some((warning) => warning.includes("Part IV Q2 Yes and No both")));

  const unknown = parseNtFiling(cases.q2UnknownUnreliable.source);
  assert.equal(unknown.facts.partIv.otherPeriodicReports.answer, null);
  assert.equal(unknown.facts.partIv.otherPeriodicReports.ambiguous, false);

  const local = parseNtFiling(cases.q2DoesNotConsumeQ3.source);
  assert.equal(local.facts.partIv.otherPeriodicReports.answer, null);
  assert.equal(local.facts.partIv.significantChange.answer, true);
});

test("NT parser phase 3 parses Part IV Q3 locally and preserves quantitative evidence", () => {
  const cases = loadPhase3Fixtures();

  const cleanNo = parseNtFiling(cases.q3NoClean.source);
  assert.equal(cleanNo.facts.partIv.significantChange.answer, false);
  assert.equal(cleanNo.facts.significantChangeExpected, false);

  const quant = parseNtFiling(cases.q3YesQuant.source);
  assert.equal(quant.facts.partIv.significantChange.answer, true);
  assert.equal(quant.facts.significantChangeExpected, true);
  assert.match(quant.facts.partIv.significantChange.explanation ?? "", /Revenue increased by 25%/);
  assert.equal(quant.facts.partIv.significantChange.quantitativeDisclosurePresent, true);

  const noQuant = parseNtFiling(cases.q3YesNoQuant.source);
  assert.equal(noQuant.facts.partIv.significantChange.answer, true);
  assert.equal(noQuant.facts.partIv.significantChange.quantitativeDisclosurePresent, false);
  assert.ok(noQuant.warnings.some((warning) => warning.includes("no quantitative-looking disclosure")));

  const both = parseNtFiling(cases.q3BothChecked.source);
  assert.equal(both.facts.partIv.significantChange.answer, null);
  assert.equal(both.facts.partIv.significantChange.ambiguous, true);
  assert.ok(both.warnings.some((warning) => warning.includes("Part IV Q3 Yes and No both")));

  const local = parseNtFiling(cases.q3DoesNotConsumeQ2.source);
  assert.equal(local.facts.partIv.otherPeriodicReports.answer, true);
  assert.equal(local.facts.partIv.significantChange.answer, null);
});

test("NT parser phase 3 adds Part IV consistency warnings without investor conclusions", () => {
  const cases = loadPhase3Fixtures();

  const noWithFinancial = parseNtFiling(cases.q3NoWithFinancialExplanation.source);
  assert.equal(noWithFinancial.facts.partIv.significantChange.answer, false);
  assert.ok(noWithFinancial.warnings.some((warning) => warning.includes("answered No")));

  const stop = parseNtFiling(cases.q3StopsBeforeSignature.source);
  assert.match(stop.facts.partIv.significantChange.explanation ?? "", /Net loss decreased by 15%/);
  assert.doesNotMatch(stop.facts.partIv.significantChange.explanation ?? "", /SIGNATURE|Date:/i);

  const phoneOnly = parseNtFiling(cases.q3PhoneNotQuant.source);
  assert.equal(phoneOnly.facts.partIv.significantChange.quantitativeDisclosurePresent, false);
  assert.ok(phoneOnly.warnings.some((warning) => warning.includes("no quantitative-looking disclosure")));

  const datesRules = parseNtFiling(cases.q3DatesRulesNotQuant.source);
  assert.equal(datesRules.facts.partIv.significantChange.quantitativeDisclosurePresent, false);
  assert.ok(datesRules.warnings.some((warning) => warning.includes("no quantitative-looking disclosure")));
});

test("NT parser phase 3 detects portion-only and electronic filing difficulty hints", () => {
  const cases = loadPhase3Fixtures();

  const portion = parseNtFiling(cases.portionOnlyWithItem.source);
  assert.equal(portion.facts.portionOnly.detected, true);
  assert.equal(portion.facts.portionOnly.ambiguous, false);
  assert.match(portion.facts.portionOnly.itemWording ?? "", /Item 8/i);

  const unclear = parseNtFiling(cases.portionOnlyUnclear.source);
  assert.equal(unclear.facts.portionOnly.detected, true);
  assert.equal(unclear.facts.portionOnly.ambiguous, true);
  assert.ok(unclear.facts.rawDataQuality.ambiguousFields.includes("portionOnlyItemDetail"));

  const electronic = parseNtFiling(cases.electronicFilingPrimary.source);
  assert.equal(electronic.facts.electronicFilingDifficulty.detected, true);
  assert.equal(electronic.facts.electronicFilingDifficulty.primaryReason, true);
  assert.ok(electronic.facts.partIiiNarrativeFlags.includes("part_iii_electronic_filing_difficulty_terms"));
  assert.ok(electronic.warnings.some((warning) => warning.includes("electronic filing difficulty")));
});

interface NtFixture {
  source: NtFilingInput;
}

function loadFixture(caseName: string): NtFixture {
  return loadJson<NtFixture>(`./fixtures/${caseName}.json`);
}

function loadFoundationFixtures(): Record<string, NtFixture> {
  return loadJson<Record<string, NtFixture>>("./fixtures/foundation-document-selection.json");
}

function loadPhase2Fixtures(): Record<string, NtFixture> {
  return loadJson<Record<string, NtFixture>>("./fixtures/phase2-checkbox-period-narrative.json");
}

function loadPhase3Fixtures(): Record<string, NtFixture> {
  return loadJson<Record<string, NtFixture>>("./fixtures/phase3-partiv.json");
}

function loadExpected(caseName: string): NtRequiredOutputJson {
  return loadJson<NtRequiredOutputJson>(`./expected/${caseName}.expected.json`);
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as T;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
