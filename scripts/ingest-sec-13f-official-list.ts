import { Client } from "pg";
import { fetchSec13fOfficialList } from "../lib/sec-13f-official-list/fetch.ts";
import { persistSec13fOfficialList } from "../lib/sec-13f-official-list/repository.ts";

const [quarter, sourceUrl] = process.argv.slice(2);
if (!quarter || !sourceUrl) {
  throw new Error("Usage: ingest-sec-13f-official-list <YYYYQn> <SEC official TXT URL>");
}
const userAgent = process.env.SEC_USER_AGENT;
const connectionString = process.env.SEC_13F_OFFICIAL_LIST_DB_URL;
if (!userAgent || !connectionString) {
  throw new Error("SEC_USER_AGENT and explicit SEC_13F_OFFICIAL_LIST_DB_URL are required");
}

const snapshot = await fetchSec13fOfficialList({ sourceUrl, expectedQuarter: quarter, userAgent });
const client = new Client({ connectionString });
await client.connect();
try {
  const result = await persistSec13fOfficialList(client, snapshot);
  console.log(JSON.stringify({
    quarter: snapshot.quarter,
    quarterEnd: snapshot.quarterEnd,
    sourceUrl: snapshot.sourceUrl,
    sourceSha256: snapshot.sourceSha256,
    snapshotId: result.snapshotId,
    inserted: result.inserted,
    rows: result.rowCount,
  }));
} finally {
  await client.end();
}
