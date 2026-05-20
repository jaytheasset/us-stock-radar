const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const defaultLimit = 20000;
const defaultMinMarketCap = 50_000_000;
const defaultExchanges = ["NASDAQ", "NYSE", "AMEX", "OTC", "PNK"];
const stockAssetTypes = ["stock", "adr_or_class", "warrant", "unit"];

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  loadDotEnv();

  const options = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.SUPABASE_DB_URL;
  const fmpApiKey = process.env.FMP_API_KEY;

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is missing");
  if (!fmpApiKey) throw new Error("FMP_API_KEY is missing");

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await applyTaxonomySeed(client);
    const mappings = await loadIndustryMappings(client);
    const rows = await fetchFmpUniverse(fmpApiKey, options);
    const normalized = rows.map(normalizeCompanyRow).filter(Boolean);
    const tickers = normalized.filter((row) => row.marketCap >= options.minMarketCap);
    const classified =
      options.assetType === "stock"
        ? tickers
            .map((row) => ({ row, mapping: mappings.get(row.industry) }))
            .filter((item) => item.mapping)
        : [];

    if (!options.dryRun) {
      await upsertTickers(client, tickers);
      await deactivateMissingFmpTickers(client, tickers.map((row) => row.symbol), deactivationAssetTypes(options));
      await upsertClassifications(client, classified);
    }

    const counts = await readCounts(client);
    const unmatchedIndustries = summarizeUnmatched(tickers, mappings);

    console.log(
      JSON.stringify(
        {
          dryRun: options.dryRun,
          assetType: options.assetType,
          fetched: rows.length,
          usable: tickers.length,
          classified: classified.length,
          unmatched: tickers.length - classified.length,
          db: counts,
          unmatchedIndustries,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    assetType: "stock",
    exchanges: defaultExchanges,
    limit: defaultLimit,
    minMarketCap: defaultMinMarketCap,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "limit") options.limit = clampInt(value, 1, 50000, defaultLimit);
    if (key === "min-market-cap") options.minMarketCap = clampInt(value, 0, Number.MAX_SAFE_INTEGER, defaultMinMarketCap);
    if (key === "asset-type") options.assetType = parseAssetType(value);
    if (key === "exchanges") {
      options.exchanges = stringValue(value)
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
    }
  }

  if (!options.exchanges.length) options.exchanges = defaultExchanges;
  return options;
}

function parseAssetType(value) {
  return stringValue(value).toLowerCase() === "etf" ? "etf" : "stock";
}

async function applyTaxonomySeed(client) {
  const seedPath = path.join(process.cwd(), "docs", "db", "taxonomy_seed.sql");
  const sql = fs.readFileSync(seedPath, "utf8");
  const [taxonomyOnly] = sql.split(/insert into theme_groups/i);

  await client.query(taxonomyOnly);
}

async function loadIndustryMappings(client) {
  const result = await client.query(
    `select fmp_industry, sector_code, sub_category_slug
     from fmp_industry_mappings
     where is_primary = true
     order by fmp_industry, priority asc`,
  );
  const mappings = new Map();

  for (const row of result.rows) {
    if (!mappings.has(row.fmp_industry)) {
      mappings.set(row.fmp_industry, {
        sectorCode: row.sector_code,
        subCategorySlug: row.sub_category_slug,
      });
    }
  }

  return mappings;
}

async function fetchFmpUniverse(apiKey, options) {
  const rows = [];

  for (const exchange of options.exchanges) {
    const url = new URL("https://financialmodelingprep.com/stable/company-screener");
    url.searchParams.set("limit", String(options.limit));
    url.searchParams.set("exchange", exchange);
    url.searchParams.set("isEtf", options.assetType === "etf" ? "true" : "false");
    url.searchParams.set("isFund", "false");
    url.searchParams.set("isActivelyTrading", "true");
    url.searchParams.set("marketCapMoreThan", String(options.minMarketCap));
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readProviderError(data, `FMP company-screener failed with ${response.status}`));
    }

    if (!Array.isArray(data)) {
      throw new Error("FMP company-screener returned a non-array response");
    }

    rows.push(...data);
  }

  return Array.from(new Map(rows.map((row) => [row.symbol, row])).values());
}

function normalizeCompanyRow(value) {
  if (!value || typeof value !== "object") return null;

  const symbol = stringValue(value.symbol).toUpperCase();
  const name = stringValue(value.companyName);
  const marketCap = numberValue(value.marketCap);
  const sector = stringValue(value.sector);
  const industry = stringValue(value.industry);
  const exchange = stringValue(value.exchangeShortName || value.exchange);
  const country = stringValue(value.country);
  const isEtf = Boolean(value.isEtf);
  const isFund = Boolean(value.isFund);
  const isActivelyTrading = value.isActivelyTrading !== false;

  if (!symbol || !industry || !Number.isFinite(marketCap) || marketCap <= 0) return null;

  return {
    assetType: classifyAssetType(value),
    country,
    exchange,
    industry,
    isActive: isActivelyTrading,
    isEtf,
    isFund,
    marketCap,
    name,
    raw: value,
    sector,
    symbol,
  };
}

