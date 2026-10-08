import fs from "node:fs/promises";
import path from "node:path";
import { verifySecOfflineLocalTarget } from "../lib/sec-offline-import/localRuntime.ts";
import {
  buildSecOfflineArchiveImportBundle,
  SecOfflineArchiveImportError,
} from "../lib/sec-offline-import/canonical.ts";
import {
  withSecOfflineLocalCredentials,
  SecOfflineLocalTargetError,
} from "../lib/sec-offline-import/localTarget.ts";
import {
  applySecOfflineArchiveImport,
  planSecOfflineArchiveImport,
  SecOfflineArchivePersistenceError,
} from "../lib/sec-offline-import/persistence.ts";

type Mode = "validate" | "plan" | "apply";

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

  const { target, credentials } = await verifySecOfflineLocalTarget(args);
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
