import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  stockSplitExecutionId,
  type StockSplitExecution,
  type StockSplitExecutionReadResult,
} from "../monitor/stockSplitExecution.ts";
import {
  appendDilutionCorporateActionProjection,
  planDilutionCorporateActionAdjustments,
  type DilutionLiveContractSnapshot,
  type DilutionSplitClauseBinding,
} from "./corporateActionAdjustment.ts";

const CMG_CIK = "0001058090";
const CMG_CLASS = `sc:v1:${CMG_CIK}:common_stock:single`;
const CMG_SPLIT_ACCESSION = "0001058090-24-000024";
const CMG_PLAN_ACCESSION = "0001140361-22-012495";
const CMG_PLAN_URL = "https://www.sec.gov/Archives/edgar/data/1058090/000114036122012495/ny20002259x1_def14a.htm";
const CMG_PLAN_SOURCE = [
  "the number and class of securities available under this Plan",
  "the number and class of securities subject to each outstanding Option and Stock Appreciation Right and the exercise price or base price per share",
].join(" | ");

const RNAZ_CIK = "0001829635";
const RNAZ_CLASS = `sc:v1:${RNAZ_CIK}:common_stock:single`;
const RNAZ_SPLIT_ACCESSION = "0001104659-24-004094";
const RNAZ_WARRANT_ACCESSION = "0001104659-23-123274";
const RNAZ_WARRANT_URL = "https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm";
const RNAZ_WARRANT_SOURCE = [
  "the Exercise Price shall be multiplied by a fraction",
  "the number of shares issuable upon exercise of this Warrant shall be proportionately adjusted",
].join(" | ");

const documents = [
  { source_ref: "cmg_2022_plan", label: "CMG 2022 Stock Incentive Plan", text: CMG_PLAN_SOURCE },
  { source_ref: "rnaz_placement_warrant", label: "RNAZ Placement Agent Warrant", text: RNAZ_WARRANT_SOURCE },
];

const cmgExecution = execution({
  actionKind: "forward_split",
  issuerCik: CMG_CIK,
  canonicalSecurityClassId: CMG_CLASS,
  effectiveDate: "2024-06-26",
  oldShareUnits: "1",
  newShareUnits: "50",
  accessionNumber: CMG_SPLIT_ACCESSION,
});

const rnazExecution = execution({
  actionKind: "reverse_split",
  issuerCik: RNAZ_CIK,
  canonicalSecurityClassId: RNAZ_CLASS,
  effectiveDate: "2024-01-16",
  oldShareUnits: "40",
  newShareUnits: "1",
  accessionNumber: RNAZ_SPLIT_ACCESSION,
});

test("official SEC forward split clauses independently adjust a live plan reserve and SOSAR while dollar amounts remain unchanged", async () => {
  const reserve = snapshot({
    issuerCik: CMG_CIK,
    canonicalSecurityClassId: CMG_CLASS,
    instrumentKey: "cmg-2022-plan-reserve",
    instrumentId: "1",
    baseSnapshotId: "11",
    asOfDate: "2024-06-05",
    values: { share_reserve: "2431419", original_amount: "250000000" },
  });
  const sosar = snapshot({
    issuerCik: CMG_CIK,
    canonicalSecurityClassId: CMG_CLASS,
    instrumentKey: "cmg-sosar-2024-q1",
    instrumentId: "2",
    baseSnapshotId: "12",
    asOfDate: "2024-03-31",
    values: { option_shares: "304000", exercise_price: "1526.40", original_amount: "8000000" },
  });
  const projections = await planDilutionCorporateActionAdjustments({
    instruments: [reserve, sosar],
    clauseBindings: [
      binding(reserve.instrumentKey, cmgExecution.executionId, CMG_CLASS, CMG_PLAN_ACCESSION, CMG_PLAN_URL, "cmg_2022_plan", [
        ["share_reserve", "multiply_by_split_ratio", "the number and class of securities available under this Plan"],
      ]),
      binding(sosar.instrumentKey, cmgExecution.executionId, CMG_CLASS, CMG_PLAN_ACCESSION, CMG_PLAN_URL, "cmg_2022_plan", [
        ["option_shares", "multiply_by_split_ratio", "the number and class of securities subject to each outstanding Option and Stock Appreciation Right and the exercise price or base price per share"],
        ["exercise_price", "divide_by_split_ratio", "the number and class of securities subject to each outstanding Option and Stock Appreciation Right and the exercise price or base price per share"],
      ]),
    ],
    sourceDocuments: documents,
    targetAt: "2024-06-26T20:00:00Z",
  }, { readExecutions: executionReader([cmgExecution]) });

  assert.equal(projections[0]?.status, "APPLIED");
  assert.deepEqual(projections[0]?.adjustedFields, { share_reserve: "121570950" });
  assert.equal(projections[1]?.status, "APPLIED");
  assert.deepEqual(projections[1]?.adjustedFields, {
    option_shares: "15200000",
    exercise_price: "30.528",
  });
  assert.ok(!Object.hasOwn(projections[0]!.adjustedFields, "original_amount"));
  assert.ok(!Object.hasOwn(projections[1]!.adjustedFields, "original_amount"));
  assert.notEqual(projections[0]?.projectionId, projections[1]?.projectionId);
});

