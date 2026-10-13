import type { OsRecord } from '../sec-os-snapshot/contract.ts';
import type { Plan } from '../sec-offering-plan/contract.ts';

/** Stored historical facts only. These versions do not enable new calculations. */
export const VERSION = 'projected_offering_dilution_v1' as const;
export const CALCULATION_REVISION = 'projected_offering_dilution_v1-calc-r2' as const;
export type Fact = {
  version: typeof VERSION; calculation_contract_version?: string; accession: string; os_run_id: string; offering_run_id: string;
  ineligible_numeric_fields?: string[];
  pre_offering_os: OsRecord[]; issuer_new_shares_base: number|null; issuer_new_shares_full_overallotment: number|null;
  resale_shares: number|null; resale_components: {quantity:string|null;unit:string;security_label:string}[];
  potential_warrant_shares: number|null; has_warrants: boolean; has_prefunded_warrants: boolean;
  calculated_post_os_base: number|null; calculated_post_os_full_overallotment: number|null;
  projected_increase_percent_base: number|null; projected_increase_percent_full_overallotment: number|null;
  direct_post_offering_os: Plan['post_offering_os']; calculation_status: 'CALCULATED'|'RESALE_ONLY'|'PARTIAL'|'UNAVAILABLE'|'CONFLICT';
  unavailable_reason: string[]; share_class: string|null; resale_only: boolean; calculation_issue: boolean;
  provenance: {os_fingerprint:string;offering_fingerprint:string;os_decision_id:string|null;offering_decision_id:string|null;evidence_blocks:string[]};
};
