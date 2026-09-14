import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// CLI-only bridge to the server queue/reader modules; no alternate matching or sending rules.
const root = new URL("../", import.meta.url);
let registered = false;
export async function loadAlertDeliveryRuntime(env) {
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  if (!registered) {
    registered = true;
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
        const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root)
          : specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? new URL(specifier, context.parentURL) : null;
        if (base) for (const suffix of ["", ".ts", ".tsx", ".js", "/index.ts"]) {
          const url = new URL(base.href + suffix);
          if (existsSync(url)) return { shortCircuit: true, url: url.href };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url.endsWith(".tsx")) return { shortCircuit: true, format: "module",
          source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
            fileName: fileURLToPath(url), compilerOptions: { jsx: ts.JsxEmit.ReactJSX,
              target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText };
        return next(url, context);
      },
    });
  }
  return {
    ...await import("../lib/sec-form25-identity/consumption.ts"),
    ...await import("../lib/sec-form25-analysis-review/consumer.ts"),
    ...await import("../lib/alerts/delivery/tickerSubscriptionMatch.ts"),
    ...await import("../lib/alerts/delivery/processQueuedDeliveries.ts"),
  };
}
