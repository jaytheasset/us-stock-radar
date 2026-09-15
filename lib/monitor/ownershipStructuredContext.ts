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
  footnote_ref?: string;
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

export type OwnershipContextFootnoteReference = Readonly<{
  footnoteRef: string;
  xmlId: string;
  text: string;
}>;

export type OwnershipContextReferenceRow = Readonly<{
  rowRef: string;
  ownerNames: readonly string[];
  ownerRefs: readonly string[];
  securityTitle: string | null;
  securityRef: string | null;
  underlyingSecurityRefs: readonly string[];
  evidenceRefs: readonly string[];
  linkedFootnoteRefs: readonly string[];
  direct: DirectConflictFacts;
}>;

export type OwnershipContextReferenceInventory = Readonly<{
  version: typeof OWNERSHIP_CONTEXT_VERSION;
  eventRef: string;
  form: OwnershipContextForm;
  isAmendment: boolean;
  sourceFingerprint: string;
  filingRule10b51: boolean | null;
  footnotes: readonly OwnershipContextFootnoteReference[];
  rows: readonly OwnershipContextReferenceRow[];
}>;

export type OwnershipContextValidationResult =
  | Readonly<{ ok: true; value: ValidatedOwnershipContextBundle }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_FINGERPRINT_PATTERN = /^ownership-context-v1:[0-9a-f]{64}$/;
const ASSERTION_KEYS = new Set([
  "fact", "status", "value", "owner_ref", "security_ref", "footnote_ref", "evidence_refs",
]);
const MAX_ASSERTIONS_PER_ROW = 32;

