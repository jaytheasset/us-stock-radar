#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOM_CONFIGS = await loadRoomConfigs();

const args = parseArgs(process.argv.slice(2));
const roomRoot = SCRIPT_ROOT;
const integrationRoot = SCRIPT_ROOT;
const baseUrl = normalizeBaseUrl(stringArg("base") || process.env.SEC_LIVE_TEST_BASE_URL || "http://127.0.0.1:3110");
const room = resolveRoom();
const formTypes = csvArg("formTypes") || room.formTypes;
const limit = numberArg("limit", 1, 1, 20);
const countPerForm = numberArg("countPerForm", 1, 1, 40);
const attachmentLimit = numberArg("attachmentLimit", 6, 0, 20);
const includeDocuments = booleanArg("includeDocuments", true);
const force = booleanArg("force", true);
const startServer = booleanArg("startServer", true);
const alerts = booleanArg("alerts", true);
const accessionNumber = stringArg("accessionNumber") || stringArg("accession");
const cik = stringArg("cik") || stringArg("filerCik") || stringArg("filer-cik");
const rawItemId = stringArg("rawItemId");
const llmProvider = stringArg("llmProvider") || stringArg("llm-provider") || "gemini";
const llmModel = stringArg("llmModel") || stringArg("llm-model") || "";
const secPromptVariant =
  stringArg("secPromptVariant") ||
  stringArg("sec-prompt-variant") ||
  stringArg("promptVariant") ||
  stringArg("prompt-variant") ||
  "";
const resetExistingAnalysis =
  booleanArg("resetExistingAnalysis", false) ||
  booleanArg("reset-existing-analysis", false) ||
  booleanArg("resetDerivedEvent", false) ||
  booleanArg("reset-derived-event", false) ||
  booleanArg("resetAccession", false) ||
  booleanArg("reset-accession", false);
const allowRepeatLlm =
  booleanArg("allowRepeatLlm", false) ||
  booleanArg("allow-repeat-llm", false);

const result = {
  ok: false,
  roomRoot,
  integrationRoot,
  formFolder: room.folder,
  formTypes,
  baseUrl,
  llmProvider: llmProvider || null,
  llmModel: llmModel || null,
  secPromptVariant: secPromptVariant || null,
  resetExistingAnalysis,
  allowRepeatLlm,
  sync: { mode: "main_only", copied: false },
  server: null,
  ingest: null,
  analyses: [],
  links: [],
};

try {
  if (!formTypes.length) {
    throw new Error("No SEC formTypes were provided. Re-run with --formTypes=<SEC form type>.");
  }

  assertDirectory(integrationRoot, "integration root");
  result.server = await ensureServer();

  if (rawItemId || accessionNumber) {
    const analysis = await analyzeOne({ rawItemId, accessionNumber });
    result.analyses.push(analysis);
    result.links.push(buildDetailLink(analysis));
  } else {
    const ingest = await postJson(
      `/api/sources/sec/ingest?${new URLSearchParams({
        formTypes: formTypes.join(","),
        limit: String(limit),
        countPerForm: String(countPerForm),
        attachmentLimit: String(attachmentLimit),
        includeDocuments: String(includeDocuments),
        dryRun: "false",
        force: String(force),
      })}`,
      {},
    );
    result.ingest = summarizeIngest(ingest);
    if (!ingest?.ok && !ingest?.partial) {
      throw new Error(`SEC raw ingest failed: ${shortJson(ingest)}`);
    }

    const rawItems = readRawItems(ingest);
    if (!rawItems.length) {
      throw new Error(`SEC raw ingest returned no usable raw items: ${shortJson(ingest)}`);
    }

    for (const item of rawItems) {
      const analysis = await analyzeOne({
        rawItemId: item.raw_item_id,
        accessionNumber: item.source_unique_id,
      });
      result.analyses.push(analysis);
      result.links.push(buildDetailLink(analysis));
    }
  }

  result.ok = result.analyses.every((item) => item.ok);
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  printResult(result);
  process.exitCode = 1;
}

