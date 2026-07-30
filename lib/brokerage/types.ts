export type BrokerageProviderMode = "mock" | "real" | "unavailable";
export type BrokerageAccountType = "live" | "paper";
export type BrokerageProofKind = "position" | "execution";
export type BrokerageProofStage =
  | "current"
  | "historical"
  | "provisional"
  | "final";

export type BrokerageConnectionStatus = {
  accountTypes: BrokerageAccountType[];
  canConnect: boolean;
  connected: boolean;
  effectivePlan: string;
  mode: BrokerageProviderMode;
  publicProofsEnabled: boolean;
  status:
    | "not_configured"
    | "upgrade_required"
    | "terms_required"
    | "ready"
    | "connected"
    | "disconnected"
    | "credentials_reset_required"
    | "unavailable";
  termsAccepted: boolean;
};

export type BrokerageLinkedAccount = {
  accountCategory: string | null;
  accountStatus: "open" | "closed" | "archived" | "unavailable" | "unknown";
  brokerName: string;
  connectionStatus: "connected" | "disabled" | "unknown";
  dataFreshness: "realtime" | "delayed" | "unknown";
  holdingsSync: "ready" | "syncing" | "unavailable" | "unknown";
  id: string;
  isPaper: boolean;
  lastHoldingsSync: string | null;
  lastTransactionsSync: string | null;
  maskedNumber: string | null;
  name: string;
  rawType: string | null;
  transactionsSync: "ready" | "syncing" | "unknown";
};

export type BrokerageManualRefreshAccountState = {
  canRefresh: boolean;
  lastRequestedAt: string | null;
  retryAfterSeconds: number;
  status:
    | "ready"
    | "cooldown"
    | "pending"
    | "quota_exhausted"
    | "realtime"
    | "unavailable";
};

export type BrokerageManualRefreshQuota = {
  accountStates: Record<string, BrokerageManualRefreshAccountState>;
  available: number;
  cooldownSeconds: number;
  monthlyLimit: number;
  pending: number;
  remaining: number;
  resetAt: string;
  used: number;
};

export type BrokerageManualRefreshResult = {
  accountId: string;
  quota: BrokerageManualRefreshQuota;
  status: "queued" | "succeeded" | "realtime";
};

export type BrokerageAccountPosition = {
  assetType: string;
  costBasis: number | null;
  currency: string | null;
  description: string | null;
  id: string;
  isCashEquivalent: boolean;
  price: number | null;
  side: "LONG" | "SHORT";
  ticker: string;
  units: number | null;
};

export type BrokerageAccountPositions = {
  accountId: string;
  asOf: string | null;
  positions: BrokerageAccountPosition[];
};

export type BrokerageAccountOrder = {
  action: string;
  executedAt: string | null;
  executionPrice: number | null;
  filledQuantity: number | null;
  id: string;
  orderType: string | null;
  placedAt: string | null;
  status: string;
  ticker: string;
  totalQuantity: number | null;
};

export type BrokerageAccountActivity = {
  amount: number | null;
  currency: string | null;
  description: string | null;
  fee: number | null;
  id: string;
  price: number | null;
  settlementDate: string | null;
  ticker: string | null;
  tradeDate: string | null;
  type: string;
  units: number | null;
};

export type BrokerageAccountActivities = {
  accountId: string;
  activities: BrokerageAccountActivity[];
  limit: number;
  offset: number;
  total: number | null;
};

export type BrokerageProofSummary = {
  accountType: BrokerageAccountType;
  brokerName: string | null;
  connectionState: "connected" | "expired" | "disconnected";
  executionDate: string | null;
  executionPrice: number | null;
  executionQuantity: number | null;
  id: string;
  kind: BrokerageProofKind;
  revoked: boolean;
  side: "LONG" | "SHORT" | "BUY" | "SELL";
  stage: BrokerageProofStage;
  ticker: string;
  units: number | null;
  averageCost: number | null;
  verifiedAsOf: string;
};

export type BrokerageProofCandidate = {
  accountType: BrokerageAccountType;
  averageCost: number | null;
  brokerName: string;
  executionDate: string | null;
  executionPrice: number | null;
  executionQuantity: number | null;
  id: string;
  kind: BrokerageProofKind;
  side: "LONG" | "SHORT" | "BUY" | "SELL";
  stage: BrokerageProofStage;
  ticker: string;
  units: number | null;
  verifiedAsOf: string;
};

export type BrokerageProofDisclosure = {
  averageCost?: boolean;
  brokerName?: boolean;
  executionPrice?: boolean;
  executionQuantity?: boolean;
  units?: boolean;
};

export type BrokerageProviderUser = {
  providerUserId: string;
  userSecret: string;
};

export type BrokerageProviderAccount = BrokerageLinkedAccount & {
  providerAuthorizationId: string;
};

export interface BrokerageProvider {
  readonly mode: Exclude<BrokerageProviderMode, "unavailable">;
  createPortal(input: {
    redirectUrl: string;
    user: BrokerageProviderUser;
  }): Promise<string>;
  deleteUser(user: BrokerageProviderUser): Promise<void>;
  disconnect(user: BrokerageProviderUser): Promise<void>;
  getAccount(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageLinkedAccount>;
  getAccountActivities(
    user: BrokerageProviderUser,
    accountId: string,
    input: { limit: number; offset: number },
  ): Promise<BrokerageAccountActivities>;
  getAccountOrders(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageAccountOrder[]>;
  getAccountPositions(
    user: BrokerageProviderUser,
    accountId: string,
  ): Promise<BrokerageAccountPositions>;
  listAccounts(user: BrokerageProviderUser): Promise<BrokerageProviderAccount[]>;
  listProofCandidates(
    user: BrokerageProviderUser,
  ): Promise<BrokerageProofCandidate[]>;
  refreshConnection(
    user: BrokerageProviderUser,
    authorizationId: string,
  ): Promise<"queued" | "succeeded">;
  registerUser(providerUserId: string): Promise<BrokerageProviderUser>;
}
