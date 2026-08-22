import type { CorporateActionCanonicalFacts } from "./corporateActionCanonicalFacts.ts";
import {
  readCurrentCorporateActionFacts,
  type CorporateActionPersistenceDependencies,
  type CurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CIK_PATTERN = /^\d{10}$/;

export type ReverseSplitExecutionUpdateObservation = {
  eventId: string;
  sourceExecutionId: string;
  issuerCik: string;
  acceptedAt: string;
  persistedAt: string;
  update: NonNullable<CorporateActionCanonicalFacts["execution_update"]>;
  facts: CorporateActionCanonicalFacts;
};

export type ReverseSplitExecutionUpdateReadResult = {
  status: "available";
  issuerCik: string;
  targetAt: string;
  updates: ReverseSplitExecutionUpdateObservation[];
};

type ReverseSplitExecutionUpdateDependencies = CorporateActionPersistenceDependencies & {
  readCurrent(eventId: string): Promise<CurrentCorporateActionReadResult>;
};

const defaultDependencies: ReverseSplitExecutionUpdateDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
  readCurrent: (eventId) => readCurrentCorporateActionFacts(eventId),
};

export async function readReverseSplitExecutionUpdates(
  input: { cik: string; targetAt: string },
  dependencies: ReverseSplitExecutionUpdateDependencies = defaultDependencies,
): Promise<ReverseSplitExecutionUpdateReadResult> {
  if (!CIK_PATTERN.test(input.cik) || !validTimestamp(input.targetAt)) {
    throw new Error("Reverse split execution update filter is invalid");
  }
  const response = await dependencies.rpc("read_reverse_split_execution_update_candidates", {
    p_issuer_cik: input.cik,
  });
  if (!response.ok) {
    throw new Error(`Reverse split execution update candidate reader failed: ${response.error || response.status}`);
  }
  const candidates = validateCandidates(response.data, input.cik);
  const updates: ReverseSplitExecutionUpdateObservation[] = [];
  for (const candidate of candidates) {
    const current = await dependencies.readCurrent(candidate.eventId);
    if (current.status !== "available" || current.sourceExecutionId !== candidate.sourceExecutionId) continue;
    const update = current.facts.execution_update;
    const issuer = current.facts.applicability?.issuer;
    if (!update || issuer?.availability !== "available" || issuer.issuer_cik !== input.cik
      || !validTimestamp(issuer.accepted_at) || Date.parse(issuer.accepted_at!) > Date.parse(input.targetAt)) continue;
    updates.push({
      eventId: current.eventId,
      sourceExecutionId: current.sourceExecutionId,
      issuerCik: input.cik,
      acceptedAt: issuer.accepted_at!,
      persistedAt: current.persistedAt,
      update,
      facts: current.facts,
    });
  }
  updates.sort((left, right) => Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt)
    || left.sourceExecutionId.localeCompare(right.sourceExecutionId));
  return { status: "available", issuerCik: input.cik, targetAt: input.targetAt, updates };
}

function validateCandidates(value: unknown, cik: string) {
  const root = record(value);
  if (!root || root.status !== "available" || root.issuer_cik !== cik
    || !Array.isArray(root.candidates) || root.candidates.length > 512) {
    throw new Error("Reverse split execution update candidate response is invalid");
  }
  return root.candidates.map((candidateValue, index) => {
    const candidate = record(candidateValue);
    const eventId = stringValue(candidate?.event_id);
    const sourceExecutionId = stringValue(candidate?.source_execution_id);
    const persistedAt = stringValue(candidate?.persisted_at);
    if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(sourceExecutionId)
      || !validTimestamp(persistedAt)) {
      throw new Error(`Reverse split execution update candidate ${index} is invalid`);
    }
    return { eventId, sourceExecutionId, persistedAt };
  });
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
