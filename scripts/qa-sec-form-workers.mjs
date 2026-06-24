#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

const registrySource = readSource("lib/sources/sec/forms/formWorkerRegistry.ts");
const packageSource = readSource("lib/prompts/secFilingAnalysisPackage.ts");
const analysisIngestSource = readSource("lib/secFilingAnalysisIngest.ts");
const analysisPreviewSource = readSource("lib/ai/secFilingAnalysisPreview.ts");
const analysisAdapterRegistrySource = readSource("lib/ai/secFormAnalysisAdapterRegistry.ts");
const ownershipAnalysisAdapterSource = readSource("lib/ai/secOwnershipAnalysisAdapter.ts");
const s3AnalysisAdapterSource = readSource("lib/ai/secS3AnalysisAdapter.ts");
const ownershipFormAdapterSource = readSource("lib/sources/sec/forms/ownership/adapter.ts");
const s3F3FormAdapterSource = readSource("lib/sources/sec/forms/s3-f3/adapter.ts");
const liveBridgeSource = readSource("scripts/sec-room-live-test.mjs");
const commonIndexSource = readSource("lib/sources/sec/forms/common/index.ts");
const adapterContractSource = readSource("lib/sources/sec/forms/common/secFormAdapter.ts");
const adapterRuntimeSource = readSource("lib/sources/sec/forms/common/formAdapterRuntime.ts");
const genericFormAdapterSource = [
  "lib/sources/sec/forms/424b/adapter.ts",
  "lib/sources/sec/forms/425/adapter.ts",
  "lib/sources/sec/forms/8k-6k/adapter.ts",
  "lib/sources/sec/forms/effect/adapter.ts",
  "lib/sources/sec/forms/form25/adapter.ts",
  "lib/sources/sec/forms/nt/adapter.ts",
  "lib/sources/sec/forms/periodic-reports/adapter.ts",
  "lib/sources/sec/forms/proxy/adapter.ts",
  "lib/sources/sec/forms/s1-f1/adapter.ts",
  "lib/sources/sec/forms/s4-f4/adapter.ts",
  "lib/sources/sec/forms/s8/adapter.ts",
  "lib/sources/sec/forms/sc13/adapter.ts",
  "lib/sources/sec/forms/tender/adapter.ts",
]
  .map(readSource)
  .join("\n");
const workerDefinitionSource = [registrySource, ownershipFormAdapterSource, s3F3FormAdapterSource, genericFormAdapterSource].join("\n");

const expectedWorkers = [
  "current_report",
  "periodic_reports",
  "nt",
  "s1_f1",
  "s3_f3",
  "424b",
  "s8",
  "effect",
  "ownership",
  "sc13",
  "proxy",
  "425",
  "s4_f4",
  "tender",
  "form25",
];

const expectedForms = [
  "8-K",
  "6-K",
  "8-K/A",
  "6-K/A",
  "10-K",
  "10-Q",
  "20-F",
  "10-K/A",
  "10-Q/A",
  "20-F/A",
  "NT 10-K",
  "NT 10-Q",
  "NT 20-F",
  "S-1",
  "F-1",
  "S-1/A",
  "F-1/A",
  "S-3",
  "F-3",
  "S-3ASR",
  "F-3ASR",
  "S-3MEF",
  "F-3MEF",
  "S-3/A",
  "F-3/A",
  "424B3",
  "424B5",
  "S-8",
  "S-8/A",
  "EFFECT",
  "4",
  "4/A",
  "144",
  "144/A",
  "SC 13D",
  "SC 13D/A",
  "SC 13G",
  "SC 13G/A",
  "DEF 14A",
  "425",
  "S-4",
  "F-4",
  "S-4/A",
  "F-4/A",
  "SC TO-I",
  "SC TO-T",
  "SC 13E3",
  "CB",
  "25",
  "25-NSE",
];

for (const worker of expectedWorkers) {
  check(`worker registered: ${worker}`, workerDefinitionSource.includes(`key: "${worker}"`));
}

for (const form of expectedForms) {
  check(`form covered by worker registry: ${form}`, workerDefinitionSource.includes(`"${form}"`));
}

