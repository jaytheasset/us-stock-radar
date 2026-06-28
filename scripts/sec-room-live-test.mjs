#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_ROOT = path.resolve(SCRIPT_ROOT, "..");
const INTEGRATION_OWNED_FORM_FILES = ["adapter.ts", "displayPayload.ts"];

const ROOM_CONFIGS = [
  {
    project: "US-Stock-Radar-sec-8k-6k",
    folder: "8k-6k",
    formTypes: ["8-K", "6-K", "8-K/A", "6-K/A"],
  },
  {
    project: "US-Stock-Radar-sec-periodic-reports",
    folder: "periodic-reports",
    formTypes: ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"],
  },
  {
    project: "US-Stock-Radar-sec-nt",
    folder: "nt",
    formTypes: ["NT 10-K", "NT 10-Q", "NT 20-F"],
  },
  {
    project: "US-Stock-Radar-sec-s1-f1",
    folder: "s1-f1",
    formTypes: ["S-1", "F-1", "S-1/A", "F-1/A"],
  },
  {
    project: "US-Stock-Radar-sec-s3-f3",
    folder: "s3-f3",
    formTypes: ["S-3", "F-3", "S-3ASR", "F-3ASR", "S-3MEF", "F-3MEF", "S-3/A", "F-3/A"],
  },
  {
    project: "US-Stock-Radar-sec-424b",
    folder: "424b",
    formTypes: ["424B3", "424B5"],
  },
  {
    project: "US-Stock-Radar-sec-s8",
    folder: "s8",
    formTypes: ["S-8", "S-8/A"],
  },
  {
    project: "US-Stock-Radar-sec-effect",
    folder: "effect",
    formTypes: ["EFFECT"],
  },
  {
    project: "US-Stock-Radar-sec-ownership",
    folder: "ownership",
    formTypes: ["4", "4/A", "144", "144/A"],
  },
  {
    project: "US-Stock-Radar-sec-sc13",
    folder: "sc13",
    formTypes: ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"],
  },
  {
    project: "US-Stock-Radar-sec-proxy",
    folder: "proxy",
    formTypes: ["DEF 14A", "PRE 14A", "DEFA14A", "DEFM14A", "PREM14A"],
  },
  {
    project: "US-Stock-Radar-sec-425",
    folder: "425",
    formTypes: ["425"],
  },
  {
    project: "US-Stock-Radar-sec-s4-f4",
    folder: "s4-f4",
    formTypes: ["S-4", "F-4", "S-4/A", "F-4/A"],
  },
  {
    project: "US-Stock-Radar-sec-tender-cb-13e3",
    folder: "tender",
    formTypes: ["SC TO-I", "SC TO-T", "SC 13E3", "CB"],
  },
  {
    project: "US-Stock-Radar-sec-form25",
    folder: "form25",
    formTypes: ["25", "25-NSE"],
  },
  {
    project: "US-Stock-Radar-sec-other",
    folder: "other",
    formTypes: [],
  },
];

const args = parseArgs(process.argv.slice(2));
const roomRoot = path.resolve(stringArg("roomRoot") || process.cwd());
const integrationRoot = path.resolve(
  stringArg("integrationRoot") ||
    process.env.SEC_INTEGRATION_ROOT ||
    path.join(CODEX_ROOT, "US-Stock-Radar-sec-ingest-integration"),
);
const baseUrl = normalizeBaseUrl(stringArg("base") || process.env.SEC_LIVE_TEST_BASE_URL || "http://127.0.0.1:3002");
const room = resolveRoom();
const formTypes = csvArg("formTypes") || room.formTypes;
const limit = numberArg("limit", 1, 1, 20);
const countPerForm = numberArg("countPerForm", 1, 1, 40);
const attachmentLimit = numberArg("attachmentLimit", 6, 0, 20);
const includeDocuments = booleanArg("includeDocuments", true);
const force = booleanArg("force", true);
const startServer = booleanArg("startServer", true);
const sync = booleanArg("sync", true);
const alerts = booleanArg("alerts", true);
const syncOnly = booleanArg("syncOnly", false) || booleanArg("sync-only", false);
const accessionNumber = stringArg("accessionNumber") || stringArg("accession");
const cik = stringArg("cik") || stringArg("filerCik") || stringArg("filer-cik");
const rawItemId = stringArg("rawItemId");
const llmProvider = stringArg("llmProvider") || stringArg("llm-provider") || "gemini";
const llmModel = stringArg("llmModel") || stringArg("llm-model") || "";
const resetExistingAnalysis =
  booleanArg("resetExistingAnalysis", false) ||
  booleanArg("reset-existing-analysis", false) ||
  booleanArg("resetDerivedEvent", false) ||
  booleanArg("reset-derived-event", false) ||
  booleanArg("resetAccession", false) ||
  booleanArg("reset-accession", false);

