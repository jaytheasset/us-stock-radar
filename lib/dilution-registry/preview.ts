import { createDilutionStoredSplitClauseBinding } from "./corporateActionAdjustment.ts";

export type DilutionRegistryRecord = Record<string, unknown>;

export type DilutionRegistryPayload = {
  issuer?: DilutionRegistryRecord;
  instruments: DilutionRegistryRecord[];
  snapshots: DilutionRegistryRecord[];
  activities: DilutionRegistryRecord[];
  totals: DilutionRegistryRecord[];
  os_observations?: unknown[];
  corporate_action_clause_bindings?: DilutionRegistryRecord[];
};

export type DilutionRegistryInstrumentRow = {
  instrument: DilutionRegistryRecord;
  snapshot: DilutionRegistryRecord | null;
  status: string | null;
};

export type DilutionRegistryPreviewModel = {
  title: string;
  summary: {
    instruments: number;
    snapshots: number;
    current: number;
    old: number;
    closed: number;
    activities: number;
    totals: number;
  };
  current: DilutionRegistryInstrumentRow[];
  old: DilutionRegistryInstrumentRow[];
  closed: DilutionRegistryInstrumentRow[];
  activities: DilutionRegistryRecord[];
  totals: DilutionRegistryRecord[];
  instrumentsByKey: Map<string, DilutionRegistryRecord>;
};

export type DilutionRegistryParseResult =
  | { ok: true; payload: DilutionRegistryPayload }
  | { ok: false; errors: string[] };

const ARRAY_LABELS = {
  instruments: "Instruments",
  snapshots: "Snapshots",
  activities: "Activities",
  totals: "Totals",
} as const;

export function parseDilutionRegistryJson(
  source: string,
): DilutionRegistryParseResult {
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, errors: ["JSON 형식이 잘못되었습니다."] };
  }

  if (!isRecord(value)) {
    return { ok: false, errors: ["JSON 형식이 잘못되었습니다."] };
  }

  const missingArrays = Object.entries(ARRAY_LABELS)
    .filter(([key]) => !Array.isArray(value[key]))
    .map(([, label]) => `${label} 목록을 찾을 수 없습니다.`);

  if (missingArrays.length) {
    return { ok: false, errors: missingArrays };
  }

  if (
    Object.hasOwn(value, "os_observations") &&
    !Array.isArray(value.os_observations)
  ) {
    return {
      ok: false,
      errors: ["Shares Outstanding observations must be a list when present."],
    };
  }
  if (
    Object.hasOwn(value, "corporate_action_clause_bindings")
    && !Array.isArray(value.corporate_action_clause_bindings)
  ) {
    return {
      ok: false,
      errors: ["Corporate Action clause bindings must be a list when present."],
    };
  }

  const payload: DilutionRegistryPayload = {
    issuer: isRecord(value.issuer) ? value.issuer : undefined,
    instruments: records(value.instruments),
    snapshots: records(value.snapshots),
    activities: records(value.activities),
    totals: records(value.totals),
    os_observations: Array.isArray(value.os_observations)
      ? [...value.os_observations]
      : undefined,
    corporate_action_clause_bindings: Array.isArray(value.corporate_action_clause_bindings)
      ? records(value.corporate_action_clause_bindings)
      : undefined,
  };

  const errors: string[] = [];
  for (const [key, label] of Object.entries(ARRAY_LABELS)) {
    const items = value[key];
    if (Array.isArray(items) && items.length !== records(items).length) {
      errors.push(`${label} 항목의 형식을 확인해 주세요.`);
    }
  }

  const instrumentKeys = new Set<string>();
  for (const instrument of payload.instruments) {
    const key = readString(instrument.instrument_key);
    if (!key) {
      errors.push("Instrument Key가 없는 Instrument가 있습니다.");
      continue;
    }
    if (instrumentKeys.has(key)) {
      errors.push(`같은 Instrument Key가 두 번 있습니다: ${key}`);
      continue;
    }
    instrumentKeys.add(key);
  }

  for (const snapshot of payload.snapshots) {
    const key = readString(snapshot.instrument_key);
    if (!key || !instrumentKeys.has(key)) {
      errors.push(
        `이 Snapshot에 연결된 Instrument를 찾을 수 없습니다${key ? `: ${key}` : "."}`,
      );
    }
  }

  for (const activity of payload.activities) {
    if (activity.instrument_key !== null && activity.instrument_key !== undefined) {
      const key = readString(activity.instrument_key);
      if (!key || !instrumentKeys.has(key)) {
        errors.push(
          `이 Activity에 연결된 Instrument를 찾을 수 없습니다${key ? `: ${key}` : "."}`,
        );
      }
    }
    validateRelatedKeys(
      activity.related_instrument_keys,
      instrumentKeys,
      "이 Activity의 Related Instrument를 찾을 수 없습니다",
      errors,
    );
  }

  for (const total of payload.totals) {
    validateRelatedKeys(
      total.included_instrument_keys,
      instrumentKeys,
      "이 Total에 포함된 Instrument를 찾을 수 없습니다",
      errors,
    );
  }

  const issuerCik = readString(payload.issuer?.issuer_cik) || "";
  if (Array.isArray(value.corporate_action_clause_bindings)
    && value.corporate_action_clause_bindings.length
      !== payload.corporate_action_clause_bindings?.length) {
    errors.push("Corporate Action clause binding items must be objects.");
  }
  for (const binding of payload.corporate_action_clause_bindings ?? []) {
    try {
      const stored = createDilutionStoredSplitClauseBinding(issuerCik, binding);
      if (!instrumentKeys.has(stored.instrumentKey)) {
        errors.push(`Corporate Action clause binding references a missing Instrument: ${stored.instrumentKey}`);
      }
    } catch {
      errors.push("A Corporate Action clause binding is invalid.");
    }
  }

  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, payload };
}

