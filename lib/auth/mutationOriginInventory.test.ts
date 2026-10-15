import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const apiRoot = path.join(root, "app", "api");
const mutationExport = /export async function (?:POST|PUT|PATCH|DELETE)\b/;
const sameOriginGuard =
  /assertSameOriginAuthRequest\(|rejectCrossOriginMutationRequest\(/;
const cancellationRoute = "app/api/cron/source-ingest/cancel/route.ts";
const delegatedHandlers: Record<string, string> = {
  "app/api/monitors/listing/compile/route.ts": "handleListingConditionCompilerPost",
  "app/api/monitors/listing/compile/425-preview/route.ts": "handleSec425PreviewPost",
  "app/api/monitors/listing/confirm/route.ts": "handleListingMonitorConfirmationPost",
};

const exceptions = [
  {
    matches: (route: string) => route === "app/api/alerts/email/unsubscribe/route.ts",
    contract: /verifyEmailUnsubscribeToken/,
    reason: "signed email link",
  },
  {
    matches: (route: string) => route.startsWith("app/api/cron/"),
    contract: /(?:cron|authorization|secret)/i,
    reason: "scheduler secret",
  },
  {
    matches: (route: string) => route.startsWith("app/api/development/"),
    contract: /process\.env\.NODE_ENV === "production"[\s\S]*status: 404/,
    reason: "production-disabled development endpoint",
  },
  {
    matches: (route: string) =>
      route.startsWith("app/api/sources/") ||
      route.startsWith("app/api/source-jobs/"),
    contract: /sourceIngestAuthResponse\(request\)/,
    reason: "secret-authenticated ingest",
  },
  {
    matches: (route: string) => route === "app/api/telegram/webhook/route.ts",
    contract: /x-telegram-bot-api-secret-token[\s\S]*secretsMatch/,
    reason: "Telegram provider webhook",
  },
  {
    matches: (route: string) => route === "app/api/webhooks/route.ts",
    contract: /webhooks\.verify\([\s\S]*webhookSecret/,
    reason: "Resend signed webhook",
  },
  {
    matches: (route: string) => route === "app/api/webhooks/snaptrade/route.ts",
    contract: /verifySnapTradeWebhook/,
    reason: "SnapTrade signed webhook",
  },
] as const;

test("every mutation route has same-origin protection or a reviewed external contract", () => {
  const mutationRoutes = collectRouteFiles(apiRoot)
    .map((absolutePath) => ({
      route: path.relative(root, absolutePath).replaceAll("\\", "/"),
      source: readFileSync(absolutePath, "utf8"),
    }))
    .filter(({ source }) => mutationExport.test(source));

  const uncovered: string[] = [];
  for (const { route, source } of mutationRoutes) {
    if (route === cancellationRoute) {
      assertCancellationAuthorization(source);
      continue;
    }
    if (Object.hasOwn(delegatedHandlers, route)) {
      const handlerPath = route.replace(/route\.ts$/, "handler.ts");
      assertDelegatedAuthorization(route, source, readFileSync(path.join(root, handlerPath), "utf8"));
      continue;
    }
    if (sameOriginGuard.test(source)) continue;
    const exception = exceptions.find((candidate) => candidate.matches(route));
    if (!exception) {
      uncovered.push(route);
      continue;
    }
    assert.match(
      source,
      exception.contract,
      `${route} no longer satisfies its ${exception.reason} exception`,
    );
  }

  assert.deepEqual(uncovered, []);
});

function assertDelegatedAuthorization(route: string, source: string, handlerSource: string) {
  const name = delegatedHandlers[route];
  assert.ok(name, "only explicitly reviewed routes may delegate");
  const file = ts.createSourceFile(route, source, ts.ScriptTarget.Latest, true);
  assertNamedImport(file, name, (module) => module === "./handler");
  assertNamedImport(file, "getOptionalCurrentUserIdReadOnly", (module) => module === "@/lib/currentUser");
  const post = file.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "POST");
  assert.ok(post && ts.isFunctionDeclaration(post) && post.body?.statements.length === 1);
  const statement = post.body.statements[0]!;
  assert.ok(ts.isReturnStatement(statement) && statement.expression && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(file) === name
    && statement.expression.arguments[0]?.getText(file) === "request", "POST must return the reviewed handler");
  const dependencies = statement.expression.arguments[1];
  assert.ok(dependencies && ts.isObjectLiteralExpression(dependencies));
  assert.ok(dependencies.properties.some((property) => ts.isPropertyAssignment(property)
    && property.name.getText(file) === "resolveUserId"
    && property.initializer.getText(file) === "getOptionalCurrentUserIdReadOnly"), "handler must use verified read-only user identity");
  const handlerFile = ts.createSourceFile(route.replace(/route\.ts$/, "handler.ts"), handlerSource, ts.ScriptTarget.Latest, true);
  assertNamedImport(handlerFile, "rejectCrossOriginMutationRequest", (module) =>
    path.resolve(root, path.dirname(route), module) === path.join(root, "lib/auth/mutationOrigin.ts"));
  const handler = handlerFile.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(handler && ts.isFunctionDeclaration(handler) && handler.body);
  const [guard, earlyReturn] = handler.body.statements;
  assert.ok(guard && ts.isVariableStatement(guard) && guard.declarationList.declarations.length === 1);
  const declaration = guard.declarationList.declarations[0]!;
  assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer && ts.isCallExpression(declaration.initializer)
    && declaration.initializer.expression.getText(handlerFile) === "rejectCrossOriginMutationRequest"
    && declaration.initializer.arguments[0]?.getText(handlerFile) === "request");
  assert.ok(earlyReturn && ts.isIfStatement(earlyReturn)
    && earlyReturn.expression.getText(handlerFile) === declaration.name.text
    && ts.isReturnStatement(earlyReturn.thenStatement)
    && earlyReturn.thenStatement.expression?.getText(handlerFile) === declaration.name.text
    && !earlyReturn.elseStatement, "origin rejection must return before handler work");
}

function assertNamedImport(file: ts.SourceFile, name: string, acceptsModule: (module: string) => boolean) {
  assert.ok(file.statements.some((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && acceptsModule(node.moduleSpecifier.text)
    && !node.importClause?.isTypeOnly && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((item) => !item.isTypeOnly && item.name.text === name && !item.propertyName)), `real ${name} import`);
}

test("delegated inventory contracts reject missing imports, calls, and early returns", () => {
  for (const [route, name] of Object.entries(delegatedHandlers)) {
    const source = readFileSync(path.join(root, route), "utf8");
    const handler = readFileSync(path.join(root, route.replace(/route\.ts$/, "handler.ts")), "utf8");
    assert.doesNotThrow(() => assertDelegatedAuthorization(route, source, handler));
    assert.throws(() => assertDelegatedAuthorization(route, source.replace('"./handler"', '"./unreviewed"'), handler));
    assert.throws(() => assertDelegatedAuthorization(route, source.replace("resolveUserId: getOptionalCurrentUserIdReadOnly", "resolveUserId: async () => 'bypass'"), handler));
    assert.throws(() => assertDelegatedAuthorization(route, source.replace(`return ${name}(request`, "return Response.json(request"), handler));
    for (const changed of [
      handler.replace(/const (?:originRejection|rejection) = rejectCrossOriginMutationRequest\([^;]+;/, ""),
      handler.replace(/if \((?:originRejection|rejection)\) return (?:originRejection|rejection);/, ""),
    ]) {
      assert.notEqual(changed, handler);
      assert.throws(() => assertDelegatedAuthorization(route, source, changed));
    }
  }
});

function assertCancellationAuthorization(source: string) {
  const file = ts.createSourceFile(cancellationRoute, source, ts.ScriptTarget.Latest, true);
  assert.ok(file.statements.some((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "@/lib/sourceIngestRouteAuth"
    && !node.importClause?.isTypeOnly
    && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((item) => !item.isTypeOnly
      && item.name.text === "sourceIngestAuthResponse" && !item.propertyName)), "real ingest guard import");
  const post = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
  assert.ok(post && ts.isFunctionDeclaration(post) && post.body, "POST body");
  const [guard, earlyReturn] = post.body.statements;
  assert.ok(guard && ts.isVariableStatement(guard) && guard.declarationList.declarations.length === 1, "guard must run first");
  const declaration = guard.declarationList.declarations[0]!;
  assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer
    && ts.isCallExpression(declaration.initializer)
    && declaration.initializer.expression.getText(file) === "sourceIngestAuthResponse"
    && declaration.initializer.arguments.length === 1
    && declaration.initializer.arguments[0]!.getText(file) === "request", "actual guard invocation");
  assert.ok(earlyReturn && ts.isIfStatement(earlyReturn)
    && earlyReturn.expression.getText(file) === declaration.name.text
    && ts.isReturnStatement(earlyReturn.thenStatement)
    && earlyReturn.thenStatement.expression?.getText(file) === declaration.name.text
    && !earlyReturn.elseStatement, "failed authorization must return before body/workflow work");
}

test("cancellation's exact-path contract rejects removed, bypassed, or late guards", () => {
  const source = readFileSync(path.join(root, cancellationRoute), "utf8");
  assert.doesNotThrow(() => assertCancellationAuthorization(source));
  const mutations = [
    source.replace("sourceIngestAuthResponse(request)", "null"),
    source.replace("if (authResponse) return authResponse;", ""),
    source.replace("if (authResponse) return authResponse;", "if (false) return authResponse;"),
    source.replace("return authResponse;", "authResponse;"),
    source.replace('"@/lib/sourceIngestRouteAuth"', '"@/lib/unreviewedGuard"'),
    source.replace("  const authResponse", "  await request.json();\n  const authResponse"),
  ];
  for (const mutant of mutations) {
    assert.notEqual(mutant, source);
    assert.throws(() => assertCancellationAuthorization(mutant));
  }
});

test("cookie-setting prelaunch and all requested first-party surfaces use the guard", () => {
  const protectedRoutes = [
    "app/api/prelaunch/access/route.ts",
    "app/api/prelaunch/logout/route.ts",
    "app/api/alerts/tickers/route.ts",
    "app/api/alerts/tickers/[ticker]/route.ts",
    "app/api/alerts/preferences/route.ts",
    "app/api/alerts/delivered/route.ts",
    "app/api/alerts/discovery-categories/route.ts",
    "app/api/alerts/channels/route.ts",
    "app/api/alerts/channels/telegram/connect/route.ts",
    "app/api/watchlist/route.ts",
    "app/api/watchlist/[ticker]/route.ts",
    "app/api/calendar/follows/route.ts",
    "app/api/trials/pro/start/route.ts",
    "app/api/trials/advanced/start/route.ts",
    "app/api/ai/sec-filing-analysis-preview/route.ts",
  ];

  for (const route of protectedRoutes) {
    assert.match(readFileSync(path.join(root, route), "utf8"), sameOriginGuard, route);
  }
});

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(absolutePath);
    return entry.isFile() && entry.name === "route.ts" ? [absolutePath] : [];
  });
}
