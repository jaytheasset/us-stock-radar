import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDilutionRegistryApplyRequestBody,
  DILUTION_REGISTRY_APPLY_MESSAGES,
  DILUTION_REGISTRY_RESULT_LABELS,
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

test("a successfully Previewed combined source enables the same one Apply", async () => {
  const source = JSON.stringify({
    ...JSON.parse(validSource),
    os_observations: [{ observation_type: "source_stated" }],
  });
  assert.equal(
    isDilutionRegistryApplyEnabled({
      canApply: true,
      previewedSource: source,
      source,
      state: "idle",
    }),
    true,
  );
  assert.equal(
    await createDilutionRegistryApplyRequestBody({ previewedSource: source, source }),
    source,
  );
});

test("the Apply request body is the exact text that produced Preview", async () => {
  const exactSource = ` {\r\n  "instruments": [],\r\n  "snapshots": [],\r\n  "activities": [],\r\n  "totals": [],\r\n  "note": "한글"\r\n}`;
  assert.equal(parseDilutionRegistryJson(exactSource).ok, true);
  const body = await createDilutionRegistryApplyRequestBody({
    previewedSource: exactSource,
    source: exactSource,
  });
  assert.deepEqual(Buffer.from(body, "utf8"), Buffer.from(exactSource, "utf8"));
  await assert.rejects(
    () =>
      createDilutionRegistryApplyRequestBody({
        previewedSource: exactSource,
        source: exactSource.replace("한글", "changed"),
      }),
    /fresh successful Preview/,
  );
});

test("combined result states use separate required English labels", () => {
  assert.equal(DILUTION_REGISTRY_APPLY_MESSAGES.saving, "Saving...");
  assert.equal(DILUTION_REGISTRY_APPLY_MESSAGES.complete, "Apply complete.");
  assert.equal(
    DILUTION_REGISTRY_APPLY_MESSAGES.error,
    "Could not save the Registry.",
  );
  assert.deepEqual(DILUTION_REGISTRY_RESULT_LABELS.registry, {
    saved: "Saved", already_saved: "Already Saved", failed: "Failed",
  });
  assert.deepEqual(DILUTION_REGISTRY_RESULT_LABELS.sharesOutstanding, {
    saved: "Saved", already_saved: "Already Saved", skipped: "Skipped", failed: "Failed",
  });
  assert.deepEqual(readDilutionRegistryApplyResponse({
    ok: true,
    registry: { status: "already_saved" },
    sharesOutstanding: {
      status: "saved", verifierStatus: "Verified", reasons: [],
    },
  }), {
    registry: { status: "already_saved" },
    sharesOutstanding: {
      status: "saved", verifierStatus: "Verified", reasons: [],
    },
  });
  assert.equal(readDilutionRegistryApplyResponse({
    ok: false,
    registry: { status: "saved" },
    sharesOutstanding: {
      status: "skipped", verifierStatus: null, reasons: [],
    },
    offeringMonitorAlerts: { status: "failed" },
  }), null);
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
