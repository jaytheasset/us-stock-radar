import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseS8Filing } from "./parser.ts";
import type { S8FixtureInput, S8RequiredFixtureOutput } from "./types.ts";

const roomDir = dirname(fileURLToPath(import.meta.url));
const fixtureNames = [
  "routine-small-plan",
  "large-dilution-market-context",
  "s8a-administrative-amendment",
  "s8a-additional-shares-parent-context",
  "ambiguous-human-review",
  "inducement-awards",
  "post-effective-no-additional-securities",
  "reoffer-prospectus-sellingholders",
  "douglas-elliman-evergreen-s8",
];

test("S-8 parser output matches expected fixture JSON", () => {
  for (const name of fixtureNames) {
    const fixture = readFixture(name);
    const expected = readExpected(name);

    assert.deepEqual(parseS8Filing(fixture), expected.parser_output, name);
  }
});

test("parser keeps administrative amendment facts source-backed without route output", () => {
  const administrativeFixture = readFixture("s8a-administrative-amendment");
  const parsed = parseS8Filing(administrativeFixture);

  assert.equal(administrativeFixture.flowExpectation?.parserCanFinishWithoutLlm, true);
  assert.equal(parsed.facts.noAdditionalSecurities, true);
  assert.equal(parsed.facts.exhibitOnly, true);
  assert.deepEqual(parsed.signals, []);
});

test("parser uses market context only when it is present in fixture JSON", () => {
  for (const name of fixtureNames) {
    const fixture = readFixture(name);
    const parsed = parseS8Filing(fixture);

    assert.deepEqual(parsed.raw.marketContext, fixture.marketContext ?? null, name);
  }
});

test("parser preserves raw source documents and marks noise candidates without evidence snippets", () => {
  const douglas = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));

  assert.equal(douglas.raw.sourceDocuments[0].documentRole, "primary_filing");
  assert.equal(douglas.raw.sourceDocuments[0].source, "primary");
  assert.match(douglas.raw.sourceDocuments[0].text, /EXPLANATORY NOTE/);
  assert.equal(douglas.raw.sourceDocuments[1].documentRole, "fee_exhibit");
  assert.equal(douglas.raw.sourceDocuments[1].source, "attachment");
  assert.match(douglas.raw.sourceDocuments[1].text, /ffd:AmtSctiesRegd/);
  assert.equal(douglas.raw.sourceDocuments.some((document) => /snippet/i.test(document.id)), false);

  const admin = parseS8Filing(readFixture("s8a-administrative-amendment"));
  assert.equal(admin.raw.sourceDocuments.length, 1);
  assert.equal(admin.raw.noiseCandidates.some((candidate) => candidate.label === "legal_opinion"), true);
});

test("parser extracts researched S-8 variants as source facts", () => {
  const inducement = parseS8Filing(readFixture("inducement-awards"));
  assert.equal(inducement.facts.inducementAwardTotalShares, 81600);
  assert.equal(inducement.facts.feeTableRows?.length, 2);

  const postEffective = parseS8Filing(readFixture("post-effective-no-additional-securities"));
  assert.equal(postEffective.facts.noAdditionalSecurities, true);
  assert.equal(postEffective.facts.priorRegistrationStatements?.length, 2);

  const reoffer = parseS8Filing(readFixture("reoffer-prospectus-sellingholders"));
  assert.equal(reoffer.facts.reofferProspectus, true);
  assert.equal(reoffer.facts.sellingSecurityholders?.length, 2);
  assert.equal(reoffer.facts.filingProvidedPrice?.price, 2.1);

  const douglas = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  assert.equal(douglas.facts.registeredShares, 4412397);
  assert.equal(douglas.facts.feeTableRows?.[0]?.amountRegistered, 3529918);
  assert.equal(douglas.facts.feeTableRows?.[1]?.amountRegistered, 882479);
  assert.equal(douglas.facts.planShareAllocations?.length, 2);
  assert.equal(douglas.warnings.length, 0);
});

