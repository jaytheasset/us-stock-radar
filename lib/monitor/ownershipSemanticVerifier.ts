import type {
  OwnershipContextAssertion,
  OwnershipContextReferenceInventory,
  ValidatedOwnershipContextBundle,
} from "./ownershipStructuredContext.ts";

export const OWNERSHIP_SEMANTIC_VERIFIER_PURPOSE = "ownership_semantic_verifier" as const;
export const OWNERSHIP_SEMANTIC_VERIFIER_VERSION = "ownership_semantic_verifier_v1" as const;

export const OWNERSHIP_SEMANTIC_VERIFIER_VERDICTS = [
  "supported",
  "contradicted",
  "insufficient",
] as const;

export type OwnershipSemanticVerifierVerdict = typeof OWNERSHIP_SEMANTIC_VERIFIER_VERDICTS[number];

export type OwnershipSemanticVerifierInput = Readonly<{
  version: typeof OWNERSHIP_SEMANTIC_VERIFIER_VERSION;
  form: "form4" | "form144";
  row_ref: string;
  candidate_fact: string;
  subject_refs: Readonly<{
    owner_ref?: string;
    security_ref?: string;
    footnote_ref?: string;
  }>;
  neutral_bindings: Readonly<{
    owner?: Readonly<{ owner_ref: string; xml_name: string; xml_cik: string | null }>;
    row_security?: Readonly<{ security_ref: string; xml_title: string | null }>;
    target_security?: Readonly<{ security_ref: string; xml_title: string | null }>;
  }>;
  asserted_value: string | boolean;
  evidence: readonly Readonly<{
    evidence_ref: string;
    exact_sec_evidence: Readonly<{
      row_xml: string;
      footnote_xml: string | null;
    }>;
  }>[];
  row_neutral_xml: string;
}>;

export type OwnershipSemanticVerifierOutput = Readonly<{
  verdict: OwnershipSemanticVerifierVerdict;
  evidence_refs: readonly string[];
  short_reason: string;
}>;

export type OwnershipSemanticVerifierRequest = Readonly<{
  input: OwnershipSemanticVerifierInput;
  output_contract: typeof OWNERSHIP_SEMANTIC_VERIFIER_OUTPUT_CONTRACT;
}>;

export type OwnershipSemanticVerifier = Readonly<{
  name: string;
  verify(request: OwnershipSemanticVerifierRequest): Promise<unknown>;
}>;

export type OwnershipSemanticVerificationRecord = Readonly<{
  input: OwnershipSemanticVerifierInput;
  raw_output: unknown;
  parsed_output: OwnershipSemanticVerifierOutput | null;
  eligibility: "eligible" | "ineligible";
  reason: string;
}>;

export type OwnershipSemanticVerificationResult = Readonly<{
  effectiveCandidate: ValidatedOwnershipContextBundle;
  records: readonly OwnershipSemanticVerificationRecord[];
  targetCount: number;
  eligibleCount: number;
  ineligibleCount: number;
}>;

export const OWNERSHIP_SEMANTIC_VERIFIER_OUTPUT_CONTRACT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "evidence_refs", "short_reason"],
  properties: {
    verdict: { type: "string", enum: [...OWNERSHIP_SEMANTIC_VERIFIER_VERDICTS] },
    evidence_refs: { type: "array", items: { type: "string" }, uniqueItems: true },
    short_reason: { type: "string", minLength: 1, maxLength: 280 },
  },
} as const);

const TARGET_FACTS = new Set([
  "ownership_relation",
  "derivative_underlying_relation",
  "rule_10b5_1_applicability",
  "footnote_scope",
  "amendment_effect",
]);

