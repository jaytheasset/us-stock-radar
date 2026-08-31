import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  applyDilutionRegistrySource,
  DILUTION_REGISTRY_APPLY_PERMISSION,
  DilutionRegistryApplyError,
  runAuthorizedDilutionRegistryApply,
} from "./applyContract.ts";
import { createDilutionRegistryPasteIdFromSource } from "./pasteIdentity.ts";
import { dilutionContractSourceRef } from "./corporateActionAdjustment.ts";

function sourceWithActivity(instrumentKey = "issuer-note-a") {
  return JSON.stringify({
    issuer: { issuer_cik: "0000000001", ticker: "TEST" },
    instruments: [
      {
        instrument_key: "issuer-note-a",
        instrument_type: "convertible_note",
        name: "Note A",
      },
    ],
    snapshots: [{ instrument_key: "issuer-note-a", status: "current" }],
    activities: [{ instrument_key: instrumentKey, activity_type: "issued" }],
    totals: [],
  });
}

function sourceWithClauseBinding(
  field = "remaining_units",
  supersedesBindingId: string | null = null,
) {
  const value = JSON.parse(sourceWithActivity()) as Record<string, unknown>;
  const rawItemId = "11111111-1111-4111-8111-111111111111";
  const sourceDocumentUrl = "https://www.sec.gov/Archives/edgar/data/1/000000000124000001/contract.htm";
  const sourceRef = dilutionContractSourceRef(rawItemId, sourceDocumentUrl);
  value.corporate_action_clause_bindings = [{
    instrument_key: "issuer-note-a",
    execution_id: `fse:v1:${"a".repeat(64)}`,
    canonical_security_class_id: "sc:v1:0000000001:common_stock:single",
    contract_accession: "0000000001-24-000001",
    contract_raw_item_id: rawItemId,
    source_ref: sourceRef,
    source_document_url: sourceDocumentUrl,
    field_adjustments: [{
      field,
      operation: "multiply_by_split_ratio",
      evidence_identity: {
        version: "corporate_action_evidence_identity_v1",
        source_ref: sourceRef,
        range_start: 0,
        range_end: 6,
        source_content_hash: createHash("sha256").update("clause").digest("hex"),
        exact_source: true,
      },
    }],
    ...(supersedesBindingId ? { supersedes_binding_id: supersedesBindingId } : {}),
  }];
  return JSON.stringify(value);
}

test("the server verifies identity and invokes the existing RPC exactly once", async () => {
  const source = `\n${sourceWithActivity()}\n`;
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await applyDilutionRegistrySource(source, {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return {
        ok: true,
        data: {
          already_saved: false,
          added: { instruments: 1, snapshots: 1, activities: 1, totals: 0 },
        },
      };
    },
  });

  assert.deepEqual(result, { status: "saved" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "apply_dilution_registry_v1");
  assert.equal(calls[0].payload.p_source, source);
  assert.equal(
    calls[0].payload.p_paste_id,
    createDilutionRegistryPasteIdFromSource(source),
  );
  assert.deepEqual(calls[0].payload.p_payload, JSON.parse(source));
});

test("an exact replay is mapped without leaking the RPC response", async () => {
  const result = await applyDilutionRegistrySource(sourceWithActivity(), {
    async rpc() {
      return {
        ok: true,
        data: {
          already_saved: true,
          paste_id: "must-not-leak",
          added: { instruments: 0, snapshots: 0, activities: 0, totals: 0 },
        },
      };
    },
  });
  assert.deepEqual(result, { status: "already_saved" });
  assert.equal("paste_id" in result, false);
});

test("Registry Apply treats clause bindings as sidecars while persisting them and invoking the hook", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const hooks: unknown[] = [];
  const source = sourceWithClauseBinding();
  const result = await applyDilutionRegistrySource(source, {
    now: () => new Date("2024-06-26T20:00:00Z"),
    async rpc(name, payload) {
      calls.push({ name, payload });
      if (name === "apply_dilution_registry_v1") {
        return {
          ok: true,
          data: {
            already_saved: true,
            added: { instruments: 0, snapshots: 0, activities: 0, totals: 0 },
          },
        };
      }
      const binding = payload.p_binding as Record<string, unknown>;
      return {
        ok: true,
        data: {
          already_saved: false,
          binding_id: binding.bindingId,
          added: 1,
        },
      };
    },
    async runCorporateActionAdjustmentForIssuer(input) {
      hooks.push(input);
      return { status: "completed" };
    },
  });

  assert.deepEqual(result, { status: "already_saved" });
  assert.deepEqual(calls.map((call) => call.name), [
    "apply_dilution_registry_v1",
    "append_dilution_corporate_action_clause_binding_v1",
  ]);
  assert.match(
    String((calls[1]?.payload.p_binding as Record<string, unknown>)?.bindingId),
    /^dcab:v1:[0-9a-f]{64}$/,
  );
  assert.equal(calls[0]?.payload.p_source, sourceWithActivity());
  assert.equal(
    calls[0]?.payload.p_paste_id,
    createDilutionRegistryPasteIdFromSource(sourceWithActivity()),
  );
  assert.deepEqual(calls[0]?.payload.p_payload, JSON.parse(sourceWithActivity()));
  assert.equal(
    Object.hasOwn(
      calls[0]?.payload.p_payload as Record<string, unknown>,
      "corporate_action_clause_bindings",
    ),
    false,
  );
  assert.deepEqual(hooks, [{
    issuerCik: "0000000001",
    targetAt: "2024-06-26T20:00:00.000Z",
  }]);
});

