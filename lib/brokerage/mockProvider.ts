import "server-only";

import type {
  BrokerageProofCandidate,
  BrokerageProvider,
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
      { brokerName: "Mock Securities", id: "mock-live", isPaper: false },
      { brokerName: "Mock Paper Broker", id: "mock-paper", isPaper: true },
    ];
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

  async disconnect(_user: BrokerageProviderUser) {}
  async deleteUser(_user: BrokerageProviderUser) {}
}