test("official SEC reverse split warrant clause adjusts live shares and exercise price exactly", async () => {
  const warrant = snapshot({
    issuerCik: RNAZ_CIK,
    canonicalSecurityClassId: RNAZ_CLASS,
    instrumentKey: "rnaz-december-2023-placement-agent-warrant",
    instrumentId: "3",
    baseSnapshotId: "13",
    asOfDate: "2023-12-04",
    values: { remaining_units: "300000", exercise_price: "0.3025", original_amount: "90750" },
  });
  const [projection] = await planDilutionCorporateActionAdjustments({
    instruments: [warrant],
    clauseBindings: [binding(
      warrant.instrumentKey,
      rnazExecution.executionId,
      RNAZ_CLASS,
      RNAZ_WARRANT_ACCESSION,
      RNAZ_WARRANT_URL,
      "rnaz_placement_warrant",
      [
        ["remaining_units", "multiply_by_split_ratio", "the number of shares issuable upon exercise of this Warrant shall be proportionately adjusted"],
        ["exercise_price", "divide_by_split_ratio", "the Exercise Price shall be multiplied by a fraction"],
      ],
    )],
    sourceDocuments: documents,
    targetAt: "2024-01-16T20:00:00Z",
  }, { readExecutions: executionReader([rnazExecution]) });

  assert.equal(projection?.status, "APPLIED");
  assert.deepEqual(projection?.adjustedFields, {
    remaining_units: "7500",
    exercise_price: "12.1",
  });
  assert.ok(!Object.hasOwn(projection!.adjustedFields, "original_amount"));
});

test("closed instruments stay unchanged and a live instrument without an exact clause returns Review", async () => {
  const closed = snapshot({
    issuerCik: RNAZ_CIK,
    canonicalSecurityClassId: RNAZ_CLASS,
    instrumentKey: "closed-warrant",
    instrumentId: "4",
    baseSnapshotId: "14",
    asOfDate: "2023-12-04",
    status: "closed",
    values: { remaining_units: "4000", exercise_price: "1" },
  });
  const unsupported = snapshot({
    issuerCik: RNAZ_CIK,
    canonicalSecurityClassId: RNAZ_CLASS,
    instrumentKey: "unsupported-live-warrant",
    instrumentId: "5",
    baseSnapshotId: "15",
    asOfDate: "2023-12-04",
    values: { remaining_units: "4000", exercise_price: "1" },
  });
  const results = await planDilutionCorporateActionAdjustments({
    instruments: [closed, unsupported],
    clauseBindings: [],
    sourceDocuments: documents,
    targetAt: "2024-01-17T20:00:00Z",
  }, { readExecutions: executionReader([rnazExecution]) });

  assert.deepEqual(results[0], {
    version: "dilution-corporate-action-adjustment-v1",
    status: "NOT_APPLICABLE",
    reason: "INSTRUMENT_NOT_CURRENT",
    issuerCik: RNAZ_CIK,
    instrumentKey: "closed-warrant",
    instrumentId: "4",
    baseSnapshotId: "14",
    adjustedFields: {},
  });
  assert.equal(results[1]?.status, "REVIEW");
  assert.equal(results[1]?.reviewReason, "CONTRACT_CLAUSE_MISSING");
  assert.deepEqual(results[1]?.adjustedFields, {});
});