const result = {
  ok: false,
  roomRoot,
  integrationRoot,
  formFolder: room.folder,
  formTypes,
  baseUrl,
  llmProvider: llmProvider || null,
  llmModel: llmModel || null,
  resetExistingAnalysis,
  sync: null,
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
  ensureIntegrationEnv();

  if (sync && room.folder) {
    result.sync = syncFormFolder(room.folder);
  }

  if (syncOnly) {
    result.ok = true;
    printResult(result);
    process.exit(0);
  }

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

function syncFormFolder(folder) {
  const source = path.resolve(roomRoot, "lib", "sources", "sec", "forms", folder);
  const target = path.resolve(integrationRoot, "lib", "sources", "sec", "forms", folder);
  const targetFormsRoot = path.resolve(integrationRoot, "lib", "sources", "sec", "forms");

  assertDirectory(source, `source form folder ${folder}`);
  assertInside(targetFormsRoot, target, "target form folder");
  if (!existsSync(path.join(source, "parser.ts")) && folder !== "other") {
    throw new Error(`Source form folder has no parser.ts: ${source}`);
  }

  const preserved = preserveIntegrationOwnedFormFiles(source, target);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (from) => !from.includes(`${path.sep}.next${path.sep}`) && !from.includes(`${path.sep}node_modules${path.sep}`),
  });
  restoreIntegrationOwnedFormFiles(target, preserved);

  return {
    source,
    target,
    copied: true,
    preserved: preserved.map((item) => item.relativePath),
  };
}

function preserveIntegrationOwnedFormFiles(source, target) {
  const preserved = [];
  for (const relativePath of INTEGRATION_OWNED_FORM_FILES) {
    const sourceFile = path.join(source, relativePath);
    const targetFile = path.join(target, relativePath);
    if (existsSync(sourceFile) || !existsSync(targetFile)) continue;
    const stat = statSync(targetFile);
    if (!stat.isFile()) continue;
    preserved.push({
      relativePath,
      content: readFileSync(targetFile),
    });
  }
  return preserved;
}

function restoreIntegrationOwnedFormFiles(target, preserved) {
  for (const item of preserved) {
    const targetFile = path.join(target, item.relativePath);
    mkdirSync(path.dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, item.content);
  }
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
    rawItemId: rawItemId || "",
    attachmentLimit,
    resetExistingAnalysis: true,
    llmProvider,
    llmModel,
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
  const eventId = stringValue(item?.event_id);
  const deliveryLevel = stringValue(item?.delivery_level);
  const detailUrl = normalizeDetailUrl(stringValue(item?.detail_url), eventId, deliveryLevel);

  return {
    ok: liveRun?.status === "pass",
    stage: "controlled_persist",
    request: { rawItemId, accessionNumber },
    runtime: item?.runtime_output || null,
    eventId,
    title: stringValue(item?.title),
    ticker: stringValue(item?.ticker),
    eventType: stringValue(item?.event_type),
    score: numberValue(item?.score),
    deliveryLevel,
    model: "",
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

function ensureIntegrationEnv() {
  const target = path.join(integrationRoot, ".env.local");
  if (existsSync(target)) return;

  const source = path.join(CODEX_ROOT, "US-Stock Radar", ".env.local");
  if (!existsSync(source)) return;

  cpSync(source, target, { force: false });
}

function resolveRoom() {
  const explicitFolder = stringArg("formFolder") || stringArg("folder");
  if (explicitFolder) {
    const config = ROOM_CONFIGS.find((item) => item.folder === explicitFolder);
    return config || { project: path.basename(roomRoot), folder: explicitFolder, formTypes: csvArg("formTypes") || [] };
  }

  const projectName = path.basename(roomRoot);
  const config = ROOM_CONFIGS.find((item) => item.project === projectName);
  if (config) return config;

  if (path.resolve(roomRoot) === path.resolve(integrationRoot)) {
    return {
      project: projectName,
      folder: stringArg("formFolder") || null,
      formTypes: csvArg("formTypes") || ["4"],
    };
  }

  throw new Error(
    `Cannot infer SEC form room from ${projectName}. Pass --formFolder=<folder> and --formTypes=<SEC forms>.`,
  );
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

function assertInside(parent, child, label) {
  const relative = path.relative(parent, child);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside allowed folder: ${child}`);
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
