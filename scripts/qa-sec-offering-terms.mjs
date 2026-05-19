#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSecOfferingTerms } from "../lib/sources/sec/offeringTermsParser.ts";

const DEFAULT_SAMPLE_IDS = [
  "75631710-ea74-437f-b043-ac8ce397fc22",
  "14c7cace-332c-4bf4-97c2-b5b552c4480e",
  "264e082e-a36e-4b0c-958d-4f2b7defb03c",
  "b538696d-2d33-407c-93cb-31dda115f139",
];

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const key = serviceKey && !serviceKey.startsWith("sb_secret_") ? serviceKey : env.SUPABASE_ANON_KEY || "";
const sampleIds = String(args.get("ids") || DEFAULT_SAMPLE_IDS.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const checks = [];

try {
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_API_KEY", key);
  check("sample ids provided", sampleIds.length > 0, { sampleIds });

  const samples = [];
  for (const eventId of sampleIds) {
    const event = await fetchOne("events", {
      select: "*",
      id: `eq.${eventId}`,
      source_group: "eq.filings",
      limit: "1",
    });
    check(`event found ${eventId}`, Boolean(event), { eventId });
    if (!event) continue;

    const rawItemId = stringValue(event.raw_item_id);
    const rawItem = rawItemId
      ? await fetchOne("raw_items", {
          select: "*",
          id: `eq.${rawItemId}`,
          limit: "1",
        })
      : null;
    check(`raw item found ${eventId}`, Boolean(rawItem), { eventId, rawItemId });

    const rawPayload = toRecord(rawItem?.raw_payload) || {};
    const metadata = toRecord(rawItem?.metadata) || {};
    const parserResult = parseSecOfferingTerms({
      formType:
        stringValue(rawPayload.form_type) ||
        stringValue(metadata.form_type) ||
        readFormTypeFromTitle(stringValue(event.title)),
      title: stringValue(event.title) || stringValue(rawItem?.title),
      primaryDocumentText: stringValue(rawItem?.analysis_text) || stringValue(rawItem?.body_text),
      attachmentTexts: readAttachmentTexts(rawPayload),
    });

    const summary = summarizeResult({ event, rawItem, parserResult });
    samples.push(summary);
    check(`parser extracts terms ${eventId}`, parserResult.extracted_field_count >= 3, {
      eventId,
      extracted_field_count: parserResult.extracted_field_count,
      review_reasons: parserResult.review_reasons,
    });
    check(`parser classifies offering type ${eventId}`, Boolean(parserResult.offering_type?.value), {
      eventId,
      review_reasons: parserResult.review_reasons,
    });
  }

  printAndExit(samples);
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  printAndExit([]);
}

function summarizeResult({ event, rawItem, parserResult }) {
  return {
    event_id: event.id,
    ticker: stringValue(event.ticker),
    event_type: stringValue(event.event_type),
    form_type: parserResult.form_type,
    document_family: parserResult.document_family,
    title: stringValue(event.title),
    raw_item_id: stringValue(rawItem?.id),
    source_url_present: Boolean(stringValue(event.source_url) || stringValue(rawItem?.source_url)),
    extracted_field_count: parserResult.extracted_field_count,
    needs_human_review: parserResult.needs_human_review,
    review_reasons: parserResult.review_reasons,
    terms: {
      offering_type: parserResult.offering_type?.value || null,
      security_type: parserResult.security_type?.value || null,
      primary_or_resale: parserResult.primary_or_resale?.value || null,
      registration_status: parserResult.registration_status?.value || null,
      prospectus_type: parserResult.prospectus_type?.value || null,
      offering_amount: parserResult.offering_amount?.text || null,
      shelf_capacity: parserResult.shelf_capacity?.text || null,
      amount_remaining: parserResult.amount_remaining?.text || null,
      atm_program_size: parserResult.atm_program_size?.text || null,
      shares_offered: parserResult.shares_offered?.text || null,
      resale_share_count: parserResult.resale_share_count?.text || null,
      current_shares_outstanding: parserResult.current_shares_outstanding?.text || null,
      public_float: parserResult.public_float?.text || null,
      authorized_shares: parserResult.authorized_shares?.text || null,
      offering_price: parserResult.offering_price?.text || null,
      warrant_coverage: parserResult.warrant_coverage?.text || null,
      warrant_exercise_price: parserResult.warrant_exercise_price?.text || null,
      conversion_price: parserResult.conversion_price?.text || null,
      use_of_proceeds: parserResult.use_of_proceeds?.text || null,
      sales_agent: parserResult.sales_agent?.text || null,
      selling_shareholders: parserResult.selling_shareholders?.text || null,
      effective_date: parserResult.effective_date?.text || null,
      closing_date: parserResult.closing_date?.text || null,
    },
    evidence: compactEvidence({
      offering_type: parserResult.offering_type?.evidence,
      offering_amount: parserResult.offering_amount?.evidence,
      shares_offered: parserResult.shares_offered?.evidence,
      offering_price: parserResult.offering_price?.evidence,
      warrant_exercise_price: parserResult.warrant_exercise_price?.evidence,
      use_of_proceeds: parserResult.use_of_proceeds?.evidence,
    }),
  };
}

async function fetchOne(table, search) {
  const rows = await fetchRows(table, search);
  return rows[0] || null;
}

async function fetchRows(table, search) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(search)) {
    if (value) url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${table} failed: HTTP ${response.status} ${readError(data, response.statusText)}`);
  return Array.isArray(data) ? data : [];
}

function readAttachmentTexts(rawPayload) {
  return Array.isArray(rawPayload.attachment_texts)
    ? rawPayload.attachment_texts
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          type: stringValue(item.type),
          description: stringValue(item.description),
          text: stringValue(item.text),
        }))
    : [];
}

function readFormTypeFromTitle(title) {
  return title.match(/\b(?:Form\s+)?(8-K\/A|8-K|6-K\/A|6-K|S-\dASR|S-\d|F-\d|424B\d|EFFECT|FWP)\b/i)?.[1] || "";
}

function readLocalEnv() {
  const env = { ...process.env };
  for (const filename of [".env.local", ".env"]) {
    const filepath = resolve(process.cwd(), filename);
    if (!existsSync(filepath)) continue;
    const lines = readFileSync(filepath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      if (env[match[1]]) continue;
      env[match[1]] = unquoteEnvValue(match[2].trim());
    }
  }
  return env;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanSupabaseUrl(value) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

function requireEnv(label, value) {
  if (!value) throw new Error(`${label} is missing`);
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function printAndExit(samples) {
  const summary = {
    sample_count: samples.length,
    checks_passed: checks.filter((item) => item.ok).length,
    checks_failed: checks.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify({ ok: summary.checks_failed === 0, summary, samples, checks }, null, 2));
  process.exitCode = summary.checks_failed === 0 ? 0 : 1;
}

function compactEvidence(values) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => [name, short(value)]),
  );
}

function short(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function stringValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readError(data, fallback) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data === "object" && "message" in data) return String(data.message || fallback);
  return fallback;
}
