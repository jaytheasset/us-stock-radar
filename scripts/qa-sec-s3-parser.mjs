#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSecS3Filing } from "../lib/sources/sec/forms/s3-f3/parser.ts";
import { resolveSupabaseSecretKey, supabaseServiceHeaders } from "./supabase-service-headers.mjs";

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
const key = resolveSupabaseSecretKey(env);
const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const sourceMode = String(args.get("source") || args.get("mode") || "both").toLowerCase();
const rawItemId = String(args.get("rawItemId") || "").trim();
const latest = args.get("latest") === "true";
const fetchFeeTable = args.get("fetchFeeTable") !== "false";
const limit = readInt(args.get("limit"), 5, 1, 20);
const countPerForm = readInt(args.get("countPerForm"), Math.max(limit, 5), 1, 40);
const balancedLive = args.get("balancedLive") !== "false";
const requireFormCoverage = args.get("requireFormCoverage") === "true";
const formTypes = String(args.get("formTypes") || "S-3,S-3ASR,S-3MEF,S-3/A,F-3,F-3ASR,F-3MEF,F-3/A");
const checks = [];

try {
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", key);

  const rawItems = await collectRawItems();
  check("S-3 raw samples found", rawItems.length > 0, { sourceMode, limit, formTypes });
  if (requireFormCoverage) {
    for (const formType of parseCsv(formTypes)) {
      check(`S-3 raw samples include ${formType}`, rawItems.some((item) => readRawFormType(item) === normalizeFormType(formType)), {
        sourceMode,
        formTypes,
        available_forms: Array.from(new Set(rawItems.map(readRawFormType).filter(Boolean))),
      });
    }
  }

  const samples = [];
  for (const rawItem of rawItems) {
    const rawItemForParser = fetchFeeTable && rawItem.qa_source === "db" ? await attachFeeTableText(rawItem) : rawItem;
    const parsed = parseRawItem(rawItemForParser);
    const summary = summarize(parsed, rawItem.qa_source || "db");
    samples.push(summary);

    check(`${summary.qa_source} ${summary.accession_number} recognizes S-3 family`, parsed.is_s3_family, summary);
    check(`${summary.qa_source} ${summary.accession_number} sees primary document`, parsed.documents.some((document) => document.is_primary), summary);
    check(`${summary.qa_source} ${summary.accession_number} extracts registration status`, Boolean(parsed.registration_status?.value), summary);
    if (!parsed.amendment.is_amendment) {
      check(`${summary.qa_source} ${summary.accession_number} extracts primary/resale`, Boolean(parsed.primary_or_resale?.value), summary);
    }
    if (parsed.amendment.is_amendment) {
      check(`${summary.qa_source} ${summary.accession_number} extracts amendment number`, Boolean(parsed.amendment.amendment_number?.value), summary);
      check(`${summary.qa_source} ${summary.accession_number} extracts registration number`, Boolean(parsed.amendment.registration_number?.value), summary);
    }
    check(`${summary.qa_source} ${summary.accession_number} extracts securities`, parsed.securities_registered.length > 0, summary);
    if (parsed.primary_or_resale?.value === "resale" && hasSellingStockholderTableHeader(parsed.selling_stockholders_section?.value)) {
      check(`${summary.qa_source} ${summary.accession_number} extracts selling stockholder rows`, parsed.selling_stockholders.length > 0, summary);
    }
    if (!parsed.amendment.is_amendment || parsed.fee_table.present) {
      check(`${summary.qa_source} ${summary.accession_number} lists fee table document`, parsed.fee_table.present, summary);
    }
    if (fetchFeeTable && parsed.fee_table.present) {
      check(`${summary.qa_source} ${summary.accession_number} extracts fee table row`, parsed.fee_table.rows.length > 0, summary);
    }
    check(`${summary.qa_source} ${summary.accession_number} extracts at least six facts`, parsed.extracted_field_count >= 6, summary);
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

function parseRawItem(rawItem) {
  return parseSecS3Filing({
    rawItemId: stringValue(rawItem.id),
    sourceUniqueId: stringValue(rawItem.source_unique_id),
    sourceUrl: stringValue(rawItem.source_url),
    title: stringValue(rawItem.title),
    publishedAt: stringValue(rawItem.published_at),
    bodyText: stringValue(rawItem.body_text),
    analysisText: stringValue(rawItem.analysis_text),
    rawPayload: rawItem.raw_payload,
    metadata: rawItem.metadata,
  });
}

function summarize(parsed, qaSource) {
  return {
    qa_source: qaSource,
    parser_version: parsed.parser_version,
    raw_item_id: parsed.raw_item_id,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    issuer: parsed.issuer,
    ticker: parsed.ticker,
    registration_statement_kind: parsed.registration_statement_kind?.value || null,
    registration_status: parsed.registration_status?.value || null,
    prospectus_status: parsed.prospectus_status?.value || null,
    amendment: {
      is_amendment: parsed.amendment.is_amendment,
      amendment_number: parsed.amendment.amendment_number?.text || null,
      registration_number: parsed.amendment.registration_number?.value || null,
      includes_full_prospectus: parsed.amendment.includes_full_prospectus,
      unchanged_remainder_not_included: parsed.amendment.unchanged_remainder_not_included,
      added_exhibits: parsed.amendment.added_exhibits.map((document) =>
        [document.type, document.description].filter(Boolean).join(" - "),
      ),
      limited_scope_signal_candidates: parsed.amendment.limited_scope_signal_candidates.map((signal) => signal.value),
      change_signal_candidates: parsed.amendment.change_signal_candidates.map((signal) => signal.value),
      amendment_excerpt_present: Boolean(parsed.amendment.amendment_excerpt),
    },
    primary_or_resale: parsed.primary_or_resale?.value || null,
    securities_registered: parsed.securities_registered.map((item) => item.value),
    shares_registered: parsed.shares_registered?.text || null,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    dilution_reference_present: Boolean(parsed.dilution_reference),
    selling_stockholders_section_present: Boolean(parsed.selling_stockholders_section),
    selling_stockholders: {
      count: parsed.selling_stockholders.length,
      rows: parsed.selling_stockholders.map((holder) => ({
        holder_name: holder.holder_name,
        footnote_id: holder.footnote_id,
        beneficially_owned_before: holder.beneficially_owned_before?.text || null,
        shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
        beneficially_owned_after: holder.beneficially_owned_after?.text || null,
        percent_after: holder.percent_after?.text || null,
        beneficial_ownership_caps: holder.beneficial_ownership_caps.map((cap) => cap.text),
        source_component_count: holder.source_components.length,
        excluded_share_component_count: holder.excluded_shares.length,
      })),
    },
    plan_of_distribution_section_present: Boolean(parsed.plan_of_distribution_section),
    use_of_proceeds_section_present: Boolean(parsed.use_of_proceeds_section),
    private_placement_reference_present: Boolean(parsed.private_placement_reference),
    fee_table: parsed.fee_table,
    offering_terms: {
      registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
      offering_type: parsed.offering_terms.offering_type?.value || null,
      security_type: parsed.offering_terms.security_type?.value || null,
      primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
      offering_amount: parsed.offering_terms.offering_amount?.text || null,
      shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
      atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
      resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
      current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
      warrant_coverage: parsed.offering_terms.warrant_coverage?.text || null,
      conversion_price: parsed.offering_terms.conversion_price?.text || null,
    },
    extracted_field_count: parsed.extracted_field_count,
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
    text_stats: parsed.text_stats,
  };
}

async function collectRawItems() {
  const rows = [];
  if (sourceMode === "db" || sourceMode === "both") {
    rows.push(...(await collectDbRawItems()));
  }
  if (sourceMode === "live" || sourceMode === "both") {
    rows.push(...(await collectLiveRawItems()));
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = stringValue(row.source_unique_id) || stringValue(row.id) || `${row.qa_source}:${stringValue(row.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectDbRawItems() {
  if (rawItemId) {
    const rawItem = await fetchRawItemById(rawItemId);
    return rawItem ? [{ ...rawItem, qa_source: "db" }] : [];
  }
  if (latest) {
    const rawItem = await fetchLatestS3RawItem();
    return rawItem ? [{ ...rawItem, qa_source: "db" }] : [];
  }
  const rows = await fetchRows("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    order: "fetched_at.desc",
    limit: "500",
  });
  const requestedForms = new Set(parseCsv(formTypes).map(normalizeFormType));
  return rows
    .filter((row) => {
      const formType = readRawFormType(row);
      return requestedForms.size ? requestedForms.has(formType) : /^S-3/i.test(formType);
    })
    .slice(0, limit)
    .map((row) => ({ ...row, qa_source: "db" }));
}

async function collectLiveRawItems() {
  const forms = parseCsv(formTypes);
  if (balancedLive && forms.length > 1) {
    const rows = [];
    for (const formType of forms) {
      rows.push(...(await fetchLiveRawItemsForForms([formType], countPerForm)));
    }
    return rows;
  }
  return fetchLiveRawItemsForForms(forms, limit);
}

async function fetchLiveRawItemsForForms(forms, requestedLimit) {
  const formQuery = forms.join(",");
  const result = await getLocalJson(
    `/api/sources/sec/raw-preview?formTypes=${encodeURIComponent(formQuery)}&limit=${requestedLimit}&countPerForm=${requestedLimit}&attachmentLimit=2`,
  );
  if (!result?.ok) throw new Error(`live raw-preview failed: ${result?.error || "unknown error"}`);
  return Array.isArray(result.items) ? result.items.map((item) => ({ ...item, qa_source: "live" })) : [];
}

async function getLocalJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

async function attachFeeTableText(rawItem) {
  const rawPayload = rawItem.raw_payload && typeof rawItem.raw_payload === "object" ? rawItem.raw_payload : {};
  let documents = Array.isArray(rawPayload.documents) ? rawPayload.documents : [];
  const existingAttachments = Array.isArray(rawPayload.attachment_texts) ? rawPayload.attachment_texts : [];
  let feeDocuments = documents.filter(isFilingFeeTableDocument);

  if (!feeDocuments.length) {
    const fetchedDocuments = await fetchFilingDocumentsFromDetailPage(
      stringValue(rawPayload.detail_url) || stringValue(rawItem.source_url),
    );
    if (fetchedDocuments.length) {
      const existingUrls = new Set(documents.map((document) => stringValue(document.url)).filter(Boolean));
      documents = [
        ...documents,
        ...fetchedDocuments.filter((document) => !existingUrls.has(stringValue(document.url))),
      ];
      feeDocuments = documents.filter(isFilingFeeTableDocument);
    }
  }
  if (!feeDocuments.length) return rawItem;

  const nextAttachments = [...existingAttachments];
  const nextDocuments = documents.map((document) => ({ ...document }));

  for (const feeDocument of feeDocuments) {
    if (nextAttachments.some((item) => stringValue(item.url) === stringValue(feeDocument.url) && stringValue(item.text))) {
      continue;
    }
    const text = await fetchSecDocumentText(stringValue(feeDocument.url));
    if (!text) continue;
    nextAttachments.push({
      type: stringValue(feeDocument.type),
      description: stringValue(feeDocument.description),
      url: stringValue(feeDocument.url),
      text,
    });
    const target = nextDocuments.find((document) => stringValue(document.url) === stringValue(feeDocument.url));
    if (target) {
      target.textCharCount = text.length;
      target.textTruncated = false;
      target.fetchStatus = 200;
    }
  }

  return {
    ...rawItem,
    raw_payload: {
      ...rawPayload,
      documents: nextDocuments,
      attachment_texts: nextAttachments,
    },
  };
}

async function fetchFilingDocumentsFromDetailPage(detailUrl) {
  if (!detailUrl) return [];
  const response = await fetch(detailUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": env.SEC_USER_AGENT || "US-Stock-Radar/0.1 contact@example.com",
      Accept: "text/html,text/plain,*/*",
    },
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`SEC detail page fetch failed: HTTP ${response.status}`);
  return parseFilingDocumentsFromDetailHtml(html, detailUrl);
}

function parseFilingDocumentsFromDetailHtml(html, detailUrl) {
  const table = extractFirst(html, /<table[^>]+summary=["']Document Format Files["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];

  const documents = [];
  for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] || "";
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] || "");
    if (cells.length < 4) continue;

    const linkHref = extractFirst(cells[2], /<a[^>]+href=["']([^"']+)["'][^>]*>/i);
    documents.push({
      sequence: cleanInlineText(cells[0]) || null,
      description: cleanInlineText(cells[1]) || null,
      document: cleanInlineText(cells[2]) || null,
      type: cleanInlineText(cells[3]) || null,
      size: cleanInlineText(cells[4]) || null,
      url: absoluteSecUrl(linkHref, detailUrl),
      isPrimary: false,
      textCharCount: 0,
      textTruncated: false,
    });
  }
  return documents;
}

function isFilingFeeTableDocument(document) {
  return /\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(
    `${stringValue(document?.type)} ${stringValue(document?.description)} ${stringValue(document?.document)}`,
  );
}

async function fetchSecDocumentText(url) {
  if (!url) return "";
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": env.SEC_USER_AGENT || "US-Stock-Radar/0.1 contact@example.com",
      Accept: "text/html,text/plain,*/*",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`SEC fee table fetch failed: HTTP ${response.status}`);
  return cleanDocumentText(text);
}

async function fetchRawItemById(id) {
  const rows = await fetchRows("raw_items", {
    select: "*",
    id: `eq.${id}`,
    source_code: "eq.sec_edgar",
    limit: "1",
  });
  return rows[0] || null;
}

async function fetchLatestS3RawItem() {
  const rows = await fetchRows("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    order: "fetched_at.desc",
    limit: "100",
  });
  return rows.find((row) => /^S-3/i.test(stringValue(row.raw_payload?.form_type || row.metadata?.form_type))) || null;
}

async function fetchRows(table, search) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(search)) {
    if (value) url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
    }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${table} failed: HTTP ${response.status} ${readError(data, response.statusText)}`);
  return Array.isArray(data) ? data : [];
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
      if (!match || env[match[1]]) continue;
      env[match[1]] = unquoteEnvValue(match[2].trim());
    }
  }
  return env;
}

