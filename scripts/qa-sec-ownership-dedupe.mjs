#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const ingest = await import(tsFileDataUrl("lib/secStores/eventStore.ts", secIngestImportReplacements()));

  const form4 = makeRawFiling({ formType: "4", accession: "0001234567-26-000001", rawItemId: "raw-form4-a" });
  const form4Repeat = makeRawFiling({ formType: "4", accession: "0001234567-26-000001", rawItemId: "raw-form4-b" });
  const form4Different = makeRawFiling({ formType: "4", accession: "0001234567-26-000002", rawItemId: "raw-form4-c" });
  const form144 = makeRawFiling({ formType: "144", accession: "0001234567-26-000003", rawItemId: "raw-144-a" });
  const form144Repeat = makeRawFiling({ formType: "144", accession: "0001234567-26-000003", rawItemId: "raw-144-b" });
  const form4Amendment = makeRawFiling({ formType: "4/A", accession: "0001234567-26-000004", rawItemId: "raw-form4a-a" });
  const form4AmendmentRepeat = makeRawFiling({ formType: "4/A", accession: "0001234567-26-000004", rawItemId: "raw-form4a-b" });
  const multiTransactionForm4 = makeRawFiling({
    formType: "4",
    accession: "0001234567-26-000001",
    rawItemId: "raw-form4-multi",
    transactions: [
      { reporting_owner: "Jane Insider", code: "P", shares: 1000 },
      { reporting_owner: "Jane Insider", code: "S", shares: 250 },
      { reporting_owner: "John Insider", code: "A", shares: 500 },
    ],
  });
  const s3 = makeRawFiling({ formType: "S-3", accession: "0001234567-26-000005", rawItemId: "raw-s3" });
  const missingAccession = {
    id: "raw-missing-accession",
    source_unique_id: "https://www.sec.gov/Archives/edgar/data/1234567/missing-index.htm",
    dedupe_key: "sec_edgar:https://www.sec.gov/Archives/edgar/data/1234567/missing-index.htm",
    raw_payload: {
      form_type: "4",
    },
  };

  const form4Dedupe = ingest.buildSecFilingGroupDedupe(form4);
  const missingAccessionDedupe = ingest.buildSecFilingGroupDedupe(missingAccession);

  check(
    "same Form 4 accession twice maps to same ownership event key",
    ingest.buildSecFilingGroupDedupeKey(form4) === ingest.buildSecFilingGroupDedupeKey(form4Repeat),
    { first: ingest.buildSecFilingGroupDedupe(form4), second: ingest.buildSecFilingGroupDedupe(form4Repeat) },
  );
  check(
    "same Form 4 accession would resolve same event in filings source group",
    eventIdentity("filings", ingest.buildSecFilingGroupDedupeKey(form4)) ===
      eventIdentity("filings", ingest.buildSecFilingGroupDedupeKey(form4Repeat)),
  );
  check(
    "different Form 4 accessions map to different ownership event keys",
    ingest.buildSecFilingGroupDedupeKey(form4) !== ingest.buildSecFilingGroupDedupeKey(form4Different),
    { first: ingest.buildSecFilingGroupDedupe(form4), second: ingest.buildSecFilingGroupDedupe(form4Different) },
  );
  check(
    "same Form 144 accession twice maps to same ownership event key",
    ingest.buildSecFilingGroupDedupeKey(form144) === ingest.buildSecFilingGroupDedupeKey(form144Repeat),
    { first: ingest.buildSecFilingGroupDedupe(form144), second: ingest.buildSecFilingGroupDedupe(form144Repeat) },
  );
  check(
    "same 4/A accession twice maps to same ownership event key",
    ingest.buildSecFilingGroupDedupeKey(form4Amendment) === ingest.buildSecFilingGroupDedupeKey(form4AmendmentRepeat),
    {
      first: ingest.buildSecFilingGroupDedupe(form4Amendment),
      second: ingest.buildSecFilingGroupDedupe(form4AmendmentRepeat),
    },
  );
  check(
    "original Form 4 accession and 4/A amendment accession are separate events for MVP",
    ingest.buildSecFilingGroupDedupeKey(form4) !== ingest.buildSecFilingGroupDedupeKey(form4Amendment),
    { original: ingest.buildSecFilingGroupDedupe(form4), amendment: ingest.buildSecFilingGroupDedupe(form4Amendment) },
  );
  check(
    "multi-transaction Form 4 still maps to one accession-level event key",
    ingest.buildSecFilingGroupDedupeKey(multiTransactionForm4) === ingest.buildSecFilingGroupDedupeKey(form4),
    ingest.buildSecFilingGroupDedupe(multiTransactionForm4),
  );
  check(
    "ownership key uses explicit accession format",
    form4Dedupe.groupDedupeKey === "sec_edgar:ownership:accession:0001234567-26-000001",
    form4Dedupe,
  );
  check(
    "ownership missing accession falls back to raw item id",
    missingAccessionDedupe.groupDedupeKey === "sec_edgar:ownership:raw_item:raw-missing-accession",
    missingAccessionDedupe,
  );
  check(
    "ownership lookup includes legacy key for old dev rows",
    form4Dedupe.lookupGroupDedupeKeys[0] === form4Dedupe.groupDedupeKey &&
      form4Dedupe.lookupGroupDedupeKeys.includes(form4Dedupe.legacyGroupDedupeKey),
    form4Dedupe,
  );
  check(
    "legacy ownership row would be found before creating duplicate",
    findExistingByLookupKeys(form4Dedupe.lookupGroupDedupeKeys, new Map([[form4Dedupe.legacyGroupDedupeKey, "legacy-event-id"]])) ===
      "legacy-event-id",
    form4Dedupe,
  );
  check(
    "non-ownership S-3 key remains unchanged",
    ingest.buildSecFilingGroupDedupeKey(s3) === ingest.buildSecFilingLegacyGroupDedupeKey(s3) &&
      ingest.buildSecFilingGroupDedupeKey(s3) === "sec_edgar:0001234567-26-000005",
    ingest.buildSecFilingGroupDedupe(s3),
  );
  check("Form 144/A is recognized as ownership", ingest.isSecOwnershipFormType("144/A") === true);
  check("S-3ASR is not recognized as ownership", ingest.isSecOwnershipFormType("S-3ASR") === false);
  check(
    "source_group filings and source_group news remain independent",
    eventIdentity("filings", ingest.buildSecFilingGroupDedupeKey(form4)) !==
      eventIdentity("news", ingest.buildSecFilingGroupDedupeKey(form4)),
  );

  const ok = checks.every((item) => item.ok);
  console.log(
    JSON.stringify(
      {
        ok,
        summary: {
          ownershipKeyFormat: "sec_edgar:ownership:accession:{accession_number}",
          ownershipFallbackKeyFormat: "sec_edgar:ownership:raw_item:{raw_item_id}",
          persistedRowsCreated: false,
          alertRowsCreated: false,
          liveCalls: false,
        },
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

function makeRawFiling({ formType, accession, rawItemId, transactions = [] }) {
  return {
    id: rawItemId,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: accession,
    dedupe_key: `sec_edgar:${accession}`,
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      transactions,
    },
  };
}

function eventIdentity(sourceGroup, groupDedupeKey) {
  return `${sourceGroup}:${groupDedupeKey}`;
}

function findExistingByLookupKeys(lookupKeys, existingEvents) {
  for (const key of lookupKeys) {
    const eventId = existingEvents.get(key);
    if (eventId) return eventId;
  }
  return null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function secIngestImportReplacements() {
  const stubs = {
    "@/lib/calendarPolicy": `
      export function evaluateCalendarItemPolicy() {
        return { include: false };
      }
    `,
    "@/lib/calendarEventRegistry": `
      export function getCalendarEventGroup() {
        return "other";
      }
      export function normalizeCalendarEventType(value) {
        return String(value || "other");
      }
    `,
    "@/lib/prompts/secFilingAnalysis": `
      export const SEC_EVENT_TYPE_VALUES = [
        "listing_risk",
        "dilution_risk",
        "earnings",
        "sales_performance",
        "product_update",
        "leadership_governance",
        "insider_ownership",
        "shareholder_vote",
        "strategic_transaction",
        "financial_risk",
        "legal_risk",
        "dividends",
        "capital_return",
        "fda_clinical",
        "other",
      ];
      export const SEC_FILING_ANALYSIS_PROMPT_KEY = "qa-sec-filing";
      export const SEC_FILING_ANALYSIS_PROMPT_VERSION = "qa";
    `,
    "@/lib/prompts/newsEventAnalysis": `
      export const SIGNAL_VALUES = ["bullish", "bearish", "volatile", "neutral"];
    `,
    "@/lib/secStores/alertQueue": `
      export function buildSecFilingAlertCandidate() {
        return null;
      }
      export async function enqueueSecFilingAlertCandidate() {
        return { ok: true, queued: false, queueMode: "events.delivery_level", reason: "stubbed" };
      }
    `,
    "@/lib/ai/secFilingAnalysisPreview": `
      export async function findSecRawItem() {
        return { ok: false, status: 404, error: "stubbed" };
      }
      export async function runSecFilingAnalysisForRawRow() {
        return { ok: false, stage: "stubbed", status: 500, error: "stubbed" };
      }
    `,
    "@/lib/supabase": `
      export async function supabaseDelete() {
        return { ok: true, status: 200, data: [] };
      }
      export async function supabaseSelect() {
        return { ok: true, status: 200, data: [] };
      }
      export async function supabaseUpsert() {
        return { ok: true, status: 200, data: [] };
      }
    `,
  };

  return Object.entries(stubs).map(([specifier, source]) => [
    `from "${specifier}"`,
    `from "${moduleDataUrl(source)}"`,
  ]);
}

function tsFileDataUrl(relativePath, replacements = []) {
  const filename = path.resolve(repoRoot, relativePath);
  const source = readFileSync(filename, "utf8");
  const rewritten = replacements.reduce((text, [from, to]) => text.replace(from, to), source);
  const output = stripTypeScriptTypes(rewritten, {
    mode: "transform",
    fileName: filename,
  });
  return moduleDataUrl(output);
}

function moduleDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
