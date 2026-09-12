import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getReadyMonitorConditions,
  SECTION16_MONITOR_CONDITION_REGISTRY,
  validateMonitorConditionInput,
  validateSection16MonitorConditionInput,
} from "./conditionRegistry.ts";
import { getListingMonitorConditionEditorCatalog } from "./listingMonitorDraftReview.ts";
import { getListingConditionCompilerRegistryContext } from "../prompts/naturalLanguageConditionCompiler.ts";

test("manual Section 16 conditions are absent from UI, AI prompt, public validator, and Alert consumer", () => {
  const keys = SECTION16_MONITOR_CONDITION_REGISTRY.map((entry) => entry.key);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((key) => !getReadyMonitorConditions().some((entry) => entry.key === key)));
  assert.ok(keys.every((key) => !getListingMonitorConditionEditorCatalog().some((entry) => entry.key === key)));
  assert.ok(keys.every((key) => !getListingConditionCompilerRegistryContext().some((entry) => entry.key === key)));
  const example = { key: keys[0], operator: "eq", value: "non_derivative" };
  assert.deepEqual(validateMonitorConditionInput(example), ["condition_key_unknown"]);
  assert.deepEqual(validateSection16MonitorConditionInput(example), []);

  const consumerSource = readFileSync(new URL("./listingMonitorAlertConsumer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(consumerSource, /section16Monitor|readSection16Monitor/i);
});