function cleanDocumentText(input) {
  const withoutHidden = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ");
  const withBreaks = withoutHidden
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");

  return decodeHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanInlineText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractFirst(value, pattern) {
  return String(value || "").match(pattern)?.[1] || null;
}

function absoluteSecUrl(value, base) {
  const href = stringValue(value);
  if (!href) return null;
  try {
    const url = new URL(href, base || "https://www.sec.gov");
    const inlineDocPath = url.pathname === "/ix" ? url.searchParams.get("doc") : null;
    if (inlineDocPath && inlineDocPath.startsWith("/Archives/")) {
      return new URL(inlineDocPath, "https://www.sec.gov").toString();
    }
    return url.toString();
  } catch {
    return null;
  }
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
  const sampleList = Array.isArray(samples) ? samples : samples ? [samples] : [];
  const summary = {
    source_mode: sourceMode,
    sample_count: sampleList.length,
    db_sample_count: sampleList.filter((sample) => sample.qa_source === "db").length,
    live_sample_count: sampleList.filter((sample) => sample.qa_source === "live").length,
    form_counts: countBy(sampleList, (sample) => sample.form_type || "unknown"),
    offering_type_counts: countBy(sampleList, (sample) => sample.offering_terms?.offering_type || "unknown"),
    selling_stockholder_sample_count: sampleList.filter((sample) => Number(sample.selling_stockholders?.count || 0) > 0).length,
    checks_passed: checks.filter((item) => item.ok).length,
    checks_failed: checks.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify({ ok: summary.checks_failed === 0, summary, samples: sampleList, checks }, null, 2));
  process.exitCode = summary.checks_failed === 0 ? 0 : 1;
}

function readInt(value, fallback, min, max) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = String(getKey(item) || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRawFormType(row) {
  return normalizeFormType(row?.raw_payload?.form_type || row?.metadata?.form_type || row?.form_type || "");
}

function normalizeFormType(value) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function hasSellingStockholderTableHeader(value) {
  const text = stringValue(value).replace(/\s+/g, " ");
  const hasHolderHeader =
    /\bName\s+of\s+Selling\b[\s\S]{0,120}\b(?:Stockholder|Shareholder)s?\b/i.test(text) ||
    /\bSelling\s+(?:Stockholder|Shareholder)s?\b[\s\S]{0,120}\bName\b/i.test(text);
  if (!hasHolderHeader) return false;

  return /\b(?:beneficially\s+owned|owned\s+(?:prior|before|after)|maximum\s+number\s+of\s+shares|shares?\s+(?:to\s+be\s+)?(?:sold|offered|resold)|offered\s+for\s+resale|pursuant\s+to\s+this\s+prospectus)\b/i.test(
    text,
  );
}

function short(value) {
  const text = String(value || "");
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function stringValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readError(data, fallback) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data === "object" && "message" in data) return String(data.message || fallback);
  return fallback;
}
