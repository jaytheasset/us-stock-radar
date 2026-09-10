import {
  buildSecFactHistoryKey,
  projectSecFilingCurrentState,
  type SecAmendmentLineageResolution,
  type SecCurrentStateProjection,
  type SecFilingIdentity,
  type SecSemanticFactVersion,
} from "./secAmendmentLineage.ts";

type RpcResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
};

export type SecAmendmentPersistenceDependencies = {
  rpc(name: string, payload: Record<string, unknown>): Promise<RpcResult>;
};

export type SecAmendmentPersistenceResult =
  | {
      status: "saved" | "idempotent";
      insertedCount: number;
      idempotentCount: number;
    }
  | { status: "rejected" | "conflict"; reason: string };

const defaultDependencies: SecAmendmentPersistenceDependencies = {
  rpc: async (name, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(name, payload);
  },
};

export async function persistSecOriginalFacts(input: {
  identity: SecFilingIdentity;
  facts: SecSemanticFactVersion[];
  dependencies?: SecAmendmentPersistenceDependencies;
}): Promise<SecAmendmentPersistenceResult> {
  const response = await (input.dependencies || defaultDependencies).rpc(
    "persist_sec_filing_original_facts",
    {
      p_identity: input.identity,
      p_facts: serializeFacts(input.facts),
    },
  );
  return readPersistenceResult(response, "SEC original fact persistence");
}

export async function persistSecAmendmentObservation(input: {
  observation: SecAmendmentLineageResolution;
  facts?: SecSemanticFactVersion[];
  dependencies?: SecAmendmentPersistenceDependencies;
}): Promise<SecAmendmentPersistenceResult> {
  const facts = input.facts || [];
  if (input.observation.status === "unavailable_review" && facts.length) {
    return {
      status: "rejected",
      reason: "unavailable_observation_must_not_write_facts",
    };
  }
  const response = await (input.dependencies || defaultDependencies).rpc(
    "persist_sec_filing_amendment_observation",
    {
      p_observation: input.observation,
      p_facts: serializeFacts(facts),
    },
  );
  return readPersistenceResult(
    response,
    "SEC amendment observation persistence",
  );
}

export async function readSecFilingCurrentState(
  rootRawItemId: string,
  dependencies: SecAmendmentPersistenceDependencies = defaultDependencies,
): Promise<SecCurrentStateProjection> {
  const response = await dependencies.rpc("read_sec_filing_amendment_ledger", {
    p_root_raw_item_id: rootRawItemId,
  });
  if (!response.ok) {
    throw new Error(
      `SEC amendment ledger read failed: ${response.error || response.status}`,
    );
  }
  const payload = record(response.data);
  if (payload?.status !== "available") {
    return {
      status: "unavailable_review",
      reason: stringValue(payload?.reason) || "invalid_ledger_response",
      semanticEventIdentity: "",
      rootAccessionNumber: "",
      reviewObservationKeys: [],
    };
  }
  const root = record(payload.root) as SecFilingIdentity | null;
  const observations = Array.isArray(payload.observations)
    ? (payload.observations.filter(
        record,
      ) as unknown as SecAmendmentLineageResolution[])
    : [];
  const facts = Array.isArray(payload.facts)
    ? (payload.facts.filter(record) as unknown as SecSemanticFactVersion[])
    : [];
  if (!root) {
    return {
      status: "unavailable_review",
      reason: "invalid_root_ledger_identity",
      semanticEventIdentity: "",
      rootAccessionNumber: "",
      reviewObservationKeys: [],
    };
  }
  return projectSecFilingCurrentState({ root, observations, facts });
}

function serializeFacts(facts: SecSemanticFactVersion[]) {
  return facts.map((fact) => ({
    ...fact,
    eventId: fact.eventId || null,
    sourceExecutionId: fact.sourceExecutionId || null,
    historyKey: buildSecFactHistoryKey(fact),
  }));
}

function readPersistenceResult(
  response: RpcResult,
  label: string,
): SecAmendmentPersistenceResult {
  if (!response.ok)
    throw new Error(`${label} failed: ${response.error || response.status}`);
  const payload = record(response.data);
  const status = stringValue(payload?.status);
  if (status === "saved" || status === "idempotent") {
    return {
      status,
      insertedCount: integerValue(payload?.inserted_count),
      idempotentCount: integerValue(payload?.idempotent_count),
    };
  }
  if (status === "rejected" || status === "conflict") {
    return { status, reason: stringValue(payload?.reason) || "unknown" };
  }
  return { status: "rejected", reason: "invalid_persistence_response" };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

