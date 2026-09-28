import { createHash, randomUUID } from "node:crypto";
import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
  type StructuredJsonPrompt,
} from "../ai/geminiStructuredJson.ts";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";
import {
  persistOwnershipStructuredContext,
  OwnershipContextValidationError,
  type OwnershipContextPersistenceRepository,
} from "./ownershipContextPersistence.ts";
import { readCurrentOwnershipFacts } from "./ownershipMonitorPersistence.ts";
import {
  OWNERSHIP_CONTEXT_VERSION,
  OWNERSHIP_CONTEXT_AI_PROMPT_KEY,
  OWNERSHIP_CONTEXT_AI_PROMPT_VERSION,
  OWNERSHIP_CONTEXT_AI_PURPOSE,
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
  type OwnershipContextReferenceInventory,
  type ValidatedOwnershipContextBundle,
} from "./ownershipStructuredContext.ts";
import {
  routeOwnershipSemanticPrompt,
  routeOwnershipSemanticPromptFromInventory,
  type OwnershipSemanticPromptRoute,
  type RoutedOwnershipSemanticPrompt,
} from "./ownershipSemanticPrompts/router.ts";
import {
  OWNERSHIP_SEMANTIC_VERIFIER_PURPOSE,
  OWNERSHIP_SEMANTIC_VERIFIER_VERSION,
  verifyOwnershipSemanticAssertions,
  type OwnershipSemanticVerificationRecord,
  type OwnershipSemanticVerifier,
} from "./ownershipSemanticVerifier.ts";
import {
  OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION,
  OWNERSHIP_CONTEXT_SELECTION_REFS_VERSION,
  buildOwnershipContextSelectionBindings,
  buildOwnershipNeutralSourceBlocks,
  type OwnershipContextSelectionRowBinding,
  type OwnershipNeutralSourcePromptPackage,
} from "./ownershipNeutralSourceBlocks.ts";

type Row = Record<string, unknown>;
export const OWNERSHIP_CONTEXT_LLM_VERSION = "ownership_context_selection_v1" as const;
export const OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION = "ownership_context_semantic_v1.2-form4-no-footnote-scopes" as const;
export const OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION = "ownership_context_selection_wire_v4-form4-no-footnote-scopes" as const;
export const OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION = OWNERSHIP_CONTEXT_SELECTION_REFS_VERSION;

const OWNERSHIP_CONTEXT_LLM_FACT_FIELDS = [
  "owner_relations",
  "derivative_underlying_relation",
  "rule_10b5_1",
  "footnote_scopes",
  "amendment_effect",
] as const;

type OwnershipContextLlmFactField = typeof OWNERSHIP_CONTEXT_LLM_FACT_FIELDS[number];
type OwnershipContextLlmRowContract = Readonly<{
  row: string;
  canonicalRowRef: string;
  allowedFactFields: readonly OwnershipContextLlmFactField[];
  owners: OwnershipContextSelectionRowBinding["owners"];
  rowSecurity: OwnershipContextSelectionRowBinding["rowSecurity"];
  underlyingSecurities: OwnershipContextSelectionRowBinding["underlyingSecurities"];
  footnotes: OwnershipContextSelectionRowBinding["footnotes"];
  canonicalEvidenceRefs: readonly string[];
  rowEvidenceAllowed: boolean;
  rule10b51TrueAllowed: boolean;
  rule10b51FalseAllowed: boolean;
}>;

export {
  OWNERSHIP_CONTEXT_AI_PROMPT_KEY,
  OWNERSHIP_CONTEXT_AI_PROMPT_VERSION,
  OWNERSHIP_CONTEXT_AI_PURPOSE,
};

export type OwnershipContextAiTraceInput = Readonly<{
  runId: string;
  outputId: string;
  eventId: string;
  rawItemId: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  run: GeminiStructuredJsonRun;
  parsedOutput: Row | null;
  mappedCanonicalOutput: Row | null;
  mappingErrors: readonly string[];
  prompt: StructuredJsonPrompt;
  maxOutputTokens: number;
  semanticPromptRoute: OwnershipSemanticPromptRoute;
  semanticPromptRules: readonly string[];
}>;

export type OwnershipStructuredContextAnalyzerRepository = OwnershipContextPersistenceRepository & Readonly<{
  persistAiTrace(input: OwnershipContextAiTraceInput): Promise<void>;
  persistSemanticVerifierTrace?(input: OwnershipSemanticVerifierTraceInput): Promise<void>;
}>;

export type OwnershipSemanticVerifierTraceInput = Readonly<{
  runId: string;
  outputId: string;
  eventId: string;
  rawItemId: string;
  verifierName: string;
  startedAt: string;
  finishedAt: string;
  sourceAnalysisRefs: Readonly<{ run_id: string; output_id: string }>;
  originalStructuredCandidate: ValidatedOwnershipContextBundle;
  effectiveStructuredCandidate: ValidatedOwnershipContextBundle;
  records: readonly OwnershipSemanticVerificationRecord[];
}>;

export type OwnershipStructuredContextAnalysisResult =
  | Readonly<{
      status: "stored" | "replayed";
      eventId: string;
      runId: string;
      outputId: string;
      model: string;
      updatedRowCount: number;
      validated: ValidatedOwnershipContextBundle;
      semanticVerification:
        | Readonly<{ mode: "disabled"; verified: false }>
        | Readonly<{
            mode: "experimental";
            targetCount: number;
            eligibleCount: number;
            ineligibleCount: number;
          }>;
    }>
  | Readonly<{
      status: "unavailable";
      stage: "direct_facts" | "source" | "configuration" | "provider" | "trace" | "validation" | "semantic_verifier" | "persistence";
      reason: string;
      eventId: string;
      runId?: string;
      outputId?: string;
      model?: string;
      validationErrors?: readonly string[];
    }>;

type NeutralOwnershipContextPromptInput = Readonly<{
  neutral_source_blocks: OwnershipNeutralSourcePromptPackage;
  form: string;
  accession_number: string;
  issuer_identity: Readonly<{
    cik: string;
    trading_symbol: string | null;
    name: string | null;
  }>;
  choices: Readonly<{
    version: typeof OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION;
    owners: readonly Readonly<{
      owner: string;
      name: string;
    }>[];
    rows: readonly Readonly<{
      row: string;
      available_fields: readonly OwnershipContextLlmFactField[];
      owners: readonly string[];
      securities: readonly Readonly<{
        security: string;
        role: "row_security" | "underlying_security";
        title: string;
      }>[];
      evidence: readonly string[];
    }>[];
    footnotes: readonly Readonly<{ footnote: string; text: string }>[];
  }>;
  output_contract: Record<string, unknown>;
  output_example: Record<string, unknown>;
}>;

