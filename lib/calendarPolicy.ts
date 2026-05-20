export type CalendarPolicySourceGroup = "news" | "filings" | "market" | "system";

export type CalendarPolicyInput = {
  sourceGroup: CalendarPolicySourceGroup | string;
  calendarEventType: string;
  calendarTitle?: string | null;
  evidence?: string | null;
  datePrecision?: string | null;
  eventDate?: string | null;
  estimatedStartDate?: string | null;
  estimatedEndDate?: string | null;
};

export type CalendarPolicyDecision = {
  keep: boolean;
  reason: string;
};

export const NEWS_CALENDAR_EVENT_TYPE_ALLOWLIST = new Set([
  "earnings_release",
  "earnings_call",
  "ex_dividend_date",
  "dividend_record_date",
  "dividend_payment_date",
  "fda_pdufa_date",
  "fda_advisory_committee",
  "clinical_data_readout",
  "medical_conference",
]);

export const FILING_CALENDAR_EVENT_TYPE_ALLOWLIST = new Set([
  "earnings_release",
  "earnings_call",
  "shareholder_meeting",
  "shareholder_vote",
  "shareholder_record_date",
  "ex_dividend_date",
  "dividend_record_date",
  "dividend_payment_date",
  "reverse_split_effective",
  "listing_deadline",
  "delisting_hearing",
  "ipo_expected_date",
  "ipo_pricing_date",
  "ipo_listing_date",
  "ipo_lockup_expiration",
  "spac_ipo_date",
  "spac_merger_vote",
  "spac_redemption_deadline",
  "spac_extension_vote",
  "despac_closing",
  "offering_closing",
  "registration_effective_date",
  "shareholder_approval_deadline",
  "rights_offering_deadline",
  "warrant_redemption_deadline",
  "lockup_expiration",
  "tender_offer_expiration",
  "merger_vote",
  "merger_closing",
  "sec_filing_due_date",
  "fda_pdufa_date",
  "fda_advisory_committee",
  "clinical_data_readout",
  "medical_conference",
  "investor_day",
  "conference_presentation",
  "court_hearing",
  "policy_effective_date",
  "fed_event",
  "economic_release",
]);

const fdaClinicalTypes = new Set([
  "fda_pdufa_date",
  "fda_advisory_committee",
  "clinical_data_readout",
  "medical_conference",
]);

const filingOfferingTriggerTypes = new Set([
  "offering_closing",
  "registration_effective_date",
  "shareholder_approval_deadline",
  "rights_offering_deadline",
  "warrant_redemption_deadline",
  "lockup_expiration",
]);

const operationalRoadmapPatterns = [
  /\bcontract\s+(start|starts|starting|begins|beginning|commence|commencement|implementation|deployment)\b/,
  /\b(product|platform|service|solution|technology)\s+(launch|rollout|availability|deployment|commercialization)\b/,
  /\b(launch|rollout|deployment|commercialization)\s+(target|expected|planned|scheduled|anticipated)\b/,
  /\bfirst\s+(production|delivery|shipment|revenue|sale|sales)\b/,
  /\b(revenue|sales)\s+(expected|anticipated|targeted|planned)\s+to\s+(begin|start|commence)\b/,
  /\b(project|facility|plant|mine|construction|phase)\s+(start|completion|commissioning|production|timeline|target)\b/,
  /\bmanagement\s+(priorities|objectives|goals|targets|plans)\b/,
  /\bstrategic\s+(priorities|roadmap|initiatives|objectives)\b/,
];

const legalNoisePatterns = [
  /\bform\s+4\b.*\b(rsu|restricted stock|stock unit|option|equity award|grant)\b.*\bvesting\b/,
  /\b(rsu|restricted stock|stock unit|option|equity award|grant)\b.*\bvesting\b/,
  /\bvesting\b.*\b(rsu|restricted stock|stock unit|option|equity award|grant)\b/,
  /first anniversary of grant/,
  /tax[-\s]?(status|exemption|exempt)/,
  /withholding (income )?tax/,
  /provide .*evidence/,
  /submit .*evidence/,
  /proxy (mailing|distribution|distributed|statement will be distributed)/,
  /board response/,
  /position statement/,
];

const filingOfferingNoisePatterns = [
  /\bmay\s+(offer|sell|issue|resell)\b.*\bfrom time to time\b/,
  /\bfrom time to time\b.*\b(may|offer|sell|issue|resell)\b/,
  /\bintend(s|ed)?\s+to\s+use\s+(the\s+)?proceeds\b/,
  /\bexpected\s+(deployment|use|application)\b/,
  /\banticipated\s+(deployment|use|application)\b/,
  /\bplanned\s+(deployment|use|application)\b/,
  /\bbase\s+shelf\b.*\b(no|without)\s+(current|specific|concrete)\s+(sale|offering|terms|takedown)\b/,
  /\buniversal\s+shelf\b.*\b(no|without)\s+(current|specific|concrete)\s+(sale|offering|terms|takedown)\b/,
];

