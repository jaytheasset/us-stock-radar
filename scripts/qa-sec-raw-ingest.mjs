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
const formTypes = String(args.get("formTypes") || "8-K");
const limit = Number(args.get("limit") || 1);
const persist = args.get("persist") === "true";
const checks = [];

try {
  const rawPreview = await getJson(
    `/api/sources/sec/raw-preview?formTypes=${encodeURIComponent(formTypes)}&limit=${limit}&countPerForm=5&attachmentLimit=2`,
  );
  check("raw preview returns ok", rawPreview.ok === true, rawPreview);
  check("raw preview returns items", Array.isArray(rawPreview.items) && rawPreview.items.length > 0, rawPreview);
  check("raw preview fetched document text", Number(rawPreview.items?.[0]?.body_text?.length || 0) > 500, rawPreview.items?.[0]);
  check("raw preview has accession number", Boolean(rawPreview.items?.[0]?.source_unique_id), rawPreview.items?.[0]);
  check("raw preview has primary document URL", Boolean(rawPreview.items?.[0]?.raw_payload?.primary_document_url), rawPreview.items?.[0]);
  check(
    "raw preview has filing metadata",
    Boolean(rawPreview.items?.[0]?.raw_payload?.form_type && rawPreview.items?.[0]?.raw_payload?.cik),
    rawPreview.items?.[0],
  );

  const dryRun = await postJson(
    `/api/sources/sec/ingest?formTypes=${encodeURIComponent(formTypes)}&limit=${limit}&countPerForm=5&attachmentLimit=2&dryRun=true`,
    {},
  );
  check("dry-run ingest returns ok", dryRun.ok === true, dryRun);
  check("dry-run ingest does not create run id", dryRun.runId === null, dryRun);
  check("dry-run ingest checks items", Number(dryRun.stats?.checked_count || 0) > 0, dryRun);

  if (persist) {
    const ingest = await postJson(
      `/api/sources/sec/ingest?formTypes=${encodeURIComponent(formTypes)}&limit=${limit}&countPerForm=5&attachmentLimit=2&dryRun=false`,
      {},
    );
    check("persist ingest returns ok", ingest.ok === true, ingest);
    check(
      "persist ingest upserts or skips raw items",
      Number(ingest.stats?.raw_upserted_count || 0) + Number(ingest.stats?.skipped_count || 0) > 0,
      ingest,
    );
  }

  printAndExit();
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  printAndExit();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function printAndExit() {
  const summary = {
    baseUrl,
    formTypes,
    limit,
    persist,
    checksPassed: checks.filter((item) => item.ok).length,
    checksFailed: checks.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify({ ok: summary.checksFailed === 0, summary, checks }, null, 2));
  process.exitCode = summary.checksFailed === 0 ? 0 : 1;
}

function short(value) {
  return String(value).length > 500 ? `${String(value).slice(0, 500)}...` : String(value);
}
