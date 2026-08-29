export type StockDilutionStatus = "current" | "old" | "closed";

export type StockDilutionInstrumentType =
  | "convertible_note"
  | "convertible_preferred"
  | "warrant"
  | "prefunded_warrant"
  | "atm_program"
  | "equity_line";

export type StockDilutionInstrument = {
  asOf: string;
  availableDate: string;
  endDate: string;
  exercisePrice: number | null;
  interestRate: number | null;
  key: string;
  lastChecked: string;
  name: string;
  originalAmount: number | null;
  originalCapacity: number | null;
  priceFormula: string;
  remainingAmount: number | null;
  remainingPotentialShares: number | null;
  remainingUnits: number | null;
  sharesIssued: number | null;
  startDate: string;
  status: StockDilutionStatus;
  type: StockDilutionInstrumentType;
  usedAmount: number | null;
  conversionPrice: number | null;
};

export type StockDilutionActivity = {
  date: string;
  detail: string;
  key: string;
  sharesIssued: number | null;
  title: string;
  unitsCancelled: number | null;
};

export type StockDilutionSnapshot = {
  activity: StockDilutionActivity[];
  closed: StockDilutionInstrument[];
  current: StockDilutionInstrument[];
  fetchedAt: string;
  lastChecked: string;
  metrics: {
    atmAmount: number | null;
    convertibleNotePotentialShares: number | null;
    equityLineRemaining: number | null;
    floatShares: null;
    freeFloat: null;
    otherWarrantShares: number | null;
    sharesOutstanding: number | null;
    sharesOutstandingAsOf: string;
    totalWarrantShares: number | null;
  };
  old: StockDilutionInstrument[];
  symbol: string;
};

export type StockDilutionBuildInput = {
  activityRows: Record<string, unknown>[];
  fetchedAt: string;
  instrumentRows: Record<string, unknown>[];
  outstanding: { asOf: string; shares: string } | null;
  snapshotRows: Record<string, unknown>[];
  symbol: string;
  totalRows: Record<string, unknown>[];
};

export function buildStockDilutionSnapshot(
  input: StockDilutionBuildInput,
): StockDilutionSnapshot {
  const instrumentsById = new Map(
    input.instrumentRows.map((row) => [readString(row.id), row]),
  );
  const latestSnapshots = latestRowsBy(
    input.snapshotRows,
    (row) => readString(row.instrument_id),
    "as_of_date",
  );
  const instruments = [...latestSnapshots.values()]
    .map((snapshot) =>
      normalizeInstrument(instrumentsById.get(readString(snapshot.instrument_id)), snapshot),
    )
    .filter((row): row is StockDilutionInstrument => row !== null)
    .sort(compareInstruments);
  const latestTotals = latestRowsBy(
    input.totalRows,
    (row) => `${readString(row.instrument_type)}:${readString(row.name)}`,
    "as_of_date",
  );
  const warrantTotal = [...latestTotals.values()]
    .filter((row) => readString(row.instrument_type) === "warrant")
    .find((row) => readNumber(row.total_shares) !== null) ?? null;
  const convertibleTotal = [...latestTotals.values()]
    .filter((row) => readString(row.instrument_type) === "convertible_note")
    .find((row) => readNumber(row.total_shares) !== null) ?? null;
  const currentEquityLine = instruments.find(
    (row) => row.status === "current" && row.type === "equity_line",
  );
  const currentAtm = instruments.find(
    (row) => row.status === "current" && row.type === "atm_program",
  );
  const sharesOutstanding = input.outstanding
    ? readSafePositiveInteger(input.outstanding.shares)
    : null;
  const lastChecked = maxDate([
    ...instruments.map((row) => row.lastChecked),
    ...input.totalRows.map((row) => readDate(row.last_checked)),
    ...input.activityRows.map((row) => readDate(row.last_checked)),
  ]);

  return {
    activity: normalizeActivity(input.activityRows, instrumentsById),
    closed: instruments.filter((row) => row.status === "closed"),
    current: instruments.filter((row) => row.status === "current"),
    fetchedAt: input.fetchedAt,
    lastChecked,
    metrics: {
      atmAmount: currentAtm?.originalCapacity ?? null,
      convertibleNotePotentialShares: readNumber(convertibleTotal?.total_shares),
      equityLineRemaining: currentEquityLine?.remainingAmount ?? null,
      floatShares: null,
      freeFloat: null,
      otherWarrantShares: readNumber(warrantTotal?.other_shares),
      sharesOutstanding,
      sharesOutstandingAsOf: input.outstanding?.asOf ?? "",
      totalWarrantShares: readNumber(warrantTotal?.total_shares),
    },
    old: instruments.filter((row) => row.status === "old"),
    symbol: normalizeSymbol(input.symbol),
  };
}