export function evaluateCalendarItemPolicy(input: CalendarPolicyInput): CalendarPolicyDecision {
  const sourceGroup = input.sourceGroup.trim().toLowerCase();
  const calendarEventType = input.calendarEventType.trim().toLowerCase();
  const datePrecision = (input.datePrecision || "").trim().toLowerCase();
  const hasAnyDate = Boolean(input.eventDate || input.estimatedStartDate || input.estimatedEndDate);
  const text = [input.calendarEventType, input.calendarTitle, input.evidence]
    .map((part) => (part || "").toString().toLowerCase())
    .join("\n");

  if (!hasAnyDate) {
    return { keep: false, reason: "missing calendar date" };
  }

  if (sourceGroup === "news") {
    if (!NEWS_CALENDAR_EVENT_TYPE_ALLOWLIST.has(calendarEventType)) {
      return { keep: false, reason: "news calendar type not allowed" };
    }

    if (isVagueDate(datePrecision, input.eventDate) && !fdaClinicalTypes.has(calendarEventType)) {
      return { keep: false, reason: "vague news date only allowed for FDA or clinical events" };
    }

    if (isEarningsType(calendarEventType) && !hasEarningsContext(text)) {
      return { keep: false, reason: "earnings calendar type lacks earnings context" };
    }

    if (isDividendType(calendarEventType) && !hasDividendContext(text)) {
      return { keep: false, reason: "dividend calendar type lacks dividend context" };
    }

    if (isOperationalRoadmapText(text) && !isFormalCalendarType(calendarEventType)) {
      return { keep: false, reason: "operational roadmap date, not calendar-worthy" };
    }

    return { keep: true, reason: "allowed news calendar event" };
  }

  if (sourceGroup === "filings") {
    if (!FILING_CALENDAR_EVENT_TYPE_ALLOWLIST.has(calendarEventType)) {
      return { keep: false, reason: "filing calendar type not allowed" };
    }

    if (isLegalNoiseText(text)) {
      return { keep: false, reason: "filing calendar noise" };
    }

    if (isOperationalRoadmapText(text) && !isFormalCalendarType(calendarEventType)) {
      return { keep: false, reason: "operational roadmap date, not formal filing schedule" };
    }

    if (filingOfferingTriggerTypes.has(calendarEventType)) {
      if (isVagueDate(datePrecision, input.eventDate)) {
        return { keep: false, reason: "offering calendar trigger requires exact date" };
      }

      if (isFilingOfferingNoiseText(text)) {
        return { keep: false, reason: "offering calendar noise, not actionable dated trigger" };
      }
    }

    return { keep: true, reason: "allowed filing calendar event" };
  }

  return { keep: false, reason: "calendar source group not allowed" };
}

function isVagueDate(datePrecision: string, eventDate?: string | null) {
  if (eventDate && (!datePrecision || datePrecision === "exact")) return false;
  return datePrecision !== "exact";
}

function isOperationalRoadmapText(text: string) {
  return operationalRoadmapPatterns.some((pattern) => pattern.test(text));
}

function isLegalNoiseText(text: string) {
  return legalNoisePatterns.some((pattern) => pattern.test(text));
}

function isFilingOfferingNoiseText(text: string) {
  return filingOfferingNoisePatterns.some((pattern) => pattern.test(text));
}

function isFormalCalendarType(calendarEventType: string) {
  return (
    FILING_CALENDAR_EVENT_TYPE_ALLOWLIST.has(calendarEventType) &&
    calendarEventType !== "investor_day" &&
    calendarEventType !== "conference_presentation"
  );
}

function isEarningsType(calendarEventType: string) {
  return calendarEventType === "earnings_release" || calendarEventType === "earnings_call";
}

function isDividendType(calendarEventType: string) {
  return (
    calendarEventType === "ex_dividend_date" ||
    calendarEventType === "dividend_record_date" ||
    calendarEventType === "dividend_payment_date"
  );
}

function hasEarningsContext(text: string) {
  return /\b(earnings|financial results|quarterly results|annual results|fiscal results|results call|results conference call)\b/.test(
    text,
  );
}

function hasDividendContext(text: string) {
  return /\b(dividend|distribution|ex-dividend|record date|payment date)\b/.test(text);
}
