import { daysBetween, parseDateOnly } from "./dateUtils.ts";
import type { CompanyCalendarEventType } from "./model.ts";

export const CALENDAR_ANALYSIS_AUTO_LINK_SCORE = 90;
export const CALENDAR_ANALYSIS_CANDIDATE_SCORE = 70;

export const CALENDAR_ANALYSIS_RELATION_TYPES = [
  "announcement",
  "result",
  "amendment",
  "related",
] as const;
export type CalendarAnalysisRelationType =
  (typeof CALENDAR_ANALYSIS_RELATION_TYPES)[number];

export const CALENDAR_ANALYSIS_LINK_STATUSES = [
  "candidate",
  "linked",
  "rejected",
] as const;
export type CalendarAnalysisLinkStatus =
  (typeof CALENDAR_ANALYSIS_LINK_STATUSES)[number];

export type CalendarAnalysisMatchMethod = "exact" | "rules" | "llm" | "manual";

export type CalendarAnalysisFacts = {
  accessionNumber?: string | null;
  analysisEventId?: string | null;
  cik?: string | null;
  companyName?: string | null;
  declarationDate?: string | null;
  dividendAmount?: number | null;
  dividendDateKind?: "declaration" | "ex-dividend" | "record" | "payment" | null;
  effectiveDate?: string | null;
  epsActual?: number | null;
  exchange?: string | null;
  fiscalPeriod?: string | null;
  fiscalPeriodTrusted?: boolean;
  formType?: string | null;
  offerTermsKey?: string | null;
  paymentDate?: string | null;
  recordDate?: string | null;
  revenueActual?: number | null;
  sourceEventId?: string | null;
  splitRatio?: string | null;
  stage?: string | null;
  symbol?: string | null;
  ticker?: string | null;
};

export type CalendarAnalysisMatchRecord = {
  analysisEventId: string;
  analysisEventType: string;
  calendarEventDate: string;
  calendarEventType: string;
  facts: CalendarAnalysisFacts;
  publishedAt: string | null;
  relationType?: CalendarAnalysisRelationType;
};

export type CalendarCompanyMatchRecord = {
  calendarEventId: string;
  eventDate: string;
  eventType: CompanyCalendarEventType;
  facts: CalendarAnalysisFacts;
};

export type CalendarAnalysisMatchDecision = {
  analysisEventId: string;
  evidence: Record<string, unknown>;
  linkStatus: CalendarAnalysisLinkStatus;
  matchMethod: "exact" | "rules";
  matchScore: number;
  reason: { codes: string[] };
  relationType: CalendarAnalysisRelationType;
};

const SEC_TYPES_BY_CALENDAR_TYPE: Record<CompanyCalendarEventType, ReadonlySet<string>> = {
  dividend: new Set(["dividends"]),
  earnings: new Set(["earnings"]),
  ipo: new Set(["ipo_listing"]),
  split: new Set(["capital_return", "listing_risk", "shareholder_vote", "other"]),
};

