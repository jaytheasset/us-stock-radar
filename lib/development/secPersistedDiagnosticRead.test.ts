import assert from "node:assert/strict";
import test from "node:test";
import {
  limitSecPersistedRoomRows,
  readSecPersistedEventRows,
  SEC_DIAGNOSTIC_EXACT_ACCESSION_LIMIT,
  SEC_DIAGNOSTIC_RECENT_ROOM_LIMIT,
  SEC_DIAGNOSTIC_RECENT_SCAN_LIMIT,
  type SecDiagnosticSelect,
} from "./secPersistedDiagnosticRead.ts";

const oldEvent = {
  id: "5c12efff-d839-4e72-b983-52990312aaf1",
  metadata: { accession_number: "0001921094-26-000731" },
};

test("default recent reads keep the bounded scan and room latest-10 behavior", async () => {
  let capturedSearch: Record<string, string> = {};
  const rows = Array.from({ length: SEC_DIAGNOSTIC_RECENT_SCAN_LIMIT }, (_, index) => ({ id: `event-${index}` }));
  const select: SecDiagnosticSelect = async (_table, search) => {
    capturedSearch = search;
    return { ok: true, data: rows };
  };

  const result = await readSecPersistedEventRows({ filters: {}, select });

  assert.equal(result.status, "ok");
  assert.equal(result.query, "recent");
  assert.equal(capturedSearch.limit, String(SEC_DIAGNOSTIC_RECENT_SCAN_LIMIT));
  assert.equal(limitSecPersistedRoomRows(result.rows, result.query).length, SEC_DIAGNOSTIC_RECENT_ROOM_LIMIT);
});

test("exact eventId bypasses the recent window with a one-row lookup", async () => {
  let capturedSearch: Record<string, string> = {};
  const select: SecDiagnosticSelect = async (_table, search) => {
    capturedSearch = search;
    return { ok: true, data: search.id === `eq.${oldEvent.id}` ? [oldEvent] : [] };
  };

  const result = await readSecPersistedEventRows({
    filters: { eventId: oldEvent.id },
    select,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.query, "exact_event");
  assert.equal(capturedSearch.limit, "1");
  assert.equal(capturedSearch.id, `eq.${oldEvent.id}`);
  assert.deepEqual(limitSecPersistedRoomRows(result.rows, result.query), [oldEvent]);
});

test("exact accession bypasses the recent window with a bounded direct lookup", async () => {
  let capturedSearch: Record<string, string> = {};
  const accessionNumber = String(oldEvent.metadata.accession_number);
  const select: SecDiagnosticSelect = async (_table, search) => {
    capturedSearch = search;
    return {
      ok: true,
      data: search["metadata->>accession_number"] === `eq.${accessionNumber}` ? [oldEvent] : [],
    };
  };

  const result = await readSecPersistedEventRows({
    filters: { accessionNumber },
    select,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.query, "exact_accession");
  assert.equal(capturedSearch.limit, String(SEC_DIAGNOSTIC_EXACT_ACCESSION_LIMIT));
  assert.equal(capturedSearch["metadata->>accession_number"], `eq.${accessionNumber}`);
  assert.deepEqual(limitSecPersistedRoomRows(result.rows, result.query), [oldEvent]);
});

test("exact not-found and persisted read failure remain different", async () => {
  const notFound = await readSecPersistedEventRows({
    filters: { eventId: oldEvent.id },
    select: async () => ({ ok: true, data: [] }),
  });
  const failed = await readSecPersistedEventRows({
    filters: { eventId: oldEvent.id },
    select: async () => ({ ok: false, data: { private: "must-not-leak" } }),
  });
  const threw = await readSecPersistedEventRows({
    filters: { accessionNumber: String(oldEvent.metadata.accession_number) },
    select: async () => { throw new Error("Token=must-not-leak"); },
  });

  assert.deepEqual(notFound, { status: "ok", query: "exact_event", rows: [] });
  assert.deepEqual(failed, { status: "read_failed", query: "exact_event", rows: [] });
  assert.deepEqual(threw, { status: "read_failed", query: "exact_accession", rows: [] });
  assert.doesNotMatch(JSON.stringify([failed, threw]), /must-not-leak|error/);
});