export async function runOwnershipStructuredContextAnalysis(input: Readonly<{
  eventId: string;
  rawItem: unknown;
}>, options: Readonly<{
  repository?: OwnershipStructuredContextAnalyzerRepository;
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  runPrompt?: typeof runStructuredGeminiJson;
  semanticVerifier?: OwnershipSemanticVerifier;
  fetchImpl?: typeof fetch;
  now?: () => string;
  idFactory?: () => string;
}> = {}): Promise<OwnershipStructuredContextAnalysisResult> {
  const repository = options.repository ?? await defaultRepository();
  const current = await readCurrentOwnershipFacts(input.eventId, repository).catch((error) => ({
    status: "not_ready" as const,
    reason: errorMessage(error, "ownership_direct_facts_read_failed"),
  }));
  if (current.status !== "available") {
    return unavailable(input.eventId, "direct_facts", current.status === "not_ready" ? current.reason : current.status);
  }
  if (!current.contextEligibility || current.contextEligibility.status !== "eligible") {
    return unavailable(
      input.eventId,
      "direct_facts",
      current.contextEligibility?.reason || "ownership_context_ineligible",
    );
  }

  const source = verifyOriginalOwnershipSource({
    rawItem: input.rawItem,
    expectedRawItemId: current.rawItemId,
    expectedAccession: current.accessionNumber,
    expectedForm: current.form,
    rows: current.rows,
  });
  if (!source.ok) return unavailable(input.eventId, "source", source.reason);

  const inventory = buildOwnershipContextReferenceInventory({
    eventId: input.eventId,
    form: current.form,
    isAmendment: current.contextEligibility.inventory.isAmendment,
    sourceFingerprint: current.contextEligibility.inventory.sourceFingerprint,
    rows: current.rows as readonly Record<string, unknown>[],
    sourceXml: source.xml,
  });

  const semanticPromptRoute = routeOwnershipSemanticPrompt({
    rawForm: source.form,
    canonicalForm: current.form,
    isAmendment: inventory.isAmendment,
  });
  if (!semanticPromptRoute.ok) return unavailable(input.eventId, "source", semanticPromptRoute.reason);

  const env = getServerEnv();
  const apiKey = options.apiKey ?? env.geminiApiKey;
  const model = (options.model ?? env.secOwnershipGeminiModel).trim();
  if ((!apiKey && !options.runPrompt) || !model) {
    return unavailable(
      input.eventId,
      "configuration",
      !model ? "ownership_context_gemini_model_unavailable" : "ownership_context_gemini_api_key_unavailable",
      { model },
    );
  }

  let prompt: StructuredJsonPrompt;
  try {
    prompt = buildOwnershipStructuredContextPrompt({
      source,
      inventory,
      semanticPromptRoute: semanticPromptRoute.route,
    });
  } catch (error) {
    return unavailable(input.eventId, "source", errorMessage(error, "ownership_context_neutral_inventory_invalid"));
  }
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? randomUUID;
  const maxOutputTokens = options.maxOutputTokens ?? 4_000;
  const startedAt = now();
  const run = await runProviderWithTimeout({
    apiKey,
    model,
    prompt,
    maxOutputTokens,
    timeoutMs: options.timeoutMs ?? 30_000,
    runPrompt: options.runPrompt,
    fetchImpl: options.fetchImpl ?? fetch,
  });
  const finishedAt = now();
  const parsedOutput = parseProviderOutput(run.outputText);
  const mapping = parsedOutput
    ? mapOwnershipContextLlmDto({
        candidate: parsedOutput,
        source,
        inventory,
      })
    : null;
  const runId = idFactory();
  const outputId = idFactory();

  try {
    await repository.persistAiTrace({
      runId,
      outputId,
      eventId: input.eventId,
      rawItemId: current.rawItemId,
      model,
      startedAt,
      finishedAt,
      run,
      parsedOutput,
      mappedCanonicalOutput: mapping?.mappedCanonicalOutput ?? null,
      mappingErrors: mapping?.errors ?? [],
      prompt,
      maxOutputTokens,
      semanticPromptRoute: semanticPromptRoute.route.id,
      semanticPromptRules: semanticPromptRoute.route.systemRules,
    });
  } catch (error) {
    return unavailable(input.eventId, "trace", errorMessage(error, "ownership_context_ai_trace_failed"), {
      runId, outputId, model,
    });
  }

  if (!run.ok || !parsedOutput) {
    return unavailable(input.eventId, "provider", run.error || "ownership_context_provider_output_invalid", {
      runId, outputId, model,
    });
  }
  if (!mapping?.ok) {
    return unavailable(input.eventId, "validation", "ownership_context_llm_dto_invalid", {
      runId, outputId, model, validationErrors: mapping?.errors ?? ["ownership_context_llm output is unavailable"],
    });
  }
  const validation = validateOwnershipContextCandidate(mapping.value, inventory);
  if (!validation.ok) {
    return unavailable(input.eventId, "validation", "ownership_context_candidate_invalid", {
      runId, outputId, model, validationErrors: validation.errors,
    });
  }
  let effectiveCandidate = validation.value;
  let contextAiRefs = { run_id: runId, output_id: outputId };
  let semanticVerificationResult: Extract<OwnershipStructuredContextAnalysisResult, { status: "stored" | "replayed" }>["semanticVerification"] = {
    mode: "disabled",
    verified: false,
  };
  if (options.semanticVerifier) {
    const verifierRunId = idFactory();
    const verifierOutputId = idFactory();
    const verifierStartedAt = now();
    let semanticVerification: Awaited<ReturnType<typeof verifyOwnershipSemanticAssertions>>;
    try {
      semanticVerification = await verifyOwnershipSemanticAssertions({
        candidate: validation.value,
        inventory,
        sourceXml: source.xml,
        verifier: options.semanticVerifier,
      });
    } catch (error) {
      return unavailable(input.eventId, "semantic_verifier", errorMessage(error, "ownership_semantic_verifier_failed"), {
        runId, outputId, model,
      });
    }
    if (!repository.persistSemanticVerifierTrace) {
      return unavailable(input.eventId, "trace", "ownership_semantic_verifier_trace_repository_unavailable", {
        runId, outputId, model,
      });
    }
    try {
      await repository.persistSemanticVerifierTrace({
        runId: verifierRunId,
        outputId: verifierOutputId,
        eventId: input.eventId,
        rawItemId: current.rawItemId,
        verifierName: options.semanticVerifier.name.trim() || "unnamed-experimental-verifier",
        startedAt: verifierStartedAt,
        finishedAt: now(),
        sourceAnalysisRefs: { run_id: runId, output_id: outputId },
        originalStructuredCandidate: validation.value,
        effectiveStructuredCandidate: semanticVerification.effectiveCandidate,
        records: semanticVerification.records,
      });
    } catch (error) {
      return unavailable(input.eventId, "trace", errorMessage(error, "ownership_semantic_verifier_trace_failed"), {
        runId, outputId, model,
      });
    }
    effectiveCandidate = semanticVerification.effectiveCandidate;
    contextAiRefs = { run_id: verifierRunId, output_id: verifierOutputId };
    semanticVerificationResult = {
      mode: "experimental",
      targetCount: semanticVerification.targetCount,
      eligibleCount: semanticVerification.eligibleCount,
      ineligibleCount: semanticVerification.ineligibleCount,
    };
  }
  try {
    const persisted = await persistOwnershipStructuredContext({
      eventId: input.eventId,
      candidate: effectiveCandidate,
      aiRefs: contextAiRefs,
    }, repository);
    return {
      status: persisted.status,
      eventId: input.eventId,
      runId,
      outputId,
      model,
      updatedRowCount: persisted.updatedRowCount,
      validated: persisted.validated,
      semanticVerification: semanticVerificationResult,
    };
  } catch (error) {
    return unavailable(input.eventId, "persistence", errorMessage(error, "ownership_context_persistence_failed"), {
      runId,
      outputId,
      model,
      ...(error instanceof OwnershipContextValidationError ? { validationErrors: error.errors } : {}),
    });
  }
}

