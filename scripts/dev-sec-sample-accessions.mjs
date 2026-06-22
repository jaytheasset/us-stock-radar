#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const SEC_CURRENT_URL = "https://www.sec.gov/cgi-bin/browse-edgar";
const SEC_SEARCH_INDEX_URL = "https://efts.sec.gov/LATEST/search-index";
const DEFAULT_USER_AGENT = "US-Stock-Radar/0.1 contact@example.com";

const args = parseArgs(process.argv.slice(2));
const formTypes = readCsv(args.formTypes || args.forms);
const target = clampInt(args.target, 1, 1000, 100);
const maxPages = clampInt(args.maxPages, 1, 50, 10);
const pageSize = clampInt(args.pageSize, 10, 100, 100);
const delayMs = clampInt(args.delayMs, 0, 10_000, 700);
const mode = args.mode === "per-form" ? "per-form" : "total";
const source = args.source === "current" ? "current" : "efts";
const dateFrom = normalizeDateOnly(args.dateFrom || args.from || args.startDate);
const dateTo = normalizeDateOnly(args.dateTo || args.to || args.endDate);
const outPath =
  typeof args.out === "string" && args.out.trim()
    ? path.resolve(process.cwd(), args.out.trim())
    : path.join(
        process.cwd(),
        "outputs",
        "sec-sample-accessions",
        `${slugify(formTypes.join("-") || "sec")}-${new Date().toISOString().slice(0, 10)}.json`,
      );

if (!formTypes.length) {
  console.error('Usage: node scripts/dev-sec-sample-accessions.mjs --formTypes "S-4,S-4/A" --target 100');
  process.exit(1);
}

const startedAt = new Date().toISOString();
const diagnostics = {
  source,
  date_from: dateFrom,
  date_to: dateTo,
  feeds_requested: 0,
  feed_entries_seen: 0,
  exact_form_entries_kept: 0,
  duplicate_entries_skipped: 0,
  pages_by_form: {},
  search_pages_requested: 0,
  search_hits_seen: 0,
  search_total: null,
  errors: [],
};

const items = [];
const seenAccessions = new Set();

if (source === "efts") {
  await collectFromSearchIndex();
} else {
  await collectFromCurrentFeed();
}

const output = {
  kind: "sec_accession_sample_list",
  note: "Sample list only. This file is not a raw item, parser input, analysis result, DB payload, or alert payload.",
  runtime_safe: false,
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  formTypes,
  mode,
  source,
  target,
  maxPages,
  pageSize,
  delayMs,
  dateFrom,
  dateTo,
  collected: items.length,
  diagnostics,
  items,
};

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: outPath,
  collected: items.length,
  formTypes,
  diagnostics,
}, null, 2));

async function collectFromSearchIndex() {
  if (formTypes.some(isSchedule13FormType)) {
    await collectSchedule13FromSearchIndex();
    return;
  }

  for (let page = 0; page < maxPages; page += 1) {
    if (items.length >= target) break;

    const from = page * pageSize;
    diagnostics.search_pages_requested += 1;

    const search = await fetchSearchIndexPage({ formTypes, from, size: pageSize });
    if (!search.ok) {
      diagnostics.errors.push({
        source: "efts",
        from,
        status: search.status,
        error: search.error,
      });
      if (search.status === 429 || search.status >= 500) {
        await sleep(Math.max(delayMs, 2_000));
        page -= 1;
        continue;
      }
      break;
    }

    diagnostics.search_total = search.total;
    diagnostics.search_hits_seen += search.entries.length;
    if (!search.entries.length) break;

    for (const entry of search.entries) {
      if (!formTypes.includes(entry.formType)) continue;
      const key = entry.accessionNumber || entry.detailUrl;
      if (!key) continue;
      if (seenAccessions.has(key)) {
        diagnostics.duplicate_entries_skipped += 1;
        continue;
      }
      seenAccessions.add(key);
      diagnostics.exact_form_entries_kept += 1;
      items.push(entry);
      if (items.length >= target) break;
    }

    await sleep(delayMs);
  }
}

