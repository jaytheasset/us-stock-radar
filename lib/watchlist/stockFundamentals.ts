export type StockFundamentalsSourceState =
  | "ready"
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
  | "insiderStatistics"
  | "insiderTrades"
  | "beneficialOwnership"
  | "institutionalOwnership";

export type StockFinancialQuarter = {
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
  revenue: number | null;
  stockBasedCompensation: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  totalStockholdersEquity: number | null;
  weightedAverageShsOutDil: number | null;
};

export type StockInsiderStatistic = {
  acquiredTransactions: number | null;
  disposedTransactions: number | null;
  quarter: number;
  totalAcquired: number | null;
  totalDisposed: number | null;
  totalPurchases: number | null;
  totalSales: number | null;
  year: number;
};

export type StockInsiderTrade = {
  filingDate: string;
  formType: string;
  link: string;
  price: number | null;
  reportingName: string;
  securitiesOwned: number | null;
  securitiesTransacted: number | null;
  transactionDate: string;
  transactionType: string;
  typeOfOwner: string;
};

export type StockSharesFloat = {
  asOf: string;
  floatShares: number | null;
  freeFloat: number | null;
  outstandingShares: number | null;
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

export type StockFundamentalsSnapshot = {
  fetchedAt: string;
  financials: {
    quarters: StockFinancialQuarter[];
  };
  ownership: {
    beneficialFilings: StockBeneficialOwnershipFiling[];
    reportedBeneficialOwners: StockBeneficialOwnershipFiling[];
    statistics: StockInsiderStatistic[];
    trades: StockInsiderTrade[];
  };
  sharesFloat: StockSharesFloat | null;
  sources: Record<StockFundamentalsSourceKey, StockFundamentalsSourceStatus>;
  symbol: string;
};

export type StockFundamentalsProviderResult = {
  data: unknown;
  state: Exclude<StockFundamentalsSourceState, "empty">;
};

export type StockFundamentalsProviderSources = {
  balanceSheet: StockFundamentalsProviderResult;
  beneficialOwnership: StockFundamentalsProviderResult;
  cashFlow: StockFundamentalsProviderResult;
  incomeStatement: StockFundamentalsProviderResult;
  insiderStatistics: StockFundamentalsProviderResult;
  insiderTrades: StockFundamentalsProviderResult;
  sharesFloat: StockFundamentalsProviderResult;
};

export function normalizeStockFundamentals(
  symbol: string,
  providerSources: StockFundamentalsProviderSources,
  fetchedAt = new Date().toISOString(),
): StockFundamentalsSnapshot {
  const incomeRows = readRows(providerSources.incomeStatement.data);
  const balanceRows = readRows(providerSources.balanceSheet.data);
  const beneficialRows = readRows(providerSources.beneficialOwnership.data);
  const cashRows = readRows(providerSources.cashFlow.data);
  const sharesFloatRows = readRows(providerSources.sharesFloat.data);
  const statisticRows = readRows(providerSources.insiderStatistics.data);
  const tradeRows = readRows(providerSources.insiderTrades.data);

  const quarters = incomeRows
    .map((incomeRow) => {
      const date = readString(incomeRow, "date");
      const fiscalYear = readString(incomeRow, "fiscalYear");
      const period = readString(incomeRow, "period");
      if (!date && (!fiscalYear || !period)) return null;
      const balanceRow = matchQuarterRow(balanceRows, date, fiscalYear, period);
      const cashRow = matchQuarterRow(cashRows, date, fiscalYear, period);

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
      } satisfies StockFinancialQuarter;
    })
    .filter((row): row is StockFinancialQuarter => Boolean(row))
    .sort((left, right) => quarterSortValue(right) - quarterSortValue(left))
    .slice(0, 5);

  const statistics = statisticRows
    .map((row) => {
      const year = readInteger(row, "year");
      const quarter = readInteger(row, "quarter");
      if (year === null || quarter === null || quarter < 1 || quarter > 4) {
        return null;
      }
      return {
        acquiredTransactions: readNumber(row, "acquiredTransactions"),
        disposedTransactions: readNumber(row, "disposedTransactions"),
        quarter,
        totalAcquired: readNumber(row, "totalAcquired"),
        totalDisposed: readNumber(row, "totalDisposed"),
        totalPurchases: readNumber(row, "totalPurchases"),
        totalSales: readNumber(row, "totalSales"),
        year,
      } satisfies StockInsiderStatistic;
    })
    .filter((row): row is StockInsiderStatistic => Boolean(row))
    .sort(
      (left, right) =>
        right.year * 10 + right.quarter - (left.year * 10 + left.quarter),
    )
    .slice(0, 8);

  const trades = tradeRows
    .map((row) => {
      const filingDate = readString(row, "filingDate");
      const reportingName = readString(row, "reportingName");
      if (!filingDate || !reportingName) return null;
      return {
        filingDate,
        formType: readString(row, "formType"),
        link: safeHttpUrl(readString(row, "link")),
        price: readNumber(row, "price"),
        reportingName,
        securitiesOwned: readNumber(row, "securitiesOwned"),
        securitiesTransacted: readNumber(row, "securitiesTransacted"),
        transactionDate: readString(row, "transactionDate"),
        transactionType: readString(row, "transactionType"),
        typeOfOwner: readString(row, "typeOfOwner"),
      } satisfies StockInsiderTrade;
    })
    .filter((row): row is StockInsiderTrade => Boolean(row))
    .sort((left, right) => right.filingDate.localeCompare(left.filingDate))
    .slice(0, 20);

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

  return {
    fetchedAt,
    financials: { quarters },
    ownership: {
      beneficialFilings,
      reportedBeneficialOwners,
      statistics,
      trades,
    },
    sharesFloat,
    sources: {
      balanceSheet: sourceStatus(
        providerSources.balanceSheet.state,
        balanceRows.length,
      ),
      beneficialOwnership: sourceStatus(
        providerSources.beneficialOwnership.state,
        beneficialFilings.length,
      ),
      cashFlow: sourceStatus(providerSources.cashFlow.state, cashRows.length),
      incomeStatement: sourceStatus(
        providerSources.incomeStatement.state,
        incomeRows.length,
      ),
      insiderStatistics: sourceStatus(
        providerSources.insiderStatistics.state,
        statistics.length,
      ),
      insiderTrades: sourceStatus(
        providerSources.insiderTrades.state,
        trades.length,
      ),
      institutionalOwnership: {
        rowCount: 0,
        state: "plan_unavailable",
      },
      sharesFloat: sourceStatus(
        providerSources.sharesFloat.state,
        sharesFloat ? 1 : 0,
      ),
    },
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
      issued === null && repurchased === null
        ? null
        : (issued ?? 0) - (repurchased ?? 0),
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

function sourceStatus(
  state: StockFundamentalsProviderResult["state"],
  rowCount: number,
): StockFundamentalsSourceStatus {
  return {
    rowCount,
    state: state === "ready" && rowCount === 0 ? "empty" : state,
  };
}

function matchQuarterRow(
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

function quarterSortValue(quarter: StockFinancialQuarter) {
  const dateValue = Date.parse(quarter.date);
  if (Number.isFinite(dateValue)) return dateValue;
  const year = Number(quarter.fiscalYear);
  const period = Number(quarter.period.replace(/\D/g, ""));
  return (Number.isFinite(year) ? year : 0) * 10 + (period || 0);
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

function readString(
  row: Record<string, unknown> | null,
  key: string,
) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(
  row: Record<string, unknown> | null,
  key: string,
) {
  const value = row?.[key];
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function readInteger(
  row: Record<string, unknown> | null,
  key: string,
) {
  const value = readNumber(row, key);
  return value !== null && Number.isInteger(value) ? value : null;
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
