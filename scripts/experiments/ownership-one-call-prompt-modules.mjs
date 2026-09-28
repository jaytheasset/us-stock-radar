import { createHash } from "node:crypto";
import { OWNERSHIP_ANALYSIS_PROMPT } from "../../lib/sources/sec/forms/ownership/analysisPrompt.ts";
import { buildOwnershipCommonSemanticRules } from "../../lib/monitor/ownershipSemanticPrompts/common.ts";
import { routeOwnershipSemanticPrompt } from "../../lib/monitor/ownershipSemanticPrompts/router.ts";

// This manifest partitions the existing product prompt. The one-call assembly below
// makes only the narrow input/output wording alignments documented at each edit.
// The numbers are the source lines in analysisPrompt.ts. If that source changes, fail
// explicitly rather than silently assigning a changed rule to the wrong module.
const FIRST_SOURCE_LINE = 9;
const LAST_SOURCE_LINE = 599;
const PRIMARY_SOURCE_SHA256 = "c97346c680a3b7e35c7094fa93cab0b58f851003313d580f6e0749b650ef2f7b";
const primaryLines = OWNERSHIP_ANALYSIS_PROMPT.split(/\r?\n/);
const sourceAnchors = new Map([
  [9, "You are the final SEC Ownership filing analysis LLM for Stock Radar."],
  [40, "Event and display rules:"],
  [71, "Structured Ownership Monitor facts:"],
  [130, "Ownership writing rules:"],
  [246, "Scoring rules:"],
  [299, "Alert gate:"],
  [347, "Context use contract:"],
  [363, "Market context rules:"],
  [417, "Filing context rules:"],
  [459, "Context-aware writing rules:"],
  [483, "Amendments:"],
  [538, "For score < 50 archive:"],
  [556, "For score >= 50 feed/alert:"],
  [599, "Return JSON only."],
]);
if (createHash("sha256").update(OWNERSHIP_ANALYSIS_PROMPT).digest("hex") !== PRIMARY_SOURCE_SHA256
  || primaryLines.length !== LAST_SOURCE_LINE - FIRST_SOURCE_LINE + 1
  || [...sourceAnchors].some(([line, expected]) => primaryLines[line - FIRST_SOURCE_LINE] !== expected)) {
  throw new Error("Ownership Primary source prompt changed; review the one-call module manifest before using it");
}

const moduleNames = Object.freeze([
  "common",
  "form4",
  "form4A",
  "form144",
  "form144A",
  "filing_context",
  "parent_amendment_context",
  "market_context",
  "primary_writing",
  "primary_scoring",
  "structured_common",
  "structured_form_rules",
  "output_contract",
]);

const assignments = Array.from({ length: primaryLines.length }, () => null);
function assign(first, last, module, when = "always", forms = null) {
  if (first > last || first < FIRST_SOURCE_LINE || last > LAST_SOURCE_LINE) throw new Error("Invalid Primary rule range");
  for (let line = first; line <= last; line += 1) {
    assignments[line - FIRST_SOURCE_LINE] = { module, when, forms };
  }
}

// Default section ownership. The narrower overrides select only relevant forms
// and supplied data; one-call-only wording corrections are applied at assembly.
assign(9, 39, "common");
assign(40, 129, "output_contract");
assign(130, 245, "primary_writing");
assign(246, 362, "primary_scoring");
assign(363, 416, "market_context");
assign(417, 458, "filing_context");
assign(459, 481, "primary_writing", "any_context");
assign(483, 536, "parent_amendment_context", "amendment");
assign(538, 597, "primary_writing");
assign(599, 599, "output_contract");

assign(30, 30, "filing_context");
assign(31, 31, "parent_amendment_context", "parent");
assign(32, 32, "market_context");
assign(45, 50, "form4");
assign(51, 52, "form144");
assign(84, 103, "form4");
assign(104, 123, "form144");

assign(163, 183, "market_context");
assign(186, 186, ["form4", "form144"]);
assign(187, 187, "form4");
assign(188, 188, "market_context");
assign(189, 190, "form4");
assign(191, 191, "form4A");
assign(192, 192, "form144");
assign(193, 193, "form4");
assign(194, 194, ["form4", "form144"]);
assign(195, 196, "form4");
assign(197, 197, "form4");
assign(198, 198, ["form4", "form144"]);
assign(199, 199, "form4");
assign(200, 200, ["form4A", "form144A"]);
assign(201, 201, "form4");
assign(202, 202, ["form4", "form144"]);
assign(203, 203, "form4");
assign(204, 206, ["form4A", "form144A"], "amendment");
assign(207, 210, "form4A");
assign(211, 216, "form144A");
assign(217, 218, "form144");
assign(230, 238, "form144");

