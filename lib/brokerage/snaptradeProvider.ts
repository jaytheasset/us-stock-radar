import "server-only";

import {
  Snaptrade,
  SnaptradeAuth,
  type Account,
  type AccountOrderRecord,
  type AccountPosition,
  type AccountUniversalActivity,
  type BrokerageAuthorization,
} from "snaptrade-typescript-sdk";
import {
  mapBrokerageAccount,
  mapBrokerageOrder,
  mapBrokeragePosition,
  normalizeActivitiesPage,
} from "./accountData";
import type {
  BrokerageAccountActivities,
  BrokerageAccountOrder,
  BrokerageAccountPositions,
  BrokerageLinkedAccount,
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
  private readonly sandboxBroker: "SANDBOX" | null;

  constructor(input: {
    clientId: string;
    consumerKey: string;
    sandboxBroker?: "SANDBOX" | null;
  }) {
    this.client = new Snaptrade({
      auth: SnaptradeAuth.commercialApiKey({
        clientId: input.clientId,
        consumerKey: input.consumerKey,
      }),
    });
    this.sandboxBroker = input.sandboxBroker || null;
  }

  async registerUser(providerUserId: string) {
    const response = await this.request(() =>
      this.client.authentication.registerSnapTradeUser({
        userId: providerUserId,
      }),
    );
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
    const response = await this.request(() =>
      this.client.authentication.loginSnapTradeUser({
        connectionPortalVersion: "v4",
        connectionType: "read",
        ...(this.sandboxBroker ? { broker: this.sandboxBroker } : {}),
        customRedirect: input.redirectUrl,
        immediateRedirect: true,
        showCloseButton: true,
        userId: input.user.providerUserId,
        userSecret: input.user.userSecret,
      }),
    );
    const value = response.data as { redirectURI?: string };
    if (!value.redirectURI) throw new Error("BROKERAGE_PORTAL_UNAVAILABLE");
    return value.redirectURI;
  }

  async listAccounts(user: BrokerageProviderUser) {
    const [accountsResponse, authorizationsResponse] = await Promise.all([
      this.request(() =>
        this.client.accountInformation.listUserAccounts({
          userId: user.providerUserId,
          userSecret: user.userSecret,
        }),
      ),
      this.request(() =>
        this.client.connections.listBrokerageAuthorizations({
          userId: user.providerUserId,
          userSecret: user.userSecret,
        }),
      ),
    ]);
    return mapAccounts(accountsResponse.data, authorizationsResponse.data);
  }

  async refreshConnection(
    user: BrokerageProviderUser,
    authorizationId: string,
  ) {
    await this.request(() =>
      this.client.connections.refreshBrokerageAuthorization({
        authorizationId,
        userId: user.providerUserId,
        userSecret: user.userSecret,
      }),
    );
    return "queued" as const;
  }

  async getAccount(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageLinkedAccount> {
    const [accountResponse, authorizationsResponse] = await Promise.all([
      this.request(() =>
        this.client.accountInformation.getUserAccountDetails({
          accountId,
          userId: user.providerUserId,
          userSecret: user.userSecret,
        }),
      ),
      this.request(() =>
        this.client.connections.listBrokerageAuthorizations({
          userId: user.providerUserId,
          userSecret: user.userSecret,
        }),
      ),
    ]);
    const authorization = authorizationsResponse.data.find(
      (item) => item.id === accountResponse.data.brokerage_authorization,
    );
    return mapBrokerageAccount(accountResponse.data, authorization);
  }

  async getAccountPositions(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageAccountPositions> {
    const response = await this.request(() =>
      this.client.accountInformation.getAllAccountPositions({
        accountId,
        userId: user.providerUserId,
        userSecret: user.userSecret,
      }),
    );
    return {
      accountId,
      asOf: response.data.data_freshness?.as_of || null,
      positions: response.data.results.map(mapBrokeragePosition),
    };
  }

  async getAccountOrders(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageAccountOrder[]> {
    const response = await this.request(() =>
      this.client.accountInformation.getUserAccountOrders({
        accountId,
        days: 30,
        state: "all",
        userId: user.providerUserId,
        userSecret: user.userSecret,
      }),
    );
    return response.data.map(mapBrokerageOrder);
  }

  async getAccountActivities(
    user: BrokerageProviderUser,
    accountId: string,
    input: { limit: number; offset: number },
  ): Promise<BrokerageAccountActivities> {
    const response = await this.request(() =>
      this.client.accountInformation.getAccountActivities({
        accountId,
        limit: input.limit,
        offset: input.offset,
        userId: user.providerUserId,
        userSecret: user.userSecret,
      }),
    );
    return normalizeActivitiesPage({
      accountId,
      activities: response.data.data || [],
      limit: response.data.pagination?.limit ?? input.limit,
      offset: response.data.pagination?.offset ?? input.offset,
      total: response.data.pagination?.total,
    });
  }

  async listProofCandidates(user: BrokerageProviderUser) {
    const accounts = await this.listAccounts(user);
    const activityEndDate = new Date();
    const activityStartDate = new Date(activityEndDate);
    activityStartDate.setUTCDate(
      activityStartDate.getUTCDate() - ACTIVITY_LOOKBACK_DAYS,
    );
    const candidates = await Promise.all(
      accounts.map(async (account) => {
        const [positions, orders, activities] = await Promise.all([
          this.request(() =>
            this.client.accountInformation.getAllAccountPositions({
              accountId: account.id,
              userId: user.providerUserId,
              userSecret: user.userSecret,
            }),
          ),
          this.request(() =>
            this.client.accountInformation.getUserAccountOrders({
              accountId: account.id,
              days: 30,
              state: "executed",
              userId: user.providerUserId,
              userSecret: user.userSecret,
            }),
          ),
          this.request(() =>
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
          ),
        ]);
        return [
          ...positions.data.results.flatMap((position) =>
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
    const accounts = await this.request(() =>
      this.client.accountInformation.listUserAccounts({
        userId: user.providerUserId,
        userSecret: user.userSecret,
      }),
    );
    const authorizations = [
      ...new Set(accounts.data.map((account) => account.brokerage_authorization)),
    ];
    for (const authorizationId of authorizations) {
      await this.request(() =>
        this.client.connections.removeBrokerageAuthorization({
          authorizationId,
          userId: user.providerUserId,
          userSecret: user.userSecret,
        }),
      );
    }
  }

  async deleteUser(user: BrokerageProviderUser) {
    await this.request(() =>
      this.client.authentication.deleteSnapTradeUser({
        userId: user.providerUserId,
      }),
    );
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      // SnapTrade errors can contain a URL query string with userSecret.
      // Replace the provider error before it reaches application logs or API responses.
      throw new Error("BROKERAGE_PROVIDER_REQUEST_FAILED");
    }
  }
}

function mapAccounts(
  accounts: Account[],
  authorizations: BrokerageAuthorization[],
): BrokerageProviderAccount[] {
  const authorizationMap = new Map(
    authorizations.flatMap((item) => item.id ? [[item.id, item] as const] : []),
  );
  return accounts.map((account) => ({
    ...mapBrokerageAccount(
      account,
      authorizationMap.get(account.brokerage_authorization),
    ),
    providerAuthorizationId: account.brokerage_authorization,
  }));
}

function mapPosition(
  account: BrokerageProviderAccount,
  position: AccountPosition,
): BrokerageProofCandidate[] {
  const mapped = mapBrokeragePosition(position);
  const ticker = mapped.ticker;
  const units = mapped.units;
  if (!ticker || !units) return [];
  return [{
    accountType: account.isPaper ? "paper" : "live",
    averageCost: mapped.costBasis,
    brokerName: account.brokerName,
    executionDate: null,
    executionPrice: null,
    executionQuantity: null,
    id: `position:${account.id}:${mapped.id || ticker}`,
    kind: "position",
    side: mapped.side,
    stage: "current",
    ticker,
    units,
    verifiedAsOf: new Date().toISOString(),
  }];
}

function mapOrder(
  account: BrokerageProviderAccount,
  order: AccountOrderRecord,
): BrokerageProofCandidate[] {
  const ticker = order.universal_symbol?.raw_symbol || order.universal_symbol?.symbol;
  const action = String(order.action || "").toUpperCase();
  if (!ticker || (action !== "BUY" && action !== "SELL")) return [];
  const executedAt = order.time_executed || order.time_updated || order.time_placed;
  return [{
    accountType: account.isPaper ? "paper" : "live",
    averageCost: null,
    brokerName: account.brokerName,
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
  account: BrokerageProviderAccount,
  activity: AccountUniversalActivity,
): BrokerageProofCandidate[] {
  const ticker = activity.symbol?.raw_symbol || activity.symbol?.symbol;
  const action = String(activity.type || "").toUpperCase();
  if (!ticker || (action !== "BUY" && action !== "SELL")) return [];
  return [{
    accountType: account.isPaper ? "paper" : "live",
    averageCost: null,
    brokerName: account.brokerName || activity.institution || "Connected brokerage",
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
