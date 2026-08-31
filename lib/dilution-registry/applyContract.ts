import {
  createDilutionRegistryPasteIdFromSource,
  createDilutionRegistrySourceFromCombinedSource,
} from "./pasteIdentity.ts";
import { parseDilutionRegistryJson } from "./preview.ts";
import {
  appendDilutionCorporateActionClauseBinding,
  createDilutionStoredSplitClauseBinding,
} from "./corporateActionAdjustment.ts";

export const DILUTION_REGISTRY_APPLY_PERMISSION = "data.run" as const;

export type DilutionRegistryApplyStatus = "saved" | "already_saved";

type RpcResponse = {
  ok: boolean;
  data: unknown;
  error?: string;
};

export type DilutionRegistryApplyDependencies = {
  rpc: (
    functionName: string,
    payload: Record<string, unknown>,
  ) => Promise<RpcResponse>;
  runCorporateActionAdjustmentForIssuer?: (input: {
    issuerCik: string;
    targetAt: string;
  }) => Promise<unknown>;
  now?: () => Date;
};

export class DilutionRegistryApplyError extends Error {
  readonly kind: "invalid_source" | "unavailable";

  constructor(kind: "invalid_source" | "unavailable", message: string) {
    super(message);
    this.name = "DilutionRegistryApplyError";
    this.kind = kind;
  }
}

export async function applyDilutionRegistrySource(
  source: string,
  dependencies: DilutionRegistryApplyDependencies,
): Promise<{ status: DilutionRegistryApplyStatus }> {
  const parsed = parseDilutionRegistryJson(source);
  if (!parsed.ok) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      "The Dilution Registry source did not pass Preview validation.",
    );
  }
  const registrySource = createRegistryApplySource(source);
  const pasteId = createDilutionRegistryPasteIdFromSource(registrySource);
  const payload = JSON.parse(registrySource) as Record<string, unknown>;
  const response = await dependencies.rpc("apply_dilution_registry_v1", {
    p_payload: payload,
    p_paste_id: pasteId,
    p_source: registrySource,
  });

  if (!response.ok) {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry could not be saved.",
    );
  }

  const issuerCik = typeof parsed.payload.issuer?.issuer_cik === "string"
    ? parsed.payload.issuer.issuer_cik
    : "";
  for (const value of parsed.payload.corporate_action_clause_bindings ?? []) {
    const binding = createDilutionStoredSplitClauseBinding(issuerCik, value);
    await appendDilutionCorporateActionClauseBinding(binding, dependencies);
  }
  if ((parsed.payload.corporate_action_clause_bindings?.length ?? 0) > 0
    && dependencies.runCorporateActionAdjustmentForIssuer) {
    await dependencies.runCorporateActionAdjustmentForIssuer({
      issuerCik,
      targetAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
  }

  return { status: readApplyStatus(response.data) };
}

export async function runAuthorizedDilutionRegistryApply<TAccess>({
  authorize,
  apply,
}: {
  authorize: (permission: typeof DILUTION_REGISTRY_APPLY_PERMISSION) => Promise<TAccess>;
  apply: () => Promise<{ status: DilutionRegistryApplyStatus }>;
}) {
  const access = await authorize(DILUTION_REGISTRY_APPLY_PERMISSION);
  const result = await apply();
  return { access, result };
}

function readApplyStatus(value: unknown): DilutionRegistryApplyStatus {
  if (!isRecord(value) || typeof value.already_saved !== "boolean") {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry returned an invalid save result.",
    );
  }

  if (!isRecord(value.added)) {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry returned an invalid save result.",
    );
  }

  for (const key of ["instruments", "snapshots", "activities", "totals"]) {
    const count = value.added[key];
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new DilutionRegistryApplyError(
        "unavailable",
        "The Dilution Registry returned an invalid save result.",
      );
    }
  }

  return value.already_saved ? "already_saved" : "saved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createRegistryApplySource(source: string) {
  const sourceWithoutOs = createDilutionRegistrySourceFromCombinedSource(source);
  if (!Object.hasOwn(JSON.parse(sourceWithoutOs), "corporate_action_clause_bindings")) {
    return sourceWithoutOs;
  }
  const registrySource = removeTopLevelJsonMember(
    sourceWithoutOs,
    "corporate_action_clause_bindings",
  );
  const parsed = parseDilutionRegistryJson(registrySource);
  if (!parsed.ok
    || Object.hasOwn(JSON.parse(registrySource), "corporate_action_clause_bindings")) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      "The Registry-only source could not be derived safely.",
    );
  }
  return registrySource;
}

