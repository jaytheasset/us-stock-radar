import type {
  FilingUiConsoleContentContractItem,
  FilingUiConsoleEntry,
} from "@/app/development/filings-ui/FilingUiConsoleClient";
import { filingUiConsoleRegistrations } from "@/lib/development/filingUiConsoleRegistry";
import { fetchEventById, fetchLatestEventByAccession } from "@/lib/supabase";

type V2Fixture = {
  company: string;
  deliveryLevel: string;
  eventType: string;
  family: string;
  fixtureKind: "Actual DB" | "Fixture";
  formType: string;
  label: string;
  notes: string;
  route: string;
  score: number | null;
  signal: string;
  status: "Broken" | "Missing" | "Ready";
  ticker: string;
};

type V2Family = {
  contentContract?: FilingUiConsoleContentContractItem[];
  id: string;
};

type V2ActualDbRegistration = {
  accessionNumber: string;
  family: string;
  label?: string;
  notes?: string;
};

type V2RegistryManifest = {
  actualDbRegistrations: V2ActualDbRegistration[];
  families?: V2Family[];
  fixtures: V2Fixture[];
  version: number;
};

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
  "other-specialized": "generic",
};

export async function getFilingUiConsoleEntries(): Promise<FilingUiConsoleEntry[]> {
  const [legacyEntries, v2Entries] = await Promise.all([
    loadLegacyEntries(),
    loadV2Entries(),
  ]);

  return [...v2Entries, ...legacyEntries].sort(
    (left, right) => fixtureSortOrder(left) - fixtureSortOrder(right),
  );
}

async function loadLegacyEntries() {
  return Promise.all(
    filingUiConsoleRegistrations.map(async (registration) => {
      const result = await fetchEventById(registration.eventId);
      const row = asRecord(result.data);
      const metadata = asRecord(row?.metadata);

      return {
        company:
          readString(row, ["company", "company_name", "issuer"]) ||
          readString(metadata, ["issuer", "company"]),
        delivery: readString(row, ["delivery_level"]),
        eventId: registration.eventId,
        eventType: readString(row, ["event_type"]),
        family: registration.family,
        fixtureKind: "Actual DB",
        formType:
          readString(row, ["form_type", "form"]) ||
          readString(metadata, ["form_type", "formType"]),
        label: registration.label,
        notes: registration.notes,
        route: registration.route || `/filings/${registration.eventId}`,
        score: readNumber(row, ["score"]),
        signal: readString(row, ["signal"]),
        status: row ? "Ready" : result.status === 200 ? "Missing" : "Broken",
        ticker: readString(row, ["ticker", "symbol"]),
        contentContract: [],
      } satisfies FilingUiConsoleEntry;
    }),
  );
}

async function loadV2Entries(): Promise<FilingUiConsoleEntry[]> {
  const origin = readV2Origin();
  const manifest = await fetchV2Manifest(origin);
  if (!manifest) return [];
  const contractByFamily = new Map(
    (manifest.families || []).map((family) => [family.id, family.contentContract || []]),
  );

  const fixtureEntries = manifest.fixtures.map((fixture) => ({
    company: fixture.company,
    delivery: fixture.deliveryLevel,
    eventId: fixture.route.replace(/^.*\/filings\//, "") || fixture.label,
    eventType: fixture.eventType,
    family: mapV2Family(fixture.family),
    fixtureKind: fixture.fixtureKind,
    formType: fixture.formType,
    label: fixture.label,
    notes: fixture.notes,
    route: toV2Route(origin, fixture.route),
    score: fixture.score,
    signal: fixture.signal,
    status: fixture.status,
    ticker: fixture.ticker,
    contentContract: contractByFamily.get(fixture.family) || [],
  } satisfies FilingUiConsoleEntry));

  const actualEntries = await Promise.all(
    manifest.actualDbRegistrations.map(async (registration) => {
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
        route: eventId ? `${origin}/filings/${eventId}` : origin,
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

async function fetchV2Manifest(origin: string): Promise<V2RegistryManifest | null> {
  try {
    const response = await fetch(`${origin}/api/development/filing-ui-registry`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const value = await response.json();
    const record = asRecord(value);
    if (
      !record ||
      !Array.isArray(record.fixtures) ||
      !Array.isArray(record.actualDbRegistrations)
    ) {
      return null;
    }

    return value as V2RegistryManifest;
  } catch {
    return null;
  }
}

function readV2Origin() {
  return (process.env.FILING_UI_V2_ORIGIN || "http://127.0.0.1:3700").replace(/\/$/, "");
}

function toV2Route(origin: string, route: string) {
  if (/^https?:\/\//i.test(route)) return route;
  return `${origin}${route.startsWith("/") ? route : `/${route}`}`;
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