export async function verifyOwnershipSemanticAssertions(input: Readonly<{
  candidate: ValidatedOwnershipContextBundle;
  inventory: OwnershipContextReferenceInventory;
  sourceXml: string;
  verifier?: OwnershipSemanticVerifier;
}>): Promise<OwnershipSemanticVerificationResult> {
  const records: OwnershipSemanticVerificationRecord[] = [];
  const effectiveRows = [] as Array<{
    row_ref: string;
    assertions: OwnershipContextAssertion[];
  }>;

  for (const candidateRow of input.candidate.rows) {
    const referenceRow = input.inventory.rows.find((row) => row.rowRef === candidateRow.row_ref);
    if (!referenceRow) throw new Error("ownership_semantic_verifier_row_reference_missing");
    const assertions: OwnershipContextAssertion[] = [];
    for (const assertion of candidateRow.assertions) {
      if (!requiresOwnershipSemanticVerification(assertion, referenceRow.ownerRefs.length)) {
        assertions.push(assertion);
        continue;
      }
      const verifierInput = buildOwnershipSemanticVerifierInput({
        form: input.inventory.form,
        sourceXml: input.sourceXml,
        inventory: input.inventory,
        rowRef: candidateRow.row_ref,
        assertion,
      });
      if (!input.verifier) {
        records.push(Object.freeze({
          input: verifierInput,
          raw_output: null,
          parsed_output: null,
          eligibility: "ineligible",
          reason: "ownership_semantic_verifier_unconfigured",
        }));
        continue;
      }
      let rawOutput: unknown = null;
      try {
        rawOutput = await input.verifier.verify({
          input: verifierInput,
          output_contract: OWNERSHIP_SEMANTIC_VERIFIER_OUTPUT_CONTRACT,
        });
      } catch {
        records.push(Object.freeze({
          input: verifierInput,
          raw_output: null,
          parsed_output: null,
          eligibility: "ineligible",
          reason: "ownership_semantic_verifier_failed",
        }));
        continue;
      }
      const parsed = validateOwnershipSemanticVerifierOutput(rawOutput, verifierInput);
      if (!parsed.ok) {
        records.push(Object.freeze({
          input: verifierInput,
          raw_output: structuredClone(rawOutput),
          parsed_output: null,
          eligibility: "ineligible",
          reason: parsed.reason,
        }));
        continue;
      }
      const eligible = parsed.value.verdict === "supported";
      records.push(Object.freeze({
        input: verifierInput,
        raw_output: structuredClone(rawOutput),
        parsed_output: parsed.value,
        eligibility: eligible ? "eligible" : "ineligible",
        reason: `ownership_semantic_verifier_${parsed.value.verdict}`,
      }));
      if (eligible) assertions.push(assertion);
    }
    effectiveRows.push({ row_ref: candidateRow.row_ref, assertions });
  }

  const eligibleCount = records.filter((record) => record.eligibility === "eligible").length;
  return Object.freeze({
    effectiveCandidate: Object.freeze({
      ...input.candidate,
      rows: Object.freeze(effectiveRows.map((row) => Object.freeze({
        row_ref: row.row_ref,
        assertions: Object.freeze([...row.assertions]),
      }))),
    }),
    records: Object.freeze(records),
    targetCount: records.length,
    eligibleCount,
    ineligibleCount: records.length - eligibleCount,
  });
}

export function requiresOwnershipSemanticVerification(
  assertion: OwnershipContextAssertion,
  rowOwnerCount: number,
) {
  if (assertion.status !== "supported") return false;
  if (assertion.fact === "owner_attribution") return rowOwnerCount > 1;
  return TARGET_FACTS.has(assertion.fact);
}

