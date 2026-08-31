import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolveModule(specifier, context, nextResolve) {
  const base = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
    : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
      ? resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      : null;
  if (!base) return nextResolve(specifier, context);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) {
      return { shortCircuit: true, url: pathToFileURL(candidate).href };
    }
  }
  return nextResolve(pathToFileURL(base).href, context);
}

export { resolveModule as resolve };
