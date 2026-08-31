import "server-only";

import {
  createSecOsProductionCollector,
  type SecOsCollectionCounts,
  type SecOsCollectionReason,
} from "./sec-structured-data/osProductionCollector.ts";
import type { PeriodicOsBaselineReadResult } from "./sec-structured-data/issuerCommonClassUniverse.ts";
import {
  withServerPostgresClient,
  type ServerPostgresClient,
  type ServerPostgresEnvironment,
  type ServerPostgresPool,
} from "./serverPostgres.ts";

export const SEC_PERIODIC_OS_TRIGGER_FORMS = [
  "10-Q",
  "10-Q/A",
  "10-K",
  "10-K/A",
  "20-F",
  "20-F/A",
  "40-F",
  "40-F/A",
] as const;

const PERIODIC_FORM_SET = new Set<string>(SEC_PERIODIC_OS_TRIGGER_FORMS);

type RawIngestItem = Record<string, unknown>;

type CollectorIssuerResult = {
  issuerCik: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "BASELINE_REQUIRED";
  incrementalBaseline?: PeriodicOsBaselineReadResult;
  counts: SecOsCollectionCounts;
  reasonCounts: Partial<Record<SecOsCollectionReason, number>>;
};

type Collector = {
  collectIssuer(input: {
    cik: string;
    mode: "incremental";
  }): Promise<CollectorIssuerResult>;
};

type CollectorFactory = (input: {
  sqlClient: ServerPostgresClient;
  userAgent: string;
}) => Collector;

export type SecPeriodicOsBridgeIssuerSummary = CollectorIssuerResult;

export type SecPeriodicOsBridgeFailure = {
  issuerCik: string | null;
  stage: "configuration" | "connection" | "collector";
  error: string;
};

export type SecPeriodicOsBridgeResult = {
  ok: boolean;
  status: "skipped" | "completed" | "partial" | "failed";
  mode: "incremental";
  requestedCiks: string[];
  issuerResults: SecPeriodicOsBridgeIssuerSummary[];
  failures: SecPeriodicOsBridgeFailure[];
};

export function extractPeriodicOsIssuerCiks(items: readonly RawIngestItem[]) {
  const ciks = new Set<string>();
  for (const item of items) {
    if (item.ok !== true || !stringValue(item.raw_item_id)) continue;
    const formType = stringValue(item.form_type).toUpperCase();
    if (!PERIODIC_FORM_SET.has(formType)) continue;
    const cik = normalizeSecIssuerCik(item.cik);
    if (cik) ciks.add(cik);
  }
  return [...ciks].sort();
}

export async function runSecPeriodicOsTriggerBridge(
  input: {
    ciks: readonly string[];
    environment?: ServerPostgresEnvironment;
    pool?: ServerPostgresPool;
  },
  dependencies: {
    createCollector?: CollectorFactory;
  } = {},
): Promise<SecPeriodicOsBridgeResult> {
  const requestedCiks = normalizeAndDedupeCiks(input.ciks);
  if (requestedCiks.length === 0) {
    return finishBridge(requestedCiks, [], []);
  }

  const environment = input.environment ?? process.env;
  const userAgent = environment.SEC_USER_AGENT?.trim();
  if (!userAgent) {
    return finishBridge(requestedCiks, [], [{
      issuerCik: null,
      stage: "configuration",
      error: "SEC_USER_AGENT is required for periodic O/S collection",
    }]);
  }

  const createCollector = dependencies.createCollector
    ?? ((collectorInput) => createSecOsProductionCollector(collectorInput));

  try {
    return await withServerPostgresClient(async (client) => {
      const collector = createCollector({ sqlClient: client, userAgent });
      const issuerResults: SecPeriodicOsBridgeIssuerSummary[] = [];
      const failures: SecPeriodicOsBridgeFailure[] = [];

      for (const cik of requestedCiks) {
        try {
          issuerResults.push(await collector.collectIssuer({
            cik,
            mode: "incremental",
          }));
        } catch (error) {
          failures.push({
            issuerCik: cik,
            stage: "collector",
            error: errorMessage(error),
          });
        }
      }

      return finishBridge(requestedCiks, issuerResults, failures);
    }, input.pool);
  } catch (error) {
    return finishBridge(requestedCiks, [], [{
      issuerCik: null,
      stage: "connection",
      error: errorMessage(error),
    }]);
  }
}

function finishBridge(
  requestedCiks: string[],
  issuerResults: SecPeriodicOsBridgeIssuerSummary[],
  failures: SecPeriodicOsBridgeFailure[],
): SecPeriodicOsBridgeResult {
  const failedResults = issuerResults.filter((result) => result.status === "FAILED").length;
  const partialResults = issuerResults.filter((result) => result.status === "PARTIAL").length;
  const status = requestedCiks.length === 0
    ? "skipped"
    : failures.length > 0 || failedResults > 0
      ? issuerResults.length > 0 ? "partial" : "failed"
      : partialResults > 0
        ? "partial"
        : "completed";
  return {
    ok: status === "skipped" || status === "completed",
    status,
    mode: "incremental",
    requestedCiks,
    issuerResults,
    failures,
  };
}

function normalizeAndDedupeCiks(ciks: readonly string[]) {
  return [...new Set(ciks.map(normalizeSecIssuerCik).filter(Boolean))].sort();
}

function normalizeSecIssuerCik(value: unknown) {
  const cik = stringValue(value);
  if (!/^\d{1,10}$/.test(cik) || /^0+$/.test(cik)) return "";
  return cik.padStart(10, "0");
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