assign(269, 285, "form4");
assign(286, 298, "form144");
assign(302, 327, "form4");
assign(328, 343, "form144");
assign(351, 352, "market_context");
assign(353, 355, "filing_context");
assign(448, 451, "parent_amendment_context", "parent");
assign(459, 471, "primary_writing", "any_context");
assign(472, 473, "primary_writing");
assign(474, 479, "primary_writing", "any_context");
assign(480, 481, "form144");

assign(483, 485, ["form4A", "form144A"], "amendment");
assign(486, 488, "parent_amendment_context", "parent");
assign(489, 506, ["form4A", "form144A"], "amendment");
assign(507, 510, "form4A");
assign(511, 521, "form144A");
assign(522, 536, "parent_amendment_context", "parent", ["144/A"]);
assign(549, 551, "parent_amendment_context", "parent");
assign(552, 554, ["form4A", "form144A"], "amendment");
assign(569, 583, "form4");

for (let index = 0; index < primaryLines.length; index += 1) {
  if (primaryLines[index].trim() && !assignments[index]) {
    throw new Error(`Unassigned Ownership Primary rule at analysisPrompt.ts:${index + FIRST_SOURCE_LINE}`);
  }
}

function selectedModule(rule, context) {
  if (rule.forms && !rule.forms.includes(context.rawForm)) return null;
  if (rule.when === "any_context" && !(context.hasFilingContext || context.hasMarketContext || context.hasParentContext)) return null;
  if (rule.when === "parent" && !(context.isAmendment && context.hasParentContext)) return null;
  if (rule.when === "amendment" && !context.isAmendment) return null;
  const modules = Array.isArray(rule.module) ? rule.module : [rule.module];
  return modules.find((module) => {
    if (module === "form4") return context.family === "form4";
    if (module === "form4A") return context.rawForm === "4/A";
    if (module === "form144") return context.family === "form144";
    if (module === "form144A") return context.rawForm === "144/A";
    if (module === "filing_context") return context.hasFilingContext;
    if (module === "market_context") return context.hasMarketContext;
    return true;
  }) ?? null;
}

