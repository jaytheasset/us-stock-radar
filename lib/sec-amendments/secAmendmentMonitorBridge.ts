import { createHash } from "node:crypto";
import { readSecLineageFilingDate, secLineageParentDateFilter } from "./secFilingDate.ts";
import { readMonitorRoutingResultFromPrimaryOutput } from "../monitor/monitorRouting.ts";
import { readListingRiskAnalyzerResult } from "../monitor/listingRiskAnalyzer.ts";
import { readCorporateActionAnalyzerResult } from "../monitor/corporateActionCanonicalFacts.ts";
import type { CurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";
import type { CurrentCorporateActionReadResult } from "../monitor/corporateActionPersistence.ts";
import type {
  GenericMonitorAnalyzerKey,
  GenericMonitorChildIdentity,
  GenericMonitorPrimaryExecutionContext,
} from "../monitor/genericMonitorChildExecution.ts";
import {
  persistSecAmendmentObservation,
  persistSecOriginalFacts,
  readSecFilingCurrentState,
  type SecAmendmentPersistenceDependencies,
} from "./secAmendmentPersistence.ts";
import {
  resolveSecAmendmentLineage,
  readSecAmendmentExplicitTarget,
  type SecAffectedFactEvidence,
  type SecAmendmentLineageResolution,
  type SecFilingIdentity,
  type SecSemanticFactVersion,
} from "./secAmendmentLineage.ts";

type Row = Record<string, unknown>;
type Linked = Extract<SecAmendmentLineageResolution, { status: "linked" }>;
type RootFact = {
  result: Record<string, unknown>;
  eventId: string;
  rawItemId: string;
  parentPrimaryAiRunId: string;
  sourceExecutionId: string;
  analyzerContractVersion: string;
  persistedAt: string;
};
type RootFactRead =
  | { status: "available"; fact: RootFact }
  | { status: "absent" }
  | { status: "unavailable"; reason: string };

export type SecAmendmentMonitorPreparation =
  | { status: "not_amendment"; suppressPrimaryAlert: false }
  | {
      status: "blocked";
      suppressPrimaryAlert: true;
      reason: string;
      observation: SecAmendmentLineageResolution | null;
      providerCalls: 0;
    }
  | {
      status: "authorized";
      suppressPrimaryAlert: true;
      alertEventId: string;
      authorizedAnalyzerKeys: GenericMonitorAnalyzerKey[];
      observation: Linked;
      root: SecFilingIdentity;
      primaryAnalysis: Record<string, unknown>;
      executionContext: NonNullable<GenericMonitorPrimaryExecutionContext["secAmendmentLineage"]>;
      providerCalls: 0;
    };

export type SecAmendmentMonitorBridgeDependencies = {
  loadRawItem(rawItemId: string): Promise<Row | null>;
  loadEventRawItemId(eventId: string): Promise<string | null>;
  findExactParentCandidates(
    amendment: SecFilingIdentity,
    target: { accessionNumber: string | null; formType: string | null; filedDate: string | null },
  ): Promise<Array<{ rawItem: Row; eventId: string }>>;
  readRootFact(eventId: string, analyzerKey: GenericMonitorAnalyzerKey): Promise<RootFactRead>;
  persistence?: SecAmendmentPersistenceDependencies;
};

export type SecAmendmentMonitorCurrentState =
  | { status: "not_applicable" }
  | { status: "blocked"; reason: string }
  | {
      status: "available";
      listing?: CurrentListingRiskReadResult;
      corporateAction?: CurrentCorporateActionReadResult;
    };

export async function verifySecAmendmentExecutionAuthorization(
  identity: GenericMonitorChildIdentity,
  dependencies: SecAmendmentMonitorBridgeDependencies = defaultDependencies(),
) {
  const context = identity.secAmendmentLineage;
  if (!context) return { authorized: true as const };
  const [amendmentEventRawId, rootEventRawId] = await Promise.all([
    dependencies.loadEventRawItemId(identity.eventId),
    dependencies.loadEventRawItemId(identity.alertEventId),
  ]);
  if (amendmentEventRawId !== identity.rawItemId || rootEventRawId !== context.root.rawItemId) {
    return { authorized: false as const, reason: "sec_amendment_event_root_mismatch" };
  }
  const response = dependencies.persistence
    ? await dependencies.persistence.rpc("read_sec_filing_amendment_ledger", { p_root_raw_item_id: context.root.rawItemId })
    : await (await import("../supabase.ts")).supabaseRpc("read_sec_filing_amendment_ledger", { p_root_raw_item_id: context.root.rawItemId });
  const payload = response.ok ? record(response.data) : null;
  const root = record(payload?.root);
  const observations = Array.isArray(payload?.observations) ? payload.observations.map(record).filter(Boolean) as Row[] : [];
  const persisted = observations.find((item) => text(item.observationKey) === context.observation.observationKey);
  const semanticFactKey = factKeyForAnalyzer(identity.monitorAnalyzerKey);
  if (
    payload?.status !== "available"
    || !root
    || !persisted
    || persisted.status !== "linked"
    || text(persisted.operation) !== context.operation
    || text(record(persisted.amendment)?.rawItemId) !== identity.rawItemId
    || text(record(persisted.amendment)?.accessionNumber) !== identity.sourceIdentity
    || text(record(persisted.prior)?.rawItemId) !== context.root.rawItemId
    || text(record(persisted.prior)?.accessionNumber) !== context.root.accessionNumber
    || text(root.rawItemId) !== context.root.rawItemId
    || text(root.accessionNumber) !== context.root.accessionNumber
    || text(root.sourceCode) !== "sec_edgar"
    || text(root.issuerCik).replace(/^0+/, "") !== context.root.issuerCik.replace(/^0+/, "")
    || !stringArray(persisted.affectedFactKeys).includes(semanticFactKey)
    || !Array.isArray(persisted.factScopeEvidence)
    || !persisted.factScopeEvidence.some((item) => text(record(item)?.semanticFactKey) === semanticFactKey)
  ) {
    return { authorized: false as const, reason: "sec_amendment_persisted_lineage_mismatch" };
  }
  const rootFact = await dependencies.readRootFact(identity.alertEventId, identity.monitorAnalyzerKey);
  if ((context.operation === "REPLACE" && rootFact.status !== "available")
    || (context.operation === "SUPPLEMENT" && rootFact.status !== "absent")) {
    return { authorized: false as const, reason: "sec_amendment_root_fact_authority_mismatch" };
  }
  return { authorized: true as const };
}

export async function readSecAmendmentMonitorCurrentState(
  rootEventId: string,
  dependencies: SecAmendmentMonitorBridgeDependencies = defaultDependencies(),
): Promise<SecAmendmentMonitorCurrentState> {
  const rootRawItemId = await dependencies.loadEventRawItemId(rootEventId);
  if (!rootRawItemId) return { status: "blocked", reason: "root_event_identity_unavailable" };
  const raw = await dependencies.loadRawItem(rootRawItemId);
  if (!raw) return { status: "blocked", reason: "root_source_identity_unavailable" };
  const sourceCode = text(raw.source_code);
  const rawPayload = record(raw.raw_payload);
  const rawForm = text(rawPayload?.form_type).toUpperCase().replace(/\s+/g, "");
  if (sourceCode !== "sec_edgar") {
    const secShapedSource = /^(?:8-K|6-K)(?:\/A)?$/.test(rawForm)
      || [text(raw.source_url), text(rawPayload?.primary_document_url)].some(isOfficialSecUrl);
    return sourceCode && !secShapedSource
      ? { status: "not_applicable" }
      : { status: "blocked", reason: "root_source_identity_invalid" };
  }
  if (sourceCode === "sec_edgar" && rawForm && !/^(?:8-K|6-K)(?:\/A)?$/.test(rawForm)) {
    return { status: "not_applicable" };
  }
  const root = identityFromRaw(raw);
  if (!root) return { status: "blocked", reason: "root_source_identity_invalid" };
  if (root.formType.endsWith("/A")) return { status: "blocked", reason: "root_lineage_identity_invalid" };

  let current;
  try {
    current = await readSecFilingCurrentState(root.rawItemId, dependencies.persistence);
  } catch {
    return { status: "blocked", reason: "lineage_ledger_unavailable" };
  }
  if (current.status !== "available") return { status: "blocked", reason: current.reason };
  if (!current.appliedOperations.length && !current.reviewObservationKeys.length && !current.facts.length) {
    return { status: "not_applicable" };
  }
  if (current.cancelled) return { status: "blocked", reason: "lineage_cancelled" };

  let listing: CurrentListingRiskReadResult | undefined;
  let corporateAction: CurrentCorporateActionReadResult | undefined;
  for (const fact of current.facts) {
    const envelope = record(fact.factPayload);
    const result = record(envelope?.result);
    const rawItemId = text(envelope?.rawItemId);
    const parentPrimaryAiRunId = text(envelope?.parentPrimaryAiRunId);
    const sourceExecutionId = text(envelope?.sourceExecutionId);
    const analyzerContractVersion = text(envelope?.analyzerContractVersion);
    const persistedAt = text(envelope?.persistedAt);
    if (!result || !rawItemId || !parentPrimaryAiRunId || !sourceExecutionId || !analyzerContractVersion || !persistedAt) {
      return { status: "blocked", reason: "lineage_fact_envelope_invalid" };
    }
    if (fact.semanticFactKey === "monitor.listing_risk") {
      const parsed = readListingRiskAnalyzerResult(result);
      if (!parsed || parsed.status !== "applicable") return { status: "blocked", reason: "lineage_listing_fact_invalid" };
      listing = {
        status: "available",
        eventId: rootEventId,
        rawItemId,
        parentPrimaryAiRunId,
        sourceExecutionId,
        monitorAnalyzerKey: "listing_risk",
        analyzerContractVersion,
        persistedAt,
        factSchemaVersion: parsed.facts.version,
        facts: parsed.facts,
      };
    }
    if (fact.semanticFactKey === "monitor.corporate_action") {
      const parsed = readCorporateActionAnalyzerResult(result);
      if (!parsed?.applicable) return { status: "blocked", reason: "lineage_corporate_action_fact_invalid" };
      corporateAction = {
        status: "available",
        eventId: rootEventId,
        rawItemId,
        parentPrimaryAiRunId,
        sourceExecutionId,
        monitorAnalyzerKey: "corporate_action",
        analyzerContractVersion,
        persistedAt,
        factSchemaVersion: parsed.facts.version,
        facts: parsed.facts,
      };
    }
  }
  return { status: "available", ...(listing ? { listing } : {}), ...(corporateAction ? { corporateAction } : {}) };
}

export async function prepareSecAmendmentMonitorFanout(input: {
  rawItem: Row;
  filingInput: unknown;
  primaryAnalysis: Record<string, unknown>;
  dependencies?: SecAmendmentMonitorBridgeDependencies;
}): Promise<SecAmendmentMonitorPreparation> {
  const rawForm = text(record(input.rawItem.raw_payload)?.form_type).toUpperCase().replace(/\s+/g, "");
  if (!/^(?:8-K|6-K)\/A$/.test(rawForm)) {
    return { status: "not_amendment", suppressPrimaryAlert: false };
  }
  const amendment = identityFromRaw(input.rawItem);
  if (!amendment) {
    return { status: "blocked", suppressPrimaryAlert: true, reason: "amendment_identity_invalid", observation: null, providerCalls: 0 };
  }
  const dependencies = input.dependencies || defaultDependencies();
  const excerpt = amendmentExcerpt(input.rawItem, input.filingInput);
  const target = readSecAmendmentExplicitTarget(excerpt, amendment.formType.replace(/\/A$/, ""));
  const exactCandidates = !target.conflict && (target.accessionNumber || (target.formType && target.filedDate))
    ? await dependencies.findExactParentCandidates(amendment, target)
    : [];
  const exact = exactCandidates.length === 1 ? exactCandidates[0] : null;
  const parentEventId = exact?.eventId || "";
  const eventRawItemId = parentEventId ? await dependencies.loadEventRawItemId(parentEventId) : null;
  const parentRawItemId = text(exact?.rawItem.id);
  const exactParent = exact && parentRawItemId && eventRawItemId === parentRawItemId
    ? exact.rawItem
    : null;
  const root = exactParent ? identityFromRaw(exactParent) : null;
  const affectedFacts = deriveAffectedFacts(
    amendment,
    excerpt,
    input.primaryAnalysis,
  );
  let observation = resolveSecAmendmentLineage({
    amendment,
    candidates: root ? [root] : [],
    evidence: lineageEvidence(amendment, excerpt),
    affectedFacts,
  });
  if (observation.status === "unavailable_review" && root) {
    observation = { ...observation, reviewTarget: root };
  }
  if (observation.status === "linked" && observation.affectedFactKeys.length > 1) {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: "multi_domain_amendment_not_supported_v1",
      observation,
      providerCalls: 0,
    };
  }
  if (observation.status === "linked" && observation.operation === "SUPPLEMENT") {
    const primaryRouting = readMonitorRoutingResultFromPrimaryOutput(input.primaryAnalysis);
    const hasEveryPrimaryRoute = observation.affectedFactKeys
      .map(analyzerKeyFromFactKey)
      .every((analyzerKey) => analyzerKey && primaryRouting?.monitor_routes
        .some((route) => route.monitor_analyzer_key === analyzerKey));
    if (!hasEveryPrimaryRoute) {
      return {
        status: "blocked",
        suppressPrimaryAlert: true,
        reason: "supplement_requires_explicit_primary_route_v1",
        observation,
        providerCalls: 0,
      };
    }
  }
  const persistence = await persistSecAmendmentObservation({
    observation,
    dependencies: dependencies.persistence,
  });
  if (!["saved", "idempotent"].includes(persistence.status)) {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: `lineage_persistence_${persistence.status}`,
      observation,
      providerCalls: 0,
    };
  }
  if (observation.status !== "linked") {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: observation.reason,
      observation,
      providerCalls: 0,
    };
  }
  if (observation.operation === "NOOP" || observation.operation === "CANCEL") {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: `operation_${observation.operation.toLowerCase()}`,
      observation,
      providerCalls: 0,
    };
  }
  if (!root || !parentEventId || !["REPLACE", "SUPPLEMENT"].includes(observation.operation)) {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: "monitor_supplement_scope_not_supported_v1",
      observation,
      providerCalls: 0,
    };
  }

  const authorizedAnalyzerKeys = observation.affectedFactKeys
    .map(analyzerKeyFromFactKey)
    .filter((value): value is GenericMonitorAnalyzerKey => Boolean(value));
  if (!authorizedAnalyzerKeys.length) {
    return {
      status: "blocked",
      suppressPrimaryAlert: true,
      reason: "monitor_fact_scope_not_source_established",
      observation,
      providerCalls: 0,
    };
  }
  for (const analyzerKey of authorizedAnalyzerKeys) {
    const rootFactRead = await dependencies.readRootFact(parentEventId, analyzerKey);
    if (observation.operation === "SUPPLEMENT") {
      if (rootFactRead.status === "available") {
        return {
          status: "blocked",
          suppressPrimaryAlert: true,
          reason: `supplement_overwrites_existing_${analyzerKey}_fact`,
          observation,
          providerCalls: 0,
        };
      }
      if (rootFactRead.status === "unavailable") {
        return {
          status: "blocked",
          suppressPrimaryAlert: true,
          reason: `original_${analyzerKey}_fact_${rootFactRead.reason}`,
          observation,
          providerCalls: 0,
        };
      }
      continue;
    }
    const rootFact = rootFactRead.status === "available" ? rootFactRead.fact : null;
    if (
      !rootFact
      || rootFact.eventId !== parentEventId
      || rootFact.rawItemId !== root.rawItemId
    ) {
      return {
        status: "blocked",
        suppressPrimaryAlert: true,
        reason: `original_${analyzerKey}_fact_not_ready`,
        observation,
        providerCalls: 0,
      };
    }
    const semanticFactKey = factKeyForAnalyzer(analyzerKey);
    const saved = await persistSecOriginalFacts({
      identity: root,
      facts: [semanticFact(root, semanticFactKey, monitorFactEnvelope(rootFact.result, rootFact), {
        eventId: rootFact.eventId,
        sourceExecutionId: rootFact.sourceExecutionId,
        evidence: sourceEvidence(rootFact.result) || "Validated source-backed original Monitor fact.",
      })],
      dependencies: dependencies.persistence,
    });
    if (!["saved", "idempotent"].includes(saved.status)) {
      return {
        status: "blocked",
        suppressPrimaryAlert: true,
        reason: `original_fact_persistence_${saved.status}`,
        observation,
        providerCalls: 0,
      };
    }
  }
  const primaryAnalysis = filterMonitorRoutes(input.primaryAnalysis, authorizedAnalyzerKeys);
  const executionContext = { operation: observation.operation as "REPLACE" | "SUPPLEMENT", observation, root };
  return {
    status: "authorized",
    suppressPrimaryAlert: true,
    alertEventId: parentEventId,
    authorizedAnalyzerKeys,
    observation,
    root,
    primaryAnalysis,
    executionContext,
    providerCalls: 0,
  };
}