export function hasDilutionRegistryOsObservationRows(
  payload: DilutionRegistryPayload,
) {
  return Array.isArray(payload.os_observations) && payload.os_observations.length > 0;
}

export function createDilutionRegistryPreviewModel(
  payload: DilutionRegistryPayload,
): DilutionRegistryPreviewModel {
  const instrumentsByKey = new Map<string, DilutionRegistryRecord>();
  payload.instruments.forEach((instrument) => {
    const key = readString(instrument.instrument_key);
    if (key) instrumentsByKey.set(key, instrument);
  });

  const snapshotsByInstrument = new Map<string, DilutionRegistryRecord>();
  payload.snapshots.forEach((snapshot) => {
    const key = readString(snapshot.instrument_key);
    if (!key) return;
    const current = snapshotsByInstrument.get(key);
    if (!current || isLaterDate(snapshot.as_of_date, current.as_of_date)) {
      snapshotsByInstrument.set(key, snapshot);
    }
  });

  const rows = payload.instruments.map((instrument) => {
    const key = readString(instrument.instrument_key);
    const snapshot = key ? snapshotsByInstrument.get(key) ?? null : null;
    return {
      instrument,
      snapshot,
      status: readString(snapshot?.status),
    } satisfies DilutionRegistryInstrumentRow;
  });

  const current = sortInstrumentRows(
    rows.filter((row) => row.status === "current"),
  );
  const old = sortInstrumentRows(rows.filter((row) => row.status === "old"));
  const closed = sortInstrumentRows(
    rows.filter((row) => row.status === "closed"),
  );

  const ticker = readString(payload.issuer?.ticker);
  return {
    title: ticker
      ? `${ticker} Dilution Registry Preview`
      : "Dilution Registry Preview",
    summary: {
      instruments: payload.instruments.length,
      snapshots: payload.snapshots.length,
      current: current.length,
      old: old.length,
      closed: closed.length,
      activities: payload.activities.length,
      totals: payload.totals.length,
    },
    current,
    old,
    closed,
    activities: sortRecordsByDate(payload.activities, ["activity_date", "period_end"]),
    totals: sortRecordsByDate(payload.totals, ["as_of_date"]),
    instrumentsByKey,
  };
}

function validateRelatedKeys(
  value: unknown,
  instrumentKeys: Set<string>,
  message: string,
  errors: string[],
) {
  if (value === null || value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${message}.`);
    return;
  }
  for (const item of value) {
    const key = readString(item);
    if (!key || !instrumentKeys.has(key)) {
      errors.push(`${message}${key ? `: ${key}` : "."}`);
    }
  }
}

function sortInstrumentRows(rows: DilutionRegistryInstrumentRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareOptionalDates(b.row.snapshot?.as_of_date, a.row.snapshot?.as_of_date) || a.index - b.index)
    .map(({ row }) => row);
}

function sortRecordsByDate(
  rows: DilutionRegistryRecord[],
  dateKeys: string[],
) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aDate = firstDate(a.row, dateKeys);
      const bDate = firstDate(b.row, dateKeys);
      return compareOptionalDates(bDate, aDate) || a.index - b.index;
    })
    .map(({ row }) => row);
}

function firstDate(row: DilutionRegistryRecord, keys: string[]) {
  for (const key of keys) {
    const value = readString(row[key]);
    if (value) return value;
  }
  return null;
}

function isLaterDate(candidate: unknown, current: unknown) {
  const candidateDate = readString(candidate);
  const currentDate = readString(current);
  if (!candidateDate) return false;
  if (!currentDate) return true;
  return candidateDate > currentDate;
}

function compareOptionalDates(a: unknown, b: unknown) {
  const aDate = readString(a);
  const bDate = readString(b);
  if (aDate && bDate) return aDate.localeCompare(bDate);
  if (aDate) return 1;
  if (bDate) return -1;
  return 0;
}

function records(value: unknown): DilutionRegistryRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is DilutionRegistryRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
