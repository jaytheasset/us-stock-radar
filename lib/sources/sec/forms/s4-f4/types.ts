import type {
  SecFormParserCalendarItem,
  SecFormParserConfidence,
  SecFormParserEvidenceField,
} from "../common/parserContract";

export const SEC_S4_F4_PARSER_VERSION = "sec_s4_f4_parser_v1";

export type SecS4F4Field<T = string> = SecFormParserEvidenceField<T>;

export type SecS4F4CountField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS4F4MoneyField = {
  value: {
    amount: number | null;
    currency: "USD" | null;
    scale: "raw" | "thousand" | "million" | "billion" | null;
  };
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS4F4PercentField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS4F4DateField = {
  value: string | null;
  text: string;
  date_precision: "exact" | "estimated" | "range" | "unknown";
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS4F4DocumentSummary = {
  source_id: string;
  type: string | null;
  description: string | null;
  filename: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_truncated: boolean;
};

export type SecS4F4PartyRole = "registrant" | "acquirer" | "target" | "merger_sub" | "issuer" | "other";

export type SecS4F4Party = {
  name: string;
  role: SecS4F4PartyRole;
  ticker: string | null;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecS4F4DealType =
  | "merger"
  | "business_combination"
  | "exchange_offer"
  | "reorganization"
  | "asset_acquisition"
  | "redomiciliation"
  | "other"
  | "unknown";

export type SecS4F4AmendmentInfo = {
  is_amendment: boolean;
  amendment_number: SecS4F4CountField | null;
  registration_number: SecS4F4Field | null;
  appears_limited_scope: boolean;
  unchanged_remainder_not_included: boolean;
  limited_scope_signal_candidates: SecS4F4Field[];
  change_signal_candidates: SecS4F4Field[];
  amendment_excerpt: string | null;
};

export type SecS4F4TransactionTerms = {
  deal_type: SecS4F4Field<SecS4F4DealType> | null;
  transaction_structure: SecS4F4Field | null;
  parties: SecS4F4Party[];
  consideration: SecS4F4Field | null;
  cash_consideration: SecS4F4MoneyField | null;
  stock_consideration: SecS4F4Field | null;
  exchange_ratio: SecS4F4Field | null;
  cash_stock_mix: SecS4F4Field | null;
  securities_registered: SecS4F4Field[];
  shares_to_be_issued: SecS4F4CountField | null;
  ownership_after_transaction: SecS4F4Field[];
  conditions: SecS4F4Field[];
  termination_fee: SecS4F4MoneyField | null;
  outside_date: SecS4F4DateField | null;
  expected_closing: SecS4F4DateField | null;
  exchange_offer_expiration: SecS4F4DateField | null;
  risk_factor_excerpt: SecS4F4Field | null;
  financial_statements_reference: SecS4F4Field | null;
  pro_forma_reference: SecS4F4Field | null;
};

export type SecS4F4ShareholderVoteTerms = {
  meeting_date: SecS4F4DateField | null;
  record_date: SecS4F4DateField | null;
  vote_deadline: SecS4F4DateField | null;
  vote_requirements: SecS4F4Field | null;
  proposals: SecS4F4Field[];
  meeting_section: SecS4F4Field | null;
};

export type SecS4F4ReadingPackage = {
  cover_excerpt: string | null;
  transaction_excerpt: string | null;
  vote_excerpt: string | null;
  risk_excerpt: string | null;
  important_facts: Array<{
    name: string;
    value: string;
    evidence: string;
    confidence: SecFormParserConfidence;
  }>;
  parser_notes: string[];
};

export type SecS4F4Facts = {
  parser_version: typeof SEC_S4_F4_PARSER_VERSION;
  raw_item_id: string | null;
  accession_number: string | null;
  form_type: string;
  is_s4_f4_family: boolean;
  issuer: string | null;
  ticker: string | null;
  filed_at: string | null;
  source_url: string | null;
  documents: SecS4F4DocumentSummary[];
  amendment: SecS4F4AmendmentInfo;
  transaction: SecS4F4TransactionTerms;
  shareholder_vote: SecS4F4ShareholderVoteTerms;
  calendar_candidates: SecFormParserCalendarItem[];
  llm_reading_package: SecS4F4ReadingPackage;
  extracted_field_count: number;
  needs_human_review: boolean;
  review_reasons: string[];
  text_stats: {
    primary_chars: number;
    attachment_chars: number;
    combined_chars: number;
  };
};
