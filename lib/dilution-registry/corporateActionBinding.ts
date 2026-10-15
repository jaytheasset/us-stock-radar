import { validateCorporateActionEvidenceIdentity, type CorporateActionEvidenceIdentity } from "../monitor/corporateActionEvidenceIdentity.ts";

export const DILUTION_CORPORATE_ACTION_BINDING_VERSION =
  "dilution-corporate-action-clause-binding-v1" as const;

export const DILUTION_ADJUSTABLE_SHARE_FIELDS = [
  "original_units",
  "remaining_units",
  "converted_units",
  "exercised_units",
  "cancelled_units",
  "expired_units",
  "remaining_potential_shares",
  "shares_issued",
  "shares_sold",
  "registered_resale_shares",
  "option_shares",
  "award_units",
  "share_reserve",
  "share_cap",
] as const;

export const DILUTION_ADJUSTABLE_PRICE_FIELDS = [
  "conversion_price",
  "exercise_price",
  "floor_price",
] as const;

export type DilutionAdjustableShareField =
  (typeof DILUTION_ADJUSTABLE_SHARE_FIELDS)[number];

export type DilutionAdjustablePriceField =
  (typeof DILUTION_ADJUSTABLE_PRICE_FIELDS)[number];

export type DilutionAdjustableField =
  | DilutionAdjustableShareField
  | DilutionAdjustablePriceField;

export type DilutionContractFieldAdjustment = {
  field: DilutionAdjustableField;
  operation: "multiply_by_split_ratio" | "divide_by_split_ratio";
  evidenceIdentity: CorporateActionEvidenceIdentity;
};

export type DilutionSplitClauseBinding = {
  instrumentKey: string;
  executionId: string;
  canonicalSecurityClassId: string;
  contractAccession: string;
  sourceRef: string;
  sourceDocumentUrl: string;
  fieldAdjustments: DilutionContractFieldAdjustment[];
};

export type DilutionStoredSplitClauseBinding = DilutionSplitClauseBinding & {
  version: typeof DILUTION_CORPORATE_ACTION_BINDING_VERSION;
  bindingId: string;
  issuerCik: string;
  contractRawItemId: string;
  supersedesBindingId: string | null;
};

export function parseDilutionSplitClauseBinding(
  issuerCik: string,
  value: unknown,
  sourceRefFor: (rawItemId: string, sourceDocumentUrl: string) => string,
): Omit<DilutionStoredSplitClauseBinding, "bindingId"> {
  const input = asRecord(value);
  if (!input || !/^[0-9]{10}$/.test(issuerCik) || issuerCik === "0000000000") {
    throw new Error("Dilution Corporate Action clause binding is invalid");
  }
  const instrumentKey = textValue(input.instrument_key);
  const executionId = textValue(input.execution_id);
  const canonicalSecurityClassId = textValue(input.canonical_security_class_id);
  const contractAccession = textValue(input.contract_accession);
  const contractRawItemId = textValue(input.contract_raw_item_id);
  const sourceRef = textValue(input.source_ref);
  const sourceDocumentUrl = textValue(input.source_document_url);
  const supersedesBindingId = nullableTextValue(input.supersedes_binding_id);
  const rawRules = Array.isArray(input.field_adjustments) ? input.field_adjustments : [];
  const fieldAdjustments = rawRules.map((rawRule: unknown) => {
    const rule = asRecord(rawRule);
    return {
      field: textValue(rule?.field),
      operation: textValue(rule?.operation),
      evidenceIdentity: structuredClone(rule?.evidence_identity),
    };
  }) as DilutionContractFieldAdjustment[];
  const base = {
    version: DILUTION_CORPORATE_ACTION_BINDING_VERSION,
    issuerCik,
    instrumentKey,
    executionId,
    canonicalSecurityClassId,
    contractAccession,
    contractRawItemId,
    sourceRef,
    sourceDocumentUrl,
    fieldAdjustments,
    supersedesBindingId,
  };
  if (!validStoredBinding(base, sourceRefFor)) {
    throw new Error("Dilution Corporate Action clause binding is invalid");
  }
  return base;
}

function validStoredBinding(
  binding: Omit<DilutionStoredSplitClauseBinding, "bindingId">,
  sourceRefFor: (rawItemId: string, sourceDocumentUrl: string) => string,
) {
  if (!binding.instrumentKey
    || !/^(?:fse|rse):v1:[0-9a-f]{64}$/.test(binding.executionId)
    || !/^sc:v1:[0-9]{10}:common_stock:/.test(binding.canonicalSecurityClassId)
    || !/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(binding.contractAccession)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(binding.contractRawItemId)
    || (binding.supersedesBindingId !== null
      && !/^dcab:v1:[0-9a-f]{64}$/.test(binding.supersedesBindingId))
    || !binding.fieldAdjustments.length
    || new Set(binding.fieldAdjustments.map((item) => item.field)).size
      !== binding.fieldAdjustments.length) return false;
  let expectedSourceRef: string;
  let url: URL;
  try {
    expectedSourceRef = sourceRefFor(
      binding.contractRawItemId,
      binding.sourceDocumentUrl,
    );
    url = new URL(binding.sourceDocumentUrl);
  } catch {
    return false;
  }
  const issuerPath = BigInt(binding.issuerCik).toString();
  const accessionPath = binding.contractAccession.replaceAll("-", "");
  return binding.sourceRef === expectedSourceRef
    && url.protocol === "https:"
    && url.hostname === "www.sec.gov"
    && url.pathname.startsWith(`/Archives/edgar/data/${issuerPath}/${accessionPath}/`)
    && binding.fieldAdjustments.every((item) => {
      const isShare = (DILUTION_ADJUSTABLE_SHARE_FIELDS as readonly string[]).includes(item.field);
      const isPrice = (DILUTION_ADJUSTABLE_PRICE_FIELDS as readonly string[]).includes(item.field);
      return (isShare || isPrice)
        && item.operation === (isShare ? "multiply_by_split_ratio" : "divide_by_split_ratio")
        && validateCorporateActionEvidenceIdentity(item.evidenceIdentity).length === 0
        && item.evidenceIdentity.source_ref === binding.sourceRef;
    });
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableTextValue(value: unknown) {
  const text = textValue(value);
  return text || null;
}
