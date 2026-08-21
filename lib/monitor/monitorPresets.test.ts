import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseListingMonitorCreateRequest } from "./listingMonitorApi.ts";
import {
  createListingMonitor,
  type ListingMonitorRepository,
} from "./listingMonitorPersistence.ts";
import {
  addListingMonitorDraftCondition,
  createListingMonitorDraftReview,
  formatListingMonitorConditionPreview,
  getListingMonitorDraftCreateGate,
  removeListingMonitorDraftCondition,
  replaceListingMonitorDraftCondition,
} from "./listingMonitorDraftReview.ts";
import {
  createMonitorPresetDraft,
  getMonitorAddConditionCatalog,
  getMonitorPresetCatalog,
  getMonitorPresetConditionSummary,
  validateMonitorAddConditionCatalog,
  validateMonitorPresetCatalog,
} from "./monitorPresets.ts";

const OWNER_ID = "a5000000-0000-4000-8000-000000000001";
const EXPECTED = [
  {
    id: "low-price-reverse-split",
    conditions: [
      { key: "market.price", operator: "lt", value: 1 },
      { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    ],
  },
  {
    id: "low-price-listing-risk",
    conditions: [
      { key: "market.price", operator: "lt", value: 1 },
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    ],
  },
  {
    id: "listing-deadline-risk",
    conditions: [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "listing.compliance_deadline", operator: "within_days", value: 30 },
    ],
  },
] as const;

test("Monitor recommendations expose exactly three Registry-valid domain presets", () => {
  const catalog = getMonitorPresetCatalog();
  assert.equal(catalog.length, 3);
  assert.deepEqual(catalog.map(({ id, conditions }) => ({ id, conditions })), EXPECTED);
  assert.deepEqual(catalog.map((preset) => preset.title), [
    "Low-price reverse split",
    "Low-price listing risk",
    "Listing deadline risk",
  ]);
  assert.deepEqual(catalog.map(({ category, priority }) => ({ category, priority })), [
    { category: "Corporate Actions", priority: 1 },
    { category: "Listing Risk", priority: 2 },
    { category: "Listing Risk", priority: 3 },
  ]);
  assert.equal(catalog.some((preset) => preset.id === "reverse-split-listing-risk"), false);
  assert.ok(catalog.every((preset) => preset.description.length > 0 && preset.category.length > 0));
  assert.ok(catalog.every((preset) => !preset.conditions.some((condition) => (
    condition.key === "corporate_action.action_stage"
  ))));
});

test("each preset creates the exact direct Draft, Registry preview, and ready Review", () => {
  const catalog = getMonitorPresetCatalog();
  const expectedPreviews = [
    ["Price — Below $1", "Corporate action — Reverse stock split"],
    ["Price — Below $1", "Listing event — Listing deficiency notice"],
    ["Listing event — Listing deficiency notice", "Compliance deadline — Within 30 days"],
  ];
  catalog.forEach((preset, index) => {
    const draft = createMonitorPresetDraft(preset.id);
    assert.equal(draft.draftStatus, "READY_FOR_REVIEW");
    assert.equal(draft.compilerStatus, "VALID");
    assert.deepEqual(draft.conditions, EXPECTED[index].conditions);
    assert.deepEqual(draft.mapped[0].conditions.map((preview) => preview.text), expectedPreviews[index]);
    assert.equal(draft.proposed.length, 0);
    assert.equal(draft.unresolvedCount, 0);
    const review = createListingMonitorDraftReview(draft);
    assert.deepEqual(review.conditions, EXPECTED[index].conditions);
    assert.deepEqual(review.proposals, []);
    assert.equal(getListingMonitorDraftCreateGate(review).ready, true);
    const summary = getMonitorPresetConditionSummary(preset);
    assert.equal(summary, expectedPreviews[index].join(" + "));
    assert.doesNotMatch(summary, /market\.price|corporate_action|listing\.|reverse_split|deficiency_notice|within_days|\blt\b/);
  });
});

