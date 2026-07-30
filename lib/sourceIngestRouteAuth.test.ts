import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  authorizeSourceDiagnosticRequest,
  authorizeSourceIngestRequest,
  readSourceIngestDryRun,
  sourceIngestAuthorizationHeaders,
} from "./sourceIngestRouteAuth.ts";

test("source ingest authorization accepts bearer and internal headers", () => {
  const secret = "test-source-ingest-secret";

  assert.deepEqual(
    authorizeSourceIngestRequest(requestWithHeaders({ authorization: `Bearer ${secret}` }), secret),
    { ok: true },
  );
  assert.deepEqual(
    authorizeSourceIngestRequest(requestWithHeaders({ "x-source-ingest-secret": secret }), secret),
    { ok: true },
  );
  assert.deepEqual(
    authorizeSourceIngestRequest(requestWithHeaders({ "x-cron-secret": secret }), secret),
    { ok: true },
  );
});

test("source ingest authorization fails closed", () => {
  assert.deepEqual(
    authorizeSourceIngestRequest(requestWithHeaders({}), ""),
    {
      ok: false,
      status: 500,
      error: "SOURCE_INGEST_SECRET_MISSING",
    },
  );
  assert.deepEqual(
    authorizeSourceIngestRequest(
      requestWithHeaders({ authorization: "Bearer wrong-secret" }),
      "correct-secret",
    ),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
  assert.deepEqual(
    authorizeSourceIngestRequest(
      requestWithHeaders({ authorization: "Bearer éééééé" }),
      "secret",
    ),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
});

test("source diagnostics require a secret in production", () => {
  const request = requestWithHeaders({});

  assert.deepEqual(
    authorizeSourceDiagnosticRequest(request, {
      secret: "",
      nodeEnv: "production",
    }),
    {
      ok: false,
      status: 500,
      error: "SOURCE_INGEST_SECRET_MISSING",
    },
  );
  assert.deepEqual(
    authorizeSourceDiagnosticRequest(
      requestWithHeaders({
        authorization: "Bearer diagnostic-secret",
      }),
      {
        secret: "diagnostic-secret",
        nodeEnv: "production",
      },
    ),
    { ok: true },
  );
});

test("source diagnostics allow local QA only when no secret is configured", () => {
  assert.deepEqual(
    authorizeSourceDiagnosticRequest(requestWithHeaders({}), {
      secret: "",
      nodeEnv: "development",
    }),
    { ok: true },
  );
  assert.deepEqual(
    authorizeSourceDiagnosticRequest(requestWithHeaders({}), {
      secret: "configured-secret",
      nodeEnv: "development",
    }),
    { ok: false, status: 401, error: "UNAUTHORIZED" },
  );
});

test("source ingest dry-run defaults remain GET true and POST false", () => {
  assert.equal(readSourceIngestDryRun("GET", null, undefined), true);
  assert.equal(readSourceIngestDryRun("GET", "false", undefined), false);
  assert.equal(readSourceIngestDryRun("POST", null, undefined), false);
  assert.equal(readSourceIngestDryRun("POST", "true", undefined), true);
  assert.equal(readSourceIngestDryRun("POST", null, true), true);
});

test("server-to-server source jobs forward the configured ingest secret", () => {
  const previousInternal = process.env.SOURCE_INGEST_INTERNAL_SECRET;
  const previousCron = process.env.CRON_SECRET;
  process.env.SOURCE_INGEST_INTERNAL_SECRET = "internal-source-secret";
  process.env.CRON_SECRET = "cron-secret";

  try {
    assert.deepEqual(sourceIngestAuthorizationHeaders(), {
      Authorization: "Bearer internal-source-secret",
    });

    delete process.env.SOURCE_INGEST_INTERNAL_SECRET;
    assert.deepEqual(sourceIngestAuthorizationHeaders(), {
      Authorization: "Bearer cron-secret",
    });
  } finally {
    restoreEnvironmentValue(
      "SOURCE_INGEST_INTERNAL_SECRET",
      previousInternal,
    );
    restoreEnvironmentValue("CRON_SECRET", previousCron);
  }
});

test("every individual ingest route enforces authorization for GET and POST", () => {
  const sourcesRoot = path.resolve(process.cwd(), "app", "api", "sources");
  const routeFiles = findIngestRouteFiles(sourcesRoot);
  assert.ok(routeFiles.length >= 13);

  for (const routeFile of routeFiles) {
    const source = readFileSync(routeFile, "utf8");
    assert.match(source, /sourceIngestAuthResponse/);
    assert.equal(
      (source.match(/sourceIngestAuthResponse\(request\)/g) || []).length,
      2,
      `${path.relative(process.cwd(), routeFile)} must protect GET and POST`,
    );
    if (routeFile.includes(`${path.sep}fmp-calendar${path.sep}`)) {
      assert.match(source, /parseFmpCalendarIngestRequest/);
      continue;
    }
    assert.match(
      source,
      /request\.nextUrl\.searchParams\.get\("dryRun"\) === "true"/,
      `${path.relative(process.cwd(), routeFile)} must keep POST dryRun=false by default`,
    );
    assert.match(source, /bodyRecord\.dryRun === true/);
    assert.match(
      source,
      /request\.nextUrl\.searchParams\.get\("dryRun"\) !== "false"/,
      `${path.relative(process.cwd(), routeFile)} must keep GET dryRun=true by default`,
    );
  }
});

test("source job proxy is protected and forwards ingest authorization", () => {
  const proxyRoute = readFileSync(
    path.resolve(
      process.cwd(),
      "app",
      "api",
      "source-jobs",
      "[source]",
      "run",
      "route.ts",
    ),
    "utf8",
  );
  const sourceJobs = readFileSync(
    path.resolve(process.cwd(), "lib", "sourceJobs.ts"),
    "utf8",
  );

  assert.match(proxyRoute, /sourceIngestAuthResponse\(request\)/);
  assert.match(sourceJobs, /sourceIngestAuthorizationHeaders\(\)/);
});

test("SEC analysis mutation route enforces the same authorization", () => {
  const analyzeRoute = readFileSync(
    path.resolve(
      process.cwd(),
      "app",
      "api",
      "sources",
      "sec",
      "analyze",
      "route.ts",
    ),
    "utf8",
  );

  assert.equal(
    (analyzeRoute.match(/sourceIngestAuthResponse\(request\)/g) || []).length,
    2,
  );
});

test("raw previews and external source health require diagnostic authorization", () => {
  const sourcesRoot = path.resolve(process.cwd(), "app", "api", "sources");
  const rawPreviewRoutes = findNamedRouteFiles(
    sourcesRoot,
    "raw-preview",
  );
  assert.ok(rawPreviewRoutes.length >= 13);

  for (const routeFile of rawPreviewRoutes) {
    const source = readFileSync(routeFile, "utf8");
    assert.match(source, /sourceDiagnosticAuthResponse/);
    assert.match(source, /sourceDiagnosticAuthResponse\(request\)/);
  }

  const healthRoute = readFileSync(
    path.resolve(sourcesRoot, "health", "route.ts"),
    "utf8",
  );
  assert.match(healthRoute, /sourceDiagnosticAuthResponse\(request\)/);
});

function requestWithHeaders(values: HeadersInit) {
  return { headers: new Headers(values) };
}

function findIngestRouteFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === "ingest") {
      const routePath = path.join(fullPath, "route.ts");
      try {
        readFileSync(routePath);
        files.push(routePath);
      } catch {
        // A source directory without an ingest route is intentionally ignored.
      }
      continue;
    }
    files.push(...findIngestRouteFiles(fullPath));
  }
  return files;
}

function findNamedRouteFiles(
  directory: string,
  routeDirectoryName: string,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === routeDirectoryName) {
      files.push(path.join(fullPath, "route.ts"));
      continue;
    }
    files.push(
      ...findNamedRouteFiles(fullPath, routeDirectoryName),
    );
  }
  return files;
}

function restoreEnvironmentValue(
  name: "SOURCE_INGEST_INTERNAL_SECRET" | "CRON_SECRET",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