test("parser does not emit route hints", () => {
  const routine = parseS8Filing(readFixture("routine-small-plan"));

  const largeDilution = parseS8Filing(readFixture("large-dilution-market-context"));

  const reoffer = parseS8Filing(readFixture("reoffer-prospectus-sellingholders"));

  const admin = parseS8Filing(readFixture("s8a-administrative-amendment"));

  for (const output of [routine, largeDilution, reoffer, admin]) {
    assert.equal(Object.prototype.hasOwnProperty.call(output, "routingHints"), false);
    assert.doesNotMatch(JSON.stringify(output), /routingHints|routeAction|suggestedEventType|s8Bucket|scoreHint|analysisRequired|archiveEligible/);
  }
});

test("parser normalizes S-8 family purpose and detects primary sections", () => {
  const routine = parseS8Filing(readFixture("routine-small-plan"));
  assert.equal(routine.facts.s8FamilyDetected, true);
  assert.equal(routine.facts.normalizedS8Type, "initial_s8");
  assert.equal(routine.raw.sections?.some((section) => section.key === "part_i"), true);
  assert.equal(routine.raw.sections?.some((section) => section.key === "part_ii"), true);
  assert.equal(routine.raw.sections?.some((section) => section.key === "signatures"), true);
  assert.equal(routine.facts.sectionExtractionConfidence, "high");

  const additional = parseS8Filing(readFixture("s8a-additional-shares-parent-context"));
  assert.equal(additional.facts.normalizedS8Type, "general_instruction_e_additional_securities");

  const deregistration = parseS8Filing(readFixture("s8-pos-deregistration-only"));
  assert.equal(deregistration.facts.normalizedS8Type, "post_effective_amendment");
  assert.equal(deregistration.facts.postEffectiveAmendment, true);
  assert.equal(deregistration.facts.deregistrationOfUnsoldSecurities, true);

  const documentTitleS8a = parseS8Filing(readFixture("document-title-s8a-post-effective"));
  assert.equal(documentTitleS8a.isSupported, true);
  assert.equal(documentTitleS8a.facts.isAmendment, true);
  assert.equal(documentTitleS8a.facts.normalizedS8Type, "post_effective_amendment");
});

test("parser preserves reoffer, selling-holder, consultant-risk, and conflicting S-8 POS source facts", () => {
  const reoffer = parseS8Filing(readFixture("reoffer-prospectus-sellingholders"));
  assert.equal(reoffer.facts.reofferProspectus, true);
  assert.equal(reoffer.facts.sellingHolderSection, true);

  const consultant = parseS8Filing(readFixture("s8-consultant-service-provider-risk"));
  assert.equal(consultant.facts.consultantAdvisorServiceProvider, true);
  assert.equal(consultant.facts.investorRelationsPromotionalFinancingServices, true);
  assert.equal(consultant.facts.shellReverseMergerDelinquentFiler, true);

  const conflicting = parseS8Filing(readFixture("s8-pos-conflicting-additional-securities"));
  assert.equal(conflicting.facts.s8PosRegistersAdditionalSecurities, true);
  assert.equal(conflicting.facts.normalizedS8Type, "ambiguous_conflicting_s8_family");
  assert.equal(conflicting.facts.feeTableRows?.[0]?.amountRegistered, 1200000);
  assert.equal(conflicting.facts.feeTablePurposeConflicts?.length, 2);
  assert.equal(conflicting.warnings.includes("S-8 POS appears to register additional securities and must not be treated as routine."), true);
});

test("parser extracts S-8 fee tables from EX-FILING FEES, primary, HTML, and plain text fallback", () => {
  const douglas = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  assert.equal(douglas.facts.exFilingFeesExhibit, true);
  assert.equal(douglas.facts.feeTableSource, "ex_filing_fees");
  assert.equal(douglas.facts.feeTableExtractionConfidence, "high");
  assert.equal(douglas.facts.feeTableRows?.length, 2);
  assert.equal(douglas.facts.registeredShares, 4412397);

  const primary = parseS8Filing(readFixture("fee-primary-table-fallback"));
  assert.equal(primary.facts.feeTableSource, "primary_document");
  assert.equal(primary.facts.feeTableRows?.[0]?.amountRegistered, 5000000);
  assert.equal(primary.facts.feeTableRows?.[0]?.maximumAggregateOfferingPrice, 61700000);
  assert.equal(primary.facts.registrationFee, 9445.27);

  const plainText = parseS8Filing(readFixture("inducement-awards"));
  assert.equal(plainText.facts.feeTableRows?.length, 2);
  assert.equal(plainText.facts.feeTableRows?.[0]?.source, "plain_text");
  assert.equal(plainText.facts.registeredShares, 81600);
});

