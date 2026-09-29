export type StockFundamentalsSourceState =
  | "ready"
  | "partial"
  | "empty"
  | "plan_unavailable"
  | "unavailable";

export type StockFundamentalsSourceStatus = {
  rowCount: number;
  state: StockFundamentalsSourceState;
};

export type StockFundamentalsSourceKey =
  | "incomeStatement"
  | "balanceSheet"
  | "cashFlow"
  | "sharesFloat"
  | "sharesHistory"
  | "splits"
  | "beneficialOwnership"
  | "institutionalOwnership";

export type StockFinancialPeriod = {
  capitalExpenditure: number | null;
  cashAndShortTermInvestments: number | null;
  commonStockIssued: number | null;
  commonStockRepurchased: number | null;
  date: string;
  epsDiluted: number | null;
  filingDate: string;
  fiscalYear: string;
  freeCashFlow: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  operatingIncome: number | null;
  period: string;
  reportedCurrency: string;
  revenue: number | null;
  stockBasedCompensation: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  totalStockholdersEquity: number | null;
  weightedAverageShsOutDil: number | null;
};

export type StockFinancialQuarter = StockFinancialPeriod;

export type StockSharesFloat = {
  asOf: string;
  floatShares: number | null;
  freeFloat: number | null;
  outstandingShares: number | null;
};

export type StockShareHistoryPoint = {
  date: string;
  shares: number;
};

export type StockSplit = {
  date: string;
  denominator: number;
  numerator: number;
};

export type StockBeneficialOwnershipFiling = {
  acceptedDate: string;
  amountBeneficiallyOwned: number | null;
  filingDate: string;
  nameOfReportingPerson: string;
  percentOfClass: number | null;
  typeOfReportingPerson: string;
  url: string;
};

export type StockInstitutionalSummary = {
  asOf: string;
  closedPositions: number | null;
  increasedPositions: number | null;
  investorsHolding: number | null;
  newPositions: number | null;
  ownershipPercent: number | null;
  quarter: number | null;
  reducedPositions: number | null;
  sharesHeld: number | null;
  totalInvested: number | null;
  year: number | null;
};

export type StockInstitutionalHolder = {
  asOf: string;
  changeInShares: number | null;
  holder: string;
  marketValue: number | null;
  portfolioWeight: number | null;
  shares: number | null;
};

export type StockFundamentalsSnapshot = {
  fetchedAt: string;
  financials: {
    annuals: StockFinancialPeriod[];
    quarters: StockFinancialQuarter[];
  };
  ownership: {
    beneficialFilings: StockBeneficialOwnershipFiling[];
    institutionalHolders: StockInstitutionalHolder[];
    institutionalSummary: StockInstitutionalSummary | null;
    reportedBeneficialOwners: StockBeneficialOwnershipFiling[];
  };
  shareHistory: StockShareHistoryPoint[];
  sharesFloat: StockSharesFloat | null;
  sources: Record<StockFundamentalsSourceKey, StockFundamentalsSourceStatus>;
  splits: StockSplit[];
  symbol: string;
};

export type StockFundamentalsProviderResult = {
  data: unknown;
  fetchedAt?: string;
  httpStatus?: number;
  state: Exclude<StockFundamentalsSourceState, "empty" | "partial">;
};

export type StockFundamentalsProviderSources = {
  balanceAnnual: StockFundamentalsProviderResult;
  balanceQuarterly: StockFundamentalsProviderResult;
  beneficialOwnership: StockFundamentalsProviderResult;
  cashAnnual: StockFundamentalsProviderResult;
  cashQuarterly: StockFundamentalsProviderResult;
  enterpriseValues: StockFundamentalsProviderResult;
  incomeAnnual: StockFundamentalsProviderResult;
  incomeQuarterly: StockFundamentalsProviderResult;
  institutionalHolders: StockFundamentalsProviderResult;
  institutionalSummary: StockFundamentalsProviderResult;
  sharesFloat: StockFundamentalsProviderResult;
  splits: StockFundamentalsProviderResult;
};