export function buildOwnershipStructuredContextPrompt(input: Readonly<{
  source: Readonly<{
    xml: string;
    form: string;
    accessionNumber: string;
    issuerCik: string;
    issuerTradingSymbol: string | null;
    issuerName: string | null;
    reportingOwners: readonly Readonly<{ cik: string | null; name: string }>[];
  }>;
  inventory: OwnershipContextReferenceInventory;
  semanticPromptRoute?: RoutedOwnershipSemanticPrompt;
}>): StructuredJsonPrompt {
  const routed = input.semanticPromptRoute ?? routeOwnershipSemanticPrompt({
    rawForm: input.source.form,
    canonicalForm: input.inventory.form,
    isAmendment: input.inventory.isAmendment,
  });
  if (!("id" in routed) && !routed.ok) throw new Error(routed.reason);
  const semanticRoute = "id" in routed ? routed : routed.route;
  const rowContracts = buildOwnershipContextLlmRowContracts(input.source, input.inventory);
  const outputContract = buildOwnershipStructuredContextResponseSchema(input.inventory, rowContracts);
  const neutralSourceBlocks = buildOwnershipNeutralSourceBlocks({
    xml: input.source.xml,
    rawForm: input.source.form,
    accessionNumber: input.source.accessionNumber,
    inventory: input.inventory,
  });
  if (!neutralSourceBlocks.prompt.coverage.complete) {
    throw new Error("ownership_context_neutral_source_block_coverage_incomplete");
  }
  const rowBlocks = readNeutralXmlRowBlocks(input.source.xml, input.inventory.form);
  const footnoteBindings = readNeutralXmlFootnoteBindings(input.source.xml);
  const ownerBindings = readNeutralXmlReportingOwners(input.source.xml, input.inventory.form);
  if (footnoteBindings.length !== input.inventory.footnotes.length
    || footnoteBindings.some((binding, index) => binding.footnote_ref !== input.inventory.footnotes[index]?.footnoteRef)) {
    throw new Error("ownership_context_neutral_footnote_inventory_mismatch");
  }
  if (input.inventory.rows.some((row) => row.ownerRefs.length !== ownerBindings.length)) {
    throw new Error("ownership_context_neutral_owner_inventory_mismatch");
  }
  const neutralInput: NeutralOwnershipContextPromptInput = {
    neutral_source_blocks: neutralSourceBlocks.prompt,
    form: input.source.form,
    accession_number: input.source.accessionNumber,
    issuer_identity: {
      cik: input.source.issuerCik,
      trading_symbol: input.source.issuerTradingSymbol,
      name: input.source.issuerName,
    },
    choices: {
      version: OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION,
      owners: ownerBindings.map((owner, ownerIndex) => ({
        owner: `O${ownerIndex + 1}`,
        name: owner.name,
      })),
      rows: input.inventory.rows.map((row, rowIndex) => ({
        row: rowContracts[rowIndex].row,
        available_fields: rowContracts[rowIndex].allowedFactFields,
        owners: rowContracts[rowIndex].owners.map((owner) => owner.owner),
        securities: [
          ...(rowContracts[rowIndex].rowSecurity ? [{
            security: rowContracts[rowIndex].rowSecurity.security,
            role: "row_security" as const,
            title: readNeutralXmlTitleTextRaw(rowBlocks[rowIndex], input.inventory.form, "row_security"),
          }] : []),
          ...rowContracts[rowIndex].underlyingSecurities.map((selection) => ({
            security: selection.security,
            role: "underlying_security" as const,
            title: readNeutralXmlTitleTextRaw(rowBlocks[rowIndex], input.inventory.form, "underlying_security"),
          })),
        ],
        evidence: [
          ...(rowContracts[rowIndex].rowEvidenceAllowed ? [rowContracts[rowIndex].row] : []),
          ...rowContracts[rowIndex].footnotes.map((footnote) => footnote.footnote),
        ],
      })),
      footnotes: footnoteBindings.map((footnote) => ({
        footnote: footnote.xml_id,
        text: footnote.xml_text_raw,
      })),
    },
    output_contract: outputContract,
    output_example: {
      note: "Empty-result shape only. output_contract and each row's available_fields are authoritative for every non-empty result.",
      version: OWNERSHIP_CONTEXT_LLM_VERSION,
      rows: [],
    },
  };

  return {
    system: [
      ...semanticRoute.systemRules,
      "Read only the supplied deterministic Neutral Ownership Source Blocks and closed selection choices.",
      "Neutral Source Block fields are direct XML lexical values with mechanical links, not parser conclusions. Do not treat a row-scoped D/I field as an owner-specific answer when multiple reporting owners exist.",
      "Return JSON that conforms exactly to output_contract. Emit a fact only when supported; otherwise omit it.",
      "Choose only the exact R, O, S, and F references advertised for that row and field. The server alone binds them to internal event, owner, security, evidence, locator, and fingerprint references.",
      "Do not use any field absent from output_contract or from the selected row's available_fields.",
      "Do not return shares, prices, numeric or monetary amounts, dates, tickers, transaction codes, A/D codes, scores, or narrative analysis.",
      "Never invent, transform, or reproduce internal IDs.",
    ].join(" "),
    user: JSON.stringify(neutralInput),
    responseFormat: { json_schema: outputContract },
  };
}

export function buildOwnershipStructuredContextResponseSchema(
  inventory: OwnershipContextReferenceInventory,
  suppliedContracts?: readonly OwnershipContextLlmRowContract[],
) {
  const contracts = suppliedContracts ?? fallbackOwnershipContextLlmRowContracts(inventory);
  const rowSchemas = contracts.map((contract) => buildSelectionRowSchema(contract));
  return {
    type: "object",
    additionalProperties: false,
    required: ["version", "rows"],
    properties: {
      version: { type: "string", enum: [OWNERSHIP_CONTEXT_LLM_VERSION] },
      rows: {
        type: "array",
        minItems: 0,
        maxItems: contracts.length,
        items: rowSchemas.length === 1 ? rowSchemas[0] : { anyOf: rowSchemas },
      },
    },
  } satisfies Record<string, unknown>;
}

function buildSelectionRowSchema(contract: OwnershipContextLlmRowContract) {
  const ownerChoices = contract.owners.map((owner) => owner.owner);
  const footnoteChoices = contract.footnotes.map((footnote) => footnote.footnote);
  const directRelationEvidence = contract.rowEvidenceAllowed && contract.owners.length === 1 ? [contract.row] : [];
  const commonEvidence = [...directRelationEvidence, ...footnoteChoices];
  const factSchemas: Record<OwnershipContextLlmFactField, Record<string, unknown>> = {
    owner_relations: {
      type: "array", minItems: 1, maxItems: Math.max(1, ownerChoices.length),
      items: closedObject(["owner", "relation", "evidence"], {
        owner: { type: "string", enum: ownerChoices },
        relation: { type: "string", enum: ["direct", "indirect"] },
        evidence: selectionEvidenceSchema(commonEvidence),
      }),
    },
    derivative_underlying_relation: closedObject(["underlying", "evidence"], {
      underlying: { type: "string", enum: contract.underlyingSecurities.map((item) => item.security) },
      evidence: selectionEvidenceSchema([contract.row, ...footnoteChoices]),
    }),
    rule_10b5_1: {
      anyOf: [
        ...(contract.rule10b51TrueAllowed ? [closedObject(
          contract.owners.length > 1 ? ["applies", "owner", "evidence"] : ["applies", "evidence"],
          {
            applies: { type: "boolean", enum: [true] },
            ...(contract.owners.length > 0 ? { owner: { type: "string", enum: ownerChoices } } : {}),
            evidence: selectionEvidenceSchema(footnoteChoices),
          },
        )] : []),
        ...(contract.rule10b51FalseAllowed ? [closedObject(["applies", "evidence"], {
          applies: { type: "boolean", enum: [false] },
          evidence: selectionEvidenceSchema([contract.row]),
        })] : []),
      ],
    },
    footnote_scopes: {
      type: "array", minItems: 1, maxItems: Math.max(1, footnoteChoices.length * 4),
      items: {
        type: "object",
        additionalProperties: false,
        required: ["footnote", "scope"],
        properties: {
          footnote: { type: "string", enum: footnoteChoices },
          scope: { type: "string", enum: ["row", "owner", "security", "filing"] },
          owner: { type: "string", enum: ownerChoices },
          ...(contract.rowSecurity ? { security: { type: "string", enum: [contract.rowSecurity.security] } } : {}),
          evidence: selectionEvidenceSchema([contract.row, ...footnoteChoices]),
        },
        allOf: [
          {
            if: { properties: { scope: { const: "owner" } }, required: ["scope"] },
            then: { required: ["owner"], not: { required: ["security"] } },
          },
          {
            if: { properties: { scope: { const: "security" } }, required: ["scope"] },
            then: { required: ["security"], not: { required: ["owner"] } },
          },
        ],
      },
    },
    amendment_effect: closedObject(["effect", "evidence"], {
      effect: { type: "string", enum: ["adds", "modifies", "removes", "restates", "no_change"] },
      evidence: selectionEvidenceSchema([contract.row]),
    }),
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["row"],
    properties: {
      row: { type: "string", enum: [contract.row] },
      ...Object.fromEntries(contract.allowedFactFields.map((field) => [field, factSchemas[field]])),
    },
  };
}

