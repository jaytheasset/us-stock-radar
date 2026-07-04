export const SEC_OFFERING_SHARE_OVERHANG_TOTAL_NOTE_TITLE_VALUES = [
  "Dilution vs Current Shares",
  "Overhang vs Current Shares",
  "Registered Resale Overhang",
  "Total Potential Dilution",
  "Total Potential Overhang",
  "ATM Capacity Scale",
  "Shelf Capacity Scale",
  "Capacity vs Market Cap",
  "Capacity vs Market Value",
  "Capacity vs Public Float",
  "Warrant Share Supply",
  "Convertible Share Supply",
  "Preferred Conversion Supply",
  "Pre-Funded Warrant Supply",
  "Share-Equivalent Supply",
  "Rights Offering Dilution",
  "Marketed Block Scale",
] as const;

export function looseObjectSchema() {
  return {
    type: "object",
    additionalProperties: true,
  };
}

export function offeringDisplayRowSchema(labelMaxLength: number, valueMaxLength: number, noteMaxLength: number) {
  return {
    type: "object",
    additionalProperties: true,
    required: ["label", "value"],
    properties: {
      label: { type: "string", maxLength: labelMaxLength },
      value: { type: "string", maxLength: valueMaxLength },
      ...(noteMaxLength > 0 ? { note: { type: "string", maxLength: noteMaxLength } } : {}),
    },
  };
}

export function shareOverhangTotalNoteSchema() {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      title: { type: "string", enum: SEC_OFFERING_SHARE_OVERHANG_TOTAL_NOTE_TITLE_VALUES },
      numerator: { type: "string", maxLength: 40 },
      denominator: { type: "string", maxLength: 40 },
      ratio: { type: "string", maxLength: 24 },
      suffix: { type: "string", maxLength: 80 },
    },
  };
}

export function shareOverhangBasisSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["label", "value", "numeric_value", "unit"],
    properties: {
      label: { type: "string", maxLength: 80 },
      value: { type: "string", maxLength: 90 },
      numeric_value: { type: ["number", "null"] },
      unit: { type: ["string", "null"], maxLength: 20 },
      class_basis: { type: ["string", "null"], maxLength: 80 },
      note: { type: ["string", "null"], maxLength: 80 },
    },
  };
}

export function shareOverhangRowSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["row_role", "label", "value", "numeric_value", "unit"],
    properties: {
      row_role: { type: "string", enum: ["counted", "conditional", "alternative", "reference"] },
      counted_in_ratio: { type: ["boolean", "null"] },
      supply_type: { type: ["string", "null"], maxLength: 40 },
      label: { type: "string", maxLength: 80 },
      value: { type: "string", maxLength: 90 },
      numeric_value: { type: ["number", "null"] },
      unit: { type: ["string", "null"], maxLength: 20 },
      class_basis: { type: ["string", "null"], maxLength: 80 },
      pool_id: { type: ["string", "null"], maxLength: 80 },
      pool_relationship: { type: ["string", "null"], enum: ["alternative_max", "additive", null] },
      note: { type: ["string", "null"], maxLength: 80 },
    },
  };
}

export function shareOverhangSchema(options?: { requireStatusFields?: boolean; includeLegacyConditionalSupply?: boolean }) {
  return {
    type: "object",
    additionalProperties: true,
    required: options?.requireStatusFields
      ? ["chart_title", "status_label", "status_value", "basis", "rows"]
      : ["chart_title", "rows"],
    properties: {
      chart_title: { type: "string", maxLength: 48 },
      subtitle: { type: ["string", "null"], maxLength: 90 },
      status_label: { type: ["string", "null"], maxLength: 48 },
      status_value: { type: ["string", "null"], maxLength: 48 },
      caption: { type: ["string", "null"], maxLength: 72 },
      ratio_label: { type: ["string", "null"], maxLength: 56 },
      ratio_value: { type: ["string", "null"], maxLength: 48 },
      total_note: shareOverhangTotalNoteSchema(),
      basis: shareOverhangBasisSchema(),
      rows: {
        type: "array",
        maxItems: 7,
        items: shareOverhangRowSchema(),
      },
      ...(options?.includeLegacyConditionalSupply
        ? {
            conditional_supply: {
              type: "array",
              maxItems: 7,
              items: looseObjectSchema(),
            },
          }
        : {}),
      note: { type: ["string", "null"], maxLength: 160 },
    },
  };
}

export function scoreExplanationSchema() {
  return {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["summary", "base_band", "upward_factors", "limiting_factors", "final_read"],
    properties: {
      summary: {
        type: ["string", "null"],
        maxLength: 180,
        description:
          "Visible investor score rationale. One plain-language sentence. Start with the score driver, not issuer name, ticker, form type, or filing action. Do not restate the filing summary.",
      },
      base_band: { type: ["string", "null"], maxLength: 80 },
      upward_factors: {
        type: "array",
        maxItems: 3,
        items: { type: "string", maxLength: 70 },
      },
      limiting_factors: {
        type: "array",
        maxItems: 3,
        items: { type: "string", maxLength: 70 },
      },
      final_read: { type: ["string", "null"], maxLength: 90 },
    },
  };
}
