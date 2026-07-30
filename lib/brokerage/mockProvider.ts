import "server-only";

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

const now = () => new Date().toISOString();

export class MockBrokerageProvider implements BrokerageProvider {
  readonly mode = "mock" as const;

  async registerUser(providerUserId: string) {
    return {
      providerUserId,
      userSecret: `mock-secret-${providerUserId}`,
    };
  }

  async createPortal({ redirectUrl }: { redirectUrl: string }) {
    const url = new URL(redirectUrl);
    url.searchParams.set("connection", "returned");
    return url.toString();
  }

  async listAccounts() {
    return [
      mockProviderAccount(
        "mock-live",
        false,
        "Mock Securities",
        "Individual",
        "mock-authorization-live",
      ),
      mockProviderAccount(
        "mock-paper",
        true,
        "Mock Paper Broker",
        "Paper Trading",
        "mock-authorization-paper",
      ),
    ];
  }

  async getAccount(
    _user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageLinkedAccount> {
    return accountId === "mock-paper"
      ? mockAccount(accountId, true, "Mock Paper Broker", "Paper Trading")
      : mockAccount(accountId, false, "Mock Securities", "Individual");
  }

  async getAccountPositions(
    _user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageAccountPositions> {
    return {
      accountId,
      asOf: now(),
      positions: [{
        assetType: "stock",
        costBasis: 118.4,
        currency: "USD",
        description: "NVIDIA Corporation",
        id: "mock-position-nvda",
        isCashEquivalent: false,
        price: 135.9,
        side: "LONG",
        ticker: "NVDA",
        units: 12,
      }],
    };
  }

  async getAccountOrders(
    _user: BrokerageProviderUser,
    _accountId: string,
  ): Promise<BrokerageAccountOrder[]> {
    return [{
      action: "BUY",
      executedAt: now(),
      executionPrice: 164.2,
      filledQuantity: 5,
      id: "mock-order-0",
      orderType: "Market",
      placedAt: now(),
      status: "EXECUTED",
      ticker: "AMD",
      totalQuantity: 5,
    }];
  }

  async getAccountActivities(
    _user: BrokerageProviderUser,
    accountId: string,
    input: { limit: number; offset: number },
  ): Promise<BrokerageAccountActivities> {
    return {
      accountId,
      activities: [{
        amount: 575.25,
        currency: "USD",
        description: "Mock sell",
        fee: 0,
        id: "mock-activity-0",
        price: 191.75,
        settlementDate: now().slice(0, 10),
        ticker: "AAPL",
        tradeDate: now(),
        type: "SELL",
        units: 3,
      }],
      limit: input.limit,
      offset: input.offset,
      total: 1,
    };
  }

  async listProofCandidates(): Promise<BrokerageProofCandidate[]> {
    const date = now().slice(0, 10);
    return [
      {
        accountType: "live",
        averageCost: 118.4,
        brokerName: "Mock Securities",
        executionDate: null,
        executionPrice: null,
        executionQuantity: null,
        id: "mock-position-nvda-live",
        kind: "position",
        side: "LONG",
        stage: "current",
        ticker: "NVDA",
        units: 12,
        verifiedAsOf: now(),
      },
      {
        accountType: "paper",
        averageCost: null,
        brokerName: "Mock Paper Broker",
        executionDate: date,
        executionPrice: 164.2,
        executionQuantity: 5,
        id: "mock-order-amd-paper",
        kind: "execution",
        side: "BUY",
        stage: "provisional",
        ticker: "AMD",
        units: null,
        verifiedAsOf: now(),
      },
      {
        accountType: "live",
        averageCost: null,
        brokerName: "Mock Securities",
        executionDate: date,
        executionPrice: 191.75,
        executionQuantity: 3,
        id: "mock-activity-aapl-live",
        kind: "execution",
        side: "SELL",
        stage: "final",
        ticker: "AAPL",
        units: null,
        verifiedAsOf: now(),
      },
    ];
  }

  async refreshConnection(
    _user: BrokerageProviderUser,
    _authorizationId: string,
  ) {
    return "succeeded" as const;
  }

  async disconnect(_user: BrokerageProviderUser) {}
  async deleteUser(_user: BrokerageProviderUser) {}
}

function mockAccount(
  id: string,
  isPaper: boolean,
  brokerName: string,
  name: string,
): BrokerageLinkedAccount {
  return {
    accountCategory: "INVESTMENT",
    accountStatus: "open",
    brokerName,
    connectionStatus: "connected",
    dataFreshness: "delayed",
    holdingsSync: "ready",
    id,
    isPaper,
    lastHoldingsSync: now(),
    lastTransactionsSync: now(),
    maskedNumber: isPaper ? "•••• 0002" : "•••• 0001",
    name,
    rawType: isPaper ? "Paper" : "Individual",
    transactionsSync: "ready",
  };
}

function mockProviderAccount(
  id: string,
  isPaper: boolean,
  brokerName: string,
  name: string,
  providerAuthorizationId: string,
): BrokerageProviderAccount {
  return {
    ...mockAccount(id, isPaper, brokerName, name),
    providerAuthorizationId,
  };
}
