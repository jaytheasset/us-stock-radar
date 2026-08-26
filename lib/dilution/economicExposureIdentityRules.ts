import type {
  DilutionExposureType,
  DilutionIdentityClaimKind,
} from "./economicExposureContracts.ts";

export type ExposureIdentityRule = Readonly<{
  strongKinds: readonly DilutionIdentityClaimKind[];
  independentKinds: readonly DilutionIdentityClaimKind[];
  primaryKinds: readonly DilutionIdentityClaimKind[];
  separatingKinds: readonly DilutionIdentityClaimKind[];
  poolKinds: readonly DilutionIdentityClaimKind[];
  compositeKinds: readonly (readonly DilutionIdentityClaimKind[])[];
  supportingKinds: readonly DilutionIdentityClaimKind[];
}>;

export const ECONOMIC_EXPOSURE_IDENTITY_RULES: Record<DilutionExposureType, ExposureIdentityRule> = {
  convertible_note: rule({
    independent: [
      "original_instrument_reference",
      "agreement_reference",
      "designation_or_tranche",
      "exhibit_or_accession_reference",
    ],
    primary: ["original_instrument_reference", "designation_or_tranche"],
    separating: [
      "original_instrument_reference",
      "designation_or_tranche",
      "original_issuance_or_closing_date",
    ],
    pool: ["agreement_reference", "exhibit_or_accession_reference"],
    supporting: ["principal", "holder_or_investor"],
  }),
  warrant: rule({
    independent: [
      "original_instrument_reference",
      "agreement_reference",
      "series_or_designation",
      "exhibit_or_accession_reference",
    ],
    primary: ["original_instrument_reference", "series_or_designation"],
    separating: [
      "original_instrument_reference",
      "series_or_designation",
      "original_issuance_or_closing_date",
    ],
    pool: ["agreement_reference", "exhibit_or_accession_reference"],
    supporting: [
      "underlying_share_quantity",
      "holder_or_investor",
      "expiration_date",
    ],
  }),
  prefunded_warrant: rule({
    independent: [
      "original_instrument_reference",
      "agreement_reference",
      "series_or_designation",
      "exhibit_or_accession_reference",
    ],
    primary: ["original_instrument_reference", "series_or_designation"],
    separating: [
      "original_instrument_reference",
      "series_or_designation",
      "original_issuance_or_closing_date",
    ],
    pool: ["agreement_reference", "exhibit_or_accession_reference"],
    supporting: [
      "underlying_share_quantity",
      "holder_or_investor",
      "expiration_date",
    ],
  }),
  convertible_preferred: rule({
    independent: [
      "original_instrument_reference",
      "series_or_designation",
      "certificate_of_designation_reference",
      "exhibit_or_accession_reference",
    ],
    primary: [
      "original_instrument_reference",
      "series_or_designation",
      "certificate_of_designation_reference",
    ],
    separating: [
      "original_instrument_reference",
      "series_or_designation",
      "certificate_of_designation_reference",
      "original_issuance_or_closing_date",
    ],
    pool: ["exhibit_or_accession_reference"],
    supporting: ["holder_or_investor"],
  }),
  atm_program: rule({
    independent: ["sales_agreement_reference", "exhibit_or_accession_reference"],
    primary: ["sales_agreement_reference", "exhibit_or_accession_reference"],
    separating: [
      "sales_agreement_reference",
      "sales_agreement_date",
      "sales_agent",
      "exhibit_or_accession_reference",
    ],
    composite: [["sales_agreement_date", "sales_agent"]],
    supporting: ["original_program_capacity"],
  }),
  equity_line: rule({
    independent: ["purchase_agreement_reference", "exhibit_or_accession_reference"],
    primary: ["purchase_agreement_reference", "exhibit_or_accession_reference"],
    separating: [
      "purchase_agreement_reference",
      "purchase_agreement_date",
      "counterparty",
      "exhibit_or_accession_reference",
    ],
    composite: [["purchase_agreement_date", "counterparty"]],
    supporting: ["committed_amount"],
  }),
};

function rule(input: {
  independent: readonly DilutionIdentityClaimKind[];
  primary: readonly DilutionIdentityClaimKind[];
  separating: readonly DilutionIdentityClaimKind[];
  pool?: readonly DilutionIdentityClaimKind[];
  composite?: readonly (readonly DilutionIdentityClaimKind[])[];
  supporting: readonly DilutionIdentityClaimKind[];
}): ExposureIdentityRule {
  const pool = input.pool ?? [];
  const composite = input.composite ?? [];
  return {
    independentKinds: input.independent,
    primaryKinds: input.primary,
    separatingKinds: input.separating,
    poolKinds: pool,
    compositeKinds: composite,
    supportingKinds: input.supporting,
    strongKinds: [...new Set([
      ...input.independent,
      ...input.separating,
      ...pool,
      ...composite.flat(),
      "amendment_reference" as const,
    ])],
  };
}