function normalizeInstrument(
  instrument: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown>,
): StockDilutionInstrument | null {
  const key = readString(instrument?.instrument_key);
  const name = readString(instrument?.name);
  const type = readInstrumentType(instrument?.instrument_type);
  const status = readStatus(snapshot.status);
  if (!key || !name || !type || !status) return null;
  return {
    asOf: readDate(snapshot.as_of_date),
    availableDate: readDate(snapshot.available_date),
    conversionPrice: readNumber(snapshot.conversion_price),
    endDate: readDate(snapshot.end_date),
    exercisePrice: readNumber(snapshot.exercise_price),
    interestRate: readNumber(snapshot.interest_rate),
    key,
    lastChecked: readDate(snapshot.last_checked),
    name,
    originalAmount: readNumber(snapshot.original_amount),
    originalCapacity: readNumber(snapshot.original_capacity),
    priceFormula: readString(snapshot.price_formula),
    remainingAmount:
      type === "equity_line" || type === "atm_program"
        ? readNumber(snapshot.remaining_capacity)
        : readNumber(snapshot.remaining_amount),
    remainingPotentialShares: readNumber(snapshot.remaining_potential_shares),
    remainingUnits: readNumber(snapshot.remaining_units),
    sharesIssued: readNumber(snapshot.shares_issued),
    startDate: readDate(snapshot.start_date),
    status,
    type,
    usedAmount: readNumber(snapshot.used_amount),
  };
}

function normalizeActivity(
  rows: Record<string, unknown>[],
  instrumentsById: Map<string, Record<string, unknown>>,
) {
  const normalized = rows
    .map((row) => {
      const date = readDate(row.activity_date);
      const type = readString(row.activity_type);
      const instrument = instrumentsById.get(readString(row.instrument_id));
      const name = readString(instrument?.name);
      const instrumentType = readString(instrument?.instrument_type);
      if (!date || !type) return null;
      return {
        date,
        detail: readString(row.details),
        id: readString(row.id),
        instrumentType,
        name,
        sharesIssued: readNumber(row.shares_issued),
        type,
        unitsCancelled: readNumber(row.units_cancelled),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const cancellationGroups = new Map<string, typeof normalized>();
  const output: StockDilutionActivity[] = [];

  for (const row of normalized) {
    if (row.type === "cancellation") {
      const key = `${row.date}:${row.instrumentType}`;
      const group = cancellationGroups.get(key) ?? [];
      group.push(row);
      cancellationGroups.set(key, group);
      continue;
    }
    output.push(toActivity(row));
  }
  for (const [key, group] of cancellationGroups) {
    const names = group.map((row) => row.name).filter(Boolean);
    const common = commonNamePrefix(names);
    const label = group.length > 1 && / warrant$/i.test(common)
      ? `${common}s`
      : common || names[0] || "Instrument";
    output.push({
      date: group[0]!.date,
      detail: "",
      key,
      sharesIssued: null,
      title: `${label} cancelled`,
      unitsCancelled: sumNumbers(group.map((row) => row.unitsCancelled)),
    });
  }
  return output
    .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title))
    .slice(0, 5);
}

function toActivity(row: {
  date: string;
  detail: string;
  id: string;
  instrumentType: string;
  name: string;
  sharesIssued: number | null;
  type: string;
  unitsCancelled: number | null;
}): StockDilutionActivity {
  let title = row.name || titleCase(row.type);
  if (row.type === "program_start") title = `${row.name || "Program"} started`;
  if (row.type === "conversion") title = `${row.name || "Convertible"} converted`;
  if (row.type === "draw") title = `${row.name || "Equity line"} used`;
  if (row.type === "share_issuance") {
    const recipient = /shares issued to (.+?)(?:\s+in connection|\s+under|[.;]|$)/i.exec(row.detail)?.[1]?.trim();
    title = `${formatInteger(row.sharesIssued)} shares issued${recipient ? ` to ${recipient}` : ""}`;
  }
  return {
    date: row.date,
    detail: row.detail,
    key: row.id || `${row.date}:${row.type}:${row.name}`,
    sharesIssued: row.sharesIssued,
    title,
    unitsCancelled: row.unitsCancelled,
  };
}

function latestRowsBy(
  rows: Record<string, unknown>[],
  keyFor: (row: Record<string, unknown>) => string,
  dateKey: string,
) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of [...rows].sort((left, right) =>
    readDate(right[dateKey]).localeCompare(readDate(left[dateKey])) ||
    readString(right.id).localeCompare(readString(left.id)))) {
    const key = keyFor(row);
    if (key && !latest.has(key)) latest.set(key, row);
  }
  return latest;
}

function compareInstruments(left: StockDilutionInstrument, right: StockDilutionInstrument) {
  return right.asOf.localeCompare(left.asOf) || left.name.localeCompare(right.name);
}

function commonNamePrefix(values: string[]) {
  if (!values.length) return "";
  const wordSets = values.map((value) => value.split(/\s+|\s+—\s+/).filter(Boolean));
  const first = wordSets[0]!;
  let length = 0;
  while (length < first.length && wordSets.every((words) => words[length] === first[length])) {
    length += 1;
  }
  return first.slice(0, length).join(" ").replace(/\s+—$/, "");
}

function sumNumbers(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

function maxDate(values: string[]) {
  return values.filter(Boolean).sort().at(-1) ?? "";
}

function readSafePositiveInteger(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : "";
}

function readDate(value: unknown) {
  const text = readString(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function readStatus(value: unknown): StockDilutionStatus | null {
  return value === "current" || value === "old" || value === "closed" ? value : null;
}

function readInstrumentType(value: unknown): StockDilutionInstrumentType | null {
  return value === "convertible_note" ||
    value === "convertible_preferred" ||
    value === "warrant" ||
    value === "prefunded_warrant" ||
    value === "atm_program" ||
    value === "equity_line"
    ? value
    : null;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function formatInteger(value: number | null) {
  return value === null ? "Unknown" : new Intl.NumberFormat("en-US").format(value);
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
