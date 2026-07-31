import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_TICKERS = ["AMD", "JPM", "MULN"];
const SAFE_FIELDS = new Set([
  "acceptedDate",
  "amountBeneficiallyOwned",
  "calendarYear",
  "cashAndShortTermInvestments",
  "date",
  "denominator",
  "epsDiluted",
  "filingDate",
  "fiscalYear",
  "floatShares",
  "freeCashFlow",
  "freeFloat",
  "holder",
  "investorName",
  "investorsHolding",
  "investorsHoldingChange",
  "netIncome",
  "numberOfShares",
  "numerator",
  "operatingCashFlow",
  "outstandingShares",
  "ownershipPercent",
  "percentOfClass",
  "period",
  "reportingName",
  "revenue",
  "securitiesTransacted",
  "symbol",
  "totalDebt",
  "transactionType",
]);

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value?.startsWith("--")) continue;
  args.set(value.slice(2), process.argv[index + 1] ?? "");
  index += 1;
}

const envRoot = args.get("env-root") || process.cwd();
const tickers = (args.get("tickers") || DEFAULT_TICKERS.join(","))
  .split(",")
  .map((ticker) => ticker.trim().toUpperCase())
  .filter((ticker) => /^[A-Z0-9.-]{1,12}$/.test(ticker));

loadLocalEnv(join(envRoot, ".env.local"));

const apiKey = process.env.FMP_API_KEY || "";
if (!apiKey) {
  console.error("FMP_API_KEY is not configured in the selected environment root.");
  process.exit(2);
}

const currentYear = new Date().getUTCFullYear();
const latestFiledQuarter = Math.max(
  1,
  Math.min(4, Math.ceil((new Date().getUTCMonth() + 1) / 3) - 1),
);

const definitions = [
  ["incomeQuarterly", "income-statement", { period: "quarter", limit: "5" }],
  ["incomeAnnual", "income-statement", { period: "annual", limit: "5" }],
  ["balanceQuarterly", "balance-sheet-statement", { period: "quarter", limit: "5" }],
  ["balanceAnnual", "balance-sheet-statement", { period: "annual", limit: "5" }],
  ["cashQuarterly", "cash-flow-statement", { period: "quarter", limit: "5" }],
  ["cashAnnual", "cash-flow-statement", { period: "annual", limit: "5" }],
  ["sharesFloat", "shares-float", {}],
  ["splits", "splits", {}],
  ["enterpriseValues", "enterprise-values", { period: "quarter", limit: "8" }],
  ["insiderStatistics", "insider-trading/statistics", {}],
  ["insiderTrades", "insider-trading/search", { page: "0", limit: "5" }],
  ["beneficialOwnership", "acquisition-of-beneficial-ownership", {}],
  [
    "institutionalSummary",
    "institutional-ownership/symbol-positions-summary",
    { year: String(currentYear), quarter: String(latestFiledQuarter) },
  ],
  [
    "institutionalHolders",
    "institutional-ownership/extract-analytics/holder",
    {
      year: String(currentYear),
      quarter: String(latestFiledQuarter),
      page: "0",
      limit: "5",
    },
  ],
];

const results = [];
for (const ticker of tickers) {
  for (const [source, endpoint, params] of definitions) {
    results.push(await probeSource(ticker, source, endpoint, params));
  }
}

console.log(
  JSON.stringify(
    {
      authorization: "configured-server-side",
      checkedAt: new Date().toISOString(),
      results,
      tickers,
    },
    null,
    2,
  ),
);

async function probeSource(ticker, source, endpoint, params) {
  const url = new URL(`https://financialmodelingprep.com/stable/${endpoint}`);
  url.searchParams.set("symbol", ticker);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", apikey: apiKey },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    const rows = readRows(payload);
    return {
      fields:
        rows[0] && typeof rows[0] === "object"
          ? Object.keys(rows[0]).filter((field) => SAFE_FIELDS.has(field))
          : [],
      rowCount: rows.length,
      source,
      status: response.status,
      ticker,
    };
  } catch {
    return { fields: [], rowCount: 0, source, status: 0, ticker };
  } finally {
    clearTimeout(timeout);
  }
}

function readRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function loadLocalEnv(path) {
  let contents = "";
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    process.env[match[1]] = value;
  }
}
