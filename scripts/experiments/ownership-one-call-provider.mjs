import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Ajv from "ajv";
import { buildModularOneCallPrompt } from "./ownership-one-call-prompt-modules.mjs";
import { buildInputFromSecRawRow } from "../../lib/ai/secFilingAnalysisPreview.ts";
import {
  adaptOwnershipPromptResultForAnalysis,
  buildSecOwnershipAnalysisPrompt,
} from "../../lib/ai/secOwnershipAnalysisAdapter.ts";
import { runStructuredGeminiJson } from "../../lib/ai/geminiStructuredJson.ts";
import { buildOwnershipParserFactRows } from "../../lib/monitor/ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
} from "../../lib/monitor/ownershipStructuredContext.ts";
import {
  buildOwnershipStructuredContextPrompt,
  mapOwnershipContextLlmDto,
} from "../../lib/monitor/ownershipStructuredContextAnalyzer.ts";

// Isolated provider experiment. No database, event, Monitor, or alert writes.
const FIXTURES = Object.freeze({
  AGIG: "source-agig-form4-purchase.json",
  UWMC: "source-uwmc-form4-multi-owner-10b5-1-conversion.json",
  AMCOR: "source-amcor-form144-no-prior-sales.json",
});
const PROMPT_INSPECTION_FIXTURES = Object.freeze({
  FORM144A: "source-globe-form144a-no-remarks.json",
});
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;
const model = "gemini-3.5-flash";
const caseName = process.argv[2];
const artifactRoot = process.argv[3];
const preflightOnly = process.argv[4] === "--preflight";
const inspectPromptOnly = process.argv[4] === "--inspect-prompt";
const offlineReplayPath = preflightOnly ? process.argv[5] : null;
const fixtureFile = FIXTURES[caseName] ?? (inspectPromptOnly ? PROMPT_INSPECTION_FIXTURES[caseName] : null);
if (!fixtureFile || !artifactRoot) throw new Error("Pass AGIG, UWMC, AMCOR, or a prompt-inspection Form amendment and an artifact directory");
if (!preflightOnly && !inspectPromptOnly && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is unavailable");

const fixturePath = join("lib", "sources", "sec", "forms", "ownership", "fixtures", fixtureFile);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const xml = fixture.filingText;
const issuerCik = xmlValue(xml, "issuerCik");
const ticker = xmlValue(xml, "issuerTradingSymbol");
const source = {
  xml,
  form: fixture.formType,
  accessionNumber: fixture.accessionNumber,
  issuerCik,
  issuerTradingSymbol: ticker,
  issuerName: xmlValue(xml, "issuerName"),
  reportingOwners: fixture.formType.startsWith("144")
    ? [{ cik: null, name: xmlValue(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold") }]
    : [...xml.matchAll(/<reportingOwner\b[^>]*>([\s\S]*?)<\/reportingOwner>/gi)]
      .map((match) => ({ cik: xmlValue(match[1], "rptOwnerCik"), name: xmlValue(match[1], "rptOwnerName") })),
};
const rawItem = {
  id: rawItemId,
  source_code: "sec_edgar",
  source_unique_id: fixture.accessionNumber,
  source_url: fixture.source.url,
  raw_payload: {
    form_type: fixture.formType,
    accession_number: fixture.accessionNumber,
    cik: issuerCik,
    ownership_issuer_cik: issuerCik,
    ticker,
    ownership_issuer_trading_symbol: ticker,
    ownership_source_text: xml,
    ownership_source_url: fixture.source.url,
    ownership_source_format: "ownership_xml",
    ownership_source_text_truncated: false,
  },
};
const filingInput = buildInputFromSecRawRow(rawItem);
const direct = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
const form = fixture.formType.startsWith("144") ? "form144" : "form4";
const inventory = buildOwnershipContextReferenceInventory({
  eventId,
  form,
  isAmendment: fixture.formType.endsWith("/A"),
  sourceFingerprint: fingerprint,
  rows: form === "form4" ? direct.form4Transactions : direct.form144ProposedSales,
  sourceXml: xml,
});
const primaryPrompt = buildSecOwnershipAnalysisPrompt(filingInput);
const contextPrompt = buildOwnershipStructuredContextPrompt({ source, inventory });
const primarySchema = primaryPrompt.responseFormat.json_schema.schema;
// Derive the model-facing Primary contract from the real Ownership Primary schema.
// The adapter supplies parser_output from the immutable parser package.
const { parser_output: _serverOwnedParserOutput, ...modelPrimaryProperties } = primarySchema.properties;
const modelPrimarySchema = {
  ...primarySchema,
  additionalProperties: false,
  properties: modelPrimaryProperties,
};
const structuredSchema = contextPrompt.responseFormat.json_schema;
const envelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["primary", "structured"],
  properties: { primary: modelPrimarySchema, structured: structuredSchema },
};
const modularPrompt = buildModularOneCallPrompt({
  primaryPrompt,
  contextPrompt,
  filingInput,
  source,
  inventory,
  modelPrimarySchema,
  envelopeSchema,
});
const combined = modularPrompt.prompt;

const prefix = join(artifactRoot, caseName);
const inputEvidence = {
  caseName,
  model,
  accession: fixture.accessionNumber,
  sourceSha256: sha256(xml),
  primaryPromptSha256: sha256(primaryPrompt.system + primaryPrompt.user),
  contextPromptSha256: sha256(contextPrompt.system + contextPrompt.user),
  combinedPromptSha256: sha256(combined.system + combined.user),
  integratedPromptVersion: "ownership_one_call_common_dedup_v3",
  primaryPromptChars: primaryPrompt.system.length + primaryPrompt.user.length,
  contextPromptChars: contextPrompt.system.length + contextPrompt.user.length,
  combinedPromptChars: combined.system.length + combined.user.length,
  legacyCombinedPromptChars: modularPrompt.legacyPromptChars,
  activePromptModules: modularPrompt.activeModules,
  availablePromptContext: modularPrompt.context,
  primaryContractChars: JSON.stringify(modelPrimarySchema).length,
  primarySchemaChars: JSON.stringify(primarySchema).length,
  primaryOutputKeys: modelPrimarySchema.required,
  structuredOutputKeys: structuredSchema.required,
  primaryContractSha256: sha256(JSON.stringify(modelPrimarySchema)),
  structuredContractSha256: sha256(JSON.stringify(structuredSchema)),
  directRows: form === "form4" ? direct.form4Transactions.length : direct.form144ProposedSales.length,
  directRowsSha256Before: sha256(JSON.stringify(form === "form4" ? direct.form4Transactions : direct.form144ProposedSales)),
  outputTokenLimit: 12000,
  providerResponseSchema: false,
};
if (inspectPromptOnly) {
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(prefix + "-system-prompt.txt", combined.system);
  writeFileSync(prefix + "-user-prompt.txt", combined.user);
  const assembledInstructions = `${combined.system}\n${combined.user}`;
  const instructionConflicts = {
    parserPassThrough: assembledInstructions.includes("parser_output is pass-through"),
    parserRuntimeOutput: assembledInstructions.includes("Do not rewrite parser_output in runtime output"),
    separateParentObject: assembledInstructions.includes("parent_filing_context"),
    rawXmlStructuredRule: combined.system.includes("Treat the original SEC XML as the only semantic authority"),
    form144OwnerAttribution: form === "form144" && combined.system.includes("Bind owner attribution to the reporting person"),
    form144OwnershipRelation: form === "form144" && combined.system.includes("Use ownership_relation only when"),
    duplicatePrimaryJsonOnly: combined.user.includes("\nReturn JSON only.\n")
      || combined.user.includes("\nReturn JSON only according to the provided response schema.\n"),
    duplicateStructuredEvidenceBoundary: combined.system.includes("Do not use parser semantic fields, Primary analysis, scores, signals, investor copy, market data, or Monitor conditions as evidence or inputs."),
    duplicateSupportedFactOmission: combined.system.includes("Emit a fact only when supported; otherwise omit it."),
  };
  if (Object.values(instructionConflicts).some(Boolean)) {
    throw new Error(`One-call prompt still contains an instruction conflict: ${JSON.stringify(instructionConflicts)}`);
  }
  console.log(JSON.stringify({ ...inputEvidence, instructionConflicts }));
  process.exit(0);
}
mkdirSync(artifactRoot, { recursive: true });
writeFileSync(prefix + "-input.json", JSON.stringify(inputEvidence, null, 2));
if (preflightOnly) {
  writeFileSync(prefix + "-system-prompt.txt", combined.system);
  writeFileSync(prefix + "-user-prompt.txt", combined.user);
  const structuredPromptContract = JSON.parse(contextPrompt.user).output_contract;
  const contractDrift = {
    primaryAnalysisOutput: JSON.stringify(modelPrimarySchema.properties.analysis_output) !== JSON.stringify(primarySchema.properties.analysis_output),
    primaryDisplayPayload: JSON.stringify(modelPrimarySchema.properties.display_payload) !== JSON.stringify(primarySchema.properties.display_payload),
    primaryRequired: JSON.stringify(modelPrimarySchema.required) !== JSON.stringify(primarySchema.required),
    structured: JSON.stringify(structuredPromptContract) !== JSON.stringify(structuredSchema),
  };
  if (Object.values(contractDrift).some(Boolean)) throw new Error(`Contract drift: ${JSON.stringify(contractDrift)}`);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validateEnvelope = ajv.compile(envelopeSchema);
  let providerRequest = null;
  await runStructuredGeminiJson({
    apiKey: "offline-dummy-key",
    model,
    prompt: combined,
    maxOutputTokens: 12000,
    fetchImpl: async (_url, request) => {
      providerRequest = JSON.parse(request.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }), { status: 200 });
    },
  });
  const providerRequestValid = providerRequest?.generationConfig?.responseMimeType === "application/json"
    && !Object.hasOwn(providerRequest.generationConfig, "responseSchema")
    && providerRequest.generationConfig.maxOutputTokens === 12000;
  if (!providerRequestValid) throw new Error("Offline Gemini JSON-mode request shape is invalid");
  let offlineAdapterReplay = null;
  if (offlineReplayPath) {
    const oldOutput = JSON.parse(readFileSync(offlineReplayPath, "utf8"));
    const oldPrimary = oldOutput.primary;
    const oldStructured = oldOutput.structured;
    const structurallyProjectedPrimary = oldPrimary && typeof oldPrimary === "object"
      ? { analysis_output: oldPrimary.analysis_output, display_payload: oldPrimary.display_payload }
      : null;
    const envelopeReplay = { primary: structurallyProjectedPrimary, structured: oldStructured };
    const schemaValid = validateEnvelope(envelopeReplay);
    const primaryReplay = structurallyProjectedPrimary
      ? adaptOwnershipPromptResultForAnalysis(structurallyProjectedPrimary, filingInput) : null;
    const mappedReplay = oldStructured
      ? mapOwnershipContextLlmDto({ candidate: oldStructured, source, inventory }) : null;
    const canonicalReplay = mappedReplay?.ok
      ? validateOwnershipContextCandidate(mappedReplay.value, inventory) : null;
    offlineAdapterReplay = {
      source: offlineReplayPath,
      sourceSha256: sha256(readFileSync(offlineReplayPath)),
      fullSchemaPass: schemaValid,
      fullSchemaErrors: validateEnvelope.errors ?? [],
      primaryPass: primaryReplay?.ok ?? false,
      primaryError: primaryReplay && !primaryReplay.ok ? primaryReplay.error : null,
      structuredDtoPass: mappedReplay?.ok ?? false,
      structuredCanonicalPass: canonicalReplay?.ok ?? false,
      structuredErrors: mappedReplay && !mappedReplay.ok ? mappedReplay.errors : canonicalReplay && !canonicalReplay.ok ? canonicalReplay.errors : [],
      note: "Offline adapter compatibility only; this is not a new provider result.",
    };
    if (!schemaValid || !primaryReplay?.ok || !mappedReplay?.ok || !canonicalReplay?.ok) {
      throw new Error(`Offline representative response failed: ${JSON.stringify(offlineAdapterReplay)}`);
    }
    const badPrimaryGroup = structuredClone(structurallyProjectedPrimary);
    badPrimaryGroup.analysis_output.source_group = "insider";
    const badPrimaryScope = structuredClone(structurallyProjectedPrimary);
    badPrimaryScope.analysis_output.market_scope = "unknown";
    const badStructuredRef = structuredClone(oldStructured);
    badStructuredRef.rows[0].row = "R999";
    if (adaptOwnershipPromptResultForAnalysis(badPrimaryGroup, filingInput).ok
      || adaptOwnershipPromptResultForAnalysis(badPrimaryScope, filingInput).ok
      || mapOwnershipContextLlmDto({ candidate: badStructuredRef, source, inventory }).ok) {
      throw new Error("Offline negative validation gate failed");
    }
    offlineAdapterReplay.negativeValidationPass = true;
  }
  console.log(JSON.stringify({ ...inputEvidence, contractDrift, providerRequestValid, offlineAdapterReplay }));
  process.exit(0);
}
const started = performance.now();
const run = await runStructuredGeminiJson({
  apiKey: process.env.GEMINI_API_KEY,
  model,
  prompt: combined,
  maxOutputTokens: 12000,
});
const latencyMs = Math.round(performance.now() - started);
writeFileSync(prefix + "-raw-output.txt", run.outputText);
writeFileSync(prefix + "-raw-provider.json", JSON.stringify(run.body, null, 2));

const ajv = new Ajv({ strict: false, allErrors: true });
const validateEnvelope = ajv.compile(envelopeSchema);
const schemaValid = run.parsed ? validateEnvelope(run.parsed) : false;
const envelope = schemaValid && run.parsed
  && Object.keys(run.parsed).sort().join(",") === "primary,structured"
  && run.parsed.primary && typeof run.parsed.primary === "object" && !Array.isArray(run.parsed.primary)
  && Object.keys(run.parsed.primary).sort().join(",") === "analysis_output,display_payload"
  && run.parsed.structured && typeof run.parsed.structured === "object" && !Array.isArray(run.parsed.structured)
  && Object.keys(run.parsed.structured).sort().join(",") === "rows,version"
  ? run.parsed : null;
const primary = envelope ? adaptOwnershipPromptResultForAnalysis(envelope.primary, filingInput) : null;
const mapped = envelope ? mapOwnershipContextLlmDto({ candidate: envelope.structured, source, inventory }) : null;
const context = mapped?.ok ? validateOwnershipContextCandidate(mapped.value, inventory) : null;
const result = {
  ...inputEvidence,
  httpStatus: run.status,
  providerOk: run.responseOk,
  providerError: run.error ?? null,
  finishReason: run.body?.candidates?.[0]?.finishReason ?? null,
  latencyMs,
  usage: run.usage,
  rawOutputSha256: sha256(run.outputText),
  envelopeValid: Boolean(envelope),
  fullSchemaValid: schemaValid,
  fullSchemaErrors: validateEnvelope.errors ?? [],
  returnedRootKeys: run.parsed ? Object.keys(run.parsed) : null,
  returnedPrimaryKeys: run.parsed?.primary && typeof run.parsed.primary === "object" ? Object.keys(run.parsed.primary) : null,
  returnedStructuredKeys: run.parsed?.structured && typeof run.parsed.structured === "object" ? Object.keys(run.parsed.structured) : null,
  primaryValid: primary?.ok ?? false,
  primaryError: primary && !primary.ok ? primary.error : null,
  structuredDtoValid: mapped?.ok ?? false,
  structuredDtoErrors: mapped && !mapped.ok ? mapped.errors : [],
  structuredCanonicalValid: context?.ok ?? false,
  structuredCanonicalErrors: context && !context.ok ? context.errors : [],
  directFactsWritten: false,
  directRowsSha256After: sha256(JSON.stringify(form === "form4" ? direct.form4Transactions : direct.form144ProposedSales)),
};
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

function xmlValue(text, localName) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return text.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
