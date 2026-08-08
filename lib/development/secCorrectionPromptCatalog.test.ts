import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SEC_CORRECTION_PROMPT_CATALOG } from "./secCorrectionPromptCatalog.ts";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("the SEC correction catalog contains all fixed prompt groups and nonempty instructions", () => {
  const expectedRooms = [
    "ownership",
    "8k-6k",
    "s1-f1",
    "s3-f3",
    "s4-f4",
    "425",
    "424b",
    "tender",
    "proxy",
    "periodic-reports",
    "s8",
    "sc13",
    "nt",
  ];

  assert.deepEqual(SEC_CORRECTION_PROMPT_CATALOG.map((entry) => entry.roomKey), expectedRooms);
  assert.equal(new Set(SEC_CORRECTION_PROMPT_CATALOG.map((entry) => entry.promptKey)).size, 13);
  for (const entry of SEC_CORRECTION_PROMPT_CATALOG) {
    assert.ok(entry.displayName.trim());
    assert.match(entry.promptKey, /^sec_.+_validation_repair$/);
    assert.ok(entry.version.trim());
    assert.ok(entry.formGroup.trim());
    assert.ok(entry.instructions.trim().length > 100);
  }
});

test("the static catalog stays isolated from SEC runtime analysis and repair modules", () => {
  const catalog = read("lib/development/secCorrectionPromptCatalog.ts");
  const dashboard = read("lib/development/secFormDevDashboard.ts");
  const client = read("app/development/sec/SecDevelopmentClient.tsx");

  assert.doesNotMatch(catalog, /from\s+["']@\/lib\/ai\//);
  assert.doesNotMatch(catalog, /node:fs|process\.cwd|Symbol\s*\(/);
  assert.match(dashboard, /getSecCorrectionPromptsForRoom\(room\.key\)/);
  assert.match(client, /Static reference copy of the fixed correction instructions\. This is not actual run data\./);
  assert.match(client, /View SEC debug console prompt details on desktop\./);
  assert.doesNotMatch(catalog, /validation_repair_trace|repair_prompt|original_source_blocks/);
});

test("analysis prompt previews use fixed human labels without exposing extractor fallback names", () => {
  const dashboard = read("lib/development/secFormDevDashboard.ts");
  const client = read("app/development/sec/SecDevelopmentClient.tsx");

  assert.match(dashboard, /Active analysis prompt — Sectioned/);
  assert.match(dashboard, /Legacy backup — pre-sectioned/);
  assert.match(dashboard, /Active analysis prompt — Pending terms/);
  assert.match(dashboard, /Legacy backup — pre-pending terms/);
  assert.match(dashboard, /s4-f4:analysisPrompt\.ts:RETURNED_ARRAY_PROMPT_1/);
  assert.match(dashboard, /s8:analysisPrompt\.ts:RETURNED_ARRAY_PROMPT_2/);
  assert.match(dashboard, /sc13:analysisPrompt\.ts:RETURNED_PROMPT_1/);
  assert.match(dashboard, /allowReturnedFallback: file\.endsWith\("Prompt\.ts"\)/);
  assert.doesNotMatch(client, /<p>\{prompt\.name\}<\/p>/);
  assert.match(client, /promptRoleBadges/);
});
