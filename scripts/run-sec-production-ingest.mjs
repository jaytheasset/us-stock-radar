#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args.get("base") || process.env.APP_BASE_URL || "");
const requestedGroup = String(args.get("group") || "").trim();
const runAll = booleanArg("all", false);
const planOnly = booleanArg("planOnly", false) || booleanArg("plan-only", false);
const dryRun = booleanArg("dryRun", false);
const force = booleanArg("force", false);
const now = new Date();

if (!baseUrl && !planOnly) {
  throw new Error("APP_BASE_URL or --base is required for SEC production ingest.");
}

const { SEC_FORM_ROOM_MANIFEST, SEC_PRODUCTION_INGEST_SCHEDULE } = await loadFormsModule();
const rooms = new Map(SEC_FORM_ROOM_MANIFEST.map((room) => [room.slug, room]));
const selectedGroups = SEC_PRODUCTION_INGEST_SCHEDULE.filter((group) => {
  if (requestedGroup) return group.id === requestedGroup;
  if (runAll) return true;
  return isDue(group, now);
});

if (requestedGroup && !selectedGroups.length) {
  throw new Error(`Unknown SEC ingest group: ${requestedGroup}`);
}

const results = [];
for (const group of selectedGroups) {
  const groupRooms = group.rooms.map((slug) => rooms.get(slug)).filter(Boolean);
  const formTypes = [...new Set(groupRooms.flatMap((room) => room.forms))];
  const params = new URLSearchParams({
    formTypes: formTypes.join(","),
    countPerForm: String(group.countPerForm),
    limit: String(Math.min(50, Math.max(1, formTypes.length * group.countPerForm))),
    attachmentLimit: String(group.attachmentLimit),
    includeDocuments: "true",
    dryRun: String(dryRun),
    force: String(force),
  });
  const startedAt = Date.now();

  if (planOnly) {
    results.push({
      group: group.id,
      ok: true,
      planned: true,
      rooms: group.rooms,
      formTypes,
      request: {
        countPerForm: group.countPerForm,
        limit: Math.min(50, Math.max(1, formTypes.length * group.countPerForm)),
        attachmentLimit: group.attachmentLimit,
      },
    });
    continue;
  }

  try {
    const response = await fetch(`${baseUrl}/api/sources/sec/ingest?${params}`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    results.push({
      group: group.id,
      ok: response.ok && Boolean(body?.ok || body?.partial),
      status: response.status,
      durationMs: Date.now() - startedAt,
      rooms: group.rooms,
      formTypes,
      stats: body?.stats || null,
      error: response.ok ? null : compact(body || text),
    });
  } catch (error) {
    results.push({
      group: group.id,
      ok: false,
      durationMs: Date.now() - startedAt,
      rooms: group.rooms,
      formTypes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const output = {
  ok: results.every((result) => result.ok),
  ranAt: now.toISOString(),
  baseUrl,
  mode: planOnly ? "plan_only" : requestedGroup ? "group" : runAll ? "all" : "due",
  selectedGroupCount: selectedGroups.length,
  results,
};
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;

function isDue(group, date) {
  const minute = date.getUTCMinutes();
  const normalized = ((minute - group.minuteOffset) % group.cadenceMinutes + group.cadenceMinutes) % group.cadenceMinutes;
  return normalized === 0;
}

async function loadFormsModule() {
  const sourcePath = path.join(repoRoot, "lib", "sources", "sec", "forms", "common", "forms.ts");
  const output = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function parseArgs(values) {
  const parsed = new Map();
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, ...rest] = value.slice(2).split("=");
    parsed.set(key, rest.length ? rest.join("=") : "true");
  }
  return parsed;
}

function booleanArg(key, fallback) {
  const value = args.get(key);
  if (value === undefined) return fallback;
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function compact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}
