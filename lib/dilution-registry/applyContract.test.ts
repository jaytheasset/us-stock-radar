import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDilutionRegistrySource,
  DILUTION_REGISTRY_APPLY_PERMISSION,
  DilutionRegistryApplyError,
  runAuthorizedDilutionRegistryApply,
} from "./applyContract.ts";
import { createDilutionRegistryPasteIdFromSource } from "./pasteIdentity.ts";

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
