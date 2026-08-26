export const HISTORICAL_REPLAY_REQUIRED_MIGRATION = "20260822201302";
export const HISTORICAL_REPLAY_MIGRATION_PRECHECK_ONLY_FLAG = "--migration-precheck-only";

const REQUIRED_CAPABILITIES = [
  "issuer_common_class_universe_snapshot_v2",
  "authoritative_multi_class_share_history",
  "custom_canonical_security_class_identity",
] as const;

type RequiredCapability = typeof REQUIRED_CAPABILITIES[number];

export type HistoricalReplayMigrationGateResult = {
  requiredMigration: string;
  latestMigration: string;
  capabilities: Record<RequiredCapability, true>;
};

type MigrationQueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

const PREREQUISITE_QUERY = `
select
  (select pg_catalog.max(version)::text
     from supabase_migrations.schema_migrations) as latest_migration,
  exists (
    select 1
      from supabase_migrations.schema_migrations
     where version = $1
  ) as required_migration_applied,
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as relation_row
        on relation_row.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as namespace_row
        on namespace_row.oid = relation_row.relnamespace
     where namespace_row.nspname = 'public'
       and relation_row.relname = 'issuer_common_class_universe_snapshots'
       and constraint_row.contype = 'c'
       and pg_catalog.strpos(
         pg_catalog.pg_get_constraintdef(constraint_row.oid),
         'issuer-common-class-universe-snapshot-v2'
       ) > 0
  ) as issuer_common_class_universe_snapshot_v2,
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as relation_row
        on relation_row.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as namespace_row
        on namespace_row.oid = relation_row.relnamespace
     where namespace_row.nspname = 'public'
       and relation_row.relname = 'share_count_history'
       and constraint_row.contype = 'c'
       and pg_catalog.strpos(
         pg_catalog.pg_get_constraintdef(constraint_row.oid),
         'authoritative-multi-class-os-extraction-v1'
       ) > 0
  ) as authoritative_multi_class_share_history,
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as relation_row
        on relation_row.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as namespace_row
        on namespace_row.oid = relation_row.relnamespace
     where namespace_row.nspname = 'public'
       and relation_row.relname = 'share_count_history'
       and constraint_row.contype = 'c'
       and pg_catalog.strpos(
         pg_catalog.pg_get_constraintdef(constraint_row.oid),
         'custom:'
       ) > 0
  ) as custom_canonical_security_class_identity
`;

export async function assertHistoricalReplayMigrationPrerequisites(
  client: MigrationQueryClient,
): Promise<HistoricalReplayMigrationGateResult> {
  const result = await client.query(PREREQUISITE_QUERY, [HISTORICAL_REPLAY_REQUIRED_MIGRATION]);
  const row = result.rows[0];
  if (!row || result.rows.length !== 1 || !isMigrationVersion(row.latest_migration)) {
    throw new Error("historical_replay_migration_history_untrusted");
  }

  const requiredMigrationApplied = readBoolean(row, "required_migration_applied");
  const missingCapabilities = REQUIRED_CAPABILITIES.filter((capability) => !readBoolean(row, capability));
  if (!requiredMigrationApplied || missingCapabilities.length > 0) {
    const missing = [
      ...(!requiredMigrationApplied ? [`migration:${HISTORICAL_REPLAY_REQUIRED_MIGRATION}`] : []),
      ...missingCapabilities.map((capability) => `capability:${capability}`),
    ];
    throw new Error(`historical_replay_required_prerequisites_missing:${missing.join(",")}`);
  }

  return {
    requiredMigration: HISTORICAL_REPLAY_REQUIRED_MIGRATION,
    latestMigration: row.latest_migration,
    capabilities: Object.fromEntries(
      REQUIRED_CAPABILITIES.map((capability) => [capability, true]),
    ) as Record<RequiredCapability, true>,
  };
}

export function isHistoricalReplayMigrationPrecheckOnly(args: string[]): boolean {
  return args.includes(HISTORICAL_REPLAY_MIGRATION_PRECHECK_ONLY_FLAG);
}

function isMigrationVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{14}$/.test(value);
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error(`historical_replay_migration_history_untrusted:${key}`);
  }
  return value;
}
