import { isDeepStrictEqual } from "node:util";
import { normalizeMainSubmissions } from "./mainSubmissions.ts";
import type {
  SecCompanyFactRow,
  SecFactReadFilter,
  SecFilingReadFilter,
  SecFilingRow,
  SecNormalizedBatch,
  SecRepositoryWriteCounts,
  SecStructuredRepository,
  SecTickerObservationRow,
  SecSubmissionsConfirmation,
  SecSubmissionsPublication,
  SecSubmissionsRefreshWrite,
} from "./types.ts";

export type SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export interface SecStructuredSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export class PostgresSecStructuredRepository implements SecStructuredRepository {
  private readonly client: SecStructuredSqlClient;
  private readonly transactionMode: "managed" | "external";

  constructor(
    client: SecStructuredSqlClient,
    transactionMode: "managed" | "external" = "managed",
  ) {
    this.client = client;
    this.transactionMode = transactionMode;
  }

  async ingestBatch(batch: SecNormalizedBatch): Promise<SecRepositoryWriteCounts> {
    return (await this.storeBatch(batch)).counts;
  }

  async allocateSubmissionsRefreshSequence(): Promise<string> {
    this.requireManagedRefresh();
    const result = await this.client.query<{ sequence: string }>(
      "select nextval('public.sec_submissions_refresh_sequence')::text as sequence",
    );
    return result.rows[0].sequence;
  }

  async ingestSubmissionsRefresh(batch: SecNormalizedBatch, confirmation: SecSubmissionsConfirmation): Promise<SecSubmissionsRefreshWrite> {
    this.requireManagedRefresh();
    const raw = batch.rawSources[0];
    if (!raw || batch.rawSources.length !== 1 || raw.sourceKind !== "submissions" ||
        raw.cik !== confirmation.cik || raw.id !== confirmation.sourceRawId ||
        typeof confirmation.refreshSequence !== "string" ||
        !/^[1-9][0-9]*$/.test(confirmation.refreshSequence) ||
        BigInt(confirmation.refreshSequence) > BigInt("9223372036854775807") ||
        !Number.isFinite(Date.parse(confirmation.confirmedAt))) {
      throw new Error("invalid_submissions_confirmation");
    }
    const expected = normalizeMainSubmissions([{
      sourceKind: "submissions", sourceUrl: raw.sourceUrl, sourceIdentity: raw.sourceIdentity,
      cik: raw.cik, fetchedAt: raw.fetchedAt, payload: raw.payload, rawBody: raw.rawContent,
      sourceSchemaVersion: raw.sourceSchemaVersion,
      rawBodyKind: "authoritative_http_body",
    }], raw.cik, raw.ingestedAt);
    if (raw.id !== expected.rawSources[0].id || raw.contentHash !== expected.rawSources[0].contentHash ||
        !isDeepStrictEqual(batch.issuers, expected.issuers) ||
        !isDeepStrictEqual(batch.issuerObservations, expected.issuerObservations) ||
        !isDeepStrictEqual(batch.tickerObservations, expected.tickerObservations) ||
        !isDeepStrictEqual(batch.filings, expected.filings) ||
        batch.facts.length || batch.rejections.length) {
      throw new Error("invalid_submissions_confirmation_batch");
    }
    return this.storeBatch(batch, confirmation);
  }

  private requireManagedRefresh() {
    if (this.transactionMode !== "managed") throw new Error("submissions_refresh_requires_managed_connection");
  }

  private async publishSubmissionsCurrent(confirmation: SecSubmissionsConfirmation): Promise<SecSubmissionsPublication> {
    const values = [confirmation.cik, confirmation.sourceRawId, confirmation.refreshSequence, confirmation.confirmedAt];
    const result = await this.client.query(
      `insert into public.sec_submissions_current (issuer_cik, source_raw_id, refresh_sequence, confirmed_at)
       values ($1, $2, $3::bigint, $4::timestamptz)
       on conflict (issuer_cik) do update set
         source_raw_id = excluded.source_raw_id, refresh_sequence = excluded.refresh_sequence,
         confirmed_at = excluded.confirmed_at
       where sec_submissions_current.refresh_sequence < excluded.refresh_sequence
       returning issuer_cik`, values,
    );
    if (result.rows.length === 1) return "published";
    // Conflict row remains locked until commit. A separate statement sees the
    // concurrent winner at READ COMMITTED, including a just-inserted row.
    const current = await this.client.query<{ refresh_sequence: string; identical: boolean }>(
      `select refresh_sequence::text,
         (source_raw_id = $2::uuid and confirmed_at = $4::timestamptz and refresh_sequence = $3::bigint) as identical
       from public.sec_submissions_current where issuer_cik = $1`, values,
    );
    if (current.rows[0]?.identical) return "unchanged";
    if (current.rows[0] && BigInt(current.rows[0].refresh_sequence) > BigInt(confirmation.refreshSequence)) return "superseded";
    throw new Error("conflicting_submissions_confirmation");
  }

  private async storeBatch(batch: SecNormalizedBatch, confirmation?: SecSubmissionsConfirmation): Promise<SecSubmissionsRefreshWrite> {
    if (this.transactionMode === "managed") await this.client.query("begin");
    try {
      if (this.transactionMode === "managed") await this.client.query("set local statement_timeout = '30s'");
      const raw = await this.insertRawSources(batch);
      const issuersInserted = await this.insertIssuers(batch);
      const issuerObservationsInserted = await this.insertIssuerObservations(batch);
      const tickerObservationsInserted = await this.insertTickerObservations(batch);
      const filingCounts = await this.insertFilings(batch);
      const factsInserted = await this.insertFacts(batch);
      const publication = confirmation ? await this.publishSubmissionsCurrent(confirmation) : "unchanged";
      if (this.transactionMode === "managed") await this.client.query("commit");
      const attempted = batch.rawSources.length + batch.issuers.length + batch.issuerObservations.length
        + batch.tickerObservations.length + batch.filings.length + batch.facts.length;
      const inserted = raw.ids.length + issuersInserted + issuerObservationsInserted
        + tickerObservationsInserted + filingCounts.inserted + factsInserted;
      return { publication, counts: {
        inserted,
        updated: filingCounts.updated,
        deduped: attempted - inserted - filingCounts.updated,
        rawSourcesInserted: raw.ids.length,
        issuersInserted,
        issuerObservationsInserted,
        tickerObservationsInserted,
        filingsInserted: filingCounts.inserted,
        filingsUpdated: filingCounts.updated,
        factsInserted,
        insertedRawSourceIds: raw.ids,
      } };
    } catch (error) {
      if (this.transactionMode === "managed") await this.client.query("rollback");
      throw error;
    }
  }

  async readIssuerTickers(cik: string): Promise<SecTickerObservationRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `select distinct on (ticker, exchange)
         issuer_cik, ticker, exchange, source_raw_id, source_kind, observed_at, ingested_at
       from public.sec_issuer_ticker_observations
       where issuer_cik = $1
       order by ticker, exchange, observed_at desc, id desc`,
      [cik],
    );
    return result.rows.map(mapTicker);
  }

  async readFilings(
    cik: string,
    limit = 200,
    filter: SecFilingReadFilter = {},
  ): Promise<SecFilingRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `select accession_number, issuer_cik, form, filed_date::text, accepted_at::text,
              report_date::text, primary_document, is_xbrl, is_inline_xbrl,
              source_raw_id, source_kind, ingested_at::text
       from public.sec_filing_ledger
       where issuer_cik = $1
         and ($3::timestamptz is null or accepted_at > $3::timestamptz)
       order by filed_date desc, accession_number desc
       limit $2`,
      [cik, boundedLimit(limit), filter.acceptedAfter ?? null],
    );
    return result.rows.map(mapFiling);
  }

  async readFacts(filter: SecFactReadFilter): Promise<SecCompanyFactRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `select source_fact_key, source_fact_path, issuer_cik, filing_accession,
              form, filed_date::text, source_raw_id, source_kind, context_kind,
              taxonomy, concept, unit, value_kind, value_numeric::text, value_text,
              instant_date::text, start_date::text, end_date::text, fiscal_year,
              fiscal_period, frame, ingested_at::text
       from public.sec_company_facts
       where issuer_cik = $1
         and ($2::text is null or taxonomy = $2)
         and ($3::text is null or concept = $3)
         and ($4::text is null or unit = $4)
         and ($5::text is null or form = $5)
         and ($6::date is null or instant_date > $6::date)
       order by coalesce(instant_date, end_date) desc, id desc
       limit $7`,
      [filter.cik, filter.taxonomy ?? null, filter.concept ?? null, filter.unit ?? null,
        filter.form ?? null, filter.instantDateAfter ?? null, boundedLimit(filter.limit)],
    );
    return result.rows.map(mapFact);
  }

  private async insertRawSources(batch: SecNormalizedBatch) {
    const ids: string[] = [];
    for (const rows of chunks(batch.rawSources)) {
      const result = await this.client.query<{ id: string }>(
        `insert into public.sec_structured_raw_sources (
         id, source_kind, source_url, source_identity, cik, fetched_at,
           ingested_at, content_hash, source_schema_version, raw_content_kind,
           raw_content, payload
         )
         select id, source_kind, source_url, source_identity, cik, fetched_at,
                ingested_at, content_hash, source_schema_version, raw_content_kind,
                raw_content, payload
         from pg_catalog.jsonb_to_recordset($1::jsonb) as row(
           id uuid, source_kind text, source_url text, source_identity text, cik text,
           fetched_at timestamptz, ingested_at timestamptz, content_hash text,
           source_schema_version text, raw_content_kind text, raw_content text,
           payload jsonb
         )
         on conflict do nothing
         returning id`,
        [JSON.stringify(rows.map((row) => ({
          id: row.id, source_kind: row.sourceKind, source_url: row.sourceUrl,
          source_identity: row.sourceIdentity, cik: row.cik, fetched_at: row.fetchedAt,
          ingested_at: row.ingestedAt, content_hash: row.contentHash,
          source_schema_version: row.sourceSchemaVersion,
          raw_content_kind: row.rawContentKind, raw_content: row.rawContent,
          payload: row.payload,
        })))],
      );
      ids.push(...result.rows.map((row) => row.id));
      // A separate statement sees a concurrent winner after INSERT has waited
      // for its commit (READ COMMITTED). A single INSERT/SELECT CTE can retain
      // the pre-conflict snapshot. Never connect observations to an unverified ID.
      const verified = await this.client.query<{ id: string }>(
        `select stored.id
         from pg_catalog.jsonb_to_recordset($1::jsonb) as expected(
           id uuid, cik text, source_kind text, source_url text,
           source_identity text, content_hash text, raw_content text,
           payload jsonb, raw_payload jsonb
         )
         join public.sec_structured_raw_sources stored
           on stored.id = expected.id
          and stored.cik = expected.cik
          and stored.source_kind = expected.source_kind
          and stored.source_url = expected.source_url
          and stored.source_identity = expected.source_identity
          and stored.content_hash = expected.content_hash
          and stored.raw_content = expected.raw_content
          and stored.payload = expected.payload
          and stored.payload = expected.raw_payload`,
        [JSON.stringify(rows.map((row) => ({
          id: row.id, cik: row.cik, source_kind: row.sourceKind,
          source_url: row.sourceUrl, source_identity: row.sourceIdentity,
          content_hash: row.contentHash, raw_content: row.rawContent,
          payload: row.payload,
          // Match the existing JSON.parse -> JSONB payload contract, including
          // number representation. Exact source bytes are compared separately.
          raw_payload: JSON.parse(row.rawContent),
        })))],
      );
      if (verified.rows.length !== rows.length) throw new Error("sec_raw_source_identity_mismatch");
    }
    return { ids };
  }

  private async insertIssuers(batch: SecNormalizedBatch) {
    return this.insertJsonChunks(batch.issuers, `
      insert into public.sec_issuers (cik, created_at)
      select cik, created_at
      from pg_catalog.jsonb_to_recordset($1::jsonb) as row(cik text, created_at timestamptz)
      on conflict (cik) do nothing`, (row) => ({ cik: row.cik, created_at: row.createdAt }));
  }

  private async insertIssuerObservations(batch: SecNormalizedBatch) {
    return this.insertJsonChunks(batch.issuerObservations, `
      insert into public.sec_issuer_source_observations (
        issuer_cik, entity_name, source_raw_id, source_kind, observed_at, ingested_at
      )
      select issuer_cik, entity_name, source_raw_id, source_kind, observed_at, ingested_at
      from pg_catalog.jsonb_to_recordset($1::jsonb) as row(
        issuer_cik text, entity_name text, source_raw_id uuid, source_kind text,
        observed_at timestamptz, ingested_at timestamptz
      )
      on conflict (issuer_cik, source_raw_id) do nothing`, (row) => ({
        issuer_cik: row.issuerCik, entity_name: row.entityName, source_raw_id: row.sourceRawId,
        source_kind: row.sourceKind, observed_at: row.observedAt, ingested_at: row.ingestedAt,
      }));
  }

  private async insertTickerObservations(batch: SecNormalizedBatch) {
    return this.insertJsonChunks(batch.tickerObservations, `
      insert into public.sec_issuer_ticker_observations (
        issuer_cik, ticker, exchange, source_raw_id, source_kind, observed_at, ingested_at
      )
      select issuer_cik, ticker, exchange, source_raw_id, source_kind, observed_at, ingested_at
      from pg_catalog.jsonb_to_recordset($1::jsonb) as row(
        issuer_cik text, ticker text, exchange text, source_raw_id uuid, source_kind text,
        observed_at timestamptz, ingested_at timestamptz
      )
      on conflict (issuer_cik, ticker, exchange, source_raw_id) do nothing`, (row) => ({
        issuer_cik: row.issuerCik, ticker: row.ticker, exchange: row.exchange,
        source_raw_id: row.sourceRawId, source_kind: row.sourceKind,
        observed_at: row.observedAt, ingested_at: row.ingestedAt,
      }));
  }

  private async insertFilings(batch: SecNormalizedBatch) {
    let inserted = 0;
    let updated = 0;
    for (const rows of chunks(batch.filings)) {
      const result = await this.client.query<{ inserted: boolean }>(
        `insert into public.sec_filing_ledger (
           accession_number, issuer_cik, form, filed_date, accepted_at, report_date,
           primary_document, is_xbrl, is_inline_xbrl, source_raw_id, source_kind, ingested_at
         )
         select accession_number, issuer_cik, form, filed_date, accepted_at, report_date,
                primary_document, is_xbrl, is_inline_xbrl, source_raw_id, source_kind, ingested_at
         from pg_catalog.jsonb_to_recordset($1::jsonb) as row(
           accession_number text, issuer_cik text, form text, filed_date date,
           accepted_at timestamptz, report_date date, primary_document text,
           is_xbrl boolean, is_inline_xbrl boolean, source_raw_id uuid,
           source_kind text, ingested_at timestamptz
         )
         on conflict (accession_number) do update set
           accepted_at = excluded.accepted_at,
           source_raw_id = excluded.source_raw_id,
           ingested_at = excluded.ingested_at
         where sec_filing_ledger.issuer_cik = excluded.issuer_cik
           and sec_filing_ledger.form = excluded.form
           and sec_filing_ledger.filed_date = excluded.filed_date
           and sec_filing_ledger.accepted_at is null
           and excluded.accepted_at is not null
         returning (xmax = 0) as inserted`,
        [JSON.stringify(rows.map(filingJson))],
      );
      inserted += result.rows.filter((row) => row.inserted).length;
      updated += result.rows.filter((row) => !row.inserted).length;
    }
    return { inserted, updated };
  }

  private async insertFacts(batch: SecNormalizedBatch) {
    return this.insertJsonChunks(batch.facts, `
      insert into public.sec_company_facts (
        source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
        filed_date, source_raw_id, source_kind, context_kind, taxonomy, concept,
        unit, value_kind, value_numeric, value_text, instant_date, start_date,
        end_date, fiscal_year, fiscal_period, frame, ingested_at
      )
      select source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
             filed_date, source_raw_id, source_kind, context_kind, taxonomy, concept,
             unit, value_kind, value_numeric, value_text, instant_date, start_date,
             end_date, fiscal_year, fiscal_period, frame, ingested_at
      from pg_catalog.jsonb_to_recordset($1::jsonb) as row(
        source_fact_key text, source_fact_path text, issuer_cik text,
        filing_accession text, form text, filed_date date, source_raw_id uuid,
        source_kind text, context_kind text, taxonomy text, concept text, unit text,
        value_kind text, value_numeric numeric, value_text text, instant_date date,
        start_date date, end_date date, fiscal_year integer, fiscal_period text,
        frame text, ingested_at timestamptz
      )
      on conflict (source_fact_key) do nothing`, factJson);
  }

  private async insertJsonChunks<T>(rows: readonly T[], sql: string, map: (row: T) => Record<string, unknown>) {
    let inserted = 0;
    for (const chunk of chunks(rows)) {
      const result = await this.client.query(sql, [JSON.stringify(chunk.map(map))]);
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }
}

