import "server-only";

import {
  Snaptrade,
  SnaptradeAuth,
  type Account,
  type AccountOrderRecord,
  type AccountUniversalActivity,
  type Position,
} from "snaptrade-typescript-sdk";
import type {
  BrokerageProofCandidate,
  BrokerageProvider,
  BrokerageProviderAccount,
  BrokerageProviderUser,
} from "./types";

const ACTIVITY_LOOKBACK_DAYS = 90;
const ACTIVITY_LIMIT = 100;

export class SnapTradeBrokerageProvider implements BrokerageProvider {
  readonly mode = "real" as const;
  private readonly client: Snaptrade<ReturnType<typeof SnaptradeAuth.commercialApiKey>>;

  constructor(input: { clientId: string; consumerKey: string }) {
    this.client = new Snaptrade({
      auth: SnaptradeAuth.commercialApiKey(input),
    });
  }

  async registerUser(providerUserId: string) {
    const response = await this.client.authentication.registerSnapTradeUser({
      userId: providerUserId,
    });
    if (!response.data.userId || !response.data.userSecret) {
      throw new Error("BROKERAGE_REGISTRATION_FAILED");
    }
    return {
      providerUserId: response.data.userId,
      userSecret: response.data.userSecret,
    };
  }

  async createPortal(input: {
    redirectUrl: string;
    user: BrokerageProviderUser;
  }) {
    const response = await this.client.authentication.loginSnapTradeUser({
      connectionType: "read",
      customRedirect: input.redirectUrl,
      immediateRedirect: true,
      showCloseButton: true,
      userId: input.user.providerUserId,
      userSecret: input.user.userSecret,
    });
    const value = response.data as { redirectURI?: string };
    if (!value.redirectURI) throw new Error("BROKERAGE_PORTAL_UNAVAILABLE");
    return value.redirectURI;
  }

  async listAccounts(user: BrokerageProviderUser) {
    const response = await this.client.accountInformation.listUserAccounts({
      userId: user.providerUserId,
      userSecret: user.userSecret,
    });
    return response.data.map(mapAccount);
  }

  async listProofCandidates(user: BrokerageProviderUser) {
    const accountsResponse =
      await this.client.accountInformation.listUserAccounts({
        userId: user.providerUserId,
        userSecret: user.userSecret,
      });
    const activityEndDate = new Date();
    const activityStartDate = new Date(activityEndDate);
    activityStartDate.setUTCDate(
      activityStartDate.getUTCDate() - ACTIVITY_LOOKBACK_DAYS,
    );
    const candidates = await Promise.all(
      accountsResponse.data.map(async (account) => {
        const [positions, orders, activities] = await Promise.all([
          this.client.accountInformation.getUserAccountPositions({
            accountId: account.id,
            userId: user.providerUserId,
            userSecret: user.userSecret,
          }),
          this.client.accountInformation.getUserAccountOrders({
            accountId: account.id,
            days: 30,
            state: "executed",
            userId: user.providerUserId,
            userSecret: user.userSecret,
          }),
          this.client.accountInformation.getAccountActivities({
            accountId: account.id,
            endDate: activityEndDate,
            limit: ACTIVITY_LIMIT,
            offset: 0,
            startDate: activityStartDate,
            type: "BUY,SELL",
            userId: user.providerUserId,
            userSecret: user.userSecret,
          }),
        ]);
        return [
          ...positions.data.flatMap((position) =>
            mapPosition(account, position),
          ),
          ...orders.data.flatMap((order) => mapOrder(account, order)),
          ...(activities.data.data || []).flatMap((activity) =>
            mapActivity(account, activity),
          ),
        ];
      }),
    );
    return candidates.flat();
  }

  async disconnect(user: BrokerageProviderUser) {
    const accounts = await this.client.accountInformation.listUserAccounts({
      userId: user.providerUserId,
      userSecret: user.userSecret,
    });
    const authorizations = [
      ...new Set(accounts.data.map((account) => account.brokerage_authorization)),
    ];
    for (const authorizationId of authorizations) {
      await this.client.connections.removeBrokerageAuthorization({
        authorizationId,
        userId: user.providerUserId,
        userSecret: user.userSecret,
      });
    }
  }

  async deleteUser(user: BrokerageProviderUser) {
    await this.client.authentication.deleteSnapTradeUser({
      userId: user.providerUserId,
    });
  }
}

function mapAccount(account: Account): BrokerageProviderAccount {
  return {
    brokerName: account.institution_name || "Connected brokerage",
    id: account.id,
    isPaper: account.is_paper,
  };
}

function mapPosition(account: Account, position: Position): BrokerageProofCandidate[] {
  const ticker = position.symbol?.symbol?.raw_symbol || position.symbol?.symbol?.symbol;
  const units = position.units;
  if (!ticker || !units) return [];
  return [{
    accountType: account.is_paper ? "paper" : "live",
    averageCost: finiteNumber(position.average_purchase_price),
    brokerName: account.institution_name || "Connected brokerage",
    executionDate: null,
    executionPrice: null,
    executionQuantity: null,
    id: `position:${account.id}:${position.symbol?.symbol?.id || ticker}`,
    kind: "position",
    side: units < 0 ? "SHORT" : "LONG",
    stage: "current",
    ticker,
    units: Math.abs(units),
    verifiedAsOf: new Date().toISOString(),
  }];
}

function mapOrder(account: Account, order: AccountOrderRecord): BrokerageProofCandidate[] {
  const ticker = order.universal_symbol?.raw_symbol || order.universal_symbol?.symbol;
  const action = String(order.action || "").toUpperCase();
  if (!ticker || (action !== "BUY" && action !== "SELL")) return [];
  const executedAt = order.time_executed || order.time_updated || order.time_placed;
  return [{
    accountType: account.is_paper ? "paper" : "live",
    averageCost: null,
    brokerName: account.institution_name || "Connected brokerage",
    executionDate: executedAt ? executedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
    executionPrice: finiteNumber(order.execution_price),
    executionQuantity: finiteNumber(order.filled_quantity),
    id: `order:${account.id}:${order.brokerage_order_id || `${ticker}:${executedAt}`}`,
    kind: "execution",
    side: action,
    stage: "provisional",
    ticker,
    units: null,
    verifiedAsOf: new Date().toISOString(),
  }];
}

function mapActivity(
  account: Account,
  activity: AccountUniversalActivity,
): BrokerageProofCandidate[] {
  const ticker = activity.symbol?.raw_symbol || activity.symbol?.symbol;
  const action = String(activity.type || "").toUpperCase();
  if (!ticker || (action !== "BUY" && action !== "SELL")) return [];
  return [{
    accountType: account.is_paper ? "paper" : "live",
    averageCost: null,
    brokerName: account.institution_name || activity.institution || "Connected brokerage",
    executionDate: (activity.trade_date || new Date().toISOString()).slice(0, 10),
    executionPrice: finiteNumber(activity.price),
    executionQuantity: finiteNumber(activity.units),
    id: `activity:${activity.id || `${account.id}:${ticker}:${activity.trade_date}`}`,
    kind: "execution",
    side: action,
    stage: "final",
    ticker,
    units: null,
    verifiedAsOf: new Date().toISOString(),
  }];
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