check(
  "ownership worker uses direct analysis mode",
  ownershipFormAdapterSource.includes('analysisMode: "ownership_direct_analysis"') &&
    ownershipFormAdapterSource.includes('parserGroup: "ownership"'),
);
check(
  "S-3/F-3 worker keeps special offering flow",
  s3F3FormAdapterSource.includes('analysisMode: "s3_offering_flow"') && s3F3FormAdapterSource.includes('parserGroup: "s3"'),
);
check(
  "common adapter contract exports analysis modes",
  adapterContractSource.includes("SEC_FORM_ADAPTER_ANALYSIS_MODES") &&
    adapterContractSource.includes("generic_sec_analysis") &&
    adapterContractSource.includes("s3_offering_flow") &&
    adapterContractSource.includes("ownership_direct_analysis"),
);
check(
  "common index exports adapter contract",
  commonIndexSource.includes('export * from "./secFormAdapter"') && commonIndexSource.includes('export * from "./formAdapterRuntime"'),
);
check(
  "registry exposes adapter facade",
  registrySource.includes("export const SEC_FORM_ADAPTERS = SEC_FORM_WORKERS") &&
    registrySource.includes("getSecFormAdapter") &&
    registrySource.includes("runSecFormAdapterParser") &&
    registrySource.includes("listSecFormAdapters"),
);
check(
  "registry imports form-specific adapter modules",
  registrySource.includes("@/lib/sources/sec/forms/ownership/adapter") &&
    registrySource.includes("@/lib/sources/sec/forms/s3-f3/adapter"),
);
check(
  "package builder delegates parser dispatch through adapter facade",
  packageSource.includes("runSecFormAdapterParser(rawItem, formType)"),
);
check(
  "package builder exposes selected adapter metadata",
  packageSource.includes("form_adapter: hardParserBundle.worker"),
);
check(
  "analysis ingest returns compact runtime adapter summary",
  analysisIngestSource.includes("summarizeSecAnalysisRuntime") &&
    analysisIngestSource.includes("form_adapter") &&
    analysisIngestSource.includes("hard_parser_keys"),
);
check(
  "ownership analysis is isolated behind adapter module",
  analysisPreviewSource.includes("@/lib/ai/secFormAnalysisAdapterRegistry") &&
    !analysisPreviewSource.includes("@/lib/ai/secOwnershipAnalysisAdapter") &&
    !analysisPreviewSource.includes("@/lib/sources/sec/forms/ownership/parser") &&
    !analysisPreviewSource.includes("@/lib/sources/sec/forms/ownership/analysisPrompt") &&
    analysisAdapterRegistrySource.includes("@/lib/ai/secOwnershipAnalysisAdapter") &&
    ownershipAnalysisAdapterSource.includes("@/lib/sources/sec/forms/ownership/parser") &&
    ownershipAnalysisAdapterSource.includes("@/lib/sources/sec/forms/ownership/analysisPrompt"),
);
check(
  "S-3 analysis prompt routing is isolated behind adapter shell",
  analysisPreviewSource.includes("@/lib/ai/secFormAnalysisAdapterRegistry") &&
    !analysisPreviewSource.includes("@/lib/ai/secS3AnalysisAdapter") &&
    !analysisPreviewSource.includes("@/lib/prompts/secOfferingAudit") &&
    !analysisPreviewSource.includes("@/lib/prompts/secS3AmendmentTriage") &&
    !analysisPreviewSource.includes("@/lib/prompts/secS3OfferingAnalysis") &&
    analysisAdapterRegistrySource.includes("@/lib/ai/secS3AnalysisAdapter") &&
    s3AnalysisAdapterSource.includes("@/lib/prompts/secOfferingAudit") &&
    s3AnalysisAdapterSource.includes("@/lib/prompts/secS3AmendmentTriage") &&
    s3AnalysisAdapterSource.includes("@/lib/prompts/secS3OfferingAnalysis"),
);
check(
  "live bridge includes runtime adapter summary",
  liveBridgeSource.includes("const runtime = analysis?.runtime || null") && liveBridgeSource.includes("runtime,"),
);
check(
  "package builder no longer imports every form parser directly",
  !/from "@\/lib\/sources\/sec\/forms\/(?:424b|425|8k-6k|effect|form25|nt|periodic-reports|proxy|s1-f1|s4-f4|s8|sc13|tender)\/parser"/.test(packageSource),
);
check(
  "worker registry keeps parser integration failure guard",
  adapterRuntimeSource.includes("sec_form_parser_integration_error_v1") && adapterRuntimeSource.includes("Parser integration failed:"),
);

const ok = checks.every((item) => item.ok);
console.log(
  JSON.stringify(
    {
      ok,
      summary: {
        workerCount: expectedWorkers.length,
        formCoverageChecks: expectedForms.length,
        liveCalls: false,
        dbWrites: false,
      },
      checks,
    },
    null,
    2,
  ),
);
process.exitCode = ok ? 0 : 1;

function readSource(relativePath) {
  return readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}
