import "server-only";

import { fetchFmpEconomicCalendarRange } from "./fmpEconomicCalendarClient";
import { runFmpEconomicCalendarIngestCore } from "./fmpEconomicCalendarIngestCore";
import { persistFmpEconomicCalendarObservation } from "./fmpEconomicCalendarRepository";
import type { FmpEconomicCalendarIngestRequest } from "./fmpEconomicCalendarTypes";

export function runFmpEconomicCalendarIngest(
  request: FmpEconomicCalendarIngestRequest,
) {
  return runFmpEconomicCalendarIngestCore(request, {
    fetchRange: fetchFmpEconomicCalendarRange,
    persistObservation: persistFmpEconomicCalendarObservation,
  });
}
