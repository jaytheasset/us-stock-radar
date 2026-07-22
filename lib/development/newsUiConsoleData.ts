import type { FilingUiConsoleEntry } from "@/app/development/filings-ui/FilingUiConsoleClient";
import {
  actualDbNewsRegistrations,
  newsAnalysisContentContract,
  newsAnalysisFixtureRegistration,
  newsAnalysisUiFamily,
} from "@/lib/development/newsUiRegistry";
import { fetchEventById } from "@/lib/supabase";

type DbRow = Record<string, unknown>;

export async function getNewsUiConsoleEntries(): Promise<FilingUiConsoleEntry[]> {
  const actualEntries = await Promise.all(actualDbNewsRegistrations.map(async (registration) => {
    const result = await fetchEventById(registration.id);
    const row = asRecord(result.data);
    const metadata = asRecord(row?.metadata);
    const sourceGroup = readString(row, "source_group");

    return {
      company: firstString(readString(row, "company"), readString(row, "company_name"), readString(metadata, "issuer")),
      contentContract: newsAnalysisContentContract,
      delivery: readString(row, "delivery_level"),
      eventId: registration.id,
      eventType: readString(row, "event_type"),
      family: newsAnalysisUiFamily.id,
      fixtureKind: "Actual DB",
      formType: "News V2",
      label: registration.label,
      notes: row ? "Rendered from stored event, analysis, article, relation, taxonomy, and market-cache values only." : "The registered Actual DB event was not found.",
      route: `/events/${registration.id}`,
      score: readNumber(row, "score"),
      signal: readString(row, "signal"),
      status: !row ? "Missing" : sourceGroup === "news" ? "Ready" : "Broken",
      ticker: readString(row, "ticker"),
    } satisfies FilingUiConsoleEntry;
  }));

  return [newsAnalysisFixtureRegistration, ...actualEntries];
}

function asRecord(value: unknown): DbRow | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DbRow : null;
}

function readString(row: DbRow | null, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(row: DbRow | null, key: string) {
  const value = row?.[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function firstString(...values: string[]) {
  return values.find(Boolean) || "";
}
