import type {
  Account,
  AccountOrderRecord,
  AccountPosition,
  AccountUniversalActivity,
  BrokerageAuthorization,
} from "snaptrade-typescript-sdk";
import type {
  BrokerageAccountActivities,
  BrokerageAccountActivity,
  BrokerageAccountOrder,
  BrokerageAccountPosition,
  BrokerageLinkedAccount,
  BrokerageProviderAccount,
} from "./types";

export function mapBrokerageAccount(
  account: Account,
  authorization?: BrokerageAuthorization,
): BrokerageLinkedAccount {
  const holdings = account.sync_status?.holdings;
  const transactions = account.sync_status?.transactions;
  return {
    accountCategory: cleanText(account.account_category),
    accountStatus: readAccountStatus(account.status),
    brokerName: cleanText(account.institution_name) || "Connected brokerage",
    connectionStatus:
      authorization?.disabled === true
        ? "disabled"
        : authorization
          ? "connected"
          : "unknown",
    dataFreshness:
      authorization?.data_freshness_mode === "realtime" ||
      authorization?.data_freshness_mode === "delayed"
        ? authorization.data_freshness_mode
        : "unknown",
    holdingsSync:
      holdings?.holdings_unavailable === true
        ? "unavailable"
        : holdings?.initial_sync_completed === true
          ? "ready"
          : holdings
            ? "syncing"
            : "unknown",
    id: account.id,
    isPaper: account.is_paper === true,
    lastHoldingsSync: cleanText(holdings?.last_successful_sync),
    lastTransactionsSync: cleanText(transactions?.last_successful_sync),
    maskedNumber: maskBrokerageAccountNumber(account.number),
    name: cleanText(account.name) || "Brokerage account",
    rawType: cleanText(account.raw_type),
    transactionsSync:
      transactions?.initial_sync_completed === true
        ? "ready"
        : transactions
          ? "syncing"
          : "unknown",
  };
}

export function mapBrokeragePosition(
  position: AccountPosition,
): BrokerageAccountPosition {
  const instrument = position.instrument;
  const units = finiteNumber(position.units);
  return {
    assetType: instrument.kind,
    costBasis: finiteNumber(position.cost_basis),
    currency: cleanText(position.currency),
    description: cleanText(instrument.description),
    id: instrument.id,
    isCashEquivalent: position.cash_equivalent === true,
    price: finiteNumber(position.price),
    side: units !== null && units < 0 ? "SHORT" : "LONG",
    ticker:
      cleanText("raw_symbol" in instrument ? instrument.raw_symbol : null) ||
      cleanText(instrument.symbol) ||
      instrument.kind.toUpperCase(),
    units: units === null ? null : Math.abs(units),
  };
}

export function mapBrokerageOrder(
  order: AccountOrderRecord,
  index: number,
): BrokerageAccountOrder {
  const ticker =
    cleanText(order.universal_symbol?.raw_symbol) ||
    cleanText(order.universal_symbol?.symbol) ||
    cleanText(order.option_symbol?.ticker) ||
    "Unknown";
  const placedAt = cleanText(order.time_placed);
  const executedAt = cleanText(order.time_executed);
  return {
    action: cleanText(order.action) || "UNKNOWN",
    executedAt,
    executionPrice: finiteNumber(order.execution_price),
    filledQuantity: finiteNumber(order.filled_quantity),
    id: `order-${index}-${executedAt || placedAt || "unknown"}`,
    orderType: cleanText(order.order_type),
    placedAt,
    status: cleanText(order.status) || "UNKNOWN",
    ticker,
    totalQuantity: finiteNumber(order.total_quantity),
  };
}

export function mapBrokerageActivity(
  activity: AccountUniversalActivity,
  index: number,
): BrokerageAccountActivity {
  const tradeDate = cleanText(activity.trade_date);
  return {
    amount: finiteNumber(activity.amount),
    currency: cleanText(activity.currency?.code),
    description: cleanText(activity.description),
    fee: finiteNumber(activity.fee),
    id: `activity-${index}-${tradeDate || "unknown"}`,
    price: finiteNumber(activity.price),
    settlementDate: cleanText(activity.settlement_date),
    ticker:
      cleanText(activity.symbol?.raw_symbol) ||
      cleanText(activity.symbol?.symbol) ||
      cleanText(activity.option_symbol?.ticker),
    tradeDate,
    type: cleanText(activity.type) || "UNKNOWN",
    units: finiteNumber(activity.units),
  };
}

export function maskBrokerageAccountNumber(value: unknown) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const visible = cleaned.replace(/[^a-z0-9]/gi, "").slice(-4);
  return visible ? `•••• ${visible}` : null;
}

export function assertOwnedBrokerageAccount<T extends BrokerageLinkedAccount>(
  accounts: readonly T[],
  accountId: string,
): T | null {
  return accounts.find((account) => account.id === accountId) || null;
}

export function toPublicBrokerageAccount(
  account: BrokerageProviderAccount,
): BrokerageLinkedAccount {
  const { providerAuthorizationId: _providerAuthorizationId, ...publicAccount } =
    account;
  return publicAccount;
}

export function normalizeActivitiesPage(input: {
  accountId: string;
  activities: AccountUniversalActivity[];
  limit: number;
  offset: number;
  total?: number | null;
}): BrokerageAccountActivities {
  return {
    accountId: input.accountId,
    activities: input.activities.map(mapBrokerageActivity),
    limit: input.limit,
    offset: input.offset,
    total: finiteNumber(input.total),
  };
}

function readAccountStatus(
  value: Account["status"],
): BrokerageLinkedAccount["accountStatus"] {
  return value === "open" ||
    value === "closed" ||
    value === "archived" ||
    value === "unavailable"
    ? value
    : "unknown";
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