function closedObject(required: readonly string[], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: [...required], properties };
}

function selectionEvidenceSchema(values: readonly string[]) {
  return {
    type: "array",
    minItems: 1,
    maxItems: Math.max(1, values.length),
    uniqueItems: true,
    items: { type: "string", enum: [...values] },
  };
}

export function mapOwnershipContextLlmDto(input: Readonly<{
  candidate: unknown;
  source: Readonly<{
    xml: string;
    form: string;
    reportingOwners: readonly Readonly<{ cik: string | null; name: string }>[];
  }>;
  inventory: OwnershipContextReferenceInventory;
}>):
  | Readonly<{ ok: true; value: Row; mappedCanonicalOutput: Row; errors: readonly [] }>
  | Readonly<{ ok: false; mappedCanonicalOutput: Row; errors: readonly string[] }> {
  const errors: string[] = [];
  const contracts = buildOwnershipContextLlmRowContracts(input.source, input.inventory);
  const root = llmStrictRecord(input.candidate, "ownership_context_llm", ["version", "rows"], errors);
  const mappedRows: Row[] = [];
  const mappedCanonicalOutput: Row = {
    version: OWNERSHIP_CONTEXT_VERSION,
    event_ref: input.inventory.eventRef,
    form: input.inventory.form,
    source_fingerprint: input.inventory.sourceFingerprint,
    rows: mappedRows,
  };
  if (!root) return { ok: false, mappedCanonicalOutput, errors: Object.freeze(errors) };
  if (root.version !== OWNERSHIP_CONTEXT_LLM_VERSION) errors.push("ownership_context_llm.version is invalid");
  if (!Array.isArray(root.rows) || root.rows.length > contracts.length) {
    errors.push("ownership_context_llm.rows must contain between zero and the current row count");
  }
  const contractById = new Map(contracts.map((contract) => [contract.row, contract]));
  const seenRows = new Set<string>();
  if (Array.isArray(root.rows)) root.rows.forEach((rowValue, rowIndex) => {
    const path = `ownership_context_llm.rows[${rowIndex}]`;
    const row = llmStrictRecord(rowValue, path, ["row", ...OWNERSHIP_CONTEXT_LLM_FACT_FIELDS], errors);
    if (!row) return;
    const rowId = strictId(row.row);
    const contract = rowId ? contractById.get(rowId) : undefined;
    if (!rowId || !contract) {
      errors.push(`${path}.row does not reference a current selection row`);
      return;
    }
    if (seenRows.has(rowId)) errors.push(`${path}.row is duplicated`);
    seenRows.add(rowId);
    const allowed = new Set(contract.allowedFactFields);
    for (const field of OWNERSHIP_CONTEXT_LLM_FACT_FIELDS) {
      if (Object.hasOwn(row, field) && !allowed.has(field)) errors.push(`${path}.${field} is not applicable to this XML row`);
    }
    const assertions: Row[] = [];
    for (const field of contract.allowedFactFields) {
      if (!Object.hasOwn(row, field)) continue;
      assertions.push(...mapSelectionFact(field, row[field], contract, `${path}.${field}`, errors));
    }
    mappedRows.push({ row_ref: contract.canonicalRowRef, assertions });
  });
  if (errors.length > 0) {
    return { ok: false, mappedCanonicalOutput, errors: Object.freeze(errors) };
  }
  return { ok: true, value: mappedCanonicalOutput, mappedCanonicalOutput, errors: Object.freeze([]) };
}

function buildOwnershipContextLlmRowContracts(
  source: Readonly<{
    xml: string;
    form: string;
    reportingOwners: readonly Readonly<{ cik: string | null; name: string }>[];
  }>,
  inventory: OwnershipContextReferenceInventory,
): readonly OwnershipContextLlmRowContract[] {
  const rowBlocks = readNeutralXmlRowBlocks(source.xml, inventory.form);
  if (rowBlocks.length !== inventory.rows.length) throw new Error("ownership_context_neutral_row_block_mismatch");
  const ownerBindings = readNeutralXmlReportingOwners(source.xml, inventory.form);
  if (inventory.rows.some((row) => row.ownerRefs.length !== ownerBindings.length)) {
    throw new Error("ownership_context_neutral_owner_inventory_mismatch");
  }
  const footnoteBindings = readNeutralXmlFootnoteBindings(source.xml);
  const semanticPromptRoute = routeOwnershipSemanticPrompt({
    rawForm: source.form,
    canonicalForm: inventory.form,
    isAmendment: inventory.isAmendment,
  });
  if (!semanticPromptRoute.ok) throw new Error(semanticPromptRoute.reason);
  const isAmendment = semanticPromptRoute.route.isAmendment;
  const routeFields = new Set<OwnershipContextLlmFactField>(semanticPromptRoute.route.outputFactFields);
  const bindings = buildOwnershipContextSelectionBindings(inventory);
  return Object.freeze(inventory.rows.map((row, rowIndex) => {
    const rowBlock = rowBlocks[rowIndex];
    const binding = bindings.rows[rowIndex];
    const uniqueEvidence = binding.canonicalEvidenceRefs.length === 1;
    const linked10b51 = binding.footnotes.some((footnote) => {
      const canonical = inventory.footnotes.find((item) => item.footnoteRef === footnote.canonicalFootnoteRef);
      return canonical ? /10b5-?1/i.test(canonical.text) : false;
    });
    const allowed: OwnershipContextLlmFactField[] = [];
    if (inventory.form === "form4"
      && row.ownerRefs.length > 0
      && uniqueEvidence
      && (row.ownerRefs.length === 1
        ? /<(?:[A-Za-z_][\w.-]*:)?directOrIndirectOwnership\b/i.test(rowBlock)
        : binding.footnotes.length > 0)) {
      allowed.push("owner_relations");
    }
    if (uniqueEvidence && binding.rowSecurity && binding.underlyingSecurities.length > 0) {
      allowed.push("derivative_underlying_relation");
    }
    const rule10b51TrueAllowed = inventory.form === "form4" && uniqueEvidence && linked10b51;
    const rule10b51FalseAllowed = inventory.form === "form4" && uniqueEvidence
      && inventory.filingRule10b51 === false;
    if (rule10b51TrueAllowed || rule10b51FalseAllowed) {
      allowed.push("rule_10b5_1");
    }
    if (uniqueEvidence && binding.footnotes.length > 0) allowed.push("footnote_scopes");
    if (uniqueEvidence && isAmendment) allowed.push("amendment_effect");
    return Object.freeze({
      ...binding,
      allowedFactFields: Object.freeze(allowed.filter((field) => routeFields.has(field))),
      rowEvidenceAllowed: uniqueEvidence,
      rule10b51TrueAllowed,
      rule10b51FalseAllowed,
    });
  }));
}

