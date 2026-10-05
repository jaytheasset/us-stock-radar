import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SEC_CORRECTION_PROMPT_CATALOG } from "./secCorrectionPromptCatalog.ts";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

const runtimePromptDefinitions = [
  definition("ownership", "lib/ai/secOwnershipAnalysisAdapter.ts", "buildOwnershipValidationRepairPrompt"),
  definition("8k-6k", "lib/ai/sec8k6kAnalysisAdapter.ts", "buildSec8k6kValidationRepairPlan"),
  definition("s1-f1", "lib/ai/secS1F1AnalysisAdapter.ts", "buildS1F1ValidationRepairPrompt"),
  definition("s3-f3", "lib/ai/secS3AnalysisAdapter.ts", "buildS3ValidationRepairPrompt"),
  definition("425", "lib/ai/secFilingAnalysisPreview.ts", "buildSec425ValidationRepairPrompt"),
  definition("424b", "lib/ai/sec424bAnalysisAdapter.ts", "build424bValidationRepairPrompt"),
  definition("tender", "lib/ai/secTenderAnalysisAdapter.ts", "buildTenderValidationRepairPrompt"),
  definition("proxy", "lib/ai/secProxyAnalysisAdapter.ts", "buildProxyValidationRepairPrompt"),
  definition("periodic-reports", "lib/ai/secPeriodicReportsAnalysisAdapter.ts", "buildPeriodicReportsValidationRepairPrompt"),
  definition("s8", "lib/ai/secS8AnalysisAdapter.ts", "buildS8ValidationRepairPrompt"),
  definition("sc13", "lib/ai/secSc13AnalysisAdapter.ts", "buildSc13ValidationRepairPrompt"),
  definition("nt", "lib/ai/secNtAnalysisAdapter.ts", "buildNtValidationRepairPrompt"),
  definition("form25", "lib/sources/sec/forms/form25/validationRepair.ts", "buildSecForm25ValidationRepairPlan"),
] as const;

test("the SEC correction catalog exactly matches every runtime repair prompt definition", () => {
  const discoveredPromptKeys = discoverRuntimeValidationRepairPromptKeys();
  const catalogPromptKeys = SEC_CORRECTION_PROMPT_CATALOG.map((entry) => entry.promptKey).sort();
  const resolvedDefinitions = runtimePromptDefinitions.map(readRuntimePromptDefinition);

  assert.deepEqual(resolvedDefinitions.map((entry) => entry.promptKey).sort(), discoveredPromptKeys);
  assert.deepEqual(catalogPromptKeys, discoveredPromptKeys);
  assert.equal(new Set(catalogPromptKeys).size, catalogPromptKeys.length);

  for (const runtimeDefinition of resolvedDefinitions) {
    const catalogEntry = SEC_CORRECTION_PROMPT_CATALOG.find(
      (entry) => entry.promptKey === runtimeDefinition.promptKey,
    );
    assert.ok(catalogEntry, `Missing catalog entry for ${runtimeDefinition.promptKey}`);
    assert.equal(catalogEntry.roomKey, runtimeDefinition.roomKey);
    assert.equal(catalogEntry.version, runtimeDefinition.version);
    assert.equal(catalogEntry.instructions, runtimeDefinition.instructions);
    assert.ok(catalogEntry.displayName.trim());
    assert.ok(catalogEntry.formGroup.trim());
  }
});

test("Form 25 is a distinct catalog entry with its runtime key and version", () => {
  const form25 = SEC_CORRECTION_PROMPT_CATALOG.find((entry) => entry.roomKey === "form25");
  assert.ok(form25);
  assert.equal(form25.displayName, "Form 25 validation repair");
  assert.equal(form25.promptKey, "sec_form25_validation_repair");
  assert.equal(form25.version, "v7-procedural-follow-up");
  assert.notEqual(form25.roomKey, "periodic-reports");
  assert.notEqual(form25.roomKey, "other");
});

