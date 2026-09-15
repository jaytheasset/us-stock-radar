export const OWNERSHIP_CONTEXT_VERSION = "ownership_context_v1" as const;
export const OWNERSHIP_CONTEXT_AI_PROMPT_KEY = "ownership_structured_context" as const;
export const OWNERSHIP_CONTEXT_AI_PROMPT_VERSION = "ownership_context_llm_v1.1-form-semantic-routing" as const;
export const OWNERSHIP_CONTEXT_AI_PURPOSE = "ownership_structured_context" as const;

export const OWNERSHIP_CONTEXT_FACTS = [
  "owner_attribution",
  "ownership_relation",
  "economic_direction",
  "derivative_underlying_relation",
  "rule_10b5_1_applicability",
  "footnote_scope",
  "amendment_effect",
] as const;

export const OWNERSHIP_CONTEXT_STATUSES = [
  "supported",
  "ambiguous",
  "conflict",
  "unresolved",
] as const;

export type OwnershipContextFact = typeof OWNERSHIP_CONTEXT_FACTS[number];
export type OwnershipContextStatus = typeof OWNERSHIP_CONTEXT_STATUSES[number];
export type OwnershipContextForm = "form4" | "form144";
export type OwnershipContextValue = string | boolean;

export type OwnershipContextAssertion = Readonly<{
  fact: OwnershipContextFact;
  status: OwnershipContextStatus;
  value?: OwnershipContextValue;
  owner_ref?: string;
  security_ref?: string;
  evidence_refs: readonly string[];
}>;

export type ValidatedOwnershipContextRow = Readonly<{
  row_ref: string;
  assertions: readonly OwnershipContextAssertion[];
}>;

export type OwnershipContextAiRefs = Readonly<{
  run_id: string;
  output_id: string;
}>;

export type ValidatedOwnershipContextBundle = Readonly<{
  version: typeof OWNERSHIP_CONTEXT_VERSION;
  event_ref: string;
  form: OwnershipContextForm;
  source_fingerprint: string;
  rows: readonly ValidatedOwnershipContextRow[];
}>;

export type StoredOwnershipContextEnvelope = Readonly<{
  version: typeof OWNERSHIP_CONTEXT_VERSION;
  source_fingerprint: string;
  assertions: readonly OwnershipContextAssertion[];
  ai_refs?: OwnershipContextAiRefs;
}>;

type DirectConflictFacts = Readonly<{
  transactionKind: string | null;
  acquiredDisposedCode: string | null;
  directOrIndirectOwnership: string | null;
  is10b51: boolean | null;
  allowedUnderlyingSecurityRefs: readonly string[];
}>;

export type OwnershipContextReferenceRow = Readonly<{
  rowRef: string;
  ownerRefs: readonly string[];
  securityRef: string | null;
  evidenceRefs: readonly string[];
  direct: DirectConflictFacts;
}>;

export type OwnershipContextReferenceInventory = Readonly<{
  version: typeof OWNERSHIP_CONTEXT_VERSION;
  eventRef: string;
  form: OwnershipContextForm;
  isAmendment: boolean;
  sourceFingerprint: string;
  rows: readonly OwnershipContextReferenceRow[];
}>;

export type OwnershipContextValidationResult =
  | Readonly<{ ok: true; value: ValidatedOwnershipContextBundle }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_FINGERPRINT_PATTERN = /^ownership-context-v1:[0-9a-f]{64}$/;
const ASSERTION_KEYS = new Set(["fact", "status", "value", "owner_ref", "security_ref", "evidence_refs"]);