export function matchCalendarEventToAnalysis(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
): CalendarAnalysisMatchDecision {
  const relationType = inferRelationType(analysis);
  const reasons: string[] = [];
  const evidence: Record<string, unknown> = {};

  const exactIdentifier = exactIdentifierMatch(calendar.facts, analysis.facts);
  if (exactIdentifier.matched) {
    return {
      analysisEventId: analysis.analysisEventId,
      evidence: { exactIdentifier: exactIdentifier.matched },
      linkStatus: "linked",
      matchMethod: "exact",
      matchScore: 100,
      reason: { codes: ["exact_identifier_match"] },
      relationType,
    };
  }

  if (!SEC_TYPES_BY_CALENDAR_TYPE[calendar.eventType].has(analysis.analysisEventType)) {
    return rejected(analysis, relationType, "event_type_incompatible");
  }

  const ticker = compareTicker(calendar.facts.ticker, analysis.facts.ticker);
  if (ticker === "mismatch") return rejected(analysis, relationType, "ticker_mismatch");
  const cik = compareIdentifier(calendar.facts.cik, analysis.facts.cik);
  if (cik === "mismatch") return rejected(analysis, relationType, "cik_mismatch");

  let score = 10;
  reasons.push("event_type_compatible");
  if (ticker === "match") {
    score += 35;
    evidence.ticker = normalizeTicker(calendar.facts.ticker);
    reasons.push("ticker_match");
  }
  if (cik === "match") {
    score += 15;
    evidence.cik = normalizeCik(calendar.facts.cik);
    reasons.push("cik_match");
  }
  if (sameCompany(calendar.facts.companyName, analysis.facts.companyName)) {
    score += 5;
    reasons.push("company_match");
  }

  const typed = typedScore(calendar, analysis);
  if ("rejectReason" in typed && typed.rejectReason) {
    return rejected(analysis, relationType, typed.rejectReason);
  }
  score += typed.score;
  reasons.push(...typed.reasons);
  Object.assign(evidence, typed.evidence);

  if (calendar.eventType !== "ipo" && ticker !== "match" && cik !== "match") {
    score = Math.min(score, CALENDAR_ANALYSIS_CANDIDATE_SCORE - 1);
    reasons.push("company_identifier_missing");
  }
  if (calendar.eventType === "earnings" && !typed.autoLinkEligible) {
    score = Math.min(score, CALENDAR_ANALYSIS_CANDIDATE_SCORE - 1);
    reasons.push("trusted_fiscal_period_required");
  }
  if (calendar.eventType === "ipo" && !typed.autoLinkEligible) {
    score = Math.min(score, CALENDAR_ANALYSIS_AUTO_LINK_SCORE - 1);
    reasons.push("ipo_requires_offer_terms_or_exact_identifier");
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    analysisEventId: analysis.analysisEventId,
    evidence,
    linkStatus:
      normalizedScore >= CALENDAR_ANALYSIS_AUTO_LINK_SCORE
        ? "linked"
        : normalizedScore >= CALENDAR_ANALYSIS_CANDIDATE_SCORE
          ? "candidate"
          : "rejected",
    matchMethod: "rules",
    matchScore: normalizedScore,
    reason: { codes: reasons },
    relationType,
  };
}

export function selectPrimaryCalendarAnalysis(
  decisions: readonly CalendarAnalysisMatchDecision[],
) {
  return decisions
    .filter((decision) => decision.linkStatus === "linked")
    .slice()
    .sort((left, right) => {
      const scoreOrder = right.matchScore - left.matchScore;
      if (scoreOrder) return scoreOrder;
      const relationOrder = relationPriority(left.relationType) - relationPriority(right.relationType);
      if (relationOrder) return relationOrder;
      return left.analysisEventId.localeCompare(right.analysisEventId);
    })[0] ?? null;
}

function typedScore(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  if (calendar.eventType === "earnings") return earningsScore(calendar, analysis);
  if (calendar.eventType === "dividend") return dividendScore(calendar, analysis);
  if (calendar.eventType === "split") return splitScore(calendar, analysis);
  return ipoScore(calendar, analysis);
}

function earningsScore(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  const leftPeriod = normalizeFiscalPeriod(calendar.facts.fiscalPeriod);
  const rightPeriod = normalizeFiscalPeriod(analysis.facts.fiscalPeriod);
  if (leftPeriod && rightPeriod && leftPeriod !== rightPeriod) {
    return typedRejected("earnings_fiscal_period_mismatch");
  }
  const trustedPeriod = Boolean(
    leftPeriod &&
      rightPeriod &&
      calendar.facts.fiscalPeriodTrusted &&
      analysis.facts.fiscalPeriodTrusted,
  );
  const evidence: Record<string, unknown> = {};
  const reasons: string[] = [];
  let score = 0;
  if (trustedPeriod) {
    score += 35;
    evidence.fiscalPeriod = leftPeriod;
    reasons.push("trusted_fiscal_period_match");
  }
  const distance = dateDistance(calendar.eventDate, analysis.calendarEventDate);
  if (distance <= 5) {
    score += 15;
    evidence.dateDistanceDays = distance;
    reasons.push("earnings_date_window_match");
  } else if (distance <= 14) {
    score += 8;
    evidence.dateDistanceDays = distance;
    reasons.push("earnings_extended_date_window_match");
  }
  if (sameNumber(calendar.facts.epsActual, analysis.facts.epsActual)) {
    score += 5;
    reasons.push("eps_match");
  }
  if (sameNumber(calendar.facts.revenueActual, analysis.facts.revenueActual)) {
    score += 5;
    reasons.push("revenue_match");
  }
  return { autoLinkEligible: trustedPeriod, evidence, reasons, score };
}