export function buildOwnershipSemanticVerifierInput(input: Readonly<{
  form: "form4" | "form144";
  sourceXml: string;
  inventory: OwnershipContextReferenceInventory;
  rowRef: string;
  assertion: OwnershipContextAssertion;
}>): OwnershipSemanticVerifierInput {
  if (input.assertion.status !== "supported" || input.assertion.value === undefined) {
    throw new Error("ownership_semantic_verifier_supported_assertion_required");
  }
  const rowIndex = input.inventory.rows.findIndex((row) => row.rowRef === input.rowRef);
  const referenceRow = input.inventory.rows[rowIndex];
  if (rowIndex < 0 || !referenceRow) throw new Error("ownership_semantic_verifier_row_reference_missing");
  if (input.assertion.evidence_refs.length === 0
    || input.assertion.evidence_refs.some((ref) => !referenceRow.evidenceRefs.includes(ref))) {
    throw new Error("ownership_semantic_verifier_evidence_reference_invalid");
  }
  const selectedOwnerRef = input.assertion.owner_ref
    ?? (input.assertion.fact === "owner_attribution" && typeof input.assertion.value === "string"
      ? input.assertion.value
      : null);
  if (selectedOwnerRef && !referenceRow.ownerRefs.includes(selectedOwnerRef)) {
    throw new Error("ownership_semantic_verifier_owner_reference_invalid");
  }
  if (input.assertion.security_ref && input.assertion.security_ref !== referenceRow.securityRef) {
    throw new Error("ownership_semantic_verifier_security_reference_invalid");
  }
  if (input.assertion.footnote_ref && !referenceRow.linkedFootnoteRefs.includes(input.assertion.footnote_ref)) {
    throw new Error("ownership_semantic_verifier_footnote_reference_invalid");
  }
  if (input.assertion.fact === "derivative_underlying_relation"
    && (typeof input.assertion.value !== "string"
      || !referenceRow.underlyingSecurityRefs.includes(input.assertion.value))) {
    throw new Error("ownership_semantic_verifier_target_security_reference_invalid");
  }
  const rowXml = readSourceRowBlocks(input.sourceXml, input.form)[rowIndex];
  if (!rowXml) throw new Error("ownership_semantic_verifier_row_xml_missing");
  const footnoteXml = input.assertion.footnote_ref
    ? readSourceFootnoteBlocks(input.sourceXml).get(input.assertion.footnote_ref) ?? null
    : null;
  if (input.assertion.footnote_ref && !footnoteXml) {
    throw new Error("ownership_semantic_verifier_footnote_xml_missing");
  }
  const ownerBinding = selectedOwnerRef
    ? readOwnerBinding(input.sourceXml, input.form, referenceRow.ownerRefs, selectedOwnerRef)
    : null;
  const rowSecurityBinding = input.assertion.security_ref
    ? { security_ref: input.assertion.security_ref, xml_title: readXmlValue(rowXml, "securityTitle") }
    : null;
  const targetSecurityBinding = typeof input.assertion.value === "string"
      && input.assertion.value.startsWith("security:")
    ? {
        security_ref: input.assertion.value,
        xml_title: input.assertion.fact === "derivative_underlying_relation"
          ? readXmlValue(rowXml, "underlyingSecurityTitle")
          : null,
      }
    : null;
  return Object.freeze({
    version: OWNERSHIP_SEMANTIC_VERIFIER_VERSION,
    form: input.form,
    row_ref: input.rowRef,
    candidate_fact: input.assertion.fact,
    subject_refs: Object.freeze({
      ...(input.assertion.owner_ref ? { owner_ref: input.assertion.owner_ref } : {}),
      ...(input.assertion.security_ref ? { security_ref: input.assertion.security_ref } : {}),
      ...(input.assertion.footnote_ref ? { footnote_ref: input.assertion.footnote_ref } : {}),
    }),
    neutral_bindings: Object.freeze({
      ...(ownerBinding ? { owner: Object.freeze(ownerBinding) } : {}),
      ...(rowSecurityBinding ? { row_security: Object.freeze(rowSecurityBinding) } : {}),
      ...(targetSecurityBinding ? { target_security: Object.freeze(targetSecurityBinding) } : {}),
    }),
    asserted_value: input.assertion.value,
    evidence: Object.freeze(input.assertion.evidence_refs.map((evidenceRef) => Object.freeze({
      evidence_ref: evidenceRef,
      exact_sec_evidence: Object.freeze({ row_xml: rowXml, footnote_xml: footnoteXml }),
    }))),
    row_neutral_xml: rowXml,
  });
}