function filingJson(row: SecFilingRow) {
  return {
    accession_number: row.accessionNumber, issuer_cik: row.issuerCik, form: row.form,
    filed_date: row.filedDate, accepted_at: row.acceptedAt, report_date: row.reportDate,
    primary_document: row.primaryDocument, is_xbrl: row.isXbrl,
    is_inline_xbrl: row.isInlineXbrl, source_raw_id: row.sourceRawId,
    source_kind: row.sourceKind, ingested_at: row.ingestedAt,
  };
}

function factJson(row: SecCompanyFactRow) {
  return {
    source_fact_key: row.sourceFactKey, source_fact_path: row.sourceFactPath,
    issuer_cik: row.issuerCik, filing_accession: row.filingAccession, form: row.form,
    filed_date: row.filedDate, source_raw_id: row.sourceRawId, source_kind: row.sourceKind,
    context_kind: row.contextKind, taxonomy: row.taxonomy, concept: row.concept,
    unit: row.unit, value_kind: row.valueKind, value_numeric: row.valueNumeric,
    value_text: row.valueText, instant_date: row.instantDate, start_date: row.startDate,
    end_date: row.endDate, fiscal_year: row.fiscalYear, fiscal_period: row.fiscalPeriod,
    frame: row.frame, ingested_at: row.ingestedAt,
  };
}