function dividendScore(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  if (analysis.facts.dividendDateKind !== "ex-dividend") {
    return typedRejected("dividend_date_kind_mismatch");
  }
  if (!sameNumber(calendar.facts.dividendAmount, analysis.facts.dividendAmount, 0.000001)) {
    return typedRejected("dividend_amount_mismatch");
  }
  const distance = dateDistance(calendar.eventDate, analysis.calendarEventDate);
  if (distance !== 0) return typedRejected("dividend_ex_date_mismatch");
  let score = 45;
  const reasons = ["dividend_amount_match", "dividend_ex_date_match"];
  if (sameDate(calendar.facts.recordDate, analysis.facts.recordDate)) {
    score += 5;
    reasons.push("dividend_record_date_match");
  }
  if (sameDate(calendar.facts.paymentDate, analysis.facts.paymentDate)) {
    score += 5;
    reasons.push("dividend_payment_date_match");
  }
  return {
    autoLinkEligible: true,
    evidence: {
      dividendAmount: calendar.facts.dividendAmount,
      dividendDateKind: "ex-dividend",
      eventDate: calendar.eventDate,
    },
    reasons,
    score,
  };
}

function splitScore(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  const leftRatio = normalizeRatio(calendar.facts.splitRatio);
  const rightRatio = normalizeRatio(analysis.facts.splitRatio);
  if (!leftRatio || !rightRatio || leftRatio !== rightRatio) {
    return typedRejected("split_ratio_mismatch");
  }
  const calendarEffectiveDate = calendar.facts.effectiveDate ?? calendar.eventDate;
  const analysisEffectiveDate = analysis.facts.effectiveDate ?? analysis.calendarEventDate;
  const distance = dateDistance(calendarEffectiveDate, analysisEffectiveDate);
  if (distance > 3) return typedRejected("split_effective_date_mismatch");
  return {
    autoLinkEligible: true,
    evidence: { dateDistanceDays: distance, effectiveDate: calendarEffectiveDate, splitRatio: leftRatio },
    reasons: ["split_ratio_match", "split_effective_date_match"],
    score: distance === 0 ? 50 : 45,
  };
}

function ipoScore(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  const companyMatch = sameCompany(calendar.facts.companyName, analysis.facts.companyName);
  const exchangeMatch = sameText(calendar.facts.exchange, analysis.facts.exchange);
  const symbolMatch = compareTicker(
    calendar.facts.symbol ?? calendar.facts.ticker,
    analysis.facts.symbol ?? analysis.facts.ticker,
  ) === "match";
  if (!companyMatch || !exchangeMatch) return typedRejected("ipo_company_exchange_mismatch");

  let score = 40;
  const reasons = ["ipo_company_match", "ipo_exchange_match"];
  if (symbolMatch) {
    score += 15;
    reasons.push("ipo_symbol_match");
  }
  const termsMatch = sameText(calendar.facts.offerTermsKey, analysis.facts.offerTermsKey);
  if (termsMatch) {
    score += 20;
    reasons.push("ipo_offer_terms_match");
  }
  const stageMatch = sameText(calendar.facts.stage, analysis.facts.stage);
  if (stageMatch) {
    score += 10;
    reasons.push("ipo_stage_match");
  }
  const distance = dateDistance(calendar.eventDate, analysis.calendarEventDate);
  if (distance <= 14) {
    score += 5;
    reasons.push("ipo_date_window_match");
  }
  return {
    autoLinkEligible: termsMatch && (symbolMatch || stageMatch),
    evidence: {
      companyName: normalizeCompany(calendar.facts.companyName),
      exchange: normalizeText(calendar.facts.exchange),
      offerTermsMatched: termsMatch,
      symbolMatched: symbolMatch,
    },
    reasons,
    score,
  };
}