export function validateOwnershipSemanticVerifierOutput(
  value: unknown,
  input: OwnershipSemanticVerifierInput,
): { ok: true; value: OwnershipSemanticVerifierOutput } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "ownership_semantic_verifier_output_invalid" };
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("|") !== "evidence_refs|short_reason|verdict") {
    return { ok: false, reason: "ownership_semantic_verifier_output_invalid" };
  }
  if (typeof row.verdict !== "string"
    || !OWNERSHIP_SEMANTIC_VERIFIER_VERDICTS.includes(row.verdict as OwnershipSemanticVerifierVerdict)) {
    return { ok: false, reason: "ownership_semantic_verifier_verdict_invalid" };
  }
  const allowedEvidence = new Set(input.evidence.map((item) => item.evidence_ref));
  if (!Array.isArray(row.evidence_refs)
    || row.evidence_refs.some((ref) => typeof ref !== "string" || !allowedEvidence.has(ref))
    || new Set(row.evidence_refs).size !== row.evidence_refs.length
    || ((row.verdict === "supported" || row.verdict === "contradicted") && row.evidence_refs.length === 0)) {
    return { ok: false, reason: "ownership_semantic_verifier_evidence_invalid" };
  }
  if (typeof row.short_reason !== "string"
    || !row.short_reason.trim()
    || row.short_reason !== row.short_reason.trim()
    || row.short_reason.length > 280) {
    return { ok: false, reason: "ownership_semantic_verifier_reason_invalid" };
  }
  return {
    ok: true,
    value: Object.freeze({
      verdict: row.verdict as OwnershipSemanticVerifierVerdict,
      evidence_refs: Object.freeze([...(row.evidence_refs as string[])]),
      short_reason: row.short_reason,
    }),
  };
}

function readSourceRowBlocks(xml: string, form: "form4" | "form144") {
  const blocks = (localName: string) => {
    const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
    return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi")))
      .map((match) => match[0] || "");
  };
  return form === "form144"
    ? blocks("securitiesInformation")
    : [...blocks("nonDerivativeTransaction"), ...blocks("derivativeTransaction")];
}

function readSourceFootnoteBlocks(xml: string) {
  const blocks = new Map<string, string>();
  const tag = "(?:[A-Za-z_][\\w.-]*:)?footnote";
  for (const match of xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>[\\s\\S]*?<\\/${tag}>`, "gi"))) {
    const id = match[1]?.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id) blocks.set(`footnote:${id}`, match[0] || "");
  }
  return blocks;
}

function readOwnerBinding(
  xml: string,
  form: "form4" | "form144",
  ownerRefs: readonly string[],
  ownerRef: string,
) {
  const ownerIndex = ownerRefs.indexOf(ownerRef);
  if (ownerIndex < 0) throw new Error("ownership_semantic_verifier_owner_reference_invalid");
  if (form === "form144") {
    const name = readXmlValues(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold")[ownerIndex];
    if (!name) throw new Error("ownership_semantic_verifier_owner_xml_missing");
    return { owner_ref: ownerRef, xml_name: name, xml_cik: null };
  }
  const ownerTag = "(?:[A-Za-z_][\\w.-]*:)?reportingOwner";
  const ownerBlocks = Array.from(xml.matchAll(new RegExp(`<${ownerTag}\\b[^>]*>([\\s\\S]*?)<\\/${ownerTag}>`, "gi")));
  const block = ownerBlocks[ownerIndex]?.[1] || "";
  const name = readXmlValue(block, "rptOwnerName");
  if (!name) throw new Error("ownership_semantic_verifier_owner_xml_missing");
  return { owner_ref: ownerRef, xml_name: name, xml_cik: readXmlValue(block, "rptOwnerCik") };
}

function readXmlValues(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>\\s*(?:<(?:[A-Za-z_][\\w.-]*:)?value\\b[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/(?:[A-Za-z_][\\w.-]*:)?value>)?\\s*<\\/${tag}>`, "gi")))
    .map((match) => decodeXml((match[1] || "").trim()))
    .filter(Boolean);
}

function readXmlValue(xml: string, localName: string) {
  return readXmlValues(xml, localName)[0] ?? null;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