function mapTicker(row: Record<string, unknown>): SecTickerObservationRow {
  return {
    issuerCik: String(row.issuer_cik), ticker: String(row.ticker), exchange: String(row.exchange),
    sourceRawId: String(row.source_raw_id), sourceKind: "submissions",
    observedAt: new Date(String(row.observed_at)).toISOString(),
    ingestedAt: new Date(String(row.ingested_at)).toISOString(),
  };
}

function mapFiling(row: Record<string, unknown>): SecFilingRow {
  return {
    accessionNumber: String(row.accession_number), issuerCik: String(row.issuer_cik),
    form: String(row.form), filedDate: String(row.filed_date),
    acceptedAt: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : null,
    reportDate: row.report_date ? String(row.report_date) : null,
    primaryDocument: row.primary_document ? String(row.primary_document) : null,
    isXbrl: typeof row.is_xbrl === "boolean" ? row.is_xbrl : null,
    isInlineXbrl: typeof row.is_inline_xbrl === "boolean" ? row.is_inline_xbrl : null,
    sourceRawId: String(row.source_raw_id), sourceKind: "submissions",
    ingestedAt: new Date(String(row.ingested_at)).toISOString(),
  };
}

function mapFact(row: Record<string, unknown>): SecCompanyFactRow {
  return {
    sourceFactKey: String(row.source_fact_key), sourceFactPath: String(row.source_fact_path),
    issuerCik: String(row.issuer_cik), filingAccession: String(row.filing_accession),
    form: String(row.form), filedDate: String(row.filed_date), sourceRawId: String(row.source_raw_id),
    sourceKind: "companyfacts", contextKind: "companyfacts_implicit",
    taxonomy: String(row.taxonomy), concept: String(row.concept), unit: String(row.unit),
    valueKind: row.value_kind === "text" ? "text" : "numeric",
    valueNumeric: row.value_numeric === null ? null : String(row.value_numeric),
    valueText: row.value_text === null ? null : String(row.value_text),
    instantDate: row.instant_date === null ? null : String(row.instant_date),
    startDate: row.start_date === null ? null : String(row.start_date),
    endDate: row.end_date === null ? null : String(row.end_date),
    fiscalYear: row.fiscal_year === null ? null : Number(row.fiscal_year),
    fiscalPeriod: row.fiscal_period === null ? null : String(row.fiscal_period),
    frame: row.frame === null ? null : String(row.frame),
    ingestedAt: new Date(String(row.ingested_at)).toISOString(),
  };
}

function chunks<T>(rows: readonly T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function boundedLimit(value: number | undefined) {
  return Math.min(1000, Math.max(1, Number.isInteger(value) ? value! : 200));
}