async function analyzeOne({ rawItemId, accessionNumber }) {
  if (resetExistingAnalysis) {
    return analyzeOneViaDevConsole({ rawItemId, accessionNumber });
  }

  const params = new URLSearchParams({
    dryRun: "false",
    force: String(force),
    alerts: String(alerts),
  });
  if (llmProvider) params.set("llmProvider", llmProvider);
  if (llmModel) params.set("llmModel", llmModel);
  if (secPromptVariant) params.set("secPromptVariant", secPromptVariant);
  if (rawItemId) params.set("rawItemId", rawItemId);
  else if (accessionNumber) params.set("accessionNumber", accessionNumber);
  else throw new Error("Cannot analyze without rawItemId or accessionNumber.");

  let analysis = await postJson(`/api/sources/sec/analyze?${params}`, {});
  if (!analysis?.ok && analysis?.stage === "raw_item" && accessionNumber && !rawItemId) {
    const ingest = await postJson(
      `/api/sources/sec/ingest?${new URLSearchParams({
        accessionNumber,
        ...(cik ? { cik } : {}),
        formTypes: formTypes.join(","),
        limit: "1",
        countPerForm: "1",
        attachmentLimit: String(attachmentLimit),
        includeDocuments: String(includeDocuments),
        dryRun: "false",
        force: String(force),
      })}`,
      {},
    );
    result.ingest = summarizeIngest(ingest);
    const rawItems = readRawItems(ingest);
    const matchingRaw = rawItems.find((item) => item.source_unique_id === accessionNumber);
    if (matchingRaw?.raw_item_id) {
      params.delete("accessionNumber");
      params.set("rawItemId", matchingRaw.raw_item_id);
    } else {
      const excluded = readExcludedItems(ingest).find((item) => item.source_unique_id === accessionNumber);
      if (excluded) {
        return summarizeExcludedAnalysis(excluded, { rawItemId, accessionNumber });
      }
    }
    analysis = await postJson(`/api/sources/sec/analyze?${params}`, {});
  }

  return summarizeAnalysis(analysis, { rawItemId, accessionNumber });
}

async function analyzeOneViaDevConsole({ rawItemId, accessionNumber }) {
  if (!rawItemId && !accessionNumber) {
    throw new Error("Reset analysis requires rawItemId or accessionNumber.");
  }
  if (!room.folder) {
    throw new Error("Reset analysis requires a SEC form room folder.");
  }

  const response = await postJson("/api/development/sec-live", {
    room: room.folder,
    mode: "controlled_persist",
    accessionNumber: accessionNumber || "",
    cik: cik || "",
    rawItemId: rawItemId || "",
    attachmentLimit,
    resetExistingAnalysis: true,
    allowRepeatLlm,
    llmProvider,
    llmModel,
    secPromptVariant,
  });
  if (!response?.ok) {
    throw new Error(`SEC dev controlled persist failed: ${shortJson(response)}`);
  }

  const liveRuns = Array.isArray(response?.detail?.liveRuns) ? response.detail.liveRuns : [];
  const liveRun =
    liveRuns.find((run) => {
      if (run?.mode !== "controlled_persist") return false;
      if (accessionNumber && run.accessionNumber === accessionNumber) return true;
      if (rawItemId && run.rawItemId === rawItemId) return true;
      return false;
    }) || liveRuns.find((run) => run?.mode === "controlled_persist") || null;
  const item = Array.isArray(liveRun?.items) ? liveRun.items[0] || null : null;
  const runtime = item?.runtime_output || null;
  const eventId = stringValue(item?.event_id);
  const deliveryLevel = stringValue(item?.delivery_level);
  const detailUrl = normalizeDetailUrl(stringValue(item?.detail_url), eventId, deliveryLevel);

  return {
    ok: liveRun?.status === "pass",
    stage: "controlled_persist",
    request: { rawItemId, accessionNumber },
    runtime,
    eventId,
    title: stringValue(item?.title),
    ticker: stringValue(item?.ticker),
    eventType: stringValue(item?.event_type),
    score: numberValue(item?.score),
    deliveryLevel,
    model: stringValue(item?.model) || stringValue(runtime?.model),
    promptModel: llmModel || "",
    promptProvider: llmProvider || "",
    detailUrl,
    alertDelivery: item?.alert_delivery || null,
    resetExistingAnalysis: liveRun?.diagnostics?.reset_existing_analysis || null,
    raw: liveRun?.status === "pass" ? undefined : response,
  };
}

