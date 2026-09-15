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
  OWNERSHIP_CONTEXT_STATUSES,
  OWNERSHIP_CONTEXT_VERSION,
  OWNERSHIP_CONTEXT_AI_PROMPT_KEY,
  OWNERSHIP_CONTEXT_AI_PROMPT_VERSION,
  OWNERSHIP_CONTEXT_AI_PURPOSE,
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
  type OwnershipContextFact,
  type OwnershipContextReferenceInventory,
  type OwnershipContextStatus,
  type ValidatedOwnershipContextBundle,
} from "./ownershipStructuredContext.ts";
import {
  routeOwnershipSemanticPrompt,
  routeOwnershipSemanticPromptFromInventory,
  type OwnershipSemanticPromptRoute,
  type RoutedOwnershipSemanticPrompt,
} from "./ownershipSemanticPrompts/router.ts";

type Row = Record<string, unknown>;
export const OWNERSHIP_CONTEXT_LLM_VERSION = "ownership_context_llm_v1" as const;
export const OWNERSHIP_CONTEXT_SEMANTIC_PROMPT_VERSION = "ownership_context_semantic_v1.1-form-routing" as const;
export const OWNERSHIP_CONTEXT_WIRE_CONTRACT_VERSION = "ownership_context_llm_wire_v1.1-required-supported-values" as const;
export const OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION = "ownership_context_neutral_inventory_v1.1-xml-bindings" as const;

const OWNERSHIP_CONTEXT_LLM_FACT_FIELDS = [
  "owner_attribution",
  "owner_relations",
  "economic_direction",
  "derivative_underlying_relation",
  "rule_10b5_1",
  "footnote_scopes",
  "amendment_effect",
] as const;

type OwnershipContextLlmFactField = typeof OWNERSHIP_CONTEXT_LLM_FACT_FIELDS[number];
type OwnershipContextLlmRowContract = Readonly<{
  rowId: string;
  allowedFactFields: readonly OwnershipContextLlmFactField[];
  securityId: string | null;
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
    }>
  | Readonly<{
      status: "unavailable";
      stage: "direct_facts" | "source" | "configuration" | "provider" | "trace" | "validation" | "persistence";
      reason: string;
      eventId: string;
      runId?: string;
      outputId?: string;
      model?: string;
      validationErrors?: readonly string[];
    }>;

