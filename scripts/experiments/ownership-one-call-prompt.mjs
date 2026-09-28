import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OWNERSHIP_ANALYSIS_PROMPT } from "../../lib/sources/sec/forms/ownership/analysisPrompt.ts";

const instructionFile = new URL("./ownership-one-call-instructions.md", import.meta.url);
const instruction = readFileSync(instructionFile, "utf8").trim();
const primaryInputMarker = "\n\nOwnership analysis input:\n";
const validationMarker = "\n\nFinal validation before returning JSON:\n";
const filingContextMarker = "\n\nSite-provided filing_context, optional:\n";
const addendumMarker = "\n\nIntegration addendum:\n";
const primarySourceSha256 = "c97346c680a3b7e35c7094fa93cab0b58f851003313d580f6e0749b650ef2f7b";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// The instructions are one fixed text for all four Forms and context states.
// Only source data and the existing, row-specific output contracts vary.
export function buildUnifiedOneCallPrompt({ primaryPrompt, contextPrompt, modelPrimarySchema, envelopeSchema }) {
  if (sha256(OWNERSHIP_ANALYSIS_PROMPT) !== primarySourceSha256
    || !primaryPrompt.user.startsWith(OWNERSHIP_ANALYSIS_PROMPT)) {
    throw new Error("Ownership Primary source prompt changed; review the unified one-call instruction file");
  }
  const user = primaryPrompt.user;
  const inputAt = user.indexOf(primaryInputMarker);
  const validationAt = user.indexOf(validationMarker, inputAt);
  const contextAt = user.indexOf(filingContextMarker, validationAt);
  const addendumAt = user.indexOf(addendumMarker, contextAt);
  if ([inputAt, validationAt, contextAt, addendumAt].some((at) => at < 0)) {
    throw new Error("Ownership Primary adapter input changed; review the unified one-call instruction file");
  }
  const primaryInput = user.slice(inputAt + 2, validationAt);
  const filingContext = user.slice(contextAt + 2, addendumAt);
  const prompt = {
    system: instruction,
    user: [
      primaryInput,
      filingContext,
      `STRUCTURED INPUT AND CLOSED OUTPUT CONTRACT:\n${contextPrompt.user}`,
      `AUTHORITATIVE PRIMARY OUTPUT SCHEMA (parser_output is supplied by the server):\n${JSON.stringify(modelPrimarySchema)}`,
    ].join("\n\n"),
    responseFormat: { json_schema: envelopeSchema },
  };
  return Object.freeze({
    prompt,
    instructionFile: "scripts/experiments/ownership-one-call-instructions.md",
    instructionSha256: sha256(instruction),
  });
}
