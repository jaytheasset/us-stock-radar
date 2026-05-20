"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

const categoryTabs = [
  { label: "All" },
  { label: "Earnings" },
  { label: "IPO / SPAC" },
  { label: "FDA & Clinical" },
  { label: "Listing Risk" },
  { label: "Dilution / Offering" },
  { label: "Dividends" },
  { label: "Shareholder Vote" },
];

const filterConfig = {
  exchange: {
    label: "Exchange",
    options: ["NASDAQ", "NYSE", "AMEX", "OTC"],
  },
  marketCap: {
    label: "Market Cap",
    options: ["Mega", "Large", "Mid", "Small", "Micro"],
  },
  status: {
    label: "Status",
    options: ["Confirmed", "Tentative"],
  },
  timing: {
    label: "Timing",
    options: ["Pre-Market", "Market Hours", "After-Hours", "TBD"],
  },
  impact: {
    label: "Impact",
    options: ["High", "Medium", "Low"],
  },
} as const;

type FilterKey = keyof typeof filterConfig;
type FilterState = Record<FilterKey, string[]>;
type DateRangeKey = "today" | "week" | "month";
type CalendarDateRange = { from: string; to: string; label: string };

const emptyFilters: FilterState = {
  exchange: [],
  marketCap: [],
  status: [],
  timing: [],
  impact: [],
};

const watchlistTickers = ["NVDA", "TSLA", "AAPL", "AMZN"];

type CalendarImpact = "High" | "Medium" | "Low";
type CalendarStatusLabel = "Confirmed" | "Tentative" | "Superseded" | "Cancelled";
type CalendarLoadState = "loading" | "ready" | "error";

type CalendarEvent = {
  id?: string | null;
  rawItemId?: string | null;
  time: string;
  ticker: string;
  title: string;
  type: string;
  category: string;
  tone: string;
  impact: CalendarImpact;
  status: CalendarStatusLabel;
  companyName?: string | null;
  sourceEventId?: string | null;
  sourceGroup?: string | null;
  sourceUrl?: string | null;
  confirmationSource?: string | null;
  evidence?: string | null;
  eventDateIso?: string | null;
  eventTimezone?: string | null;
  calendarEventKey?: string | null;
  earnings?: EarningsSnapshot | null;
};

type CalendarDay = {
  day: string;
  date: string;
  events: CalendarEvent[];
};

type CalendarListEvent = CalendarEvent & { day: string; date: string; showDate?: boolean };

type CalendarApiItem = {
  id?: string;
  source_event_id?: string | null;
  raw_item_id?: string | null;
  source_code?: string | null;
  source_group?: string | null;
  ticker?: string | null;
  company_name?: string | null;
  calendar_event_key?: string | null;
  calendar_event_type?: string | null;
  calendar_group?: string | null;
  calendar_title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  event_timezone?: string | null;
  estimated_start_date?: string | null;
  estimated_end_date?: string | null;
  calendar_status?: string | null;
  confirmation_source?: string | null;
  confidence?: string | null;
  source_url?: string | null;
  evidence?: string | null;
  revenue_estimate?: number | string | null;
  revenueEstimate?: number | string | null;
  eps_estimate?: number | string | null;
  epsEstimate?: number | string | null;
  revenue_actual?: number | string | null;
  revenueActual?: number | string | null;
  eps_actual?: number | string | null;
  epsActual?: number | string | null;
  revenue_estimate_change_pct?: number | string | null;
  revenueEstimateChangePct?: number | string | null;
  eps_estimate_change_pct?: number | string | null;
  epsEstimateChangePct?: number | string | null;
  revenue_surprise_pct?: number | string | null;
  revenueSurprisePct?: number | string | null;
  eps_surprise_pct?: number | string | null;
  epsSurprisePct?: number | string | null;
  earnings_last_updated?: string | null;
  earningsLastUpdated?: string | null;
  market_cap?: number | string | null;
  marketCap?: number | string | null;
  fiscal_quarter_ending?: string | null;
  fiscalQuarterEnding?: string | null;
  fiscal_period_ending?: string | null;
  fiscalPeriodEnding?: string | null;
  last_year_report_date?: string | null;
  lastYearReportDate?: string | null;
  last_year_eps?: number | string | null;
  lastYearEps?: number | string | null;
  metadata?: Record<string, unknown> | null;
};

type EarningsSnapshot = {
  marketCap: number | null;
  fiscalQuarterEnding: string | null;
  revenueEstimate: number | null;
  epsEstimate: number | null;
  lastYearReportDate: string | null;
  lastYearEps: number | null;
  revenueActual: number | null;
  epsActual: number | null;
  revenueEstimateChangePct: number | null;
  epsEstimateChangePct: number | null;
  revenueSurprisePct: number | null;
  epsSurprisePct: number | null;
  lastUpdated: string | null;
};

const tickerFilterMeta: Record<string, { exchange: string; marketCap: string }> = {
  NVDA: { exchange: "NASDAQ", marketCap: "Mega" },
  TSLA: { exchange: "NASDAQ", marketCap: "Mega" },
  AAPL: { exchange: "NASDAQ", marketCap: "Mega" },
  AMZN: { exchange: "NASDAQ", marketCap: "Mega" },
  MSFT: { exchange: "NASDAQ", marketCap: "Mega" },
  PFE: { exchange: "NYSE", marketCap: "Mega" },
  HD: { exchange: "NYSE", marketCap: "Mega" },
  XOM: { exchange: "NYSE", marketCap: "Mega" },
  CRM: { exchange: "NYSE", marketCap: "Large" },
  ABBV: { exchange: "NYSE", marketCap: "Mega" },
  MSTR: { exchange: "NASDAQ", marketCap: "Large" },
  AMC: { exchange: "NYSE", marketCap: "Mid" },
  ARQT: { exchange: "NASDAQ", marketCap: "Small" },
  ARDC: { exchange: "NYSE", marketCap: "Small" },
  MNPR: { exchange: "NASDAQ", marketCap: "Micro" },
  ABVX: { exchange: "NASDAQ", marketCap: "Small" },
  NEWU: { exchange: "NASDAQ", marketCap: "Micro" },
  NXXT: { exchange: "NASDAQ", marketCap: "Small" },
};

const tickerContextMeta: Record<
  string,
  {
    company: string;
    sector: string;
    industry: string;
    marketCap: string;
    exchange: string;
    priceMove: string;
  }