async function collectSchedule13FromSearchIndex() {
  for (const formType of formTypes) {
    const formItems = [];
    for (let page = 0; page < maxPages; page += 1) {
      if (mode === "total" && items.length >= target) break;
      if (mode === "per-form" && formItems.length >= target) break;

      const from = page * pageSize;
      diagnostics.search_pages_requested += 1;
      diagnostics.pages_by_form[formType] = page + 1;

      const search = await fetchSearchIndexPage({
        formTypes: [],
        query: schedule13SearchQuery(formType),
        from,
        size: pageSize,
      });
      if (!search.ok) {
        diagnostics.errors.push({
          source: "efts",
          formType,
          from,
          status: search.status,
          error: search.error,
        });
        if (search.status === 429 || search.status >= 500) {
          await sleep(Math.max(delayMs, 2_000));
          page -= 1;
          continue;
        }
        break;
      }

      diagnostics.search_total = search.total;
      diagnostics.search_hits_seen += search.entries.length;
      if (!search.entries.length) break;

      for (const entry of search.entries) {
        if (entry.formType !== formType) continue;
        const key = entry.accessionNumber || entry.detailUrl;
        if (!key) continue;
        if (seenAccessions.has(key)) {
          diagnostics.duplicate_entries_skipped += 1;
          continue;
        }
        seenAccessions.add(key);
        diagnostics.exact_form_entries_kept += 1;
        const item = {
          ...entry,
          requestedFormType: formType,
        };
        items.push(item);
        formItems.push(item);
        if (mode === "total" && items.length >= target) break;
        if (mode === "per-form" && formItems.length >= target) break;
      }

      await sleep(delayMs);
    }
  }
}

async function collectFromCurrentFeed() {
  for (const formType of formTypes) {
    const formItems = [];
    for (let page = 0; page < maxPages; page += 1) {
      if (mode === "total" && items.length >= target) break;
      if (mode === "per-form" && formItems.length >= target) break;

      const start = page * pageSize;
      diagnostics.feeds_requested += 1;
      diagnostics.pages_by_form[formType] = page + 1;

      const feed = await fetchCurrentFeedPage({ formType, start, count: pageSize });
      if (!feed.ok) {
        diagnostics.errors.push({
          source: "current",
          formType,
          start,
          status: feed.status,
          error: feed.error,
        });
        if (feed.status === 429 || feed.status >= 500) {
          await sleep(Math.max(delayMs, 2_000));
          page -= 1;
          continue;
        }
        break;
      }

      diagnostics.feed_entries_seen += feed.entries.length;
      if (!feed.entries.length) break;

      for (const entry of feed.entries) {
        if (entry.formType !== formType) continue;
        if (!isWithinDateRange(entry.updated, dateFrom, dateTo)) continue;
        const key = entry.accessionNumber || entry.detailUrl;
        if (!key) continue;
        if (seenAccessions.has(key)) {
          diagnostics.duplicate_entries_skipped += 1;
          continue;
        }
        seenAccessions.add(key);
        diagnostics.exact_form_entries_kept += 1;
        const item = {
          formType: entry.formType,
          accessionNumber: entry.accessionNumber,
          title: entry.title,
          updated: entry.updated,
          detailUrl: entry.detailUrl,
          requestedFormType: formType,
        };
        items.push(item);
        formItems.push(item);
        if (mode === "total" && items.length >= target) break;
        if (mode === "per-form" && formItems.length >= target) break;
      }

      await sleep(delayMs);
    }
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
}

async function fetchCurrentFeedPage({ formType, start, count }) {
  const url = new URL(SEC_CURRENT_URL);
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("type", formType);
  url.searchParams.set("owner", ownerModeForForm(formType));
  url.searchParams.set("start", String(start));
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");

  const response = await secFetch(url, {
    Accept: "application/atom+xml, text/xml, text/plain, */*",
  });
  if (!response) {
    return {
      ok: false,
      status: 0,
      entries: [],
      error: "SEC current feed request timed out",
    };
  }
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      entries: [],
      error: response.statusText || `HTTP ${response.status}`,
    };
  }
  return {
    ok: true,
    status: response.status,
    entries: parseCurrentFeed(text, formType),
  };
}

async function fetchSearchIndexPage({ formTypes, query = "", from, size }) {
  const url = new URL(SEC_SEARCH_INDEX_URL);
  url.searchParams.set("q", query);
  if (dateFrom || dateTo) {
    url.searchParams.set("dateRange", "custom");
    if (dateFrom) url.searchParams.set("startdt", dateFrom);
    if (dateTo) url.searchParams.set("enddt", dateTo);
  } else {
    url.searchParams.set("dateRange", "1y");
  }
  url.searchParams.set("category", "custom");
  if (formTypes.length) {
    url.searchParams.set("forms", formTypes.join(","));
  }
  url.searchParams.set("from", String(from));
  url.searchParams.set("size", String(size));

  const response = await secFetch(url, {
    Accept: "application/json, text/plain, */*",
  });
  if (!response) {
    return {
      ok: false,
      status: 0,
      total: null,
      entries: [],
      error: "SEC search request timed out",
    };
  }
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      total: null,
      entries: [],
      error: response.statusText || `HTTP ${response.status}`,
    };
  }

  try {
    const parsed = JSON.parse(text);
    const hits = arrayOf(parsed?.hits?.hits);
    const totalValue = parsed?.hits?.total?.value;
    return {
      ok: true,
      status: response.status,
      total: Number.isFinite(totalValue) ? totalValue : null,
      entries: hits.map(parseSearchIndexHit).filter(Boolean),
    };
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      total: null,
      entries: [],
      error: error instanceof Error ? error.message : "Could not parse SEC search response",
    };
  }
}