test("parser preserves Rule 416, plan interests, indeterminate values, multiple rows, and unusual fee securities", () => {
  const rule416 = parseS8Filing(readFixture("fee-rule-416-and-plan-interests"));
  assert.equal(rule416.facts.rule416, true);
  assert.equal(rule416.facts.planInterests, true);
  assert.equal(rule416.facts.feeTableRows?.length, 2);
  assert.equal(rule416.facts.feeTableRows?.[1]?.isPlanInterest, true);
  assert.equal(rule416.facts.feeTableRows?.[1]?.amountRegistered, null);
  assert.equal(rule416.facts.registeredShares, 2000000);

  const indeterminate = parseS8Filing(readFixture("fee-indeterminate-amount"));
  assert.equal(indeterminate.facts.planInterests, true);
  assert.equal(indeterminate.facts.feeTableRows?.[0]?.amountRegistered, null);
  assert.equal(indeterminate.facts.registeredShares, null);
  assert.deepEqual(indeterminate.signals, []);

  const unusual = parseS8Filing(readFixture("fee-unusual-security"));
  assert.equal(unusual.facts.unusualFeeTableSecurities, true);
});

test("fee extraction keeps administrative deregistration safe and General Instruction E analysis-needed", () => {
  const deregistration = parseS8Filing(readFixture("s8-pos-deregistration-only"));
  assert.equal(deregistration.facts.feeTableRows, undefined);

  const additional = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  assert.equal(additional.facts.generalInstructionE, true);
  assert.equal(additional.facts.feeTableRows?.length, 2);
});

test("parser extracts cover-page and explanatory-note plan names conservatively", () => {
  const single = parseS8Filing(readFixture("plan-cover-single"));
  assert.deepEqual(single.facts.planNames, ["Cover Plan Inc. 2025 Equity Incentive Plan"]);
  assert.equal(single.facts.planNameFacts?.[0]?.planType, "equity_incentive");
  assert.equal(single.facts.planShareAllocations?.[0]?.evidenceLevel, "inferred");

  const multiple = parseS8Filing(readFixture("plan-cover-multiple"));
  assert.equal(multiple.facts.planNames.includes("Multi Plan Co. 2025 Equity Incentive Plan"), true);
  assert.equal(multiple.facts.planNames.includes("Multi Plan Co. 2024 Employee Stock Purchase Plan"), true);
  assert.equal(multiple.facts.planNameFacts?.find((plan) => /Employee Stock Purchase/.test(plan.name))?.planType, "employee_stock_purchase");
  assert.equal(multiple.warnings.includes("Multiple plan names were detected, but no clear share allocation was available."), true);

  const douglas = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  assert.equal(douglas.facts.planNames.some((name) => /Management Incentive Plan/.test(name)), true);
  assert.equal(douglas.facts.planNames.some((name) => /Employee Stock Purchase Plan/.test(name)), true);
});

