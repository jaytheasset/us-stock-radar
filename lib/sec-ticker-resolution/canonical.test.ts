import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  evaluateSecTickerResolution,
  secVisibleText,
  type SecTickerResolutionEvaluationInput,
  type VerifiedSecCoverObservation,
} from "./canonical.ts";

const CIK = "0001854445";

test("AUTO: explicit issuer claim binds exact old/new cover observations without catalog state", () => {
  const source = html("Effective February 19, 2026, we changed our ticker symbol on The Nasdaq Stock Market LLC (\"Nasdaq\") from \"VRAR\" to \"GGRP.\" The change was implemented to align our ticker. The change did not alter our business model or other terms of our common stock.");
  const result = evaluate(source, cover("before", "0001493152-26-006951", "VRAR", "2026-02-17T13:35:45Z"), cover("source", "0001493152-26-023049", "GGRP", "2026-05-14T20:02:06Z"));
  assert.equal(result.resolutionState, "AUTO");
  assert.deepEqual(result.summary, {
    oldTicker: "VRAR",
    newTicker: "GGRP",
    effectiveDate: "2026-02-19",
    effectivePrecision: "date",
    securityType: "common_stock",
    securityClass: null,
    continuityBasis: "unchanged_terms",
    sourceTextSpanSha256: result.summary.sourceTextSpanSha256,
  });
  assert.ok(result.identity);
  assert.ok(result.evidence);
  assert.equal(result.evidence?.source_text_span, secVisibleText(source));
});

test("AUTO: market-open claim uses source cover as old symbol and keeps name-change timestamp separate", () => {
  const source = html("On August 17, 2026, the Company filed a name amendment. The Name Change Amendment will become effective at 12:01 a.m. Eastern Time on August 20, 2026. The Name Change Amendment will not in any way affect the voting or other rights that accompany the Company's common stock, par value $0.001 per share (\"Common Stock\"), or the validity or transferability of the shares of Common Stock currently outstanding. The Company's shares of Common Stock continue to be quoted on The Nasdaq Capital Market. Beginning with the opening of trading on August 20, 2026, trading will be done under the new corporate name and symbol \"BTLN\" (the \"Symbol Change\"). There will be no change to the Common Stock's CUSIP in connection with the Name Change Amendment or the Symbol Change.");
  const result = evaluate(source, cover("source", "0001493152-26-039128", "GGRP", "2026-08-19T12:10:31Z"), cover("after", "0001493152-26-042421", "BTLN", "2026-09-11T21:15:17Z"), {
    evidenceAccessionNumber: "0001493152-26-039128",
    beforeAccessionNumber: "0001493152-26-039128",
    afterAccessionNumber: "0001493152-26-042421",
  });
  assert.equal(result.resolutionState, "AUTO");
  assert.equal(result.summary.oldTicker, "GGRP");
  assert.equal(result.summary.newTicker, "BTLN");
  assert.equal(result.summary.effectiveDate, "2026-08-20");
  assert.equal(result.summary.effectivePrecision, "market_open");
  assert.equal(result.evidence?.effective_at, null);
  assert.doesNotMatch(String(result.evidence?.effective_text), /12:01 a\.m\./);
});

test("UNRESOLVED: title, CIK, similar symbols, or a dated cover sequence do not invent change evidence", () => {
  const result = evaluate(html("The common stock continued to trade normally."), cover("before", "0001493152-26-006951", "VRAR", "2026-02-17T13:35:45Z"), cover("source", "0001493152-26-023049", "GGRP", "2026-05-14T20:02:06Z"));
  assert.equal(result.resolutionState, "UNRESOLVED");
  assert.ok(result.reasons.includes("SUPPORTED_CHANGE_EVIDENCE_MISSING"));
  assert.equal(result.evidence, null);
});

