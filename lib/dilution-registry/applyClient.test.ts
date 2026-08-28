import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDilutionRegistryApplyRequestBody,
  DILUTION_REGISTRY_APPLY_MESSAGES,
  isDilutionRegistryApplyEnabled,
  readDilutionRegistryApplyResponse,
} from "./applyClient.ts";
import { parseDilutionRegistryJson } from "./preview.ts";

const validSource = JSON.stringify({
  instruments: [
    {
      instrument_key: "issuer-note-a",
      instrument_type: "convertible_note",
      name: "Note A",
    },
  ],
  snapshots: [{ instrument_key: "issuer-note-a", status: "current" }],
  activities: [],
  totals: [],
});

test("Apply stays disabled before Preview and after an invalid Preview", () => {
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: true,
      previewedSource: null,
      source: validSource,
      state: "idle",
    }),
    false,
  );

  const invalidSource = '{"instruments":[]}';
  assert.equal(parseDilutionRegistryJson(invalidSource).ok, false);
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: true,
      previewedSource: null,
      source: invalidSource,
      state: "idle",
    }),
    false,
  );
});

test("a successful Preview enables Apply only while the source is unchanged", () => {
  assert.equal(parseDilutionRegistryJson(validSource).ok, true);
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: true,
      previewedSource: validSource,
      source: validSource,
      state: "idle",
    }),
    true,
  );
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: true,
      previewedSource: validSource,
      source: `${validSource}\n`,
      state: "idle",
    }),
    false,
    "any text edit invalidates the Preview snapshot",
  );
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: false,
      previewedSource: validSource,
      source: validSource,
      state: "idle",
    }),
    false,
    "view-only administrators cannot Apply",
  );
});

test("the Apply request body is the exact text that produced Preview", () => {
  const exactSource = ` {\r\n  "instruments": [],\r\n  "snapshots": [],\r\n  "activities": [],\r\n  "totals": [],\r\n  "note": "한글"\r\n}`;
  assert.equal(parseDilutionRegistryJson(exactSource).ok, true);
  const body = createDilutionRegistryApplyRequestBody({
    previewedSource: exactSource,
    source: exactSource,
  });
  assert.deepEqual(Buffer.from(body, "utf8"), Buffer.from(exactSource, "utf8"));
  assert.throws(
    () =>
      createDilutionRegistryApplyRequestBody({
        previewedSource: exactSource,
        source: exactSource.replace("한글", "changed"),
      }),
    /fresh successful Preview/,
  );
});

test("saved, replay, saving, and error states use the required copy", () => {
  assert.equal(DILUTION_REGISTRY_APPLY_MESSAGES.saving, "Saving...");
  assert.equal(DILUTION_REGISTRY_APPLY_MESSAGES.saved, "Registry saved.");
  assert.equal(
    DILUTION_REGISTRY_APPLY_MESSAGES.already_saved,
    "Already saved.",
  );
  assert.equal(
    DILUTION_REGISTRY_APPLY_MESSAGES.error,
    "Could not save the Registry.",
  );
  assert.equal(readDilutionRegistryApplyResponse({ status: "saved" }), "saved");
  assert.equal(
    readDilutionRegistryApplyResponse({ status: "already_saved" }),
    "already_saved",
  );
  assert.equal(readDilutionRegistryApplyResponse({ status: "internal" }), null);
});

test("the browser surface sends only exact source text to the admin endpoint", () => {
  const component = readFileSync(
    "components/admin/DilutionRegistryPreview.tsx",
    "utf8",
  );
  assert.match(component, /body: requestBody/);
  assert.match(component, /\/api\/admin\/data\/dilution-registry\/apply/);
  assert.doesNotMatch(
    component,
    /SUPABASE_SERVICE_ROLE_KEY|service_role|supabaseRpc|\.rpc\(/,
  );
});
