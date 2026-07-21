import type {
  FilingUiConsoleContentContractItem,
  FilingUiConsoleEntry,
} from "@/app/development/filings-ui/FilingUiConsoleClient";
import {
  actualDbFilingRegistrations,
  filingUiFamilies,
  registeredFilingUiFixtures,
} from "@/lib/development/filingUiRegistry";
import { fetchLatestEventByAccession } from "@/lib/supabase";

const V2_FAMILY_MAP: Readonly<Record<string, string>> = {
  generic: "generic",
  "listing-financial-risk": "listing-financial-risk",
  "financing-dilution-capital-structure": "financing-dilution",
  "strategic-transaction": "strategic-transaction",
  "governance-vote-leadership": "governance-vote",
  "operating-legal-routine": "operating-legal",
  "offering-registration": "offering-registration",
  "periodic-reports": "periodic",
  "form-25": "form-25",
  "form-425": "form-425",
  proxy: "proxy",
  ownership: "ownership",
  tender: "tender",
  nt: "nt",
  s8: "s8",
};

export async function getFilingUiConsoleEntries(): Promise<FilingUiConsoleEntry[]> {
  const contractByFamily = new Map(
    filingUiFamilies.map((family) => [
      family.id,
      [...family.contentContract] satisfies FilingUiConsoleContentContractItem[],
    ]),
  );

  const fixtureEntries = registeredFilingUiFixtures.map((fixture) => ({
    company: fixture.company,
    delivery: fixture.deliveryLevel,
    eventId: fixture.route.replace(/^.*\/filings\//, "") || fixture.label,
    eventType: fixture.eventType,
    family: mapV2Family(fixture.family),
    fixtureKind: fixture.fixtureKind,
    formType: fixture.formType,
    label: fixture.label,
    notes: fixture.notes,
    route: fixture.route,
    score: fixture.score,
    signal: fixture.signal,
    status: fixture.status,
    ticker: fixture.ticker,
    contentContract: contractByFamily.get(fixture.family) || [],
  } satisfies FilingUiConsoleEntry));

  const actualEntries = await Promise.all(
    actualDbFilingRegistrations.map(async (registration) => {
      const result = await fetchLatestEventByAccession(registration.accessionNumber);
      const row = asRecord(result.data);
      const metadata = asRecord(row?.metadata);
      const eventId = readString(row, ["id"]);

      return {
        company:
          readString(row, ["company", "company_name", "issuer"]) ||
          readString(metadata, ["issuer", "company"]),
        delivery: readString(row, ["delivery_level"]),
        eventId: eventId || registration.accessionNumber,
        eventType: readString(row, ["event_type"]),
        family: mapV2Family(registration.family),
        fixtureKind: "Actual DB",
        formType:
          readString(row, ["form_type", "form"]) ||
          readString(metadata, ["form_type", "formType"]),
        label: registration.label || `Actual DB / ${registration.accessionNumber}`,
        notes:
          registration.notes ||
          `Resolved from accession ${registration.accessionNumber} at request time.`,
        route: eventId ? `/filings/${eventId}` : "/filings",
        score: readNumber(row, ["score"]),
        signal: readString(row, ["signal"]),
        status: row ? "Ready" : result.status === 200 ? "Missing" : "Broken",
        ticker: readString(row, ["ticker", "symbol"]),
        contentContract: contractByFamily.get(registration.family) || [],
      } satisfies FilingUiConsoleEntry;
    }),
  );

  return [...fixtureEntries, ...actualEntries];
}

function mapV2Family(family: string) {
  return V2_FAMILY_MAP[family] || "generic";
}

function fixtureSortOrder(entry: FilingUiConsoleEntry) {
  return entry.fixtureKind === "Fixture" ? 0 : 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