test("ambiguous or non-linkable SEC evidence fails closed without a replacement", async () => {
  const warrant = snapshot({
    issuerCik: RNAZ_CIK,
    canonicalSecurityClassId: RNAZ_CLASS,
    instrumentKey: "evidence-review-warrant",
    instrumentId: "6",
    baseSnapshotId: "16",
    asOfDate: "2023-12-04",
    values: { remaining_units: "300000" },
  });
  const bad = binding(
    warrant.instrumentKey,
    rnazExecution.executionId,
    RNAZ_CLASS,
    RNAZ_WARRANT_ACCESSION,
    RNAZ_WARRANT_URL,
    "rnaz_placement_warrant",
    [["remaining_units", "multiply_by_split_ratio", "the number of shares issuable upon exercise of this Warrant shall be proportionately adjusted"]],
  );
  bad.fieldAdjustments[0]!.evidenceIdentity.source_content_hash = "0".repeat(64);
  const [result] = await planDilutionCorporateActionAdjustments({
    instruments: [warrant],
    clauseBindings: [bad],
    sourceDocuments: documents,
    targetAt: "2024-01-17T20:00:00Z",
  }, { readExecutions: executionReader([rnazExecution]) });

  assert.equal(result?.status, "REVIEW");
  assert.equal(result?.reviewReason, "CONTRACT_EVIDENCE_INVALID");
  assert.deepEqual(result?.adjustedFields, {});

  const mismatchedAccession = structuredClone(bad);
  mismatchedAccession.contractAccession = "0001104659-24-004721";
  mismatchedAccession.fieldAdjustments[0]!.evidenceIdentity.source_content_hash = createHash("sha256")
    .update("the number of shares issuable upon exercise of this Warrant shall be proportionately adjusted")
    .digest("hex");
  const [nonLinkable] = await planDilutionCorporateActionAdjustments({
    instruments: [warrant],
    clauseBindings: [mismatchedAccession],
    sourceDocuments: documents,
    targetAt: "2024-01-17T20:00:00Z",
  }, { readExecutions: executionReader([rnazExecution]) });
  assert.equal(nonLinkable?.status, "REVIEW");
  assert.equal(nonLinkable?.reviewReason, "CONTRACT_CLAUSE_INVALID");
  assert.deepEqual(nonLinkable?.adjustedFields, {});
});

test("projection identity and append are replay-idempotent", async () => {
  const warrant = snapshot({
    issuerCik: RNAZ_CIK,
    canonicalSecurityClassId: RNAZ_CLASS,
    instrumentKey: "replay-warrant",
    instrumentId: "7",
    baseSnapshotId: "17",
    asOfDate: "2023-12-04",
    values: { remaining_units: "300000" },
  });
  const input = {
    instruments: [warrant],
    clauseBindings: [binding(
      warrant.instrumentKey,
      rnazExecution.executionId,
      RNAZ_CLASS,
      RNAZ_WARRANT_ACCESSION,
      RNAZ_WARRANT_URL,
      "rnaz_placement_warrant",
      [["remaining_units", "multiply_by_split_ratio", "the number of shares issuable upon exercise of this Warrant shall be proportionately adjusted"]],
    )],
    sourceDocuments: documents,
    targetAt: "2024-01-17T20:00:00Z",
  };
  const first = (await planDilutionCorporateActionAdjustments(input, {
    readExecutions: executionReader([rnazExecution]),
  }))[0]!;
  const replay = (await planDilutionCorporateActionAdjustments(input, {
    readExecutions: executionReader([rnazExecution]),
  }))[0]!;
  assert.equal(first.status, "APPLIED");
  assert.equal(replay.status, "APPLIED");
  assert.equal(first.projectionId, replay.projectionId);
  if (first.status !== "APPLIED") throw new Error("fixture must apply");
  const appended = await appendDilutionCorporateActionProjection(first, {
    rpc: async () => ({
      ok: true,
      data: { already_saved: true, projection_id: first.projectionId, added: 0 },
    }),
  });
  assert.deepEqual(appended, {
    status: "already_saved",
    projectionId: first.projectionId,
    added: 0,
  });
});