export async function persistSecAmendmentMonitorReplacement(input: {
  identity: GenericMonitorChildIdentity;
  result: Record<string, unknown>;
  persistence?: SecAmendmentPersistenceDependencies;
}) {
  const context = input.identity.secAmendmentLineage;
  if (!context) return { status: "not_amendment" as const };
  const applicable = input.result.applicable === true || input.result.status === "applicable";
  if (!["REPLACE", "SUPPLEMENT"].includes(context.operation) || !applicable) {
    return { status: "blocked" as const, reason: "replacement_result_not_applicable" };
  }
  const semanticFactKey = factKeyForAnalyzer(input.identity.monitorAnalyzerKey);
  if (!context.observation.affectedFactKeys.includes(semanticFactKey)) {
    return { status: "blocked" as const, reason: "replacement_fact_scope_mismatch" };
  }
  const evidence = context.observation.factScopeEvidence.find(
    (item) => item.semanticFactKey === semanticFactKey,
  )?.evidence;
  const saved = await persistSecAmendmentObservation({
    observation: context.observation,
    facts: [semanticFact(
      context.observation.amendment,
      semanticFactKey,
      monitorFactEnvelope(input.result, {
        eventId: input.identity.eventId,
        rawItemId: input.identity.rawItemId,
        parentPrimaryAiRunId: input.identity.parentPrimaryAiRunId,
        sourceExecutionId: input.identity.executionId,
        analyzerContractVersion: input.identity.analyzerContractVersion,
        persistedAt: input.identity.reservedAt,
      }),
      {
      eventId: input.identity.eventId,
      sourceExecutionId: input.identity.executionId,
      evidence: evidence || "Validated source-backed amendment Monitor fact.",
    })],
    dependencies: input.persistence,
  });
  if (!["saved", "idempotent"].includes(saved.status)) return saved;
  const current = await readSecFilingCurrentState(context.root.rawItemId, input.persistence);
  if (
    current.status !== "available"
    || current.cancelled
    || current.headAccessionNumber !== context.observation.amendment.accessionNumber
  ) {
    return { status: "blocked" as const, reason: current.status === "available" ? "current_head_mismatch" : current.reason };
  }
  return { status: saved.status, current };
}

