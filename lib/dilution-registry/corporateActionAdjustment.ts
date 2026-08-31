import { createHash } from "node:crypto";
import {
  validateCorporateActionEvidenceIdentity,
  verifyCorporateActionEvidenceIdentity,
  type CorporateActionEvidenceIdentity,
  type CorporateActionSourceDocument,
} from "../monitor/corporateActionCanonicalFacts.ts";
import {
  readStockSplitExecutions,
  stockSplitExecutionActivationDecision,
  stockSplitExecutionId,
  type StockSplitExecution,
  type StockSplitExecutionReadResult,
} from "../monitor/stockSplitExecution.ts";

export const DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION =
  "dilution-corporate-action-adjustment-v1" as const;
export const DILUTION_CORPORATE_ACTION_BINDING_VERSION =
  "dilution-corporate-action-clause-binding-v1" as const;

export const DILUTION_ADJUSTABLE_SHARE_FIELDS = [
  "original_units",
  "remaining_units",
  "converted_units",
  "exercised_units",
  "cancelled_units",
  "expired_units",
  "remaining_potential_shares",
  "shares_issued",
  "shares_sold",
  "registered_resale_shares",
  "option_shares",
  "award_units",
  "share_reserve",
  "share_cap",
] as const;

export const DILUTION_ADJUSTABLE_PRICE_FIELDS = [
  "conversion_price",
  "exercise_price",
  "floor_price",
] as const;

export type DilutionAdjustableShareField =
  (typeof DILUTION_ADJUSTABLE_SHARE_FIELDS)[number];
export type DilutionAdjustablePriceField =
  (typeof DILUTION_ADJUSTABLE_PRICE_FIELDS)[number];
export type DilutionAdjustableField =
  | DilutionAdjustableShareField
  | DilutionAdjustablePriceField;

export type DilutionContractFieldAdjustment = {
  field: DilutionAdjustableField;
  operation: "multiply_by_split_ratio" | "divide_by_split_ratio";
  evidenceIdentity: CorporateActionEvidenceIdentity;
};

export type DilutionSplitClauseBinding = {
  instrumentKey: string;
  executionId: string;
  canonicalSecurityClassId: string;
  contractAccession: string;
  sourceRef: string;
  sourceDocumentUrl: string;
  fieldAdjustments: DilutionContractFieldAdjustment[];
};

export type DilutionStoredSplitClauseBinding = DilutionSplitClauseBinding & {
  version: typeof DILUTION_CORPORATE_ACTION_BINDING_VERSION;
  bindingId: string;
  issuerCik: string;
  contractRawItemId: string;
  supersedesBindingId: string | null;
};

export type DilutionLiveContractSnapshot = {
  issuerCik: string;
  instrumentKey: string;
  instrumentId: string;
  baseSnapshotId: string;
  canonicalSecurityClassId: string;
  asOfDate: string;
  status: "current" | "old" | "closed";
  values: Record<string, unknown>;
  supersedesProjectionId?: string | null;
};

export type DilutionAdjustmentReviewReason =
  | "EXECUTION_READ_FAILED"
  | "EXECUTION_MATERIALIZATION_UNAVAILABLE"
  | "EXECUTION_CONFLICT"
  | "EXECUTION_READER_INVALID"
  | "EXECUTION_TIMING_INDETERMINATE"
  | "EXECUTION_PROVENANCE_INVALID"
  | "SNAPSHOT_BASIS_AMBIGUOUS"
  | "CONTRACT_CLAUSE_MISSING"
  | "CONTRACT_CLAUSE_AMBIGUOUS"
  | "CONTRACT_CLAUSE_INVALID"
  | "CONTRACT_EVIDENCE_INVALID"
  | "FIELD_VALUE_UNAVAILABLE"
  | "NON_INTEGRAL_SHARE_RESULT"
  | "NON_TERMINATING_PRICE_RESULT";

