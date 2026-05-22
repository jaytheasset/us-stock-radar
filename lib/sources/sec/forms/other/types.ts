import type { SecFormParserConfidence, SecFormParserEvidenceField } from "../common";

export const SEC_OTHER_PARSER_VERSION = "sec_other_parser_v1";

export type SecOtherEventTypeHint =
  | "listing_risk"
  | "dilution_risk"
  | "earnings"
  | "sales_performance"
  | "product_update"
  | "leadership_governance"
  | "insider_ownership"
  | "shareholder_vote"
  | "strategic_transaction"
  | "financial_risk"
  | "legal_risk"
  | "dividends"
  | "capital_return"
  | "fda_clinical"
  | "other";

export type SecOtherTextStats = {
  char_count: number;
  word_count: number;
  line_count: number;
  has_text: boolean;
  text_truncated: boolean;
};

export type SecOtherDocumentSummary = {
  type: string | null;
  description: string | null;
  filename: string | null;
  url_present: boolean;
  text_char_count: number;
};

export type SecOtherKeywordSignal = {
  keyword: string;
  event_type_hint: SecOtherEventTypeHint;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecOtherDateRole =
  | "deadline"
  | "effective_date"
  | "meeting_date"
  | "record_date"
  | "closing_date"
  | "filed_date"
  | "event_date"
  | "other";

export type SecOtherDateCandidate = {
  date_text: string;
  normalized_date: string | null;
  role: SecOtherDateRole;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecOtherValueKind = "money" | "shares" | "price" | "percent" | "other_number";

export type SecOtherValueCandidate = {
  kind: SecOtherValueKind;
  text: string;
  numeric_value: number | null;
  currency: "USD" | null;
  unit: "usd" | "shares" | "usd_per_share" | "percent" | "number" | null;
  scale: "raw" | "thousand" | "million" | "billion" | null;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecOtherNamedParty = SecFormParserEvidenceField<string> & {
  role: "issuer" | "counterparty_candidate" | "agent_candidate" | "mentioned_party";
};

export type SecOtherFilingFacts = {
  parser_version: typeof SEC_OTHER_PARSER_VERSION;
  raw_item_id: string | null;
  form_type: string;
  accession_number: string | null;
  issuer: {
    name: string | null;
    ticker: string | null;
    cik: string | null;
  };
  filed_at: string | null;
  document_title: string | null;
  source_url: string | null;
  reason_not_dedicated: SecFormParserEvidenceField<string>;
  primary_document_text_stats: SecOtherTextStats;
  combined_text_stats: SecOtherTextStats;
  documents: SecOtherDocumentSummary[];
  recognized_keywords: SecOtherKeywordSignal[];
  date_candidates: SecOtherDateCandidate[];
  value_candidates: SecOtherValueCandidate[];
  named_parties: SecOtherNamedParty[];
  text_excerpt: string | null;
  extracted_field_count: number;
  needs_human_review: boolean;
  review_reasons: string[];
};
