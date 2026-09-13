import assert from "node:assert/strict";
import test from "node:test";
import { buildSecTickerProjectionComponents } from "./productProjection.ts";
import type { SecTickerEffectiveReadResult } from "./humanReview.ts";

const issuerCik = "0001854445";
const securityTitle = "Common Stock, par value $0.001 per share";
type EffectiveAvailable = Extract<SecTickerEffectiveReadResult, { status: "available" }>;

test("builds the actual VRAR to GGRP to BTLN security chain", () => {
  const result = buildSecTickerProjectionComponents([
    effectiveEdge({
      afterAcceptedAt: "2026-05-14T20:02:06.000Z",
      afterAccession: "0001493152-26-023049",
      decisionId: "67ebe0d3-4592-58a9-b1bf-6c0d32a60b8a",
      effectiveDate: "2026-02-19",
      newTicker: "GGRP",
      oldTicker: "VRAR",
      beforeAcceptedAt: "2026-02-17T13:35:45.000Z",
      beforeAccession: "0001493152-26-006951",
    }),
    effectiveEdge({
      afterAcceptedAt: "2026-09-11T21:15:17.000Z",
      afterAccession: "0001493152-26-042421",
      decisionId: "92f17062-2c62-5736-97bf-428e0d779585",
      effectiveDate: "2026-08-20",
      newTicker: "BTLN",
      oldTicker: "GGRP",
      beforeAcceptedAt: "2026-08-19T12:10:31.000Z",
      beforeAccession: "0001493152-26-039128",
    }),
  ], new Date("2026-09-13T00:00:00.000Z"));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0]?.currentTicker, "BTLN");
  assert.deepEqual(result.components[0]?.historicalTickers, ["VRAR", "GGRP"]);
  assert.deepEqual(
    result.components[0]?.edges.flatMap((edge) => edge.sourceFilings.map((filing) => filing.historicalTicker)),
    ["VRAR", "GGRP", "GGRP", "BTLN"],
  );
});

test("approved effective-date conflict is accepted while pending and rejected are blocked", () => {
  const approved = effectiveEdge({
    disposition: "approved",
    state: "REVIEW",
    effectiveDate: "2026-02-01",
  });
  const result = buildSecTickerProjectionComponents([
    approved,
    effectiveEdge({ decisionId: "20000000-0000-4000-8000-000000000002", disposition: "pending_review" }),
    effectiveEdge({ decisionId: "20000000-0000-4000-8000-000000000003", disposition: "rejected" }),
  ], new Date("2026-09-13T00:00:00.000Z"));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0]?.currentTicker, "GGRP");
});

test("fails the whole connected security graph closed on a branch", () => {
  const result = buildSecTickerProjectionComponents([
    effectiveEdge({ oldTicker: "AAA", newTicker: "BBB" }),
    effectiveEdge({ decisionId: "30000000-0000-4000-8000-000000000002", oldTicker: "BBB", newTicker: "CCC", effectiveDate: "2026-06-01", beforeAcceptedAt: "2026-05-01T00:00:00.000Z", afterAcceptedAt: "2026-07-01T00:00:00.000Z" }),
    effectiveEdge({ decisionId: "30000000-0000-4000-8000-000000000003", oldTicker: "BBB", newTicker: "DDD", effectiveDate: "2026-06-02", beforeAcceptedAt: "2026-05-02T00:00:00.000Z", afterAcceptedAt: "2026-07-02T00:00:00.000Z" }),
  ], new Date("2026-09-13T00:00:00.000Z"));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.components, []);
});

test("fails cycles, mixed security claims, and incomplete official reads closed", () => {
  const cycle = buildSecTickerProjectionComponents([
    effectiveEdge({ oldTicker: "AAA", newTicker: "BBB" }),
    effectiveEdge({ decisionId: "40000000-0000-4000-8000-000000000002", oldTicker: "BBB", newTicker: "AAA", effectiveDate: "2026-06-01", beforeAcceptedAt: "2026-05-01T00:00:00.000Z", afterAcceptedAt: "2026-07-01T00:00:00.000Z" }),
  ], new Date("2026-09-13T00:00:00.000Z"));
  assert.equal(cycle.ok, true);
  if (cycle.ok) assert.deepEqual(cycle.components, []);

  const mixed = buildSecTickerProjectionComponents([
    effectiveEdge({ oldTicker: "VEEA", newTicker: "VEEAN" }),
    effectiveEdge({ decisionId: "40000000-0000-4000-8000-000000000003", oldTicker: "VEEA", newTicker: "VEEAW", securityType: "warrant", dimensions: [{ axis: "Class", member: "Warrant" }] }),
  ], new Date("2026-09-13T00:00:00.000Z"));
  assert.equal(mixed.ok, true);
  if (mixed.ok) assert.deepEqual(mixed.components, []);

  const incomplete = buildSecTickerProjectionComponents([
    effectiveEdge({}),
    { status: "unavailable", reason: "decision_read_failed" },
  ], new Date("2026-09-13T00:00:00.000Z"));
  assert.deepEqual(incomplete, { ok: false, reason: "projection_effective_read_incomplete" });
});