async function upsertTickers(client, rows) {
  for (const chunk of chunks(rows, 500)) {
    const values = [];
    const placeholders = chunk.map((row, index) => {
      const offset = index * 10;
      values.push(
        row.symbol,
        row.name || null,
        row.exchange || null,
        row.sector || null,
        row.industry || null,
        row.assetType,
        row.marketCap,
        row.isActive,
        JSON.stringify({
          country: row.country,
          isEtf: row.isEtf,
          isFund: row.isFund,
          provider: "fmp",
          raw: row.raw,
        }),
        new Date(),
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}::jsonb, $${offset + 10})`;
    });

    await client.query(
      `insert into tickers
        (symbol, name, exchange, fmp_sector, fmp_industry, asset_type, market_cap, is_active, metadata, last_profiled_at)
       values ${placeholders.join(",")}
       on conflict (symbol) do update set
        name = excluded.name,
        exchange = excluded.exchange,
        fmp_sector = excluded.fmp_sector,
        fmp_industry = excluded.fmp_industry,
        asset_type = excluded.asset_type,
        market_cap = excluded.market_cap,
        is_active = excluded.is_active,
        metadata = excluded.metadata,
        last_profiled_at = excluded.last_profiled_at,
        updated_at = now()`,
      values,
    );
  }
}

async function upsertClassifications(client, items) {
  for (const chunk of chunks(items, 500)) {
    const values = [];
    const placeholders = chunk.map((item, index) => {
      const offset = index * 7;
      values.push(
        item.row.symbol,
        item.mapping.sectorCode,
        item.mapping.subCategorySlug,
        "rule",
        0.95,
        `FMP industry matched: ${item.row.industry}`,
        JSON.stringify({
          fmpIndustry: item.row.industry,
          fmpSector: item.row.sector,
          provider: "fmp",
        }),
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::classification_method, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb)`;
    });

    await client.query(
      `insert into ticker_classifications
        (symbol, sector_code, sub_category_slug, method, confidence, reason, metadata)
       values ${placeholders.join(",")}
       on conflict (symbol) do update set
        sector_code = case when ticker_classifications.manual_override then ticker_classifications.sector_code else excluded.sector_code end,
        sub_category_slug = case when ticker_classifications.manual_override then ticker_classifications.sub_category_slug else excluded.sub_category_slug end,
        method = case when ticker_classifications.manual_override then ticker_classifications.method else excluded.method end,
        confidence = case when ticker_classifications.manual_override then ticker_classifications.confidence else excluded.confidence end,
        reason = case when ticker_classifications.manual_override then ticker_classifications.reason else excluded.reason end,
        metadata = case when ticker_classifications.manual_override then ticker_classifications.metadata else excluded.metadata end,
        updated_at = now()`,
      values,
    );
  }
}

async function deactivateMissingFmpTickers(client, activeSymbols, assetTypes) {
  await client.query(
    `update tickers
     set is_active = false, updated_at = now()
     where metadata->>'provider' = 'fmp'
       and asset_type = any($2)
       and not (symbol = any($1))`,
    [activeSymbols, assetTypes],
  );
}

function deactivationAssetTypes(options) {
  return options.assetType === "etf" ? ["etf"] : stockAssetTypes;
}

async function readCounts(client) {
  const result = await client.query(
    `select
      (select count(*)::int from tickers) as tickers,
      (select count(*)::int from tickers where is_active) as active_tickers,
      (select count(*)::int from tickers where asset_type = 'etf') as etf_tickers,
      (select count(*)::int from tickers where asset_type = 'etf' and is_active) as active_etf_tickers,
      (select count(*)::int from ticker_classifications) as classifications,
      (select count(*)::int from fmp_industry_mappings) as fmp_mappings`,
  );
  return result.rows[0];
}

function summarizeUnmatched(rows, mappings) {
  const counts = new Map();
  for (const row of rows) {
    if (mappings.has(row.industry)) continue;
    counts.set(row.industry, (counts.get(row.industry) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([industry, count]) => ({ industry, count }));
}

function classifyAssetType(row) {
  if (row.isEtf) return "etf";
  if (row.isFund) return "fund";
  const symbol = stringValue(row.symbol);
  if (symbol.includes(".")) return "adr_or_class";
  if (/W$|WS$|WT$|WTS$/.test(symbol)) return "warrant";
  if (/U$|UN$|UNIT$/.test(symbol)) return "unit";
  return "stock";
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function stringValue(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readProviderError(data, fallback) {
  if (!data || typeof data !== "object") return fallback;
  return String(data["Error Message"] || data.message || data.error || fallback);
}