export function normalizeStockFundamentals(
  symbol: string,
  providerSources: StockFundamentalsProviderSources,
  fetchedAt = new Date().toISOString(),
): StockFundamentalsSnapshot {
  const incomeQuarterlyRows = readRows(providerSources.incomeQuarterly.data);
  const balanceQuarterlyRows = readRows(providerSources.balanceQuarterly.data);
  const cashQuarterlyRows = readRows(providerSources.cashQuarterly.data);
  const incomeAnnualRows = readRows(providerSources.incomeAnnual.data);
  const balanceAnnualRows = readRows(providerSources.balanceAnnual.data);
  const cashAnnualRows = readRows(providerSources.cashAnnual.data);
  const beneficialRows = readRows(providerSources.beneficialOwnership.data);
  const enterpriseRows = readRows(providerSources.enterpriseValues.data);
  const sharesFloatRows = readRows(providerSources.sharesFloat.data);
  const splitRows = readRows(providerSources.splits.data);
  const institutionalSummaryRows = readRows(providerSources.institutionalSummary.data);
  const institutionalHolderRows = readRows(providerSources.institutionalHolders.data);

  const quarters = normalizeFinancialPeriods(
    incomeQuarterlyRows,
    balanceQuarterlyRows,
    cashQuarterlyRows,
    5,
  );
  const annuals = normalizeFinancialPeriods(
    incomeAnnualRows,
    balanceAnnualRows,
    cashAnnualRows,
    5,
  );

  const beneficialFilings = beneficialRows
    .map((row) => {
      const filingDate = readString(row, "filingDate");
      const nameOfReportingPerson = readString(row, "nameOfReportingPerson");
      if (!filingDate || !nameOfReportingPerson) return null;
      return {
        acceptedDate: readString(row, "acceptedDate"),
        amountBeneficiallyOwned: readNumber(row, "amountBeneficiallyOwned"),
        filingDate,
        nameOfReportingPerson,
        percentOfClass: readNumber(row, "percentOfClass"),
        typeOfReportingPerson: readString(row, "typeOfReportingPerson"),
        url: safeHttpUrl(readString(row, "url")),
      } satisfies StockBeneficialOwnershipFiling;
    })
    .filter((row): row is StockBeneficialOwnershipFiling => Boolean(row))
    .sort(
      (left, right) =>
        (right.acceptedDate || right.filingDate).localeCompare(
          left.acceptedDate || left.filingDate,
        ),
    )
    .slice(0, 50);

  const latestBeneficialFilingByOwner = new Map<
    string,
    StockBeneficialOwnershipFiling
  >();
  for (const filing of beneficialFilings) {
    const ownerKey = normalizeOwnerName(filing.nameOfReportingPerson);
    if (ownerKey && !latestBeneficialFilingByOwner.has(ownerKey)) {
      latestBeneficialFilingByOwner.set(ownerKey, filing);
    }
  }
  const reportedBeneficialOwners = [...latestBeneficialFilingByOwner.values()]
    .filter(
      (filing) =>
        (filing.amountBeneficiallyOwned ?? 0) > 0 &&
        (filing.percentOfClass ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        (right.acceptedDate || right.filingDate).localeCompare(
          left.acceptedDate || left.filingDate,
        ),
    );

  const sharesFloatRow = sharesFloatRows[0] ?? null;
  const sharesFloat = sharesFloatRow
    ? {
        asOf: readString(sharesFloatRow, "date"),
        floatShares: readNumber(sharesFloatRow, "floatShares"),
        freeFloat: readNumber(sharesFloatRow, "freeFloat"),
        outstandingShares: readNumber(sharesFloatRow, "outstandingShares"),
      }
    : null;

  const shareHistory = enterpriseRows
    .map((row) => {
      const date = readString(row, "date");
      const shares = readNumber(row, "numberOfShares");
      return date && shares !== null && shares > 0 ? { date, shares } : null;
    })
    .filter((row): row is StockShareHistoryPoint => Boolean(row))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 8);

  const splits = splitRows
    .map((row) => {
      const date = readString(row, "date");
      const numerator = readNumber(row, "numerator");
      const denominator = readNumber(row, "denominator");
      if (!date || numerator === null || denominator === null || numerator <= 0 || denominator <= 0) {
        return null;
      }
      return { date, denominator, numerator } satisfies StockSplit;
    })
    .filter((row): row is StockSplit => Boolean(row))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 12);

  const institutionalSummary = normalizeInstitutionalSummary(
    institutionalSummaryRows[0] ?? null,
  );
  const institutionalHolders = institutionalHolderRows
    .map(normalizeInstitutionalHolder)
    .filter((row): row is StockInstitutionalHolder => Boolean(row))
    .slice(0, 10);

  return {
    fetchedAt,
    financials: { annuals, quarters },
    ownership: {
      beneficialFilings,
      institutionalHolders,
      institutionalSummary,
      reportedBeneficialOwners,
    },
    shareHistory,
    sharesFloat,
    sources: {
      balanceSheet: combinedSourceStatus(
        [providerSources.balanceQuarterly, providerSources.balanceAnnual],
        balanceQuarterlyRows.length + balanceAnnualRows.length,
      ),
      beneficialOwnership: sourceStatus(
        providerSources.beneficialOwnership.state,
        beneficialFilings.length,
      ),
      cashFlow: combinedSourceStatus(
        [providerSources.cashQuarterly, providerSources.cashAnnual],
        cashQuarterlyRows.length + cashAnnualRows.length,
      ),
      incomeStatement: combinedSourceStatus(
        [providerSources.incomeQuarterly, providerSources.incomeAnnual],
        incomeQuarterlyRows.length + incomeAnnualRows.length,
      ),
      institutionalOwnership: combinedSourceStatus(
        [providerSources.institutionalSummary, providerSources.institutionalHolders],
        (institutionalSummary ? 1 : 0) + institutionalHolders.length,
      ),
      sharesFloat: sourceStatus(
        providerSources.sharesFloat.state,
        sharesFloat ? 1 : 0,
      ),
      sharesHistory: sourceStatus(
        providerSources.enterpriseValues.state,
        shareHistory.length,
      ),
      splits: sourceStatus(providerSources.splits.state, splits.length),
    },
    splits,
    symbol: normalizeSymbol(symbol),
  };
}

