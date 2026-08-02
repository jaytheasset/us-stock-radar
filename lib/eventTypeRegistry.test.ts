import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  eventTypeDefinitions,
  NEWS_EVENT_TYPE_VALUES,
} from "./eventTypeRegistry.ts";
import { PUBLIC_ALERT_CATEGORIES } from "./subscriptionPolicy.ts";

const migrationName = readdirSync("supabase/migrations").find((name) =>
  name.endsWith("_canonical_event_types.sql"),
);
assert.ok(migrationName, "canonical event type migration is missing");
const migration = readFileSync(
  `supabase/migrations/${migrationName}`,
  "utf8",
);

test("canonical storage registry is 17 public plus two internal types", () => {
  const publicCodes = PUBLIC_ALERT_CATEGORIES.map((category) => category.code);
  const storageCodes = eventTypeDefinitions.map((definition) => definition.code);

  assert.equal(publicCodes.length, 17);
  assert.equal(storageCodes.length, 19);
  assert.deepEqual(
    storageCodes.filter((code) => !publicCodes.includes(code as never)),
    ["operating_update", "other"],
  );
  assert.ok(publicCodes.includes("policy_regulation"));
  assert.ok(publicCodes.includes("macro_market"));
});

test("news literal tuple matches registry news support exactly", () => {
  assert.deepEqual(
    eventTypeDefinitions
      .filter((definition) => definition.sourceGroups.includes("news"))
      .map((definition) => definition.code)
      .sort(),
    [...NEWS_EVENT_TYPE_VALUES].sort(),
  );
});

test("migration payload matches registry fields and remains non-destructive", () => {
  const payloadMatch = migration.match(
    /\$event_types\$\s*([\s\S]*?)\s*\$event_types\$::jsonb/,
  );
  assert.ok(payloadMatch, "migration JSON payload is missing");
  const payload = JSON.parse(payloadMatch[1]) as Array<{
    badge_tone: string;
    category: string;
    code: string;
    description: string;
    label: string;
    source_groups: string[];
    status: string;
    visibility: string;
  }>;

  assert.deepEqual(
    payload,
    eventTypeDefinitions.map((definition) => ({
      code: definition.code,
      label: definition.label,
      category: definition.category,
      badge_tone: definition.tone,
      source_groups: definition.sourceGroups,
      status: definition.status,
      description: definition.description,
      visibility:
        definition.code === "operating_update" || definition.code === "other"
          ? "internal"
          : "public",
    })),
  );
  assert.match(migration, /on conflict \(code\) do update/i);
  assert.match(migration, /is distinct from/i);
  assert.doesNotMatch(migration, /\b(delete|truncate)\b\s+(from\s+)?public\.event_types/i);
  assert.doesNotMatch(migration, /browser-(news|filing)/i);
});