test("parser links fee rows to plans only when allocation is source-supported", () => {
  const footnote = parseS8Filing(readFixture("plan-fee-footnote-links"));
  assert.equal(footnote.facts.planNames.includes("Footnote Match Corp. 2025 Equity Incentive Plan"), true);
  assert.equal(footnote.facts.planShareAllocations?.[0]?.planName, "Footnote Match Corp. 2025 Equity Incentive Plan");
  assert.equal(footnote.facts.planShareAllocations?.[0]?.shares, 1250000);
  assert.equal(footnote.facts.planShareAllocations?.[0]?.evidenceLevel, "direct");

  const twoRows = parseS8Filing(readFixture("plan-two-rows-two-plans"));
  assert.equal(twoRows.facts.planShareAllocations?.length, 2);
  assert.equal(twoRows.facts.planShareAllocations?.[0]?.shares, 2000000);
  assert.equal(twoRows.facts.planShareAllocations?.[1]?.shares, 500000);
  assert.equal(twoRows.facts.generalInstructionE, true);

  const combined = parseS8Filing(readFixture("plan-combined-row-two-plans"));
  assert.equal(combined.facts.planShareAllocations?.[0]?.linkedPlanNames?.length, 2);
  assert.equal(combined.facts.planShareAllocations?.[0]?.shares, 4000000);
  assert.equal(combined.warnings.includes("A fee-table row mentions multiple plans without allocating shares among them."), true);
});

test("parser keeps plan interests separate and uses exhibit/legal-opinion plan names only as fallback", () => {
  const planInterests = parseS8Filing(readFixture("fee-rule-416-and-plan-interests"));
  assert.equal(planInterests.facts.planInterests, true);
  assert.equal(planInterests.facts.registeredShares, 2000000);
  assert.equal(planInterests.warnings.includes("Plan interests are present and must not be mixed with common-stock share counts."), true);

  const exhibit = parseS8Filing(readFixture("plan-exhibit-fallbacks"));
  assert.equal(exhibit.facts.planNames.includes("Exhibit Plan Corp. 2025 Equity Incentive Plan"), true);
  assert.equal(exhibit.facts.planNameFacts?.[0]?.sources.includes("legal_opinion"), true);
  assert.equal(exhibit.warnings.includes("At least one plan name appears only in exhibit-derived or exhibit-supporting text."), true);

  const generic = parseS8Filing(readFixture("plan-generic-ambiguous"));
  assert.equal(generic.facts.planNames.length, 0);
  assert.equal(generic.facts.planExtractionConfidence, "low");
});

test("consultant or advisor eligibility language remains analysis-needed when tied to S-8 plan context", () => {
  const consultant = parseS8Filing(readFixture("s8-consultant-service-provider-risk"));
  assert.equal(consultant.facts.consultantAdvisorServiceProvider, true);
});

test("consultant/advisor boilerplate is recorded without becoming a substantive high-risk blocker", () => {
  const boilerplate = parseS8Filing(readFixture("consultant-boilerplate-eligibility"));
  assert.equal(boilerplate.facts.consultantAdvisorContexts?.[0]?.bucket, "boilerplate_reference");
  assert.equal(boilerplate.facts.consultantAdvisorServiceProvider, false);
  assert.equal(boilerplate.facts.investorRelationsPromotionalFinancingServices, false);
  assert.deepEqual(boilerplate.signals, []);

  const legalTax = parseS8Filing(readFixture("consultant-legal-tax-advisor-boilerplate"));
  assert.equal(legalTax.facts.consultantAdvisorContexts?.length ?? 0, 0);
  assert.equal(legalTax.facts.consultantAdvisorServiceProvider, false);

  const exhibitOnly = parseS8Filing(readFixture("consultant-exhibit-index-only"));
  assert.equal(exhibitOnly.facts.consultantAdvisorContexts?.[0]?.bucket, "boilerplate_reference");
  assert.equal(exhibitOnly.facts.consultantAdvisorServiceProvider, false);
});

test("substantive consultant/service-provider eligibility and recipient contexts remain analysis-needed", () => {
  const issuable = parseS8Filing(readFixture("consultant-explanatory-issuable"));
  assert.equal(issuable.facts.consultantAdvisorContexts?.[0]?.bucket, "actual_recipient_or_issuance");
  assert.equal(issuable.facts.consultantAdvisorServiceProvider, true);

  const serviceProviders = parseS8Filing(readFixture("consultant-plan-service-providers"));
  assert.equal(serviceProviders.facts.consultantAdvisorContexts?.some((context) => context.bucket === "plan_eligibility"), true);
  assert.equal(serviceProviders.facts.consultantAdvisorServiceProvider, true);
  assert.equal(
    serviceProviders.warnings.includes("Consultant/advisor/service-provider language appears in substantive plan eligibility context."),
    true,
  );

  const agreements = parseS8Filing(readFixture("consultant-agreement-shares"));
  assert.equal(agreements.facts.consultantAdvisorContexts?.some((context) => context.bucket === "actual_recipient_or_issuance"), true);
  assert.equal(agreements.facts.consultantAdvisorServiceProvider, true);
});

