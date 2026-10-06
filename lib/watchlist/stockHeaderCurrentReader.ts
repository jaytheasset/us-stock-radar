import "server-only";
import { createServerPostgresPool, type ServerPostgresPool } from "../serverPostgres.ts";
import { readCurrentIssuerSubmissions } from "../sec-structured-data/currentSubmissionsReader.ts";
import type { SecCurrentSubmissionsResult } from "../sec-structured-data/types.ts";

export const STOCK_HEADER_DB_LIMITS = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
  // Transport watchdog: on failure the acquired connection is destroyed below,
  // not returned with a still-running query. SQL itself is cancelled by Postgres.
  query_timeout: 5_500,
  options: "-c default_transaction_read_only=on",
} as const;

// Separate bounded read pool: never wait behind a refresh's managed connection.
let headerPool: ServerPostgresPool | undefined;
function getHeaderPool() {
  if (!headerPool) {
    const pool = createServerPostgresPool(process.env, STOCK_HEADER_DB_LIMITS);
    // pg already removes an errored idle client. Handle the event so an idle
    // disconnect does not crash the page server; subsequent reads reconnect.
    pool.on?.("error", () => {});
    headerPool = pool;
  }
  return headerPool;
}
export async function readStockHeaderCurrent(cik: string, pool?: ServerPostgresPool): Promise<SecCurrentSubmissionsResult> {
  let client;
  let failed = false;
  try {
    const readPool = pool ?? getHeaderPool();
    client = await readPool.connect();
    const acquired = client;
    return await readCurrentIssuerSubmissions({ async query(text, values) {
      try { return await acquired.query(text, values); }
      catch (error) { failed = true; throw error; }
    } }, { cik });
  } catch {
    return { status: "unavailable" };
  } finally {
    client?.release(failed);
  }
}