export function buildOwnershipContextReferenceInventory(input: Readonly<{
  eventId: string;
  form: OwnershipContextForm;
  isAmendment: boolean;
  sourceFingerprint: string;
  rows: readonly Record<string, unknown>[];
}>): OwnershipContextReferenceInventory {
  if (!UUID_PATTERN.test(input.eventId)) throw new Error("Ownership context eventId must be a UUID");
  if (!isOwnershipContextSourceFingerprint(input.sourceFingerprint)) {
    throw new Error("Ownership context source fingerprint is invalid");
  }
  const indexColumn = input.form === "form4" ? "transaction_index" : "proposed_sale_index";
  const securityTitles = input.rows.map((row) => nonEmptyString(row.security_title));
  const securityRefs = securityTitles.map((title, position) => title ? `security:${input.form}:${position}` : null);
  return Object.freeze({
    version: OWNERSHIP_CONTEXT_VERSION,
    eventRef: `event:${input.eventId.toLowerCase()}`,
    form: input.form,
    isAmendment: input.isAmendment,
    sourceFingerprint: input.sourceFingerprint,
    rows: Object.freeze(input.rows.map((row, position) => {
      const index = row[indexColumn];
      if (index !== position) throw new Error("Ownership context rows must use contiguous canonical indexes");
      const prefix = `${input.form}:${position}`;
      const owners = strictStringArray(row.reporting_owner_names);
      const evidence = strictStringArray(row.evidence);
      return Object.freeze({
        rowRef: `row:${prefix}`,
        ownerRefs: Object.freeze(owners.map((_owner, ownerIndex) => `owner:${prefix}:${ownerIndex}`)),
        securityRef: securityRefs[position],
        evidenceRefs: Object.freeze(evidence.map((_item, evidenceIndex) => `evidence:${prefix}:${evidenceIndex}`)),
        direct: Object.freeze({
          transactionKind: nonEmptyString(row.transaction_kind),
          acquiredDisposedCode: nonEmptyString(row.acquired_disposed_code),
          directOrIndirectOwnership: nonEmptyString(row.direct_or_indirect_ownership),
          is10b51: typeof row.is_10b5_1 === "boolean" ? row.is_10b5_1 : null,
          allowedUnderlyingSecurityRefs: Object.freeze((() => {
            const underlyingTitle = nonEmptyString(record(row.calculation_basis).underlying_security_title);
            if (!underlyingTitle) return [];
            return securityTitles.flatMap((title, targetIndex) => (
              title === underlyingTitle && targetIndex !== position && securityRefs[targetIndex]
                ? [securityRefs[targetIndex]!]
                : []
            ));
          })()),
        }),
      });
    })),
  });
}

export function validateOwnershipContextCandidate(
  candidate: unknown,
  inventory: OwnershipContextReferenceInventory,
): OwnershipContextValidationResult {
  const errors: string[] = [];
  const root = strictRecord(candidate, "ownership_context", [
    "version", "event_ref", "form", "source_fingerprint", "rows",
  ], errors);
  if (!root) return { ok: false, errors };
  if (root.version !== OWNERSHIP_CONTEXT_VERSION) errors.push("ownership_context.version is invalid");
  if (root.event_ref !== inventory.eventRef) errors.push("ownership_context.event_ref does not match the current event");
  if (root.form !== inventory.form) errors.push("ownership_context.form does not match the current form");
  if (root.source_fingerprint !== inventory.sourceFingerprint) {
    errors.push("ownership_context.source_fingerprint is stale or untrusted");
  }
  if (!Array.isArray(root.rows) || root.rows.length === 0 || root.rows.length > 1000) {
    errors.push("ownership_context.rows must be a non-empty array with at most 1000 rows");
    return { ok: false, errors };
  }

  const rowByRef = new Map(inventory.rows.map((row) => [row.rowRef, row]));
  const allOwnerRefs = new Set(inventory.rows.flatMap((row) => row.ownerRefs));
  const allSecurityRefs = new Set(inventory.rows.flatMap((row) => row.securityRef ? [row.securityRef] : []));
  const allEvidenceRefs = new Set(inventory.rows.flatMap((row) => row.evidenceRefs));
  const seenRows = new Set<string>();
  const validatedRows: ValidatedOwnershipContextRow[] = [];

  root.rows.forEach((rowValue, rowPosition) => {
    const path = `ownership_context.rows[${rowPosition}]`;
    const row = strictRecord(rowValue, path, ["row_ref", "assertions"], errors);
    if (!row) return;
    const rowRef = nonEmptyString(row.row_ref);
    const referenceRow = rowRef ? rowByRef.get(rowRef) : undefined;
    if (!rowRef || !referenceRow) {
      errors.push(`${path}.row_ref does not reference a current canonical row`);
      return;
    }
    if (seenRows.has(rowRef)) errors.push(`${path}.row_ref is duplicated`);
    seenRows.add(rowRef);
    if (!Array.isArray(row.assertions) || row.assertions.length === 0 || row.assertions.length > OWNERSHIP_CONTEXT_FACTS.length) {
      errors.push(`${path}.assertions must be a non-empty array with at most ${OWNERSHIP_CONTEXT_FACTS.length} items`);
      return;
    }
    const seenFacts = new Set<string>();
    const assertions: OwnershipContextAssertion[] = [];
    row.assertions.forEach((assertionValue, assertionPosition) => {
      const assertionPath = `${path}.assertions[${assertionPosition}]`;
      const assertion = strictRecord(assertionValue, assertionPath, ASSERTION_KEYS, errors);
      if (!assertion) return;
      const fact = oneOf(assertion.fact, OWNERSHIP_CONTEXT_FACTS);
      const status = oneOf(assertion.status, OWNERSHIP_CONTEXT_STATUSES);
      if (!fact) errors.push(`${assertionPath}.fact is invalid`);
      if (!status) errors.push(`${assertionPath}.status is invalid`);
      if (!fact || !status) return;
      if (seenFacts.has(fact)) errors.push(`${assertionPath}.fact is duplicated for the row`);
      seenFacts.add(fact);

      const evidenceRefs = strictStringArray(assertion.evidence_refs);
      if (!Array.isArray(assertion.evidence_refs) || evidenceRefs.length !== assertion.evidence_refs.length) {
        errors.push(`${assertionPath}.evidence_refs must contain only non-empty reference strings`);
      }
      if (evidenceRefs.some((ref) => !allEvidenceRefs.has(ref))) {
        errors.push(`${assertionPath}.evidence_refs contains a forged or missing reference`);
      }
      if (status === "supported" && evidenceRefs.length === 0) {
        errors.push(`${assertionPath} supported assertions require evidence`);
      }
      const ownerRef = optionalString(assertion.owner_ref);
      const securityRef = optionalString(assertion.security_ref);
      if (Object.hasOwn(assertion, "owner_ref") && !ownerRef) errors.push(`${assertionPath}.owner_ref must be a non-empty reference string`);
      if (Object.hasOwn(assertion, "security_ref") && !securityRef) errors.push(`${assertionPath}.security_ref must be a non-empty reference string`);
      if (ownerRef && !allOwnerRefs.has(ownerRef)) errors.push(`${assertionPath}.owner_ref is forged or missing`);
      if (securityRef && !allSecurityRefs.has(securityRef)) errors.push(`${assertionPath}.security_ref is forged or missing`);
      if (status !== "supported" && Object.hasOwn(assertion, "value")) {
        errors.push(`${assertionPath}.value is allowed only for supported assertions`);
      }
      validateAssertionMeaning({
        assertion, fact, status, ownerRef, securityRef, referenceRow, inventory,
        allOwnerRefs, allSecurityRefs, path: assertionPath, errors,
      });
      assertions.push(Object.freeze({
        fact,
        status,
        ...(Object.hasOwn(assertion, "value") ? { value: assertion.value as OwnershipContextValue } : {}),
        ...(ownerRef ? { owner_ref: ownerRef } : {}),
        ...(securityRef ? { security_ref: securityRef } : {}),
        evidence_refs: Object.freeze([...evidenceRefs]),
      }));
    });
    validatedRows.push(Object.freeze({ row_ref: rowRef, assertions: Object.freeze(assertions) }));
  });

  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };
  return {
    ok: true,
    value: Object.freeze({
      version: OWNERSHIP_CONTEXT_VERSION,
      event_ref: inventory.eventRef,
      form: inventory.form,
      source_fingerprint: inventory.sourceFingerprint,
      rows: Object.freeze(validatedRows),
    }),
  };
}

