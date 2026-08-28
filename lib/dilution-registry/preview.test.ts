import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDilutionRegistryPreviewModel,
  parseDilutionRegistryJson,
} from "./preview.ts";

const validPayload = JSON.stringify({
  instruments: [{ instrument_key: "note-one", name: "Note One" }],
  snapshots: [
    { instrument_key: "note-one", status: "current", remaining_amount: null },
  ],
  activities: [
    {
      instrument_key: null,
      related_instrument_keys: ["note-one"],
      shares_issued: 12,
    },
  ],
  totals: [{ included_instrument_keys: ["note-one"], total_amount: 100 }],
});

test("preview accepts the four lists, nullable activity key, and related keys", () => {
  const result = parseDilutionRegistryJson(validPayload);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.payload.snapshots[0]?.remaining_amount, null);
  const model = createDilutionRegistryPreviewModel(result.payload);
  assert.deepEqual(model.summary, {
    instruments: 1,
    snapshots: 1,
    current: 1,
    old: 0,
    closed: 0,
    activities: 1,
    totals: 1,
  });
});

test("preview reports malformed JSON and missing top-level lists in easy language", () => {
  assert.deepEqual(parseDilutionRegistryJson("{"), {
    ok: false,
    errors: ["JSON 형식이 잘못되었습니다."],
  });

  const result = parseDilutionRegistryJson('{"instruments":[]}');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors, [
    "Snapshots 목록을 찾을 수 없습니다.",
    "Activities 목록을 찾을 수 없습니다.",
    "Totals 목록을 찾을 수 없습니다.",
  ]);
});

test("preview rejects duplicate and missing instrument links", () => {
  const duplicate = parseDilutionRegistryJson(
    JSON.stringify({
      instruments: [
        { instrument_key: "same" },
        { instrument_key: "same" },
      ],
      snapshots: [{ instrument_key: "missing" }],
      activities: [
        { instrument_key: "missing" },
        { instrument_key: null, related_instrument_keys: ["also-missing"] },
      ],
      totals: [{ included_instrument_keys: ["missing"] }],
    }),
  );

  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.deepEqual(duplicate.errors, [
    "같은 Instrument Key가 두 번 있습니다: same",
    "이 Snapshot에 연결된 Instrument를 찾을 수 없습니다: missing",
    "이 Activity에 연결된 Instrument를 찾을 수 없습니다: missing",
    "이 Activity의 Related Instrument를 찾을 수 없습니다: also-missing",
    "이 Total에 포함된 Instrument를 찾을 수 없습니다: missing",
  ]);
});

test("instrument without a snapshot is not assigned a status", () => {
  const model = createDilutionRegistryPreviewModel({
    instruments: [{ instrument_key: "no-snapshot", name: "No Snapshot" }],
    snapshots: [],
    activities: [],
    totals: [],
  });

  assert.deepEqual(
    {
      current: model.summary.current,
      old: model.summary.old,
      closed: model.summary.closed,
      currentRows: model.current.length,
      oldRows: model.old.length,
      closedRows: model.closed.length,
    },
    {
      current: 0,
      old: 0,
      closed: 0,
      currentRows: 0,
      oldRows: 0,
      closedRows: 0,
    },
  );
});

test("latest closed snapshot puts an instrument only in Closed", () => {
  const model = createDilutionRegistryPreviewModel({
    instruments: [{ instrument_key: "latest-closed", name: "Latest Closed" }],
    snapshots: [
      {
        instrument_key: "latest-closed",
        as_of_date: "2026-06-30",
        status: "current",
      },
      {
        instrument_key: "latest-closed",
        as_of_date: "2026-08-10",
        status: "closed",
      },
    ],
    activities: [],
    totals: [],
  });

  assert.equal(model.summary.current, 0);
  assert.equal(model.summary.closed, 1);
  assert.equal(model.current.length, 0);
  assert.equal(model.closed.length, 1);
  assert.equal(model.closed[0]?.snapshot?.as_of_date, "2026-08-10");
});

test("latest current snapshot puts an instrument only in Current", () => {
  const model = createDilutionRegistryPreviewModel({
    instruments: [{ instrument_key: "latest-current", name: "Latest Current" }],
    snapshots: [
      {
        instrument_key: "latest-current",
        as_of_date: "2026-06-30",
        status: "closed",
      },
      {
        instrument_key: "latest-current",
        as_of_date: "2026-08-10",
        status: "current",
      },
    ],
    activities: [],
    totals: [],
  });

  assert.equal(model.summary.current, 1);
  assert.equal(model.summary.closed, 0);
  assert.equal(model.current.length, 1);
  assert.equal(model.closed.length, 0);
  assert.equal(model.current[0]?.snapshot?.as_of_date, "2026-08-10");
});

const referenceFixture = process.env.DILUTION_REGISTRY_REFERENCE_FIXTURE;

test(
  "VEEA truth fixture builds the required real preview",
  { skip: !referenceFixture },
  () => {
    const result = parseDilutionRegistryJson(
      readFileSync(referenceFixture as string, "utf8"),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const model = createDilutionRegistryPreviewModel(result.payload);
    assert.deepEqual(model.summary, {
      instruments: 20,
      snapshots: 20,
      current: 16,
      old: 0,
      closed: 4,
      activities: 8,
      totals: 4,
    });
    assert.equal(model.current.length, model.summary.current);
    assert.equal(model.old.length, model.summary.old);
    assert.equal(model.closed.length, model.summary.closed);

    const warrants = result.payload.totals.find(
      (item) => item.name === "All Warrants",
    );
    assert.equal(warrants?.total_shares, 76_513_659);
    assert.equal(warrants?.other_shares, 8_641_299);

    const whiteLion = result.payload.totals.find(
      (item) => item.name === "White Lion Notes",
    );
    assert.equal(whiteLion?.total_amount, 1_156_668);

    assert.equal(
      result.payload.instruments.filter((item) =>
        String(item.instrument_key).startsWith("veea-crowdkeep-note-"),
      ).length,
      2,
    );
    assert.equal(
      result.payload.instruments.filter((item) =>
        String(item.instrument_key).startsWith("veea-white-lion-warrant-"),
      ).length,
      3,
    );

    const eloc = result.payload.snapshots.find(
      (item) => item.instrument_key === "veea-white-lion-eloc",
    );
    assert.equal(eloc?.original_capacity, 25_000_000);
    assert.equal(eloc?.used_amount, 904_431);
    assert.equal(eloc?.remaining_capacity, 24_095_569);

    const issuance = result.payload.activities.find(
      (item) => item.activity_type === "share_issuance",
    );
    assert.equal(issuance?.activity_date, "2026-08-10");
    assert.equal(issuance?.shares_issued, 1_958_479);
    assert.equal(issuance?.instrument_key, null);
    assert.equal(
      Array.isArray(issuance?.related_instrument_keys)
        ? issuance.related_instrument_keys.length
        : 0,
      5,
    );

    assert.equal(
      model.closed.some(
        (row) => row.instrument.name === "September 2024 Notes",
      ),
      true,
    );
  },
);
