#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(
  args.get("base") || process.env.SEC_RELEASE_GATE_BASE_URL || process.env.SEC_LIVE_TEST_BASE_URL || "http://127.0.0.1:3110",
);
const endpoint = `${baseUrl}/api/development/sec-routing-release-gate`;
const verbose = args.get("verbose") === "true";

try {
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok || !result?.ok) {
    throw new Error(`Release gate failed: HTTP ${response.status} ${compact(result || text)}`);
  }

  const output = verbose
    ? { ...result, endpoint }
    : {
        ok: result.ok,
        generatedAt: result.generatedAt,
        endpoint,
        summary: result.summary,
        rooms: Array.isArray(result.rooms)
          ? result.rooms.map((room) => ({
              slug: room.slug,
              workerKey: room.workerKey,
              formCount: Array.isArray(room.forms) ? room.forms.length : 0,
              ok: room.ok,
            }))
          : [],
        specializedDisplayContracts: Array.isArray(result.specializedDisplayContracts)
          ? result.specializedDisplayContracts.map((contract) => ({
              room: contract.room,
              displayType: contract.displayType,
              displayVersion: contract.displayVersion,
              renderer: contract.renderer,
            }))
          : [],
        productionSchedule: result.productionSchedule,
      };
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        hint: `Start the main app at ${baseUrl} and rerun this command. The gate checks the actual registered workers and fetch plans at runtime.`,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
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

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function compact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}