export function validateStoredOwnershipContextEnvelope(input: Readonly<{
  value: unknown;
  rowRef: string;
  inventory: OwnershipContextReferenceInventory;
}>):
  | Readonly<{ ok: true; value: StoredOwnershipContextEnvelope }>
  | Readonly<{ ok: false; stale: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  const envelope = strictRecord(input.value, "context_facts", [
    "version", "source_fingerprint", "assertions", "ai_refs",
  ], errors);
  if (!envelope) return { ok: false, stale: false, errors };
  const stale = envelope.source_fingerprint !== input.inventory.sourceFingerprint;
  if (stale) errors.push("context_facts.source_fingerprint is stale");
  const candidate = {
    version: envelope.version,
    event_ref: input.inventory.eventRef,
    form: input.inventory.form,
    source_fingerprint: envelope.source_fingerprint,
    rows: [{ row_ref: input.rowRef, assertions: envelope.assertions }],
  };
  const validated = validateOwnershipContextCandidate(candidate, input.inventory);
  if (!validated.ok) errors.push(...validated.errors);
  let aiRefs: OwnershipContextAiRefs | undefined;
  if (Object.hasOwn(envelope, "ai_refs")) {
    const refs = strictRecord(envelope.ai_refs, "context_facts.ai_refs", ["run_id", "output_id"], errors);
    const runId = refs ? nonEmptyString(refs.run_id) : null;
    const outputId = refs ? nonEmptyString(refs.output_id) : null;
    if (!runId || !outputId || !UUID_PATTERN.test(runId) || !UUID_PATTERN.test(outputId)) {
      errors.push("context_facts.ai_refs must contain UUID run_id and output_id");
    } else {
      aiRefs = Object.freeze({ run_id: runId.toLowerCase(), output_id: outputId.toLowerCase() });
    }
  }
  if (!validated.ok || errors.length > 0) return { ok: false, stale, errors: Object.freeze(errors) };
  return {
    ok: true,
    value: Object.freeze({
      version: OWNERSHIP_CONTEXT_VERSION,
      source_fingerprint: input.inventory.sourceFingerprint,
      assertions: validated.value.rows[0].assertions,
      ...(aiRefs ? { ai_refs: aiRefs } : {}),
    }),
  };
}

