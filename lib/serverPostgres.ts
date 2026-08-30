import "server-only";

// @ts-expect-error The project uses pg without a separate declaration package.
import pg from "pg";

export const SERVER_POSTGRES_URL_ENV = "SUPABASE_DB_URL" as const;

export type ServerPostgresEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type ServerPostgresQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> = {
  rows: Row[];
  rowCount: number | null;
};

export type ServerPostgresClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<ServerPostgresQueryResult<Row>>;
  release(): void;
};

export type ServerPostgresPool = {
  connect(): Promise<ServerPostgresClient>;
  end(): Promise<void>;
};

export function requireServerPostgresUrl(
  environment: ServerPostgresEnvironment = process.env,
) {
  const connectionString = environment[SERVER_POSTGRES_URL_ENV]?.trim();
  if (!connectionString) {
    throw new Error(
      `${SERVER_POSTGRES_URL_ENV} is required for server-side PostgreSQL access`,
    );
  }
  return connectionString;
}

export function createServerPostgresPool(
  environment: ServerPostgresEnvironment = process.env,
): ServerPostgresPool {
  return new pg.Pool({
    connectionString: requireServerPostgresUrl(environment),
    max: 1,
  }) as ServerPostgresPool;
}

let sharedPool: ServerPostgresPool | undefined;

export function getServerPostgresPool() {
  sharedPool ??= createServerPostgresPool();
  return sharedPool;
}

export async function withServerPostgresClient<Result>(
  operation: (client: ServerPostgresClient) => Promise<Result>,
  pool: ServerPostgresPool = getServerPostgresPool(),
) {
  const client = await pool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

export async function withServerPostgresTransaction<Result>(
  operation: (client: ServerPostgresClient) => Promise<Result>,
  pool: ServerPostgresPool = getServerPostgresPool(),
) {
  return withServerPostgresClient(async (client) => {
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SET LOCAL statement_timeout = '30s'");
      const result = await operation(client);
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "PostgreSQL transaction and rollback both failed",
          );
        }
      }
      throw error;
    }
  }, pool);
}
