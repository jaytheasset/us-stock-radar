import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getServerEnv } from "../lib/env.ts";
import {
  buildSecOfflineArchiveImportBundle,
  SecOfflineArchiveImportError,
} from "../lib/sec-offline-import/canonical.ts";
import {
  validateSecOfflineLocalEndpoints,
  withSecOfflineLocalCredentials,
  SecOfflineLocalTargetError,
} from "../lib/sec-offline-import/localTarget.ts";
import {
  applySecOfflineArchiveImport,
  planSecOfflineArchiveImport,
  SecOfflineArchivePersistenceError,
} from "../lib/sec-offline-import/persistence.ts";

type Mode = "validate" | "plan" | "apply";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Arguments = {
  directory: string;
  manifestFile?: string;
  mode: Mode;
  expectedApiUrl?: string;
  expectedDbUrl?: string;
  expectedSystemIdentifier?: string;
  confirmedBundleSha256?: string;
  receiptFile?: string;
};

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const bundle = await buildSecOfflineArchiveImportBundle({
    directory: args.directory,
    manifestFile: args.manifestFile,
  });
  const baseReceipt = {
    ok: true,
    mode: args.mode,
    version: bundle.version,
    manifestSha256: bundle.manifestSha256,
    bundleSha256: bundle.bundleSha256,
    submissionsSha256: bundle.submissionsSha256,
    issuerCik: bundle.issuerCik,
    runId: bundle.runId,
    networkRequests: 0,
    downstreamTriggered: false,
    items: bundle.items.map((item) => ({
      accessionNumber: item.accessionNumber,
      role: item.role,
      archiveFile: item.archiveFile,
      sourceSha256: item.sourceSha256,
      sourceUtf8ByteCount: item.sourceUtf8ByteCount,
      proposedRawItemId: item.rawItemId,
    })),
  };

  if (args.mode === "validate") {
    await emitReceipt({ ...baseReceipt, action: "validated_only" }, args.receiptFile);
    return;
  }

  const { target, credentials } = await verifyExplicitLocalTarget(args);
  await withSecOfflineLocalCredentials(credentials, async () => {
    const plan = await planSecOfflineArchiveImport({ bundle });
    if (args.mode === "plan") {
      await emitReceipt({ ...baseReceipt, target, plan }, args.receiptFile);
      if (plan.status !== "ready") process.exitCode = 2;
      return;
    }

    if (!args.confirmedBundleSha256) {
      throw new CliError("bundle_confirmation_required");
    }
    const result = await applySecOfflineArchiveImport({
      bundle,
      confirmedBundleSha256: args.confirmedBundleSha256,
    });
    await emitReceipt({ ...baseReceipt, target, plan, result }, args.receiptFile);
  });
}

async function verifyExplicitLocalTarget(args: Arguments) {
  if (!args.expectedApiUrl || !args.expectedDbUrl || !args.expectedSystemIdentifier) {
    throw new CliError("explicit_local_target_required");
  }
  if (!/^\d+$/.test(args.expectedSystemIdentifier)) {
    throw new CliError("system_identifier_invalid");
  }
  const localStatus = readLocalSupabaseStatus();
  const endpoints = validateSecOfflineLocalEndpoints({
    expectedApiUrl: args.expectedApiUrl,
    expectedDbUrl: args.expectedDbUrl,
    configuredApiUrl: getServerEnv().supabaseUrl,
    statusApiUrl: localStatus.API_URL,
    statusDbUrl: localStatus.DB_URL,
  });

  const client = new pg.Client({
    connectionString: localStatus.DB_URL,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    options: "-c default_transaction_read_only=on",
  });
  try {
    await client.connect();
    const result = await client.query(
      "select system_identifier::text, current_database() database from pg_control_system()",
    );
    const row = result.rows[0] as { system_identifier?: string; database?: string } | undefined;
    if (row?.system_identifier !== args.expectedSystemIdentifier) {
      throw new CliError("system_identifier_mismatch");
    }
    if (row.database !== endpoints.database) {
      throw new CliError("database_name_mismatch");
    }
    return {
      target: { ...endpoints, systemIdentifier: row.system_identifier },
      credentials: {
        apiUrl: localStatus.API_URL,
        secretKey: localStatus.SECRET_KEY,
        serviceRoleKey: localStatus.SERVICE_ROLE_KEY,
      },
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith("--")) throw new CliError("argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new CliError("argument_value_missing");
    if (values.has(name)) throw new CliError("argument_duplicate");
    values.set(name, value);
    index += 1;
  }
  const allowed = new Set([
    "--directory",
    "--manifest",
    "--mode",
    "--expected-api-url",
    "--expected-db-url",
    "--expected-system-identifier",
    "--confirm-bundle-sha256",
    "--receipt",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new CliError("argument_unknown");
  }
  const directory = values.get("--directory")?.trim();
  const mode = (values.get("--mode")?.trim() || "validate") as Mode;
  if (!directory) throw new CliError("directory_required");
  if (!(["validate", "plan", "apply"] as const).includes(mode)) {
    throw new CliError("mode_invalid");
  }
  return {
    directory,
    manifestFile: values.get("--manifest")?.trim() || undefined,
    mode,
    expectedApiUrl: values.get("--expected-api-url")?.trim() || undefined,
    expectedDbUrl: values.get("--expected-db-url")?.trim() || undefined,
    expectedSystemIdentifier: values.get("--expected-system-identifier")?.trim() || undefined,
    confirmedBundleSha256: values.get("--confirm-bundle-sha256")?.trim().toLowerCase() || undefined,
    receiptFile: values.get("--receipt")?.trim() || undefined,
  };
}

async function emitReceipt(receipt: unknown, receiptFile?: string) {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptFile) {
    const target = path.resolve(receiptFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(text);
}

function readLocalSupabaseStatus(): { API_URL: string; DB_URL: string; SECRET_KEY?: string; SERVICE_ROLE_KEY?: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [
        path.join(PROJECT_ROOT, "node_modules", "supabase", "dist", "supabase.js"),
        "status",
        "-o",
        "json",
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    const value = JSON.parse(output) as { API_URL?: unknown; DB_URL?: unknown; SECRET_KEY?: unknown; SERVICE_ROLE_KEY?: unknown };
    if (typeof value.API_URL !== "string" || typeof value.DB_URL !== "string") {
      throw new Error("invalid local status");
    }
    return {
      API_URL: value.API_URL, DB_URL: value.DB_URL,
      SECRET_KEY: typeof value.SECRET_KEY === "string" ? value.SECRET_KEY : undefined,
      SERVICE_ROLE_KEY: typeof value.SERVICE_ROLE_KEY === "string" ? value.SERVICE_ROLE_KEY : undefined,
    };
  } catch {
    throw new CliError("local_supabase_status_unavailable");
  }
}

class CliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CliError";
    this.code = code;
  }
}

main().catch((error: unknown) => {
  const code = error instanceof CliError
    || error instanceof SecOfflineLocalTargetError
    || error instanceof SecOfflineArchiveImportError
    || error instanceof SecOfflineArchivePersistenceError
    ? error.code
    : "unexpected_failure";
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
