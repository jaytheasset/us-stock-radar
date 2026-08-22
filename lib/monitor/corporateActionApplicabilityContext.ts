import type {
  CorporateActionIssuerContext,
  ReverseSplitActionCandidate,
  CorporateActionSecurityClassCandidate,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";
import { readReverseSplitActionCandidatesForAnalyzer } from "./reverseSplitActionLifecycle.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CIK_PATTERN = /^\d{10}$/;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

export type CorporateActionApplicabilityContext = {
  issuerContext: CorporateActionIssuerContext;
  securityClassCandidates: CorporateActionSecurityClassCandidate[];
  actionCandidates: ReverseSplitActionCandidate[];
};

type ApplicabilityContextDependencies = {
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
  readCurrent?(eventId: string): Promise<CurrentCorporateActionReadResult>;
};

const defaultDependencies: ApplicabilityContextDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

export function unavailableCorporateActionApplicabilityContext(
  reason: Extract<CorporateActionIssuerContext, { availability: "unavailable" }>["reason"],
): CorporateActionApplicabilityContext {
  return {
    issuerContext: { availability: "unavailable", reason },
    securityClassCandidates: [],
    actionCandidates: [],
  };
}

export async function readCorporateActionApplicabilityContext(
  input: { eventId: string; rawItemId: string },
  dependencies: ApplicabilityContextDependencies = defaultDependencies,
): Promise<CorporateActionApplicabilityContext> {
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.rawItemId)) {
    return unavailableCorporateActionApplicabilityContext("filing_ledger_identity_unavailable");
  }
  const response = await dependencies.rpc("read_corporate_action_applicability_context", {
    p_event_id: input.eventId,
    p_raw_item_id: input.rawItemId,
  });
  if (!response.ok) {
    throw new Error(`Corporate Action applicability context reader failed: ${response.error || response.status}`);
  }
  const context = validateCorporateActionApplicabilityContextResponse(response.data);
  if (context.issuerContext.availability !== "available") return context;
  const actionCandidates = await readReverseSplitActionCandidatesForAnalyzer({
    issuerCik: context.issuerContext.issuer_cik,
    acceptedAt: context.issuerContext.accepted_at,
    allowedSecurityClassIds: context.securityClassCandidates.map((item) => item.canonical_security_class_id),
  }, {
    rpc: dependencies.rpc,
    readCurrent: dependencies.readCurrent || readCurrentCorporateActionFacts,
  });
  return { ...context, actionCandidates };
}

export function validateCorporateActionApplicabilityContextResponse(
  value: unknown,
): CorporateActionApplicabilityContext {
  const root = record(value);
  if (!root || root.status !== "available") {
    const reason = stringValue(root?.reason);
    if (reason === "non_sec_source" || reason === "accession_unavailable"
      || reason === "filing_ledger_identity_unavailable" || reason === "filing_ledger_identity_conflict") {
      return unavailableCorporateActionApplicabilityContext(reason);
    }
    throw new Error("Corporate Action applicability context response is invalid");
  }
  const issuer = record(root.issuer_context);
  if (!issuer || issuer.availability !== "available") {
    throw new Error("Corporate Action issuer context is invalid");
  }
  const issuerCik = stringValue(issuer.issuer_cik);
  const accessionNumber = stringValue(issuer.accession_number);
  const acceptedAt = issuer.accepted_at === null ? null : stringValue(issuer.accepted_at);
  if (!CIK_PATTERN.test(issuerCik) || !ACCESSION_PATTERN.test(accessionNumber)
    || (acceptedAt !== null && !validTimestamp(acceptedAt))
    || issuer.provenance !== "sec_filing_ledger") {
    throw new Error("Corporate Action issuer context identity is invalid");
  }
  if (!Array.isArray(root.security_class_candidates) || root.security_class_candidates.length > 24) {
    throw new Error("Corporate Action security class candidates are invalid");
  }
  const ids = new Set<string>();
  const candidates = root.security_class_candidates.map((candidateValue, index) => {
    const candidate = record(candidateValue);
    if (!candidate) throw new Error(`Corporate Action security class candidate ${index} is invalid`);
    const canonicalSecurityClassId = stringValue(candidate.canonical_security_class_id);
    const basis = candidate.security_class_basis;
    const sourceMemberLocalName = candidate.source_member_local_name === null
      ? null : stringValue(candidate.source_member_local_name);
    if (!new RegExp(`^sc:v1:${issuerCik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$`)
      .test(canonicalSecurityClassId)
      || ids.has(canonicalSecurityClassId)
      || candidate.security_type !== "common_stock"
      || (basis !== "SINGLE_COMMON_STOCK_CLASS" && basis !== "CLASS_SPECIFIC_COMMON_STOCK")
      || (basis === "SINGLE_COMMON_STOCK_CLASS" && sourceMemberLocalName !== null)
      || (basis === "CLASS_SPECIFIC_COMMON_STOCK" && !sourceMemberLocalName)) {
      throw new Error(`Corporate Action security class candidate ${index} identity is invalid`);
    }
    if (!Array.isArray(candidate.supporting_accessions)
      || candidate.supporting_accessions.length < 1
      || candidate.supporting_accessions.length > 12
      || candidate.supporting_accessions.some((item) => !ACCESSION_PATTERN.test(stringValue(item)))) {
      throw new Error(`Corporate Action security class candidate ${index} provenance is invalid`);
    }
    ids.add(canonicalSecurityClassId);
    return {
      canonical_security_class_id: canonicalSecurityClassId,
      security_type: "common_stock" as const,
      security_class_basis: basis as CorporateActionSecurityClassCandidate["security_class_basis"],
      source_member_local_name: sourceMemberLocalName,
      supporting_accessions: candidate.supporting_accessions.map(stringValue),
    };
  });
  return {
    issuerContext: {
      availability: "available",
      issuer_cik: issuerCik,
      accession_number: accessionNumber,
      accepted_at: acceptedAt,
      provenance: "sec_filing_ledger",
    },
    securityClassCandidates: candidates,
    actionCandidates: [],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}
