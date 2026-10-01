/** Public, browser-safe view of canonical SEC status. Never a live market status. */
import type { ListingState, TradingStatus } from "../sec-listing-status/observation.ts";

export type StockListingStatus = {
  ticker: string;
  asOf: string;
  coverage: "stored_sec_observations_only";
  availability: "available" | "unknown" | "unavailable";
  reason: "identity_unresolved" | "conflicting_evidence" | "evidence_unresolved_or_conflicting" | "insufficient_evidence" | "reader_unavailable" | null;
  security: { issuerCik: string; title: string; exchange: string } | null;
  automatic: {
    listing: ListingState; trading: TradingStatus;
    removalDate: string | null; suspensionDate: string | null;
    withdrawalNoticeDate: string | null; resumptionDate: string | null;
  };
  sources: Array<{ form: string; accession: string; filingDate: string; url: string;
    role: "evidence" | "closed_event" }>;
  reviewedDates: Array<{ accession: string; field: "notice_date" | "suspension_effective_date";
    availability: "available" | "unknown"; value: string | null; sourceUrl: string }>;
};

export const listingStatusLabels: Record<ListingState, string> = {
  unresolved: "Unknown — insufficient SEC evidence",
  removal_pending: "Removal pending",
  confirmed_exchange_delisting: "Delisting confirmed",
  removal_decision_withdrawn: "Removal decision withdrawn",
};
export const tradingStatusLabels: Record<TradingStatus, string> = {
  unresolved: "Unknown — insufficient SEC evidence",
  suspension_scheduled: "Suspension scheduled", suspended: "Suspended", resumed: "Resumption confirmed",
};
export const listingStatusReasonLabels = {
  identity_unresolved: "The exact security and exchange could not be verified from stored SEC evidence.",
  conflicting_evidence: "Unknown — conflicting SEC evidence.",
  evidence_unresolved_or_conflicting: "Some SEC evidence remains unresolved or conflicting.",
  insufficient_evidence: "Stored SEC evidence does not establish a supported status.",
  reader_unavailable: "SEC status is temporarily unavailable. This is not a determination of listing or trading status.",
};
