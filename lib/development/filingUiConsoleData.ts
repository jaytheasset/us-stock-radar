import type { FilingUiConsoleEntry } from "@/app/development/filings-ui/FilingUiConsoleClient";
import { filingUiConsoleRegistrations } from "@/lib/development/filingUiConsoleRegistry";
import { fetchEventById } from "@/lib/supabase";

export async function getFilingUiConsoleEntries(): Promise<FilingUiConsoleEntry[]> {
  return Promise.all(
    filingUiConsoleRegistrations.map(async (registration) => {
      const route = resolveRoute(registration);
      if (registration.fixture) {
        return {
          ...registration,
          ...registration.fixture,
          fixtureKind: registration.fixtureKind || "Fixture",
          route,
          status: "Ready",
        } satisfies FilingUiConsoleEntry;
      }

      const result = await fetchEventById(registration.eventId);
      const row = asRecord(result.data);
      const metadata = asRecord(row?.metadata);

      return {
        ...registration,
        company: readString(row, ["company", "company_name", "issuer"]) || readString(metadata, ["issuer", "company"]),
        delivery: readString(row, ["delivery_level"]),
        eventType: readString(row, ["event_type"]),
        formType: readString(row, ["form_type", "form"]) || readString(metadata, ["form_type", "formType"]),
        fixtureKind: registration.fixtureKind || "Actual DB",
        route,
        score: readNumber(row, ["score"]),
        signal: readString(row, ["signal"]),
        status: row ? "Ready" : result.status === 200 ? "Missing" : "Broken",
        ticker: readString(row, ["ticker", "symbol"]),
      } satisfies FilingUiConsoleEntry;
    }),
  );
}

function resolveRoute(registration: (typeof filingUiConsoleRegistrations)[number]) {
  const route = registration.route || `/filings/${registration.eventId}`;
  if (registration.surface !== "design-v2") return route;
  const origin = (process.env.FILING_UI_V2_ORIGIN || "http://127.0.0.1:3700").replace(/\/$/, "");
  return `${origin}${route.startsWith("/") ? route : `/${route}`}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(row: Record<string, unknown> | null, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readNumber(row: Record<string, unknown> | null, keys: string[]) {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