> = {
  NVDA: {
    company: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors & Compute",
    marketCap: "Mega",
    exchange: "NASDAQ",
    priceMove: "+1.86%",
  },
  TSLA: {
    company: "Tesla, Inc.",
    sector: "Consumer Cyclical",
    industry: "Autos & Mobility",
    marketCap: "Mega",
    exchange: "NASDAQ",
    priceMove: "-1.13%",
  },
  AAPL: {
    company: "Apple Inc.",
    sector: "Technology",
    industry: "Hardware & Electronics",
    marketCap: "Mega",
    exchange: "NASDAQ",
    priceMove: "-0.68%",
  },
  AMZN: {
    company: "Amazon.com, Inc.",
    sector: "Consumer Cyclical",
    industry: "Retail & E-commerce",
    marketCap: "Mega",
    exchange: "NASDAQ",
    priceMove: "+0.42%",
  },
  PFE: {
    company: "Pfizer Inc.",
    sector: "Healthcare",
    industry: "Pharmaceuticals",
    marketCap: "Mega",
    exchange: "NYSE",
    priceMove: "+0.31%",
  },
  HD: {
    company: "The Home Depot, Inc.",
    sector: "Consumer Cyclical",
    industry: "Home & Lifestyle",
    marketCap: "Mega",
    exchange: "NYSE",
    priceMove: "-0.22%",
  },
  XOM: {
    company: "Exxon Mobil Corporation",
    sector: "Energy",
    industry: "Oil, Gas & Refining",
    marketCap: "Mega",
    exchange: "NYSE",
    priceMove: "+0.58%",
  },
  CRM: {
    company: "Salesforce, Inc.",
    sector: "Technology",
    industry: "Software & Cloud",
    marketCap: "Large",
    exchange: "NYSE",
    priceMove: "+0.74%",
  },
  ABBV: {
    company: "AbbVie Inc.",
    sector: "Healthcare",
    industry: "Pharmaceuticals",
    marketCap: "Mega",
    exchange: "NYSE",
    priceMove: "+0.19%",
  },
  MSTR: {
    company: "Strategy Inc.",
    sector: "Financial Services",
    industry: "Fintech & Digital Assets",
    marketCap: "Large",
    exchange: "NASDAQ",
    priceMove: "-3.08%",
  },
  AMC: {
    company: "AMC Entertainment Holdings, Inc.",
    sector: "Communication Services",
    industry: "Media & Entertainment",
    marketCap: "Mid",
    exchange: "NYSE",
    priceMove: "-4.21%",
  },
  ARQT: {
    company: "Arcutis Biotherapeutics, Inc.",
    sector: "Healthcare",
    industry: "Biotechnology",
    marketCap: "Small",
    exchange: "NASDAQ",
    priceMove: "+2.14%",
  },
  ARDC: {
    company: "Ares Dynamic Credit Allocation Fund",
    sector: "Financial Services",
    industry: "Asset & Wealth Management",
    marketCap: "Small",
    exchange: "NYSE",
    priceMove: "+0.06%",
  },
  MNPR: {
    company: "Monopar Therapeutics Inc.",
    sector: "Healthcare",
    industry: "Biotechnology",
    marketCap: "Micro",
    exchange: "NASDAQ",
    priceMove: "-2.45%",
  },
  ABVX: {
    company: "Abivax SA",
    sector: "Healthcare",
    industry: "Biotechnology",
    marketCap: "Small",
    exchange: "NASDAQ",
    priceMove: "+1.62%",
  },
  NEWU: {
    company: "NewGenIvf Group Limited",
    sector: "Healthcare",
    industry: "Healthcare Services",
    marketCap: "Micro",
    exchange: "NASDAQ",
    priceMove: "+6.40%",
  },
};

const miniCalendarWeekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type MiniCalendarCell = {
  isoDate: string;
  day: string;
  muted: boolean;
};

const calendarGroupLabels: Record<string, string> = {
  earnings: "Earnings",
  ipo: "IPO / SPAC",
  fda_clinical: "FDA & Clinical",
  listing_risk: "Listing Risk",
  deals_offering: "Dilution / Offering",
  dividends: "Dividends",
  shareholder: "Shareholder Vote",
  filings: "Filings",
  investor_events: "Investor Events",
  legal_policy: "Legal / Policy",
  other: "Other",
};

const calendarGroupTones: Record<string, string> = {
  earnings: "call",
  ipo: "ipo",
  fda_clinical: "fda",
  listing_risk: "risk",
  deals_offering: "deal",
  dividends: "dividend",
  shareholder: "shareholder",
  filings: "release",
  investor_events: "release",
  legal_policy: "risk",
  other: "release",
};

const calendarTypeLabels: Record<string, string> = {
  earnings_release: "Earnings Release",
  earnings_call: "Earnings Call",
  shareholder_meeting: "Shareholder Meeting",
  shareholder_vote: "Shareholder Vote",
  shareholder_record_date: "Shareholder Record Date",
  ex_dividend_date: "Ex-Dividend Date",
  dividend_record_date: "Dividend Record Date",
  dividend_payment_date: "Dividend Payment Date",
  reverse_split_effective: "Reverse Split Effective",
  listing_deadline: "Listing Deadline",
  delisting_hearing: "Delisting Hearing",
  ipo_expected_date: "Expected IPO Date",
  ipo_pricing_date: "IPO Pricing Date",
  ipo_listing_date: "IPO Listing Date",
  ipo_lockup_expiration: "IPO Lock-Up Expiration",
  spac_ipo_date: "SPAC IPO Date",
  spac_merger_vote: "SPAC Merger Vote",
  spac_redemption_deadline: "SPAC Redemption Deadline",
  spac_extension_vote: "SPAC Extension Vote",
  despac_closing: "De-SPAC Closing",
  offering_closing: "Offering Closing",
  registration_effective_date: "Registration Effective Date",
  shareholder_approval_deadline: "Shareholder Approval Deadline",
  rights_offering_deadline: "Rights Offering Deadline",
  warrant_redemption_deadline: "Warrant Deadline",
  lockup_expiration: "Lock-Up Expiration",
  tender_offer_expiration: "Tender Offer Expiration",
  merger_vote: "Merger Vote",
  merger_closing: "Merger Closing",
  fda_pdufa_date: "FDA PDUFA Date",
  fda_advisory_committee: "FDA Advisory Committee",
  clinical_data_readout: "Clinical Data Readout",
  medical_conference: "Medical Conference",
  other_scheduled_event: "Other Scheduled Event",
};

function mapCalendarApiRows(rows: CalendarApiItem[], range: { from: string; to: string }): CalendarDay[] {
  const days = buildCalendarDateRange(range);
  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const row of rows) {
    const dateValue = row.event_date || row.estimated_start_date || row.estimated_end_date;
    if (!dateValue) continue;

    const dateParts = formatApiDate(dateValue);
    if (!dateParts) continue;

    const groupCode = row.calendar_group || "other";
    const typeCode = row.calendar_event_type || "other_scheduled_event";
    const ticker = normalizeApiTicker(row.ticker);
    const event: CalendarEvent = {
      id: row.id || null,
      rawItemId: row.raw_item_id || null,
      time: formatApiTime(row.event_time),
      ticker,
      title: row.calendar_title?.trim() || calendarTypeLabels[typeCode] || toTitleLabel(typeCode),
      type: calendarTypeLabels[typeCode] || toTitleLabel(typeCode),
      category: calendarGroupLabels[groupCode] || toTitleLabel(groupCode),
      tone: calendarGroupTones[groupCode] || "release",
      impact: confidenceToImpact(row.confidence),
      status: normalizeCalendarStatusLabel(row.calendar_status),
      companyName: row.company_name || null,
      sourceEventId: row.source_event_id || null,
      sourceGroup: row.source_group || null,
      sourceUrl: row.source_url || null,
      confirmationSource: row.confirmation_source || null,
      evidence: row.evidence || null,
      eventDateIso: dateValue,
      eventTimezone: row.event_timezone || null,
      calendarEventKey: row.calendar_event_key || null,
      earnings: extractEarningsSnapshot(row),
    };

    const existing = byDate.get(dateParts.date);
    if (existing) {
      existing.events.push(event);
    } else if (isDisplayDateWithinRange(dateValue, range)) {
      byDate.set(dateParts.date, {
        day: dateParts.day,
        date: dateParts.date,
        events: [event],
      });
    }
  }

  return Array.from(byDate.values()).map((day) => ({
    ...day,
    events: day.events.sort(compareCalendarEvents),
  }));
}