type NeutralOwnershipContextPromptInput = Readonly<{
  original_sec_ownership_xml: string;
  form: string;
  accession_number: string;
  issuer_identity: Readonly<{
    cik: string;
    trading_symbol: string | null;
    name: string | null;
  }>;
  reference_inventory: Readonly<{
    version: typeof OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION;
    rows: readonly Readonly<{
      row_id: string;
      xml_row_ordinal: number;
      xml_locator: Readonly<{ element: string; ordinal: number }>;
      allowed_fact_fields: readonly OwnershipContextLlmFactField[];
      owner_ids: readonly string[];
      owner_xml_bindings: readonly Readonly<{
        owner_id: string;
        xml_reporting_owner_ordinal: number;
        xml_cik: string | null;
        xml_name: string;
      }>[];
      security_id: string | null;
      linked_footnote_refs: readonly string[];
      security_xml_bindings: readonly Readonly<{
        security_id: string;
        role: "row_security" | "underlying_security";
        xml_locator: Readonly<{ element: string; ordinal: number }>;
        xml_title_text_raw: string;
      }>[];
      evidence_ids: readonly string[];
      evidence_xml_bindings: readonly Readonly<{
        evidence_id: string;
        canonical_evidence_ordinal: number;
        xml_locator: Readonly<{ element: string; ordinal: number }>;
      }>[];
    }>[];
    footnotes: readonly Readonly<{ footnote_ref: string; xml_id: string; xml_text_raw: string }>[];
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
  try {
    const persisted = await persistOwnershipStructuredContext({
      eventId: input.eventId,
      candidate: mapping.value,
      aiRefs: { run_id: runId, output_id: outputId },
    }, repository);
    return {
      status: persisted.status,
      eventId: input.eventId,
      runId,
      outputId,
      model,
      updatedRowCount: persisted.updatedRowCount,
      validated: persisted.validated,
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
  const applicableFactFields = Object.freeze([
    ...new Set(rowContracts.flatMap((contract) => contract.allowedFactFields)),
  ]);
  const outputContract = buildOwnershipStructuredContextResponseSchema(input.inventory, applicableFactFields);
  const rowLocators = readNeutralXmlRowLocators(input.source.xml, input.inventory.form);
  const rowBlocks = readNeutralXmlRowBlocks(input.source.xml, input.inventory.form);
  const footnoteBindings = readNeutralXmlFootnoteBindings(input.source.xml);
  const ownerBindings = readNeutralXmlReportingOwners(input.source.xml, input.inventory.form);
  const linkedFootnoteRefsByRow = rowBlocks.map((rowBlock) => readNeutralXmlRowFootnoteRefs(rowBlock, footnoteBindings));
  if (footnoteBindings.length !== input.inventory.footnotes.length
    || footnoteBindings.some((binding, index) => binding.footnote_ref !== input.inventory.footnotes[index]?.footnoteRef)) {
    throw new Error("ownership_context_neutral_footnote_inventory_mismatch");
  }
  if (input.inventory.rows.some((row) => row.ownerRefs.length !== ownerBindings.length)) {
    throw new Error("ownership_context_neutral_owner_inventory_mismatch");
  }
  const neutralInput: NeutralOwnershipContextPromptInput = {
    original_sec_ownership_xml: input.source.xml,
    form: input.source.form,
    accession_number: input.source.accessionNumber,
    issuer_identity: {
      cik: input.source.issuerCik,
      trading_symbol: input.source.issuerTradingSymbol,
      name: input.source.issuerName,
    },
    reference_inventory: {
      version: OWNERSHIP_CONTEXT_NEUTRAL_INVENTORY_VERSION,
      rows: input.inventory.rows.map((row, rowIndex) => ({
        row_id: row.rowRef,
        xml_row_ordinal: rowIndex,
        xml_locator: rowLocators[rowIndex],
        allowed_fact_fields: rowContracts[rowIndex].allowedFactFields,
        owner_ids: row.ownerRefs,
        owner_xml_bindings: row.ownerRefs.map((ownerRef, ownerIndex) => ({
          owner_id: ownerRef,
          xml_reporting_owner_ordinal: ownerIndex,
          xml_cik: ownerBindings[ownerIndex].cik,
          xml_name: ownerBindings[ownerIndex].name,
        })),
        security_id: row.securityRef,
        linked_footnote_refs: linkedFootnoteRefsByRow[rowIndex],
        security_xml_bindings: [
          ...(row.securityRef ? [{
            security_id: row.securityRef,
            role: "row_security" as const,
            xml_locator: { element: `${rowLocators[rowIndex].element}.securityTitle`, ordinal: 0 },
            xml_title_text_raw: readNeutralXmlTitleTextRaw(rowBlocks[rowIndex], input.inventory.form, "row_security"),
          }] : []),
          ...row.underlyingSecurityRefs.map((securityId, underlyingIndex) => ({
            security_id: securityId,
            role: "underlying_security" as const,
            xml_locator: { element: `${rowLocators[rowIndex].element}.underlyingSecurity`, ordinal: underlyingIndex },
            xml_title_text_raw: readNeutralXmlTitleTextRaw(rowBlocks[rowIndex], input.inventory.form, "underlying_security"),
          })),
        ],
        evidence_ids: row.evidenceRefs,
        evidence_xml_bindings: row.evidenceRefs.map((evidenceRef, evidenceIndex) => ({
          evidence_id: evidenceRef,
          canonical_evidence_ordinal: evidenceIndex,
          xml_locator: rowLocators[rowIndex],
        })),
      })),
      footnotes: footnoteBindings,
    },
    output_contract: outputContract,
    output_example: {
      note: "Empty-result shape only. The supplied output_contract and each row's allowed_fact_fields are authoritative for every non-empty result.",
      version: OWNERSHIP_CONTEXT_LLM_VERSION,
      rows: [],
    },
  };

  return {
    system: [
      ...semanticRoute.systemRules,
      "Read only the supplied original SEC ownership XML and neutral opaque reference inventory.",
      "Return JSON that conforms exactly to the supplied output_contract; that contract is authoritative for field names, array shapes, required members, statuses, reference fields, and empty or partial results.",
      "Every supported fact must include its contract-required typed value and at least one evidence_id. If uncertain, omit the fact or use a non-supported status without a typed value.",
      "Do not use any field absent from output_contract or from the selected row's allowed_fact_fields. The server binds event, canonical form, and source fingerprint after parsing.",
      "Use only opaque references supplied for that row or its mechanically linked footnotes; never copy locator or binding objects into output.",
      "Use supported only when the original XML directly supports the typed attribute and at least one supplied evidence_id. Use ambiguous, conflict, or unresolved without that typed attribute when support is insufficient; never return null.",
      "Do not return shares, prices, numeric or monetary amounts, dates, tickers, transaction codes, A/D codes, scores, or narrative analysis.",
      "Never invent or transform any row, owner, security, evidence, or footnote ID.",
    ].join(" "),
    user: JSON.stringify(neutralInput),
    responseFormat: { json_schema: outputContract },
  };
}

export function buildOwnershipStructuredContextResponseSchema(
  inventory: OwnershipContextReferenceInventory,
  applicableFactFields?: readonly OwnershipContextLlmFactField[],
) {
  const rowRefs = inventory.rows.map((row) => row.rowRef);
  const semanticRoute = routeOwnershipSemanticPromptFromInventory(inventory);
  const applicable = applicableFactFields ? new Set(applicableFactFields) : null;
  const outputFactFields = semanticRoute.outputFactFields.filter((field) => {
    if (applicable) return applicable.has(field);
    if (field === "owner_attribution") return inventory.rows.some((row) => row.ownerRefs.length > 0);
    if (field === "footnote_scopes") return inventory.rows.some((row) => row.linkedFootnoteRefs.length > 0);
    if (field === "amendment_effect") return inventory.isAmendment;
    return true;
  });
  const factSchemas: Record<Exclude<OwnershipContextLlmFactField, "economic_direction">, Record<string, unknown>> = {
    owner_attribution: llmFactSchema("owner_id", { type: "string" }),
    owner_relations: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: llmFactSchema(
        "relation",
        { type: "string", enum: ["direct", "indirect"] },
        ["owner_id", "footnote_ref"],
        ["owner_id"],
      ),
    },
    derivative_underlying_relation: llmFactSchema(
      "target_security_id",
      { type: "string" },
      ["source_security_id", "footnote_ref"],
      ["source_security_id"],
    ),
    rule_10b5_1: llmFactSchema(
      "applies",
      { type: "boolean" },
      ["owner_id", "security_id", "footnote_ref"],
      [],
      [{
        if: {
          required: ["status", "applies"],
          properties: { status: { const: "supported" }, applies: { const: true } },
        },
        then: { required: ["footnote_ref"] },
      }],
    ),
    footnote_scopes: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: llmFactSchema(
        "scope",
        { type: "string", enum: ["row", "owner", "security", "filing"] },
        ["owner_id", "security_id", "footnote_ref"],
        ["footnote_ref"],
        [
          {
            if: {
              required: ["status", "scope"],
              properties: { status: { const: "supported" }, scope: { const: "owner" } },
            },
            then: { required: ["owner_id"] },
          },
          {
            if: {
              required: ["status", "scope"],
              properties: { status: { const: "supported" }, scope: { const: "security" } },
            },
            then: { required: ["security_id"] },
          },
        ],
      ),
    },
    amendment_effect: llmFactSchema("effect", { type: "string", enum: ["adds", "modifies", "removes", "restates", "no_change"] }),
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["version", "rows"],
    properties: {
      version: { type: "string", enum: [OWNERSHIP_CONTEXT_LLM_VERSION] },
      rows: {
        type: "array",
        minItems: 0,
        maxItems: inventory.rows.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["row_id"],
          properties: {
            row_id: { type: "string", enum: rowRefs },
            ...Object.fromEntries(outputFactFields.map((field) => [field, factSchemas[field]])),
          },
        },
      },
    },
  } satisfies Record<string, unknown>;
}