test("financing, promotional, and investor-relations consultant contexts produce stronger analysis-needed warnings", () => {
  const ir = parseS8Filing(readFixture("consultant-investor-relations"));
  assert.equal(ir.facts.investorRelationsPromotionalFinancingServices, true);
  assert.equal(ir.facts.consultantAdvisorContexts?.[0]?.bucket, "financing_or_promotion_related");
  assert.equal(
    ir.warnings.includes("Consultant/advisor language appears near financing, promotion, market, or investor-relations services."),
    true,
  );

  const financing = parseS8Filing(readFixture("consultant-financing-services"));
  assert.equal(financing.facts.investorRelationsPromotionalFinancingServices, true);
  assert.equal(financing.facts.consultantAdvisorContexts?.some((context) => context.bucket === "financing_or_promotion_related"), true);
});

test("administrative amendment facts remain separate from low-signal consultant boilerplate", () => {
  const deregistration = parseS8Filing(readFixture("consultant-deregistration-boilerplate"));
  assert.equal(deregistration.facts.consultantAdvisorContexts?.[0]?.bucket, "boilerplate_reference");
  assert.equal(deregistration.facts.consultantAdvisorServiceProvider, false);

  const reoffer = parseS8Filing(readFixture("reoffer-prospectus-sellingholders"));
});

test("parser keeps reoffer/resale headings analysis-needed even without a parsed table", () => {
  const reoffer = parseS8Filing(readFixture("selling-reoffer-no-table"));
  assert.equal(reoffer.facts.reofferProspectus, true);
  assert.equal(reoffer.facts.sellingHolderSection, true);
  assert.equal(reoffer.facts.sellingSecurityholders, undefined);
  assert.equal(reoffer.warnings.includes("Selling-holder heading detected, but no selling-holder table rows were parsed."), true);
});

test("parser extracts selling-holder HTML tables with relationships and offered shares", () => {
  const parsed = parseS8Filing(readFixture("selling-html-basic"));
  assert.equal(parsed.facts.sellingSecurityholders?.length, 2);
  assert.equal(parsed.facts.sellingSecurityholders?.[0]?.name, "Jane Smith");
  assert.equal(parsed.facts.sellingSecurityholders?.[0]?.relationshipHint, "officer");
  assert.equal(parsed.facts.sellingSecurityholders?.[0]?.sharesOffered, 125000);
});

test("parser extracts before/after beneficial ownership and selling-holder footnotes", () => {
  const parsed = parseS8Filing(readFixture("selling-beneficial-before-after"));
  const holder = parsed.facts.sellingSecurityholders?.[0];
  assert.equal(holder?.name, "Alice Jones");
  assert.equal(holder?.relationshipHint, "former_officer");
  assert.equal(holder?.sharesOwnedBefore, 300000);
  assert.equal(holder?.sharesOffered, 200000);
  assert.equal(holder?.sharesOwnedAfter, 100000);
  assert.equal(holder?.percentOwnedAfter, "*");
  assert.equal(holder?.footnoteText?.some((text) => /assumes all shares offered are sold/i.test(text)), true);
});

test("parser preserves less-than-one-percent text and supports plain-text selling-holder fallback", () => {
  const lessThanOne = parseS8Filing(readFixture("selling-shareholders-less-than-one"));
  assert.equal(lessThanOne.facts.sellingSecurityholders?.[0]?.percentOwnedAfter, "less than 1%");
  assert.equal(lessThanOne.facts.sellingSecurityholders?.[0]?.relationshipHint, "consultant");

  const plain = parseS8Filing(readFixture("selling-plain-text-table"));
  assert.equal(plain.facts.sellingSecurityholders?.[0]?.name, "David Park");
  assert.equal(plain.facts.sellingSecurityholders?.[0]?.sharesOffered, 75000);
  assert.equal(plain.facts.sellingSecurityholders?.[0]?.percentOwnedBefore, "<1%");
});

