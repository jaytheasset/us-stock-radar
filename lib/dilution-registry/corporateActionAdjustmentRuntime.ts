import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
} from "../monitor/corporateActionPersistence.ts";
import {
  appendDilutionCorporateActionProjection,
  planDilutionCorporateActionAdjustments,
  type DilutionAdjustmentApplied,
  type DilutionAdjustmentReview,
  type DilutionCorporateActionProjection,
  type DilutionLiveContractSnapshot,
  type DilutionSplitClauseBinding,
} from "./corporateActionAdjustment.ts";

type Rpc = (
  functionName: string,
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; status?: number; data: unknown; error?: string }>;

type AdjustmentContext = {
  issuerCik: string;
  instruments: DilutionLiveContractSnapshot[];
  clauseBindings: DilutionSplitClauseBinding[];
  sourceDocuments: Array<{ source_ref: string; label: string | null; text: string }>;
};

export type DilutionCorporateActionRuntimeResult = {
  status: "completed" | "not_applicable" | "not_ready";
  eventId: string;
  issuerCik?: string;
  projectionCount: number;
  saved: number;
  alreadySaved: number;
  reviews: number;
  notApplicable: number;
  projections: DilutionCorporateActionProjection[];
  reason?: string;
};

export async function runDilutionCorporateActionAdjustmentForEvent(
  input: { eventId: string },
  dependencies: {
    readCurrent?: (eventId: string) => Promise<CurrentCorporateActionReadResult>;
    rpc?: Rpc;
  } = {},
): Promise<DilutionCorporateActionRuntimeResult> {
  const rpc = dependencies.rpc ?? defaultRpc;
  const current = await (dependencies.readCurrent ?? readCurrentCorporateActionFacts)(input.eventId);
  if (current.status === "not_ready") {
    return emptyResult(input.eventId, "not_ready", current.reason);
  }
  if (current.status === "not_applicable") {
    return emptyResult(input.eventId, "not_applicable", "corporate_action_not_applicable");
  }
  const scope = exactSplitScope(current);
  if (!scope) {
    return emptyResult(input.eventId, "not_ready", "stock_split_scope_unavailable");
  }
  return runDilutionCorporateActionAdjustmentForScope({
    eventId: input.eventId,
    issuerCik: scope.issuerCik,
    canonicalSecurityClassId: scope.canonicalSecurityClassId,
    targetAt: current.persistedAt,
  }, rpc);
}

export async function runDilutionCorporateActionAdjustmentForIssuer(
  input: { issuerCik: string; targetAt: string },
  dependencies: { rpc?: Rpc } = {},
) {
  const rpc = dependencies.rpc ?? defaultRpc;
  const context = await readAdjustmentContext(input.issuerCik, rpc);
  const classes = [...new Set(context.clauseBindings.map((binding) =>
    binding.canonicalSecurityClassId))];
  if (classes.length !== 1) {
    return {
      ...emptyResult("registry-apply", "not_ready", classes.length
        ? "binding_security_class_ambiguous"
        : "no_clause_bindings"),
      issuerCik: input.issuerCik,
    };
  }
  return runDilutionCorporateActionAdjustmentForScope({
    eventId: "registry-apply",
    issuerCik: input.issuerCik,
    canonicalSecurityClassId: classes[0]!,
    targetAt: input.targetAt,
  }, rpc, context);
}

async function runDilutionCorporateActionAdjustmentForScope(
  scope: {
    eventId: string;
    issuerCik: string;
    canonicalSecurityClassId: string;
    targetAt: string;
  },
  rpc: Rpc,
  suppliedContext?: AdjustmentContext,
): Promise<DilutionCorporateActionRuntimeResult> {
  const context = suppliedContext ?? await readAdjustmentContext(scope.issuerCik, rpc);
  if (!context.instruments.length) {
    return {
      ...emptyResult(scope.eventId, "not_applicable", "no_dilution_instruments"),
      issuerCik: scope.issuerCik,
    };
  }
  const projections = await planDilutionCorporateActionAdjustments({
    instruments: context.instruments.map((instrument) => ({
      ...instrument,
      canonicalSecurityClassId: scope.canonicalSecurityClassId,
    })),
    clauseBindings: context.clauseBindings.filter((binding) =>
      binding.canonicalSecurityClassId === scope.canonicalSecurityClassId),
    sourceDocuments: context.sourceDocuments,
    targetAt: scope.targetAt,
    knownAt: scope.targetAt,
  });
  let saved = 0;
  let alreadySaved = 0;
  for (const projection of projections) {
    if (projection.status !== "APPLIED" && projection.status !== "REVIEW") continue;
    const appended = await appendDilutionCorporateActionProjection(
      projection as DilutionAdjustmentApplied | DilutionAdjustmentReview,
      { rpc },
    );
    if (appended.status === "saved") saved += 1;
    else alreadySaved += 1;
  }
  return {
    status: "completed",
    eventId: scope.eventId,
    issuerCik: scope.issuerCik,
    projectionCount: projections.filter((item) => item.status !== "NOT_APPLICABLE").length,
    saved,
    alreadySaved,
    reviews: projections.filter((item) => item.status === "REVIEW").length,
    notApplicable: projections.filter((item) => item.status === "NOT_APPLICABLE").length,
    projections,
  };
}

