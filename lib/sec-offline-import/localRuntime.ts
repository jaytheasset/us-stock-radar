import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getServerEnv } from "../env.ts";
import { validateSecOfflineLocalEndpoints, SecOfflineLocalTargetError } from "./localTarget.ts";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export async function verifySecOfflineLocalTarget(args: { expectedApiUrl?: string; expectedDbUrl?: string; expectedSystemIdentifier?: string }) {
  if (!args.expectedApiUrl || !args.expectedDbUrl || !args.expectedSystemIdentifier) {
    throw new SecOfflineLocalTargetError("explicit_local_target_required");
  }
  if (!/^\d+$/.test(args.expectedSystemIdentifier)) {
    throw new SecOfflineLocalTargetError("system_identifier_invalid");
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
      throw new SecOfflineLocalTargetError("system_identifier_mismatch");
    }
    if (row.database !== endpoints.database) {
      throw new SecOfflineLocalTargetError("database_name_mismatch");
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
    throw new SecOfflineLocalTargetError("local_supabase_status_unavailable");
  }
}
