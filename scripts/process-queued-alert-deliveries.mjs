#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAlertDeliveryRuntime } from "./alert-delivery-runtime.mjs";

const args = parseArgs(process.argv.slice(2));
const write = args.has("write");
const dryRun = !write;
try {
  const runtime = await loadAlertDeliveryRuntime(readLocalEnv());
  const result = await runtime.processQueuedDeliveries({ dryRun, write, limit: normalizeLimit(args.get("limit")) });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, dryRun, write, items: [],
    error: sanitizeError(error instanceof Error ? error.message : "Queued delivery processing failed.") }, null, 2));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const body = arg.replace(/^--/, "");
    if (body.includes("=")) {
      const [key, value = ""] = body.split("=");
      parsed.set(key, value || "true");
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(body, next);
      index += 1;
      continue;
    }
    parsed.set(body, "true");
  }
  return parsed;
}

function normalizeLimit(value) {
  const limit = Number(value || 50);
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 50, 250));
}

function sanitizeError(value) {
  return String(value || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}

function readLocalEnv() {
  const candidates = [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), ".env")];
  const parsed = {};
  for (const filepath of candidates) {
    if (!existsSync(filepath)) continue;
    for (const line of readFileSync(filepath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const keyName = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parsed[keyName] = value;
    }
  }
  return { ...parsed, ...process.env };
}
