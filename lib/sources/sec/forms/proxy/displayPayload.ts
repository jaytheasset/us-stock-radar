export type ProxyDisplayType = "generic" | "offering_terms" | "candidate_special" | "spac_transaction_status";

export interface ProxyDisplayPayload {
  display_type: ProxyDisplayType;
  display_version: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}