test("Add condition catalog exposes only the curated Common and domain choices", () => {
  const groups = getMonitorAddConditionCatalog();
  assert.deepEqual(groups.map(({ title, options }) => ({ title, count: options.length })), [
    { title: "Common", count: 1 },
    { title: "Corporate Actions", count: 1 },
    { title: "Listing Risk", count: 4 },
  ]);
  assert.deepEqual(groups.flatMap((group) => group.options.map(({ title, condition }) => ({ title, condition }))), [
    { title: "Price", condition: { key: "market.price", operator: "lte", value: 1 } },
    { title: "Reverse stock split", condition: { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" } },
    { title: "Listing deficiency", condition: { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" } },
    { title: "Compliance deadline", condition: { key: "listing.compliance_deadline", operator: "within_days", value: 30 } },
    { title: "Delisting determination", condition: { key: "listing.event_kind", operator: "eq", value: "delisting_determination" } },
    { title: "Trading suspension", condition: { key: "listing.event_kind", operator: "eq", value: "trading_suspension" } },
  ]);
  assert.throws(() => validateMonitorAddConditionCatalog([]), /add_condition_catalog_empty/);
  assert.throws(() => validateMonitorAddConditionCatalog([{
    id: "invalid",
    category: "listing-risk",
    title: "Invalid",
    condition: { key: "listing.unknown", operator: "eq", value: "unknown" },
  }]), /registry_invalid/);
});

test("Add condition rejects duplicate or conflicting canonical conditions", () => {
  const review = createListingMonitorDraftReview(createMonitorPresetDraft("low-price-reverse-split"));
  const duplicate = addListingMonitorDraftCondition(review, {
    key: "market.price",
    operator: "lte",
    value: 1,
  });
  assert.equal(duplicate, review);
  const added = addListingMonitorDraftCondition(review, {
    key: "listing.event_kind",
    operator: "eq",
    value: "deficiency_notice",
  });
  assert.notEqual(added, review);
  assert.equal(getListingMonitorDraftCreateGate(added).ready, true);
  const conflict = addListingMonitorDraftCondition(added, {
    key: "listing.event_kind",
    operator: "eq",
    value: "delisting_determination",
  });
  assert.equal(conflict, added);
});

test("preset selection and catalog loading fail closed for empty, unknown, or drifted data", () => {
  assert.throws(() => validateMonitorPresetCatalog([]), /catalog_empty/);
  assert.throws(() => createMonitorPresetDraft("missing-preset"), /preset_unknown/);
  assert.throws(() => createMonitorPresetDraft("anything", []), /catalog_empty/);
  const forged = getMonitorPresetCatalog().map((preset, index) => index === 0
    ? { ...preset, conditions: [{ key: "market.removed", operator: "lt", value: 1 }] }
    : preset);
  assert.throws(() => validateMonitorPresetCatalog(forged), /condition_key_unknown/);
});

test("preset Review reuses price edits and deletion while final deletion blocks Create", () => {
  let review = createListingMonitorDraftReview(createMonitorPresetDraft("low-price-listing-risk"));
  review = replaceListingMonitorDraftCondition(review, 0, {
    key: "market.price",
    operator: "lte",
    value: 2,
  });
  assert.equal(formatListingMonitorConditionPreview(review.conditions[0]).text, "Price — $2 or less");
  assert.deepEqual(getListingMonitorDraftCreateGate(review).conditions, [
    { key: "market.price", operator: "lte", value: 2 },
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
  ]);
  review = removeListingMonitorDraftCondition(review, 1);
  assert.deepEqual(getListingMonitorDraftCreateGate(review).conditions, [
    { key: "market.price", operator: "lte", value: 2 },
  ]);
  review = removeListingMonitorDraftCondition(review, 0);
  const empty = getListingMonitorDraftCreateGate(review);
  assert.equal(empty.ready, false);
  assert.ok(empty.errors.includes("condition_set_empty"));
});

test("explicit Create API and persistence round-trip the exact edited preset conditions", async () => {
  let review = createListingMonitorDraftReview(createMonitorPresetDraft("low-price-reverse-split"));
  review = replaceListingMonitorDraftCondition(review, 0, {
    key: "market.price",
    operator: "lte",
    value: 2,
  });
  const gate = getListingMonitorDraftCreateGate(review);
  const parsed = parseListingMonitorCreateRequest({ conditions: gate.conditions });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const repository = createRoundTripRepository();
  const created = await createListingMonitor({ ownerId: OWNER_ID, conditions: parsed.value.conditions }, repository);
  assert.deepEqual(created.conditions, [
    { key: "market.price", operator: "lte", value: 2 },
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.deepEqual(repository.createdRows, [{
    user_id: OWNER_ID,
    domain: "listing",
    conditions: created.conditions,
    is_active: true,
  }]);
});

test("preset click path has zero Compiler or LLM calls and stays separate from natural language submit", () => {
  const presets = readProjectFile("lib/monitor/monitorPresets.ts");
  const builder = readProjectFile("components/alerts-v2/ListingMonitorDraftBuilder.tsx");
  const selectionStart = builder.indexOf("function selectPreset");
  const selectionEnd = builder.indexOf("  return (", selectionStart);
  const selection = builder.slice(selectionStart, selectionEnd);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
  assert.match(selection, /createMonitorPresetDraft/);
  assert.doesNotMatch(selection, /fetch\(|compileDraft|runStructuredGeminiJson|Gemini|LLM/i);
  assert.doesNotMatch(presets, /fetch\(|compileNaturalLanguageListingConditions|runStructuredGeminiJson|Gemini|LLM/i);
  assert.equal((builder.match(/\/api\/monitors\/listing\/compile/g) ?? []).length, 1);
  assert.match(builder, /onSubmit=\{compileDraft\}/);
  assert.ok(builder.indexOf("</form>") < builder.indexOf('<h2 id="recommended-monitors-title">Recommended monitors</h2>'));
  assert.match(builder, /body: JSON\.stringify\(\{ conditions: createGate\.conditions \}\)/);
});

function createRoundTripRepository(): ListingMonitorRepository & { createdRows: Record<string, unknown>[] } {
  const createdRows: Record<string, unknown>[] = [];
  return {
    createdRows,
    async create(row) {
      createdRows.push(row);
      return {
        ok: true,
        data: [{
          id: "a5000000-0000-4000-8000-000000000002",
          created_at: "2026-08-21T00:00:00.000Z",
          updated_at: "2026-08-21T00:00:00.000Z",
          ...row,
        }],
      };
    },
    async list() { return { ok: true, data: [] }; },
    async read() { return { ok: true, data: [] }; },
    async update() { return { ok: true, data: [] }; },
    async delete() { return { ok: true, data: [] }; },
  };
}

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