test("binding-only add, superseding change, and replay add no Registry identity", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const sources = [
    sourceWithClauseBinding(),
    sourceWithClauseBinding(
      "remaining_potential_shares",
      `dcab:v1:${"b".repeat(64)}`,
    ),
    sourceWithClauseBinding(),
  ];
  for (const [attempt, source] of sources.entries()) {
    const result = await applyDilutionRegistrySource(source, {
      async rpc(name, payload) {
        calls.push({ name, payload });
        if (name === "apply_dilution_registry_v1") {
          return {
            ok: true,
            data: {
              already_saved: true,
              added: { instruments: 0, snapshots: 0, activities: 0, totals: 0 },
            },
          };
        }
        return {
          ok: true,
          data: {
            already_saved: attempt === 2,
            binding_id: String((payload.p_binding as Record<string, unknown>).bindingId),
            added: attempt === 2 ? 0 : 1,
          },
        };
      },
      async runCorporateActionAdjustmentForIssuer() {
        return { status: "completed" };
      },
    });
    assert.deepEqual(result, { status: "already_saved" });
  }

  const registryCalls = calls.filter((call) => call.name === "apply_dilution_registry_v1");
  assert.equal(registryCalls.length, 3);
  assert.deepEqual(
    registryCalls.map((call) => call.payload.p_source),
    [sourceWithActivity(), sourceWithActivity(), sourceWithActivity()],
  );
  assert.equal(registryCalls[0]?.payload.p_paste_id, registryCalls[1]?.payload.p_paste_id);
  assert.equal(registryCalls[1]?.payload.p_paste_id, registryCalls[2]?.payload.p_paste_id);
});

test("a bad linked instrument key is rejected before any write", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      applyDilutionRegistrySource(sourceWithActivity("missing-note"), {
        async rpc() {
          calls += 1;
          throw new Error("must not be reached");
        },
      }),
    (error: unknown) =>
      error instanceof DilutionRegistryApplyError &&
      error.kind === "invalid_source",
  );
  assert.equal(calls, 0);
});

test("O/S-only edits keep the same Registry RPC identity and payload", async () => {
  const registrySource = sourceWithActivity();
  const combined = registrySource.replace(
    /}$/, ',"os_observations":[{"shares_outstanding":"10"}]}',
  );
  const calls: Array<Record<string, unknown>> = [];
  for (const source of [combined, combined.replace('"10"', '"11"')]) {
    await applyDilutionRegistrySource(source, {
      async rpc(_name, payload) {
        calls.push(payload);
        return {
          ok: true,
          data: {
            already_saved: true,
            added: { instruments: 0, snapshots: 0, activities: 0, totals: 0 },
          },
        };
      },
    });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.p_source, registrySource);
  assert.equal(calls[1]?.p_source, registrySource);
  assert.equal(calls[0]?.p_paste_id, calls[1]?.p_paste_id);
  assert.deepEqual(calls[0]?.p_payload, JSON.parse(registrySource));
});

test("an invalid RPC result fails closed", async () => {
  await assert.rejects(
    () =>
      applyDilutionRegistrySource(sourceWithActivity(), {
        async rpc() {
          return { ok: true, data: { already_saved: false } };
        },
      }),
    (error: unknown) =>
      error instanceof DilutionRegistryApplyError &&
      error.kind === "unavailable",
  );
});

test("Apply denies unauthenticated and data.read-only users, then allows data.run", async () => {
  async function attempt(permissions: readonly string[]) {
    let applies = 0;
    const run = runAuthorizedDilutionRegistryApply({
      async authorize(permission) {
        assert.equal(permission, DILUTION_REGISTRY_APPLY_PERMISSION);
        if (!permissions.includes(permission)) {
          throw Object.assign(new Error("denied"), {
            status: permissions.length ? 403 : 401,
          });
        }
        return { userId: "admin-user" };
      },
      async apply() {
        applies += 1;
        return { status: "saved" as const };
      },
    });
    return { run, applies: () => applies };
  }

  const unauthenticated = await attempt([]);
  await assert.rejects(unauthenticated.run, { status: 401 });
  assert.equal(unauthenticated.applies(), 0);

  const readOnly = await attempt(["data.read"]);
  await assert.rejects(readOnly.run, { status: 403 });
  assert.equal(readOnly.applies(), 0);

  const runner = await attempt(["data.read", "data.run"]);
  assert.deepEqual(await runner.run, {
    access: { userId: "admin-user" },
    result: { status: "saved" },
  });
  assert.equal(runner.applies(), 1);
});
