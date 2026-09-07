#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { resolveSupabaseSecretKey, supabaseServiceHeaders } from "./supabase-service-headers.mjs";

const args = parseArgs(process.argv.slice(2));
const write = args.has("write");
const dryRun = !write;
const force = args.has("force");
const skipBatch = args.has("skip-batch") || args.has("skipBatch");
const skipQueued = args.has("skip-queued") || args.has("skipQueued");
const useLock = !(args.has("no-lock") || args.has("noLock"));
const limit = normalizeLimit(args.get("limit"));
const queuedLimit = normalizeLimit(args.get("queued-limit") || args.get("queuedLimit"));
const lookbackHours = normalizeLookbackHours(args.get("lookback-hours") || args.get("lookbackHours"));
const lockTtlSeconds = normalizeLockTtl(args.get("lock-ttl-seconds") || args.get("lockTtlSeconds"));
const jobName = "alert_delivery_scheduler";
const lockedBy = `scheduler:${process.pid}:${randomUUID()}`;
const runId = `scheduler:${Date.now()}:${randomUUID()}`;
const startedAt = new Date().toISOString();
const recordRunLog = write || args.has("record-run-log") || args.has("recordRunLog");
const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const key = resolveSupabaseSecretKey(env);

if (!supabaseUrl || !key) {
  console.error("Supabase env is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy fallback).");
  process.exitCode = 1;
} else {
  let locked = false;
  try {
    if (recordRunLog) await createRunLog();
    if (useLock) {
      locked = await acquireLock();
      if (!locked) {
        const skipped = {
          ok: true,
          runId,
          dryRun,
          write,
          locked: false,
          lockSkipped: true,
          reason: "LOCK_HELD",
          batch: null,
          queued: null,
        };
        if (recordRunLog) await finishRunLog(skipped);
        console.log(JSON.stringify(skipped, null, 2));
        process.exitCode = 0;
      } else {
        await runScheduler(locked);
      }
    } else {
      await runScheduler(false);
    }
  } catch (error) {
    const failed = {
      ok: false,
      runId,
      dryRun,
      write,
      locked,
      batch: null,
      queued: null,
      error: sanitizeError(error instanceof Error ? error.message : "Alert delivery scheduler failed."),
    };
    if (recordRunLog) await failRunLog(failed).catch(() => null);
    console.log(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  } finally {
    if (locked) {
      await releaseLock().catch(() => null);
    }
  }
}

async function runScheduler(locked) {
  const batch = skipBatch ? null : runChild("scripts/run-alert-delivery-batch.mjs", buildBatchArgs());
  const queued = skipQueued ? null : runChild("scripts/process-queued-alert-deliveries.mjs", buildQueuedArgs());
  const result = {
    ok: Boolean(batch?.ok ?? true) && Boolean(queued?.ok ?? true),
    runId,
    dryRun,
    write,
    locked,
    batch,
    queued,
  };
  if (recordRunLog) await finishRunLog(result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

function buildBatchArgs() {
  const childArgs = [];
  if (write) childArgs.push("--write");
  if (force) childArgs.push("--force");
  childArgs.push("--limit", String(limit));
  childArgs.push("--lookback-hours", String(lookbackHours));
  return childArgs;
}

function buildQueuedArgs() {
  const childArgs = [];
  if (write) childArgs.push("--write");
  childArgs.push("--limit", String(queuedLimit));
  return childArgs;
}

function runChild(script, childArgs) {
  try {
    const stdout = execFileSync("node", ["--experimental-strip-types", script, ...childArgs], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseJson(stdout);
  } catch (error) {
    const parsed = parseJsonSafe(String(error.stdout || ""));
    return (
      parsed || {
        ok: false,
        error: sanitizeError(String(error.stderr || error.message || `${script} failed.`)),
      }
    );
  }
}

async function acquireLock() {
  const result = await rpc("acquire_alert_delivery_job_lock", {
    p_job_name: jobName,
    p_ttl_seconds: lockTtlSeconds,
    p_locked_by: lockedBy,
  });
  if (!result.ok) throw new Error(result.error || "Failed to acquire scheduler lock.");
  return result.data === true;
}

async function releaseLock() {
  return rpc("release_alert_delivery_job_lock", {
    p_job_name: jobName,
    p_locked_by: lockedBy,
  });
}

async function rpc(functionName, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  const data = parseBody(body);
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? undefined : readError(data, response.statusText),
  };
}

async function createRunLog() {
  const result = await tableRequest(
    "POST",
    "alert_delivery_scheduler_runs",
    { on_conflict: "run_id" },
    {
      run_id: runId,
      status: "running",
      dry_run: dryRun,
      write_enabled: write,
      lock_acquired: false,
      lock_skipped: false,
      started_at: startedAt,
      batch_summary: {},
      queued_summary: {},
      result_summary: {},
      last_error: null,
    },
    "resolution=merge-duplicates,return=representation",
  );
  if (!result.ok) throw new Error(result.error || "Failed to create scheduler run log.");
}

async function finishRunLog(result) {
  const status = result.lockSkipped ? "skipped" : result.ok ? "success" : "failed";
  return patchRunLog({
    status,
    finished_at: new Date().toISOString(),
    duration_ms: readDurationMs(startedAt),
    lock_acquired: result.locked === true,
    lock_skipped: result.lockSkipped === true,
    batch_summary: summarizeBatch(result.batch),
    queued_summary: summarizeQueued(result.queued),
    result_summary: {
      ok: result.ok,
      dryRun: result.dryRun,
      write: result.write,
      locked: result.locked,
      lockSkipped: result.lockSkipped === true,
      reason: result.reason || null,
      error: result.error ? sanitizeError(result.error) : null,
    },
    last_error: result.error ? sanitizeError(result.error) : null,
  });
}

async function failRunLog(result) {
  return patchRunLog({
    status: "failed",
    finished_at: new Date().toISOString(),
    duration_ms: readDurationMs(startedAt),
    lock_acquired: result.locked === true,
    lock_skipped: false,
    result_summary: {
      ok: false,
      dryRun: result.dryRun,
      write: result.write,
      locked: result.locked,
    },
    last_error: result.error ? sanitizeError(result.error) : "Alert delivery scheduler failed.",
  });
}

async function patchRunLog(payload) {
  return tableRequest("PATCH", "alert_delivery_scheduler_runs", { run_id: `eq.${runId}` }, payload);
}

async function tableRequest(method, table, query, payload, prefer = "return=representation") {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer,
    }),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.text();
  const data = parseBody(body);
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? undefined : readError(data, response.statusText),
  };
}