test("the static catalog stays isolated from SEC runtime analysis and repair modules", () => {
  const catalog = read("lib/development/secCorrectionPromptCatalog.ts");
  const dashboard = read("lib/development/secFormDevDashboard.ts");
  const client = read("app/development/sec/SecDevelopmentClient.tsx");

  assert.doesNotMatch(catalog, /from\s+["']@\/lib\/ai\//);
  assert.doesNotMatch(catalog, /node:fs|process\.cwd|Symbol\s*\(/);
  assert.match(dashboard, /getSecCorrectionPromptsForRoom\(room\.key\)/);
  assert.match(client, /Static reference copy of the fixed correction instructions\. This is not actual run data\./);
  assert.match(client, /View SEC debug console prompt details on desktop\./);
  assert.doesNotMatch(catalog, /validation_repair_trace|repair_prompt|original_source_blocks/);
});

test("analysis prompt previews use fixed human labels without exposing extractor fallback names", () => {
  const dashboard = read("lib/development/secFormDevDashboard.ts");
  const client = read("app/development/sec/SecDevelopmentClient.tsx");

  assert.match(dashboard, /Active analysis prompt — Sectioned/);
  assert.match(dashboard, /Legacy backup — pre-sectioned/);
  assert.match(dashboard, /Active analysis prompt — Pending terms/);
  assert.match(dashboard, /Legacy backup — pre-pending terms/);
  assert.match(dashboard, /s4-f4:analysisPrompt\.ts:RETURNED_ARRAY_PROMPT_1/);
  assert.match(dashboard, /s8:analysisPrompt\.ts:RETURNED_ARRAY_PROMPT_2/);
  assert.match(dashboard, /sc13:analysisPrompt\.ts:RETURNED_PROMPT_1/);
  assert.match(dashboard, /allowReturnedFallback: file\.endsWith\("Prompt\.ts"\)/);
  assert.doesNotMatch(client, /<p>\{prompt\.name\}<\/p>/);
  assert.match(client, /promptRoleBadges/);
});

function definition(roomKey: string, sourceFile: string, functionName: string) {
  return { roomKey, sourceFile, functionName };
}

function discoverRuntimeValidationRepairPromptKeys() {
  const keys = new Set<string>();
  for (const searchRoot of ["lib/ai", "lib/sources/sec/forms"]) {
    for (const file of listTypeScriptFiles(path.join(root, searchRoot))) {
      if (file.endsWith(".test.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bsec_[a-z0-9_]+_validation_repair\b/g)) {
        keys.add(match[0]);
      }
    }
  }
  return [...keys].sort();
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
  });
}

function readRuntimePromptDefinition(input: (typeof runtimePromptDefinitions)[number]) {
  const source = read(input.sourceFile);
  const functionSource = extractFunctionSource(source, input.functionName);
  return {
    roomKey: input.roomKey,
    promptKey: resolvePromptScalar(source, functionSource, "key"),
    version: resolvePromptScalar(source, functionSource, "version"),
    instructions: extractSystemInstructions(functionSource),
  };
}

function resolvePromptScalar(source: string, functionSource: string, field: "key" | "version") {
  const literal = new RegExp(`${field}:\\s*(["'\x60])([^"'\x60]+)\\1`).exec(functionSource)?.[2];
  if (literal) return literal;

  const identifier = new RegExp(`${field}:\\s*([A-Z][A-Z0-9_]+)`).exec(functionSource)?.[1];
  assert.ok(identifier, `Missing ${field} in runtime repair prompt`);
  const resolved = new RegExp(`(?:export\\s+)?const\\s+${identifier}\\s*=\\s*(["'\x60])([^"'\x60]+)\\1`).exec(source)?.[2];
  assert.ok(resolved, `Unable to resolve ${identifier}`);
  return resolved;
}

function extractFunctionSource(source: string, functionName: string) {
  const marker = new RegExp(`(?:export\\s+)?function\\s+${functionName}\\s*\\(`).exec(source);
  assert.ok(marker, `Runtime repair function not found: ${functionName}`);
  const openParenthesis = source.indexOf("(", marker.index);
  const closeParenthesis = findMatchingSourceBracket(source, openParenthesis, "(", ")");
  const openBrace = source.indexOf("{", closeParenthesis);
  const closeBrace = findMatchingSourceBracket(source, openBrace, "{", "}");
  assert.ok(closeParenthesis >= 0 && openBrace >= 0 && closeBrace >= 0, `Incomplete repair function: ${functionName}`);
  return source.slice(marker.index, closeBrace + 1);
}

function extractSystemInstructions(functionSource: string) {
  const systemStart = functionSource.indexOf("system:");
  const userStart = functionSource.indexOf("user:", systemStart + 1);
  assert.ok(systemStart >= 0 && userStart >= 0, "Runtime repair system instructions not found");
  const expression = functionSource.slice(systemStart + "system:".length, userStart);
  const conditionalStart = expression.indexOf("scoreRationaleOnlyRepair ? [");
  const conditionalDivider = expression.indexOf("] : [", conditionalStart);
  if (conditionalStart >= 0 && conditionalDivider >= 0) {
    const scoreRationaleLines = extractStringLiteralLines(expression.slice(conditionalStart, conditionalDivider));
    const generalLines = extractStringLiteralLines(expression.slice(conditionalDivider));
    return [
      "SCORE-RATIONALE-ONLY REPAIR BRANCH",
      ...scoreRationaleLines,
      "",
      "GENERAL VALIDATION REPAIR BRANCH",
      ...generalLines,
    ].join("\n");
  }
  return extractStringLiteralLines(expression).join("\n");
}

function extractStringLiteralLines(source: string) {
  const lines: string[] = [];
  const literalPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = literalPattern.exec(source))) {
    const decoded = decodeSourceStringLiteral(match[1] || '"', match[2] || "");
    if (decoded.trim()) lines.push(decoded);
  }
  return lines;
}

function decodeSourceStringLiteral(quote: string, rawValue: string) {
  if (quote === "`") return rawValue.replace(/\\`/g, "`").replace(/\\n/g, "\n");
  try {
    return JSON.parse(`"${rawValue.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return rawValue.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
}

function findMatchingSourceBracket(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) return -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const current = source[index] || "";
    const next = source[index + 1] || "";
    if (inLineComment) {
      if (current === "\n" || current === "\r") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === open) depth += 1;
    else if (current === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