test("REVIEW: common/warrant and Class A/B ambiguity stay separated", () => {
  const claim = html("Effective February 19, 2026, we changed our ticker symbol on Nasdaq from \"OLD\" to \"NEW.\" The change did not alter other terms of our common stock.");
  const common = cover("before", "0001493152-26-006951", "OLD", "2026-02-17T13:35:45Z");
  const warrant = { ...common, observationKey: "warrant", securityTitle: "Warrants", tradingSymbol: "OLDW", dimensions: [{ member: "WarrantMember" }] };
  const after = cover("source", "0001493152-26-023049", "NEW", "2026-05-14T20:02:06Z");
  const multiple = evaluateInput(claim, [common, warrant], [after]);
  assert.equal(multiple.resolutionState, "REVIEW");
  assert.ok(multiple.reasons.includes("BEFORE_COVER_MULTIPLE_SECURITY_CANDIDATES"));

  const classConflict = evaluate(claim, { ...common, securityTitle: "Class A Common Stock" }, { ...after, securityTitle: "Class B Common Stock" });
  assert.equal(classConflict.resolutionState, "REVIEW");
  assert.ok(classConflict.reasons.includes("SECURITY_CLASS_CONFLICT"));

  const dimensionConflict = evaluate(claim, { ...common, dimensions: [{ member: "ClassAMember" }] }, { ...after, dimensions: [{ member: "ClassBMember" }] });
  assert.equal(dimensionConflict.resolutionState, "REVIEW");
  assert.ok(dimensionConflict.reasons.includes("SECURITY_DIMENSIONS_CONFLICT"));

  const adrScope = evaluate(claim, { ...common, securityTitle: "American Depositary Shares" }, { ...after, securityTitle: "American Depositary Shares" });
  assert.equal(adrScope.resolutionState, "UNRESOLVED");
  assert.ok(adrScope.reasons.includes("SECURITY_SCOPE_UNSUPPORTED"));

  const incompleteCompetingClass = evaluateInput(claim, [
    common,
    { ...common, observationKey: "before-class-b", dimensions: [{ member: "ClassBMember" }], exchangeStatus: "source_missing", exchange: null },
  ], [after]);
  assert.equal(incompleteCompetingClass.resolutionState, "REVIEW");
  assert.ok(incompleteCompetingClass.reasons.includes("BEFORE_COVER_MULTIPLE_SECURITY_CANDIDATES"));

  const missingTickerCompetingClass = evaluateInput(claim, [
    common,
    { ...common, observationKey: "before-class-b-missing-symbol", securityTitle: "Class B Common Stock", dimensions: [{ member: "ClassBMember" }], tradingSymbolStatus: "source_missing", tradingSymbol: null },
  ], [after]);
  assert.equal(missingTickerCompetingClass.resolutionState, "REVIEW");
  assert.ok(missingTickerCompetingClass.reasons.includes("BEFORE_COVER_MULTIPLE_SECURITY_CANDIDATES"));
});

test("REVIEW: conflicting CIK, ticker, effective chronology, and multiple claims fail closed", () => {
  const claim = html("Effective February 19, 2026, we changed our ticker symbol on Nasdaq from \"OLD\" to \"NEW.\" The change did not alter other terms of our common stock. Effective February 20, 2026, we changed our ticker symbol on Nasdaq from \"OLD\" to \"NEW2.\" The change did not alter other terms of our common stock.");
  const before = { ...cover("before", "0001493152-26-006951", "OLD", "2026-03-01T00:00:00Z"), issuerCik: "0000001234" };
  const after = cover("source", "0001493152-26-023049", "DIFFERENT", "2026-05-14T20:02:06Z");
  const result = evaluate(claim, before, after);
  assert.equal(result.resolutionState, "REVIEW");
  assert.ok(result.reasons.some((reason) => reason.includes("MULTIPLE")));
  assert.ok(result.reasons.includes("BEFORE_COVER_OBSERVATION_MISSING"));
});

test("negated, hypothetical, and third-party quoted claims never become AUTO", () => {
  const variants = [
    "Effective February 19, 2026, we did not change our ticker symbol from \"OLD\" to \"NEW.\" The change did not alter other terms of our common stock.",
    "If approved, Effective February 19, 2026, we changed our ticker symbol from \"OLD\" to \"NEW.\" The change did not alter other terms of our common stock.",
    "A third party said, \"Effective February 19, 2026, we changed our ticker symbol from OLD to NEW.\" The change did not alter other terms of our common stock.",
  ];
  for (const source of variants) {
    const result = evaluate(html(source), cover("before", "0001493152-26-006951", "OLD", "2026-02-17T13:35:45Z"), cover("source", "0001493152-26-023049", "NEW", "2026-05-14T20:02:06Z"));
    assert.notEqual(result.resolutionState, "AUTO", source);
  }
});

