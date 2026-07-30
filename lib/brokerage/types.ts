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
    | "unavailable";
  termsAccepted: boolean;
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

export type BrokerageProviderAccount = {
  brokerName: string;
  id: string;
  isPaper: boolean;
};

export interface BrokerageProvider {
  readonly mode: Exclude<BrokerageProviderMode, "unavailable">;
  createPortal(input: {
    redirectUrl: string;
    user: BrokerageProviderUser;
  }): Promise<string>;
  deleteUser(user: BrokerageProviderUser): Promise<void>;
  disconnect(user: BrokerageProviderUser): Promise<void>;
  listAccounts(user: BrokerageProviderUser): Promise<BrokerageProviderAccount[]>;
  listProofCandidates(
    user: BrokerageProviderUser,
  ): Promise<BrokerageProofCandidate[]>;
  registerUser(providerUserId: string): Promise<BrokerageProviderUser>;
}
