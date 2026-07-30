import "server-only";

import { getServerEnv } from "@/lib/env";
import { parseDateOnly } from "./dateUtils.ts";
import {
  FMP_ECONOMIC_CALENDAR_ENDPOINT,
  FMP_ECONOMIC_CALENDAR_FETCH_TIMEOUT_MS,
  FMP_ECONOMIC_CALENDAR_ROW_CAP,
  type FmpEconomicCalendarFetchResult,
} from "./fmpEconomicCalendarTypes.ts";

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";

export async function fetchFmpEconomicCalendarRange(
  from: string,
  to: string,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
  } = {},
): Promise<FmpEconomicCalendarFetchResult> {
  parseDateOnly(from);
  parseDateOnly(to);
  if (from > to) throw new Error("FMP economic calendar range is invalid.");

  const apiKey = options.apiKey ?? getServerEnv().fmpApiKey;
  if (!apiKey) {
    throw new Error("FMP economic calendar credentials are unavailable.");
  }

  const url = new URL(
    `${FMP_STABLE_BASE_URL}/${FMP_ECONOMIC_CALENDAR_ENDPOINT}`,
  );
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? FMP_ECONOMIC_CALENDAR_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `FMP economic calendar returned HTTP ${response.status}.`,
      );
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("FMP economic calendar returned an invalid payload.");
    }
    return {
      fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
      from,
      rows: payload,
      to,
      truncated: payload.length >= FMP_ECONOMIC_CALENDAR_ROW_CAP,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("FMP economic calendar request timed out.");
    }
    if (
      error instanceof Error &&
      error.message.startsWith("FMP economic calendar")
    ) {
      throw error;
    }
    throw new Error("FMP economic calendar request failed.");
  } finally {
    clearTimeout(timeout);
  }
}