function buildCalendarDateRange(range: { from: string; to: string }): CalendarDay[] {
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (!from || !to) return [];

  const includeWeekend = range.from === range.to;
  const days: CalendarDay[] = [];
  const cursor = new Date(from);

  while (cursor.getTime() <= to.getTime()) {
    const dayOfWeek = cursor.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (includeWeekend || !isWeekend) {
      days.push({ ...formatDateParts(cursor), events: [] });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isDateWithinRange(value: string, range: { from: string; to: string }) {
  const date = parseIsoDate(value);
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (!date || !from || !to) return false;
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

function isDisplayDateWithinRange(value: string, range: { from: string; to: string }) {
  const date = parseIsoDate(value);
  if (!date || !isDateWithinRange(value, range)) return false;
  if (range.from === range.to) return true;
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

function formatDateParts(date: Date) {
  const day = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { day, date: label };
}

function formatLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildDateRanges(anchor = new Date()): Record<DateRangeKey, CalendarDateRange> {
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    today: { from: formatLocalIsoDate(today), to: formatLocalIsoDate(today), label: "Today" },
    week: { from: formatLocalIsoDate(today), to: formatLocalIsoDate(addLocalDays(today, 6)), label: "Week" },
    month: { from: formatLocalIsoDate(monthStart), to: formatLocalIsoDate(monthEnd), label: "Month" },
  };
}

function isIsoDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function startOfMonthIso(value: string) {
  const date = parseIsoDate(value);
  if (!date) return formatLocalIsoDate(new Date());
  return formatLocalIsoDate(new Date(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonthsIso(value: string, months: number) {
  const date = parseIsoDate(value);
  if (!date) return formatLocalIsoDate(new Date());
  return formatLocalIsoDate(new Date(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function getMonthRange(value: string): CalendarDateRange {
  const date = parseIsoDate(value) || new Date();
  const monthStart = new Date(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const monthEnd = new Date(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
  return {
    from: formatLocalIsoDate(monthStart),
    to: formatLocalIsoDate(monthEnd),
    label: "Month",
  };
}

function buildMiniCalendar(monthIso: string): { label: string; cells: MiniCalendarCell[] } {
  const monthStart = parseIsoDate(startOfMonthIso(monthIso)) || new Date();
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const cursor = new Date(firstDay);
  cursor.setUTCDate(cursor.getUTCDate() - mondayOffset);

  const cells: MiniCalendarCell[] = [];
  for (let index = 0; index < 35; index += 1) {
    cells.push({
      isoDate: formatLocalIsoDate(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate())),
      day: String(cursor.getUTCDate()),
      muted: cursor.getUTCMonth() !== month,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    label: monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    cells,
  };
}

function calendarRangeHref(rangeKey: DateRangeKey, anchorIso?: string | null) {
  if (rangeKey === "month" && isIsoDate(anchorIso)) return calendarMonthHref(anchorIso || "");
  if (rangeKey === "week" && isIsoDate(anchorIso)) return `/calendar?range=week&anchor=${anchorIso}`;
  if (rangeKey === "today" && isIsoDate(anchorIso)) return calendarDateHref(anchorIso || "");
  return `/calendar?range=${rangeKey}`;
}

function calendarDateHref(dateIso: string) {
  return `/calendar?date=${dateIso}`;
}

function calendarMonthHref(monthIso: string) {
  const range = getMonthRange(monthIso);
  return `/calendar?range=month&month=${range.from.slice(0, 7)}`;
}

function pushCalendarUrl(href: string) {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", href);
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent) {
  return timeRank(a.time) - timeRank(b.time) || a.ticker.localeCompare(b.ticker);
}

function timeRank(time: string) {
  if (time === "Pre-Market") return 300;
  if (time === "Market Open") return 570;
  if (time === "Market Close") return 960;
  if (time === "After-Hours") return 1_100;
  const match = time.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/);
  if (!match) return 1_500;
  const hour = Number(match[1]) % 12;
  const minute = Number(match[2]);
  return hour * 60 + minute + (match[3] === "PM" ? 720 : 0);
}

function formatApiDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return null;
  return formatDateParts(date);
}

function formatDateLabel(value: string) {
  return formatApiDate(value)?.date || "May 18";
}

function formatCalendarRangeLabel(range: CalendarDateRange) {
  const fromDate = parseIsoDate(range.from);
  const toDate = parseIsoDate(range.to);
  const from = formatDateLabel(range.from);
  const to = formatDateLabel(range.to);
  const fromYear = fromDate?.getUTCFullYear();
  const toYear = toDate?.getUTCFullYear();
  if (from === to) return `${from}, ${fromYear || ""}`.trim();
  if (fromYear && toYear && fromYear !== toYear) return `${from}, ${fromYear} - ${to}, ${toYear}`;
  return `${from} - ${to}, ${toYear || fromYear || ""}`.trim();
}

function formatApiTime(value?: string | null) {
  if (!value) return "TBD";
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return "TBD";
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${period}`;
}

function normalizeApiTicker(value?: string | null) {
  return value?.trim().toUpperCase() || "MARKET";
}

function normalizeCalendarStatusLabel(value?: string | null): CalendarStatusLabel {
  const status = value?.trim().toLowerCase();
  if (status === "confirmed") return "Confirmed";
  if (status === "superseded") return "Superseded";
  if (status === "cancelled") return "Cancelled";
  return "Tentative";
}

function confidenceToImpact(value?: string | null): CalendarImpact {
  const confidence = value?.trim().toLowerCase();
  if (confidence === "high") return "High";
  if (confidence === "low") return "Low";
  return "Medium";
}

function toTitleLabel(value: string) {
  return value
    .split(/[_\s/.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

const calendarSnapshot = [
  { label: "Earnings", tone: "release" },
  { label: "IPO / SPAC", tone: "ipo" },
  { label: "Listing Risk", tone: "risk" },
  { label: "FDA & Clinical", tone: "fda" },
];

function isEarningsEvent(event: CalendarEvent) {
  return event.category === "Earnings" || event.type.toLowerCase().includes("earnings");
}

function extractEarningsSnapshot(row: CalendarApiItem): EarningsSnapshot | null {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const earningsMeta = readRecord(metadata, "earnings")
    || readRecord(metadata, "earnings_estimates")
    || readRecord(metadata, "earningsEstimate")
    || readRecord(metadata, "earnings_estimate");
  const fmpMeta = readRecord(metadata, "fmp")
    || readRecord(metadata, "fmp_earnings")
    || readRecord(metadata, "fmpEarnings");

  const snapshot: EarningsSnapshot = {
    marketCap: readNumberLike(row.market_cap)
      ?? readNumberLike(row.marketCap)
      ?? readNumberLike(earningsMeta?.market_cap)
      ?? readNumberLike(earningsMeta?.marketCap)
      ?? readNumberLike(fmpMeta?.market_cap)
      ?? readNumberLike(fmpMeta?.marketCap),
    fiscalQuarterEnding: row.fiscal_quarter_ending
      || row.fiscalQuarterEnding
      || row.fiscal_period_ending
      || row.fiscalPeriodEnding
      || readStringLike(earningsMeta?.fiscal_quarter_ending)
      || readStringLike(earningsMeta?.fiscalQuarterEnding)
      || readStringLike(earningsMeta?.fiscal_period_ending)
      || readStringLike(earningsMeta?.fiscalPeriodEnding)
      || readStringLike(fmpMeta?.fiscal_quarter_ending)
      || readStringLike(fmpMeta?.fiscalQuarterEnding)
      || null,
    revenueEstimate: readNumberLike(row.revenue_estimate)
      ?? readNumberLike(row.revenueEstimate)
      ?? readNumberLike(earningsMeta?.revenue_estimate)
      ?? readNumberLike(earningsMeta?.revenueEstimated)
      ?? readNumberLike(earningsMeta?.revenueEstimate)
      ?? readNumberLike(fmpMeta?.revenue_estimate)
      ?? readNumberLike(fmpMeta?.revenueEstimated)
      ?? readNumberLike(fmpMeta?.revenueEstimate),
    epsEstimate: readNumberLike(row.eps_estimate)
      ?? readNumberLike(row.epsEstimate)
      ?? readNumberLike(earningsMeta?.eps_estimate)
      ?? readNumberLike(earningsMeta?.epsEstimated)
      ?? readNumberLike(earningsMeta?.epsEstimate)
      ?? readNumberLike(fmpMeta?.eps_estimate)
      ?? readNumberLike(fmpMeta?.epsEstimated)
      ?? readNumberLike(fmpMeta?.epsEstimate),
    lastYearReportDate: row.last_year_report_date
      || row.lastYearReportDate
      || readStringLike(earningsMeta?.last_year_report_date)
      || readStringLike(earningsMeta?.lastYearReportDate)
      || readStringLike(fmpMeta?.last_year_report_date)
      || readStringLike(fmpMeta?.lastYearReportDate)
      || null,
    lastYearEps: readNumberLike(row.last_year_eps)
      ?? readNumberLike(row.lastYearEps)
      ?? readNumberLike(earningsMeta?.last_year_eps)
      ?? readNumberLike(earningsMeta?.lastYearEps)
      ?? readNumberLike(fmpMeta?.last_year_eps)
      ?? readNumberLike(fmpMeta?.lastYearEps),
    revenueActual: readNumberLike(row.revenue_actual)
      ?? readNumberLike(row.revenueActual)
      ?? readNumberLike(earningsMeta?.revenue_actual)
      ?? readNumberLike(earningsMeta?.revenueActual)
      ?? readNumberLike(fmpMeta?.revenue_actual)
      ?? readNumberLike(fmpMeta?.revenueActual),
    epsActual: readNumberLike(row.eps_actual)
      ?? readNumberLike(row.epsActual)
      ?? readNumberLike(earningsMeta?.eps_actual)
      ?? readNumberLike(earningsMeta?.epsActual)
      ?? readNumberLike(fmpMeta?.eps_actual)
      ?? readNumberLike(fmpMeta?.epsActual),
    revenueEstimateChangePct: readNumberLike(row.revenue_estimate_change_pct)
      ?? readNumberLike(row.revenueEstimateChangePct)
      ?? readNumberLike(earningsMeta?.revenue_estimate_change_pct)
      ?? readNumberLike(earningsMeta?.revenueEstimatedChangePct)
      ?? readNumberLike(earningsMeta?.revenueEstimateChangePct)
      ?? readNumberLike(fmpMeta?.revenue_estimate_change_pct)
      ?? readNumberLike(fmpMeta?.revenueEstimateChangePct)
      ?? readNumberLike(fmpMeta?.revenueEstimatedChangePct),
    epsEstimateChangePct: readNumberLike(row.eps_estimate_change_pct)
      ?? readNumberLike(row.epsEstimateChangePct)
      ?? readNumberLike(earningsMeta?.eps_estimate_change_pct)
      ?? readNumberLike(earningsMeta?.epsEstimatedChangePct)
      ?? readNumberLike(earningsMeta?.epsEstimateChangePct)
      ?? readNumberLike(fmpMeta?.eps_estimate_change_pct)
      ?? readNumberLike(fmpMeta?.epsEstimateChangePct)
      ?? readNumberLike(fmpMeta?.epsEstimatedChangePct),
    revenueSurprisePct: readNumberLike(row.revenue_surprise_pct)
      ?? readNumberLike(row.revenueSurprisePct)
      ?? readNumberLike(earningsMeta?.revenue_surprise_pct)
      ?? readNumberLike(earningsMeta?.revenueSurprisePct)
      ?? readNumberLike(fmpMeta?.revenue_surprise_pct)
      ?? readNumberLike(fmpMeta?.revenueSurprisePct),
    epsSurprisePct: readNumberLike(row.eps_surprise_pct)
      ?? readNumberLike(row.epsSurprisePct)
      ?? readNumberLike(earningsMeta?.eps_surprise_pct)
      ?? readNumberLike(earningsMeta?.epsSurprisePct)
      ?? readNumberLike(fmpMeta?.eps_surprise_pct)
      ?? readNumberLike(fmpMeta?.epsSurprisePct),
    lastUpdated: row.earnings_last_updated
      || row.earningsLastUpdated
      || readStringLike(earningsMeta?.last_updated)
      || readStringLike(earningsMeta?.lastUpdated)
      || readStringLike(fmpMeta?.last_updated)
      || readStringLike(fmpMeta?.lastUpdated)
      || null,
  };

  return Object.values(snapshot).some((value) => value !== null) ? snapshot : null;
}

function readRecord(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readNumberLike(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,%\s,]/g, "");
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStringLike(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEstimateValue(value: number | null, type: "revenue" | "eps") {
  if (value === null) return "-";
  if (type === "eps") {
    return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`;
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatMarketCapValue(value: number | null) {
  if (value === null) return "-";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatTextValue(value: string | null) {
  return value?.trim() || "-";
}

function formatDateTextValue(value: string | null) {
  const text = value?.trim();
  if (!text) return "-";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPctValue(value: number | null) {
  if (value === null) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function estimateClassName(value: number | null) {
  if (value === null) return "";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function getEventContext(event: CalendarEvent) {
  const fallback = tickerFilterMeta[event.ticker] || { exchange: "NASDAQ", marketCap: "Small" };
  return (
    tickerContextMeta[event.ticker] || {
      company: event.ticker,
      sector: "Unclassified",
      industry: "Unclassified",
      marketCap: fallback.marketCap,
      exchange: fallback.exchange,
      priceMove: "N/A",
    }
  );
}

function getTickerSchedule(event: CalendarListEvent, events: CalendarListEvent[]) {
  return events
    .filter((item) => item.ticker === event.ticker)
    .slice(0, 6);
}

function relatedNewsHref(ticker: string) {
  return `/news?query=${encodeURIComponent(ticker)}`;
}

function relatedFilingHref(ticker: string) {
  return `/filings?query=${encodeURIComponent(ticker)}`;
}

function getNewsDetailHref(event: CalendarEvent) {
  return event.sourceEventId ? `/events/${event.sourceEventId}` : relatedNewsHref(event.ticker);
}

function getFilingDetailHref(event: CalendarEvent) {
  return event.sourceEventId ? `/filings/${event.sourceEventId}` : relatedFilingHref(event.ticker);
}

function getCalendarSourceLinks(event: CalendarEvent) {
  if (event.sourceGroup === "filings") {
    return [{ label: "Filings", href: getFilingDetailHref(event) }];
  }
  if (event.sourceGroup === "news") {
    return [{ label: "News", href: getNewsDetailHref(event) }];
  }
  return [];
}

function getCalendarEventKey(
  event: Pick<CalendarListEvent, "date" | "ticker" | "time" | "title" | "id" | "calendarEventKey">,
) {
  if (event.id) return event.id;
  if (event.calendarEventKey) return event.calendarEventKey;
  return `${event.date}-${event.ticker}-${event.time}-${event.title}`;
}

function getEventDetailHref(event: CalendarEvent) {
  if (event.sourceGroup === "filings") return getFilingDetailHref(event);
  if (event.sourceGroup === "news") return getNewsDetailHref(event);
  return event.sourceEventId ? `/events/${event.sourceEventId}` : relatedNewsHref(event.ticker);
}

function getEventDetailLabel(event: CalendarEvent) {
  if (event.sourceGroup === "filings") return "Filing Page";
  if (event.sourceGroup === "news") return "News Page";
  return "Event Page";
}

function getOriginalSourceLabel(event: CalendarEvent) {
  if (event.sourceGroup === "filings") return "Original Filing";
  if (event.sourceGroup === "news") return "Original Source";
  return "Source";
}

function formatFilterValue(values: string[]) {
  if (!values.length) return "All";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

function countActiveFilters(filters: FilterState, watchlistOnly: boolean) {
  return Object.values(filters).reduce((total, values) => total + values.length, watchlistOnly ? 1 : 0);
}

function filterStatesEqual(left: FilterState, right: FilterState) {
  return (Object.keys(filterConfig) as FilterKey[]).every((key) => {
    if (left[key].length !== right[key].length) return false;
    return left[key].every((value) => right[key].includes(value));
  });
}

function eventPassesAppliedFilters(event: CalendarEvent, filters: FilterState, watchlistOnly: boolean) {
  if (watchlistOnly && !watchlistTickers.includes(event.ticker)) return false;
  if (filters.exchange.length && !filters.exchange.includes(getEventExchange(event.ticker))) return false;
  if (filters.marketCap.length && !filters.marketCap.includes(getEventMarketCap(event.ticker))) return false;
  if (filters.status.length && !filters.status.includes(event.status)) return false;
  if (filters.timing.length && !filters.timing.includes(getTimingBucket(event.time))) return false;
  if (filters.impact.length && !filters.impact.includes(event.impact)) return false;

  return true;
}

function eventMatchesSearch(event: CalendarEvent, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;

  return [
    event.ticker,
    event.title,
    event.type,
    event.category,
    event.companyName,
    event.sourceGroup,
    event.confirmationSource,
    event.evidence,
  ].some((value) => value?.toLowerCase().includes(query));
}

function getTimingBucket(time: string) {
  if (time === "Pre-Market") return "Pre-Market";
  if (time === "After-Hours" || time === "Market Close") return "After-Hours";
  if (/^\d{1,2}:\d{2}\s(?:AM|PM)$/.test(time)) return "Market Hours";
  return "TBD";
}

function getEventExchange(ticker: string) {
  return tickerFilterMeta[ticker]?.exchange || "Unclassified";
}

function getEventMarketCap(ticker: string) {
  return tickerFilterMeta[ticker]?.marketCap || "Unclassified";
}

export type CalendarClientProps = {
  initialRows?: CalendarApiItem[];
  initialDateRanges?: Record<DateRangeKey, CalendarDateRange>;
  initialRangeKey?: DateRangeKey;
  initialSelectedDateIso?: string | null;
  initialSearchQuery?: string;
};

export default function CalendarClient({
  initialRows = [],
  initialDateRanges,
  initialRangeKey = "week",
  initialSelectedDateIso = null,
  initialSearchQuery = "",
}: CalendarClientProps = {}) {
  const filterToolbarRef = useRef<HTMLDivElement | null>(null);
  const rangeControlRef = useRef<HTMLDetailsElement | null>(null);
  const dateRanges = useMemo(() => initialDateRanges || buildDateRanges(), [initialDateRanges]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [dateRange, setDateRange] = useState<DateRangeKey>(initialRangeKey);
  const [monthRange, setMonthRange] = useState<CalendarDateRange>(() => dateRanges.month);
  const [selectedDateIso, setSelectedDateIso] = useState<string | null>(initialSelectedDateIso);
  const [selectedEvent, setSelectedEvent] = useState<CalendarListEvent | null>(null);
  const activeRange = useMemo(
    () =>
      selectedDateIso
        ? { from: selectedDateIso, to: selectedDateIso, label: "Day" }
        : dateRange === "month"
          ? monthRange
          : dateRanges[dateRange],
    [dateRange, dateRanges, monthRange, selectedDateIso],
  );
  const initialCalendarDays = useMemo(
    () => mapCalendarApiRows(initialRows, activeRange),
    [activeRange, initialRows],
  );
  const [apiCalendarDays, setApiCalendarDays] = useState<CalendarDay[] | null>(initialCalendarDays);
  const [calendarLoadState, setCalendarLoadState] = useState<CalendarLoadState>("ready");
  const usedInitialRowsRef = useRef(true);
  const [miniMonthIso, setMiniMonthIso] = useState(() => startOfMonthIso(activeRange.from));
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [draftFilters, setDraftFilters] = useState<FilterState>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(emptyFilters);
  const [draftWatchlistOnly, setDraftWatchlistOnly] = useState(false);
  const [appliedWatchlistOnly, setAppliedWatchlistOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const range = activeRange;

    async function loadCalendarItems() {
      if (usedInitialRowsRef.current) {
        usedInitialRowsRef.current = false;
        return;
      }
      setCalendarLoadState("loading");
      try {
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          limit: dateRange === "month" ? "500" : "100",
        });
        const response = await fetch(`/api/calendar?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as { data?: CalendarApiItem[] };
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (!cancelled) {
          setApiCalendarDays(mapCalendarApiRows(rows, range));
          setCalendarLoadState("ready");
        }
      } catch {
        if (!cancelled) {
          setApiCalendarDays(buildCalendarDateRange(range));
          setCalendarLoadState("error");
        }
      }
    }

    loadCalendarItems();

    return () => {
      cancelled = true;
    };
  }, [activeRange, dateRange]);

  useEffect(() => {
    setMiniMonthIso(startOfMonthIso(activeRange.from));
  }, [activeRange.from]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rangeControlRef.current?.contains(target)) return;
      if (filterToolbarRef.current?.contains(target)) return;
      setOpenFilter(null);
      rangeControlRef.current?.removeAttribute("open");
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFilter(null);
        rangeControlRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const displayedCalendarDays = apiCalendarDays !== null ? apiCalendarDays : buildCalendarDateRange(activeRange);
  const focusDate = formatDateLabel(activeRange.from);
  const miniCalendarData = useMemo(() => buildMiniCalendar(miniMonthIso), [miniMonthIso]);
  const focusDayNumber = focusDate.split(" ")[1] || "19";
  const calendarRangeLabel = formatCalendarRangeLabel(activeRange);
  const baseFilteredDays = useMemo(
    () =>
      displayedCalendarDays.map((day) => ({
        ...day,
        events: day.events.filter(
          (event) => eventPassesAppliedFilters(event, appliedFilters, appliedWatchlistOnly) && eventMatchesSearch(event, searchQuery),
        ),
      })),
    [appliedFilters, appliedWatchlistOnly, displayedCalendarDays, searchQuery],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const day of baseFilteredDays) {
      for (const event of day.events) {
        total += 1;
        counts.set(event.category, (counts.get(event.category) || 0) + 1);
      }
    }
    counts.set("All", total);
    return counts;
  }, [baseFilteredDays]);
  const filteredDays = useMemo(
    () =>
      baseFilteredDays.map((day) => ({
        ...day,
        events: activeCategory === "All" ? day.events : day.events.filter((event) => event.category === activeCategory),
      })),
    [activeCategory, baseFilteredDays],
  );
  const listItems = useMemo(
    () =>
      filteredDays.flatMap((day) =>
        day.events.map((event) => ({
          ...event,
          day: day.day,
          date: day.date,
        })),
      ),
    [filteredDays],
  );
  const listRows = useMemo(
    () =>
      listItems.map((event, index) => ({
        ...event,
        showDate: index === 0 || listItems[index - 1]?.date !== event.date,
      })),
    [listItems],
  );
  const allListItems = useMemo(
    () =>
      baseFilteredDays.flatMap((day) =>
        day.events.map((event) => ({
          ...event,
          day: day.day,
          date: day.date,
        })),
      ),
    [baseFilteredDays],
  );
  const miniCalendarEventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of allListItems) {
      const isoDate = event.eventDateIso?.slice(0, 10);
      if (isoDate) counts.set(isoDate, (counts.get(isoDate) || 0) + 1);
    }
    return counts;
  }, [allListItems]);
  const todaysKeyEvents = useMemo(
    () =>
      allListItems
        .filter((event) => event.date === focusDate)
        .sort((a, b) => (a.impact === "High" && b.impact !== "High" ? -1 : 0))
        .slice(0, 3),
    [allListItems, focusDate],
  );
  const pendingConfirmations = useMemo(
    () => allListItems.filter((event) => event.status === "Tentative").slice(0, 4),
    [allListItems],
  );
  const highImpactItems = useMemo(() => {
    return allListItems.filter((event) => event.impact === "High").slice(0, 3);
  }, [allListItems]);
  const watchlistItems = useMemo(() => {
    return allListItems.filter((event) => watchlistTickers.includes(event.ticker)).slice(0, 3);
  }, [allListItems]);
  const activeFilterCount = countActiveFilters(appliedFilters, appliedWatchlistOnly);
  const hasDraftChanges = !filterStatesEqual(draftFilters, appliedFilters) || draftWatchlistOnly !== appliedWatchlistOnly;
  const primarySideItems = highImpactItems.length ? highImpactItems : allListItems.slice(0, 3);
  const primarySideTitle = highImpactItems.length ? "High-Impact Events" : "Upcoming Events";
  const todayDateLabel = formatDateLabel(dateRanges.today.from);
  const focusPanelTitle = focusDate === todayDateLabel ? "Today's Key Events" : focusDate;
  const focusEmptyMessage = focusDate === todayDateLabel ? "No key events today." : "No events on this date.";
  const rangeSnapshotTitle = selectedDateIso
    ? "Day Snapshot"
    : dateRange === "month"
      ? "Month Snapshot"
      : dateRange === "today"
        ? "Today Snapshot"
        : "Week Snapshot";
  const emptyMessage =
    calendarLoadState === "loading"
      ? "Loading calendar items..."
      : calendarLoadState === "error"
        ? "Calendar data could not be loaded. Showing an empty range."
        : searchQuery.trim()
          ? "No calendar items match this search and filter."
        : (categoryCounts.get("All") || 0) === 0
          ? "No scheduled market calendar items in this range yet."
          : "No calendar items match this category and filter.";

  function selectCategory(label: string) {
    setActiveCategory(label);
  }

  function selectDateRange(nextRange: DateRangeKey) {
    const anchorIso = selectedDateIso || miniMonthIso || activeRange.from;
    if (nextRange === "month") {
      const nextMonthRange = getMonthRange(anchorIso);
      setMonthRange(nextMonthRange);
      setMiniMonthIso(nextMonthRange.from);
    } else {
      setMiniMonthIso(startOfMonthIso(dateRanges[nextRange].from));
    }
    setDateRange(nextRange);
    setSelectedDateIso(null);
    setSelectedEvent(null);
    rangeControlRef.current?.removeAttribute("open");
    pushCalendarUrl(calendarRangeHref(nextRange, anchorIso));
  }

  function selectCalendarDate(dateIso: string) {
    if (!isIsoDate(dateIso)) return;
    setSelectedDateIso(dateIso);
    setSelectedEvent(null);
    setMiniMonthIso(startOfMonthIso(dateIso));
    rangeControlRef.current?.removeAttribute("open");
    pushCalendarUrl(calendarDateHref(dateIso));
  }

  function selectCalendarMonth(monthIso: string) {
    const nextMonthRange = getMonthRange(monthIso);
    setMiniMonthIso(nextMonthRange.from);
    if (dateRange === "month" && !selectedDateIso) {
      setMonthRange(nextMonthRange);
      setSelectedEvent(null);
      pushCalendarUrl(calendarMonthHref(nextMonthRange.from));
    }
  }

  function selectEvent(event: CalendarListEvent) {
    setSelectedEvent(event);
  }

  function toggleDraftFilter(key: FilterKey, option: string) {
    setDraftFilters((current) => {
      const selected = new Set(current[key]);
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }
      return {
        ...current,
        [key]: Array.from(selected),
      };
    });
  }

  function applyFilters() {
    setAppliedFilters(draftFilters);
    setAppliedWatchlistOnly(draftWatchlistOnly);
    setOpenFilter(null);
  }

  function resetFilters() {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setDraftWatchlistOnly(false);
    setAppliedWatchlistOnly(false);
    setOpenFilter(null);
  }

  return (
    <main className="market-calendar-page">
      <header className="feed-nav calendar-nav">
        <a className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </a>
        <nav className="feed-nav-links" aria-label="Primary">
          <a href="/feed">Live Feed</a>
          <a href="/watchlist">Watchlist</a>
          <a href="/news">News</a>
          <a href="/filings">Filings</a>
          <a href="/alerts">Alerts</a>
          <a className="active" href="/calendar">
            Calendar
          </a>
          <a href="/premium">Premium</a>
        </nav>
        <form className="feed-search" action="/calendar" method="get">
          <span>/</span>
          {selectedDateIso ? (
            <input type="hidden" name="date" value={selectedDateIso} />
          ) : (
            <>
              <input type="hidden" name="range" value={dateRange} />
              {dateRange === "month" ? <input type="hidden" name="month" value={activeRange.from.slice(0, 7)} /> : null}
            </>
          )}
          <input
            name="q"
            type="search"
            aria-label="Search calendar"
            placeholder="Search stocks, companies, events..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </form>
        <div className="feed-actions">
          <button className="icon-button" type="button" aria-label="Notifications">
            !
            <span className="notification-dot">3</span>
          </button>
          <button className="avatar-button" type="button">
            N
          </button>
        </div>
      </header>

      <section className="market-calendar-shell">
        <div className="market-calendar-hero">
          <div>
            <h1>Market Calendar</h1>
            <p>Browse upcoming corporate, regulatory, and market-moving events by category.</p>
          </div>
          <div className="market-calendar-controls">
            <details className="calendar-range-control" ref={rangeControlRef}>
              <summary className="calendar-range-button" aria-haspopup="menu">
                <CalendarDays size={16} />
                <span>{calendarRangeLabel}</span>
                <ChevronDown size={15} />
              </summary>
              <div className="calendar-range-menu" role="menu" aria-label="Calendar date range">
                {(Object.keys(dateRanges) as DateRangeKey[]).map((rangeKey) => {
                  const anchorIso = selectedDateIso || activeRange.from;
                  const displayRange =
                    rangeKey === "month" && isIsoDate(anchorIso) ? getMonthRange(anchorIso) : dateRanges[rangeKey];
                  return (
                    <a
                      href={calendarRangeHref(rangeKey, anchorIso)}
                      role="menuitem"
                      className={!selectedDateIso && dateRange === rangeKey ? "active" : ""}
                      key={rangeKey}
                      onClick={(event) => {
                        event.preventDefault();
                        selectDateRange(rangeKey);
                      }}
                    >
                      <span>{displayRange.label}</span>
                      <b>{formatCalendarRangeLabel(displayRange)}</b>
                    </a>
                  );
                })}
              </div>
            </details>
            <a
              href={calendarRangeHref("today", activeRange.from)}
              className={!selectedDateIso && dateRange === "today" ? "active" : ""}
              onClick={(event) => {
                event.preventDefault();
                selectDateRange("today");
              }}
            >
              Today
            </a>
            <a
              href={calendarRangeHref("week", activeRange.from)}
              className={!selectedDateIso && dateRange === "week" ? "active" : ""}
              onClick={(event) => {
                event.preventDefault();
                selectDateRange("week");
              }}
            >
              Week
            </a>
            <a
              href={calendarRangeHref("month", selectedDateIso || activeRange.from)}
              className={!selectedDateIso && dateRange === "month" ? "active" : ""}
              onClick={(event) => {
                event.preventDefault();
                selectDateRange("month");
              }}
            >
              Month
            </a>
          </div>
        </div>

        <div className="calendar-category-tabs" aria-label="Calendar event categories">
          {categoryTabs.map((tab) => (
            <button
              type="button"
              className={activeCategory === tab.label ? "active" : ""}
              key={tab.label}
              onClick={() => selectCategory(tab.label)}
            >
              <span>{tab.label}</span>
              <b>{categoryCounts.get(tab.label) || 0}</b>
            </button>
          ))}
        </div>

        <div className="calendar-workspace">
          <aside className="calendar-left-rail">
            <section className="calendar-mini-panel">
              <div className="mini-calendar-head">
                <a
                  href={calendarMonthHref(addMonthsIso(miniMonthIso, -1))}
                  aria-label="Previous month"
                  onClick={(event) => {
                    event.preventDefault();
                    selectCalendarMonth(addMonthsIso(miniMonthIso, -1));
                  }}
                >
                  <ChevronLeft size={16} />
                </a>
                <strong>{miniCalendarData.label}</strong>
                <a
                  href={calendarMonthHref(addMonthsIso(miniMonthIso, 1))}
                  aria-label="Next month"
                  onClick={(event) => {
                    event.preventDefault();
                    selectCalendarMonth(addMonthsIso(miniMonthIso, 1));
                  }}
                >
                  <ChevronRight size={16} />
                </a>
              </div>
              <div className="mini-calendar-grid" aria-label={`${miniCalendarData.label} mini calendar`}>
                {miniCalendarWeekdays.map((day) => (
                  <span className="mini-calendar-weekday" key={day}>
                    {day}
                  </span>
                ))}
                {miniCalendarData.cells.map((cell) => {
                  const eventCount = miniCalendarEventCounts.get(cell.isoDate) || 0;
                  return (
                    <a
                      href={calendarDateHref(cell.isoDate)}
                      className={`${formatDateLabel(cell.isoDate) === focusDate ? "selected" : ""} ${
                        cell.muted ? "muted" : ""
                      } ${eventCount ? "has-events" : ""}`}
                      key={cell.isoDate}
                      title={eventCount ? `${eventCount} calendar item${eventCount === 1 ? "" : "s"}` : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        selectCalendarDate(cell.isoDate);
                      }}
                    >
                      {cell.day}
                    </a>
                  );
                })}
              </div>
            </section>

            <section className="calendar-left-list">
              <h2>{focusPanelTitle}</h2>
              <div className="calendar-left-event-list">
                {todaysKeyEvents.length ? (
                  todaysKeyEvents.map((event) => (
                    <button
                      type="button"
                      key={getCalendarEventKey(event)}
                      onClick={() => selectEvent(event)}
                    >
                      <span>{event.time}</span>
                      <strong>{event.ticker}</strong>
                      <p>{event.title}</p>
                    </button>
                  ))
                ) : (
                  <p className="calendar-left-empty">{focusEmptyMessage}</p>
                )}
              </div>
            </section>

            <section className="calendar-left-list">
              <h2>Pending Confirmations</h2>
              <div className="calendar-left-event-list">
                {pendingConfirmations.length ? (
                  pendingConfirmations.map((event) => (
                    <button
                      type="button"
                      key={getCalendarEventKey(event)}
                      onClick={() => selectEvent(event)}
                    >
                      <span>{event.date}</span>
                      <strong>{event.ticker}</strong>
                      <p>{event.type}</p>
                    </button>
                  ))
                ) : (
                  <p className="calendar-left-empty">No pending items.</p>
                )}
              </div>
            </section>
          </aside>

          <section className="calendar-board-panel">
            <div className="calendar-filter-toolbar" ref={filterToolbarRef}>
              {(Object.keys(filterConfig) as FilterKey[]).map((key) => (
                <div className="calendar-filter-menu" key={key}>
                  <button
                    type="button"
                    className={draftFilters[key].length ? "active" : ""}
                    onClick={() => setOpenFilter(openFilter === key ? null : key)}
                  >
                    <span>{filterConfig[key].label}</span>
                    <b>{formatFilterValue(draftFilters[key])}</b>
                    <ChevronDown size={13} />
                  </button>
                  {openFilter === key ? (
                    <div className="calendar-filter-popover">
                      <strong>{filterConfig[key].label}</strong>
                      {filterConfig[key].options.map((option) => (
                        <label key={option}>
                          <input
                            type="checkbox"
                            checked={draftFilters[key].includes(option)}
                            onChange={() => toggleDraftFilter(key, option)}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <label className="calendar-watchlist-filter">
                <input
                  type="checkbox"
                  checked={draftWatchlistOnly}
                  onChange={(event) => setDraftWatchlistOnly(event.target.checked)}
                />
                Watchlist Only
              </label>
              <div className="calendar-filter-actions">
                {hasDraftChanges ? <span>Pending changes</span> : activeFilterCount ? <span>{activeFilterCount} active</span> : null}
                <button type="button" onClick={resetFilters}>
                  Reset
                </button>
                <button type="button" className="primary" onClick={applyFilters}>
                  Apply
                </button>
              </div>
            </div>
            {activeFilterCount ? (
              <div className="calendar-active-filters" aria-label="Active calendar filters">
                <span>Active</span>
                {(Object.keys(filterConfig) as FilterKey[]).flatMap((key) =>
                  appliedFilters[key].map((value) => (
                    <b key={`${key}-${value}`}>
                      {filterConfig[key].label}: {value}
                    </b>
                  )),
                )}
                {appliedWatchlistOnly ? <b>Watchlist only</b> : null}
              </div>
            ) : null}

            <div className="calendar-list-board">
              {listRows.length ? (
                listRows.map((event) => (
                  <article
                    className={`calendar-list-row ${
                      selectedEvent && getCalendarEventKey(selectedEvent) === getCalendarEventKey(event) ? "is-selected" : ""
                    }`}
                    key={getCalendarEventKey(event)}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectEvent(event)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                        keyEvent.preventDefault();
                        selectEvent(event);
                      }
                    }}
                  >
                    <span className={`calendar-list-date ${event.showDate ? "" : "time-only"}`}>
                      {event.showDate ? <b>{event.date}</b> : null}
                      <small>{event.time}</small>
                    </span>
                    <strong className="calendar-list-ticker">{event.ticker}</strong>
                    <span className="calendar-list-event">
                      <em className="calendar-list-type">{event.category}</em>
                      <b>{event.title}</b>
                      {getCalendarSourceLinks(event).length ? (
                        <span className="calendar-event-links" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                          {getCalendarSourceLinks(event).map((link) => (
                            <a href={link.href} key={link.label}>
                              {link.label}
                              <ExternalLink size={12} />
                            </a>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="calendar-list-meta">
                      <b className={`impact-${event.impact.toLowerCase()}`}>{event.impact}</b>
                      <small>{event.status}</small>
                    </span>
                  </article>
                ))
              ) : (
                <div className="calendar-empty-list">{emptyMessage}</div>
              )}
            </div>
          </section>

          <aside className="calendar-right-rail">
            {selectedEvent ? (
              <section className="calendar-selected-panel">
                <div className="calendar-panel-title">
                  <h2>Selected Event</h2>
                  <button type="button" aria-label="Close selected event" onClick={() => setSelectedEvent(null)}>
                    x
                  </button>
                </div>
                <span className="calendar-kicker">{selectedEvent.type}</span>
                <h3>{selectedEvent.title}</h3>
                {isEarningsEvent(selectedEvent) ? (
                  <div className="earnings-estimates">
                    <div className="calendar-earnings-list">
                      <span>
                        <small>Company Name</small>
                        <b>{selectedEvent.companyName || "-"}</b>
                      </span>
                      <span>
                        <small>Market Cap</small>
                        <b>{formatMarketCapValue(selectedEvent.earnings?.marketCap ?? null)}</b>
                      </span>
                      <span>
                        <small>Fiscal Quarter Ending</small>
                        <b>{formatTextValue(selectedEvent.earnings?.fiscalQuarterEnding ?? null)}</b>
                      </span>
                      <span>
                        <small>Revenue Est.</small>
                        <b>
                          {formatEstimateValue(selectedEvent.earnings?.revenueEstimate ?? null, "revenue")}
                          <em className={estimateClassName(selectedEvent.earnings?.revenueEstimateChangePct ?? null)}>
                            {formatPctValue(selectedEvent.earnings?.revenueEstimateChangePct ?? null)}
                          </em>
                        </b>
                      </span>
                      <span>
                        <small>Consensus EPS</small>
                        <b>
                          {formatEstimateValue(selectedEvent.earnings?.epsEstimate ?? null, "eps")}
                          <em className={estimateClassName(selectedEvent.earnings?.epsEstimateChangePct ?? null)}>
                            {formatPctValue(selectedEvent.earnings?.epsEstimateChangePct ?? null)}
                          </em>
                        </b>
                      </span>
                      <span>
                        <small>Last Year's Report Date</small>
                        <b>{formatDateTextValue(selectedEvent.earnings?.lastYearReportDate ?? null)}</b>
                      </span>
                      <span>
                        <small>Last Year's EPS</small>
                        <b>{formatEstimateValue(selectedEvent.earnings?.lastYearEps ?? null, "eps")}</b>
                      </span>
                    </div>
                    {selectedEvent.earnings
                    && (selectedEvent.earnings.revenueActual !== null || selectedEvent.earnings.epsActual !== null) ? (
                      <div className="calendar-earnings-list reported">
                        <span>
                          <small>Revenue Actual</small>
                          <b>
                            {formatEstimateValue(selectedEvent.earnings?.revenueActual ?? null, "revenue")}
                            <em className={estimateClassName(selectedEvent.earnings?.revenueSurprisePct ?? null)}>
                              {formatPctValue(selectedEvent.earnings?.revenueSurprisePct ?? null)}
                            </em>
                          </b>
                        </span>
                        <span>
                          <small>EPS Actual</small>
                          <b>
                            {formatEstimateValue(selectedEvent.earnings?.epsActual ?? null, "eps")}
                            <em className={estimateClassName(selectedEvent.earnings?.epsSurprisePct ?? null)}>
                              {formatPctValue(selectedEvent.earnings?.epsSurprisePct ?? null)}
                            </em>
                          </b>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="calendar-selected-section">
                  <div className="calendar-selected-section-title">
                    <h4>{selectedEvent.ticker} Schedule</h4>
                  </div>
                  <div className="calendar-ticker-schedule">
                    {getTickerSchedule(selectedEvent, allListItems).map((scheduleItem) => (
                      <a
                        className={
                          getCalendarEventKey(scheduleItem) === getCalendarEventKey(selectedEvent) ? "is-current" : ""
                        }
                        href={`/calendar?ticker=${encodeURIComponent(selectedEvent.ticker)}`}
                        key={getCalendarEventKey(scheduleItem)}
                        onClick={(clickEvent) => {
                          clickEvent.preventDefault();
                          selectEvent(scheduleItem);
                        }}
                      >
                        <span>
                          <b>{scheduleItem.date}</b>
                          <small>{scheduleItem.time}</small>
                        </span>
                        <strong>
                          {scheduleItem.title}
                          <small>{scheduleItem.type}</small>
                        </strong>
                        <em>{scheduleItem.status}</em>
                      </a>
                    ))}
                  </div>
                </div>
                {selectedEvent.evidence ? (
                  <div className="calendar-selected-section">
                    <h4>Evidence</h4>
                    <p>{selectedEvent.evidence}</p>
                  </div>
                ) : null}
                <div className="calendar-event-links selected">
                  <a href={getEventDetailHref(selectedEvent)}>
                    {getEventDetailLabel(selectedEvent)}
                    <ExternalLink size={12} />
                  </a>
                  {selectedEvent.sourceUrl ? (
                    <a href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer">
                      {getOriginalSourceLabel(selectedEvent)}
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="calendar-side-card">
              <div className="calendar-panel-link-title">
                <h2>{primarySideTitle}</h2>
              </div>
              <div className="calendar-side-event-list">
                {primarySideItems.length ? (
                  primarySideItems.map((event) => (
                    <a href={getEventDetailHref(event)} key={getCalendarEventKey(event)}>
                      <span>
                        <b>{event.ticker}</b>
                        <small>{event.companyName || getEventContext(event).company}</small>
                        <em>{event.title}</em>
                      </span>
                      <strong className={event.impact.toLowerCase()}>{event.impact}</strong>
                      <p>{event.date}</p>
                    </a>
                  ))
                ) : (
                  <p className="calendar-side-empty">No upcoming items in this range.</p>
                )}
              </div>
            </section>

            <section className="calendar-side-card">
              <h2>{rangeSnapshotTitle}</h2>
              <div className="calendar-donut-row">
                <div className="calendar-donut">
                  <strong>{categoryCounts.get("All") || 0}</strong>
                  <span>Total Events</span>
                </div>
                <div className="calendar-donut-legend">
                  {calendarSnapshot.map((item) => (
                    <p key={item.label}>
                      <i className={item.tone} />
                      {item.label}
                      <b>{categoryCounts.get(item.label) || 0}</b>
                    </p>
                  ))}
                </div>
              </div>
            </section>

            <section className="calendar-side-card">
              <div className="calendar-panel-link-title">
                <h2>Watchlist Events</h2>
              </div>
              <div className="calendar-side-event-list watchlist">
                {watchlistItems.length ? (
                  watchlistItems.map((event) => (
                    <a href={getEventDetailHref(event)} key={getCalendarEventKey(event)}>
                      <span>
                        <b>{event.ticker}</b>
                        <small>{event.companyName || getEventContext(event).company}</small>
                        <em>{event.title}</em>
                      </span>
                      <p>{event.date}</p>
                    </a>
                  ))
                ) : (
                  <p className="calendar-side-empty">No watchlist items in this range.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