function exactIdentifierMatch(left: CalendarAnalysisFacts, right: CalendarAnalysisFacts) {
  const accession = compareIdentifier(left.accessionNumber, right.accessionNumber);
  if (accession === "match") return { matched: "accession_number" as const };
  const sourceEventId = compareIdentifier(
    left.sourceEventId,
    right.sourceEventId ?? right.analysisEventId,
  );
  if (sourceEventId === "match") return { matched: "source_event_id" as const };
  return {};
}

function inferRelationType(analysis: CalendarAnalysisMatchRecord): CalendarAnalysisRelationType {
  if (analysis.relationType) return analysis.relationType;
  if (/\/A$/i.test(analysis.facts.formType ?? "")) return "amendment";
  if (
    analysis.analysisEventType === "earnings" &&
    (typeof analysis.facts.epsActual === "number" ||
      typeof analysis.facts.revenueActual === "number")
  ) {
    return "result";
  }
  return "announcement";
}

function rejected(
  analysis: CalendarAnalysisMatchRecord,
  relationType: CalendarAnalysisRelationType,
  code: string,
): CalendarAnalysisMatchDecision {
  return {
    analysisEventId: analysis.analysisEventId,
    evidence: {},
    linkStatus: "rejected",
    matchMethod: "rules",
    matchScore: 0,
    reason: { codes: [code] },
    relationType,
  };
}

function typedRejected(rejectReason: string) {
  return {
    autoLinkEligible: false,
    evidence: {},
    reasons: [] as string[],
    rejectReason,
    score: 0,
  };
}

function compareTicker(left: unknown, right: unknown) {
  const a = normalizeTicker(left);
  const b = normalizeTicker(right);
  if (!a || !b) return "missing" as const;
  return a === b ? ("match" as const) : ("mismatch" as const);
}

function compareIdentifier(left: unknown, right: unknown) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return "missing" as const;
  return a === b ? ("match" as const) : ("mismatch" as const);
}

function normalizeTicker(value: unknown) {
  const text = normalizeText(value)?.toUpperCase() ?? null;
  return text && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(text) ? text : null;
}

function normalizeCik(value: unknown) {
  const text = normalizeText(value)?.replace(/^0+/, "") ?? null;
  return text || null;
}

function normalizeFiscalPeriod(value: unknown) {
  const text = normalizeText(value)?.toUpperCase() ?? "";
  const match = text.match(/(?:Q([1-4])\s*(20\d{2})|(20\d{2})\s*Q([1-4]))/);
  if (!match) return null;
  const quarter = match[1] ?? match[4];
  const year = match[2] ?? match[3];
  return `${year}-Q${quarter}`;
}

function normalizeRatio(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const parts = text.match(/(\d+(?:\.\d+)?)\s*(?::|-?for-?|\/|to)\s*(\d+(?:\.\d+)?)/i);
  if (!parts) return null;
  const left = Number(parts[1]);
  const right = Number(parts[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  const scale = 1_000_000;
  const leftInt = Math.round(left * scale);
  const rightInt = Math.round(right * scale);
  const divisor = gcd(leftInt, rightInt);
  return `${leftInt / divisor}:${rightInt / divisor}`;
}

function gcd(left: number, right: number): number {
  return right ? gcd(right, left % right) : Math.abs(left);
}

function sameNumber(left: unknown, right: unknown, tolerance = 0.0001) {
  if (typeof left !== "number" || typeof right !== "number") return false;
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function sameDate(left: unknown, right: unknown) {
  return typeof left === "string" && typeof right === "string" && left === right;
}

function sameCompany(left: unknown, right: unknown) {
  const a = normalizeCompany(left);
  const b = normalizeCompany(right);
  return Boolean(a && b && a === b);
}

function normalizeCompany(value: unknown) {
  return normalizeText(value)
    ?.toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || null;
}

function sameText(left: unknown, right: unknown) {
  const a = normalizeText(left)?.toLowerCase();
  const b = normalizeText(right)?.toLowerCase();
  return Boolean(a && b && a === b);
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateDistance(left: string, right: string) {
  try {
    parseDateOnly(left);
    parseDateOnly(right);
    return Math.abs(daysBetween(left, right));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function relationPriority(value: CalendarAnalysisRelationType) {
  return { result: 0, announcement: 1, amendment: 2, related: 3 }[value];
}
