import type { Client } from "pg";
import type { Sec13fOfficialListSnapshot } from "./parser.ts";

const BATCH_SIZE = 500;

/** Stores one immutable SEC source version and its fixed-width lines atomically. */
export async function persistSec13fOfficialList(
  client: Client,
  snapshot: Sec13fOfficialListSnapshot,
  transactionMode: "managed" | "external" = "managed",
): Promise<{ snapshotId: string; inserted: boolean; rowCount: number }> {
  if (transactionMode === "managed") await client.query("begin");
  try {
    const existing = await client.query<{
      id: string; source_url: string; source_bytes: Buffer; row_count: number;
    }>(
      `select id, source_url, source_bytes, row_count
         from public.sec_13f_official_list_snapshots
        where quarter = $1 and source_sha256 = $2`,
      [snapshot.quarter, snapshot.sourceSha256],
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      const count = await client.query<{ count: string }>(
        "select count(*)::text as count from public.sec_13f_official_list_entries where snapshot_id = $1",
        [row.id],
      );
      if (row.source_url !== snapshot.sourceUrl
        || !Buffer.from(row.source_bytes).equals(Buffer.from(snapshot.sourceBytes))
        || row.row_count !== snapshot.entries.length
        || Number(count.rows[0]?.count) !== snapshot.entries.length) {
        throw new Error("Existing SEC 13(f) source version does not match the supplied snapshot");
      }
      if (transactionMode === "managed") await client.query("commit");
      return { snapshotId: row.id, inserted: false, rowCount: snapshot.entries.length };
    }

    const inserted = await client.query<{ id: string }>(
      `insert into public.sec_13f_official_list_snapshots
         (quarter, quarter_end, source_url, source_sha256, source_bytes, fetched_at, parser_version, row_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [snapshot.quarter, snapshot.quarterEnd, snapshot.sourceUrl, snapshot.sourceSha256,
        Buffer.from(snapshot.sourceBytes), snapshot.fetchedAt, snapshot.parserVersion, snapshot.entries.length],
    );
    const snapshotId = inserted.rows[0]?.id;
    if (!snapshotId) throw new Error("SEC 13(f) snapshot insert returned no id");

    for (let index = 0; index < snapshot.entries.length; index += BATCH_SIZE) {
      const batch = snapshot.entries.slice(index, index + BATCH_SIZE).map((entry) => ({
        line_number: entry.lineNumber,
        cusip: entry.cusip,
        option_indicator: entry.optionIndicator,
        issuer_name: entry.issuerName,
        security_description: entry.securityDescription,
        status_raw: entry.statusRaw,
        status: entry.status,
        raw_line: entry.rawLine,
      }));
      const result = await client.query(
        `insert into public.sec_13f_official_list_entries
          (snapshot_id, line_number, cusip, option_indicator, issuer_name,
           security_description, status_raw, status, raw_line)
         select $1, line_number, cusip, option_indicator, issuer_name,
                security_description, status_raw, status, raw_line
           from jsonb_to_recordset($2::jsonb) as entry(
             line_number integer, cusip text, option_indicator text, issuer_name text,
             security_description text, status_raw text, status text, raw_line text
           )`,
        [snapshotId, JSON.stringify(batch)],
      );
      if (result.rowCount !== batch.length) throw new Error("SEC 13(f) entry insert was incomplete");
    }
    if (transactionMode === "managed") await client.query("commit");
    return { snapshotId, inserted: true, rowCount: snapshot.entries.length };
  } catch (error) {
    if (transactionMode === "managed") await client.query("rollback");
    throw error;
  }
}
