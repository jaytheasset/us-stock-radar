const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const BATCH_SIZE = 400;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  loadDotEnv();
  const dbUrl = process.env.SUPABASE_LOCAL_DB_URL || process.env.SUPABASE_DB_URL;
  const userAgent = process.env.SEC_USER_AGENT;
  if (!dbUrl) throw new Error("SUPABASE_LOCAL_DB_URL is missing.");
  if (!userAgent) throw new Error("SEC_USER_AGENT is missing.");
  assertLocalDatabase(dbUrl);

  const response = await fetch(SEC_TICKERS_URL, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
  });
  if (!response.ok) {
    throw new Error(`SEC ticker download failed (${response.status}).`);
  }
  const rows = normalizeRows(await response.json());
  if (rows.length < 1000) {
    throw new Error(`SEC ticker response is unexpectedly small (${rows.length}).`);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("begin");
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      await upsertBatch(client, rows.slice(index, index + BATCH_SIZE));
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({ source: SEC_TICKERS_URL, upserted: rows.length }));
}

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function assertLocalDatabase(value) {
  const url = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) {
    throw new Error("Refusing to sync SEC tickers to a non-local database.");
  }
}

function normalizeRows(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const indexes = Object.fromEntries(fields.map((field, index) => [field, index]));
  const seen = new Set();
  return data.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const symbol = stringValue(row[indexes.ticker]).toUpperCase();
    const name = stringValue(row[indexes.name]);
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol) || !name || seen.has(symbol)) return [];
    seen.add(symbol);
    return [{
      cik: String(row[indexes.cik] ?? "").replace(/\D/g, ""),
      exchange: stringValue(row[indexes.exchange]) || null,
      name,
      symbol,
    }];
  });
}

async function upsertBatch(client, rows) {
  const values = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 4;
    values.push(row.symbol, row.name, row.exchange, JSON.stringify({ sec_cik: row.cik, source: "sec" }));
    return `($${offset + 1},$${offset + 2},$${offset + 3},'stock',true,$${offset + 4}::jsonb)`;
  });
  await client.query(
    `insert into public.tickers (symbol,name,exchange,asset_type,is_active,metadata)
     values ${placeholders.join(",")}
     on conflict (symbol) do update set
       name = excluded.name,
       exchange = coalesce(excluded.exchange, public.tickers.exchange),
       is_active = true,
       metadata = public.tickers.metadata || excluded.metadata,
       updated_at = now()`,
    values,
  );
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
