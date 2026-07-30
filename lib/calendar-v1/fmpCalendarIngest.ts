import "server-only";

import { fetchFmpCalendarDay } from "./fmpCalendarClient";
import { runFmpCalendarIngestCore } from "./fmpCalendarIngestCore";
import {
  loadFmpCalendarTickerUniverse,
  persistFmpCalendarObservation,
} from "./fmpCalendarRepository";
import type { FmpCalendarIngestRequest } from "./fmpCalendarTypes";

export function runFmpCompanyCalendarIngest(
  request: FmpCalendarIngestRequest,
) {
  return runFmpCalendarIngestCore(request, {
    fetchDay: fetchFmpCalendarDay,
    loadUniverse: loadFmpCalendarTickerUniverse,
    persistObservation: persistFmpCalendarObservation,
  });
}