test("Rule 144 is weak outside resale context and strong inside reoffer/selling-holder context", () => {
  const outside = parseS8Filing(readFixture("selling-rule144-outside"));
  assert.equal(outside.facts.rule144, true);
  assert.equal(outside.facts.rule144InResaleContext, undefined);

  const inside = parseS8Filing(readFixture("selling-rule144-inside"));
  assert.equal(inside.facts.rule144, true);
  assert.equal(inside.facts.rule144InResaleContext, true);
  assert.equal(inside.facts.controlSecurities, true);
  assert.equal(inside.facts.restrictedSecurities, true);
  assert.equal(inside.facts.sellingSecurityholders?.[0]?.relationshipHint, "affiliate");
});

test("parser avoids false positives from exhibit-index and fee tables, and preserves safe deregistration", () => {
  const falsePositive = parseS8Filing(readFixture("selling-false-positive-tables"));
  assert.equal(falsePositive.facts.sellingSecurityholders, undefined);
  assert.equal(falsePositive.facts.sellingHolderSection, false);

  const deregistration = parseS8Filing(readFixture("s8-pos-deregistration-only"));
});

test("administrative source facts still expose blockers for downstream analysis", () => {
  const pureDeregistration = parseS8Filing(readFixture("s8-pos-deregistration-only"));

  const reofferDeregistration = parseS8Filing(readFixture("routing-deregistration-with-reoffer"));
  assert.equal(reofferDeregistration.facts.deregistrationOfUnsoldSecurities, true);
  assert.equal(reofferDeregistration.facts.reofferProspectus, true);

  const feeConflict = parseS8Filing(readFixture("routing-deregistration-new-fee-table"));
  assert.equal(feeConflict.facts.deregistrationOfUnsoldSecurities, true);
  assert.equal(feeConflict.facts.feeTableRows?.[0]?.amountRegistered, 100000);
  assert.equal(
    feeConflict.warnings.includes("Filing purpose says no additional or unsold securities, but fee table contains newly registered securities."),
    true,
  );

  const exhibitSellingHolder = parseS8Filing(readFixture("routing-exhibit-only-selling-holder"));
  assert.equal(exhibitSellingHolder.facts.exhibitOnly, true);
  assert.equal(exhibitSellingHolder.facts.sellingSecurityholders?.length, 1);
});

test("parser records weak Rule 144 and low-confidence extraction facts", () => {
  const rule144Outside = parseS8Filing(readFixture("routing-admin-rule144-outside"));
  assert.equal(rule144Outside.facts.rule144, true);
  assert.equal(rule144Outside.facts.rule144InResaleContext, undefined);

  const lowFee = parseS8Filing(readFixture("routing-low-confidence-fee-admin"));
  assert.equal(lowFee.facts.likelyFeeTableMaterial, true);
  assert.equal(lowFee.facts.feeTableExtractionConfidence, "low");

  const lowSection = parseS8Filing(readFixture("routing-section-low-confidence-admin"));
  assert.equal(lowSection.facts.sectionExtractionConfidence, "low");
});

test("parser leaves routine registrations and General Instruction E as source facts only", () => {
  const routine = parseS8Filing(readFixture("routine-small-plan"));

  const generalInstructionE = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  assert.equal(generalInstructionE.facts.generalInstructionE, true);

  const cleanFeePlan = parseS8Filing(readFixture("plan-cover-single"));
  assert.equal(cleanFeePlan.facts.feeTableRows?.[0]?.amountRegistered, 1000000);
  assert.equal(cleanFeePlan.facts.planNames.length, 1);
});

function readFixture(name: string): S8FixtureInput {
  return readJson(join("fixtures", `${name}.json`));
}

function readExpected(name: string): S8RequiredFixtureOutput {
  return readJson(join("expected", `${name}.expected.json`));
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(roomDir, relativePath), "utf8")) as T;
}
