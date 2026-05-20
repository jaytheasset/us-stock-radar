import CalendarClient, { type CalendarClientProps } from "./CalendarClient";
import { supabaseSelect } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type DateRangeKey = "today" | "week" | "month";
type CalendarDateRange = NonNullable<CalendarClientProps["initialDateRanges"]>[DateRangeKey];
type CalendarSearchParams = Record<string, string | string[] | undefined>;

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

function buildInitialDateRanges(anchor = new Date()): Record<DateRangeKey, CalendarDateRange> {
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    today: { from: formatLocalIsoDate(today), to: formatLocalIsoDate(today), label: "Today" },
    week: { from: formatLocalIsoDate(today), to: formatLocalIsoDate(addLocalDays(today, 6)), label: "Week" },
    month: { from: formatLocalIsoDate(monthStart), to: formatLocalIsoDate(monthEnd), label: "Month" },
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeDateParam(value: string | string[] | undefined) {
  const date = firstParam(value)?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeMonthParam(value: string | string[] | undefined) {
  const month = firstParam(value)?.trim() || "";
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
}

function normalizeRangeParam(value: string | string[] | undefined): DateRangeKey {
  const range = firstParam(value)?.trim();
  return range === "today" || range === "month" || range === "week" ? range : "week";
}

function normalizeSearchParam(value: string | string[] | undefined) {
  return (firstParam(value) || "").trim().slice(0, 80);
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

async function loadInitialCalendarRows(range: CalendarDateRange): Promise<CalendarClientProps["initialRows"]> {
  const result = await supabaseSelect("event_calendar_items", {
    select: "*",
    order: "event_date.asc.nullslast,estimated_start_date.asc.nullslast,created_at.desc",
    limit: "100",
    and: `(event_date.gte.${range.from},event_date.lte.${range.to})`,
  });

  return Array.isArray(result.data) ? (result.data as CalendarClientProps["initialRows"]) : [];
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: CalendarSearchParams | Promise<CalendarSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedDateIso = normalizeDateParam(params.date);
  const rangeAnchorIso = normalizeDateParam(params.anchor);
  const rangeKey = selectedDateIso ? "today" : normalizeRangeParam(params.range);
  const searchQuery = normalizeSearchParam(params.q);
  const monthAnchorIso = normalizeMonthParam(params.month);
  const anchor = parseLocalDate(selectedDateIso || rangeAnchorIso || monthAnchorIso || formatLocalIsoDate(new Date()));
  const initialDateRanges = buildInitialDateRanges(anchor);
  const activeRange = selectedDateIso ? { from: selectedDateIso, to: selectedDateIso, label: "Day" } : initialDateRanges[rangeKey];
  const initialRows = await loadInitialCalendarRows(activeRange);

  return (
    <CalendarClient
      initialRows={initialRows}
      initialDateRanges={initialDateRanges}
      initialRangeKey={rangeKey}
      initialSelectedDateIso={selectedDateIso}
      initialSearchQuery={searchQuery}
    />
  );
}