function deriveAffectedFacts(
  amendment: SecFilingIdentity,
  excerpt: string,
  analysis: Record<string, unknown>,
): SecAffectedFactEvidence[] {
  const routing = readMonitorRoutingResultFromPrimaryOutput(analysis);
  const delta = record(analysis.amendment_delta)
    || record(analysis.sec_8k_6k_amendment_delta);
  if (!delta || delta.is_amendment !== true) return [];
  const changeKind = text(delta.change_kind);
  if (!["clerical_correction", "material_change", "supplemental_update"].includes(changeKind)) return [];
  const changed = `${stringArray(delta.changed_fields).join(" ")} ${text(delta.investor_impact)}`;
  const analyzerKeys: GenericMonitorAnalyzerKey[] = routing?.monitor_routes.length
    ? routing.monitor_routes.map((route) => route.monitor_analyzer_key)
    : ["corporate_action"];
  return analyzerKeys.flatMap((analyzerKey) => {
    const pattern = analyzerKey === "corporate_action"
      ? /\b(?:reverse|forward)?\s*(?:stock|share)?\s*split\b|\bratio\b|\beffective\s+date\b|\breclassification\b/i
      : /\b(?:(?:nasdaq|nyse)\s+(?:listing\s+)?compliance|listing\s+(?:compliance|deficiency|deadline)|delist(?:ing)?|bid\s+price|hearing|trading\s+suspension)\b/i;
    if (!pattern.test(changed)) return [];
    const sourceSentence = splitSentences(excerpt).find((sentence) =>
      pattern.test(sentence)
      && /\b(?:correct|clarif|revis|replac|supersed|amend|change|update)\w*\b/i.test(sentence));
    return sourceSentence
      ? [{
          semanticFactKey: factKeyForAnalyzer(analyzerKey),
          evidence: sourceSentence,
          sourceUrl: amendment.primaryDocumentUrl,
        }]
      : [];
  });
}

