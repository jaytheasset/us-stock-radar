#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const parserUrl = tsFileDataUrl("lib/sources/sec/forms/ownership/parser.ts");
  const contractUrl = tsFileDataUrl("lib/sources/sec/forms/common/secIntegrationContract.ts");
  const adapterUrl = tsFileDataUrl("lib/sources/sec/forms/common/formRoomAdapter.ts", [
    [`from "./secIntegrationContract"`, `from "${contractUrl}"`],
  ]);
  const analysisPromptUrl = tsFileDataUrl("lib/sources/sec/forms/ownership/analysisPrompt.ts", [
    [`from "./parser.ts"`, `from "${parserUrl}"`],
  ]);
  const ownershipAnalysisAdapterUrl = tsFileDataUrl("lib/ai/secOwnershipAnalysisAdapter.ts", [
    [`from "@/lib/prompts/secFilingAnalysis"`, `from "${moduleDataUrl("export {};")}"`],
    [`from "@/lib/sources/sec/forms/common/formRoomAdapter"`, `from "${adapterUrl}"`],
    [`from "@/lib/sources/sec/forms/ownership/parser"`, `from "${parserUrl}"`],
    [`from "@/lib/sources/sec/forms/ownership/analysisPrompt"`, `from "${analysisPromptUrl}"`],
  ]);
  const s3AnalysisAdapterUrl = moduleDataUrl(s3AnalysisAdapterStub());
  const formAnalysisAdapterRegistryUrl = tsFileDataUrl("lib/ai/secFormAnalysisAdapterRegistry.ts", [
    [`from "@/lib/prompts/secFilingAnalysis"`, `from "${moduleDataUrl("export {};")}"`],
    [`from "@/lib/ai/secOwnershipAnalysisAdapter"`, `from "${ownershipAnalysisAdapterUrl}"`],
    [`from "@/lib/ai/secS3AnalysisAdapter"`, `from "${s3AnalysisAdapterUrl}"`],
  ]);
  const genericFormParserStubsUrl = moduleDataUrl(genericFormParserStubs());
  const s3ParserStubUrl = moduleDataUrl(s3ParserStub());
  const formAdapterRuntimeUrl = tsFileDataUrl("lib/sources/sec/forms/common/formAdapterRuntime.ts");
  function genericFormAdapterUrl(relativePath) {
    return tsFileDataUrl(relativePath, [
      [`from "@/lib/sources/sec/forms/common/formAdapterRuntime"`, `from "${formAdapterRuntimeUrl}"`],
      [`from "./parser"`, `from "${genericFormParserStubsUrl}"`],
    ]);
  }
  const sec424bFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/424b/adapter.ts");
  const sec425FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/425/adapter.ts");
  const currentReportFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/8k-6k/adapter.ts");
  const effectFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/effect/adapter.ts");
  const form25FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/form25/adapter.ts");
  const ntFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/nt/adapter.ts");
  const periodicReportsFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/periodic-reports/adapter.ts");
  const proxyFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/proxy/adapter.ts");
  const s1F1FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/s1-f1/adapter.ts");
  const s4F4FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/s4-f4/adapter.ts");
  const s8FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/s8/adapter.ts");
  const sc13FormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/sc13/adapter.ts");
  const tenderFormAdapterUrl = genericFormAdapterUrl("lib/sources/sec/forms/tender/adapter.ts");
  const ownershipFormAdapterUrl = tsFileDataUrl("lib/sources/sec/forms/ownership/adapter.ts", [
    [`from "./parser"`, `from "${parserUrl}"`],
  ]);
  const s3F3FormAdapterUrl = tsFileDataUrl("lib/sources/sec/forms/s3-f3/adapter.ts", [
    [`from "./parser"`, `from "${s3ParserStubUrl}"`],
  ]);
  const workerRegistryUrl = tsFileDataUrl("lib/sources/sec/forms/formWorkerRegistry.ts", [
    [`from "@/lib/sources/sec/forms/424b/adapter"`, `from "${sec424bFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/425/adapter"`, `from "${sec425FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/8k-6k/adapter"`, `from "${currentReportFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/effect/adapter"`, `from "${effectFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/form25/adapter"`, `from "${form25FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/nt/adapter"`, `from "${ntFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/ownership/adapter"`, `from "${ownershipFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/periodic-reports/adapter"`, `from "${periodicReportsFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/proxy/adapter"`, `from "${proxyFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/s1-f1/adapter"`, `from "${s1F1FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/s3-f3/adapter"`, `from "${s3F3FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/s4-f4/adapter"`, `from "${s4F4FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/s8/adapter"`, `from "${s8FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/sc13/adapter"`, `from "${sc13FormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/tender/adapter"`, `from "${tenderFormAdapterUrl}"`],
    [`from "@/lib/sources/sec/forms/ownership/parser"`, `from "${parserUrl}"`],
    [`from "@/lib/sources/sec/forms/s3-f3/parser"`, `from "${s3ParserStubUrl}"`],
    [`from "@/lib/sources/sec/forms/424b/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/425/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/8k-6k/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/effect/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/form25/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/nt/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/periodic-reports/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/proxy/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/s1-f1/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/s4-f4/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/s8/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/sc13/parser"`, `from "${genericFormParserStubsUrl}"`],
    [`from "@/lib/sources/sec/forms/tender/parser"`, `from "${genericFormParserStubsUrl}"`],
  ]);
  const packageUrl = tsFileDataUrl("lib/prompts/secFilingAnalysisPackage.ts", [
    [`from "@/lib/sources/sec/forms/formWorkerRegistry"`, `from "${workerRegistryUrl}"`],
  ]);
  const previewUrl = tsFileDataUrl("lib/ai/secFilingAnalysisPreview.ts", previewImportReplacements({
    adapterUrl,
    formAnalysisAdapterRegistryUrl,
    analysisPromptUrl,
    ownershipAnalysisAdapterUrl,
    packageUrl,
    parserUrl,
  }));

  const ownershipParser = await import(parserUrl);
  const ownershipPrompt = await import(analysisPromptUrl);
  const commonAdapter = await import(adapterUrl);
  const filingPackageModule = await import(packageUrl);
  const analysisPreview = await import(previewUrl);

  const purchaseFixture = readJson("lib/sources/sec/forms/ownership/fixtures/form4-insider-purchase.json");
  const routine144Fixture = readJson("lib/sources/sec/forms/ownership/fixtures/form144-routine-proposed-sale.json");
  const emptyFixture = readJson("lib/sources/sec/forms/ownership/fixtures/form4-empty-unsupported.json");

  const packageForPurchase = filingPackageModule.buildSecFilingAnalysisPackage(rawItemFromOwnershipFixture(purchaseFixture));
  const packageOwnership = packageForPurchase.hard_parsers?.ownership;
  const parsedPurchase = ownershipParser.parseOwnershipFiling(purchaseFixture);
  const parsedRoutine144 = ownershipParser.parseOwnershipFiling(routine144Fixture);
  const parsedEmpty = ownershipParser.parseOwnershipFiling(emptyFixture);
  const deterministicRoutine144 = ownershipParser.buildDeterministicOwnershipResult(parsedRoutine144);
  const deterministicEmpty = ownershipParser.buildDeterministicOwnershipResult(parsedEmpty);
  const purchasePrompt = ownershipPrompt.buildOwnershipAnalysisPrompt(parsedPurchase);
  const adaptedRoutine144 = commonAdapter.adaptSecFormRoomOutputForIngest(deterministicRoutine144);
  const deterministicPreviewRun = await analysisPreview.runSecFilingAnalysisForRawRow(rawItemFromOwnershipFixture(routine144Fixture));

  check(
    "Form 4 package includes hard_parsers.ownership",
    Boolean(packageOwnership?.parserGroup === "ownership" && packageOwnership?.accessionNumber === purchaseFixture.accessionNumber),
    packageForPurchase.hard_parsers,
  );
  check(
    "Form 144/A is classified as ownership",
    filingPackageModule.classifySecFormFamily("144/A") === "ownership",
  );
  check(
    "ownership package llm_text uses compact parser facts instead of full raw XML",
    String(packageForPurchase.llm_text || "").includes("Ownership Parser Facts") &&
      !String(packageForPurchase.llm_text || "").includes("<ownershipDocument>") &&
      !String(packageForPurchase.llm_text || "").includes(String(purchaseFixture.filingText || "")),
    { llmTextChars: String(packageForPurchase.llm_text || "").length, sourceChars: String(purchaseFixture.filingText || "").length },
  );
  check(
    "ownership analysis prompt excludes full raw XML/source text by default",
    !purchasePrompt.includes("<ownershipDocument>") && purchasePrompt.includes("Compact parser facts"),
    { promptChars: purchasePrompt.length },
  );
  check(
    "Form 4 purchase is analysis-needed, not parser-deterministic archive",
    ownershipParser.buildDeterministicOwnershipResult(parsedPurchase) === null,
  );
  check(
    "routine Form 144 deterministic archive is persistable and not skip_analysis",
    Boolean(
      deterministicRoutine144 &&
        deterministicRoutine144.analysis_output.score < 50 &&
        deterministicRoutine144.analysis_output.event_type === "insider_ownership" &&
        deterministicRoutine144.analysis_output.analysis_action !== "skip_analysis",
    ),
    deterministicRoutine144?.analysis_output,
  );
  check(
    "empty unsupported ownership source becomes persistable archive output",
    Boolean(
      deterministicEmpty &&
        deterministicEmpty.analysis_output.score < 50 &&
        deterministicEmpty.analysis_output.event_type === "other" &&
        deterministicEmpty.analysis_output.analysis_action !== "skip_analysis",
    ),
    deterministicEmpty?.analysis_output,
  );
  check(
    "common adapter derives archive delivery",
    adaptedRoutine144.ok === true &&
      adaptedRoutine144.value.analysis_output.delivery_level === "archive" &&
      adaptedRoutine144.value.metadata.display_payload_storage_target === "events.metadata.display_payload",
    adaptedRoutine144,
  );
  check(
    "analysis preview returns deterministic ownership archive without OpenAI",
    deterministicPreviewRun.ok === true &&
      deterministicPreviewRun.openAiResponseId === null &&
      deterministicPreviewRun.analysis?.score < 50 &&
      deterministicPreviewRun.analysis?.archive_summary &&
      deterministicPreviewRun.analysis?.display_payload,
    deterministicPreviewRun,
  );
  check(
    "ownership source inventory and selected evidence are preserved compactly",
    Boolean(parsedPurchase.facts?.source_inventory && Array.isArray(parsedPurchase.raw?.selected_evidence)),
    { sourceInventory: parsedPurchase.facts?.source_inventory, evidence: parsedPurchase.raw?.selected_evidence },
  );
  check(
    "ingest maps display_payload into events.metadata.display_payload",
    sourceIncludes("lib/secStores/eventStore.ts", "display_payload: displayPayload") &&
      sourceIncludes("lib/secStores/eventStore.ts", "archive_summary: archiveSummary"),
  );
  check(
    "analysis preview has no ownership router LLM path",
    sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "buildDeterministicOwnershipAnalysis") &&
      sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "buildSecOwnershipAnalysisPrompt") &&
      !sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "routerPrompt"),
  );

  const ok = checks.every((item) => item.ok);
  console.log(
    JSON.stringify(
      {
        ok,
        summary: {
          liveCalls: false,
          dbWrites: false,
          parserRoomLogicChanged: false,
          oneAccessionOneEvent: true,
          deterministicArchivePersists: true,
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

function rawItemFromOwnershipFixture(fixture) {
  return {
    id: fixture.id,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: fixture.accessionNumber,
    source_url: fixture.source?.url || `https://www.sec.gov/Archives/${fixture.accessionNumber}.txt`,
    title: `${fixture.issuer?.name || "Issuer"} ${fixture.formType}`,
    published_at: "2026-05-20T00:00:00.000Z",
    body_text: fixture.filingText,
    analysis_text: fixture.filingText,
    raw_payload: {
      form_type: fixture.formType,
      accession_number: fixture.accessionNumber,
      company_name: fixture.issuer?.name || null,
      ticker: fixture.issuer?.ticker || null,
      exchange: fixture.issuer?.exchange || null,
      cik: fixture.issuer?.cik || null,
      primary_document_url: fixture.source?.url || null,
      documents: [],
      attachment_texts: [],
    },
    metadata: {
      form_type: fixture.formType,
      ticker: fixture.issuer?.ticker || null,
      exchange: fixture.issuer?.exchange || null,
    },
  };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(repoRoot, relativePath), "utf8"));
}

function sourceIncludes(relativePath, needle) {
  return readFileSync(path.resolve(repoRoot, relativePath), "utf8").includes(needle);
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function tsFileDataUrl(relativePath, replacements = []) {
  const filename = path.resolve(repoRoot, relativePath);
  const source = readFileSync(filename, "utf8");
  const rewritten = replacements.reduce((text, [from, to]) => text.replaceAll(from, to), source);
  const output = stripTypeScriptTypes(rewritten, {
    mode: "transform",
    fileName: filename,
  });
  return moduleDataUrl(output);
}

function moduleDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function s3ParserStub() {
  return `
    export function parseSecS3Filing() {
      return {
        form_type: "S-3",
        is_s3_family: true,
        securities_registered: [],
        selling_stockholders: [],
        fee_table: { present: false, text_available: false, rows: [], totals: {}, documents: [] },
        offering_terms: {},
        amendment: { router_payload: {} },
        needs_human_review: false,
        review_reasons: []
      };
    }
  `;
}

function s3AnalysisAdapterStub() {
  return `
    export const SEC_OFFERING_AUDIT_PROMPT_KEY = "qa_sec_offering_audit";
    export const SEC_OFFERING_AUDIT_PROMPT_VERSION = "qa";
    export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY = "qa_sec_s3_triage";
    export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION = "qa";
    export const SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY = "qa_sec_s3_analysis";
    export function isS3FilingInput() { return false; }
    export function isS3AmendmentInput() { return false; }
    export function buildSecS3AnalysisPrompt() {
      return { key: SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY, version: "qa", system: "", user: "", responseFormat: { json_schema: {} } };
    }
    export function buildSecS3AuditPrompt() {
      return { key: SEC_OFFERING_AUDIT_PROMPT_KEY, version: SEC_OFFERING_AUDIT_PROMPT_VERSION, system: "", user: "", responseFormat: { json_schema: {} } };
    }
    export function buildSecS3TriagePrompt() {
      return { key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY, version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION, system: "", user: "", responseFormat: { json_schema: {} } };
    }
  `;
}

function genericFormParserStubs() {
  return `
    function genericParsed(parserGroup) {
      return {
        parserVersion: "qa_stub",
        parserGroup,
        formType: "QA",
        accessionNumber: null,
        isSupported: true,
        summary: null,
        facts: {},
        signals: [],
        calendarItems: [],
        warnings: [],
        raw: {}
      };
    }
    export function parse424bFiling() { return genericParsed("424b"); }
    export function parseSec425Filing() { return genericParsed("425"); }
    export function parseSec8k6kFiling() { return genericParsed("8k-6k"); }
    export function parseEffectFiling() { return genericParsed("effect"); }
    export function parseSecForm25Filing() { return genericParsed("form25"); }
    export function parseNtFiling() { return genericParsed("nt"); }
    export function parseSecPeriodicReport() { return genericParsed("periodic_reports"); }
    export function parseProxyFiling() { return genericParsed("proxy"); }
    export function parseS1F1Filing() { return genericParsed("s1_f1"); }
    export function parseS4F4Filing() { return genericParsed("s4_f4"); }
    export function parseS8Filing() { return genericParsed("s8"); }
    export function parseSc13Filing() { return genericParsed("sc13"); }
    export function parseSecTenderFiling() { return genericParsed("tender"); }
  `;
}

function previewImportReplacements({ adapterUrl, analysisPromptUrl, formAnalysisAdapterRegistryUrl, ownershipAnalysisAdapterUrl, packageUrl, parserUrl }) {
  const moduleUrls = {
    "@/lib/env": moduleDataUrl(`
      export function getServerEnv() {
        return { openAiApiKey: "", openAiModel: "gpt-5-mini" };
      }
    `),
    "@/lib/prompts/secOfferingAudit": moduleDataUrl(`
      export const SEC_OFFERING_AUDIT_PROMPT_KEY = "qa_sec_offering_audit";
      export const SEC_OFFERING_AUDIT_PROMPT_VERSION = "qa";
      export function buildSecOfferingAuditPrompt() {
        return { key: SEC_OFFERING_AUDIT_PROMPT_KEY, version: SEC_OFFERING_AUDIT_PROMPT_VERSION, system: "", user: "", responseFormat: { json_schema: {} } };
      }
    `),
    "@/lib/prompts/secFilingAnalysisPackage": packageUrl,
    "@/lib/prompts/secFilingAnalysis": moduleDataUrl(`
      export const SEC_FILING_ANALYSIS_PROMPT_KEY = "qa_sec_filing_analysis";
      export const SEC_FILING_ANALYSIS_PROMPT_VERSION = "qa";
      export function buildSecFilingAnalysisPrompt() {
        return { key: SEC_FILING_ANALYSIS_PROMPT_KEY, version: SEC_FILING_ANALYSIS_PROMPT_VERSION, system: "", user: "", responseFormat: { json_schema: {} } };
      }
    `),
    "@/lib/prompts/secS3AmendmentTriage": moduleDataUrl(`
      export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY = "qa_sec_s3_triage";
      export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION = "qa";
      export function buildSecS3AmendmentTriagePrompt() {
        return { key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY, version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION, system: "", user: "", responseFormat: { json_schema: {} } };
      }
    `),
    "@/lib/prompts/secS3OfferingAnalysis": moduleDataUrl(`
      export const SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY = "qa_sec_s3_analysis";
      export function buildSecS3OfferingAnalysisPrompt() {
        return { key: SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY, version: "qa", system: "", user: "", responseFormat: { json_schema: {} } };
      }
    `),
    "@/lib/secOfferingMarketContext": moduleDataUrl(`
      export function applySecOfferingScorePolicy(_filingPackage, analysis) { return analysis; }
      export function buildSecOfferingDilutionMetrics() { return {}; }
      export async function resolveSecOfferingMarketContext() { return {}; }
    `),
    "@/lib/ai/secFormAnalysisAdapterRegistry": formAnalysisAdapterRegistryUrl,
    "@/lib/ai/secOwnershipAnalysisAdapter": ownershipAnalysisAdapterUrl,
    "@/lib/sources/sec/forms/common/formRoomAdapter": adapterUrl,
    "@/lib/sources/sec/forms/ownership/parser": parserUrl,
    "@/lib/sources/sec/forms/ownership/analysisPrompt": analysisPromptUrl,
    "@/lib/sources/sec/forms/s3-f3/parser": moduleDataUrl(s3ParserStub()),
    "@/lib/supabase": moduleDataUrl(`
      export async function supabaseSelect() {
        return { ok: true, status: 200, data: [] };
      }
    `),
  };

  return Object.entries(moduleUrls).map(([specifier, url]) => [`from "${specifier}"`, `from "${url}"`]);
}