type TopLevelJsonMember = {
  key: string;
  memberStart: number;
  separatorBefore: number;
  separatorAfter: number | null;
  valueEnd: number;
};

function removeTopLevelJsonMember(source: string, key: string) {
  const members = readTopLevelJsonMembers(source);
  const matches = members.filter((member) => member.key === key);
  if (matches.length !== 1) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      `Combined Dilution Registry JSON must contain one ${key} member.`,
    );
  }
  const target = matches[0]!;
  if (members.indexOf(target) > 0) {
    return source.slice(0, target.separatorBefore) + source.slice(target.valueEnd);
  }
  if (target.separatorAfter !== null) {
    return source.slice(0, target.memberStart) + source.slice(target.separatorAfter + 1);
  }
  return source.slice(0, target.memberStart) + source.slice(target.valueEnd);
}

function readTopLevelJsonMembers(source: string): TopLevelJsonMember[] {
  let index = skipJsonWhitespace(source, 0);
  if (source[index] !== "{") {
    throw new DilutionRegistryApplyError("invalid_source", "The source must be a JSON object.");
  }
  index += 1;
  let separatorBefore = index;
  const members: TopLevelJsonMember[] = [];
  while (true) {
    index = skipJsonWhitespace(source, index);
    if (source[index] === "}") return members;
    const memberStart = index;
    const keyEnd = readJsonStringEnd(source, index);
    const key = JSON.parse(source.slice(index, keyEnd)) as string;
    index = skipJsonWhitespace(source, keyEnd);
    if (source[index] !== ":") {
      throw new DilutionRegistryApplyError("invalid_source", "A top-level member is malformed.");
    }
    index = skipJsonWhitespace(source, index + 1);
    const valueEnd = readJsonValueEnd(source, index);
    index = skipJsonWhitespace(source, valueEnd);
    const separatorAfter = source[index] === "," ? index : null;
    members.push({ key, memberStart, separatorBefore, separatorAfter, valueEnd });
    if (separatorAfter === null) return members;
    separatorBefore = separatorAfter;
    index = separatorAfter + 1;
  }
}

function readJsonStringEnd(source: string, start: number) {
  if (source[start] !== '"') {
    throw new DilutionRegistryApplyError("invalid_source", "A top-level key is malformed.");
  }
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === '"') return index + 1;
  }
  throw new DilutionRegistryApplyError("invalid_source", "A JSON string is unterminated.");
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
      if (objectDepth === 0 && arrayDepth === 0) {
        return trimJsonWhitespaceEnd(source, start, index);
      }
      objectDepth -= 1;
    } else if (character === "[") arrayDepth += 1;
    else if (character === "]") arrayDepth -= 1;
    else if (character === "," && objectDepth === 0 && arrayDepth === 0) {
      return trimJsonWhitespaceEnd(source, start, index);
    }
  }
  throw new DilutionRegistryApplyError("invalid_source", "A JSON value is unterminated.");
}

function skipJsonWhitespace(source: string, start: number) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function trimJsonWhitespaceEnd(source: string, start: number, end: number) {
  let index = end;
  while (index > start && /\s/.test(source[index - 1] ?? "")) index -= 1;
  return index;
}