export function isOwnershipContextSourceFingerprint(value: unknown): value is string {
  return typeof value === "string" && SOURCE_FINGERPRINT_PATTERN.test(value);
}

function validateAssertionMeaning(input: {
  assertion: Record<string, unknown>;
  fact: OwnershipContextFact;
  status: OwnershipContextStatus;
  ownerRef: string | null;
  securityRef: string | null;
  referenceRow: OwnershipContextReferenceRow;
  inventory: OwnershipContextReferenceInventory;
  allOwnerRefs: Set<string>;
  allSecurityRefs: Set<string>;
  path: string;
  errors: string[];
}) {
  const { assertion, fact, status, ownerRef, securityRef, referenceRow, inventory, path, errors } = input;
  const value = assertion.value;
  const supported = status === "supported";
  if (supported && !Object.hasOwn(assertion, "value")) errors.push(`${path}.value is required for supported ${fact}`);

  if (fact === "owner_attribution") {
    disallowSubjectRefs(ownerRef, securityRef, path, errors);
    if (supported && (typeof value !== "string" || !referenceRow.ownerRefs.includes(value))) {
      errors.push(`${path}.value must reference an owner on the same row`);
    }
    return;
  }
  if (fact === "ownership_relation") {
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && value !== "direct" && value !== "indirect") errors.push(`${path}.value is invalid`);
    if (supported && referenceRow.direct.directOrIndirectOwnership === "D" && value === "indirect") {
      errors.push(`${path}.value conflicts with XML direct ownership`);
    }
    if (supported && referenceRow.direct.directOrIndirectOwnership === "I" && value === "direct") {
      errors.push(`${path}.value conflicts with XML indirect ownership`);
    }
    return;
  }
  if (fact === "economic_direction") {
    if (ownerRef) errors.push(`${path}.owner_ref is not allowed for economic_direction`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && (typeof value !== "string" || !["buy", "sell", "other"].includes(value))) errors.push(`${path}.value is invalid`);
    if (supported && referenceRow.direct.acquiredDisposedCode === "A" && value === "sell") {
      errors.push(`${path}.value conflicts with XML acquisition code`);
    }
    if (supported && referenceRow.direct.acquiredDisposedCode === "D" && value === "buy") {
      errors.push(`${path}.value conflicts with XML disposition code`);
    }
    return;
  }
  if (fact === "derivative_underlying_relation") {
    if (ownerRef) errors.push(`${path}.owner_ref is not allowed for derivative_underlying_relation`);
    if (!securityRef || securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must reference the row security`);
    if (supported && (referenceRow.direct.transactionKind !== "derivative"
      || typeof value !== "string"
      || !input.allSecurityRefs.has(value)
      || !referenceRow.direct.allowedUnderlyingSecurityRefs.includes(value))) {
      errors.push(`${path}.value must reference the parser-identified underlying security`);
    }
    return;
  }
  if (fact === "rule_10b5_1_applicability") {
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && typeof value !== "boolean") errors.push(`${path}.value must be boolean`);
    if (supported && referenceRow.direct.is10b51 !== null && value !== referenceRow.direct.is10b51) {
      errors.push(`${path}.value conflicts with the XML/parser direct value`);
    }
    return;
  }
  if (fact === "footnote_scope") {
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && (typeof value !== "string" || !["row", "owner", "security", "filing"].includes(value))) errors.push(`${path}.value is invalid`);
    if (supported && value === "owner" && !ownerRef) errors.push(`${path}.owner scope requires owner_ref`);
    if (supported && value === "security" && !securityRef) errors.push(`${path}.security scope requires security_ref`);
    return;
  }
  if (ownerRef || securityRef) errors.push(`${path} does not allow owner_ref or security_ref`);
  if (supported && (typeof value !== "string" || !["adds", "modifies", "removes", "restates", "no_change"].includes(value))) {
    errors.push(`${path}.value is invalid`);
  }
  if (supported && !inventory.isAmendment) errors.push(`${path} cannot be supported for a non-amendment form`);
}

function disallowSubjectRefs(ownerRef: string | null, securityRef: string | null, path: string, errors: string[]) {
  if (ownerRef || securityRef) errors.push(`${path} does not allow owner_ref or security_ref`);
}

function strictRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[] | Set<string>,
  errors: string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const row = value as Record<string, unknown>;
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
  const extra = Object.keys(row).filter((key) => !allowed.has(key));
  if (extra.length > 0) errors.push(`${path} contains unknown keys: ${extra.join(", ")}`);
  return row;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function optionalString(value: unknown) {
  return value === undefined ? null : nonEmptyString(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strictStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
