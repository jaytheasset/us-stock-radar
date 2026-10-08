import { classifySupabaseApiKey } from "../supabaseKeys.ts";

export class SecOfflineLocalTargetError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SecOfflineLocalTargetError";
    this.code = code;
  }
}

export type SecOfflineLocalTarget = Readonly<{
  apiUrl: string;
  dbHost: string;
  dbPort: string;
  database: string;
}>;

export function validateSecOfflineLocalEndpoints(input: {
  expectedApiUrl: string;
  expectedDbUrl: string;
  configuredApiUrl: string;
  statusApiUrl: string;
  statusDbUrl: string;
}): SecOfflineLocalTarget {
  const expectedApi = normalizeApiUrl(input.expectedApiUrl);
  const expectedApiParsed = parseUrl(expectedApi, "api_url_invalid");
  const configuredApiParsed = input.configuredApiUrl.trim() ? parseUrl(
    normalizeApiUrl(input.configuredApiUrl),
    "configured_api_url_invalid",
  ) : null;
  const statusApiParsed = parseUrl(
    normalizeApiUrl(input.statusApiUrl),
    "local_stack_api_url_invalid",
  );
  if (!isLoopback(expectedApiParsed.hostname) || expectedApiParsed.protocol !== "http:") {
    fail("non_loopback_api_target_rejected");
  }
  if (configuredApiParsed && !sameApiEndpoint(configuredApiParsed, expectedApiParsed)) {
    fail("configured_api_target_mismatch");
  }
  if (!sameApiEndpoint(statusApiParsed, expectedApiParsed)) {
    fail("local_stack_api_target_mismatch");
  }

  const expectedDb = parseUrl(input.expectedDbUrl, "db_url_invalid");
  const statusDb = parseUrl(input.statusDbUrl, "local_stack_db_url_invalid");
  if (!isLoopback(expectedDb.hostname) || !isPostgresProtocol(expectedDb.protocol)) {
    fail("non_loopback_db_target_rejected");
  }
  if (!isLoopback(statusDb.hostname) || !isPostgresProtocol(statusDb.protocol)) {
    fail("local_stack_db_target_invalid");
  }
  if (!sameDatabaseEndpoint(statusDb, expectedDb)) {
    fail("local_stack_db_target_mismatch");
  }

  return {
    apiUrl: expectedApi,
    dbHost: normalizeLoopbackHost(expectedDb.hostname),
    dbPort: effectivePort(expectedDb, "5432"),
    database: databaseName(expectedDb),
  };
}

/** CLI-only scope: call after endpoint and SQL system-identifier verification.
 * Reuses production Supabase readers without retaining credentials in a receipt.
 * Not intended for concurrent scopes in a long-running server.
 */
export async function withSecOfflineLocalCredentials<T>(
  input: { apiUrl: string; secretKey?: string; serviceRoleKey?: string },
  action: () => Promise<T>,
  environment: Record<string, string | undefined> = process.env,
): Promise<T> {
  const api = parseUrl(input.apiUrl, "api_url_invalid");
  if (!isLoopback(api.hostname) || api.protocol !== "http:") fail("non_loopback_api_target_rejected");
  const key = input.secretKey?.trim() || input.serviceRoleKey?.trim() || "";
  if (!["secret", "legacy-secret"].includes(classifySupabaseApiKey(key))) {
    fail("local_service_credential_invalid");
  }
  const names = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = names.map(name => environment[name]);
  try {
    environment.SUPABASE_URL = input.apiUrl;
    environment.SUPABASE_SECRET_KEY = key;
    delete environment.SUPABASE_SERVICE_ROLE_KEY;
    return await action();
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete environment[name];
      else environment[name] = previous[index];
    });
  }
}

function normalizeApiUrl(value: string) {
  const normalized = value.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  if (!normalized) fail("api_url_missing");
  return normalized;
}

function parseUrl(value: string, code: string) {
  try {
    return new URL(value);
  } catch {
    fail(code);
  }
}

function sameApiEndpoint(left: URL, right: URL) {
  return left.protocol === right.protocol
    && normalizeLoopbackHost(left.hostname) === normalizeLoopbackHost(right.hostname)
    && effectivePort(left, "80") === effectivePort(right, "80")
    && normalizedPath(left) === normalizedPath(right);
}

function sameDatabaseEndpoint(left: URL, right: URL) {
  return normalizeLoopbackHost(left.hostname) === normalizeLoopbackHost(right.hostname)
    && effectivePort(left, "5432") === effectivePort(right, "5432")
    && databaseName(left) === databaseName(right);
}

function normalizedPath(value: URL) {
  return decodeURIComponent(value.pathname).replace(/\/$/, "") || "/";
}

function databaseName(value: URL) {
  return decodeURIComponent(value.pathname).replace(/^\//, "");
}

function normalizeLoopbackHost(hostname: string) {
  return isLoopback(hostname) ? "loopback" : hostname.toLowerCase();
}

function effectivePort(value: URL, fallback: string) {
  return value.port || fallback;
}

function isPostgresProtocol(protocol: string) {
  return protocol === "postgres:" || protocol === "postgresql:";
}

function isLoopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function fail(code: string): never {
  throw new SecOfflineLocalTargetError(code);
}