export function calculatePercentChange(
  current: number | null | undefined,
  baseline: number | null | undefined,
) {
  if (
    current === null ||
    current === undefined ||
    baseline === null ||
    baseline === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

export function calculateMargin(
  numerator: number | null | undefined,
  revenue: number | null | undefined,
) {
  if (
    numerator === null ||
    numerator === undefined ||
    revenue === null ||
    revenue === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(revenue) ||
    revenue <= 0
  ) {
    return null;
  }
  return (numerator / revenue) * 100;
}

export function normalizeCashFlowMagnitude(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.abs(value);
}

export function findPriorYearQuarter(
  quarters: readonly StockFinancialQuarter[],
  current: StockFinancialQuarter | null | undefined,
) {
  if (!current) return null;
  const currentYear = Number(current.fiscalYear);
  if (!Number.isFinite(currentYear) || !current.period) return null;
  return (
    quarters.find(
      (quarter) =>
        quarter.period === current.period &&
        Number(quarter.fiscalYear) === currentYear - 1,
    ) ?? null
  );
}

export function calculateTrailingEquityCashFlow(
  quarters: readonly StockFinancialQuarter[],
) {
  const trailing = quarters.slice(0, 4);
  const issued = sumAvailable(
    trailing.map((quarter) => quarter.commonStockIssued),
  );
  const repurchased = sumAvailable(
    trailing.map((quarter) => quarter.commonStockRepurchased),
  );
  return {
    issued,
    net:
      issued === null || repurchased === null
        ? null
        : issued - repurchased,
    repurchased,
  };
}

export function sumAvailable(values: readonly (number | null | undefined)[]) {
  const available = values.filter(
    (value): value is number =>
      value !== null && value !== undefined && Number.isFinite(value),
  );
  return available.length
    ? available.reduce((sum, value) => sum + value, 0)
    : null;
}

function normalizeFinancialPeriods(
  incomeRows: readonly Record<string, unknown>[],
  balanceRows: readonly Record<string, unknown>[],
  cashRows: readonly Record<string, unknown>[],
  limit: number,
) {
  return incomeRows
    .map((incomeRow) => {
      const date = readString(incomeRow, "date");
      const fiscalYear = readString(incomeRow, "fiscalYear");
      const period = readString(incomeRow, "period");
      if (!date && (!fiscalYear || !period)) return null;
      const balanceRow = matchPeriodRow(balanceRows, date, fiscalYear, period);
      const cashRow = matchPeriodRow(cashRows, date, fiscalYear, period);

      return {
        capitalExpenditure: readNumber(cashRow, "capitalExpenditure"),
        cashAndShortTermInvestments: readNumber(
          balanceRow,
          "cashAndShortTermInvestments",
        ),
        commonStockIssued: normalizeCashFlowMagnitude(
          readNumber(cashRow, "commonStockIssued"),
        ),
        commonStockRepurchased: normalizeCashFlowMagnitude(
          readNumber(cashRow, "commonStockRepurchased"),
        ),
        date,
        epsDiluted: readNumber(incomeRow, "epsDiluted"),
        filingDate:
          readString(incomeRow, "filingDate") ||
          readString(balanceRow, "filingDate") ||
          readString(cashRow, "filingDate"),
        fiscalYear,
        freeCashFlow: readNumber(cashRow, "freeCashFlow"),
        grossProfit: readNumber(incomeRow, "grossProfit"),
        netIncome: readNumber(incomeRow, "netIncome"),
        operatingCashFlow: readNumber(cashRow, "operatingCashFlow"),
        operatingIncome: readNumber(incomeRow, "operatingIncome"),
        period,
        reportedCurrency:
          readString(incomeRow, "reportedCurrency") ||
          readString(balanceRow, "reportedCurrency") ||
          readString(cashRow, "reportedCurrency"),
        revenue: readNumber(incomeRow, "revenue"),
        stockBasedCompensation: readNumber(cashRow, "stockBasedCompensation"),
        totalAssets: readNumber(balanceRow, "totalAssets"),
        totalDebt: readNumber(balanceRow, "totalDebt"),
        totalStockholdersEquity: readNumber(
          balanceRow,
          "totalStockholdersEquity",
        ),
        weightedAverageShsOutDil: readNumber(
          incomeRow,
          "weightedAverageShsOutDil",
        ),
      } satisfies StockFinancialPeriod;
    })
    .filter((row): row is StockFinancialPeriod => Boolean(row))
    .sort((left, right) => periodSortValue(right) - periodSortValue(left))
    .slice(0, limit);
}

function normalizeInstitutionalSummary(
  row: Record<string, unknown> | null,
): StockInstitutionalSummary | null {
  if (!row) return null;
  const summary = {
    asOf: readStringAny(row, ["date", "filingDate"]),
    closedPositions: readNumberAny(row, ["closedPositions", "positionsClosed"]),
    increasedPositions: readNumberAny(row, ["increasedPositions", "positionsIncreased"]),
    investorsHolding: readNumberAny(row, ["investorsHolding", "holders"]),
    newPositions: readNumberAny(row, ["newPositions", "positionsNew"]),
    ownershipPercent: readNumberAny(row, ["ownershipPercent", "ownershipPercentage"]),
    quarter: readIntegerAny(row, ["quarter"]),
    reducedPositions: readNumberAny(row, ["reducedPositions", "positionsReduced"]),
    sharesHeld: readNumberAny(row, ["numberOf13Fshares", "sharesHeld", "shares"]),
    totalInvested: readNumberAny(row, ["totalInvested", "marketValue"]),
    year: readIntegerAny(row, ["year"]),
  } satisfies StockInstitutionalSummary;
  return Object.values(summary).some((value) => value !== null && value !== "")
    ? summary
    : null;
}

function normalizeInstitutionalHolder(
  row: Record<string, unknown>,
): StockInstitutionalHolder | null {
  const holder = readStringAny(row, ["holder", "investorName", "name"]);
  if (!holder) return null;
  return {
    asOf: readStringAny(row, ["date", "filingDate"]),
    changeInShares: readNumberAny(row, [
      "changeInSharesNumber",
      "changeInShares",
      "change",
    ]),
    holder,
    marketValue: readNumberAny(row, ["marketValue", "value"]),
    portfolioWeight: readNumberAny(row, ["weight", "portfolioWeight"]),
    shares: readNumberAny(row, ["sharesNumber", "numberOfShares", "shares"]),
  };
}

function sourceStatus(
  state: StockFundamentalsProviderResult["state"],
  rowCount: number,
): StockFundamentalsSourceStatus {
  return {
    rowCount,
    state: state === "ready" && rowCount === 0 ? "empty" : state,
  };
}

function combinedSourceStatus(
  sources: readonly StockFundamentalsProviderResult[],
  rowCount: number,
): StockFundamentalsSourceStatus {
  const readyCount = sources.filter((source) => source.state === "ready").length;
  if (readyCount === sources.length) {
    return { rowCount, state: rowCount ? "ready" : "empty" };
  }
  if (readyCount > 0) return { rowCount, state: "partial" };
  if (sources.some((source) => source.state === "plan_unavailable")) {
    return { rowCount, state: "plan_unavailable" };
  }
  return { rowCount, state: "unavailable" };
}

function matchPeriodRow(
  rows: readonly Record<string, unknown>[],
  date: string,
  fiscalYear: string,
  period: string,
) {
  return (
    rows.find((row) => date && readString(row, "date") === date) ??
    rows.find(
      (row) =>
        fiscalYear &&
        period &&
        readString(row, "fiscalYear") === fiscalYear &&
        readString(row, "period") === period,
    ) ??
    null
  );
}

function periodSortValue(period: StockFinancialPeriod) {
  const dateValue = Date.parse(period.date);
  if (Number.isFinite(dateValue)) return dateValue;
  const year = Number(period.fiscalYear);
  const quarter = Number(period.period.replace(/\D/g, ""));
  return (Number.isFinite(year) ? year : 0) * 10 + (quarter || 0);
}

function readRows(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

function readString(row: Record<string, unknown> | null, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readStringAny(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = readString(row, key);
    if (value) return value;
  }
  return "";
}

function readNumber(row: Record<string, unknown> | null, key: string) {
  const value = row?.[key];
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function readNumberAny(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = readNumber(row, key);
    if (value !== null) return value;
  }
  return null;
}

function readInteger(row: Record<string, unknown> | null, key: string) {
  const value = readNumber(row, key);
  return value !== null && Number.isInteger(value) ? value : null;
}

function readIntegerAny(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = readInteger(row, key);
    if (value !== null) return value;
  }
  return null;
}

function safeHttpUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function normalizeOwnerName(value: string) {
  return value.trim().toLocaleUpperCase("en-US").replace(/\s+/g, " ");
}
