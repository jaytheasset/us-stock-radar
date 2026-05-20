export type CalendarGroup =
  | "earnings"
  | "shareholder"
  | "dividends"
  | "listing_risk"
  | "ipo"
  | "deals_offering"
  | "filings"
  | "fda_clinical"
  | "investor_events"
  | "legal_policy"
  | "other";

export type CalendarStatus = "tentative" | "confirmed" | "superseded" | "cancelled";

export type CalendarEventDefinition = {
  code: string;
  label: string;
  group: CalendarGroup;
  groupLabel: string;
  description: string;
};

export const calendarEventDefinitions: CalendarEventDefinition[] = [
  {
    code: "earnings_release",
    label: "Earnings Release",
    group: "earnings",
    groupLabel: "Earnings",
    description: "Scheduled earnings release date.",
  },
  {
    code: "earnings_call",
    label: "Earnings Call",
    group: "earnings",
    groupLabel: "Earnings",
    description: "Earnings conference call or webcast.",
  },
  {
    code: "shareholder_meeting",
    label: "Shareholder Meeting",
    group: "shareholder",
    groupLabel: "Shareholder",
    description: "Annual, special, or extraordinary shareholder meeting.",
  },
  {
    code: "shareholder_vote",
    label: "Shareholder Vote",
    group: "shareholder",
    groupLabel: "Shareholder",
    description: "Shareholder vote deadline or vote date.",
  },
  {
    code: "shareholder_record_date",
    label: "Shareholder Record Date",
    group: "shareholder",
    groupLabel: "Shareholder",
    description: "Record date for shareholder meeting or vote eligibility.",
  },
  {
    code: "ex_dividend_date",
    label: "Ex-Dividend Date",
    group: "dividends",
    groupLabel: "Dividends",
    description: "Dividend ex-date.",
  },
  {
    code: "dividend_record_date",
    label: "Dividend Record Date",
    group: "dividends",
    groupLabel: "Dividends",
    description: "Dividend record date.",
  },
  {
    code: "dividend_payment_date",
    label: "Dividend Payment Date",
    group: "dividends",
    groupLabel: "Dividends",
    description: "Dividend or distribution payment date.",
  },
  {
    code: "reverse_split_effective",
    label: "Reverse Split Effective",
    group: "listing_risk",
    groupLabel: "Listing Risk",
    description: "Reverse split effective date.",
  },
  {
    code: "listing_deadline",
    label: "Listing Deadline",
    group: "listing_risk",
    groupLabel: "Listing Risk",
    description: "Exchange compliance or listing deadline.",
  },
  {
    code: "delisting_hearing",
    label: "Delisting Hearing",
    group: "listing_risk",
    groupLabel: "Listing Risk",
    description: "Exchange delisting hearing or appeal date.",
  },
  {
    code: "ipo_expected_date",
    label: "Expected IPO Date",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "Expected IPO date or target listing window.",
  },
  {
    code: "ipo_pricing_date",
    label: "IPO Pricing Date",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "Expected IPO pricing date.",
  },
  {
    code: "ipo_listing_date",
    label: "IPO Listing Date",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "Expected first trading day or listing date.",
  },
  {
    code: "ipo_lockup_expiration",
    label: "IPO Lock-Up Expiration",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "IPO-related lock-up expiration date.",
  },
  {
    code: "spac_ipo_date",
    label: "SPAC IPO Date",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "SPAC IPO, unit listing, or expected trading date.",
  },
  {
    code: "spac_merger_vote",
    label: "SPAC Merger Vote",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "SPAC shareholder vote for a business combination.",
  },
  {
    code: "spac_redemption_deadline",
    label: "SPAC Redemption Deadline",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "Deadline for SPAC shareholder redemption election.",
  },
  {
    code: "spac_extension_vote",
    label: "SPAC Extension Vote",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "SPAC extension vote or deadline to extend the combination period.",
  },
  {
    code: "despac_closing",
    label: "De-SPAC Closing",
    group: "ipo",
    groupLabel: "IPO / SPAC",
    description: "Expected de-SPAC merger or business combination closing.",
  },
  {
    code: "offering_closing",
    label: "Offering Closing",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "Expected public offering, private placement, or financing closing date.",
  },
  {
    code: "registration_effective_date",
    label: "Registration Effective Date",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "SEC registration statement effectiveness date tied to an offering or resale registration.",
  },
  {
    code: "shareholder_approval_deadline",
    label: "Shareholder Approval Deadline",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "Shareholder approval deadline tied to financing, convertibles, warrants, or exchange issuance limits.",
  },
  {
    code: "rights_offering_deadline",
    label: "Rights Offering Deadline",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "Rights offering subscription or expiration deadline.",
  },
  {
    code: "warrant_redemption_deadline",
    label: "Warrant Deadline",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "Warrant redemption, exercise, or expiration deadline.",
  },
  {
    code: "lockup_expiration",
    label: "Lock-Up Expiration",
    group: "deals_offering",
    groupLabel: "Dilution / Offering",
    description: "Lock-up expiration date.",
  },
  {
    code: "tender_offer_expiration",
    label: "Tender Offer Expiration",
    group: "other",
    groupLabel: "Other",
    description: "Tender offer expiration date or time.",
  },
  {
    code: "merger_vote",
    label: "Merger Vote",
    group: "other",
    groupLabel: "Other",
    description: "Merger or acquisition vote date.",
  },
  {
    code: "merger_closing",
    label: "Merger Closing",
    group: "other",
    groupLabel: "Other",
    description: "Expected merger or acquisition closing date.",
  },
  {
    code: "sec_filing_due_date",
    label: "SEC Filing Due Date",
    group: "filings",
    groupLabel: "Filings",
    description: "Expected SEC report, amendment, or restatement filing date.",
  },
  {
    code: "fda_pdufa_date",
    label: "FDA PDUFA Date",
    group: "fda_clinical",
    groupLabel: "FDA / Clinical",
    description: "FDA PDUFA or target action date.",
  },
  {
    code: "fda_advisory_committee",
    label: "FDA Advisory Committee",
    group: "fda_clinical",
    groupLabel: "FDA / Clinical",
    description: "FDA advisory committee date.",
  },
  {
    code: "clinical_data_readout",
    label: "Clinical Data Readout",
    group: "fda_clinical",
    groupLabel: "FDA / Clinical",
    description: "Expected clinical data readout date or period.",
  },
  {
    code: "medical_conference",
    label: "Medical Conference",
    group: "fda_clinical",
    groupLabel: "FDA / Clinical",
    description: "Medical or scientific conference presentation date.",
  },
  {
    code: "investor_day",
    label: "Investor Day",
    group: "investor_events",
    groupLabel: "Investor Events",
    description: "Investor day or analyst day.",
  },
  {
    code: "conference_presentation",
    label: "Conference Presentation",
    group: "investor_events",
    groupLabel: "Investor Events",
    description: "Investor conference presentation, webcast, or fireside chat.",
  },
  {
    code: "court_hearing",
    label: "Court Hearing",
    group: "legal_policy",
    groupLabel: "Legal / Policy",
    description: "Court, bankruptcy, regulatory, or legal hearing date.",
  },
  {
    code: "policy_effective_date",
    label: "Policy Effective Date",
    group: "legal_policy",
    groupLabel: "Legal / Policy",
    description: "Policy, rule, regulation, tariff, or sanction effective date.",
  },
  {
    code: "fed_event",
    label: "Fed Event",
    group: "legal_policy",
    groupLabel: "Legal / Policy",
    description: "FOMC, Federal Reserve speaker, or Fed policy event.",
  },
  {
    code: "economic_release",
    label: "Economic Release",
    group: "legal_policy",
    groupLabel: "Legal / Policy",
    description: "Scheduled macroeconomic data release.",
  },
  {
    code: "other_scheduled_event",
    label: "Other Scheduled Event",
    group: "other",
    groupLabel: "Other",
    description: "Other dated event worth preserving for the calendar.",
  },
];

const definitionByCode = new Map(calendarEventDefinitions.map((definition) => [definition.code, definition]));

export const CALENDAR_EVENT_TYPE_VALUES = calendarEventDefinitions.map((definition) => definition.code);
export const CALENDAR_STATUS_VALUES: CalendarStatus[] = ["tentative", "confirmed", "superseded", "cancelled"];

export function getCalendarEventDefinition(code: string) {
  return definitionByCode.get(normalizeCalendarEventType(code));
}

export function getCalendarEventGroup(code: string): CalendarGroup {
  return getCalendarEventDefinition(code)?.group || "other";
}

export function normalizeCalendarEventType(code: string) {
  const normalized = code.trim().toLowerCase();
  return definitionByCode.has(normalized) ? normalized : "other_scheduled_event";
}

export function normalizeCalendarStatus(value: string): CalendarStatus {
  const normalized = value.trim().toLowerCase();
  return CALENDAR_STATUS_VALUES.includes(normalized as CalendarStatus)
    ? (normalized as CalendarStatus)
    : "tentative";
}