function snapshot(input: Omit<DilutionLiveContractSnapshot, "status"> & {
  status?: DilutionLiveContractSnapshot["status"];
}) {
  return { ...input, status: input.status ?? "current" } satisfies DilutionLiveContractSnapshot;
}

function binding(
  instrumentKey: string,
  executionId: string,
  canonicalSecurityClassId: string,
  contractAccession: string,
  sourceDocumentUrl: string,
  sourceRef: string,
  fields: Array<[string, string, string]>,
): DilutionSplitClauseBinding {
  const document = documents.find((item) => item.source_ref === sourceRef)!;
  return {
    instrumentKey,
    executionId,
    canonicalSecurityClassId,
    contractAccession,
    sourceRef,
    sourceDocumentUrl,
    fieldAdjustments: fields.map(([field, operation, evidence]) => {
      const start = document.text.indexOf(evidence);
      return {
        field,
        operation,
        evidenceIdentity: {
          version: "corporate_action_evidence_identity_v1",
          source_ref: sourceRef,
          range_start: start,
          range_end: start + evidence.length,
          source_content_hash: createHash("sha256").update(evidence).digest("hex"),
          exact_source: true,
        },
      };
    }),
  } as DilutionSplitClauseBinding;
}

function execution(input: {
  actionKind: "forward_split" | "reverse_split";
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
  accessionNumber: string;
}) {
  const executionId = stockSplitExecutionId(input);
  return {
    version: input.actionKind === "forward_split"
      ? "forward_split_execution_v1"
      : "reverse_split_execution_v1",
    status: "CALCULATION_ELIGIBLE",
    executionStatus: "effective",
    executionId,
    issuerCik: input.issuerCik,
    canonicalSecurityClassId: input.canonicalSecurityClassId,
    effectiveDate: input.effectiveDate,
    exactRatio: {
      oldShareUnits: input.oldShareUnits,
      newShareUnits: input.newShareUnits,
    },
    effectiveTiming: { availability: "available", kind: "date_only" },
    calculationActivation: {
      version: "stock_split_day_basis_activation_v1",
      state: "ON_EFFECTIVE_DATE",
      source_meaning: "date_only",
      evidence_identity: null,
    },
    observations: [{
      accessionNumber: input.accessionNumber,
      source: {
        source_family: "sec",
        source_id: input.accessionNumber,
        source_url: `https://www.sec.gov/Archives/edgar/data/${Number(input.issuerCik)}/`,
      },
    }],
  } as StockSplitExecution;
}

function executionReader(executions: StockSplitExecution[]) {
  return async (input: {
    actionKind: "forward_split" | "reverse_split";
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
    targetAt: string;
  }) => {
    const version = input.actionKind === "forward_split"
      ? "forward_split_execution_v1"
      : "reverse_split_execution_v1";
    return {
      status: "available" as const,
      materializationStatus: "SPLIT_EXECUTIONS_AVAILABLE" as const,
      issuerCik: input.cik,
      canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
      from: input.from,
      to: input.to,
      targetAt: input.targetAt,
      basisChangeCoverage: input.actionKind === "forward_split"
        ? "forward_split_only" as const
        : "reverse_split_only" as const,
      executions: executions.filter((item) => item.version === version),
      inactiveExecutions: [],
      conflicts: [],
    } as StockSplitExecutionReadResult;
  };
}
