import "server-only";

import { SecStructuredHttpClient } from "./sec-structured-data/httpClient.ts";
import { normalizeSecStructuredDocuments } from "./sec-structured-data/normalization.ts";
import {
  evaluateFinal424B4NewListingOs,
  persistFinal424B4NewListingOsAtomic,
  type ProspectusOsDecision,
  type StoredSecProspectusRawItem,
} from "./sec-structured-data/prospectusOsBaseline.ts";
import { PostgresSecStructuredRepository } from "./sec-structured-data/repository.ts";
import {
  withServerPostgresClient,
  type ServerPostgresClient,
  type ServerPostgresEnvironment,
  type ServerPostgresPool,
} from "./serverPostgres.ts";

type RawIngestItem = Record<string, unknown>;

export type SecProspectusOsIssuerResult = {
  rawItemId: string;
  issuerCik: string | null;
  accession: string | null;
  decision: ProspectusOsDecision;
  persistence: "INSERTED" | "DUPLICATE" | "PERIODIC_BASELINE_EXISTS" | "NOT_WRITTEN" | "FAILED";
  historyInserted: number;
  snapshotInserted: number;
  error: string | null;
};

export type SecProspectusOsBridgeResult = {
  ok: boolean;
  status: "skipped" | "completed" | "partial" | "failed";
  requestedRawItemIds: string[];
  results: SecProspectusOsIssuerResult[];
};

export function extractProspectusOsRawItemIds(items: readonly RawIngestItem[]) {
  return [...new Set(items.flatMap((item) => {
    if (item.ok !== true || stringValue(item.form_type).toUpperCase() !== "424B4") return [];
    const rawItemId = stringValue(item.raw_item_id);
    return UUID_PATTERN.test(rawItemId) ? [rawItemId] : [];
  }))].sort();
}