async function ensureServer() {
  if (await isServerReady()) {
    return {
      ready: true,
      started: false,
      note: "Existing dev server responded.",
    };
  }

  if (!startServer) {
    throw new Error(`No dev server responded at ${baseUrl}. Re-run with --startServer=true or start it manually.`);
  }

  const { hostname, port } = parseLocalUrl(baseUrl);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const env = {
    ...process.env,
    SEC_LIVE_TEST_STARTED_BY: "sec-room-live-test",
  };
  if (alerts) env.ALERT_DELIVERY_SEND_TELEGRAM = "true";

  const child = spawn(npmCommand, ["run", "dev", "--", "--hostname", hostname, "--port", String(port)], {
    cwd: integrationRoot,
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await isServerReady()) {
      return {
        ready: true,
        started: true,
        pid: child.pid,
        alerts,
      };
    }
  }

  throw new Error(`Started dev server process ${child.pid}, but ${baseUrl} did not become ready within 60s.`);
}

async function isServerReady() {
  try {
    const response = await fetch(baseUrl, { cache: "no-store" });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function postJson(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`POST ${route} failed: HTTP ${response.status} ${shortJson(json || text)}`);
  }
  return json;
}

function summarizeIngest(ingest) {
  return {
    ok: Boolean(ingest?.ok),
    partial: Boolean(ingest?.partial),
    stage: ingest?.stage,
    runId: ingest?.runId || null,
    stats: ingest?.stats || null,
    items: readRawItems(ingest),
  };
}

function readRawItems(ingest) {
  if (!Array.isArray(ingest?.items)) return [];
  return ingest.items
    .filter((item) => item?.ok && !item.skipped && !item.is_excluded && item.raw_item_id)
    .map((item) => ({
      raw_item_id: stringValue(item.raw_item_id),
      source_unique_id: stringValue(item.source_unique_id),
      form_type: stringValue(item.form_type),
      ticker: stringValue(item.ticker),
      skipped: Boolean(item.skipped),
      is_excluded: Boolean(item.is_excluded),
      skip_gate: stringValue(item.skip_gate),
      skip_reason: stringValue(item.skip_reason),
    }));
}

function readExcludedItems(ingest) {
  if (!Array.isArray(ingest?.items)) return [];
  return ingest.items
    .filter((item) => item?.ok && (item.skipped || item.is_excluded))
    .map((item) => ({
      source_unique_id: stringValue(item.source_unique_id),
      form_type: stringValue(item.form_type),
      ticker: stringValue(item.ticker),
      skip_gate: stringValue(item.skip_gate),
      skip_reason: stringValue(item.skip_reason),
    }));
}

function summarizeExcludedAnalysis(item, request) {
  return {
    ok: true,
    stage: "excluded",
    request,
    runtime: null,
    eventId: "",
    title: "",
    ticker: item.ticker,
    eventType: "",
    score: null,
    deliveryLevel: "excluded",
    detailUrl: null,
    alertDelivery: null,
    raw: {
      ok: true,
      stage: "excluded",
      accessionNumber: item.source_unique_id,
      formType: item.form_type,
      skipGate: item.skip_gate,
      skipReason: item.skip_reason,
    },
  };
}

