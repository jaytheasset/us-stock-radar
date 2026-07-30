import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260730122220_live_room_klipy_media.sql",
    import.meta.url,
  ),
  "utf8",
);

for (const contract of [
  "live_room_message_media",
  "provider = 'klipy'",
  "media_kind = 'gif'",
  "static.klipy.com",
  "https://klipy.com/",
  "enable row level security",
  "insert_live_room_message_with_attachments",
  "security invoker",
  "set search_path = ''",
]) {
  assert.ok(
    migration.replaceAll("\\", "").includes(contract),
    `missing schema contract: ${contract}`,
  );
}
assert.doesNotMatch(migration, /grant\s+.*\s+to\s+(anon|authenticated)/i);
console.log("KLIPY schema contracts verified.");