function filterMonitorRoutes(analysis: Record<string, unknown>, allowed: GenericMonitorAnalyzerKey[]) {
  const clone = structuredClone(analysis);
  const routing = readMonitorRoutingResultFromPrimaryOutput(clone);
  clone.monitor_routes = allowed.map((monitor_analyzer_key) => ({ monitor_analyzer_key }));
  if (routing?.monitor_routes.length) {
    clone.monitor_routes = routing.monitor_routes.filter((route) =>
      allowed.includes(route.monitor_analyzer_key));
  }
  return clone;
}

function factKeyForAnalyzer(value: GenericMonitorAnalyzerKey) {
  return `monitor.${value}`;
}
function analyzerKeyFromFactKey(value: string): GenericMonitorAnalyzerKey | null {
  if (value === "monitor.listing_risk") return "listing_risk";
  if (value === "monitor.corporate_action") return "corporate_action";
  return null;
}

function semanticFact(
  identity: SecFilingIdentity,
  semanticFactKey: string,
  result: Record<string, unknown>,
  lineage: { eventId: string; sourceExecutionId: string; evidence: string },
): SecSemanticFactVersion {
  const document = decodeURIComponent(new URL(identity.primaryDocumentUrl).pathname.split("/").at(-1) || "");
  return {
    rawItemId: identity.rawItemId,
    sourceAccessionNumber: identity.accessionNumber,
    semanticFactKey,
    factPayload: structuredClone(result),
    sourceRef: {
      url: identity.primaryDocumentUrl,
      document,
      evidence: lineage.evidence.slice(0, 4_000),
    },
    eventId: lineage.eventId,
    sourceExecutionId: lineage.sourceExecutionId,
  };
}

