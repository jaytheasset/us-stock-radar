import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "../ai/geminiStructuredJson.ts";
import {
  buildNaturalLanguageConditionCompilerPrompt,
  NATURAL_LANGUAGE_CONDITION_COMPILER_PROMPT_VERSION,
} from "../prompts/naturalLanguageConditionCompiler.ts";
import {
  validateCanonicalListingConditions,
  type CanonicalListingMonitorCondition,
} from "./listingMonitorPersistence.ts";

export const NATURAL_LANGUAGE_CONDITION_COMPILER_VERSION =
  "natural_language_condition_compiler_v1" as const;
export const NATURAL_LANGUAGE_CONDITION_TEXT_MAX_LENGTH = 1_000;

export type NaturalLanguageConditionCompilerStatus =
  | "VALID"
  | "UNSUPPORTED"
  | "AMBIGUOUS"
  | "CONTRADICTORY";

export type NaturalLanguageConditionRequirementDecision =
  | "mapped"
  | "unsupported"
  | "ambiguous";

export type NaturalLanguageConditionRequirement = Readonly<{
  id: string;
  source_text: string;
  decision: NaturalLanguageConditionRequirementDecision;
  condition_refs: readonly string[];
  reason: string | null;
  question: string | null;
}>;

export type NaturalLanguageConditionLedgerCondition = Readonly<{
  id: string;
  key: string;
  operator: CanonicalListingMonitorCondition["operator"];
  value: unknown;
}>;

export type NaturalLanguageConditionLedger = Readonly<{
  requirements: readonly NaturalLanguageConditionRequirement[];
  conditions: readonly NaturalLanguageConditionLedgerCondition[];
}>;

export type NaturalLanguageConditionCompilerResult = Readonly<{
  version: typeof NATURAL_LANGUAGE_CONDITION_COMPILER_VERSION;
  status: NaturalLanguageConditionCompilerStatus;
  ledger: NaturalLanguageConditionLedger;
  conditions: readonly CanonicalListingMonitorCondition[];
  unsupported: readonly Readonly<{ text: string; reason: string }>[];
  question: string | null;
  message: string;
}>;

export type NaturalLanguageConditionCompilerTelemetry = Readonly<{
  compilerVersion: typeof NATURAL_LANGUAGE_CONDITION_COMPILER_VERSION;
  promptVersion: typeof NATURAL_LANGUAGE_CONDITION_COMPILER_PROMPT_VERSION;
  model: string;
  logicalCalls: 1;
  physicalAttempts: 1;
  latencyMs: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}>;

export type NaturalLanguageConditionCompilerRun = Readonly<{
  result: NaturalLanguageConditionCompilerResult;
  telemetry: NaturalLanguageConditionCompilerTelemetry;
}>;

export type NaturalLanguageConditionCompilerRequestError = Readonly<{
  ok: false;
  status: 400 | 413;
  code: "CONDITION_COMPILER_REQUEST_INVALID" | "CONDITION_COMPILER_TEXT_TOO_LONG";
  message: string;
  errors: readonly string[];
}>;

type CompilerOptions = Readonly<{
  apiKey?: string;
  model?: string;
  runPrompt?: typeof runStructuredGeminiJson;
  now?: () => number;
}>;

type ProviderCondition = Readonly<{
  key: unknown;
  operator: unknown;
  value: unknown;
}>;

type ProviderRequirement = Readonly<{
  source_text: string;
  decision: NaturalLanguageConditionRequirementDecision;
  conditions: readonly ProviderCondition[];
  reason: string | null;
  question: string | null;
}>;

export class NaturalLanguageConditionCompilerError extends Error {
  readonly code:
    | "CONDITION_COMPILER_CONFIG_MISSING"
    | "CONDITION_COMPILER_PROVIDER_FAILED"
    | "CONDITION_COMPILER_OUTPUT_INVALID";
  readonly status: 500 | 502;
  readonly details: readonly string[];

  constructor(
    code: NaturalLanguageConditionCompilerError["code"],
    message: string,
    status: NaturalLanguageConditionCompilerError["status"],
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = "NaturalLanguageConditionCompilerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function parseNaturalLanguageConditionCompilerRequest(
  value: unknown,
): Readonly<{ ok: true; text: string }> | NaturalLanguageConditionCompilerRequestError {
  if (!record(value)) return requestInvalid("Request body must be a JSON object.", ["body_invalid"]);
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "text") {
    return requestInvalid("Request body must contain only text.", ["request_shape_invalid"]);
  }
  if (typeof value.text !== "string") {
    return requestInvalid("text must be a string.", ["text_invalid"]);
  }
  const text = value.text.trim();
  if (!text) return requestInvalid("text must not be empty.", ["text_empty"]);
  if (text.length > NATURAL_LANGUAGE_CONDITION_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      status: 413,
      code: "CONDITION_COMPILER_TEXT_TOO_LONG",
      message: `text must be at most ${NATURAL_LANGUAGE_CONDITION_TEXT_MAX_LENGTH} characters.`,
      errors: ["text_too_long"],
    };
  }
  return { ok: true, text };
}

