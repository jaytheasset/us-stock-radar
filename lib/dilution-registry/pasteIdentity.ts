import { createHash } from "node:crypto";
import { parseDilutionRegistryJson } from "./preview.ts";

export const DILUTION_REGISTRY_PASTE_ID_PREFIX = "dilution-registry:v1:";

/**
 * Returns the stable identity of the exact UTF-8 text that passed Preview.
 * Whitespace, object-key order, and numeric spelling are intentionally part of
 * the identity. The future trusted server must pass this same source text to
 * the database RPC, which independently verifies the digest and parsed value.
 */
export function createDilutionRegistryPasteIdFromSource(
  source: string,
): string {
  const parsed = parseDilutionRegistryJson(source);
  if (!parsed.ok) {
    throw new Error(
      `Invalid Dilution Registry Preview JSON: ${parsed.errors.join(" ")}`,
    );
  }

  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  return `${DILUTION_REGISTRY_PASTE_ID_PREFIX}${digest}`;
}

/**
 * Returns the exact Registry portion of one combined Admin paste.
 *
 * Legacy JSON without `os_observations` is returned byte-for-byte. For a
 * combined paste, only the top-level O/S member is removed, including its JSON
 * separator. This keeps Registry replay identity independent from O/S edits
 * without changing the existing RPC or paste-hash contract.
 */
export function createDilutionRegistrySourceFromCombinedSource(source: string) {
  const parsed = parseDilutionRegistryJson(source);
  if (!parsed.ok) {
    throw new Error(
      `Invalid Dilution Registry Preview JSON: ${parsed.errors.join(" ")}`,
    );
  }
  if (!Object.hasOwn(JSON.parse(source), "os_observations")) return source;

  const members = readTopLevelMembers(source);
  const matches = members.filter((member) => member.key === "os_observations");
  if (matches.length !== 1) {
    throw new Error("Combined Dilution Registry JSON must contain one O/S member.");
  }
  const targetIndex = members.indexOf(matches[0]!);
  const target = matches[0]!;
  let registrySource: string;
  if (targetIndex > 0) {
    registrySource = source.slice(0, target.separatorBefore) + source.slice(target.valueEnd);
  } else if (target.separatorAfter !== null) {
    registrySource = source.slice(0, target.memberStart) + source.slice(target.separatorAfter + 1);
  } else {
    registrySource = source.slice(0, target.memberStart) + source.slice(target.valueEnd);
  }

  const reparsed = parseDilutionRegistryJson(registrySource);
  if (!reparsed.ok || Object.hasOwn(JSON.parse(registrySource), "os_observations")) {
    throw new Error("The Registry-only source could not be derived safely.");
  }
  return registrySource;
}

type TopLevelMember = {
  key: string;
  memberStart: number;
  separatorBefore: number;
  separatorAfter: number | null;
  valueEnd: number;
};

function readTopLevelMembers(source: string): TopLevelMember[] {
  let index = skipWhitespace(source, 0);
  if (source[index] !== "{") throw new Error("The combined source must be a JSON object.");
  index += 1;
  let separatorBefore = index;
  const members: TopLevelMember[] = [];

  while (true) {
    index = skipWhitespace(source, index);
    if (source[index] === "}") return members;
    const memberStart = index;
    const keyEnd = readJsonStringEnd(source, index);
    const key = JSON.parse(source.slice(index, keyEnd)) as string;
    index = skipWhitespace(source, keyEnd);
    if (source[index] !== ":") throw new Error("A top-level JSON member is malformed.");
    index = skipWhitespace(source, index + 1);
    const valueEnd = readJsonValueEnd(source, index);
    index = skipWhitespace(source, valueEnd);
    const separatorAfter = source[index] === "," ? index : null;
    members.push({ key, memberStart, separatorBefore, separatorAfter, valueEnd });
    if (separatorAfter === null) {
      if (source[index] !== "}") throw new Error("A top-level JSON member is malformed.");
      return members;
    }
    separatorBefore = separatorAfter;
    index = separatorAfter + 1;
  }
}

function readJsonStringEnd(source: string, start: number) {
  if (source[start] !== '"') throw new Error("A top-level JSON key is malformed.");
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === '"') return index + 1;
  }
  throw new Error("A JSON string is unterminated.");
}

function readJsonValueEnd(source: string, start: number) {
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") objectDepth += 1;
    else if (character === "}") {
      if (objectDepth === 0 && arrayDepth === 0) return trimWhitespaceEnd(source, start, index);
      objectDepth -= 1;
    } else if (character === "[") arrayDepth += 1;
    else if (character === "]") arrayDepth -= 1;
    else if (character === "," && objectDepth === 0 && arrayDepth === 0) {
      return trimWhitespaceEnd(source, start, index);
    }
  }
  throw new Error("A top-level JSON value is unterminated.");
}

function skipWhitespace(source: string, start: number) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function trimWhitespaceEnd(source: string, start: number, end: number) {
  let index = end;
  while (index > start && /\s/.test(source[index - 1] ?? "")) index -= 1;
  return index;
}
