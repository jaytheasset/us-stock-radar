import { createHash } from "node:crypto";
import Ajv from "ajv";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { OWNERSHIP_ANALYSIS_PROMPT } from "@/lib/sources/sec/forms/ownership/analysisPrompt";
import { buildSecOwnershipAnalysisPrompt } from "@/lib/ai/secOwnershipAnalysisAdapter";
import { buildOwnershipOneCallContextPrompt } from "@/lib/monitor/ownershipStructuredContextAnalyzer";
import instructionSource from "./ownershipOneCallInstructions.json" with { type: "json" };

export const OWNERSHIP_ONE_CALL_PROMPT_KEY = "sec_ownership_one_call";
export const OWNERSHIP_ONE_CALL_PROMPT_VERSION = "ownership_one_call_reliability_date_v1";
export const OWNERSHIP_ONE_CALL_MODEL = "gemini-3.5-flash";

const PRIMARY_SOURCE_SHA256 = "c97346c680a3b7e35c7094fa93cab0b58f851003313d580f6e0749b650ef2f7b";
const INSTRUCTION_SHA256 = "4abadb287e3d54f8fadb0d0f50e114be2f34c76feb972ada127452e0479c36d7";
const PRIMARY_INPUT_MARKER = "\n\nOwnership analysis input:\n";
const VALIDATION_MARKER = "\n\nFinal validation before returning JSON:\n";
const FILING_CONTEXT_MARKER = "\n\nSite-provided filing_context, optional:\n";
const ADDENDUM_MARKER = "\n\nIntegration addendum:\n";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** This is the tested experiment request, assembled from the current product evidence. */
export function buildOwnershipOneCallPrompt(input: SecFilingAnalysisInput, rawItem: unknown) {
  const primary = buildSecOwnershipAnalysisPrompt(input);
  const context = buildOwnershipOneCallContextPrompt(rawItem);
  if (sha256(OWNERSHIP_ANALYSIS_PROMPT) !== PRIMARY_SOURCE_SHA256
    || !primary.user.startsWith(OWNERSHIP_ANALYSIS_PROMPT)
    || sha256(instructionSource.instruction) !== INSTRUCTION_SHA256) {
    throw new Error("Ownership one-call instruction or Primary source changed; review the tested contract");
  }
  const inputAt = primary.user.indexOf(PRIMARY_INPUT_MARKER);
  const validationAt = primary.user.indexOf(VALIDATION_MARKER, inputAt);
  const contextAt = primary.user.indexOf(FILING_CONTEXT_MARKER, validationAt);
  const addendumAt = primary.user.indexOf(ADDENDUM_MARKER, contextAt);
  if ([inputAt, validationAt, contextAt, addendumAt].some((at) => at < 0)) {
    throw new Error("Ownership Primary input changed; review the tested one-call request");
  }
  const primaryInput = primary.user.slice(inputAt + 2, validationAt);
  const filingContext = primary.user.slice(contextAt + 2, addendumAt);
  const primarySchema = primary.responseFormat.json_schema.schema;
  if (!isRecord(primarySchema) || !isRecord(primarySchema.properties)) {
    throw new Error("Ownership Primary output schema is unavailable");
  }
  const { parser_output: _serverOwnedParserOutput, ...modelPrimaryProperties } = primarySchema.properties;
  const modelPrimarySchema = {
    ...primarySchema,
    additionalProperties: false,
    properties: modelPrimaryProperties,
  };
  const structuredSchema = context.prompt.responseFormat.json_schema;
  const envelopeSchema = {
    type: "object",
    additionalProperties: false,
    required: ["primary", "structured"],
    properties: { primary: modelPrimarySchema, structured: structuredSchema },
  };
  return {
    prompt: {
      system: instructionSource.instruction,
      user: [
        primaryInput,
        filingContext,
        `STRUCTURED INPUT AND CLOSED OUTPUT CONTRACT:\n${context.prompt.user}`,
        `AUTHORITATIVE PRIMARY OUTPUT SCHEMA (parser_output is supplied by the server):\n${JSON.stringify(modelPrimarySchema)}`,
      ].join("\n\n"),
      responseFormat: { json_schema: envelopeSchema },
    },
    primarySchema: modelPrimarySchema,
    structuredSchema,
    contextPromptSha256: context.promptSha256,
    instructionSha256: INSTRUCTION_SHA256,
  };
}

/** The two branches are checked independently so one invalid result cannot rewrite the other. */
export function validateOwnershipOneCallOutput(
  value: unknown,
  schemas: Pick<ReturnType<typeof buildOwnershipOneCallPrompt>, "primarySchema" | "structuredSchema">,
) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "primary,structured") {
    return { primary: null, structured: null, errors: ["One-call output must have exactly primary and structured"] };
  }
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validatePrimary = ajv.compile(schemas.primarySchema);
  const validateStructured = ajv.compile(schemas.structuredSchema);
  const primaryValid = validatePrimary(value.primary);
  const primaryErrors = primaryValid ? [] : (validatePrimary.errors ?? []);
  const structuredValid = validateStructured(value.structured);
  const structuredErrors = structuredValid ? [] : (validateStructured.errors ?? []);
  return {
    primary: primaryValid && isRecord(value.primary) ? value.primary : null,
    structured: structuredValid && isRecord(value.structured) ? value.structured : null,
    errors: [
      ...primaryErrors.map((error) => `primary ${error.instancePath} ${error.message}`),
      ...structuredErrors.map((error) => `structured ${error.instancePath} ${error.message}`),
    ],
  };
}
