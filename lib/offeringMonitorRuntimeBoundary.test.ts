import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const removedModules = [
  "offeringMonitorSecondStage", "offeringMonitorSecondStageRuntime", "offeringMonitorProductionWiring",
];

test("retired execution modules and their dedicated test commands are absent", () => {
  for (const name of removedModules) {
    assert.equal(existsSync(resolve(root, "lib", `${name}.ts`)), false);
    assert.equal(existsSync(resolve(root, "lib", `${name}.test.ts`)), false);
  }
  const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
  for (const command of Object.values(scripts)) {
    for (const name of removedModules) assert.equal(String(command).includes(name), false);
  }
});

test("current Offering dependency graphs cannot load historical readers or retired execution", () => {
  const pending = [
    "lib/offeringMonitorMatcher.ts",
    "lib/monitor/conditionRegistry.ts",
    "lib/monitor/offeringMonitorAlertConsumer.ts",
    "lib/monitor/offeringMonitorAutomaticTrigger.ts",
    "lib/dilution-registry/applyServer.ts",
    "workflows/offering-monitor-normalization.ts",
  ].map(path => resolve(root, path));
  const visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const onlyTypes = !node.importClause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
        if (!onlyTypes && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifiers.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, /offeringMonitor(?:SecondStage|ProductionWiring|CanonicalPersistence|HistoricalContract)/, path);
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2))
        : specifier.startsWith(".") ? resolve(dirname(path), specifier) : null;
      if (!base) continue;
      const target = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
        .find(candidate => /\.(?:ts|tsx)$/.test(candidate) && existsSync(candidate));
      if (target) pending.push(target);
    }
    assert.doesNotMatch(source, /\b(?:promoteOfferingMonitorCanonical|processOfferingMonitorSecondStageJob|processOfferingMonitorProductionWiring|runOfferingMonitorProviderOnce)\s*\(/, path);
  }
  assert.ok(visited.size > 6, "transitive local imports were traversed");
});
