import type {
  SecFormParserCalendarItem,
  SecFormParserConfidence,
  SecFormParserEvidenceField,
} from "../common/parserContract";

export const SEC_S1_F1_PARSER_VERSION = "sec_s1_f1_parser_v1";

export type SecS1F1Field<T = string> = SecFormParserEvidenceField<T>;

export type SecS1F1CountField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1MoneyField = {
  value: {
    amount: number | null;
    currency: "USD" | null;
    scale: "raw" | "thousand" | "million" | "billion" | null;
  };
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1PriceField = {
  value: {
    price: number | null;
    currency: "USD" | null;
  };
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1PriceRangeField = {
  value: {
    low: number | null;
    high: number | null;
    currency: "USD" | null;
  };
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1PercentField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1OfferingKind =
  | "ipo_listing"
  | "primary_registration"
  | "resale_registration"
  | "mixed_primary_resale"
  | "routine_amendment"
  | "unknown";

export type SecS1F1RegistrationStatus =
  | "preliminary"
  | "filed_not_effective"
  | "effective"
  | "amended"
  | "unknown";

export type SecS1F1DocumentSummary = {
  source_id: string;
  type: string | null;
  description: string | null;
  filename: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  relevant_section_count: number;
  text_truncated: boolean;
};

export type SecS1F1SectionLabel =
  | "cover"
  | "prospectus_summary"
  | "the_offering"
  | "risk_factors"
  | "use_of_proceeds"
  | "dilution"
  | "capitalization"
  | "selling_stockholders"
  | "principal_stockholders"
  | "underwriting"
  | "plan_of_distribution"
  | "lockup"
  | "description_of_securities"
  | "warrant_terms"
  | "convertible_terms"
  | "fee_table"
  | "other_relevant";

export type SecS1F1Section = {
  label: SecS1F1SectionLabel;
  heading: string;
  source_id: string;
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
  char_count: number;
  text_truncated: boolean;
};

export type SecS1F1SellingStockholderRow = {
  holder_name: string | null;
  shares_offered: SecS1F1CountField | null;
  shares_owned_before: SecS1F1CountField | null;
  shares_owned_after: SecS1F1CountField | null;
  percent_after: SecS1F1PercentField | null;
  raw_cells: string[];
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS1F1FeeTableSummary = {
  present: boolean;
  source_ids: string[];
  total_offering_amount: SecS1F1MoneyField | null;
  maximum_aggregate_offering_price: SecS1F1MoneyField | null;
  registration_fee: SecS1F1MoneyField | null;
  excerpt: string | null;
};

export type SecS1F1AmendmentInfo = {
  is_amendment: boolean;
  amendment_number: SecS1F1CountField | null;
  registration_number: SecS1F1Field | null;
  includes_full_prospectus: boolean;
  unchanged_remainder_not_included: boolean;
  material_change_signal_candidates: SecS1F1Field[];
  amendment_excerpt: string | null;
};

export type SecS1F1OfferingTerms = {
  offering_kind: SecS1F1Field<SecS1F1OfferingKind>;
  registration_status: SecS1F1Field<SecS1F1RegistrationStatus> | null;
  primary_or_resale: SecS1F1Field | null;
  security_type_candidates: SecS1F1Field[];
  shares_offered: SecS1F1CountField | null;
  primary_shares_offered: SecS1F1CountField | null;
  resale_share_count: SecS1F1CountField | null;
  current_shares_outstanding: SecS1F1CountField | null;
  price_range: SecS1F1PriceRangeField | null;
  offering_price: SecS1F1PriceField | null;
  offering_amount: SecS1F1MoneyField | null;
  gross_proceeds: SecS1F1MoneyField | null;
  net_proceeds: SecS1F1MoneyField | null;
  use_of_proceeds: SecS1F1Section | SecS1F1Field | null;
  dilution: SecS1F1Section | SecS1F1Field | null;
  capitalization: SecS1F1Section | SecS1F1Field | null;
  underwriters: SecS1F1Field[];
  underwriter_section: SecS1F1Section | null;
  lockup_terms: SecS1F1Field | SecS1F1Section | null;
  warrant_terms: SecS1F1Field | SecS1F1Section | null;
  convertible_terms: SecS1F1Field | SecS1F1Section | null;
  selling_stockholders_section: SecS1F1Section | null;
  selling_stockholders: SecS1F1SellingStockholderRow[];
  risk_factor_excerpts: SecS1F1Field[];
  expected_pricing_date: SecS1F1Field | null;
  expected_listing_date: SecS1F1Field | null;
  expected_effective_date: SecS1F1Field | null;
  expected_closing_date: SecS1F1Field | null;
  fee_table: SecS1F1FeeTableSummary;
};

export type SecS1F1ReadingPackage = {
  cover_excerpt: string | null;
  key_facts: Array<{
    name: string;
    value: string;
    evidence: string;
    confidence: SecFormParserConfidence;
  }>;
  relevant_sections: SecS1F1Section[];
  parser_notes: string[];
};

export type SecS1F1Facts = {
  parser_version: typeof SEC_S1_F1_PARSER_VERSION;
  raw_item_id: string | null;
  accession_number: string | null;
  form_type: string;
  is_s1_f1_family: boolean;
  issuer: string | null;
  ticker: string | null;
  filed_at: string | null;
  source_url: string | null;
  documents: SecS1F1DocumentSummary[];
  sections: SecS1F1Section[];
  amendment: SecS1F1AmendmentInfo;
  terms: SecS1F1OfferingTerms;
  calendar_candidates: SecFormParserCalendarItem[];
  llm_reading_package: SecS1F1ReadingPackage;
  extracted_field_count: number;
  needs_human_review: boolean;
  review_reasons: string[];
  text_stats: {
    primary_chars: number;
    attachment_chars: number;
    combined_chars: number;
  };
};