function fallbackOwnershipContextLlmRowContracts(
  inventory: OwnershipContextReferenceInventory,
): readonly OwnershipContextLlmRowContract[] {
  const bindings = buildOwnershipContextSelectionBindings(inventory);
  const routeFields = new Set<OwnershipContextLlmFactField>(routeOwnershipSemanticPromptFromInventory(inventory).outputFactFields);
  return Object.freeze(inventory.rows.map((row, index) => {
    const binding = bindings.rows[index];
    const uniqueEvidence = binding.canonicalEvidenceRefs.length === 1;
    const linked10b51 = binding.footnotes.some((footnote) => /10b5-?1/i.test(
      inventory.footnotes.find((item) => item.footnoteRef === footnote.canonicalFootnoteRef)?.text ?? "",
    ));
    const allowed: OwnershipContextLlmFactField[] = [];
    if (inventory.form === "form4" && uniqueEvidence && row.ownerRefs.length > 0
      && (row.ownerRefs.length === 1 ? Boolean(row.direct.directOrIndirectOwnership) : binding.footnotes.length > 0)) {
      allowed.push("owner_relations");
    }
    if (uniqueEvidence && binding.rowSecurity && binding.underlyingSecurities.length > 0) {
      allowed.push("derivative_underlying_relation");
    }
    const rule10b51TrueAllowed = inventory.form === "form4" && uniqueEvidence && linked10b51;
    const rule10b51FalseAllowed = inventory.form === "form4" && uniqueEvidence
      && (row.direct.is10b51 === false || inventory.filingRule10b51 === false);
    if (rule10b51TrueAllowed || rule10b51FalseAllowed) allowed.push("rule_10b5_1");
    if (uniqueEvidence && binding.footnotes.length > 0) allowed.push("footnote_scopes");
    if (uniqueEvidence && inventory.isAmendment) allowed.push("amendment_effect");
    return Object.freeze({
      ...binding,
      allowedFactFields: Object.freeze(allowed.filter((field) => routeFields.has(field))),
      rowEvidenceAllowed: uniqueEvidence,
      rule10b51TrueAllowed,
      rule10b51FalseAllowed,
    });
  }));
}

function mapSelectionFact(
  field: OwnershipContextLlmFactField,
  value: unknown,
  contract: OwnershipContextLlmRowContract,
  path: string,
  errors: string[],
): Row[] {
  if (field === "owner_relations") return mapOwnerRelations(value, contract, path, errors);
  if (field === "footnote_scopes") return mapFootnoteScopes(value, contract, path, errors);
  const fact = llmStrictRecord(value, path,
    field === "derivative_underlying_relation" ? ["underlying", "evidence"]
      : field === "rule_10b5_1" ? ["applies", "owner", "evidence"]
        : ["effect", "evidence"], errors);
  if (!fact) return [];
  if (field === "derivative_underlying_relation") {
    const target = contract.underlyingSecurities.find((item) => item.security === strictId(fact.underlying));
    const evidence = resolveSelectionEvidence(fact.evidence, contract, [contract.row, ...contract.footnotes.map((item) => item.footnote)], `${path}.evidence`, errors);
    if (!target) errors.push(`${path}.underlying is not an allowed underlying security choice`);
    if (!contract.rowSecurity) errors.push(`${path} has no row security source binding`);
    if (target && contract.rowSecurity && target.canonicalSecurityRef === contract.rowSecurity.canonicalSecurityRef) {
      errors.push(`${path}.underlying cannot self-link to the row security`);
    }
    if (!target || !contract.rowSecurity || !evidence) return [];
    return [{ fact: "derivative_underlying_relation", status: "supported", value: target.canonicalSecurityRef,
      security_ref: contract.rowSecurity.canonicalSecurityRef, ...evidence }];
  }
  if (field === "rule_10b5_1") {
    if (typeof fact.applies !== "boolean") errors.push(`${path}.applies must be boolean`);
    if (fact.applies === true && !contract.rule10b51TrueAllowed) errors.push(`${path}.applies true is not an allowed choice`);
    if (fact.applies === false && !contract.rule10b51FalseAllowed) errors.push(`${path}.applies false is not an allowed choice`);
    const allowedEvidence = fact.applies === true ? contract.footnotes.map((item) => item.footnote) : [contract.row];
    const evidence = resolveSelectionEvidence(fact.evidence, contract, allowedEvidence, `${path}.evidence`, errors);
    const hasOwner = Object.hasOwn(fact, "owner");
    const ownerChoice = hasOwner ? strictId(fact.owner) : null;
    const owner = ownerChoice ? contract.owners.find((item) => item.owner === ownerChoice) : null;
    if (hasOwner && !ownerChoice) errors.push(`${path}.owner must be a non-empty selection reference`);
    if (ownerChoice && !owner) errors.push(`${path}.owner is not an allowed owner choice`);
    if (fact.applies === false && hasOwner) errors.push(`${path}.owner is not allowed for a false 10b5-1 choice`);
    if (fact.applies === true && contract.owners.length > 1 && !owner) errors.push(`${path}.owner is required for a multi-owner 10b5-1 claim`);
    if (typeof fact.applies !== "boolean" || !evidence || (hasOwner && !owner) || (fact.applies === false && hasOwner)) return [];
    return [{ fact: "rule_10b5_1_applicability", status: "supported", value: fact.applies,
      ...(owner ? { owner_ref: owner.canonicalOwnerRef } : {}),
      ...(contract.rowSecurity ? { security_ref: contract.rowSecurity.canonicalSecurityRef } : {}), ...evidence }];
  }
  const evidence = resolveSelectionEvidence(fact.evidence, contract, [contract.row], `${path}.evidence`, errors);
  const validEffect = typeof fact.effect === "string"
    && ["adds", "modifies", "removes", "restates", "no_change"].includes(fact.effect);
  if (!validEffect) {
    errors.push(`${path}.effect is invalid`);
  }
  return evidence && validEffect
    ? [{ fact: "amendment_effect", status: "supported", value: fact.effect, evidence_refs: evidence.evidence_refs }]
    : [];
}

function mapOwnerRelations(value: unknown, contract: OwnershipContextLlmRowContract, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.length > Math.max(1, contract.owners.length)) {
    errors.push(`${path} must contain one item per selected owner and cannot exceed the row owner choices`);
    return [];
  }
  const seenOwners = new Set<string>();
  return value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    const fact = llmStrictRecord(item, itemPath, ["owner", "relation", "evidence"], errors);
    if (!fact) return [];
    const ownerChoice = strictId(fact.owner);
    const owner = ownerChoice ? contract.owners.find((candidate) => candidate.owner === ownerChoice) : null;
    if (!owner) errors.push(`${itemPath}.owner is not an allowed owner choice`);
    if (ownerChoice && seenOwners.has(ownerChoice)) errors.push(`${itemPath}.owner is duplicated`);
    if (ownerChoice) seenOwners.add(ownerChoice);
    if (fact.relation !== "direct" && fact.relation !== "indirect") errors.push(`${itemPath}.relation is invalid`);
    const allowedEvidence = [
      ...(contract.rowEvidenceAllowed && contract.owners.length === 1 ? [contract.row] : []),
      ...contract.footnotes.map((footnote) => footnote.footnote),
    ];
    const evidence = resolveSelectionEvidence(fact.evidence, contract, allowedEvidence, `${itemPath}.evidence`, errors);
    return owner && evidence && (fact.relation === "direct" || fact.relation === "indirect")
      ? [{ fact: "ownership_relation", status: "supported", value: fact.relation,
          owner_ref: owner.canonicalOwnerRef, ...evidence }]
      : [];
  });
}