function hasData(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(hasData);
  if (typeof value === "object") return Object.values(value).some(hasData);
  return true;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function readOneCallPromptContext(filingInput, rawForm) {
  const normalizedForm = String(rawForm).trim().toUpperCase().replace(/^FORM\s+/, "");
  if (!["4", "4/A", "144", "144/A"].includes(normalizedForm)) {
    throw new Error(`Unsupported Ownership prompt form: ${rawForm}`);
  }
  const filingPackage = record(filingInput?.filing_package);
  const parserOutput = record(record(filingPackage?.hard_parsers)?.ownership);
  const facts = record(parserOutput?.facts);
  const filingContext = record(filingPackage?.filing_context);
  const ownershipContext = record(filingContext?.ownership);
  const hasFilingContext = [
    "same_insider_12m_trades",
    "company_90d_insider_flow",
    "recent_30d_cluster",
    "related_form144_candidates",
    "related_form4_execution_candidates",
    "amendment_parent_candidate",
  ].some((key) => hasData(ownershipContext?.[key]));
  const hasParentContext = hasData(ownershipContext?.amendment_parent_candidate);
  const hasMarketContext = hasData(facts?.market_context);
  return {
    rawForm: normalizedForm,
    family: normalizedForm === "4" || normalizedForm === "4/A" ? "form4" : "form144",
    isAmendment: normalizedForm.endsWith("/A"),
    hasFilingContext,
    hasParentContext,
    hasMarketContext,
  };
}

export function buildOneCallPrimaryModules(context) {
  const selected = new Map(moduleNames.map((name) => [name, []]));
  for (let index = 0; index < primaryLines.length; index += 1) {
    // The one-call envelope explicitly forbids model-generated parser_output.
    // Keep the product's older pass-through instruction out of this experiment.
    const sourceLine = index + FIRST_SOURCE_LINE;
    if (sourceLine >= 64 && sourceLine <= 66) continue;
    // The shared one-call envelope already requires JSON-only output.
    if (sourceLine === 61 || sourceLine === 599) {
      const expected = sourceLine === 61
        ? "Return JSON only according to the provided response schema."
        : "Return JSON only.";
      if (primaryLines[index] !== expected) throw new Error(`Ownership Primary JSON rule changed at ${sourceLine}`);
      continue;
    }
    const rule = assignments[index];
    const module = rule && selectedModule(rule, context);
    if (module) selected.get(module).push(primaryLines[index].replaceAll(
      "parent_filing_context",
      "filing_context.ownership.amendment_parent_candidate",
    ));
  }
  return Object.freeze(moduleNames.map((name) => Object.freeze({
    name,
    text: selected.get(name).join("\n").trim(),
  })).filter((entry) => entry.text));
}

export function splitOneCallStructuredModules(contextPrompt, source, inventory) {
  const result = routeOwnershipSemanticPrompt({
    rawForm: source.form,
    canonicalForm: inventory.form,
    isAmendment: inventory.isAmendment,
  });
  if (!result.ok) throw new Error(result.reason);
  const common = buildOwnershipCommonSemanticRules();
  const routedText = result.route.systemRules.join(" ");
  if (!contextPrompt.system.startsWith(routedText)) {
    throw new Error("Structured prompt source changed; review one-call module assembly");
  }
  const originalXmlRule = "Treat the original SEC XML as the only semantic authority; the neutral inventory supplies opaque references, not conclusions.";
  if (common[0] !== originalXmlRule) throw new Error("Structured common source rule changed");
  const independentEvidenceRule = "Do not use parser semantic fields, Primary analysis, scores, signals, investor copy, market data, or Monitor conditions as evidence or inputs.";
  if (!common.includes(independentEvidenceRule)) throw new Error("Structured independent-evidence rule changed");
  const commonRules = [
    "Treat the SEC XML values and text presented in the Neutral Ownership Source Blocks as the only semantic authority; the neutral inventory supplies opaque references, not conclusions.",
    ...common.slice(1).filter((rule) => rule !== independentEvidenceRule),
  ];
  const formRules = result.route.systemRules.slice(common.length);
  if (result.route.canonicalForm === "form144") {
    const attributionRule = "Bind owner attribution to the reporting person or account owner supported by the XML. Do not use a broker or filing agent as the beneficial owner.";
    const relationRule = "Use ownership_relation only when the XML or a scoped remark explicitly establishes direct or indirect ownership for the selected owner. Otherwise omit it or return unresolved.";
    if (!formRules.includes(attributionRule) || !formRules.includes(relationRule)
      || result.route.outputFactFields.includes("owner_attribution")
      || result.route.outputFactFields.includes("ownership_relation")) {
      throw new Error("Form 144 Structured output contract changed; review one-call rule alignment");
    }
  }
  const selectedFormRules = formRules.flatMap((rule) => {
    if (result.route.canonicalForm !== "form144") return [rule];
    if (rule === "Bind owner attribution to the reporting person or account owner supported by the XML. Do not use a broker or filing agent as the beneficial owner.") {
      return ["Do not use a broker or filing agent as the beneficial owner."];
    }
    if (rule === "Use ownership_relation only when the XML or a scoped remark explicitly establishes direct or indirect ownership for the selected owner. Otherwise omit it or return unresolved.") {
      return [];
    }
    return [rule];
  });
  const duplicateSupportRule = "Emit a fact only when supported; otherwise omit it.";
  const outputRules = contextPrompt.system.slice(routedText.length).trim();
  if (!outputRules.includes(duplicateSupportRule)) throw new Error("Structured supported-fact output rule changed");
  return Object.freeze({
    structured_common: commonRules.join(" "),
    structured_form_rules: selectedFormRules.join(" "),
    output_contract: outputRules.replace(` ${duplicateSupportRule}`, "").trim(),
    route: result.route.id,
  });
}

export function splitOneCallPrimaryAdapterPrompt(primaryPrompt, context) {
  const sourceMarker = "\n\nOwnership analysis input:\n";
  const validationMarker = "\n\nFinal validation before returning JSON:\n";
  const filingMarker = "\n\nSite-provided filing_context, optional:\n";
  const addendumMarker = "\n\nIntegration addendum:\n";
  const user = primaryPrompt.user;
  const sourceEnd = user.indexOf(sourceMarker);
  const validationStart = user.indexOf(validationMarker, sourceEnd);
  const filingStart = user.indexOf(filingMarker, validationStart);
  const addendumStart = user.indexOf(addendumMarker, filingStart);
  if (!user.startsWith(OWNERSHIP_ANALYSIS_PROMPT) || [sourceEnd, validationStart, filingStart, addendumStart].some((at) => at < 0)) {
    throw new Error("Ownership Primary adapter prompt changed; review one-call module assembly");
  }
  const validation = user.slice(validationStart + validationMarker.length, filingStart);
  const amendmentCheck = "- For Form 4/A or Form 144/A, re-read event_title before returning. If the main";
  const amendmentStart = validation.indexOf(amendmentCheck);
  if (amendmentStart < 0) throw new Error("Ownership Primary amendment validation rule changed");
  const systemLines = primaryPrompt.system.split("\n");
  const filingSystemRule = "Use filing_context.ownership when present as compact site-provided history; absence of filing_context must not fail analysis.";
  if (!systemLines.includes(filingSystemRule)) throw new Error("Ownership Primary context system rule changed");
  const oldParserAddendum = "- Do not rewrite parser_output in runtime output. Integration preserves the actual parser output from the filing package.\n";
  const addendum = user.slice(addendumStart + 2);
  if (!addendum.includes(oldParserAddendum)) throw new Error("Ownership Primary parser_output addendum changed");
  return Object.freeze({
    system: systemLines.filter((line) => context.hasFilingContext || line !== filingSystemRule).join("\n"),
    input: user.slice(sourceEnd + 2, validationStart),
    validation: validation.slice(0, amendmentStart).replaceAll(
      "parent_filing_context",
      "filing_context.ownership.amendment_parent_candidate",
    ).trim(),
    amendmentValidation: context.isAmendment ? validation.slice(amendmentStart).trim() : "",
    filingContext: context.hasFilingContext ? user.slice(filingStart + 2, addendumStart) : "",
    integrationAddendum: addendum.replace(oldParserAddendum, ""),
  });
}

export const ONE_CALL_PROMPT_MODULE_NAMES = moduleNames;

const envelopeSystemRules = Object.freeze([
  "Analyze this SEC Ownership filing once. Return exactly two top-level keys: primary and structured.",
  "Inside primary, return exactly analysis_output and display_payload. The server supplies parser_output from its existing parser; do not output it.",
  "Inside structured, return exactly version and rows using its closed R/O/S/F selection contract and neutral source blocks.",
  "Treat SEC XML direct numbers, prices, dates, and codes as parser-owned.",
  "For structured assertions, do not use parser semantic fields or conclusions, Primary analysis, scores, summaries, signals, investor copy, market data, or Monitor conditions as evidence or inputs.",
  "A field unsupported by its own SEC evidence must be omitted from structured.",
  "Return complete JSON. Do not move analysis_output or display_payload outside primary. Do not add a third section or explanatory prose.",
]);
const envelopeUserRule = 'Output one JSON object shaped exactly as {"primary":{"analysis_output":{...},"display_payload":{...}},"structured":{"version":"ownership_context_selection_v1","rows":[...]}}. No parser_output or other top-level fields. Do not repeat direct XML transaction data outside the existing Primary-required ownership_monitor_facts.';

export function buildModularOneCallPrompt({ primaryPrompt, contextPrompt, filingInput, source, inventory, modelPrimarySchema, envelopeSchema }) {
  const context = readOneCallPromptContext(filingInput, source.form);
  const primaryModules = buildOneCallPrimaryModules(context);
  const primaryAdapter = splitOneCallPrimaryAdapterPrompt(primaryPrompt, context);
  const structured = splitOneCallStructuredModules(contextPrompt, source, inventory);
  const primaryRuleText = primaryModules.map(({ name, text }) => `${name.toUpperCase()} RULES:\n${text}`).join("\n\n");
  const system = [
    ...envelopeSystemRules,
    `PRIMARY SYSTEM RULES:\n${primaryAdapter.system}`,
    `STRUCTURED COMMON RULES:\n${structured.structured_common}`,
    `STRUCTURED FORM RULES (${structured.route}):\n${structured.structured_form_rules}`,
    `STRUCTURED OUTPUT CONTRACT RULES:\n${structured.output_contract}`,
  ].join("\n\n");
  const user = [
    `PRIMARY MODULAR RULES:\n${primaryRuleText}`,
    primaryAdapter.input,
    `Final validation before returning JSON:\n${primaryAdapter.validation}`,
    primaryAdapter.amendmentValidation,
    primaryAdapter.filingContext,
    primaryAdapter.integrationAddendum,
    `STRUCTURED INPUT AND CLOSED OUTPUT CONTRACT:\n${contextPrompt.user}`,
    `AUTHORITATIVE PRIMARY OUTPUT SCHEMA (parser_output is supplied by the server):\n${JSON.stringify(modelPrimarySchema)}`,
    envelopeUserRule,
  ].filter(Boolean).join("\n\n");
  const legacySystem = [
    ...envelopeSystemRules,
    `PRIMARY SYSTEM RULES:\n${primaryPrompt.system}`,
    `STRUCTURED SYSTEM RULES:\n${contextPrompt.system}`,
  ].join("\n\n");
  const legacyUser = [
    `PRIMARY INPUT AND EXISTING OUTPUT CONTRACT:\n${primaryPrompt.user}`,
    `STRUCTURED INPUT AND CLOSED OUTPUT CONTRACT:\n${contextPrompt.user}`,
    `AUTHORITATIVE PRIMARY OUTPUT SCHEMA (parser_output is supplied by the server):\n${JSON.stringify(modelPrimarySchema)}`,
    envelopeUserRule,
  ].join("\n\n");
  return Object.freeze({
    prompt: { system, user, responseFormat: { json_schema: envelopeSchema } },
    activeModules: Object.freeze(moduleNames.filter((name) => new Set([
      ...primaryModules.map(({ name }) => name),
      "structured_common",
      "structured_form_rules",
      "output_contract",
    ]).has(name))),
    context,
    legacyPromptChars: legacySystem.length + legacyUser.length,
  });
}
