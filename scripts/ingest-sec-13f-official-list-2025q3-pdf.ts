import { Client } from "pg";
import { fetchSec13f2025Q3Pdf } from "../lib/sec-13f-official-list/pdf2025q3.ts";
import { persistSec13fOfficialList } from "../lib/sec-13f-official-list/repository.ts";

const userAgent = process.env.SEC_USER_AGENT;
const connectionString = process.env.SEC_13F_OFFICIAL_LIST_DB_URL;
if (!userAgent || !connectionString) {
  throw new Error("SEC_USER_AGENT and explicit SEC_13F_OFFICIAL_LIST_DB_URL are required");
}

const snapshot = await fetchSec13f2025Q3Pdf({ userAgent });
const client = new Client({ connectionString });
await client.connect();
try {
  const result = await persistSec13fOfficialList(client, snapshot);
  console.log(JSON.stringify({
    quarter: snapshot.quarter,
    quarterEnd: snapshot.quarterEnd,
    sourceFormat: snapshot.sourceFormat,
    sourceUrl: snapshot.sourceUrl,
    sourceSha256: snapshot.sourceSha256,
    parserVersion: snapshot.parserVersion,
    snapshotId: result.snapshotId,
    inserted: result.inserted,
    rows: result.rowCount,
    calls: snapshot.entries.filter((entry) => entry.securityDescription === "CALL").length,
    puts: snapshot.entries.filter((entry) => entry.securityDescription === "PUT").length,
  }));
} finally {
  await client.end();
}
