import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const apiRoot = path.join(root, "app", "api");
const mutationExport = /export async function (?:POST|PUT|PATCH|DELETE)\b/;
const sameOriginGuard =
  /assertSameOriginAuthRequest\(|rejectCrossOriginMutationRequest\(/;

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