test("target conflicts and complex transactions are REVIEW, while unrelated historical merger text is ignored", () => {
  const exact = "Effective February 19, 2026, we changed our ticker symbol on Nasdaq from \"OLD\" to \"NEW.\" The change did not alter other terms of our common stock.";
  const before = cover("before", "0001493152-26-006951", "OLD", "2026-02-17T13:35:45Z");
  const after = cover("source", "0001493152-26-023049", "NEW", "2026-05-14T20:02:06Z");
  assert.equal(evaluate(html(`Years ago we considered a merger. ${exact}`), before, after).resolutionState, "AUTO");

  const complex = evaluate(html(`The following ticker symbol change results from a reverse merger with a successor issuer. ${exact}`), before, after);
  assert.equal(complex.resolutionState, "REVIEW");
  assert.ok(complex.reasons.includes("COMPLEX_TARGET_TRANSACTION"));

  const trailingComplex = evaluate(html(`${exact} This ticker change is part of a reverse merger.`), before, after);
  assert.equal(trailingComplex.resolutionState, "REVIEW");
  assert.ok(trailingComplex.reasons.includes("COMPLEX_TARGET_TRANSACTION"));

  const conflict = evaluate(html(`${exact} The ticker symbol will not change.`), before, after);
  assert.equal(conflict.resolutionState, "REVIEW");
  assert.ok(conflict.reasons.includes("TARGET_EVIDENCE_CONFLICT"));

  const pastTenseCusipConflict = evaluate(html(`${exact} The common stock CUSIP changed from 123456789 to 987654321.`), before, after);
  assert.equal(pastTenseCusipConflict.resolutionState, "REVIEW");
  assert.ok(pastTenseCusipConflict.reasons.includes("TARGET_EVIDENCE_CONFLICT"));
});

function evaluate(
  source: string,
  before: VerifiedSecCoverObservation,
  after: VerifiedSecCoverObservation,
  overrides: Partial<Pick<SecTickerResolutionEvaluationInput, "evidenceAccessionNumber" | "beforeAccessionNumber" | "afterAccessionNumber">> = {},
) {
  return evaluateInput(source, [before], [after], overrides);
}

function evaluateInput(
  rawContent: string,
  beforeObservations: readonly VerifiedSecCoverObservation[],
  afterObservations: readonly VerifiedSecCoverObservation[],
  overrides: Partial<Pick<SecTickerResolutionEvaluationInput, "evidenceAccessionNumber" | "beforeAccessionNumber" | "afterAccessionNumber">> = {},
) {
  const sourceObservation = [...beforeObservations, ...afterObservations].find((row) => row.resultId === "source")!;
  const evidenceAccessionNumber = overrides.evidenceAccessionNumber ?? sourceObservation.accessionNumber;
  return evaluateSecTickerResolution({
    issuerCik: CIK,
    evidenceAccessionNumber,
    beforeAccessionNumber: overrides.beforeAccessionNumber ?? "0001493152-26-006951",
    beforeSourceSha256: "a".repeat(64),
    afterAccessionNumber: overrides.afterAccessionNumber ?? "0001493152-26-023049",
    afterSourceSha256: "a".repeat(64),
    source: {
      resultId: sourceObservation.resultId,
      accessionNumber: evidenceAccessionNumber,
      issuerCik: CIK,
      rawSourceId: "10000000-0000-4000-8000-000000000001",
      url: `https://www.sec.gov/Archives/edgar/data/1854445/${evidenceAccessionNumber.replace(/-/g, "")}/primary.htm`,
      documentName: "primary.htm",
      sha256: sha256(rawContent),
      rawContent,
    },
    beforeObservations,
    afterObservations,
  });
}

function cover(
  resultId: string,
  accessionNumber: string,
  tradingSymbol: string,
  acceptedAt: string,
): VerifiedSecCoverObservation {
  return {
    resultId,
    observationKey: `${resultId}-observation`,
    accessionNumber,
    issuerCik: CIK,
    acceptedAt,
    sourceRawId: `${resultId}-raw`,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/1854445/${accessionNumber.replace(/-/g, "")}/primary.htm`,
    sourceDocument: "primary.htm",
    sourceSha256: "a".repeat(64),
    contextRef: `${resultId}-context`,
    dimensions: [],
    securityTitleStatus: "observed",
    securityTitle: "Common Stock, par value $0.001 per share",
    tradingSymbolStatus: "observed",
    tradingSymbol,
    exchangeStatus: "observed",
    exchange: "The Nasdaq Stock Market LLC",
  };
}

function html(text: string) {
  return `<html><body><p>${text}</p></body></html>`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
