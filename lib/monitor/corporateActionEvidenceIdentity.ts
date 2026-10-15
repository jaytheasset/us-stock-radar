export const CORPORATE_ACTION_EVIDENCE_IDENTITY_VERSION = "corporate_action_evidence_identity_v1";

export type CorporateActionEvidenceIdentity = {
  version: typeof CORPORATE_ACTION_EVIDENCE_IDENTITY_VERSION;
  source_ref: string;
  range_start: number;
  range_end: number;
  source_content_hash: string;
  exact_source: true;
};

export function validateCorporateActionEvidenceIdentity(value: unknown): string[] {
  const errors: string[] = [];
  const identity = record(value);
  if (!identity) return ["evidence identity must be an object"];
  exactKeys(identity, [
    "version",
    "source_ref",
    "range_start",
    "range_end",
    "source_content_hash",
    "exact_source",
  ], "evidence identity", errors);
  if (identity.version !== CORPORATE_ACTION_EVIDENCE_IDENTITY_VERSION) {
    errors.push("evidence identity version is invalid");
  }
  if (!stableSourceRef(identity.source_ref)) errors.push("evidence identity source_ref is invalid");
  if (!Number.isInteger(identity.range_start) || Number(identity.range_start) < 0) {
    errors.push("evidence identity range_start is invalid");
  }
  if (!Number.isInteger(identity.range_end)
    || Number(identity.range_end) <= Number(identity.range_start)) {
    errors.push("evidence identity range_end is invalid");
  }
  if (typeof identity.source_content_hash !== "string"
    || !/^[0-9a-f]{64}$/.test(identity.source_content_hash)) {
    errors.push("evidence identity source_content_hash is invalid");
  }
  if (identity.exact_source !== true) errors.push("evidence identity exact_source must be true");
  return errors;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function stableSourceRef(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