function summarizeBatch(batch) {
  if (!batch) return {};
  return {
    ok: batch.ok,
    dryRun: batch.dryRun,
    write: batch.write,
    scanned: batch.scanned,
    processed: batch.processed,
    wouldProcess: batch.wouldProcess,
    skippedAlreadyProcessed: batch.skippedAlreadyProcessed,
    deliveriesCreated: batch.deliveriesCreated,
    duplicatesSkipped: batch.duplicatesSkipped,
    failed: batch.failed,
  };
}

function summarizeQueued(queued) {
  if (!queued) return {};
  return {
    ok: queued.ok,
    dryRun: queued.dryRun,
    write: queued.write,
    scanned: queued.scanned,
    processed: queued.processed,
    wouldProcess: queued.wouldProcess,
    sent: queued.sent,
    failed: queued.failed,
    suppressed: queued.suppressed,
  };
}

function readDurationMs(value) {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Date.now() - started);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const body = arg.replace(/^--/, "");
    if (body.includes("=")) {
      const [keyName, value = ""] = body.split("=");
      parsed.set(keyName, value || "true");
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

function normalizeLookbackHours(value) {
  const hours = Number(value || 6);
  return Math.max(1, Math.min(Number.isFinite(hours) ? Math.trunc(hours) : 6, 24 * 30));
}

function normalizeLockTtl(value) {
  const ttl = Number(value || 300);
  return Math.max(1, Math.min(Number.isFinite(ttl) ? Math.trunc(ttl) : 300, 3600));
}

function parseJson(value) {
  const parsed = parseJsonSafe(value);
  if (!parsed) throw new Error("Child scheduler output was not valid JSON.");
  return parsed;
}

function parseJsonSafe(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function readError(data, fallback) {
  if (data && typeof data === "object" && "message" in data) return String(data.message || fallback);
  if (typeof data === "string") return data;
  return fallback;
}

function sanitizeError(value) {
  return String(value || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}

function cleanSupabaseUrl(value) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
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