export function buildOwnershipContextReferenceInventory(input: Readonly<{
  eventId: string;
  form: OwnershipContextForm;
  isAmendment: boolean;
  sourceFingerprint: string;
  rows: readonly Record<string, unknown>[];
  sourceXml?: string;
}>): OwnershipContextReferenceInventory {
  if (!UUID_PATTERN.test(input.eventId)) throw new Error("Ownership context eventId must be a UUID");
  if (!isOwnershipContextSourceFingerprint(input.sourceFingerprint)) {
    throw new Error("Ownership context source fingerprint is invalid");
  }
  const indexColumn = input.form === "form4" ? "transaction_index" : "proposed_sale_index";
  const securityTitles = input.rows.map((row) => nonEmptyString(row.security_title));
  const securityRefs = securityTitles.map((title, position) => title ? `security:${input.form}:${position}` : null);
  const footnotes = readSourceFootnotes(input.sourceXml ?? "");
  const sourceFootnoteRefs = new Set(footnotes.map((footnote) => footnote.footnoteRef));
  const sourceRowBlocks = input.sourceXml ? readSourceRowBlocks(input.sourceXml, input.form) : [];
  return Object.freeze({
    version: OWNERSHIP_CONTEXT_VERSION,
    eventRef: `event:${input.eventId.toLowerCase()}`,
    form: input.form,
    isAmendment: input.isAmendment,
    sourceFingerprint: input.sourceFingerprint,
    filingRule10b51: readFilingRule10b51(input.sourceXml ?? ""),
    footnotes,
    rows: Object.freeze(input.rows.map((row, position) => {
      const index = row[indexColumn];
      if (index !== position) throw new Error("Ownership context rows must use contiguous canonical indexes");
      const prefix = `${input.form}:${position}`;
      const owners = strictStringArray(row.reporting_owner_names);
      const evidence = strictStringArray(row.evidence);
      const sourceRowBlock = sourceRowBlocks.length === input.rows.length ? sourceRowBlocks[position] : "";
      const xmlLinkedFootnoteIds = readRowFootnoteIds(sourceRowBlock);
      const linkedFootnoteRefs = strictStringArray(record(row.calculation_basis).footnote_ids)
        .filter((xmlId) => xmlLinkedFootnoteIds.includes(xmlId))
        .map((xmlId) => `footnote:${xmlId}`)
        .filter((ref) => sourceFootnoteRefs.has(ref));
      const underlyingTitle = nonEmptyString(record(row.calculation_basis).underlying_security_title);
      const xmlUnderlyingTitle = firstXmlElementText(sourceRowBlock, "underlyingSecurityTitle");
      const underlyingSecurityRefs = input.form === "form4" && underlyingTitle && xmlUnderlyingTitle === underlyingTitle
        ? [`security:form4:underlying:${position}`]
        : [];
      return Object.freeze({
        rowRef: `row:${prefix}`,
        ownerNames: Object.freeze([...owners]),
        ownerRefs: Object.freeze(owners.map((_owner, ownerIndex) => `owner:${prefix}:${ownerIndex}`)),
        securityTitle: securityTitles[position],
        securityRef: securityRefs[position],
        underlyingSecurityRefs: Object.freeze(underlyingSecurityRefs),
        evidenceRefs: Object.freeze(evidence.map((_item, evidenceIndex) => `evidence:${prefix}:${evidenceIndex}`)),
        linkedFootnoteRefs: Object.freeze(linkedFootnoteRefs),
        direct: Object.freeze({
          transactionKind: nonEmptyString(row.transaction_kind),
          acquiredDisposedCode: nonEmptyString(row.acquired_disposed_code),
          directOrIndirectOwnership: nonEmptyString(row.direct_or_indirect_ownership),
          is10b51: typeof row.is_10b5_1 === "boolean" ? row.is_10b5_1 : null,
          allowedUnderlyingSecurityRefs: Object.freeze(underlyingSecurityRefs),
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
  if (!Array.isArray(root.rows) || root.rows.length > 1000) {
    errors.push("ownership_context.rows must be an array with at most 1000 rows");
    return { ok: false, errors };
  }

  const rowByRef = new Map(inventory.rows.map((row) => [row.rowRef, row]));
  const allOwnerRefs = new Set(inventory.rows.flatMap((row) => row.ownerRefs));
  const allSecurityRefs = new Set(inventory.rows.flatMap((row) => [
    ...(row.securityRef ? [row.securityRef] : []),
    ...row.underlyingSecurityRefs,
  ]));
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
    if (!Array.isArray(row.assertions) || row.assertions.length > MAX_ASSERTIONS_PER_ROW) {
      errors.push(`${path}.assertions must be an array with at most ${MAX_ASSERTIONS_PER_ROW} items`);
      return;
    }
    const seenAssertions = new Set<string>();
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
      const evidenceRefs = strictStringArray(assertion.evidence_refs);
      if (!Array.isArray(assertion.evidence_refs) || evidenceRefs.length !== assertion.evidence_refs.length) {
        errors.push(`${assertionPath}.evidence_refs must contain only non-empty reference strings`);
      }
      if (evidenceRefs.some((ref) => !allEvidenceRefs.has(ref))) {
        errors.push(`${assertionPath}.evidence_refs contains a forged or missing reference`);
      }
      if (evidenceRefs.some((ref) => !referenceRow.evidenceRefs.includes(ref))) {
        errors.push(`${assertionPath}.evidence_refs must belong to the same row`);
      }
      if (status === "supported" && evidenceRefs.length === 0) {
        errors.push(`${assertionPath} supported assertions require evidence`);
      }
      const ownerRef = optionalString(assertion.owner_ref);
      const securityRef = optionalString(assertion.security_ref);
      const footnoteRef = optionalString(assertion.footnote_ref);
      if (Object.hasOwn(assertion, "owner_ref") && !ownerRef) errors.push(`${assertionPath}.owner_ref must be a non-empty reference string`);
      if (Object.hasOwn(assertion, "security_ref") && !securityRef) errors.push(`${assertionPath}.security_ref must be a non-empty reference string`);
      if (Object.hasOwn(assertion, "footnote_ref") && !footnoteRef) errors.push(`${assertionPath}.footnote_ref must be a non-empty reference string`);
      if (ownerRef && !allOwnerRefs.has(ownerRef)) errors.push(`${assertionPath}.owner_ref is forged or missing`);
      if (securityRef && !allSecurityRefs.has(securityRef)) errors.push(`${assertionPath}.security_ref is forged or missing`);
      if (footnoteRef && !inventory.footnotes.some((footnote) => footnote.footnoteRef === footnoteRef)) {
        errors.push(`${assertionPath}.footnote_ref is forged or missing`);
      }
      const assertionIdentity = fact === "ownership_relation"
        ? `${fact}:${ownerRef ?? ""}`
        : fact === "footnote_scope"
          ? `${fact}:${footnoteRef ?? ""}:${ownerRef ?? ""}:${securityRef ?? ""}`
          : fact;
      if (seenAssertions.has(assertionIdentity)) errors.push(`${assertionPath}.fact is duplicated for the same subject`);
      seenAssertions.add(assertionIdentity);
      if (status !== "supported" && Object.hasOwn(assertion, "value")) {
        errors.push(`${assertionPath}.value is allowed only for supported assertions`);
      }
      validateAssertionMeaning({
        assertion, fact, status, ownerRef, securityRef, footnoteRef, referenceRow, inventory,
        allOwnerRefs, allSecurityRefs, path: assertionPath, errors,
      });
      assertions.push(Object.freeze({
        fact,
        status,
        ...(Object.hasOwn(assertion, "value") ? { value: assertion.value as OwnershipContextValue } : {}),
        ...(ownerRef ? { owner_ref: ownerRef } : {}),
        ...(securityRef ? { security_ref: securityRef } : {}),
        ...(footnoteRef ? { footnote_ref: footnoteRef } : {}),
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
  footnoteRef: string | null;
  referenceRow: OwnershipContextReferenceRow;
  inventory: OwnershipContextReferenceInventory;
  allOwnerRefs: Set<string>;
  allSecurityRefs: Set<string>;
  path: string;
  errors: string[];
}) {
  const { assertion, fact, status, ownerRef, securityRef, footnoteRef, referenceRow, inventory, path, errors } = input;
  const value = assertion.value;
  const supported = status === "supported";
  if (supported && !Object.hasOwn(assertion, "value")) errors.push(`${path}.value is required for supported ${fact}`);

  if (fact === "owner_attribution") {
    disallowSubjectRefs(ownerRef, securityRef, footnoteRef, path, errors);
    if (supported && (typeof value !== "string" || !referenceRow.ownerRefs.includes(value))) {
      errors.push(`${path}.value must reference an owner on the same row`);
    }
    return;
  }
  if (fact === "ownership_relation") {
    if (inventory.form !== "form4") errors.push(`${path} is not applicable to Form 144`);
    if (footnoteRef && !referenceRow.linkedFootnoteRefs.includes(footnoteRef)) {
      errors.push(`${path}.footnote_ref must be linked to the same row`);
    }
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && value !== "direct" && value !== "indirect") errors.push(`${path}.value is invalid`);
    if (supported && !ownerRef) errors.push(`${path}.owner_ref is required for supported ownership_relation`);
    if (supported && ownerRef && referenceRow.ownerRefs.length === 1) {
      if (referenceRow.direct.directOrIndirectOwnership === "D" && value === "indirect") {
        errors.push(`${path}.value conflicts with XML direct ownership`);
      }
      if (referenceRow.direct.directOrIndirectOwnership === "I" && value === "direct") {
        errors.push(`${path}.value conflicts with XML indirect ownership`);
      }
      if (!referenceRow.direct.directOrIndirectOwnership) {
        errors.push(`${path}.value lacks an XML direct/indirect value`);
      }
    }
    if (supported && ownerRef && referenceRow.ownerRefs.length > 1) {
      if (!footnoteRef) {
        errors.push(`${path}.footnote_ref is required for a multi-owner relation`);
      } else if (!ownerRelationSupportedByFootnote({
        ownerRef,
        relation: value,
        footnoteRef,
        referenceRow,
        inventory,
      })) {
        errors.push(`${path}.value is not established for that owner by the linked footnote`);
      }
    }
    return;
  }
  if (fact === "economic_direction") {
    if (footnoteRef) errors.push(`${path}.footnote_ref is not allowed for economic_direction`);
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
    if (footnoteRef && !referenceRow.linkedFootnoteRefs.includes(footnoteRef)) {
      errors.push(`${path}.footnote_ref must be linked to the same row`);
    }
    if (ownerRef) errors.push(`${path}.owner_ref is not allowed for derivative_underlying_relation`);
    if (!securityRef || securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must reference the row security`);
    if (supported && (referenceRow.direct.transactionKind !== "derivative"
      || typeof value !== "string"
      || !input.allSecurityRefs.has(value)
      || value === securityRef
      || !referenceRow.direct.allowedUnderlyingSecurityRefs.includes(value))) {
      errors.push(`${path}.value must reference the parser-identified underlying security`);
    }
    return;
  }
  if (fact === "rule_10b5_1_applicability") {
    if (inventory.form !== "form4") errors.push(`${path} is not applicable to Form 144`);
    if (footnoteRef && !referenceRow.linkedFootnoteRefs.includes(footnoteRef)) {
      errors.push(`${path}.footnote_ref must be linked to the same row`);
    }
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && typeof value !== "boolean") errors.push(`${path}.value must be boolean`);
    if (supported && referenceRow.direct.is10b51 !== null && value !== referenceRow.direct.is10b51) {
      errors.push(`${path}.value conflicts with the XML/parser direct value`);
    }
    if (supported && inventory.filingRule10b51 !== null && value !== inventory.filingRule10b51) {
      errors.push(`${path}.value conflicts with the XML filing value`);
    }
    if (supported && value === false && referenceRow.direct.is10b51 === null && inventory.filingRule10b51 !== false) {
      errors.push(`${path}.false lacks an explicit XML value`);
    }
    if (supported && value === true && (!footnoteRef || !footnoteMentions10b51(footnoteRef, inventory))) {
      errors.push(`${path}.true requires a linked footnote that explicitly mentions Rule 10b5-1`);
    }
    if (supported && value === true && footnoteRef && ownerRef
      && !footnoteMentionsOwner(footnoteRef, ownerRef, referenceRow, inventory)) {
      errors.push(`${path}.owner_ref is not established by the linked Rule 10b5-1 footnote`);
    }
    return;
  }
  if (fact === "footnote_scope") {
    if (!footnoteRef) errors.push(`${path}.footnote_ref is required for footnote_scope`);
    if (footnoteRef && !referenceRow.linkedFootnoteRefs.includes(footnoteRef)) {
      errors.push(`${path}.footnote_ref must be linked to the same row`);
    }
    if (ownerRef && !referenceRow.ownerRefs.includes(ownerRef)) errors.push(`${path}.owner_ref must belong to the same row`);
    if (securityRef && securityRef !== referenceRow.securityRef) errors.push(`${path}.security_ref must belong to the same row`);
    if (supported && (typeof value !== "string" || !["row", "owner", "security", "filing"].includes(value))) errors.push(`${path}.value is invalid`);
    if (supported && value === "owner" && !ownerRef) errors.push(`${path}.owner scope requires owner_ref`);
    if (supported && value === "security" && !securityRef) errors.push(`${path}.security scope requires security_ref`);
    if (supported && value === "owner" && ownerRef && footnoteRef
      && !footnoteMentionsOwner(footnoteRef, ownerRef, referenceRow, inventory)) {
      errors.push(`${path}.owner scope is not established for that owner by the linked footnote`);
    }
    if (supported && value === "security" && footnoteRef
      && !footnoteMentionsSecurity(footnoteRef, referenceRow, inventory)) {
      errors.push(`${path}.security scope is not established for the row security by the linked footnote`);
    }
    return;
  }
  if (ownerRef || securityRef || footnoteRef) errors.push(`${path} does not allow subject or footnote references`);
  if (supported && (typeof value !== "string" || !["adds", "modifies", "removes", "restates", "no_change"].includes(value))) {
    errors.push(`${path}.value is invalid`);
  }
  if (supported && !inventory.isAmendment) errors.push(`${path} cannot be supported for a non-amendment form`);
}

function disallowSubjectRefs(
  ownerRef: string | null,
  securityRef: string | null,
  footnoteRef: string | null,
  path: string,
  errors: string[],
) {
  if (ownerRef || securityRef || footnoteRef) errors.push(`${path} does not allow subject or footnote references`);
}

function ownerRelationSupportedByFootnote(input: Readonly<{
  ownerRef: string;
  relation: unknown;
  footnoteRef: string;
  referenceRow: OwnershipContextReferenceRow;
  inventory: OwnershipContextReferenceInventory;
}>) {
  if (input.relation !== "direct" && input.relation !== "indirect") return false;
  const ownerIndex = input.referenceRow.ownerRefs.indexOf(input.ownerRef);
  const ownerName = input.referenceRow.ownerNames[ownerIndex];
  const footnote = input.inventory.footnotes.find((item) => item.footnoteRef === input.footnoteRef);
  if (!ownerName || !footnote) return false;
  const aliases = explicitOwnerAliases(ownerName, input.inventory.footnotes.map((item) => item.text));
  return aliases.some((alias) => relationClauseMatchesOwner(footnote.text, alias, input.relation as "direct" | "indirect"));
}

function explicitOwnerAliases(ownerName: string, sourceTexts: readonly string[]) {
  const aliases = new Set([ownerName]);
  const ownerPattern = ownerName
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("[\\s.,-]*");
  if (!ownerPattern) return [...aliases];
  const aliasPattern = new RegExp(`${ownerPattern}[\\s.]*\\(\\s*["']([^"']+)["']\\s*\\)`, "giu");
  for (const text of sourceTexts) {
    for (const match of text.matchAll(aliasPattern)) {
      const alias = nonEmptyString(match[1]);
      if (alias) aliases.add(alias);
    }
  }
  return [...aliases];
}

function relationClauseMatchesOwner(text: string, ownerAlias: string, relation: "direct" | "indirect") {
  const normalizedOwner = normalizeWords(ownerAlias);
  if (!normalizedOwner) return false;
  const ownerPattern = escapeRegExp(normalizedOwner).replace(/\\ /g, "\\s+");
  const relationPattern = new RegExp(`(?:^|\\s)(?:held\\s+)?${relation}ly\\s+by\\s+${ownerPattern}(?:\\s|$)`, "i");
  const opposite = relation === "direct" ? "indirect" : "direct";
  const oppositePattern = new RegExp(`(?:^|\\s)(?:held\\s+)?${opposite}ly\\s+by\\s+${ownerPattern}(?:\\s|$)`, "i");
  for (const clauseText of text.split(/[.;](?=\s|$)/)) {
    const clause = normalizeWords(clauseText);
    if (!clause || !relationPattern.test(clause)) continue;
    relationPattern.lastIndex = 0;
    if (oppositePattern.test(clause)) return false;
    oppositePattern.lastIndex = 0;
    if (/\b(?:not|never|no|without|may|might|could|possibly|apparently|purportedly)\b/i.test(clause)) return false;
    return true;
  }
  return false;
}

function footnoteMentions10b51(footnoteRef: string, inventory: OwnershipContextReferenceInventory) {
  const text = inventory.footnotes.find((item) => item.footnoteRef === footnoteRef)?.text ?? "";
  return text.split(/[.;](?=\s|$)/).some((clauseText) => {
    const clause = normalizeWords(clauseText);
    return /\b(?:pursuant to|under) (?:the )?10b5 1 (?:plan|instruction)\b/i.test(clause)
      && !/\b(?:not|never|no|without|may|might|could|possibly|apparently|purportedly)\b/i.test(clause);
  });
}

function footnoteMentionsOwner(
  footnoteRef: string,
  ownerRef: string,
  referenceRow: OwnershipContextReferenceRow,
  inventory: OwnershipContextReferenceInventory,
) {
  const ownerIndex = referenceRow.ownerRefs.indexOf(ownerRef);
  const ownerName = referenceRow.ownerNames[ownerIndex];
  const footnoteText = inventory.footnotes.find((item) => item.footnoteRef === footnoteRef)?.text;
  if (!ownerName || !footnoteText) return false;
  return explicitOwnerAliases(ownerName, inventory.footnotes.map((item) => item.text))
    .some((alias) => containsWholeNormalizedPhrase(footnoteText, alias));
}

function footnoteMentionsSecurity(
  footnoteRef: string,
  referenceRow: OwnershipContextReferenceRow,
  inventory: OwnershipContextReferenceInventory,
) {
  const footnoteText = inventory.footnotes.find((item) => item.footnoteRef === footnoteRef)?.text;
  return Boolean(referenceRow.securityTitle && footnoteText
    && containsWholeNormalizedPhrase(footnoteText, referenceRow.securityTitle));
}

function containsWholeNormalizedPhrase(text: string, phrase: string) {
  const normalizedText = normalizeWords(text);
  const normalizedPhrase = normalizeWords(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedPhrase).replace(/\\ /g, "\\s+")}(?:\\s|$)`, "i")
    .test(normalizedText);
}

function readFilingRule10b51(xml: string) {
  const match = xml.match(/<(?:[A-Za-z_][\w.-]*:)?aff10b5One\b[^>]*>\s*([01])\s*<\/(?:[A-Za-z_][\w.-]*:)?aff10b5One>/i);
  return match?.[1] === "1" ? true : match?.[1] === "0" ? false : null;
}

function readSourceRowBlocks(xml: string, form: OwnershipContextForm) {
  const blocks = (localName: string) => {
    const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
    return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi")))
      .map((match) => match[0] || "");
  };
  return form === "form144"
    ? blocks("securitiesInformation")
    : [...blocks("nonDerivativeTransaction"), ...blocks("derivativeTransaction")];
}

function readRowFootnoteIds(xmlRow: string) {
  return [...new Set(Array.from(xmlRow.matchAll(/<(?:[A-Za-z_][\w.-]*:)?footnoteId\b[^>]*\bid=["']([^"']+)["']/gi))
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean))];
}

function firstXmlElementText(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const value = xml.match(new RegExp(`<${tag}\\b[^>]*>\\s*(?:<(?:[A-Za-z_][\\w.-]*:)?value\\b[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/(?:[A-Za-z_][\\w.-]*:)?value>)?\\s*<\\/${tag}>`, "i"))?.[1];
  return value ? decodeXml(value.trim()) || null : null;
}

function readSourceFootnotes(xml: string): readonly OwnershipContextFootnoteReference[] {
  const seen = new Set<string>();
  const footnotes: OwnershipContextFootnoteReference[] = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?footnote\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?footnote>/gi)) {
    const xmlId = decodeXml(match[1]).trim();
    const text = decodeXml(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const footnoteRef = `footnote:${xmlId}`;
    if (!xmlId || !text || seen.has(footnoteRef)) continue;
    seen.add(footnoteRef);
    footnotes.push(Object.freeze({ footnoteRef, xmlId, text }));
  }
  return Object.freeze(footnotes);
}

function normalizeWords(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
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