export async function compileNaturalLanguageListingConditions(
  input: Readonly<{ text: string }>,
  options: CompilerOptions = {},
): Promise<NaturalLanguageConditionCompilerRun> {
  const parsedRequest = parseNaturalLanguageConditionCompilerRequest(input);
  if (!parsedRequest.ok) {
    throw new NaturalLanguageConditionCompilerError(
      "CONDITION_COMPILER_OUTPUT_INVALID",
      parsedRequest.message,
      500,
      parsedRequest.errors,
    );
  }
  const env = getServerEnv();
  const apiKey = options.apiKey ?? env.geminiApiKey;
  const model = (options.model ?? env.newsGeminiModel).trim();
  if (!apiKey || !model) {
    throw new NaturalLanguageConditionCompilerError(
      "CONDITION_COMPILER_CONFIG_MISSING",
      "Condition Compiler provider is not configured.",
      500,
    );
  }

  const prompt = buildNaturalLanguageConditionCompilerPrompt(parsedRequest.text);
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const run = await (options.runPrompt ?? runStructuredGeminiJson)({
    apiKey,
    model,
    prompt,
    maxOutputTokens: 1_600,
  });
  const latencyMs = Math.max(0, Math.round(now() - startedAt));
  if (!run.ok || !run.parsed) {
    throw new NaturalLanguageConditionCompilerError(
      "CONDITION_COMPILER_PROVIDER_FAILED",
      "Condition Compiler provider did not return valid JSON.",
      502,
      [providerFailureCode(run)],
    );
  }

  return {
    result: validateNaturalLanguageConditionCompilerOutput(run.parsed, parsedRequest.text),
    telemetry: {
      compilerVersion: NATURAL_LANGUAGE_CONDITION_COMPILER_VERSION,
      promptVersion: NATURAL_LANGUAGE_CONDITION_COMPILER_PROMPT_VERSION,
      model,
      logicalCalls: 1,
      physicalAttempts: 1,
      latencyMs,
      inputTokens: finiteNumberOrNull(run.usage?.input_tokens),
      cachedInputTokens: finiteNumberOrNull(run.usage?.input_tokens_details?.cached_tokens),
      outputTokens: finiteNumberOrNull(run.usage?.output_tokens),
    },
  };
}

export function validateNaturalLanguageConditionCompilerOutput(
  value: unknown,
  originalText: string,
): NaturalLanguageConditionCompilerResult {
  if (!record(value)) throw invalidOutput(["output_invalid"]);
  assertExactKeys(value, ["requirements"], "output");
  const providerRequirements = readProviderRequirements(value.requirements, originalText);
  const adapted = adaptProviderRequirements(providerRequirements);
  const requirements = adapted.requirements;
  const ledgerConditions = adapted.conditions;
  const canonicalConditions = Object.freeze(ledgerConditions.map(({ key, operator, value: conditionValue }) => Object.freeze({
    key,
    operator,
    value: conditionValue,
  })));
  const contradictoryKeys = findDefiniteEqContradictions(canonicalConditions);
  const unsupportedRequirements = requirements.filter((requirement) => requirement.decision === "unsupported");
  const ambiguousRequirements = requirements.filter((requirement) => requirement.decision === "ambiguous");

  const status: NaturalLanguageConditionCompilerStatus = contradictoryKeys.length > 0
    ? "CONTRADICTORY"
    : unsupportedRequirements.length > 0
      ? "UNSUPPORTED"
      : ambiguousRequirements.length > 0
        ? "AMBIGUOUS"
        : "VALID";
  if (status === "VALID" && canonicalConditions.length === 0) {
    throw invalidOutput(["valid_conditions_empty"]);
  }

  const unsupported = Object.freeze(unsupportedRequirements.map((requirement) => Object.freeze({
    text: requirement.source_text,
    reason: requirement.reason as string,
  })));
  const question = ambiguousRequirements[0]?.question ?? null;

  return Object.freeze({
    version: NATURAL_LANGUAGE_CONDITION_COMPILER_VERSION,
    status,
    ledger: Object.freeze({
      requirements,
      conditions: ledgerConditions,
    }),
    conditions: canonicalConditions,
    unsupported,
    question,
    message: deterministicMessage(status),
  });
}

