import "server-only";
import pg from "pg";
import { requireServerPostgresUrl, type ServerPostgresEnvironment } from "../serverPostgres.ts";
import { normalizeCik } from "./normalization.ts";
import { readCurrentIssuerSubmissions } from "./currentSubmissionsReader.ts";
import { PostgresSecStructuredRepository, type SecStructuredSqlClient } from "./repository.ts";
import { SecSubmissionsRefreshService } from "./submissionsRefresh.ts";
import { SecStructuredHttpError } from "./httpClient.ts";
import type { SecCurrentSubmissionsResult } from "./types.ts";

export const SUBMISSIONS_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
export const SUBMISSIONS_RUNNER_MAX_CIKS = 20;
export const SUBMISSIONS_RUNNER_INTERVAL_MS = 1000;
// Dedicated two-int session advisory lock. Same protocol, same database only.
export const SUBMISSIONS_RUNNER_LOCK = [0x534543, 0x535542] as const;

export function validateRefreshCiks(input: readonly unknown[]): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("invalid_ciks");
  let ciks: string[];
  try { ciks = [...new Set(input.map(normalizeCik))]; } catch { throw new Error("invalid_ciks"); }
  if (ciks.length > SUBMISSIONS_RUNNER_MAX_CIKS) throw new Error("too_many_ciks");
  return ciks;
}

export function planSubmissionsRefresh(current: SecCurrentSubmissionsResult, at: Date):
  { plan: "initial" | "due" | "recent" } | { error: "current_unavailable" | "invalid_confirmed_at" } {
  if (!Number.isFinite(at.getTime())) throw new Error("invalid_clock");
  if (current.status === "unavailable") return { error: "current_unavailable" };
  if (current.status === "not-confirmed") return { plan: "initial" };
  const confirmed = Date.parse(current.confirmedAt);
  if (!Number.isFinite(confirmed) || confirmed > at.getTime()) return { error: "invalid_confirmed_at" };
  return { plan: at.getTime() - confirmed >= SUBMISSIONS_REFRESH_AGE_MS ? "due" : "recent" };
}

type OwnedSession = SecStructuredSqlClient & {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: "error" | "end", listener: () => void): unknown;
};
type RefreshResult = Awaited<ReturnType<SecSubmissionsRefreshService["refreshIssuerSubmissions"]>>;
export type SubmissionsRunnerItem = {
  cik: string;
  status: "planned" | "skipped" | "attempted" | "failed" | "not-run";
  plan?: "initial" | "due" | "recent";
  attempted: boolean;
  httpAttempts: number;
  previousConfirmedAt?: string;
  error?: string;
  result?: RefreshResult; // Preserve publication verbatim, including superseded.
};
export type SubmissionsRunnerReport = {
  mode: "dry-run" | "apply";
  status: "completed" | "failed" | "busy";
  database?: string;
  backendPid?: number;
  errors: string[];
  items: SubmissionsRunnerItem[];
  refreshInvocations: number;
  httpAttempts: number;
  lockAcquired: boolean;
  lockReleased: boolean;
  connectionClosed: boolean;
};

/** Owns a single direct/session connection. No pool reuse/reconnect, scheduler or target discovery.
 * Test injection never supplies archived documents to the refresh service.
 */
