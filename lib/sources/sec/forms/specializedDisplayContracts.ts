export const SEC_SPECIALIZED_DISPLAY_CONTRACTS = [
  contract("8k-6k", "capital_financing", "sec_8k_6k_capital_financing_v1", "data.display_version", "capital_financing"),
  contract("8k-6k", "strategic_transaction", "sec_8k_6k_strategic_transaction_v1", "data.display_version", "strategic_transaction"),
  contract("8k-6k", "governance_event", "sec_8k_6k_governance_event_v1", "data.display_version", "governance_event"),
  contract("8k-6k", "operating_event", "sec_8k_6k_operating_event_v1", "data.display_version", "operating_event"),
  contract("periodic-reports", "periodic_report", "periodic_report_display_v2", "data.version", "periodic_report"),
  contract("periodic-reports", "periodic_amendment", "periodic_report_display_v2", "data.version", "periodic_amendment"),
  contract("nt", "nt_late_filing", "nt_late_filing_v1", "display_version", "nt_late_filing"),
  contract("form25", "sec_form25_listing_removal", "sec_form25_listing_removal_v1", "display_version", "form25_listing_status"),
] as const;

export type SecSpecializedDisplayType = (typeof SEC_SPECIALIZED_DISPLAY_CONTRACTS)[number]["displayType"];
export type SecSpecializedDisplayRenderer = (typeof SEC_SPECIALIZED_DISPLAY_CONTRACTS)[number]["renderer"];

export function matchesSecSpecializedDisplayContract(value: unknown, renderer: SecSpecializedDisplayRenderer) {
  return SEC_SPECIALIZED_DISPLAY_CONTRACTS.some((item) => item.renderer === renderer && item.displayType === value);
}

function contract<
  const TRoom extends string,
  const TDisplayType extends string,
  const TVersion extends string,
  const TVersionPath extends string,
  const TRenderer extends string,
>(room: TRoom, displayType: TDisplayType, displayVersion: TVersion, versionPath: TVersionPath, renderer: TRenderer) {
  return { room, displayType, displayVersion, versionPath, renderer } as const;
}