async function readAdjustmentContext(issuerCik: string, rpc: Rpc): Promise<AdjustmentContext> {
  const response = await rpc("read_dilution_corporate_action_context_v1", {
    p_issuer_cik: issuerCik,
  });
  if (!response.ok) throw new Error("Dilution Corporate Action context read failed");
  const root = record(response.data);
  if (!root || root.status !== "available" || root.issuer_cik !== issuerCik
    || !Array.isArray(root.instruments) || !Array.isArray(root.clause_bindings)
    || !Array.isArray(root.source_documents)) {
    throw new Error("Dilution Corporate Action context response is invalid");
  }
  const instruments = root.instruments.map(readInstrument);
  const clauseBindings = root.clause_bindings.map(readClauseBinding);
  const sourceDocuments = root.source_documents.map(readSourceDocument);
  if (instruments.some((item) => item === null)
    || clauseBindings.some((item) => item === null)
    || sourceDocuments.some((item) => item === null)) {
    throw new Error("Dilution Corporate Action context payload is invalid");
  }
  return {
    issuerCik,
    instruments: instruments as DilutionLiveContractSnapshot[],
    clauseBindings: clauseBindings as DilutionSplitClauseBinding[],
    sourceDocuments: sourceDocuments as AdjustmentContext["sourceDocuments"],
  };
}

function exactSplitScope(current: Extract<CurrentCorporateActionReadResult, { status: "available" }>) {
  const issuer = current.facts.applicability?.issuer;
  const security = current.facts.applicability?.affected_security;
  if (issuer?.availability !== "available" || security?.availability !== "available"
    || (current.facts.event_kind !== "forward_split" && current.facts.event_kind !== "reverse_split")) {
    return null;
  }
  return {
    issuerCik: issuer.issuer_cik,
    canonicalSecurityClassId: security.canonical_security_class_id,
  };
}

function readInstrument(value: unknown): DilutionLiveContractSnapshot | null {
  const row = record(value);
  const values = record(row?.values);
  if (!row || !values || (row.status !== "current" && row.status !== "old" && row.status !== "closed")) {
    return null;
  }
  return {
    issuerCik: text(row.issuerCik),
    instrumentKey: text(row.instrumentKey),
    instrumentId: text(row.instrumentId),
    baseSnapshotId: text(row.baseSnapshotId),
    canonicalSecurityClassId: text(row.canonicalSecurityClassId),
    asOfDate: text(row.asOfDate),
    status: row.status,
    values: structuredClone(values),
    supersedesProjectionId: nullableText(row.supersedesProjectionId),
  };
}

function readClauseBinding(value: unknown): DilutionSplitClauseBinding | null {
  const row = record(value);
  if (!row || !Array.isArray(row.fieldAdjustments)) return null;
  return {
    instrumentKey: text(row.instrumentKey),
    executionId: text(row.executionId),
    canonicalSecurityClassId: text(row.canonicalSecurityClassId),
    contractAccession: text(row.contractAccession),
    sourceRef: text(row.sourceRef),
    sourceDocumentUrl: text(row.sourceDocumentUrl),
    fieldAdjustments: structuredClone(row.fieldAdjustments) as DilutionSplitClauseBinding["fieldAdjustments"],
  };
}

function readSourceDocument(value: unknown) {
  const row = record(value);
  if (!row || typeof row.text !== "string" || !row.text) return null;
  return {
    source_ref: text(row.source_ref),
    label: nullableText(row.label),
    text: row.text,
  };
}

function emptyResult(
  eventId: string,
  status: "not_applicable" | "not_ready",
  reason: string,
): DilutionCorporateActionRuntimeResult {
  return {
    status,
    eventId,
    projectionCount: 0,
    saved: 0,
    alreadySaved: 0,
    reviews: 0,
    notApplicable: 0,
    projections: [],
    reason,
  };
}

async function defaultRpc(functionName: string, payload: Record<string, unknown>) {
  const repository = await import("../supabase.ts");
  return repository.supabaseRpc(functionName, payload);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}
