import "server-only";

import { getServerEnv } from "@/lib/env";
import { parseDateOnly } from "./dateUtils.ts";
import {
  FMP_CALENDAR_DAILY_CAP,
  FMP_CALENDAR_ENDPOINTS,
  FMP_CALENDAR_FETCH_TIMEOUT_MS,
  type FmpCalendarFetchResult,
  type FmpCompanyCalendarEventType,
} from "./fmpCalendarTypes.ts";

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";

export async function fetchFmpCalendarDay(
  eventType: FmpCompanyCalendarEventType,
  date: string,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
  } = {},
): Promise<FmpCalendarFetchResult> {
  parseDateOnly(date);
  const apiKey = options.apiKey ?? getServerEnv().fmpApiKey;
  if (!apiKey) throw new Error("FMP calendar credentials are unavailable.");

  const url = new URL(
    `${FMP_STABLE_BASE_URL}/${FMP_CALENDAR_ENDPOINTS[eventType]}`,
  );
  url.searchParams.set("from", date);
  url.searchParams.set("to", date);
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? FMP_CALENDAR_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `FMP ${eventType} calendar returned HTTP ${response.status}.`,
      );
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error(`FMP ${eventType} calendar returned an invalid payload.`);
    }
    return {
      date,
      eventType,
      fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
      rows: payload,
      truncated: payload.length >= FMP_CALENDAR_DAILY_CAP,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`FMP ${eventType} calendar request timed out.`);
    }
    if (
      error instanceof Error &&
      error.message.startsWith(`FMP ${eventType} calendar`)
    ) {
      throw error;
    }
    throw new Error(`FMP ${eventType} calendar request failed.`);
  } finally {
    clearTimeout(timeout);
  }
}