function mapFootnoteScopes(value: unknown, contract: OwnershipContextLlmRowContract, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.length > Math.max(1, contract.footnotes.length * 4)) {
    errors.push(`${path} must contain between one and the allowed number of footnote scopes`);
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    const fact = llmStrictRecord(item, itemPath, ["footnote", "scope", "owner", "security", "evidence"], errors);
    if (!fact) return [];
    const footnoteChoice = strictId(fact.footnote);
    const footnote = footnoteChoice ? contract.footnotes.find((candidate) => candidate.footnote === footnoteChoice) : null;
    if (!footnote) errors.push(`${itemPath}.footnote is not linked to this row`);
    if (typeof fact.scope !== "string" || !["row", "owner", "security", "filing"].includes(fact.scope)) {
      errors.push(`${itemPath}.scope is invalid`);
    }
    const hasOwner = Object.hasOwn(fact, "owner");
    const ownerChoice = hasOwner ? strictId(fact.owner) : null;
    const owner = ownerChoice ? contract.owners.find((candidate) => candidate.owner === ownerChoice) : null;
    if (hasOwner && !ownerChoice) errors.push(`${itemPath}.owner must be a non-empty selection reference`);
    if (ownerChoice && !owner) errors.push(`${itemPath}.owner is not an allowed owner choice`);
    const hasSecurity = Object.hasOwn(fact, "security");
    const securityChoice = hasSecurity ? strictId(fact.security) : null;
    const security = securityChoice && contract.rowSecurity?.security === securityChoice ? contract.rowSecurity : null;
    if (hasSecurity && !securityChoice) errors.push(`${itemPath}.security must be a non-empty selection reference`);
    if (securityChoice && !security) errors.push(`${itemPath}.security is not the row security choice`);
    if (fact.scope === "owner" && !owner) errors.push(`${itemPath}.owner is required for owner scope`);
    if (fact.scope === "owner" && hasSecurity) errors.push(`${itemPath}.security is not allowed for owner scope`);
    if (fact.scope === "security" && !security) errors.push(`${itemPath}.security is required for security scope`);
    if (fact.scope === "security" && hasOwner) errors.push(`${itemPath}.owner is not allowed for security scope`);
    const canonicalOwner = fact.scope === "owner" ? owner : null;
    const canonicalSecurity = fact.scope === "security" ? security : null;
    const identity = `${footnoteChoice ?? ""}:${fact.scope ?? ""}:${canonicalOwner?.owner ?? ""}:${canonicalSecurity?.security ?? ""}`;
    const duplicate = seen.has(identity);
    seen.add(identity);
    const supplementalEvidence = Object.hasOwn(fact, "evidence")
      ? resolveSelectionEvidence(
          fact.evidence,
          contract,
          [contract.row, ...contract.footnotes.map((item) => item.footnote)],
          `${itemPath}.evidence`,
          errors,
        )
      : undefined;
    const evidence = footnoteChoice
      ? resolveSelectionEvidence([footnoteChoice], contract, [footnoteChoice], `${itemPath}.footnote`, errors)
      : null;
    if (duplicate) return [];
    return footnote && evidence && supplementalEvidence !== null
      && typeof fact.scope === "string" && ["row", "owner", "security", "filing"].includes(fact.scope)
      ? [{ fact: "footnote_scope", status: "supported", value: fact.scope,
          ...(canonicalOwner ? { owner_ref: canonicalOwner.canonicalOwnerRef } : {}),
          ...(canonicalSecurity ? { security_ref: canonicalSecurity.canonicalSecurityRef } : {}), ...evidence }]
      : [];
  });
}

