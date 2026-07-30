import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260729211748_brokerage_proof_foundation.sql",
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
console.log("Brokerage schema contract verified.");
