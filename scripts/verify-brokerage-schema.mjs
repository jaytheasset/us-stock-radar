import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260729211748_brokerage_proof_foundation.sql",
  "utf8",
);
const refreshMigration = readFileSync(
  "supabase/migrations/20260730131500_brokerage_manual_refresh_quota.sql",
  "utf8",
);

for (const table of [
  "brokerage_connections",
  "brokerage_proofs",
  "brokerage_proof_status",
  "live_room_message_brokerage_proofs",
  "live_room_post_brokerage_proofs",
  "brokerage_webhook_events",
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
}
assert.match(migration, /security invoker/gi);
assert.doesNotMatch(migration, /security definer/i);
assert.match(migration, /BROKERAGE_PROOF_IMMUTABLE/);
assert.match(migration, /BROKERAGE_PUBLIC_SHARING_DISABLED/);
assert.match(migration, /create_live_room_post_with_proof/);
assert.match(migration, /insert_live_room_message_with_proof/);
assert.doesNotMatch(migration, /account_number|market_value|market_price|\n\s*user_secret\s+text/i);

assert.match(
  refreshMigration,
  /alter table public\.brokerage_manual_refreshes enable row level security/i,
);
assert.match(
  refreshMigration,
  /revoke all on table public\.brokerage_manual_refreshes\s+from public, anon, authenticated/i,
);
assert.match(
  refreshMigration,
  /grant select, insert, update on table public\.brokerage_manual_refreshes\s+to service_role/i,
);
assert.match(refreshMigration, /reserve_brokerage_manual_refresh/i);
assert.match(refreshMigration, /record_brokerage_manual_refresh_webhook/i);
assert.match(refreshMigration, /pg_catalog\.pg_advisory_xact_lock/i);
assert.match(
  refreshMigration,
  /counted_at is null or status = 'succeeded'/i,
);
for (const functionName of [
  "reserve_brokerage_manual_refresh",
  "record_brokerage_manual_refresh_webhook",
]) {
  assert.match(
    refreshMigration,
    new RegExp(
      `revoke all on function public\\.${functionName}[\\s\\S]+from public, anon, authenticated`,
      "i",
    ),
  );
  assert.match(
    refreshMigration,
    new RegExp(
      `grant execute on function public\\.${functionName}[\\s\\S]+to service_role`,
      "i",
    ),
  );
}
assert.doesNotMatch(
  refreshMigration,
  /\buser_secret\b|\bconsumer_key\b|\bprovider_token\b/i,
);
console.log("Brokerage schema contract verified.");
