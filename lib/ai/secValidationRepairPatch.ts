export type SecValidationRepairPatchApplication = {
  value: Record<string, unknown>;
  appliedPaths: string[];
  ignoredPaths: string[];
  unresolved: unknown[];
};

export function applySecValidationRepairPatches({
  analysisResult,
  repairResult,
  allowedPatchPaths,
}: {
  analysisResult: Record<string, unknown>;
  repairResult: unknown;
  allowedPatchPaths: string[];
}): SecValidationRepairPatchApplication {
  const next = JSON.parse(JSON.stringify(analysisResult)) as Record<string, unknown>;
  const allowed = new Set(allowedPatchPaths);
  const repair = readRecord(repairResult);
  const patches = Array.isArray(repair?.patches) ? repair.patches : [];
  const appliedPaths: string[] = [];
  const ignoredPaths: string[] = [];

  for (const rawPatch of patches) {
    const patch = readRecord(rawPatch);
    const path = stringValue(patch?.path);
    if (!path || !allowed.has(path) || !hasSecValidationJsonPointer(next, path)) {
      if (path) ignoredPaths.push(path);
      continue;
    }
    if (!isRepairScalar(patch?.replacement)) {
      ignoredPaths.push(path);
      continue;
    }
    if (replaceSecValidationJsonPointer(next, path, patch?.replacement)) {
      appliedPaths.push(path);
    } else {
      ignoredPaths.push(path);
    }
  }

  return {
    value: next,
    appliedPaths: uniqueStrings(appliedPaths),
    ignoredPaths: uniqueStrings(ignoredPaths),
    unresolved: Array.isArray(repair?.unresolved) ? repair.unresolved : [],
  };
}

export function escapeSecValidationJsonPointerSegment(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function readSecValidationJsonPointer(root: unknown, path: string): unknown {
  if (!path.startsWith("/")) return undefined;
  let current = root;
  for (const rawSegment of path.slice(1).split("/")) {
    const segment = unescapeJsonPointerSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    const record = readRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

export function hasSecValidationJsonPointer(root: unknown, path: string) {
  return readSecValidationJsonPointer(root, path) !== undefined;
}

function replaceSecValidationJsonPointer(root: unknown, path: string, replacement: unknown) {
  if (!path.startsWith("/")) return false;
  const segments = path.slice(1).split("/").map(unescapeJsonPointerSegment);
  const finalSegment = segments.pop();
  if (!finalSegment) return false;
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false;
      current = current[index];
      continue;
    }
    const record = readRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return false;
    current = record[segment];
  }
  if (Array.isArray(current)) {
    const index = Number(finalSegment);
    if (!Number.isInteger(index) || index < 0 || index >= current.length) return false;
    current[index] = replacement;
    return true;
  }
  const record = readRecord(current);
  if (!record || !Object.prototype.hasOwnProperty.call(record, finalSegment)) return false;
  record[finalSegment] = replacement;
  return true;
}

function unescapeJsonPointerSegment(value: string) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isRepairScalar(value: unknown) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
