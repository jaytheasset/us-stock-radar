import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import type { CalendarDateRange } from "./model.ts";
import {
  readNormalizedCalendarEvents,
  type CalendarSelect,
} from "./normalized.ts";

export async function getNormalizedCalendarEvents(range: CalendarDateRange) {
  return readNormalizedCalendarEvents(
    range,
    supabaseSelect as CalendarSelect,
  );
}
