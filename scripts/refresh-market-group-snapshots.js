const fs = require("fs");
const path = require("path");

const defaultBaseUrl = "http://localhost:3001";
const defaultRanges = ["1D", "5D", "1M", "3M"];

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  loadDotEnv();

  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const startedAt = new Date().toISOString();

  const results = [];
  for (const range of options.ranges) {
    const url = new URL("/api/market/sector-performance", baseUrl);
    url.searchParams.set("range", range);
    if (options.refresh) url.searchParams.set("refresh", "1");

    const started = Date.now();
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => null);
      const sectorCount = Array.isArray(data?.sectors) ? data.sectors.length : 0;
      const industryCount = Array.isArray(data?.sectors)
        ? data.sectors.reduce((sum, sector) => sum + (Array.isArray(sector.industries) ? sector.industries.length : 0), 0)
        : 0;

      results.push({
        range,
        ok: response.ok && Boolean(data?.ok),
        status: response.status,
        cache: data?.cache || null,
        cacheWrite: data?.cacheWrite || null,
        sectors: sectorCount,
        industries: industryCount,
        ms: Date.now() - started,
        error: response.ok ? data?.cacheWriteError : data?.error || response.statusText,
      });
    } catch (error) {
      results.push({
        range,
        ok: false,
        status: 0,
        cache: null,
        cacheWrite: null,
        sectors: 0,
        industries: 0,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        baseUrl,
        refresh: options.refresh,
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length) process.exit(1);
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
    baseUrl: process.env.LOCAL_APP_BASE_URL || defaultBaseUrl,
    ranges: defaultRanges,
    refresh: true,
  };

  for (const arg of args) {
    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length).trim() || options.baseUrl;
    } else if (arg.startsWith("--ranges=")) {
      const ranges = arg
        .slice("--ranges=".length)
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      options.ranges = ranges.length ? ranges : options.ranges;
    } else if (arg === "--cache-ok") {
      options.refresh = false;
    }
  }

  options.ranges = options.ranges.filter((range) => defaultRanges.includes(range));
  if (!options.ranges.length) {
    throw new Error(`No supported ranges supplied. Use one of ${defaultRanges.join(", ")}`);
  }

  return options;
}