function summarizeAnalysis(analysis, request) {
  const event = analysis?.event || null;
  const eventId = stringValue(event?.id);
  const deliveryLevel = stringValue(event?.delivery_level) || stringValue(analysis?.analysis?.delivery_level);
  const score = numberValue(event?.score ?? analysis?.analysis?.score);
  const alertDelivery = analysis?.alertDelivery || null;
  const runtime = analysis?.runtime || null;

  return {
    ok: Boolean(analysis?.ok),
    stage: analysis?.stage || null,
    request,
    runtime,
    eventId,
    title: stringValue(event?.title || analysis?.analysis?.event_title),
    ticker: stringValue(event?.ticker || analysis?.analysis?.primary_ticker?.ticker),
    eventType: stringValue(event?.event_type || analysis?.analysis?.event_type),
    score,
    deliveryLevel,
    model: stringValue(analysis?.model),
    promptModel: stringValue(analysis?.prompt?.model),
    promptProvider: stringValue(analysis?.prompt?.provider),
    detailUrl: buildDetailUrl(eventId, deliveryLevel),
    alertDelivery: alertDelivery
      ? {
          ok: Boolean(alertDelivery.ok),
          suppressed: Boolean(alertDelivery.suppressed),
          reason: alertDelivery.reason || null,
          candidateCount: Number(alertDelivery.stats?.candidateCount || 0),
          writtenCount: Number(alertDelivery.stats?.writtenCount || 0),
          duplicateCount: Number(alertDelivery.stats?.duplicateCount || 0),
          skippedCount: Number(alertDelivery.stats?.skippedCount || 0),
          error: alertDelivery.error || null,
        }
      : null,
    raw: analysis?.ok ? undefined : analysis,
  };
}

function buildDetailLink(analysis) {
  if (!analysis?.eventId) return null;
  return {
    eventId: analysis.eventId,
    deliveryLevel: analysis.deliveryLevel,
    url: analysis.detailUrl,
  };
}

function buildDetailUrl(eventId, deliveryLevel) {
  if (!eventId) return null;
  const route = deliveryLevel === "archive" ? `/filings/archive/${eventId}` : `/filings/${eventId}`;
  return `${baseUrl}${route}`;
}

function normalizeDetailUrl(value, eventId, deliveryLevel) {
  if (value && /^https?:\/\//i.test(value)) return value;
  if (value && value.startsWith("/")) return `${baseUrl}${value}`;
  return value || buildDetailUrl(eventId, deliveryLevel);
}

function resolveRoom() {
  const explicitFolder = stringArg("formFolder") || stringArg("folder");
  if (explicitFolder) {
    const config = ROOM_CONFIGS.find((item) => item.folder === explicitFolder);
    return config || { folder: explicitFolder, formTypes: csvArg("formTypes") || [] };
  }

  const requestedForms = csvArg("formTypes") || [];
  if (requestedForms.length) {
    const config = ROOM_CONFIGS.find((item) => requestedForms.every((form) => item.formTypes.includes(form)));
    if (config) return config;
  }

  throw new Error(
    "Cannot infer the SEC form room. Pass --formFolder=<folder> or a formTypes list belonging to one room.",
  );
}

async function loadRoomConfigs() {
  const manifestPath = path.join(SCRIPT_ROOT, "lib", "sources", "sec", "forms", "common", "forms.ts");
  const source = readFileSync(manifestPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: manifestPath,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  const manifestModule = await import(moduleUrl);
  const manifest = Array.isArray(manifestModule.SEC_FORM_ROOM_MANIFEST)
    ? manifestModule.SEC_FORM_ROOM_MANIFEST
    : [];
  if (manifest.length !== 15) {
    throw new Error(`Expected 15 SEC form rooms in ${manifestPath}, found ${manifest.length}.`);
  }
  return manifest.map((room) => ({
    folder: String(room.folder || room.slug),
    formTypes: Array.isArray(room.forms) ? room.forms.map(String) : [],
  }));
}

function parseLocalUrl(value) {
  const url = new URL(value);
  return {
    hostname: url.hostname || "127.0.0.1",
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function parseArgs(values) {
  const parsed = new Map();
  for (const arg of values) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    parsed.set(key, rest.length ? rest.join("=") : "true");
  }
  return parsed;
}

function stringArg(key) {
  const value = args.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function csvArg(key) {
  const value = stringArg(key);
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : null;
}

function numberArg(key, fallback, min, max) {
  const value = Number(args.get(key) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function booleanArg(key, fallback) {
  const value = args.get(key);
  if (value === undefined) return fallback;
  if (value === "false" || value === "0" || value === "no") return false;
  return true;
}

function assertDirectory(value, label) {
  if (!existsSync(value) || !statSync(value).isDirectory()) {
    throw new Error(`Missing ${label}: ${value}`);
  }
}

function printResult(value) {
  console.log(JSON.stringify(value, null, 2));
}

function stringValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortJson(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