export async function runSecProspectusOsTriggerBridge(
  input: {
    rawItemIds: readonly string[];
    environment?: ServerPostgresEnvironment;
    pool?: ServerPostgresPool;
  },
  dependencies: {
    now?: () => Date;
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<SecProspectusOsBridgeResult> {
  const requestedRawItemIds = [...new Set(input.rawItemIds.filter((id) => UUID_PATTERN.test(id)))].sort();
  if (requestedRawItemIds.length === 0) return finish(requestedRawItemIds, []);
  const environment = input.environment ?? process.env;
  const userAgent = environment.SEC_USER_AGENT?.trim();
  if (!userAgent) {
    return finish(requestedRawItemIds, requestedRawItemIds.map((rawItemId) => failure(
      rawItemId,
      "SEC_USER_AGENT is required for prospectus O/S verification",
    )));
  }
  const now = dependencies.now ?? (() => new Date());

  try {
    return await withServerPostgresClient(async (client) => {
      const rows = await readStoredRawItems(client, requestedRawItemIds);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const results: SecProspectusOsIssuerResult[] = [];
      const structuredClient = new SecStructuredHttpClient(
        userAgent,
        undefined,
        dependencies.fetchImplementation,
        now,
      );
      const structuredRepository = new PostgresSecStructuredRepository(client);

      for (const rawItemId of requestedRawItemIds) {
        const rawItem = byId.get(rawItemId);
        if (!rawItem) {
          results.push(failure(rawItemId, "stored SEC raw item is unavailable"));
          continue;
        }
        const decision = evaluateFinal424B4NewListingOs(rawItem);
        if (decision.status !== "AUTO_ACCEPT") {
          results.push({
            rawItemId,
            issuerCik: issuerCik(decision),
            accession: accession(decision),
            decision,
            persistence: "NOT_WRITTEN",
            historyInserted: 0,
            snapshotInserted: 0,
            error: null,
          });
          continue;
        }

        try {
          let filingLedger = await readFilingLedger(client, decision.accession);
          if (!filingLedger) {
            const submissions = await structuredClient.fetchSubmissions(decision.issuerCik, "incremental");
            const normalized = normalizeSecStructuredDocuments(submissions, now().toISOString());
            await structuredRepository.ingestBatch(normalized);
            filingLedger = await readFilingLedger(client, decision.accession);
          }
          if (!filingLedger) throw new Error("authoritative SEC filing ledger row is unavailable");
          const persisted = await persistFinal424B4NewListingOsAtomic({
            client,
            decision,
            filingLedger,
            ingestedAt: now().toISOString(),
          });
          results.push({
            rawItemId,
            issuerCik: decision.issuerCik,
            accession: decision.accession,
            decision,
            persistence: persisted.status,
            historyInserted: persisted.historyInserted,
            snapshotInserted: persisted.snapshotInserted,
            error: null,
          });
        } catch (error) {
          results.push({
            rawItemId,
            issuerCik: decision.issuerCik,
            accession: decision.accession,
            decision,
            persistence: "FAILED",
            historyInserted: 0,
            snapshotInserted: 0,
            error: errorMessage(error),
          });
        }
      }
      return finish(requestedRawItemIds, results);
    }, input.pool);
  } catch (error) {
    return finish(requestedRawItemIds, requestedRawItemIds.map((rawItemId) => failure(rawItemId, errorMessage(error))));
  }
}

async function readStoredRawItems(client: ServerPostgresClient, ids: string[]) {
  const result = await client.query<Record<string, unknown>>(
    `select id::text, source_url, body_text, raw_payload
     from public.raw_items
     where source_code = 'sec_edgar' and id = any($1::uuid[])
     order by id`,
    [ids],
  );
  return result.rows.map((row): StoredSecProspectusRawItem => ({
    id: String(row.id),
    sourceUrl: String(row.source_url ?? ""),
    bodyText: String(row.body_text ?? ""),
    rawPayload: record(row.raw_payload),
  }));
}

async function readFilingLedger(client: ServerPostgresClient, accessionNumber: string) {
  const result = await client.query<Record<string, unknown>>(
    `select accession_number, issuer_cik, form, filed_date::text, accepted_at::text,
            primary_document, source_raw_id::text
     from public.sec_filing_ledger
     where accession_number = $1
     limit 1`,
    [accessionNumber],
  );
  const row = result.rows[0];
  if (!row || row.accepted_at === null || row.primary_document === null) return null;
  return {
    accessionNumber: String(row.accession_number),
    issuerCik: String(row.issuer_cik),
    form: String(row.form),
    filedDate: String(row.filed_date),
    acceptedAt: new Date(String(row.accepted_at)).toISOString(),
    primaryDocument: String(row.primary_document),
    sourceRawId: String(row.source_raw_id),
  };
}

function finish(requestedRawItemIds: string[], results: SecProspectusOsIssuerResult[]): SecProspectusOsBridgeResult {
  const failed = results.filter((result) => result.persistence === "FAILED").length;
  const status = requestedRawItemIds.length === 0
    ? "skipped"
    : failed === 0
      ? "completed"
      : failed < results.length ? "partial" : "failed";
  return { ok: status === "skipped" || status === "completed", status, requestedRawItemIds, results };
}

function failure(rawItemId: string, error: string): SecProspectusOsIssuerResult {
  return {
    rawItemId,
    issuerCik: null,
    accession: null,
    decision: {
      status: "NOT_VERIFIED",
      reason: "FILING_IDENTITY_INCOMPLETE",
      rawItemId,
      evidence: [],
    },
    persistence: "FAILED",
    historyInserted: 0,
    snapshotInserted: 0,
    error,
  };
}

function issuerCik(decision: ProspectusOsDecision) {
  return decision.status === "AUTO_ACCEPT" ? decision.issuerCik : null;
}

function accession(decision: ProspectusOsDecision) {
  return decision.status === "AUTO_ACCEPT" ? decision.accession : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
