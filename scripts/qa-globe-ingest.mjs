#!/usr/bin/env node

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const limit = clampInt(Number(args.get("limit") || 20), 1, 20);
const skipIngest = args.get("skip-ingest") === "true";

const checks = [];

try {
  const raw = await getJson(`/api/sources/globe/raw-preview?limit=${limit}&includeArticleBody=false`);
  check("raw preview returns ok", raw.ok === true, raw);
  check("raw preview returns requested count", raw.count === limit, raw);
  check("raw preview exposes non-English skip diagnostics", Number.isFinite(raw.diagnostics?.skippedNonEnglish), raw);

  if (!skipIngest) {
    const first = await postJson(`/api/sources/globe/ingest?limit=${limit}`);
    check("first ingest returns ok", first.ok === true, first);
    check("first ingest has zero failed items", first.stats?.failed_count === 0, first);

    const second = await postJson(`/api/sources/globe/ingest?limit=${limit}`);
    check("second ingest returns ok", second.ok === true, second);
    check("second ingest has zero failed items", second.stats?.failed_count === 0, second);
    check("second ingest does not create duplicate events", second.stats?.event_upserted_count === 0, second);
  }

  const events = await getJson(`/api/events?source_group=news&include_archive=true&limit=100`);
  const eventRows = Array.isArray(events.data) ? events.data : [];
  const companyWithoutTicker = eventRows.filter((event) => event.market_scope === "company" && !event.ticker);
  const deliveryMismatches = eventRows.filter((event) => {
    const score = Number(event.score);
    return expectedDeliveryLevel(score) !== event.delivery_level;
  });
  const impactMismatches = eventRows.filter((event) => {
    const score = Number(event.score);
    return expectedImpact(score) !== event.impact;
  });
  const feedTextPollution = eventRows.filter((event) => {
    if (event.delivery_level === "archive") return false;
    return String(event.summary || "").toLowerCase().includes("limited market impact detected");
  });

  check("company-scoped events all have a ticker", companyWithoutTicker.length === 0, companyWithoutTicker);
  check("news events use score-based delivery levels", deliveryMismatches.length === 0, deliveryMismatches);
  check("news events use score-based impact labels", impactMismatches.length === 0, impactMismatches);
  check("feed/alert summaries do not contain archive UI copy", feedTextPollution.length === 0, feedTextPollution);

  const summary = {
    baseUrl,
    limit,
    checksPassed: checks.filter((item) => item.ok).length,
    checksFailed: checks.filter((item) => !item.ok).length,
    eventCountChecked: eventRows.length,
    companyWithoutTicker: companyWithoutTicker.length,
    deliveryMismatches: deliveryMismatches.length,
    impactMismatches: impactMismatches.length,
    feedTextPollution: feedTextPollution.length,
  };

  console.log(JSON.stringify({ ok: summary.checksFailed === 0, summary, checks }, null, 2));
  process.exit(summary.checksFailed === 0 ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, checks }, null, 2));
  process.exit(1);
}

async function getJson(path) {
  return fetchJson(path, { method: "GET" });
}

async function postJson(path) {
  return fetchJson(path, { method: "POST" });
}

async function fetchJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${options.method} ${path} failed: HTTP ${response.status} ${stringifyShort(body)}`);
  }

  return body;
}

function check(name, ok, detail) {
  checks.push({
    name,
    ok: Boolean(ok),
    detail: ok ? undefined : detail,
  });
}

function stringifyShort(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function expectedDeliveryLevel(score) {
  if (!Number.isFinite(score)) return "";
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function expectedImpact(score) {
  if (!Number.isFinite(score)) return "";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}