async function secFetch(url, headers = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": process.env.SEC_USER_AGENT || DEFAULT_USER_AGENT,
          "Accept-Encoding": "gzip, deflate, br",
          ...headers,
        },
      });
    } catch (error) {
      lastError = error;
      await sleep(1_000 * (attempt + 1));
    }
  }
  diagnostics.errors.push({
    source: "fetch",
    url: String(url),
    error: lastError instanceof Error ? lastError.message : "SEC request failed",
  });
  return null;
}

function parseSearchIndexHit(hit) {
  const source = hit?._source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const formType = normalizeFormType(source.form || source.file_type);
  const accessionNumber = stringValue(source.adsh);
  if (!formType || !accessionNumber) return null;

  const cik = arrayOf(source.ciks).map(stringValue).find(Boolean) || null;
  const detailUrl = cik ? buildFilingDetailUrl(cik, accessionNumber) : null;
  return {
    formType,
    accessionNumber,
    title: buildSearchIndexTitle(source, formType),
    updated: normalizeDateTime(source.file_date),
    detailUrl,
    requestedFormType: formType,
  };
}

function buildSearchIndexTitle(source, formType) {
  const displayName = arrayOf(source.display_names).map(stringValue).find(Boolean);
  return displayName ? `${formType} - ${displayName}` : `${formType} - ${stringValue(source.adsh)}`;
}

function buildFilingDetailUrl(cik, accessionNumber) {
  const cikNoLeadingZeros = String(Number.parseInt(cik, 10));
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  if (!cikNoLeadingZeros || !accessionNoDashes) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${accessionNumber}-index.htm`;
}

function parseCurrentFeed(xml, requestedFormType) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const entries = arrayOf(parsed?.feed?.entry);
  return entries.map((entry) => {
    const link = Array.isArray(entry.link) ? entry.link[0] : entry.link;
    const detailUrl = absoluteSecUrl(stringValue(link?.href));
    return {
      title: stringValue(entry.title) || null,
      updated: normalizeDateTime(entry.updated),
      detailUrl,
      accessionNumber: parseAccessionNumber(detailUrl),
      formType: readCurrentFeedEntryFormType(entry) || normalizeFormType(requestedFormType),
      requestedFormType: normalizeFormType(requestedFormType),
    };
  });
}

function readCurrentFeedEntryFormType(entry) {
  const categories = arrayOf(entry.category);
  for (const category of categories) {
    if (!category || typeof category !== "object" || Array.isArray(category)) continue;
    const label = stringValue(category.label).toLowerCase();
    const term = normalizeFormType(category.term);
    if (term && (!label || label === "form type")) return term;
  }

  const titlePrefix = stringValue(entry.title).match(/^\s*([A-Z0-9][A-Z0-9 /\-]*?(?:\/A)?)\s+-/i)?.[1];
  return normalizeFormType(titlePrefix) || null;
}

function parseAccessionNumber(detailUrl) {
  const match = stringValue(detailUrl).match(/\/Archives\/edgar\/data\/\d+\/(\d{18})\//i);
  if (!match?.[1]) return null;
  const value = match[1];
  return `${value.slice(0, 10)}-${value.slice(10, 12)}-${value.slice(12)}`;
}

function ownerModeForForm(formType) {
  return /^(?:3|4|5|144)(?:\/A)?$/i.test(formType) ? "only" : "include";
}

function normalizeFormType(value) {
  const text = stringValue(value)
    .toUpperCase()
    .replace(/^SCHEDULE\s+13([DG])(\/A)?$/, "SC 13$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function isSchedule13FormType(value) {
  return /^SC 13[DG](?:\/A)?$/i.test(stringValue(value));
}

function schedule13SearchQuery(formType) {
  const normalized = normalizeFormType(formType);
  if (normalized === "SC 13D") return "SCHEDULE 13D";
  if (normalized === "SC 13D/A") return "SC 13D/A";
  if (normalized === "SC 13G") return "SCHEDULE 13G";
  if (normalized === "SC 13G/A") return "SC 13G/A";
  return normalized || "";
}

function readCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeFormType(item))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function absoluteSecUrl(value) {
  const text = stringValue(value);
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `https://www.sec.gov${text}`;
  return `https://www.sec.gov/${text}`;
}

function normalizeDateTime(value) {
  const text = stringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function normalizeDateOnly(value) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isWithinDateRange(value, from, to) {
  if (!from && !to) return true;
  const normalized = normalizeDateTime(value);
  const date = normalized ? normalized.slice(0, 10) : null;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function arrayOf(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function stringValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sec";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