function llmFactSchema(
  attribute: string,
  attributeSchema: Record<string, unknown>,
  subjectIds: readonly string[] = [],
  requiredSubjectIds: readonly string[] = [],
  additionalConditions: readonly Record<string, unknown>[] = [],
) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "evidence_ids", ...requiredSubjectIds],
    properties: {
      status: { type: "string", enum: [...OWNERSHIP_CONTEXT_STATUSES] },
      [attribute]: attributeSchema,
      ...Object.fromEntries(subjectIds.map((key) => [key, { type: "string" }])),
      evidence_ids: { type: "array", items: { type: "string" } },
    },
    allOf: [
      {
        if: {
          required: ["status"],
          properties: { status: { const: "supported" } },
        },
        then: {
          required: [attribute],
          properties: { evidence_ids: { minItems: 1 } },
        },
        else: { not: { required: [attribute] } },
      },
      ...additionalConditions,
    ],
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
  const contractById = new Map(contracts.map((contract) => [contract.rowId, contract]));
  const seenRows = new Set<string>();
  if (Array.isArray(root.rows)) root.rows.forEach((rowValue, rowIndex) => {
    const path = `ownership_context_llm.rows[${rowIndex}]`;
    const row = llmStrictRecord(rowValue, path, ["row_id", ...OWNERSHIP_CONTEXT_LLM_FACT_FIELDS], errors);
    if (!row) return;
    const rowId = strictId(row.row_id);
    const contract = rowId ? contractById.get(rowId) : undefined;
    if (!rowId || !contract) {
      errors.push(`${path}.row_id does not reference a current row`);
      return;
    }
    if (seenRows.has(rowId)) errors.push(`${path}.row_id is duplicated`);
    seenRows.add(rowId);
    const allowed = new Set(contract.allowedFactFields);
    const presentFields = OWNERSHIP_CONTEXT_LLM_FACT_FIELDS.filter((field) => Object.hasOwn(row, field));
    for (const field of OWNERSHIP_CONTEXT_LLM_FACT_FIELDS) {
      if (Object.hasOwn(row, field) && !allowed.has(field)) errors.push(`${path}.${field} is not applicable to this XML row`);
    }
    const assertions: Row[] = [];
    for (const field of contract.allowedFactFields) {
      if (!Object.hasOwn(row, field)) continue;
      const fieldValue = row[field];
      if (field === "owner_relations" || field === "footnote_scopes") {
        const maximum = field === "owner_relations" ? 16 : 32;
        if (!Array.isArray(fieldValue) || fieldValue.length === 0 || fieldValue.length > maximum) {
          errors.push(`${path}.${field} must contain between one and ${maximum} items`);
          continue;
        }
        fieldValue.forEach((item, itemIndex) => {
          const assertion = mapLlmFact(field, item, `${path}.${field}[${itemIndex}]`, errors);
          if (assertion) assertions.push(assertion);
        });
        continue;
      }
      const assertion = mapLlmFact(field, fieldValue, `${path}.${field}`, errors);
      if (assertion) assertions.push(assertion);
    }
    mappedRows.push({ row_ref: rowId, assertions });
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
  const rowLocators = readNeutralXmlRowLocators(source.xml, inventory.form);
  const rowBlocks = readNeutralXmlRowBlocks(source.xml, inventory.form);
  if (rowLocators.length !== inventory.rows.length) throw new Error("ownership_context_neutral_row_inventory_mismatch");
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
  return Object.freeze(inventory.rows.map((row, rowIndex) => {
    const rowBlock = rowBlocks[rowIndex];
    const allowed: OwnershipContextLlmFactField[] = [];
    if (row.ownerRefs.length > 0) allowed.push("owner_attribution");
    if (inventory.form === "form4"
      && row.ownerRefs.length > 0
      && /<(?:[A-Za-z_][\w.-]*:)?directOrIndirectOwnership\b/i.test(rowBlock)) {
      allowed.push("owner_relations");
    }
    if (rowLocators[rowIndex].element.toLowerCase() === "derivativetransaction") {
      allowed.push("derivative_underlying_relation");
    }
    if (inventory.form === "form4"
      && (/<(?:[A-Za-z_][\w.-]*:)?aff10b5One\b/i.test(source.xml) || /10b5-?1/i.test(rowBlock))) {
      allowed.push("rule_10b5_1");
    }
    if (readNeutralXmlRowFootnoteRefs(rowBlock, footnoteBindings).length > 0) allowed.push("footnote_scopes");
    if (isAmendment) allowed.push("amendment_effect");
    return Object.freeze({
      rowId: row.rowRef,
      allowedFactFields: Object.freeze(allowed.filter((field) => routeFields.has(field))),
      securityId: row.securityRef,
    });
  }));
}

function mapLlmFact(
  field: OwnershipContextLlmFactField,
  value: unknown,
  path: string,
  errors: string[],
): Row | null {
  const definition = llmFactDefinition(field);
  const fact = llmStrictRecord(value, path, [
    "status", definition.attribute, ...definition.subjects, "footnote_ref", "evidence_ids",
  ], errors);
  if (!fact) return null;
  const status = typeof fact.status === "string" && OWNERSHIP_CONTEXT_STATUSES.includes(fact.status as OwnershipContextStatus)
    ? fact.status as OwnershipContextStatus
    : null;
  if (!status) errors.push(`${path}.status is invalid`);
  const evidenceIds = Array.isArray(fact.evidence_ids)
    && fact.evidence_ids.every((item) => typeof item === "string" && item.length > 0 && item.trim() === item)
    ? fact.evidence_ids as string[]
    : null;
  if (!evidenceIds) errors.push(`${path}.evidence_ids must contain only non-empty opaque ID strings`);
  const hasAttribute = Object.hasOwn(fact, definition.attribute);
  if (status === "supported" && !hasAttribute) errors.push(`${path}.${definition.attribute} is required when supported`);
  if (status && status !== "supported" && hasAttribute) errors.push(`${path}.${definition.attribute} must be omitted unless supported`);
  if (hasAttribute && !definition.accepts(fact[definition.attribute])) errors.push(`${path}.${definition.attribute} is invalid`);
  const subjects: Record<string, string> = {};
  for (const subject of definition.subjects) {
    if (!Object.hasOwn(fact, subject)) continue;
    const subjectId = strictId(fact[subject]);
    if (!subjectId) errors.push(`${path}.${subject} must be a non-empty opaque ID string`);
    else subjects[subject] = subjectId;
  }
  if (field === "derivative_underlying_relation" && !Object.hasOwn(fact, "source_security_id")) {
    errors.push(`${path}.source_security_id is required`);
  }
  if (field === "owner_relations" && !Object.hasOwn(fact, "owner_id")) {
    errors.push(`${path}.owner_id is required`);
  }
  if (field === "footnote_scopes" && !Object.hasOwn(fact, "footnote_ref")) {
    errors.push(`${path}.footnote_ref is required`);
  }
  const footnoteRef = Object.hasOwn(fact, "footnote_ref") ? strictId(fact.footnote_ref) : null;
  if (Object.hasOwn(fact, "footnote_ref") && !footnoteRef) {
    errors.push(`${path}.footnote_ref must be a non-empty opaque ID string`);
  }
  if (!status || !evidenceIds) return null;
  return {
    fact: definition.canonicalFact,
    status,
    ...(hasAttribute ? { value: fact[definition.attribute] } : {}),
    ...(subjects.owner_id ? { owner_ref: subjects.owner_id } : {}),
    ...(subjects.security_id ? { security_ref: subjects.security_id } : {}),
    ...(subjects.source_security_id ? { security_ref: subjects.source_security_id } : {}),
    ...(footnoteRef ? { footnote_ref: footnoteRef } : {}),
    evidence_refs: [...evidenceIds],
  };
}

function llmFactDefinition(field: OwnershipContextLlmFactField): Readonly<{
  canonicalFact: OwnershipContextFact;
  attribute: string;
  subjects: readonly string[];
  accepts(value: unknown): boolean;
}> {
  if (field === "owner_attribution") return {
    canonicalFact: "owner_attribution", attribute: "owner_id", subjects: [], accepts: (value) => Boolean(strictId(value)),
  };
  if (field === "owner_relations") return {
    canonicalFact: "ownership_relation", attribute: "relation", subjects: ["owner_id"],
    accepts: (value) => value === "direct" || value === "indirect",
  };
  if (field === "economic_direction") return {
    canonicalFact: "economic_direction", attribute: "direction", subjects: ["security_id"],
    accepts: (value) => value === "buy" || value === "sell" || value === "other",
  };
  if (field === "derivative_underlying_relation") return {
    canonicalFact: "derivative_underlying_relation", attribute: "target_security_id", subjects: ["source_security_id"],
    accepts: (value) => Boolean(strictId(value)),
  };
  if (field === "rule_10b5_1") return {
    canonicalFact: "rule_10b5_1_applicability", attribute: "applies", subjects: ["owner_id", "security_id"],
    accepts: (value) => typeof value === "boolean",
  };
  if (field === "footnote_scopes") return {
    canonicalFact: "footnote_scope", attribute: "scope", subjects: ["owner_id", "security_id"],
    accepts: (value) => typeof value === "string" && ["row", "owner", "security", "filing"].includes(value),
  };
  return {
    canonicalFact: "amendment_effect", attribute: "effect", subjects: [],
    accepts: (value) => typeof value === "string" && ["adds", "modifies", "removes", "restates", "no_change"].includes(value),
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
  const neutralInventorySha256 = sha256Json(userPayload.reference_inventory);
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
