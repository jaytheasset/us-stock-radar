"use client";

import { useEffect, useMemo, useState } from "react";
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

const emptyFilters: FilterState = {
  exchange: [],
  marketCap: [],
  status: [],
  timing: [],
  impact: [],
};

const watchlistTickers = ["NVDA", "TSLA", "AAPL", "AMZN"];

const dateRanges: Record<DateRangeKey, { from: string; to: string; label: string }> = {
  today: { from: "2026-05-18", to: "2026-05-18", label: "Today" },
  week: { from: "2026-05-18", to: "2026-05-22", label: "Week" },
  month: { from: "2026-05-01", to: "2026-05-31", label: "Month" },
};

type CalendarImpact = "High" | "Medium" | "Low";
type CalendarStatusLabel = "Confirmed" | "Tentative" | "Superseded" | "Cancelled";

type CalendarEvent = {
  id?: string | null;
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

const miniCalendar = [
  ["28", "29", "30", "1", "2", "3", "4"],
  ["5", "6", "7", "8", "9", "10", "11"],
  ["12", "13", "14", "15", "16", "17", "18"],
  ["19", "20", "21", "22", "23", "24", "25"],
  ["26", "27", "28", "29", "30", "31", "1"],
];

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
  rights_offering_deadline: "Rights Offering Deadline",
  warrant_redemption_deadline: "Warrant Deadline",
  lockup_expiration: "Lock-Up Expiration",
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

function formatCalendarRangeLabel(range: { from: string; to: string }) {
  const from = formatDateLabel(range.from);
  const to = formatDateLabel(range.to);
  if (from === to) return `${from}, 2026`;
  return `${from} - ${to}, 2026`;
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

function getEventSourceNote(event: CalendarEvent) {
  const source = event.confirmationSource?.toLowerCase();
  if (event.status === "Confirmed" && source === "filings") return "Confirmed by SEC filing";
  if (event.status === "Confirmed") return "Confirmed by source";
  if (source === "news") return "News-sourced, pending filing confirmation";
  if (source === "filings") return "Filing-sourced, pending final confirmation";
  if (event.status === "Superseded") return "Superseded by a newer schedule";
  if (event.status === "Cancelled") return "Cancelled schedule";
  return "Pending confirmation";
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

function getCalendarEventKey(
  event: Pick<CalendarListEvent, "date" | "ticker" | "time" | "title" | "id" | "calendarEventKey">,
) {
  if (event.id) return event.id;
  if (event.calendarEventKey) return event.calendarEventKey;
  return `${event.date}-${event.ticker}-${event.time}-${event.title}`;
}

function getEventDetailHref(event: CalendarEvent) {
  return event.sourceEventId ? `/events/${event.sourceEventId}` : relatedNewsHref(event.ticker);
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

function eventPassesAppliedFilters(event: CalendarEvent, filters: FilterState, watchlistOnly: boolean) {
  if (watchlistOnly && !watchlistTickers.includes(event.ticker)) return false;
  if (filters.exchange.length && !filters.exchange.includes(getEventExchange(event.ticker))) return false;
  if (filters.marketCap.length && !filters.marketCap.includes(getEventMarketCap(event.ticker))) return false;
  if (filters.status.length && !filters.status.includes(event.status)) return false;
  if (filters.timing.length && !filters.timing.includes(getTimingBucket(event.time))) return false;
  if (filters.impact.length && !filters.impact.includes(event.impact)) return false;

  return true;
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

export default function CalendarPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"Month" | "Week" | "List">("List");
  const [dateRange, setDateRange] = useState<DateRangeKey>("week");
  const [selectedEvent, setSelectedEvent] = useState<CalendarListEvent | null>(null);
  const [apiCalendarDays, setApiCalendarDays] = useState<CalendarDay[] | null>(null);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [draftFilters, setDraftFilters] = useState<FilterState>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(emptyFilters);
  const [draftWatchlistOnly, setDraftWatchlistOnly] = useState(false);
  const [appliedWatchlistOnly, setAppliedWatchlistOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const range = dateRanges[dateRange];

    async function loadCalendarItems() {
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
        }
      } catch {
        if (!cancelled) setApiCalendarDays(null);
      }
    }

    loadCalendarItems();

    return () => {
      cancelled = true;
    };
  }, [dateRange]);

  const displayedCalendarDays = apiCalendarDays !== null ? apiCalendarDays : buildCalendarDateRange(dateRanges[dateRange]);
  const focusDate = displayedCalendarDays[0]?.date || formatDateLabel(dateRanges[dateRange].from);
  const focusDayNumber = focusDate.split(" ")[1] || "19";
  const calendarRangeLabel = formatCalendarRangeLabel(dateRanges[dateRange]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const day of displayedCalendarDays) {
      for (const event of day.events) {
        total += 1;
        counts.set(event.category, (counts.get(event.category) || 0) + 1);
      }
    }
    counts.set("All", total);
    return counts;
  }, [displayedCalendarDays]);
  const filteredDays = useMemo(
    () =>
      displayedCalendarDays.map((day) => ({
        ...day,
        events: (activeCategory === "All" ? day.events : day.events.filter((event) => event.category === activeCategory)).filter(
          (event) => eventPassesAppliedFilters(event, appliedFilters, appliedWatchlistOnly),
        ),
      })),
    [activeCategory, appliedFilters, appliedWatchlistOnly, displayedCalendarDays],
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
      displayedCalendarDays.flatMap((day) =>
        day.events.map((event) => ({
          ...event,
          day: day.day,
          date: day.date,
        })),
      ),
    [displayedCalendarDays],
  );
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

  function selectCategory(label: string) {
    setActiveCategory(label);
    setViewMode(label === "All" ? "List" : "Week");
  }

  function selectDateRange(nextRange: DateRangeKey) {
    setDateRange(nextRange);
    setSelectedEvent(null);
  }

  function selectViewMode(mode: "Month" | "Week" | "List") {
    setViewMode(mode);
    if (mode === "Month") selectDateRange("month");
    if (mode === "Week") selectDateRange("week");
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
          <a href="#">Watchlist</a>
          <a href="/news">News</a>
          <a href="/filings">Filings</a>
          <a href="#">Alerts</a>
          <a className="active" href="/calendar">
            Calendar
          </a>
          <a href="#">Premium</a>
        </nav>
        <label className="feed-search">
          <span>/</span>
          <input aria-label="Search calendar" placeholder="Search stocks, companies, events..." />
        </label>
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
            <button type="button" className="calendar-range-button">
              <CalendarDays size={16} />
              {calendarRangeLabel}
              <ChevronDown size={15} />
            </button>
            <button type="button" className={dateRange === "today" ? "active" : ""} onClick={() => selectDateRange("today")}>
              Today
            </button>
            <div className="calendar-view-toggle" aria-label="Calendar view">
              {(["Month", "Week", "List"] as const).map((mode) => (
                <button
                  type="button"
                  className={viewMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => selectViewMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
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
                <button type="button" aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <strong>May 2026</strong>
                <button type="button" aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="mini-calendar-grid" aria-label="May 2026 mini calendar">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                  <span className="mini-calendar-weekday" key={day}>
                    {day}
                  </span>
                ))}
                {miniCalendar.flat().map((day, index) => (
                  <button
                    type="button"
                    className={`${day === focusDayNumber ? "selected" : ""} ${index < 3 || index > 33 ? "muted" : ""}`}
                    key={`${day}-${index}`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </section>

            <section className="calendar-left-list">
              <h2>Today's Key Events</h2>
              <div className="calendar-left-event-list">
                {todaysKeyEvents.map((event) => (
                  <button
                    type="button"
                    key={getCalendarEventKey(event)}
                    onClick={() => selectEvent(event)}
                  >
                    <span>{event.time}</span>
                    <strong>{event.ticker}</strong>
                    <p>{event.title}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="calendar-left-list">
              <h2>Pending Confirmations</h2>
              <div className="calendar-left-event-list">
                {pendingConfirmations.map((event) => (
                  <button
                    type="button"
                    key={getCalendarEventKey(event)}
                    onClick={() => selectEvent(event)}
                  >
                    <span>{event.date}</span>
                    <strong>{event.ticker}</strong>
                    <p>{event.type}</p>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="calendar-board-panel">
            <div className="calendar-filter-toolbar">
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
                <button type="button" onClick={resetFilters}>
                  Reset
                </button>
                <button type="button" className="primary" onClick={applyFilters}>
                  Apply
                </button>
              </div>
            </div>

            {viewMode === "List" ? (
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
                        <span className="calendar-event-links" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                          <a href={relatedNewsHref(event.ticker)}>
                            News
                            <ExternalLink size={12} />
                          </a>
                          <a href={relatedFilingHref(event.ticker)}>
                            Filings
                            <ExternalLink size={12} />
                          </a>
                        </span>
                      </span>
                      <span className="calendar-list-meta">
                        <b className={`impact-${event.impact.toLowerCase()}`}>{event.impact}</b>
                        <small>{event.status}</small>
                      </span>
                    </article>
                  ))
                ) : (
                  <div className="calendar-empty-list">No calendar items match this range and filter.</div>
                )}
              </div>
            ) : (
              <div className={`calendar-week-board ${viewMode === "Month" ? "month-mode" : ""}`}>
                {filteredDays.length ? (
                  filteredDays.map((day) => (
                    <article className="calendar-week-column" key={`${day.day}-${day.date}`}>
                      <header>
                        <strong>{day.day}</strong>
                        <span>{day.date}</span>
                      </header>
                      <div className="calendar-column-events">
                        {day.events.length === 0 ? (
                          <div className="calendar-empty-day">No events scheduled</div>
                        ) : (
                          day.events.map((event) => {
                            const eventWithDate = { ...event, day: day.day, date: day.date };
                            return (
                              <article
                                className={`week-event-card ${event.tone} ${
                                  selectedEvent && getCalendarEventKey(selectedEvent) === getCalendarEventKey(eventWithDate)
                                    ? "is-selected"
                                    : ""
                                }`}
                                key={getCalendarEventKey(eventWithDate)}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectEvent(eventWithDate)}
                                onKeyDown={(keyEvent) => {
                                  if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                                    keyEvent.preventDefault();
                                    selectEvent(eventWithDate);
                                  }
                                }}
                              >
                                <span>
                                  <b>{event.time}</b>
                                  <strong>{event.ticker}</strong>
                                </span>
                                <h3>{event.type}</h3>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="calendar-empty-list">No calendar items match this range and filter.</div>
                )}
              </div>
            )}
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
                <p>
                  {selectedEvent.ticker} - {selectedEvent.companyName || getEventContext(selectedEvent).company}
                </p>
                <div className="calendar-selected-facts">
                  <span>
                    {selectedEvent.day}, {selectedEvent.date}, 2026
                  </span>
                  <span>{selectedEvent.time}</span>
                  <span>{getEventSourceNote(selectedEvent)}</span>
                </div>
                <div className="calendar-chip-row">
                  <b>{selectedEvent.category}</b>
                  <b>{selectedEvent.impact} impact</b>
                  <b>{selectedEvent.status}</b>
                </div>
                <div className="calendar-selected-section">
                  <div className="calendar-selected-section-title">
                    <h4>{selectedEvent.ticker} Schedule</h4>
                    <a href={`/calendar?ticker=${encodeURIComponent(selectedEvent.ticker)}`}>View all</a>
                  </div>
                  <div className="calendar-ticker-schedule">
                    {getTickerSchedule(selectedEvent, allListItems).map((scheduleItem) => (
                      <a
                        className={
                          getCalendarEventKey(scheduleItem) === getCalendarEventKey(selectedEvent) ? "is-current" : ""
                        }
                        href={`/calendar?ticker=${encodeURIComponent(selectedEvent.ticker)}`}
                        key={getCalendarEventKey(scheduleItem)}
                        onClick={(clickEvent) => clickEvent.preventDefault()}
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
                    Event Page
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
                <h2>High-Impact Upcoming</h2>
                <a href="#">View all</a>
              </div>
              <div className="calendar-side-event-list">
                {highImpactItems.length ? (
                  highImpactItems.map((event) => (
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
                  <p className="calendar-side-empty">No high-impact items in this range.</p>
                )}
              </div>
            </section>

            <section className="calendar-side-card">
              <h2>This Week Snapshot</h2>
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
                <h2>My Watchlist Events</h2>
                <a href="#">View all</a>
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