function resolveSelectionEvidence(
  value: unknown,
  contract: OwnershipContextLlmRowContract,
  allowedChoices: readonly string[],
  path: string,
  errors: string[],
): ({ evidence_refs: string[]; footnote_ref?: string; footnote_refs?: string[] } | null) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must contain at least one selection reference`);
    return null;
  }
  const choices: string[] = [];
  for (const [index, item] of value.entries()) {
    const choice = strictId(item);
    if (!choice) {
      errors.push(`${path}[${index}] must be a non-empty selection reference`);
      continue;
    }
    if (!allowedChoices.includes(choice)) {
      errors.push(`${path}[${index}] contains a reference not allowed for this row and fact`);
      continue;
    }
    if (!choices.includes(choice)) choices.push(choice);
  }
  if (choices.length === 0 || choices.length !== new Set(value).size) {
    return null;
  }
  if (contract.canonicalEvidenceRefs.length !== 1) {
    errors.push(`${path} has no unique canonical evidence binding`);
    return null;
  }
  const footnotes = choices
    .map((choice) => contract.footnotes.find((item) => item.footnote === choice))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const canonicalFootnoteRefs = footnotes.map((item) => item.canonicalFootnoteRef);
  return {
    evidence_refs: [contract.canonicalEvidenceRefs[0]],
    ...(canonicalFootnoteRefs.length === 1 ? { footnote_ref: canonicalFootnoteRefs[0] } : {}),
    ...(canonicalFootnoteRefs.length > 1 ? { footnote_refs: canonicalFootnoteRefs } : {}),
  };
}

function llmStrictRecord(value: unknown, path: string, allowedKeys: readonly string[], errors: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const row = value as Row;
  const allowed = new Set(allowedKeys);
  const extras = Object.keys(row).filter((key) => !allowed.has(key));
  if (extras.length > 0) errors.push(`${path} contains unknown keys: ${extras.join(", ")}`);
  return row;
}

function strictId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.trim() === value ? value : null;
}

export function buildOwnershipContextAiTraceRows(input: OwnershipContextAiTraceInput) {
  const userPayload = JSON.parse(input.prompt.user) as NeutralOwnershipContextPromptInput;
  const semanticPromptSha256 = sha256Json(input.semanticPromptRules);
  const wireContractSha256 = sha256Json(input.prompt.responseFormat.json_schema);
  const neutralSourceBlocksSha256 = sha256Json(userPayload.neutral_source_blocks);
  const neutralInventorySha256 = sha256Json(userPayload.choices);
  const finalPromptSha256 = sha256Json(input.prompt);
  return {
    run: {
      id: input.runId,
      event_id: input.eventId,
      raw_item_id: input.rawItemId,
      prompt_key: OWNERSHIP_CONTEXT_AI_PROMPT_KEY,
      prompt_version: OWNERSHIP_CONTEXT_AI_PROMPT_VERSION,
      model: input.model,
      status: input.run.ok ? "completed" : "failed",
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      usage: input.run.usage || {},
      error_message: input.run.ok ? null : input.run.error || "Ownership context provider request failed",
      metadata: {
        purpose: OWNERSHIP_CONTEXT_AI_PURPOSE,
        provider: "gemini",
        provider_contract_version: OWNERSHIP_CONTEXT_LLM_VERSION,
        canonical_contract_version: OWNERSHIP_CONTEXT_VERSION,
        semantic_prompt_route: input.semanticPromptRoute,
        semantic_prompt_version: OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION,
        semantic_prompt_sha256: semanticPromptSha256,
        wire_contract_version: OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION,
        wire_contract_sha256: wireContractSha256,
        neutral_source_blocks_version: OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION,
        neutral_source_blocks_sha256: neutralSourceBlocksSha256,
        neutral_inventory_version: OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION,
        neutral_inventory_sha256: neutralInventorySha256,
        final_prompt_sha256: finalPromptSha256,
        provider_response_id: input.run.responseId,
        provider_http_status: input.run.status,
      },
    },
    output: {
      id: input.outputId,
      ai_run_id: input.runId,
      event_id: input.eventId,
      output_type: OWNERSHIP_CONTEXT_VERSION,
      payload: {
        purpose: OWNERSHIP_CONTEXT_AI_PURPOSE,
        provider_contract_version: OWNERSHIP_CONTEXT_LLM_VERSION,
        canonical_contract_version: OWNERSHIP_CONTEXT_VERSION,
        output_text: input.run.outputText,
        parsed_output: input.parsedOutput,
        mapped_canonical_output: input.mappedCanonicalOutput,
        mapping_errors: input.mappingErrors,
        response_ok: input.run.responseOk,
        usage: input.run.usage,
        request: {
          semantic_prompt_route: input.semanticPromptRoute,
          semantic_prompt_version: OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION,
          semantic_prompt_sha256: semanticPromptSha256,
          wire_contract_version: OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION,
          wire_contract_sha256: wireContractSha256,
          neutral_source_blocks_version: OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION,
          neutral_source_blocks_sha256: neutralSourceBlocksSha256,
          neutral_inventory_version: OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION,
          neutral_inventory_sha256: neutralInventorySha256,
          final_prompt_sha256: finalPromptSha256,
          system: input.prompt.system,
          user: input.prompt.user,
          response_mode: "application/json",
          response_format: input.prompt.responseFormat,
          provider_response_schema: null,
          max_output_tokens: input.maxOutputTokens,
        },
      },
    },
  } as const;
}

export function buildOwnershipSemanticVerifierTraceRows(input: OwnershipSemanticVerifierTraceInput) {
  const effectiveContexts = input.effectiveStructuredCandidate.rows
    .filter((row) => row.assertions.length > 0)
    .map((row) => ({ row_ref: row.row_ref, assertions: row.assertions }));
  return {
    run: {
      id: input.runId,
      event_id: input.eventId,
      raw_item_id: input.rawItemId,
      prompt_key: OWNERSHIP_SEMANTIC_VERIFIER_PURPOSE,
      prompt_version: OWNERSHIP_SEMANTIC_VERIFIER_VERSION,
      model: input.verifierName,
      status: "completed",
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      usage: {},
      error_message: null,
      metadata: {
        purpose: OWNERSHIP_SEMANTIC_VERIFIER_PURPOSE,
        contract_version: OWNERSHIP_SEMANTIC_VERIFIER_VERSION,
        source_analysis_refs: input.sourceAnalysisRefs,
        target_count: input.records.length,
        eligible_count: input.records.filter((record) => record.eligibility === "eligible").length,
        ineligible_count: input.records.filter((record) => record.eligibility === "ineligible").length,
      },
    },
    output: {
      id: input.outputId,
      ai_run_id: input.runId,
      event_id: input.eventId,
      output_type: OWNERSHIP_CONTEXT_VERSION,
      payload: {
        purpose: OWNERSHIP_SEMANTIC_VERIFIER_PURPOSE,
        contract_version: OWNERSHIP_SEMANTIC_VERIFIER_VERSION,
        source_analysis_refs: input.sourceAnalysisRefs,
        original_structured_candidate: input.originalStructuredCandidate,
        verifications: input.records,
        effective_contexts: effectiveContexts,
      },
    },
  } as const;
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function verifyOriginalOwnershipSource(input: Readonly<{
  rawItem: unknown;
  expectedRawItemId: string;
  expectedAccession: string;
  expectedForm: "form4" | "form144";
  rows: readonly Row[];
}>):
  | Readonly<{
      ok: true;
      xml: string;
      form: string;
      accessionNumber: string;
      issuerCik: string;
      issuerTradingSymbol: string | null;
      issuerName: string | null;
      reportingOwners: readonly Readonly<{ cik: string | null; name: string }>[];
    }>
  | Readonly<{ ok: false; reason: string }> {
  const raw = record(input.rawItem);
  const payload = record(raw.raw_payload);
  const xml = typeof payload.ownership_source_text === "string" ? payload.ownership_source_text : "";
  const accession = exactString(payload.accession_number) || exactString(raw.source_unique_id);
  const form = exactString(payload.form_type);
  const normalizedForm = normalizeForm(form);
  if (exactString(raw.id) !== input.expectedRawItemId) return { ok: false, reason: "ownership_context_raw_item_mismatch" };
  if (exactString(raw.source_code) !== "sec_edgar") return { ok: false, reason: "ownership_context_source_code_invalid" };
  if (!xml || payload.ownership_source_text_truncated === true || payload.ownership_source_format !== "ownership_xml") {
    return { ok: false, reason: "ownership_context_original_xml_unavailable" };
  }
  if (accession !== input.expectedAccession || exactString(raw.source_unique_id) !== accession) {
    return { ok: false, reason: "ownership_context_accession_mismatch" };
  }
  if (normalizedForm !== input.expectedForm) return { ok: false, reason: "ownership_context_form_mismatch" };
  if (!officialSecSourceForAccession(payload.ownership_source_url, accession)) {
    return { ok: false, reason: "ownership_context_source_url_untrusted" };
  }
  const expectedRoot = input.expectedForm === "form4" ? "ownershipDocument" : "edgarSubmission";
  const rootTag = `(?:[A-Za-z_][\\w.-]*:)?${expectedRoot}`;
  if (!new RegExp(`<${rootTag}\\b[^>]*>[\\s\\S]*<\\/${rootTag}>`, "i").test(xml)) {
    return { ok: false, reason: "ownership_context_xml_root_invalid" };
  }
  const xmlSha256 = createHash("sha256").update(xml, "utf8").digest("hex");
  if (input.rows.some((row) => exactString(record(row.provenance).source_xml_sha256) !== xmlSha256)) {
    return { ok: false, reason: "ownership_context_source_hash_mismatch" };
  }
  const issuerCik = readXmlValue(xml, "issuerCik");
  if (!issuerCik) return { ok: false, reason: "ownership_context_issuer_identity_unavailable" };
  const reportingOwners = readXmlReportingOwners(xml, input.expectedForm);
  if (
    reportingOwners.length === 0
    || input.rows.some((row) => !sameStringArray(row.reporting_owner_names, reportingOwners.map((owner) => owner.name)))
  ) {
    return { ok: false, reason: "ownership_context_owner_reference_mapping_invalid" };
  }
  return {
    ok: true,
    xml,
    form,
    accessionNumber: accession,
    issuerCik,
    issuerTradingSymbol: readXmlValue(xml, "issuerTradingSymbol"),
    issuerName: readXmlValue(xml, "issuerName"),
    reportingOwners,
  };
}

function parseProviderOutput(outputText: string): Row | null {
  if (!outputText) return null;
  try {
    const value = parseJsonWithoutDuplicateKeys(outputText);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readXmlValue(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const value = xml.match(new RegExp(`<${tag}\\b[^>]*>\\s*(?:<(?:[A-Za-z_][\\w.-]*:)?value\\b[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/(?:[A-Za-z_][\\w.-]*:)?value>)?\\s*<\\/${tag}>`, "i"))?.[1];
  return value ? decodeXml(value.trim()) || null : null;
}

function readXmlReportingOwners(xml: string, form: "form4" | "form144") {
  if (form === "form144") {
    return readXmlValues(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold")
      .map((name) => ({ cik: null, name }));
  }
  const ownerTag = "(?:[A-Za-z_][\\w.-]*:)?reportingOwner";
  return Array.from(xml.matchAll(new RegExp(`<${ownerTag}\\b[^>]*>([\\s\\S]*?)<\\/${ownerTag}>`, "gi")))
    .map((match) => {
      const block = match[1] || "";
      return {
        cik: readXmlValue(block, "rptOwnerCik"),
        name: readXmlValue(block, "rptOwnerName") || "",
      };
    })
    .filter((owner) => Boolean(owner.name));
}

function readXmlValues(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "gi")))
    .map((match) => decodeXml((match[1] || "").trim()))
    .filter(Boolean);
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function normalizeForm(value: string): "form4" | "form144" | null {
  const form = value.toUpperCase().replace(/^FORM\s+/, "");
  if (form === "4" || form === "4/A") return "form4";
  if (form === "144" || form === "144/A") return "form144";
  return null;
}

function officialSecSourceForAccession(value: unknown, accession: string) {
  try {
    const url = new URL(exactString(value));
    const archive = url.pathname.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})(?:\/|$)/i);
    return url.protocol === "https:"
      && (url.hostname.toLowerCase() === "sec.gov" || url.hostname.toLowerCase().endsWith(".sec.gov"))
      && archive?.[1] === accession.replace(/-/g, "");
  } catch {
    return false;
  }
}

async function runProviderWithTimeout(input: Readonly<{
  apiKey: string;
  model: string;
  prompt: StructuredJsonPrompt;
  maxOutputTokens: number;
  timeoutMs: number;
  runPrompt?: typeof runStructuredGeminiJson;
  fetchImpl: typeof fetch;
}>): Promise<GeminiStructuredJsonRun> {
  const controller = new AbortController();
  const runner = input.runPrompt ?? runStructuredGeminiJson;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const runPromise = Promise.resolve()
    .then(() => runner({
      apiKey: input.apiKey,
      model: input.model,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.runPrompt ? {} : {
        fetchImpl: ((request, init) => input.fetchImpl(request, { ...init, signal: controller.signal })) as typeof fetch,
      }),
    }))
    .catch((error) => failedProviderRun(input.model, errorMessage(error, "Ownership context provider execution failed")));
  const timeoutPromise = new Promise<GeminiStructuredJsonRun>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort(new Error("Ownership context Gemini request timed out"));
      resolve(failedProviderRun(input.model, "Ownership context Gemini request timed out"));
    }, Math.max(1, input.timeoutMs));
  });
  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function failedProviderRun(model: string, error: string): GeminiStructuredJsonRun {
  return {
    ok: false,
    responseOk: false,
    status: 0,
    statusText: "",
    model,
    responseId: null,
    outputText: "",
    parsed: null,
    usage: null,
    error,
    body: null,
  };
}

async function defaultRepository(): Promise<OwnershipStructuredContextAnalyzerRepository> {
  const supabase = await import("../supabase.ts");
  return {
    select: supabase.supabaseSelect,
    readContextSnapshot: (eventId) => supabase.supabaseRpc(
      "read_event_ownership_context_snapshot",
      { p_event_id: eventId },
    ),
    persistContext: (input) => supabase.supabaseRpc("persist_event_ownership_context", {
      p_event_id: input.eventId,
      p_form: input.form,
      p_source_fingerprint: input.sourceFingerprint,
      p_contexts: input.contexts,
      p_ai_run_id: input.aiRefs?.run_id ?? null,
      p_ai_output_id: input.aiRefs?.output_id ?? null,
    }),
    async persistAiTrace(input) {
      const trace = buildOwnershipContextAiTraceRows(input);
      const runResult = await supabase.supabaseUpsert("ai_runs", trace.run, { onConflict: "id" });
      assertRepositoryWrite(runResult, "ownership context ai run");
      const outputResult = await supabase.supabaseUpsert("ai_outputs", trace.output, { onConflict: "id" });
      assertRepositoryWrite(outputResult, "ownership context ai output");
    },
    async persistSemanticVerifierTrace(input) {
      const trace = buildOwnershipSemanticVerifierTraceRows(input);
      const runResult = await supabase.supabaseUpsert("ai_runs", trace.run, { onConflict: "id" });
      assertRepositoryWrite(runResult, "ownership semantic verifier ai run");
      const outputResult = await supabase.supabaseUpsert("ai_outputs", trace.output, { onConflict: "id" });
      assertRepositoryWrite(outputResult, "ownership semantic verifier ai output");
    },
  };
}

function assertRepositoryWrite(result: Readonly<{ ok: boolean; status?: number; error?: string }>, label: string) {
  if (!result.ok) throw new Error(`Could not persist ${label}: ${result.error || result.status || 0}`);
}

function unavailable(
  eventId: string,
  stage: Extract<OwnershipStructuredContextAnalysisResult, { status: "unavailable" }>["stage"],
  reason: string,
  extra: Partial<Omit<Extract<OwnershipStructuredContextAnalysisResult, { status: "unavailable" }>, "status" | "stage" | "reason" | "eventId">> = {},
): Extract<OwnershipStructuredContextAnalysisResult, { status: "unavailable" }> {
  return { status: "unavailable", stage, reason, eventId, ...extra };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function exactString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => typeof item === "string" && item.trim() === expected[index]);
}

function readNeutralXmlRowLocators(xml: string, form: "form4" | "form144") {
  if (form === "form144") {
    return Array.from(xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?securitiesInformation\b/gi)).map((_match, ordinal) => ({
      element: "securitiesInformation",
      ordinal,
    }));
  }
  const nonDerivative = Array.from(xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?nonDerivativeTransaction\b/gi)).map(
    (_match, ordinal) => ({ element: "nonDerivativeTransaction", ordinal }),
  );
  const derivative = Array.from(xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?derivativeTransaction\b/gi)).map(
    (_match, ordinal) => ({ element: "derivativeTransaction", ordinal }),
  );
  return [...nonDerivative, ...derivative];
}

function readNeutralXmlRowBlocks(xml: string, form: "form4" | "form144") {
  const blocks = (localName: string) => {
    const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
    return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi")))
      .map((match) => match[0] || "");
  };
  return form === "form144"
    ? blocks("securitiesInformation")
    : [...blocks("nonDerivativeTransaction"), ...blocks("derivativeTransaction")];
}

function readNeutralXmlFootnoteBindings(xml: string) {
  return Array.from(xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?footnote\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?footnote>/gi,
  )).map((match) => ({
    footnote_ref: `footnote:${decodeXml(match[1] || "")}`,
    xml_id: decodeXml(match[1] || ""),
    xml_text_raw: match[2] || "",
  }));
}

function readNeutralXmlRowFootnoteRefs(
  rowBlock: string,
  footnotes: readonly Readonly<{ footnote_ref: string; xml_id: string }>[],
) {
  const availableIds = new Set(footnotes.map((footnote) => footnote.xml_id));
  return [...new Set(Array.from(rowBlock.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?footnoteId\b[^>]*\bid=["']([^"']+)["']/gi,
  )).map((match) => decodeXml(match[1] || "")).filter((xmlId) => availableIds.has(xmlId)))]
    .map((xmlId) => `footnote:${xmlId}`);
}

function readNeutralXmlReportingOwners(xml: string, form: "form4" | "form144") {
  if (form === "form144") {
    const name = readNeutralXmlLeafText(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold");
    return name ? [{ cik: null, name }] : [];
  }
  const ownerTag = "(?:[A-Za-z_][\\w.-]*:)?reportingOwner";
  return Array.from(xml.matchAll(new RegExp(`<${ownerTag}\\b[^>]*>([\\s\\S]*?)<\\/${ownerTag}>`, "gi")))
    .map((match) => ({
      cik: readNeutralXmlLeafText(match[1] || "", "rptOwnerCik"),
      name: readNeutralXmlLeafText(match[1] || "", "rptOwnerName") || "",
    }))
    .filter((owner) => Boolean(owner.name));
}

function readNeutralXmlLeafText(xml: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const text = xml.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1];
  return text === undefined ? null : decodeXml(text);
}

function readNeutralXmlTitleTextRaw(
  rowBlock: string,
  form: "form4" | "form144",
  role: "row_security" | "underlying_security",
) {
  const localName = role === "underlying_security"
    ? "underlyingSecurityTitle"
    : form === "form144" ? "securitiesClassTitle" : "securityTitle";
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const outer = rowBlock.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
  const valueTag = "(?:[A-Za-z_][\\w.-]*:)?value";
  return outer.match(new RegExp(`<${valueTag}\\b[^>]*>([\\s\\S]*?)<\\/${valueTag}>`, "i"))?.[1] ?? outer;
}

function record(value: unknown): Row {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
