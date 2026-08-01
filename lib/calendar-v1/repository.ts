import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import type { CalendarDateRange } from "./model.ts";
import {
  readNormalizedCalendarEvents,
  readStockCompanyCalendarEvents,
  type CalendarSelect,
} from "./normalized.ts";

export async function getNormalizedCalendarEvents(range: CalendarDateRange) {
  return readNormalizedCalendarEvents(
    range,
    supabaseSelect as CalendarSelect,
  );
}

export async function getStockCompanyCalendarEvents(
  range: CalendarDateRange,
  ticker: string,
  order: "asc" | "desc" = "asc",
) {
  return readStockCompanyCalendarEvents(
    range,
    ticker,
    supabaseSelect as CalendarSelect,
    order,
  );
}