type ProjectionBase = {
  version: typeof DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION;
  projectionId: string;
  issuerCik: string;
  instrumentKey: string;
  instrumentId: string;
  baseSnapshotId: string;
  canonicalSecurityClassId: string;
  asOfDate: string;
  effectiveDate: string | null;
  executionIds: string[];
  supersedesProjectionId: string | null;
  originalFields: Record<string, string>;
  adjustedFields: Record<string, string>;
  fieldEvidence: Array<{
    field: DilutionAdjustableField;
    executionId: string;
    contractAccession: string;
    sourceDocumentUrl: string;
    evidenceIdentity: CorporateActionEvidenceIdentity;
  }>;
};

export type DilutionAdjustmentApplied = ProjectionBase & {
  status: "APPLIED";
  reviewReason: null;
};

export type DilutionAdjustmentReview = ProjectionBase & {
  status: "REVIEW";
  reviewReason: DilutionAdjustmentReviewReason;
};

export type DilutionAdjustmentNotApplicable = {
  version: typeof DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION;
  status: "NOT_APPLICABLE";
  reason: "INSTRUMENT_NOT_CURRENT" | "NO_APPLICABLE_STOCK_SPLIT";
  issuerCik: string;
  instrumentKey: string;
  instrumentId: string;
  baseSnapshotId: string;
  adjustedFields: Record<string, never>;
};

export type DilutionCorporateActionProjection =
  | DilutionAdjustmentApplied
  | DilutionAdjustmentReview
  | DilutionAdjustmentNotApplicable;

export type DilutionAdjustmentAppendResult = {
  status: "saved" | "already_saved";
  projectionId: string;
  added: 0 | 1;
};

export type DilutionBindingAppendResult = {
  status: "saved" | "already_saved";
  bindingId: string;
  added: 0 | 1;
};

export function dilutionContractSourceRef(rawItemId: string, sourceDocumentUrl: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawItemId)
    || !sourceDocumentUrl) {
    throw new Error("Dilution contract source identity is invalid");
  }
  return `sec-raw:v1:${rawItemId.toLowerCase()}:${createHash("sha256")
    .update(sourceDocumentUrl)
    .digest("hex")}`;
}

