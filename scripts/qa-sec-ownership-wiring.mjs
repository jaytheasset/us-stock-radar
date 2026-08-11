#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const parserUrl = tsFileDataUrl("lib/sources/sec/forms/ownership/parser.ts");
  const currentFilingIdentityUrl = tsFileDataUrl("lib/sources/sec/forms/common/currentFilingIdentity.ts");
  const analysisPromptUrl = tsFileDataUrl("lib/sources/sec/forms/ownership/analysisPrompt.ts", [
    [`from "./parser.ts"`, `from "${parserUrl}"`],
    [`from "../common/currentFilingIdentity.ts"`, `from "${currentFilingIdentityUrl}"`],
  ]);
  const ownershipParser = await import(parserUrl);
  const ownershipPrompt = await import(analysisPromptUrl);
  const runWithoutLlm = compileOwnershipDryRun();

  const ownershipCases = [
    ["4", "lib/sources/sec/forms/ownership/fixtures/form4-insider-purchase.json"],
    ["4/A", "lib/sources/sec/forms/ownership/fixtures/form4a-admin-amendment.json"],
    ["144", "lib/sources/sec/forms/ownership/fixtures/form144-routine-proposed-sale.json"],
    ["144/A", "lib/sources/sec/forms/ownership/fixtures/form144a-material-increase.json"],
  ].map(([formType, fixturePath]) => {
    const fixture = readJson(fixturePath);
    const rawItem = rawItemFromOwnershipFixture(fixture);
    const parsed = ownershipParser.parseOwnershipFiling(fixture);
    return { formType, fixture, rawItem, parsed };
  });
  const purchaseCase = ownershipCases[0];

  const packageForPurchase = ownershipFilingPackage(purchaseCase);
  const packageOwnership = packageForPurchase.hard_parsers?.ownership;
  const ownershipAnalysisInputs = ownershipCases.map((item) => ({
    formType: item.formType,
    input: ownershipPrompt.buildOwnershipAnalysisInput(item.parsed),
    parserSelectedEvidence: item.parsed.raw?.selected_evidence,
  }));
  const purchaseAnalysisInput = ownershipAnalysisInputs[0].input;
  const purchasePrompt = ownershipPrompt.buildOwnershipAnalysisPrompt(purchaseCase.parsed);
  const dryRunResults = await Promise.all(
    ownershipCases.map(async (item) => ({
      formType: item.formType,
      result: await runWithoutLlm(item.rawItem, {
        filing_package: ownershipFilingPackage(item),
      }),
    })),
  );

  check(
    "Form 4 package includes hard_parsers.ownership",
    Boolean(packageOwnership?.parserGroup === "ownership" && packageOwnership?.accessionNumber === purchaseCase.fixture.accessionNumber),
    packageForPurchase.hard_parsers,
  );
  check(
    "all four ownership forms parse into the ownership worker family",
    ownershipCases.every((item) => item.parsed.parserGroup === "ownership" && item.parsed.facts?.filing?.form_type === item.formType),
    ownershipCases.map((item) => ({ formType: item.formType, parserGroup: item.parsed.parserGroup, filing: item.parsed.facts?.filing })),
  );
  check(
    "production filing package registry wires the ownership adapter",
    sourceIncludes("lib/prompts/secFilingAnalysisPackage.ts", "runSecFormAdapterParser") &&
      sourceIncludes("lib/sources/sec/forms/formWorkerRegistry.ts", "ownershipFormAdapter"),
  );
  check(
    "ownership analysis prompt uses canonical compact source-evidence input without raw XML",
    !purchasePrompt.includes("<ownershipDocument>") &&
      purchasePrompt.includes(`Ownership analysis input:\n${JSON.stringify(purchaseAnalysisInput, null, 2)}`),
    { promptChars: purchasePrompt.length },
  );
  check(
    "ownership analysis prompt preserves the ownership_monitor_facts contract",
    purchasePrompt.includes("analysis_output.ownership_monitor_facts") &&
      purchasePrompt.includes("ownership_monitor_facts_v1"),
  );
  for (const { formType, result } of dryRunResults) {
    check(
      `${formType} developer dry-run requires ownership LLM analysis`,
      result.ok === false &&
        result.stage === "openai" &&
        result.error === "LLM required but disabled for SEC analysis dry-run" &&
        result.prompt?.key === "sec_ownership_analysis",
      result,
    );
  }
  check(
    "ownership source inventory and selected SEC evidence reach the canonical analysis input",
    ownershipAnalysisInputs.every(({ formType, input, parserSelectedEvidence }) => {
      const sourceEvidence = input.ownership_source_evidence;
      return Boolean(
        input.source_inventory &&
        input.selected_evidence === parserSelectedEvidence &&
        Array.isArray(input.selected_evidence) &&
        input.selected_evidence.every((item) =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof item.label === "string" &&
            Object.hasOwn(item, "value") &&
            typeof item.source === "string",
          )) &&
        sourceEvidence?.filing?.form_type === formType &&
        Array.isArray(sourceEvidence.reporting_owners) &&
        (sourceEvidence.form4 === null || Array.isArray(sourceEvidence.form4?.transactions)) &&
        (sourceEvidence.form144 === null || Array.isArray(sourceEvidence.form144?.proposed_sale_rows)),
      );
    }),
    ownershipAnalysisInputs.map(({ formType, input }) => ({
      formType,
      sourceInventory: input.source_inventory,
      selectedEvidenceCount: input.selected_evidence?.length,
    })),
  );
  check(
    "ingest maps display_payload into events.metadata.display_payload",
    sourceIncludes("lib/secStores/eventStore.ts", "display_payload: displayPayload") &&
      sourceIncludes("lib/secStores/eventStore.ts", "archive_summary: archiveSummary"),
  );
  check(
    "production ownership runtime uses the direct analysis LLM path",
      sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "buildSecOwnershipAnalysisPrompt") &&
      sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "if (isOwnershipFilingInput(input))") &&
      sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "runOpenAiJsonPrompt(env, prompt, llmConfig)"),
  );
  check(
    "legacy ownership deterministic final analysis is absent",
    !("buildDeterministicOwnershipResult" in ownershipParser) &&
      !sourceIncludes("lib/sources/sec/forms/ownership/adapter.ts", "tryDeterministicResult") &&
      !sourceIncludes("lib/sources/sec/forms/ownership/adapter.ts", "buildDeterministicResult") &&
      !sourceIncludes("lib/ai/secOwnershipAnalysisAdapter.ts", "buildDeterministicOwnershipAnalysis") &&
      !sourceIncludes("lib/ai/secFilingAnalysisPreview.ts", "attachOwnershipArchiveContextGuardPreview"),
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
          ownershipFinalAnalysisRequiresLlm: true,
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

function compileOwnershipDryRun() {
  const previewSource = readFileSync(path.resolve(repoRoot, "lib/ai/secFilingAnalysisPreview.ts"), "utf8");
  const withoutLlmStart = previewSource.indexOf("async function runSecFilingAnalysisWithoutLlmForRawRow(");
  const withoutLlmEnd = previewSource.indexOf("\nexport async function runSecFilingAnalysisForRawRow(", withoutLlmStart);
  const promptStart = previewSource.indexOf("function buildSecFilingPromptForInput(");
  const promptEnd = previewSource.indexOf("\nfunction shouldForceS3AmendmentAudit(", promptStart);
  if (withoutLlmStart < 0 || withoutLlmEnd <= withoutLlmStart || promptStart < 0 || promptEnd <= promptStart) {
    throw new Error("Could not locate SEC analysis dry-run or prompt selector source");
  }

  const executableSource = stripTypeScriptTypes(
    `${previewSource.slice(promptStart, promptEnd)}\n${previewSource.slice(withoutLlmStart, withoutLlmEnd)}`,
    { mode: "transform" },
  );
  const factory = new Function(
    "mocks",
    `const {
      is424bFilingInput,
      isOwnershipFilingInput,
      buildSecOwnershipAnalysisPrompt,
      isS3AmendmentInput,
      buildDeterministicEffectAnalysis,
      buildDeterministicSc13Analysis,
      buildDeterministicS8ArchiveAnalysis,
      summarizeRawRow
    } = mocks;
    ${executableSource}
    return runSecFilingAnalysisWithoutLlmForRawRow;`,
  );

  return factory({
    is424bFilingInput: () => false,
    isOwnershipFilingInput: (input) => Boolean(input?.filing_package?.hard_parsers?.ownership),
    buildSecOwnershipAnalysisPrompt: () => ({ key: "sec_ownership_analysis", version: "v1" }),
    isS3AmendmentInput: () => false,
    buildDeterministicEffectAnalysis: () => null,
    buildDeterministicSc13Analysis: () => null,
    buildDeterministicS8ArchiveAnalysis: () => null,
    summarizeRawRow: (rawItem) => ({ id: rawItem.id }),
  });
}

function ownershipFilingPackage(item) {
  return {
    form_type: item.formType,
    form_adapter: {
      key: "ownership",
      parserGroup: "ownership",
      analysisMode: "ownership_direct_analysis",
    },
    hard_parsers: {
      ownership: item.parsed,
    },
  };
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
