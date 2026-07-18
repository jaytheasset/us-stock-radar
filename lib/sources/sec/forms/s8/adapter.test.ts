import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const roomDir = dirname(fileURLToPath(import.meta.url));

test("S-8 adapter exposes live-integration entrypoint metadata", () => {
  const adapterSource = readFileSync(join(roomDir, "adapter.ts"), "utf8");

  assert.match(adapterSource, /SEC_S8_ADAPTER_KEY = "sec_s8"/);
  assert.match(adapterSource, /SEC_S8_PARSER_GROUP = "s8"/);
  assert.match(adapterSource, /SEC_S8_ANALYSIS_MODE = "analysis_only"/);
  assert.match(adapterSource, /import \{ SEC_S8_FORMS \} from "\.\.\/common\/forms"/);
  assert.match(adapterSource, /SEC_S8_SUPPORTED_FORMS = SEC_S8_FORMS/);
  assert.match(adapterSource, /parseS8FormRoomFiling/);
  assert.doesNotMatch(adapterSource, /buildS8DisplayPayload/);
  assert.doesNotMatch(adapterSource, /buildDisplayPayload/);
});

test("S-8 index re-exports adapter but not parser-authored display payload modules", () => {
  const indexSource = readFileSync(join(roomDir, "index.ts"), "utf8");

  assert.match(indexSource, /export \* from "\.\/adapter"/);
  assert.doesNotMatch(indexSource, /export \* from "\.\/displayPayload"/);
});