function monitorFactEnvelope(
  result: Record<string, unknown>,
  lineage: Pick<RootFact, "eventId" | "rawItemId" | "parentPrimaryAiRunId" | "sourceExecutionId" | "analyzerContractVersion" | "persistedAt">,
) {
  return {
    result: structuredClone(result),
    eventId: lineage.eventId,
    rawItemId: lineage.rawItemId,
    parentPrimaryAiRunId: lineage.parentPrimaryAiRunId,
    sourceExecutionId: lineage.sourceExecutionId,
    analyzerContractVersion: lineage.analyzerContractVersion,
    persistedAt: lineage.persistedAt,
  };
}

function identityFromRaw(row: Row): SecFilingIdentity | null {
  const payload = record(row.raw_payload);
  const rawItemId = text(row.id);
  const sourceCode = text(row.source_code);
  const accessionNumber = text(payload?.accession_number) || text(row.source_unique_id);
  const formType = text(payload?.form_type).toUpperCase().replace(/\s+/g, "");
  const issuerCik = text(payload?.cik);
  const filedDate = readSecLineageFilingDate(payload);
  const primaryDocumentUrl = text(payload?.primary_document_url);
  const indexUrl = text(row.source_url);
  return sourceCode === "sec_edgar"
    && rawItemId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawItemId)
    && /^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)
    && text(row.source_unique_id) === accessionNumber
    && /^(?:8-K|6-K)(?:\/A)?$/.test(formType)
    && /^\d{1,10}$/.test(issuerCik)
    && filedDate !== null
    && filingUrlMatchesIdentity(primaryDocumentUrl, issuerCik, accessionNumber)
    && filingUrlMatchesIdentity(indexUrl, issuerCik, accessionNumber)
    ? { rawItemId, sourceCode: "sec_edgar", issuerCik, accessionNumber, formType, filedDate, primaryDocumentUrl, indexUrl }
    : null;
}

