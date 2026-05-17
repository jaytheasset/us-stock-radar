export type CalendarGroup =
  | "earnings"
  | "shareholder"
  | "dividends"
  | "listing_risk"
  | "deals_offering"
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
    code: "offering_closing",
    label: "Offering Closing",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Expected public offering, private placement, or financing closing date.",
  },
  {
    code: "rights_offering_deadline",
    label: "Rights Offering Deadline",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Rights offering subscription or expiration deadline.",
  },
  {
    code: "warrant_redemption_deadline",
    label: "Warrant Redemption Deadline",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Warrant redemption or exercise deadline.",
  },
  {
    code: "lockup_expiration",
    label: "Lock-Up Expiration",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Lock-up expiration date.",
  },
  {
    code: "tender_offer_expiration",
    label: "Tender Offer Expiration",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Tender offer expiration date or time.",
  },
  {
    code: "merger_vote",
    label: "Merger Vote",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Merger or acquisition vote date.",
  },
  {
    code: "merger_closing",
    label: "Merger Closing",
    group: "deals_offering",
    groupLabel: "Deals / Offering",
    description: "Expected merger or acquisition closing date.",
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