export function createDilutionStoredSplitClauseBinding(
  issuerCik: string,
  value: unknown,
): DilutionStoredSplitClauseBinding {
  const input = asRecord(value);
  if (!input || !/^[0-9]{10}$/.test(issuerCik) || issuerCik === "0000000000") {
    throw new Error("Dilution Corporate Action clause binding is invalid");
  }
  const instrumentKey = textValue(input.instrument_key);
  const executionId = textValue(input.execution_id);
  const canonicalSecurityClassId = textValue(input.canonical_security_class_id);
  const contractAccession = textValue(input.contract_accession);
  const contractRawItemId = textValue(input.contract_raw_item_id);
  const sourceRef = textValue(input.source_ref);
  const sourceDocumentUrl = textValue(input.source_document_url);
  const supersedesBindingId = nullableTextValue(input.supersedes_binding_id);
  const rawRules = Array.isArray(input.field_adjustments) ? input.field_adjustments : [];
  const fieldAdjustments = rawRules.map((rawRule: unknown) => {
    const rule = asRecord(rawRule);
    return {
      field: textValue(rule?.field),
      operation: textValue(rule?.operation),
      evidenceIdentity: structuredClone(rule?.evidence_identity),
    };
  }) as DilutionContractFieldAdjustment[];
  const base = {
    version: DILUTION_CORPORATE_ACTION_BINDING_VERSION,
    issuerCik,
    instrumentKey,
    executionId,
    canonicalSecurityClassId,
    contractAccession,
    contractRawItemId,
    sourceRef,
    sourceDocumentUrl,
    fieldAdjustments,
    supersedesBindingId,
  };
  if (!validStoredBinding(base)) {
    throw new Error("Dilution Corporate Action clause binding is invalid");
  }
  const identity = [
    base.version,
    base.issuerCik,
    base.instrumentKey,
    base.executionId,
    base.canonicalSecurityClassId,
    base.contractAccession,
    base.contractRawItemId,
    base.sourceRef,
    base.sourceDocumentUrl,
    base.fieldAdjustments,
  ];
  return {
    ...base,
    bindingId: `dcab:v1:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
  };
}

export async function appendDilutionCorporateActionClauseBinding(
  binding: DilutionStoredSplitClauseBinding,
  dependencies: {
    rpc: (
      functionName: string,
      payload: Record<string, unknown>,
    ) => Promise<{ ok: boolean; data: unknown; error?: string }>;
  },
): Promise<DilutionBindingAppendResult> {
  const response = await dependencies.rpc(
    "append_dilution_corporate_action_clause_binding_v1",
    { p_binding: binding },
  );
  if (!response.ok || !record(response.data)) {
    throw new Error("Dilution Corporate Action clause binding could not be appended");
  }
  const alreadySaved = response.data.already_saved;
  const bindingId = response.data.binding_id;
  const added = response.data.added;
  if (typeof alreadySaved !== "boolean"
    || bindingId !== binding.bindingId
    || (added !== 0 && added !== 1)
    || (alreadySaved && added !== 0)
    || (!alreadySaved && added !== 1)) {
    throw new Error("Dilution Corporate Action clause binding append result is invalid");
  }
  return {
    status: alreadySaved ? "already_saved" : "saved",
    bindingId,
    added,
  };
}

export async function appendDilutionCorporateActionProjection(
  projection: DilutionAdjustmentApplied | DilutionAdjustmentReview,
  dependencies: {
    rpc: (
      functionName: string,
      payload: Record<string, unknown>,
    ) => Promise<{ ok: boolean; data: unknown; error?: string }>;
  },
): Promise<DilutionAdjustmentAppendResult> {
  const response = await dependencies.rpc(
    "append_dilution_corporate_action_adjustment_v1",
    { p_projection: projection },
  );
  if (!response.ok || !record(response.data)) {
    throw new Error("Dilution Corporate Action projection could not be appended");
  }
  const alreadySaved = response.data.already_saved;
  const projectionId = response.data.projection_id;
  const added = response.data.added;
  if (typeof alreadySaved !== "boolean"
    || projectionId !== projection.projectionId
    || (added !== 0 && added !== 1)
    || (alreadySaved && added !== 0)
    || (!alreadySaved && added !== 1)) {
    throw new Error("Dilution Corporate Action append result is invalid");
  }
  return {
    status: alreadySaved ? "already_saved" : "saved",
    projectionId,
    added,
  };
}

type ReadExecutions = (input: {
  actionKind: "forward_split" | "reverse_split";
  cik: string;
  canonicalSecurityClassId?: string;
  from: string;
  to: string;
  targetAt: string;
  knownAt?: string;
}) => Promise<StockSplitExecutionReadResult>;

export async function planDilutionCorporateActionAdjustments(
  input: {
    instruments: DilutionLiveContractSnapshot[];
    clauseBindings: DilutionSplitClauseBinding[];
    sourceDocuments: CorporateActionSourceDocument[];
    targetAt: string;
    knownAt?: string;
  },
  dependencies: { readExecutions?: ReadExecutions } = {},
): Promise<DilutionCorporateActionProjection[]> {
  const readExecutions = dependencies.readExecutions ?? readStockSplitExecutions;
  return Promise.all(input.instruments.map((instrument) => planInstrument(
    instrument,
    input.clauseBindings,
    input.sourceDocuments,
    input.targetAt,
    input.knownAt,
    readExecutions,
  )));
}

async function planInstrument(
  instrument: DilutionLiveContractSnapshot,
  bindings: DilutionSplitClauseBinding[],
  documents: CorporateActionSourceDocument[],
  targetAt: string,
  knownAt: string | undefined,
  readExecutions: ReadExecutions,
): Promise<DilutionCorporateActionProjection> {
  validateInstrument(instrument, targetAt);
  if (instrument.status !== "current") {
    return notApplicable(instrument, "INSTRUMENT_NOT_CURRENT");
  }
  const targetDate = targetAt.slice(0, 10);
  let reads: StockSplitExecutionReadResult[];
  try {
    reads = await Promise.all((["forward_split", "reverse_split"] as const).map((actionKind) =>
      readExecutions({
        actionKind,
        cik: instrument.issuerCik,
        canonicalSecurityClassId: instrument.canonicalSecurityClassId,
        from: instrument.asOfDate,
        to: targetDate,
        targetAt,
        ...(knownAt ? { knownAt } : {}),
      })));
  } catch {
    return review(instrument, "EXECUTION_READ_FAILED", [], [], {});
  }
  if (reads.some((item) => item.status === "materialization_unavailable")) {
    return review(instrument, "EXECUTION_MATERIALIZATION_UNAVAILABLE", [], [], {});
  }
  if (reads[0]?.basisChangeCoverage !== "forward_split_only"
    || reads[1]?.basisChangeCoverage !== "reverse_split_only") {
    return review(instrument, "EXECUTION_READER_INVALID", [], [], {});
  }
  if (reads.some((item) => !validRead(item, instrument, targetDate, targetAt))) {
    return review(instrument, "EXECUTION_READER_INVALID", [], [], {});
  }
  if (reads.some((item) => item.status === "available" && item.conflicts.length > 0)) {
    return review(instrument, "EXECUTION_CONFLICT", [], [], {});
  }

  const candidates: StockSplitExecution[] = [];
  for (const read of reads) {
    if (read.status !== "available") continue;
    for (const execution of read.executions) candidates.push(execution as StockSplitExecution);
  }
  candidates.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate)
    || left.executionId.localeCompare(right.executionId));
  const applicable: StockSplitExecution[] = [];
  for (const execution of candidates) {
    if (!validExecution(execution, instrument)) {
      return review(instrument, "EXECUTION_PROVENANCE_INVALID", [], [], {});
    }
    const activation = stockSplitExecutionActivationDecision({ execution, targetDate, targetAt });
    if (activation.status === "INDETERMINATE") {
      return review(instrument, "EXECUTION_TIMING_INDETERMINATE", [execution], [], {});
    }
    if (activation.status === "NOT_APPLIED") continue;
    if (execution.effectiveDate === instrument.asOfDate) {
      return review(instrument, "SNAPSHOT_BASIS_AMBIGUOUS", [execution], [], {});
    }
    applicable.push(execution);
  }
  if (!applicable.length) return notApplicable(instrument, "NO_APPLICABLE_STOCK_SPLIT");

  let adjusted = Object.fromEntries(
    [...DILUTION_ADJUSTABLE_SHARE_FIELDS, ...DILUTION_ADJUSTABLE_PRICE_FIELDS]
      .filter((field) => instrument.values[field] !== undefined)
      .map((field) => [field, decimalText(instrument.values[field])]),
  ) as Record<string, string | null>;
  const evidence: ProjectionBase["fieldEvidence"] = [];

  for (const execution of applicable) {
    const matches = bindings.filter((binding) =>
      binding.instrumentKey === instrument.instrumentKey
      && binding.executionId === execution.executionId);
    if (!matches.length) {
      return review(instrument, "CONTRACT_CLAUSE_MISSING", applicable, evidence, {});
    }
    if (matches.length !== 1) {
      return review(instrument, "CONTRACT_CLAUSE_AMBIGUOUS", applicable, evidence, {});
    }
    const binding = matches[0]!;
    if (!validBinding(binding, instrument, documents)) {
      return review(instrument, "CONTRACT_CLAUSE_INVALID", applicable, evidence, {});
    }
    if (!binding.fieldAdjustments.every((item) =>
      verifyCorporateActionEvidenceIdentity(item.evidenceIdentity, documents))) {
      return review(instrument, "CONTRACT_EVIDENCE_INVALID", applicable, evidence, {});
    }
    for (const fieldRule of binding.fieldAdjustments) {
      const current = adjusted[fieldRule.field];
      if (current === null || current === undefined) {
        return review(instrument, "FIELD_VALUE_UNAVAILABLE", applicable, evidence, {});
      }
      const next = adjustedDecimal(current, execution, fieldRule);
      if (next.reason) {
        return review(instrument, next.reason, applicable, evidence, {});
      }
      adjusted[fieldRule.field] = next.value!;
      evidence.push({
        field: fieldRule.field,
        executionId: execution.executionId,
        contractAccession: binding.contractAccession,
        sourceDocumentUrl: binding.sourceDocumentUrl,
        evidenceIdentity: structuredClone(fieldRule.evidenceIdentity),
      });
    }
  }
  const adjustedFields = Object.fromEntries(
    Object.entries(adjusted).filter(([, value]) => value !== null)
      .filter(([field, value]) => decimalText(instrument.values[field]) !== value),
  ) as Record<string, string>;
  const originalFields = Object.fromEntries(
    Object.keys(adjustedFields).map((field) => [field, decimalText(instrument.values[field])!]),
  );
  return applied(instrument, applicable, evidence, originalFields, adjustedFields);
}

function adjustedDecimal(
  value: string,
  execution: StockSplitExecution,
  rule: DilutionContractFieldAdjustment,
): { value: string | null; reason: DilutionAdjustmentReviewReason | null } {
  const original = parseDecimal(value, true);
  const oldUnits = parseDecimal(execution.exactRatio.oldShareUnits, false);
  const newUnits = parseDecimal(execution.exactRatio.newShareUnits, false);
  if (!original || !oldUnits || !newUnits) {
    return { value: null, reason: "EXECUTION_PROVENANCE_INVALID" };
  }
  const shareField = (DILUTION_ADJUSTABLE_SHARE_FIELDS as readonly string[]).includes(rule.field);
  const expectedOperation = shareField
    ? "multiply_by_split_ratio"
    : "divide_by_split_ratio";
  if (rule.operation !== expectedOperation) {
    return { value: null, reason: "CONTRACT_CLAUSE_INVALID" };
  }
  const numeratorMultiplier = shareField ? newUnits : oldUnits;
  const denominatorMultiplier = shareField ? oldUnits : newUnits;
  const exact = reduce({
    numerator: original.numerator * numeratorMultiplier.numerator * denominatorMultiplier.denominator,
    denominator: original.denominator * numeratorMultiplier.denominator * denominatorMultiplier.numerator,
  });
  if (shareField && exact.denominator !== BigInt(1)) {
    return { value: null, reason: "NON_INTEGRAL_SHARE_RESULT" };
  }
  const formatted = exactDecimal(exact);
  return formatted === null
    ? { value: null, reason: "NON_TERMINATING_PRICE_RESULT" }
    : { value: formatted, reason: null };
}

function validRead(
  read: StockSplitExecutionReadResult,
  instrument: DilutionLiveContractSnapshot,
  targetDate: string,
  targetAt: string,
) {
  return read.status === "available"
    && read.issuerCik === instrument.issuerCik
    && read.canonicalSecurityClassId === instrument.canonicalSecurityClassId
    && read.from === instrument.asOfDate
    && read.to === targetDate
    && read.targetAt === targetAt
    && Array.isArray(read.executions)
    && Array.isArray(read.inactiveExecutions)
    && Array.isArray(read.conflicts);
}

function validExecution(execution: StockSplitExecution, instrument: DilutionLiveContractSnapshot) {
  const actionKind = execution.version === "forward_split_execution_v1"
    ? "forward_split"
    : execution.version === "reverse_split_execution_v1"
      ? "reverse_split"
      : null;
  if (!actionKind) return false;
  let expectedId: string;
  try {
    expectedId = stockSplitExecutionId({
      actionKind,
      issuerCik: execution.issuerCik,
      canonicalSecurityClassId: execution.canonicalSecurityClassId,
      effectiveDate: execution.effectiveDate,
      oldShareUnits: execution.exactRatio.oldShareUnits,
      newShareUnits: execution.exactRatio.newShareUnits,
    });
  } catch {
    return false;
  }
  return expectedId === execution.executionId
    && execution.issuerCik === instrument.issuerCik
    && execution.canonicalSecurityClassId === instrument.canonicalSecurityClassId
    && execution.observations.length > 0
    && execution.observations.every((observation) =>
      observation.source.source_family === "sec"
      && /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(observation.accessionNumber));
}

function validBinding(
  binding: DilutionSplitClauseBinding,
  instrument: DilutionLiveContractSnapshot,
  documents: CorporateActionSourceDocument[],
) {
  if (binding.canonicalSecurityClassId !== instrument.canonicalSecurityClassId
    || !/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(binding.contractAccession)
    || !binding.fieldAdjustments.length
    || new Set(binding.fieldAdjustments.map((item) => item.field)).size
      !== binding.fieldAdjustments.length
    || binding.fieldAdjustments.some((item) => {
      const isShare = (DILUTION_ADJUSTABLE_SHARE_FIELDS as readonly string[]).includes(item.field);
      return item.operation !== (isShare ? "multiply_by_split_ratio" : "divide_by_split_ratio");
    })) return false;
  let url: URL;
  try {
    url = new URL(binding.sourceDocumentUrl);
  } catch {
    return false;
  }
  const accessionPath = binding.contractAccession.replaceAll("-", "");
  const issuerPath = BigInt(instrument.issuerCik).toString();
  return url.protocol === "https:"
    && url.hostname === "www.sec.gov"
    && url.pathname.startsWith(
      `/Archives/edgar/data/${issuerPath}/${accessionPath}/`,
    )
    && documents.some((document) => document.source_ref === binding.sourceRef)
    && binding.fieldAdjustments.every((item) => item.evidenceIdentity.source_ref === binding.sourceRef);
}

function validStoredBinding(
  binding: Omit<DilutionStoredSplitClauseBinding, "bindingId">,
) {
  if (!binding.instrumentKey
    || !/^(?:fse|rse):v1:[0-9a-f]{64}$/.test(binding.executionId)
    || !/^sc:v1:[0-9]{10}:common_stock:/.test(binding.canonicalSecurityClassId)
    || !/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(binding.contractAccession)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(binding.contractRawItemId)
    || (binding.supersedesBindingId !== null
      && !/^dcab:v1:[0-9a-f]{64}$/.test(binding.supersedesBindingId))
    || !binding.fieldAdjustments.length
    || new Set(binding.fieldAdjustments.map((item) => item.field)).size
      !== binding.fieldAdjustments.length) return false;
  let expectedSourceRef: string;
  let url: URL;
  try {
    expectedSourceRef = dilutionContractSourceRef(
      binding.contractRawItemId,
      binding.sourceDocumentUrl,
    );
    url = new URL(binding.sourceDocumentUrl);
  } catch {
    return false;
  }
  const issuerPath = BigInt(binding.issuerCik).toString();
  const accessionPath = binding.contractAccession.replaceAll("-", "");
  return binding.sourceRef === expectedSourceRef
    && url.protocol === "https:"
    && url.hostname === "www.sec.gov"
    && url.pathname.startsWith(`/Archives/edgar/data/${issuerPath}/${accessionPath}/`)
    && binding.fieldAdjustments.every((item) => {
      const isShare = (DILUTION_ADJUSTABLE_SHARE_FIELDS as readonly string[]).includes(item.field);
      const isPrice = (DILUTION_ADJUSTABLE_PRICE_FIELDS as readonly string[]).includes(item.field);
      return (isShare || isPrice)
        && item.operation === (isShare ? "multiply_by_split_ratio" : "divide_by_split_ratio")
        && validateCorporateActionEvidenceIdentity(item.evidenceIdentity).length === 0
        && item.evidenceIdentity.source_ref === binding.sourceRef;
    });
}

function applied(
  instrument: DilutionLiveContractSnapshot,
  executions: StockSplitExecution[],
  fieldEvidence: ProjectionBase["fieldEvidence"],
  originalFields: Record<string, string>,
  adjustedFields: Record<string, string>,
): DilutionAdjustmentApplied {
  return projection(instrument, executions, fieldEvidence, originalFields, adjustedFields, "APPLIED", null);
}

function review(
  instrument: DilutionLiveContractSnapshot,
  reason: DilutionAdjustmentReviewReason,
  executions: StockSplitExecution[],
  fieldEvidence: ProjectionBase["fieldEvidence"],
  adjustedFields: Record<string, string>,
): DilutionAdjustmentReview {
  return projection(instrument, executions, fieldEvidence, {}, adjustedFields, "REVIEW", reason);
}

function projection<TStatus extends "APPLIED" | "REVIEW">(
  instrument: DilutionLiveContractSnapshot,
  executions: StockSplitExecution[],
  fieldEvidence: ProjectionBase["fieldEvidence"],
  originalFields: Record<string, string>,
  adjustedFields: Record<string, string>,
  status: TStatus,
  reviewReason: TStatus extends "APPLIED" ? null : DilutionAdjustmentReviewReason,
) {
  const effectiveDate = executions.map((item) => item.effectiveDate).sort().at(-1) ?? null;
  const executionIds = executions.map((item) => item.executionId).sort();
  const identity = [
    DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION,
    instrument.issuerCik,
    instrument.instrumentKey,
    instrument.baseSnapshotId,
    status,
    reviewReason,
    executionIds,
    originalFields,
    adjustedFields,
    fieldEvidence,
  ];
  const projectionId = `dca:v1:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
  return {
    version: DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION,
    projectionId,
    issuerCik: instrument.issuerCik,
    instrumentKey: instrument.instrumentKey,
    instrumentId: instrument.instrumentId,
    baseSnapshotId: instrument.baseSnapshotId,
    canonicalSecurityClassId: instrument.canonicalSecurityClassId,
    asOfDate: instrument.asOfDate,
    effectiveDate,
    executionIds,
    supersedesProjectionId: instrument.supersedesProjectionId === projectionId
      ? null
      : instrument.supersedesProjectionId ?? null,
    originalFields: structuredClone(originalFields),
    adjustedFields: structuredClone(adjustedFields),
    fieldEvidence: structuredClone(fieldEvidence),
    status,
    reviewReason,
  };
}

function notApplicable(
  instrument: DilutionLiveContractSnapshot,
  reason: DilutionAdjustmentNotApplicable["reason"],
): DilutionAdjustmentNotApplicable {
  return {
    version: DILUTION_CORPORATE_ACTION_ADJUSTMENT_VERSION,
    status: "NOT_APPLICABLE",
    reason,
    issuerCik: instrument.issuerCik,
    instrumentKey: instrument.instrumentKey,
    instrumentId: instrument.instrumentId,
    baseSnapshotId: instrument.baseSnapshotId,
    adjustedFields: {},
  };
}

function validateInstrument(instrument: DilutionLiveContractSnapshot, targetAt: string) {
  if (!/^[0-9]{10}$/.test(instrument.issuerCik) || instrument.issuerCik === "0000000000"
    || !instrument.instrumentKey.trim() || !/^[1-9][0-9]*$/.test(instrument.instrumentId)
    || !/^[1-9][0-9]*$/.test(instrument.baseSnapshotId)
    || !/^sc:v1:[0-9]{10}:common_stock:/.test(instrument.canonicalSecurityClassId)
    || !validDate(instrument.asOfDate) || !validTimestamp(targetAt)
    || instrument.asOfDate > targetAt.slice(0, 10)
    || (instrument.supersedesProjectionId
      && !/^dca:v1:[0-9a-f]{64}$/.test(instrument.supersedesProjectionId))) {
    throw new Error("Dilution live contract snapshot identity is invalid");
  }
}

function decimalText(value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
    ? value
    : null;
}

function parseDecimal(value: string, allowZero: boolean) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator < BigInt(0) || (!allowZero && numerator === BigInt(0))) return null;
  return reduce({ numerator, denominator: BigInt(10) ** BigInt(fraction.length) });
}

function exactDecimal(value: { numerator: bigint; denominator: bigint }) {
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % BigInt(2) === BigInt(0)) {
    denominator /= BigInt(2);
    twos += 1;
  }
  while (denominator % BigInt(5) === BigInt(0)) {
    denominator /= BigInt(5);
    fives += 1;
  }
  if (denominator !== BigInt(1)) return null;
  const scale = Math.max(twos, fives);
  const scaled = value.numerator * (BigInt(10) ** BigInt(scale)) / value.denominator;
  if (scale === 0) return scaled.toString();
  const digits = scaled.toString().padStart(scale + 1, "0");
  const result = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return result;
}

function reduce(value: { numerator: bigint; denominator: bigint }) {
  if (value.denominator <= BigInt(0)) throw new Error("Exact decimal denominator must be positive");
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

function greatestCommonDivisor(leftValue: bigint, rightValue: bigint) {
  let left = leftValue < BigInt(0) ? -leftValue : leftValue;
  let right = rightValue < BigInt(0) ? -rightValue : rightValue;
  while (right !== BigInt(0)) [left, right] = [right, left % right];
  return left || BigInt(1);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableTextValue(value: unknown) {
  const text = textValue(value);
  return text || null;
}