function filingUrlMatchesIdentity(value: string, issuerCik: string, accessionNumber: string) {
  try {
    const url = new URL(value);
    const pathCik = url.pathname.match(/\/Archives\/edgar\/data\/(\d+)\//i)?.[1] || "";
    return url.protocol === "https:"
      && url.hostname === "www.sec.gov"
      && pathCik.replace(/^0+(?=\d)/, "") === issuerCik.replace(/^0+(?=\d)/, "")
      && url.pathname.includes(`/${accessionNumber.replace(/-/g, "")}/`);
  } catch {
    return false;
  }
}

function isOfficialSecUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.sec.gov" || url.hostname === "data.sec.gov");
  } catch {
    return false;
  }
}

function lineageEvidence(amendment: SecFilingIdentity, amendmentExcerpt: string) {
  return {
    amendmentExcerpt,
    amendmentDocumentUrl: amendment.primaryDocumentUrl,
    amendmentIndexUrl: amendment.indexUrl,
    submissionsUrl: `https://data.sec.gov/submissions/CIK${amendment.issuerCik.padStart(10, "0")}.json`,
    amendmentExcerptSha256: createHash("sha256").update(amendmentExcerpt).digest("hex"),
  };
}
function amendmentExcerpt(rawItem: Row, filingInput: unknown) {
  const filingPackage = record(record(filingInput)?.filing_package);
  return [rawItem.analysis_text, rawItem.body_text, filingPackage?.llm_text]
    .map(text)
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .slice(0, 120_000);
}
function sourceEvidence(result: Record<string, unknown>) {
  const facts = record(result.facts);
  const evidence = facts?.evidence;
  return typeof evidence === "string"
    ? evidence
    : evidence ? JSON.stringify(evidence).slice(0, 4_000) : "";
}
function splitSentences(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}
function defaultDependencies(): SecAmendmentMonitorBridgeDependencies {
  return {
    loadRawItem: async (rawItemId) => {
      const { supabaseSelect } = await import("../supabase.ts");
      const response = await supabaseSelect("raw_items", { select: "*", id: `eq.${rawItemId}`, limit: "2" });
      if (!response.ok) throw new Error("SEC amendment parent raw read failed");
      const rows = Array.isArray(response.data) ? response.data : [];
      return rows.length === 1 ? record(rows[0]) : null;
    },
    loadEventRawItemId: async (eventId) => {
      const { supabaseSelect } = await import("../supabase.ts");
      const response = await supabaseSelect("events", { select: "raw_item_id", id: `eq.${eventId}`, limit: "2" });
      if (!response.ok) throw new Error("SEC amendment parent event read failed");
      const rows = Array.isArray(response.data) ? response.data : [];
      return rows.length === 1 ? text(record(rows[0])?.raw_item_id) || null : null;
    },
    findExactParentCandidates: async (amendment, target) => {
      const { supabaseSelect } = await import("../supabase.ts");
      const normalizedCik = amendment.issuerCik.replace(/^0+/, "");
      const paddedCik = normalizedCik.padStart(10, "0");
      const response = await supabaseSelect("raw_items", {
        select: "*",
        source_code: "eq.sec_edgar",
        "raw_payload->>cik": normalizedCik === paddedCik
          ? `eq.${normalizedCik}`
          : `in.(${normalizedCik},${paddedCik})`,
        "raw_payload->>form_type": `eq.${amendment.formType.replace(/\/A$/, "")}`,
        ...(target.accessionNumber
          ? { source_unique_id: `eq.${target.accessionNumber}` }
          : secLineageParentDateFilter(target.filedDate)),
        limit: "3",
      });
      if (!response.ok) throw new Error("SEC amendment exact parent candidate read failed");
      const rawRows = Array.isArray(response.data) ? response.data : [];
      if (rawRows.length !== 1) {
        throw new Error("SEC amendment exact parent raw identity is unavailable or ambiguous");
      }
      const row = record(rawRows[0]);
      const candidateIdentity = row ? identityFromRaw(row) : null;
      if (!row || !candidateIdentity
        || candidateIdentity.issuerCik.replace(/^0+/, "") !== amendment.issuerCik.replace(/^0+/, "")
        || candidateIdentity.formType !== amendment.formType.replace(/\/A$/, "")
        || (target.accessionNumber && candidateIdentity.accessionNumber !== target.accessionNumber)
        || (target.filedDate && candidateIdentity.filedDate !== target.filedDate)) {
        throw new Error("SEC amendment exact parent raw identity is invalid");
      }
      const rows = [row];
      const candidates = await Promise.all(rows.map(async (rawItem) => {
        const events = await supabaseSelect("events", { select: "id", raw_item_id: `eq.${text(rawItem.id)}`, limit: "2" });
        const eventRows = Array.isArray(events.data) ? events.data : [];
        if (!events.ok || eventRows.length !== 1) {
          throw new Error("SEC amendment exact parent event identity is unavailable or ambiguous");
        }
        return { rawItem, eventId: text(record(eventRows[0])?.id) };
      }));
      if (candidates.some((candidate) => !candidate.eventId)) {
        throw new Error("SEC amendment exact parent event identity is invalid");
      }
      return candidates;
    },
    readRootFact: async (eventId, analyzerKey) => {
      if (analyzerKey === "corporate_action") {
        const current = await (await import("../monitor/corporateActionPersistence.ts")).readCurrentCorporateActionFacts(eventId);
        if (current.status === "available") return { status: "available", fact: { result: { applicable: true, facts: current.facts }, eventId: current.eventId, rawItemId: current.rawItemId, parentPrimaryAiRunId: current.parentPrimaryAiRunId, sourceExecutionId: current.sourceExecutionId, analyzerContractVersion: current.analyzerContractVersion, persistedAt: current.persistedAt } };
        return current.status === "not_applicable"
          ? { status: "absent" }
          : { status: "unavailable", reason: current.reason };
      }
      if (analyzerKey === "listing_risk") {
        const current = await (await import("../monitor/listingRiskPersistence.ts")).readCurrentListingRiskFacts(eventId);
        if (current.status === "available") return { status: "available", fact: { result: { status: "applicable", facts: current.facts }, eventId: current.eventId, rawItemId: current.rawItemId, parentPrimaryAiRunId: current.parentPrimaryAiRunId, sourceExecutionId: current.sourceExecutionId, analyzerContractVersion: current.analyzerContractVersion, persistedAt: current.persistedAt } };
        return current.status === "not_applicable"
          ? { status: "absent" }
          : { status: "unavailable", reason: current.reason };
      }
      return { status: "unavailable", reason: "unsupported_analyzer" };
    },
  };
}
function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}