export function revalidateNaturalLanguageConditionCompilerResult(
  result: NaturalLanguageConditionCompilerResult,
  originalText: string,
) {
  const conditionById = new Map<string, NaturalLanguageConditionLedgerCondition>();
  result.ledger.conditions.forEach((condition, index) => {
    const expectedId = `c${index + 1}`;
    if (condition.id !== expectedId || conditionById.has(condition.id)) {
      throw invalidOutput([`ledger_condition_id_invalid:${condition.id}`]);
    }
    conditionById.set(condition.id, condition);
  });
  const requirements = result.ledger.requirements.map((requirement, index) => {
    if (requirement.id !== `r${index + 1}`) {
      throw invalidOutput([`ledger_requirement_id_invalid:${requirement.id}`]);
    }
    const seenRefs = new Set<string>();
    const conditions = requirement.condition_refs.map((ref) => {
      if (seenRefs.has(ref)) throw invalidOutput([`ledger_condition_ref_duplicate:${ref}`]);
      seenRefs.add(ref);
      const condition = conditionById.get(ref);
      if (!condition) throw invalidOutput([`ledger_condition_ref_unknown:${ref}`]);
      return { key: condition.key, operator: condition.operator, value: condition.value };
    });
    return {
      source_text: requirement.source_text,
      decision: requirement.decision,
      conditions,
      reason: requirement.reason,
      question: requirement.question,
    };
  });
  const finalized = validateNaturalLanguageConditionCompilerOutput({ requirements }, originalText);
  if (JSON.stringify(finalized) !== JSON.stringify(result)) {
    throw invalidOutput(["ledger_finalization_mismatch"]);
  }
  return finalized;
}

export function findDefiniteEqContradictions(
  conditions: readonly CanonicalListingMonitorCondition[],
) {
  const valuesByKey = new Map<string, Set<string>>();
  for (const condition of conditions) {
    if (condition.operator !== "eq") continue;
    const values = valuesByKey.get(condition.key) ?? new Set<string>();
    values.add(JSON.stringify(condition.value));
    valuesByKey.set(condition.key, values);
  }
  return Object.freeze(
    [...valuesByKey.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([key]) => key)
      .sort(),
  );
}

function readProviderRequirements(
  value: unknown,
  originalText: string,
): readonly ProviderRequirement[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw invalidOutput(["requirements_invalid"]);
  }
  return Object.freeze(value.map((item, index) => {
    if (!record(item)) throw invalidOutput([`requirements[${index}]:invalid`]);
    assertExactKeys(
      item,
      ["source_text", "decision", "conditions", "reason", "question"],
      `requirements[${index}]`,
    );
    const sourceText = readRequiredText(item.source_text, `requirements[${index}].source_text`, 1_000);
    if (!originalText.includes(sourceText)) {
      throw invalidOutput([`requirements[${index}]:source_text_not_contiguous`]);
    }
    const decision = readDecision(item.decision, index);
    const conditions = readInlineConditions(item.conditions, index);
    const reason = readNullableText(item.reason, `requirements[${index}].reason`, 240);
    const question = readNullableText(item.question, `requirements[${index}].question`, 240);

    if (decision === "mapped") {
      if (conditions.length === 0) throw invalidOutput([`requirements[${index}]:mapped_conditions_empty`]);
      if (reason !== null || question !== null) throw invalidOutput([`requirements[${index}]:mapped_details_present`]);
    } else if (decision === "unsupported") {
      if (conditions.length > 0) throw invalidOutput([`requirements[${index}]:unsupported_conditions_present`]);
      if (reason === null || question !== null) throw invalidOutput([`requirements[${index}]:unsupported_details_invalid`]);
    } else {
      if (conditions.length > 0) throw invalidOutput([`requirements[${index}]:ambiguous_conditions_present`]);
      if (reason !== null || question === null) throw invalidOutput([`requirements[${index}]:ambiguous_details_invalid`]);
    }

    return Object.freeze({
      source_text: sourceText,
      decision,
      conditions,
      reason,
      question,
    });
  }));
}