test("drops the entire upstream chain when its downstream ticker has another security claim", () => {
  const upstream = effectiveEdge({ oldTicker: "AAA", newTicker: "BBB" });
  const downstream = effectiveEdge({
    decisionId: "45000000-0000-4000-8000-000000000002",
    oldTicker: "BBB",
    newTicker: "CCC",
    effectiveDate: "2026-06-01",
    beforeAcceptedAt: "2026-05-01T00:00:00.000Z",
    afterAcceptedAt: "2026-07-01T00:00:00.000Z",
  });
  const otherSecurity = effectiveEdge({
    decisionId: "45000000-0000-4000-8000-000000000003",
    oldTicker: "CCC",
    newTicker: "DDD",
    effectiveDate: "2026-08-01",
    beforeAcceptedAt: "2026-07-02T00:00:00.000Z",
    afterAcceptedAt: "2026-09-01T00:00:00.000Z",
  });
  const otherIdentity = structuredClone(otherSecurity) as EffectiveAvailable;
  if (otherIdentity.automatic.status !== "available") return;
  assert.ok(otherIdentity.automatic.result.identity);
  otherIdentity.automatic.result.identity.security_type = "warrant";

  const result = buildSecTickerProjectionComponents(
    [upstream, downstream, otherIdentity],
    new Date("2026-09-13T00:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.components, []);
});

test("does not activate a future effective edge", () => {
  const result = buildSecTickerProjectionComponents([
    effectiveEdge({ effectiveDate: "2026-10-01" }),
  ], new Date("2026-09-13T00:00:00.000Z"));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.components, []);
});

function effectiveEdge(input: Partial<{
  afterAcceptedAt: string;
  afterAccession: string;
  beforeAcceptedAt: string;
  beforeAccession: string;
  decisionId: string;
  dimensions: unknown[];
  disposition: "automatic" | "approved" | "pending_review" | "rejected";
  effectiveDate: string;
  newTicker: string;
  oldTicker: string;
  securityType: string;
  state: string;
}> = {}) {
  const decisionId = input.decisionId ?? "10000000-0000-4000-8000-000000000001";
  const oldTicker = input.oldTicker ?? "VRAR";
  const newTicker = input.newTicker ?? "GGRP";
  const beforeAcceptedAt = input.beforeAcceptedAt ?? "2026-02-17T13:35:45.000Z";
  const afterAcceptedAt = input.afterAcceptedAt ?? "2026-05-14T20:02:06.000Z";
  const beforeAccession = input.beforeAccession ?? "0001493152-26-006951";
  const afterAccession = input.afterAccession ?? "0001493152-26-023049";
  const dimensions = input.dimensions ?? [];
  const beforeResultId = decisionId.replace(/.$/, "a");
  const afterResultId = decisionId.replace(/.$/, "b");
  const identityId = decisionId.replace(/.$/, "c");
  const evidenceId = decisionId.replace(/.$/, "d");
  const beforeKey = "b".repeat(64);
  const afterKey = "a".repeat(64);
  const before = observation({ acceptedAt: beforeAcceptedAt, accessionNumber: beforeAccession, observationKey: beforeKey, resultId: beforeResultId, ticker: oldTicker });
  const after = observation({ acceptedAt: afterAcceptedAt, accessionNumber: afterAccession, observationKey: afterKey, resultId: afterResultId, ticker: newTicker });
  return {
    status: "available" as const,
    selectedAutomaticDecisionId: decisionId,
    currentAutomaticDecisionId: decisionId,
    scopeKey: "f".repeat(64),
    history: [],
    latestHumanDecision: null,
    availableActions: [],
    approvalBlockedReason: null,
    effective: {
      disposition: input.disposition ?? "automatic",
      relationship: {
        oldTicker,
        newTicker,
        effectiveDate: input.effectiveDate ?? "2026-02-19",
        identityId,
        evidenceId,
      },
      humanDecisionId: null,
      reviewed: false,
      reconsiderationRequired: false,
    },
    automatic: {
      status: "available" as const,
      result: {
        status: "available" as const,
        decision: { id: decisionId, issuer_cik: issuerCik, resolution_state: input.state ?? "AUTO" },
        identity: {
          id: identityId,
          issuer_cik: issuerCik,
          security_type: input.securityType ?? "common_stock",
          security_class: "",
          before_security_title: securityTitle,
          after_security_title: securityTitle,
          identity_payload: {
            before: { resultId: beforeResultId, observationKey: beforeKey, tradingSymbol: oldTicker, dimensions },
            after: { resultId: afterResultId, observationKey: afterKey, tradingSymbol: newTicker, dimensions },
          },
        },
        evidence: { id: evidenceId, issuer_cik: issuerCik },
        evaluation: {} as never,
        sourceObservations: { before: [before], after: [after] },
      },
    },
  } as unknown as EffectiveAvailable;
}

function observation(input: {
  acceptedAt: string;
  accessionNumber: string;
  observationKey: string;
  resultId: string;
  ticker: string;
}) {
  return {
    ...input,
    issuerCik,
    sourceDocument: input.ticker === "BTLN" || input.accessionNumber.includes("039128") ? "form8-k.htm" : "form10-q.htm",
    sourceSha256: "1".repeat(64),
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/1854445/${input.accessionNumber.replaceAll("-", "")}/form.htm`,
    securityTitle,
    exchange: "NASDAQ",
    tradingSymbol: input.ticker,
  };
}
