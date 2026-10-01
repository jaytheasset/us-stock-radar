import "server-only";
import { evaluateStableSecSecurityIdentity } from "./canonical.ts";
import { readExactCover, coverObservations, selectedSourceHasNoConflictingRevision,
  type SecTickerResolutionRepository } from "./persistence.ts";

type Row = Record<string, unknown>;
export type StableIdentityInput = {
  beforeAccession: string; beforeSourceHash: string; afterAccession: string; afterSourceHash: string;
  beforeObservationKey?: string; afterObservationKey?: string;
};
/** Reuses the source-validating cover reader; no AUTO/change decision is manufactured. */
export async function readStableIdentityEvidence(input: StableIdentityInput, repository: SecTickerResolutionRepository) {
  const before = await readExactCover(input.beforeAccession, input.beforeSourceHash, repository);
  const after = await readExactCover(input.afterAccession, input.afterSourceHash, repository);
  if (!before.ok || !after.ok) return { status: "unresolved" as const, reason: "stable_cover_unavailable" };
  if (!await selectedSourceHasNoConflictingRevision(before.value, repository)
    || !await selectedSourceHasNoConflictingRevision(after.value, repository))
    return { status: "conflict" as const, reason: "stable_cover_source_revision_conflict" };
  const beforeRows = coverObservations(before.value), afterRows = coverObservations(after.value);
  if (Boolean(input.beforeObservationKey) !== Boolean(input.afterObservationKey))
    return { status: "unresolved" as const, reason: "stable_cover_selection_incomplete" };
  const evaluated = evaluateStableSecSecurityIdentity(beforeRows, afterRows, input.beforeObservationKey
    ? { beforeObservationKey: input.beforeObservationKey, afterObservationKey: input.afterObservationKey! } : undefined);
  if (!evaluated.identity) return { status: "unresolved" as const, reason: evaluated.reason };
  return { status: "available" as const, identity: evaluated.identity,
    before: beforeRows.find(o => o.observationKey === evaluated.identity!.before_observation_key)!,
    after: afterRows.find(o => o.observationKey === evaluated.identity!.after_observation_key)! };
}

export async function persistStableSecSecurityIdentity(input: StableIdentityInput & { repository: SecTickerResolutionRepository }) {
  const read = await readStableIdentityEvidence(input, input.repository);
  if (read.status !== "available") return read;
  const response = await input.repository.rpc("persist_sec_stable_security_identity", { p_identity: read.identity });
  const data = response.data as Row | null;
  if (!response.ok || !data || data.id !== read.identity.id || !["inserted", "replayed"].includes(String(data.status)))
    throw Error(`stable_identity_persistence_failed:${response.error || response.status}`);
  return { ...read, writeStatus: String(data.status) };
}

export async function readStoredStableIdentity(identity: Row, repository: SecTickerResolutionRepository) {
  const covers: Row[] = [];
  for (const id of [identity.before_result_id, identity.after_result_id]) {
    const r = await repository.select("sec_cover_observation_results", { select: "*", id: `eq.${id}`, limit: "2" });
    if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1)
      return { status: "unresolved" as const, reason: "stable_cover_unavailable" };
    covers.push(r.data[0]);
  }
  const read = await readStableIdentityEvidence({ beforeAccession: String(covers[0].accession_number),
    beforeSourceHash: String(covers[0].source_sha256), afterAccession: String(covers[1].accession_number),
    afterSourceHash: String(covers[1].source_sha256), beforeObservationKey: String(identity.before_observation_key),
    afterObservationKey: String(identity.after_observation_key) }, repository);
  if (read.status !== "available") return read;
  // The persisted identity is derived from the exact source, not trusted by its ID alone.
  if (Object.entries(read.identity).some(([key, value]) => canonical(value) !== canonical(identity[key])))
    return { status: "conflict" as const, reason: "stable_identity_stored_proof_mismatch" };
  return read;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