function adaptProviderRequirements(providerRequirements: readonly ProviderRequirement[]) {
  const conditionIdByFingerprint = new Map<string, string>();
  const ledgerConditions: NaturalLanguageConditionLedgerCondition[] = [];
  const requirements = providerRequirements.map((requirement, requirementIndex) => {
    const canonicalConditions = requirement.decision === "mapped"
      ? readCanonicalConditions(requirement.conditions, requirementIndex)
      : Object.freeze([]);
    const refs: string[] = [];
    for (const condition of canonicalConditions) {
      const fingerprint = canonicalConditionFingerprint(condition);
      let conditionId = conditionIdByFingerprint.get(fingerprint);
      if (!conditionId) {
        if (ledgerConditions.length >= 12) throw invalidOutput(["conditions_too_many"]);
        conditionId = `c${ledgerConditions.length + 1}`;
        conditionIdByFingerprint.set(fingerprint, conditionId);
        ledgerConditions.push(Object.freeze({ id: conditionId, ...condition }));
      }
      if (!refs.includes(conditionId)) refs.push(conditionId);
    }
    return Object.freeze({
      id: `r${requirementIndex + 1}`,
      source_text: requirement.source_text,
      decision: requirement.decision,
      condition_refs: Object.freeze(refs),
      reason: requirement.reason,
      question: requirement.question,
    });
  });
  return Object.freeze({
    requirements: Object.freeze(requirements),
    conditions: Object.freeze(ledgerConditions),
  });
}

function readInlineConditions(value: unknown, requirementIndex: number): readonly ProviderCondition[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw invalidOutput([`requirements[${requirementIndex}]:conditions_invalid`]);
  }
  return Object.freeze(value.map((item, conditionIndex) => {
    if (!record(item)) {
      throw invalidOutput([`requirements[${requirementIndex}].conditions[${conditionIndex}]:invalid`]);
    }
    assertExactKeys(
      item,
      ["key", "operator", "value"],
      `requirements[${requirementIndex}].conditions[${conditionIndex}]`,
    );
    return Object.freeze({ key: item.key, operator: item.operator, value: item.value });
  }));
}

function readCanonicalConditions(
  value: unknown,
  requirementIndex?: number,
): readonly CanonicalListingMonitorCondition[] {
  if (!Array.isArray(value) || value.length === 0) return Object.freeze([]);
  const validation = validateCanonicalListingConditions(value, "draft");
  if (!validation.ok) {
    throw invalidOutput(validation.errors.map((error) => (
      requirementIndex === undefined ? error : `requirements[${requirementIndex}].${error}`
    )));
  }
  return validation.conditions;
}

function readDecision(value: unknown, index: number): NaturalLanguageConditionRequirementDecision {
  if (value === "mapped" || value === "unsupported" || value === "ambiguous") return value;
  throw invalidOutput([`requirements[${index}]:decision_invalid`]);
}


function canonicalConditionFingerprint(condition: CanonicalListingMonitorCondition) {
  return JSON.stringify([condition.key, condition.operator, condition.value]);
}

function readRequiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") throw invalidOutput([`${label}_type:${typeof value}`]);
  const text = value.trim();
  if (!text) throw invalidOutput([`${label}_empty`]);
  if (text.length > maxLength) throw invalidOutput([`${label}_too_long:${text.length}`]);
  return text;
}

function readNullableText(value: unknown, label: string, maxLength: number) {
  return value === null ? null : readRequiredText(value, label, maxLength);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const exact = actual.length === expected.length && expected.every((key) => actual.includes(key));
  if (!exact) throw invalidOutput([`${label}_shape_invalid`]);
}

function deterministicMessage(status: NaturalLanguageConditionCompilerStatus) {
  if (status === "VALID") return "The condition preview is valid.";
  if (status === "UNSUPPORTED") return "The request includes an unsupported requirement.";
  if (status === "AMBIGUOUS") return "The request needs clarification.";
  return "The request contains contradictory conditions.";
}

function invalidOutput(details: readonly string[]) {
  return new NaturalLanguageConditionCompilerError(
    "CONDITION_COMPILER_OUTPUT_INVALID",
    "Condition Compiler output failed deterministic validation.",
    502,
    details,
  );
}

function requestInvalid(
  message: string,
  errors: readonly string[],
): NaturalLanguageConditionCompilerRequestError {
  return {
    ok: false,
    status: 400,
    code: "CONDITION_COMPILER_REQUEST_INVALID",
    message,
    errors,
  };
}

function providerFailureCode(run: GeminiStructuredJsonRun) {
  if (!run.responseOk) return "provider_request_failed";
  if (!run.parsed) return "provider_json_invalid";
  return "provider_output_unavailable";
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