export async function runSubmissionsRefresh(input: {
  ciks: readonly unknown[];
  apply?: boolean;
  expectedDatabase?: string;
}, options: {
  environment?: ServerPostgresEnvironment;
  now?: () => Date;
  monotonicNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImplementation?: typeof fetch;
  createClient?: (config: pg.ClientConfig) => OwnedSession;
} = {}): Promise<SubmissionsRunnerReport> {
  // Validate before client construction, DB access or network access.
  const ciks = validateRefreshCiks(input.ciks);
  if (input.apply && !input.expectedDatabase?.trim()) throw new Error("expected_database_required");
  const environment = options.environment ?? process.env;
  let connectionString: string;
  try { connectionString = requireServerPostgresUrl(environment); } catch { throw new Error("database_url_required"); }
  const userAgent = environment.SEC_USER_AGENT?.trim();
  if (input.apply && !userAgent) throw new Error("sec_user_agent_required");
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const report: SubmissionsRunnerReport = {
    mode: input.apply ? "apply" : "dry-run", status: "completed", errors: [],
    items: ciks.map(cik => ({ cik, status: "not-run", attempted: false, httpAttempts: 0 })),
    refreshInvocations: 0, httpAttempts: 0, lockAcquired: false, lockReleased: false, connectionClosed: false,
  };
  let session: OwnedSession | undefined;
  let lost = false, closing = false, transactionOpen = false, cleanupFailed = false;
  const sessionAbort = new AbortController();
  const loseSession = () => { if (!closing) { lost = true; sessionAbort.abort(); } };
  const healthy = () => !lost && !cleanupFailed && !transactionOpen;
  const fail = (code: string) => { report.status = "failed"; report.errors.push(code); };
  try {
    session = (options.createClient ?? (config => new pg.Client(config)))({
      connectionString, connectionTimeoutMillis: 5000, statement_timeout: 30_000,
      query_timeout: 35_000, application_name: "sec_submissions_refresh_runner_v1",
    });
    session.on("error", loseSession);
    session.on("end", loseSession);
    await session.connect();
    const client: SecStructuredSqlClient = {
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (lost || cleanupFailed) throw new Error("session_unusable");
        const command = sql.trim().toLowerCase();
        try {
          const result = await session!.query<Row>(sql, values);
          if (command === "begin") transactionOpen = true;
          if (command === "commit" || command === "rollback") transactionOpen = false;
          if (lost) throw new Error("session_unusable");
          return result;
        } catch (error) {
          if (command === "rollback") cleanupFailed = true;
          const code = (error as { code?: string })?.code;
          // SQL errors can be recovered after the repository's rollback. Unknown
          // transport/query-timeout failures are conservatively fatal, never retried.
          if (!code || !/^[0-9A-Z]{5}$/.test(code) || code.startsWith("08") || code.startsWith("57P0")) loseSession();
          throw error;
        }
      },
    };
    const identity = (await client.query<{ database: string; pid: number }>(
      "select current_database() as database, pg_backend_pid() as pid",
    )).rows[0];
    report.database = identity.database;
    report.backendPid = identity.pid;
    if (input.apply && identity.database !== input.expectedDatabase) {
      fail("database_mismatch");
      return report;
    }
    if (input.apply) {
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock($1::int, $2::int) as acquired", [...SUBMISSIONS_RUNNER_LOCK],
      );
      if (!lock.rows[0].acquired) { report.status = "busy"; return report; }
      report.lockAcquired = true;
    }
    let activeItem: SubmissionsRunnerItem | undefined;
    const transport = options.fetchImplementation ?? fetch;
    // One service/policy for the entire batch. Count actual HTTP attempts below
    // that policy, separately from refresh invocations and sequence allocations.
    const service = input.apply ? new SecSubmissionsRefreshService(
      new PostgresSecStructuredRepository(client), userAgent!, {
        now,
        fetchImplementation: async (request, init) => {
          if (!healthy()) throw new Error("session_unusable");
          report.httpAttempts++;
          activeItem!.httpAttempts++;
          return transport(request, { ...init, signal: AbortSignal.any(
            init?.signal ? [init.signal, sessionAbort.signal] : [sessionAbort.signal],
          ) });
        },
      },
    ) : undefined;
    let lastStart: number | undefined;
    for (const item of report.items) {
      if (!healthy()) { fail("session_unusable"); break; }
      // Apply always reads here, AFTER obtaining the session lock; no saved plan input.
      const current = await readCurrentIssuerSubmissions(client, { cik: item.cik });
      if (!healthy()) { item.status = "failed"; item.error = "session_unusable"; fail(item.error); break; }
      const decision = planSubmissionsRefresh(current, now());
      if (current.status === "available") item.previousConfirmedAt = current.confirmedAt;
      if ("error" in decision) { item.status = "failed"; item.error = decision.error; fail(decision.error); continue; }
      item.plan = decision.plan;
      if (decision.plan === "recent") { item.status = "skipped"; continue; }
      item.status = "planned";
      if (!service) continue;
      if (lastStart !== undefined) {
        while (monotonicNow() - lastStart < SUBMISSIONS_RUNNER_INTERVAL_MS) {
          await sleep(SUBMISSIONS_RUNNER_INTERVAL_MS - (monotonicNow() - lastStart));
        }
      }
      if (!healthy()) { item.status = "not-run"; fail("session_unusable"); break; }
      lastStart = monotonicNow();
      activeItem = item;
      item.attempted = true;
      report.refreshInvocations++;
      try {
        item.result = await service.refreshIssuerSubmissions({ cik: item.cik });
        item.status = "attempted";
      } catch (error) {
        item.status = "failed";
        const blocked = error instanceof SecStructuredHttpError && [401, 403, 429].includes(error.status);
        item.error = !healthy() ? "session_unusable" : blocked ? "sec_access_blocked" : "refresh_failed";
        fail(item.error);
        if (blocked || !healthy()) break;
        // Verify the SAME backend is responsive and no aborted transaction remains.
        await client.query("select 1 as runner_health");
      }
    }
  } catch {
    fail(lost || cleanupFailed || transactionOpen ? "session_unusable" : "runner_failed");
  } finally {
    if (session) {
      if (lost || cleanupFailed || transactionOpen) {
        if (!report.errors.includes("session_unusable")) fail("session_unusable");
      }
      if (report.lockAcquired && !lost && !cleanupFailed && !transactionOpen) {
        try {
          const unlocked = await session.query<{ released: boolean }>(
            "select pg_advisory_unlock($1::int, $2::int) as released", [...SUBMISSIONS_RUNNER_LOCK],
          );
          report.lockReleased = unlocked.rows[0].released;
          if (!report.lockReleased) fail("lock_release_failed");
        } catch { fail("lock_release_failed"); }
      }
      // Closing this owned session also releases its locks after a broken connection
      // or rollback failure. No shared pool, backend replacement or unlock-all.
      closing = true;
      try { await session.end(); report.connectionClosed = true; } catch { fail("connection_close_failed"); }
    }
  }
  return report;
}
