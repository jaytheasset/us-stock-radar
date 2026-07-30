import "server-only";

import { createHash } from "node:crypto";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import {
  supabaseDelete,
  supabaseRpc,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase";
import { getBrokerageConfig } from "./config";
import {
  decryptBrokerageSecret,
  encryptBrokerageSecret,
  type EncryptedBrokerageSecret,
} from "./crypto";
import {
  BROKERAGE_PUBLIC_CONSENT_VERSION,
  BROKERAGE_TERMS_VERSION,
  canUseBrokerage,
  createSnapTradeUserId,
  normalizeProofCandidate,
} from "./policy";
import { getBrokerageProvider } from "./provider";
import {
  assertOwnedBrokerageAccount,
  toPublicBrokerageAccount,
} from "./accountData";
import type {
  BrokerageAccountActivities,
  BrokerageAccountOrder,
  BrokerageAccountPositions,
  BrokerageConnectionStatus,
  BrokerageLinkedAccount,
  BrokerageManualRefreshQuota,
  BrokerageManualRefreshResult,
  BrokerageProofDisclosure,
  BrokerageProofSummary,
  BrokerageProviderAccount,
  BrokerageProviderUser,
} from "./types";

type ConnectionRow = {
  disconnected_at?: unknown;
  encrypted_user_secret?: unknown;
  has_live_account?: unknown;
  has_paper_account?: unknown;
  provider_user_id?: unknown;
  public_consent_at?: unknown;
  secret_auth_tag?: unknown;
  secret_iv?: unknown;
  secret_key_version?: unknown;
  status?: unknown;
  terms_accepted_at?: unknown;
};

export class BrokeragePolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function getBrokerageConnectionStatus(
  userId: string,
): Promise<BrokerageConnectionStatus> {
  const [effective, connection] = await Promise.all([
    getEffectiveUserPlan(userId),
    getConnection(userId),
  ]);
  const config = getBrokerageConfig();
  const eligible = canUseBrokerage(effective.effectivePlan);
  const credentialsUnreadable = Boolean(
    connection &&
      config.encryptionKey &&
      hasEncryptedProviderSecret(connection) &&
      !canDecryptProviderUser(connection, config.encryptionKey),
  );
  const connected =
    connection?.status === "connected" && !credentialsUnreadable;
  const termsAccepted = Boolean(connection?.terms_accepted_at);
  return {
    accountTypes: [
      ...(connection?.has_live_account === true ? (["live"] as const) : []),
      ...(connection?.has_paper_account === true ? (["paper"] as const) : []),
    ],
    canConnect: eligible && config.connectionsEnabled,
    connected,
    effectivePlan: effective.effectivePlan,
    mode: config.mode,
    publicProofsEnabled: config.publicProofsEnabled,
    status: !eligible
      ? "upgrade_required"
      : config.mode === "unavailable" || !config.encryptionKey
        ? "not_configured"
        : credentialsUnreadable
          ? "credentials_reset_required"
          : !termsAccepted
            ? "terms_required"
            : connected
              ? "connected"
              : connection?.status === "disconnected"
                ? "disconnected"
                : "ready",
    termsAccepted,
  };
}

export async function acceptBrokerageTerms(userId: string) {
  await assertBrokerageEligibility(userId);
  const providerUserId = createSnapTradeUserId(userId);
  const result = await supabaseUpsert(
    "brokerage_connections",
    {
      provider: "snaptrade",
      provider_user_id: providerUserId,
      status: "registered",
      terms_accepted_at: new Date().toISOString(),
      terms_version: BROKERAGE_TERMS_VERSION,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    { onConflict: "user_id" },
  );
  if (!result.ok) throw unavailable(result.error);
  return getBrokerageConnectionStatus(userId);
}

export async function createBrokeragePortal(
  userId: string,
  origin: string,
) {
  await assertBrokerageEligibility(userId);
  const config = getBrokerageConfig();
  const provider = getBrokerageProvider();
  if (!provider || !config.encryptionKey) {
    throw new BrokeragePolicyError(
      "BROKERAGE_NOT_CONFIGURED",
      "Brokerage connections are not configured yet.",
      503,
    );
  }
  const connection = await getConnection(userId);
  if (!connection?.terms_accepted_at) {
    throw new BrokeragePolicyError(
      "BROKERAGE_TERMS_REQUIRED",
      "Accept the SnapTrade End User Terms before connecting.",
    );
  }
  let user = readProviderUserOrThrow(connection, config.encryptionKey);
  if (!user) {
    user = await provider.registerUser(createSnapTradeUserId(userId));
    const encrypted = encryptBrokerageSecret(
      user.userSecret,
      config.encryptionKey,
    );
    await saveRegisteredUser(userId, user, encrypted);
  }
  const redirectUrl = new URL("/account/brokerage", origin);
  redirectUrl.searchParams.set("connection", "returned");
  const url = await provider.createPortal({
    redirectUrl: redirectUrl.toString(),
    user,
  });
  await updateConnection(userId, { status: "connecting" });
  return { url };
}

export async function syncBrokerageConnection(userId: string) {
  await assertBrokerageEligibility(userId);
  const provider = getBrokerageProvider();
  const config = getBrokerageConfig();
  const connection = await getConnection(userId);
  const user =
    connection && config.encryptionKey
      ? readProviderUserOrThrow(connection, config.encryptionKey)
      : null;
  if (!provider || !user) {
    throw new BrokeragePolicyError(
      "BROKERAGE_NOT_CONFIGURED",
      "Brokerage connections are not configured yet.",
      503,
    );
  }
  const accounts = await provider.listAccounts(user);
  await updateConnection(userId, {
    connected_at: accounts.length ? new Date().toISOString() : null,
    disconnected_at: accounts.length ? null : new Date().toISOString(),
    has_live_account: accounts.some((account) => !account.isPaper),
    has_paper_account: accounts.some((account) => account.isPaper),
    last_synced_at: new Date().toISOString(),
    status: accounts.length ? "connected" : "disconnected",
  });
  return getBrokerageConnectionStatus(userId);
}

export async function disconnectBrokerage(userId: string) {
  const provider = getBrokerageProvider();
  const config = getBrokerageConfig();
  const connection = await getConnection(userId);
  const user =
    connection && config.encryptionKey
      ? readProviderUserOrThrow(connection, config.encryptionKey)
      : null;
  if (provider && user) await provider.disconnect(user);
  await updateConnection(userId, {
    disconnected_at: new Date().toISOString(),
    has_live_account: false,
    has_paper_account: false,
    status: "disconnected",
  });
  await expireProofsForUser(userId, "disconnected");
  return getBrokerageConnectionStatus(userId);
}

export async function deleteBrokerageData(userId: string) {
  const provider = getBrokerageProvider();
  const config = getBrokerageConfig();
  const connection = await getConnection(userId);
  const user =
    connection && config.encryptionKey
      ? readProviderUserOrThrow(connection, config.encryptionKey)
      : null;
  if (provider && user) await provider.deleteUser(user);
  await expireProofsForUser(userId, "expired");
  const result = await supabaseDelete("brokerage_connections", {
    user_id: `eq.${userId}`,
  });
  if (!result.ok) throw unavailable(result.error);
  return { deleted: true as const };
}

export async function listBrokerageProofCandidates(userId: string) {
  await assertBrokerageEligibility(userId);
  const { provider, user } = await getReadyProviderUser(userId);
  return (await provider.listProofCandidates(user)).map(normalizeProofCandidate);
}

export async function listBrokerageAccounts(
  userId: string,
): Promise<BrokerageLinkedAccount[]> {
  await assertBrokerageEligibility(userId);
  const { provider, user } = await getReadyProviderUser(userId);
  return (await provider.listAccounts(user)).map(toPublicBrokerageAccount);
}

export async function getBrokerageAccount(
  userId: string,
  accountId: string,
): Promise<BrokerageLinkedAccount> {
  const { provider, user, ownedAccount } =
    await getOwnedBrokerageAccount(userId, accountId);
  const detail = await provider.getAccount(user, ownedAccount.id);
  return {
    ...detail,
    connectionStatus: ownedAccount.connectionStatus,
    dataFreshness: ownedAccount.dataFreshness,
  };
}

export async function getBrokerageAccountPositions(
  userId: string,
  accountId: string,
): Promise<BrokerageAccountPositions> {
  const { provider, user, ownedAccount } =
    await getOwnedBrokerageAccount(userId, accountId);
  return provider.getAccountPositions(user, ownedAccount.id);
}

export async function getBrokerageAccountOrders(
  userId: string,
  accountId: string,
): Promise<BrokerageAccountOrder[]> {
  const { provider, user, ownedAccount } =
    await getOwnedBrokerageAccount(userId, accountId);
  return provider.getAccountOrders(user, ownedAccount.id);
}

export async function getBrokerageAccountActivities(
  userId: string,
  accountId: string,
  input: { limit?: number; offset?: number },
): Promise<BrokerageAccountActivities> {
  const { provider, user, ownedAccount } =
    await getOwnedBrokerageAccount(userId, accountId);
  const requestedLimit = Number.isFinite(input.limit)
    ? Math.trunc(input.limit as number)
    : 50;
  const requestedOffset = Number.isFinite(input.offset)
    ? Math.trunc(input.offset as number)
    : 0;
  const limit = Math.max(1, Math.min(requestedLimit, 100));
  const offset = Math.max(0, requestedOffset);
  return provider.getAccountActivities(user, ownedAccount.id, {
    limit,
    offset,
  });
}

export async function getBrokerageManualRefreshQuota(
  userId: string,
): Promise<BrokerageManualRefreshQuota> {
  await assertBrokerageEligibility(userId);
  const { provider, user } = await getReadyProviderUser(userId);
  const accounts = await provider.listAccounts(user);
  return readBrokerageManualRefreshQuota(userId, accounts);
}

export async function refreshBrokerageAccount(
  userId: string,
  accountId: string,
): Promise<BrokerageManualRefreshResult> {
  const { accounts, ownedAccount, provider, user } =
    await getOwnedBrokerageAccount(userId, accountId);
  if (ownedAccount.dataFreshness === "realtime") {
    return {
      accountId: ownedAccount.id,
      quota: await readBrokerageManualRefreshQuota(userId, accounts),
      status: "realtime",
    };
  }
  if (ownedAccount.dataFreshness !== "delayed") {
    throw new BrokeragePolicyError(
      "BROKERAGE_REFRESH_UNAVAILABLE",
      "Manual refresh is unavailable until the connection data mode is known.",
      409,
    );
  }

  const config = getBrokerageConfig();
  const expectedAccountIds = accounts
    .filter(
      (account) =>
        account.providerAuthorizationId ===
        ownedAccount.providerAuthorizationId,
    )
    .map((account) => account.id);
  const reservation = await supabaseRpc(
    "reserve_brokerage_manual_refresh",
    {
      p_cooldown_seconds: config.manualRefreshCooldownSeconds,
      p_estimated_cost_cents: config.manualRefreshEstimatedCostCents,
      p_expected_account_ids: expectedAccountIds,
      p_monthly_limit: config.manualRefreshMonthlyLimit,
      p_provider_account_id: ownedAccount.id,
      p_provider_authorization_id: ownedAccount.providerAuthorizationId,
      p_user_id: userId,
    },
  );
  if (!reservation.ok) {
    throw mapRefreshDatabaseError(reservation.error, reservation.status);
  }
  const reservationRow = readSingle(reservation.data);
  const requestId = readString(reservationRow?.request_id);
  const requestedAt =
    readString(reservationRow?.refresh_requested_at) ||
    new Date().toISOString();
  if (!isUuid(requestId)) throw unavailable();

  const providerAcceptedAt = new Date().toISOString();
  const queued = await supabaseUpdate(
    "brokerage_manual_refreshes",
    { id: `eq.${requestId}`, user_id: `eq.${userId}` },
    {
      provider_accepted_at: providerAcceptedAt,
      status: "queued",
    },
  );
  if (!queued.ok) throw unavailable(queued.error);

  let providerResult: "queued" | "succeeded";
  try {
    providerResult = await provider.refreshConnection(
      user,
      ownedAccount.providerAuthorizationId,
    );
  } catch (error) {
    await supabaseUpdate(
      "brokerage_manual_refreshes",
      { id: `eq.${requestId}`, user_id: `eq.${userId}` },
      {
        completed_at: new Date().toISOString(),
        failure_code: "PROVIDER_REQUEST_FAILED",
        provider_accepted_at: null,
        status: "request_failed",
      },
    );
    throw error;
  }

  if (providerResult === "succeeded") {
    const completedAt = new Date().toISOString();
    const completed = await supabaseUpdate(
      "brokerage_manual_refreshes",
      { id: `eq.${requestId}`, user_id: `eq.${userId}` },
      {
        completed_account_ids: expectedAccountIds,
        completed_at: completedAt,
        counted_at: requestedAt,
        status: "succeeded",
      },
    );
    if (!completed.ok) throw unavailable(completed.error);
  }

  return {
    accountId: ownedAccount.id,
    quota: await readBrokerageManualRefreshQuota(userId, accounts),
    status: providerResult,
  };
}

export async function recordBrokerageManualRefreshWebhook(input: {
  accountId: string;
  authorizationId: string;
  eventTimestamp: string;
  succeeded: boolean;
  userId: string;
}) {
  return supabaseRpc("record_brokerage_manual_refresh_webhook", {
    p_event_timestamp: input.eventTimestamp,
    p_provider_account_id: input.accountId,
    p_provider_authorization_id: input.authorizationId,
    p_succeeded: input.succeeded,
    p_user_id: input.userId,
  });
}

export async function createBrokerageProof(
  userId: string,
  input: {
    candidateId?: unknown;
    disclosure?: BrokerageProofDisclosure;
    publicConsent?: unknown;
  },
) {
  await assertBrokerageEligibility(userId);
  const config = getBrokerageConfig();
  if (!config.publicProofsEnabled) {
    throw new BrokeragePolicyError(
      "BROKERAGE_PUBLIC_SHARING_DISABLED",
      "Public sharing is pending provider approval.",
      403,
    );
  }
  if (input.publicConsent !== true) {
    throw new BrokeragePolicyError(
      "BROKERAGE_PUBLIC_CONSENT_REQUIRED",
      "Confirm the public proof disclosure before creating it.",
    );
  }
  const candidateId =
    typeof input.candidateId === "string" ? input.candidateId : "";
  const { provider, user } = await getReadyProviderUser(userId);
  const candidate = (await provider.listProofCandidates(user))
    .map(normalizeProofCandidate)
    .find((item) => item.id === candidateId);
  if (!candidate) {
    throw new BrokeragePolicyError(
      "BROKERAGE_PROOF_SOURCE_NOT_FOUND",
      "That linked record is no longer available.",
      404,
    );
  }
  await updateConnection(userId, {
    public_consent_at: new Date().toISOString(),
    public_consent_version: BROKERAGE_PUBLIC_CONSENT_VERSION,
  });
  const disclosure = input.disclosure || {};
  const disclosureKey = [
    disclosure.averageCost === true ? "averageCost" : "",
    disclosure.brokerName === true ? "brokerName" : "",
    disclosure.executionPrice === true ? "executionPrice" : "",
    disclosure.executionQuantity === true ? "executionQuantity" : "",
    disclosure.units === true ? "units" : "",
  ].filter(Boolean).join(",");
  const verifiedMinute = candidate.verifiedAsOf.slice(0, 16);
  const fingerprint = createHash("sha256")
    .update(
      `${userId}:${candidate.kind}:${candidate.id}:${verifiedMinute}:${disclosureKey}`,
    )
    .digest("hex");
  const result = await supabaseRpc("create_brokerage_proof", {
    p_account_type: candidate.accountType,
    p_average_cost:
      disclosure.averageCost === true ? candidate.averageCost : null,
    p_broker_name:
      disclosure.brokerName === true ? candidate.brokerName : null,
    p_disclose_average_cost: disclosure.averageCost === true,
    p_disclose_broker_name: disclosure.brokerName === true,
    p_disclose_execution_price: disclosure.executionPrice === true,
    p_disclose_execution_quantity: disclosure.executionQuantity === true,
    p_disclose_units: disclosure.units === true,
    p_execution_date: candidate.executionDate,
    p_execution_price:
      disclosure.executionPrice === true ? candidate.executionPrice : null,
    p_execution_quantity:
      disclosure.executionQuantity === true
        ? candidate.executionQuantity
        : null,
    p_kind: candidate.kind,
    p_owner_user_id: userId,
    p_public_sharing_enabled: config.publicProofsEnabled,
    p_side: candidate.side,
    p_source_fingerprint: fingerprint,
    p_ticker: candidate.ticker,
    p_units: disclosure.units === true ? candidate.units : null,
    p_verification_stage: candidate.stage,
    p_verified_as_of: candidate.verifiedAsOf,
  });
  if (!result.ok) throw mapDatabaseError(result.error, result.status);
  const row = readSingle(result.data);
  if (!row) throw unavailable("Proof response was empty.");
  const proof = await getBrokerageProof(readString(row.id));
  if (!proof) throw unavailable("Proof could not be reloaded.");
  return proof;
}

export async function listOwnBrokerageProofs(userId: string) {
  const result = await supabaseSelect("brokerage_proofs", {
    owner_user_id: `eq.${userId}`,
    order: "created_at.desc",
    select: "*",
    limit: "50",
  });
  if (!result.ok) throw unavailable(result.error);
  return getProofSummaries(readRows(result.data));
}

export async function getBrokerageProof(
  proofId: string,
): Promise<BrokerageProofSummary | null> {
  if (!isUuid(proofId)) return null;
  const result = await supabaseSelect("brokerage_proofs", {
    id: `eq.${proofId}`,
    limit: "1",
    select: "*",
  });
  if (!result.ok) throw unavailable(result.error);
  const [proof] = await getProofSummaries(readRows(result.data));
  return proof || null;
}

export async function getBrokerageProofMapForMessages(
  messageIds: readonly string[],
) {
  return getAttachedProofMap(
    "live_room_message_brokerage_proofs",
    "message_id",
    messageIds,
  );
}

export async function getBrokerageProofMapForPosts(
  postIds: readonly string[],
) {
  return getAttachedProofMap(
    "live_room_post_brokerage_proofs",
    "post_id",
    postIds,
  );
}

export async function hasActiveBrokerageConnection(userId: string) {
  const connection = await getConnection(userId);
  return connection?.status === "connected";
}

async function getAttachedProofMap(
  table: string,
  foreignKey: string,
  ids: readonly string[],
) {
  if (!ids.length) return new Map<string, BrokerageProofSummary>();
  const result = await supabaseSelect(table, {
    [foreignKey]: `in.(${ids.join(",")})`,
    limit: String(ids.length),
    select: `${foreignKey},proof_id`,
  });
  if (!result.ok) throw unavailable(result.error);
  const joins = readRows(result.data);
  const proofIds = [...new Set(joins.map((row) => readString(row.proof_id)).filter(Boolean))];
  if (!proofIds.length) return new Map<string, BrokerageProofSummary>();
  const proofsResult = await supabaseSelect("brokerage_proofs", {
    id: `in.(${proofIds.join(",")})`,
    limit: String(proofIds.length),
    select: "*",
  });
  if (!proofsResult.ok) throw unavailable(proofsResult.error);
  const proofs = await getProofSummaries(readRows(proofsResult.data));
  const proofMap = new Map(proofs.map((proof) => [proof.id, proof]));
  return new Map(
    joins.flatMap((row) => {
      const proof = proofMap.get(readString(row.proof_id));
      return proof ? [[readString(row[foreignKey]), proof] as const] : [];
    }),
  );
}

async function getProofSummaries(rows: Record<string, unknown>[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => readString(row.id));
  const statuses = await supabaseSelect("brokerage_proof_status", {
    proof_id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
    select: "*",
  });
  if (!statuses.ok) throw unavailable(statuses.error);
  const statusMap = new Map(
    readRows(statuses.data).map((row) => [readString(row.proof_id), row]),
  );
  return rows.map((row): BrokerageProofSummary => {
    const status = statusMap.get(readString(row.id));
    return {
      accountType: readString(row.account_type) === "paper" ? "paper" : "live",
      averageCost: row.disclose_average_cost === true ? readNumber(row.average_cost) : null,
      brokerName: row.disclose_broker_name === true ? readString(row.broker_name) || null : null,
      connectionState: readConnectionState(status?.connection_state),
      executionDate: readString(row.execution_date) || null,
      executionPrice: row.disclose_execution_price === true ? readNumber(row.execution_price) : null,
      executionQuantity: row.disclose_execution_quantity === true ? readNumber(row.execution_quantity) : null,
      id: readString(row.id),
      kind: readString(row.kind) === "execution" ? "execution" : "position",
      revoked: Boolean(status?.revoked_at),
      side: readSide(row.side),
      stage: readStage(row.verification_stage),
      ticker: readString(row.ticker),
      units: row.disclose_units === true ? readNumber(row.units) : null,
      verifiedAsOf: readString(row.verified_as_of),
    };
  });
}

async function assertBrokerageEligibility(userId: string) {
  const effective = await getEffectiveUserPlan(userId);
  if (!canUseBrokerage(effective.effectivePlan)) {
    throw new BrokeragePolicyError(
      "BROKERAGE_PLAN_REQUIRED",
      "A Pro, Advanced, or Ultimate plan is required.",
      403,
    );
  }
  return effective;
}

async function getReadyProviderUser(userId: string) {
  const config = getBrokerageConfig();
  const provider = getBrokerageProvider();
  const connection = await getConnection(userId);
  const user =
    connection && config.encryptionKey
      ? readProviderUserOrThrow(connection, config.encryptionKey)
      : null;
  if (!provider || !user || connection?.status !== "connected") {
    throw new BrokeragePolicyError(
      "BROKERAGE_CONNECTION_REQUIRED",
      "Connect a brokerage account first.",
      409,
    );
  }
  return { provider, user };
}

async function getOwnedBrokerageAccount(userId: string, accountId: string) {
  if (!isSafeProviderAccountId(accountId)) {
    throw new BrokeragePolicyError(
      "BROKERAGE_ACCOUNT_NOT_FOUND",
      "That brokerage account is not available.",
      404,
    );
  }
  const { provider, user } = await getReadyProviderUser(userId);
  // Provider account IDs are never trusted from the route. List the signed-in
  // user's accounts first and only then make the account-scoped provider call.
  const accounts = await provider.listAccounts(user);
  const ownedAccount = assertOwnedBrokerageAccount(
    accounts,
    accountId,
  );
  if (!ownedAccount) {
    throw new BrokeragePolicyError(
      "BROKERAGE_ACCOUNT_NOT_FOUND",
      "That brokerage account is not available.",
      404,
    );
  }
  return { accounts, ownedAccount, provider, user };
}

async function readBrokerageManualRefreshQuota(
  userId: string,
  accounts: BrokerageProviderAccount[],
): Promise<BrokerageManualRefreshQuota> {
  const config = getBrokerageConfig();
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const queryStart = new Date(
    monthStart.getTime() -
      Math.max(config.manualRefreshCooldownSeconds, 60 * 60) * 1_000,
  );
  const result = await supabaseSelect("brokerage_manual_refreshes", {
    limit: "1000",
    order: "requested_at.desc",
    requested_at: `gte.${queryStart.toISOString()}`,
    select:
      "status,requested_at,provider_accepted_at,counted_at,provider_authorization_id",
    user_id: `eq.${userId}`,
  });
  if (!result.ok) throw unavailable(result.error);
  const rows = readRows(result.data);
  const monthStartMs = monthStart.getTime();
  const nextMonthMs = nextMonth.getTime();
  const nowMs = now.getTime();
  const used = rows.filter((row) => {
    if (readString(row.status) !== "succeeded") return false;
    const countedAt = readTimestamp(row.counted_at);
    return countedAt >= monthStartMs && countedAt < nextMonthMs;
  }).length;
  const pending = rows.filter((row) => {
    const status = readString(row.status);
    const requestedAt = readTimestamp(row.requested_at);
    if (requestedAt < monthStartMs || requestedAt >= nextMonthMs) return false;
    if (status === "reserved") {
      return requestedAt >= nowMs - 5 * 60 * 1_000;
    }
    if (status === "queued") {
      const acceptedAt = readTimestamp(row.provider_accepted_at);
      return acceptedAt >= nowMs - 60 * 60 * 1_000;
    }
    return false;
  }).length;
  const remaining = Math.max(config.manualRefreshMonthlyLimit - used, 0);
  const available = Math.max(remaining - pending, 0);

  const accountStates = Object.fromEntries(
    accounts.map((account) => {
      const connectionRows = rows.filter(
        (row) =>
          readString(row.provider_authorization_id) ===
          account.providerAuthorizationId,
      );
      const activePending = connectionRows.some((row) => {
        const status = readString(row.status);
        if (status === "reserved") {
          return (
            readTimestamp(row.requested_at) >= nowMs - 5 * 60 * 1_000
          );
        }
        return (
          status === "queued" &&
          readTimestamp(row.provider_accepted_at) >=
            nowMs - 60 * 60 * 1_000
        );
      });
      const lastRequestedAt =
        connectionRows
          .map((row) => readString(row.provider_accepted_at))
          .find(Boolean) || null;
      const retryAfterSeconds = lastRequestedAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date(lastRequestedAt).getTime() +
                config.manualRefreshCooldownSeconds * 1_000 -
                nowMs) /
                1_000,
            ),
          )
        : 0;
      const state =
        account.dataFreshness === "realtime"
          ? { canRefresh: false, status: "realtime" as const }
          : account.dataFreshness !== "delayed"
            ? { canRefresh: false, status: "unavailable" as const }
            : activePending
              ? { canRefresh: false, status: "pending" as const }
              : available === 0
                ? { canRefresh: false, status: "quota_exhausted" as const }
                : retryAfterSeconds > 0
                  ? { canRefresh: false, status: "cooldown" as const }
                  : { canRefresh: true, status: "ready" as const };
      return [
        account.id,
        {
          ...state,
          lastRequestedAt,
          retryAfterSeconds,
        },
      ];
    }),
  );

  return {
    accountStates,
    available,
    cooldownSeconds: config.manualRefreshCooldownSeconds,
    monthlyLimit: config.manualRefreshMonthlyLimit,
    pending,
    remaining,
    resetAt: nextMonth.toISOString(),
    used,
  };
}

async function getConnection(userId: string) {
  const result = await supabaseSelect("brokerage_connections", {
    limit: "1",
    select: "*",
    user_id: `eq.${userId}`,
  });
  if (!result.ok) throw unavailable(result.error);
  return readSingle(result.data) as ConnectionRow | null;
}

function readProviderUser(row: ConnectionRow, key: Buffer): BrokerageProviderUser | null {
  const providerUserId = readString(row.provider_user_id);
  const value: EncryptedBrokerageSecret = {
    authTag: readString(row.secret_auth_tag),
    ciphertext: readString(row.encrypted_user_secret),
    iv: readString(row.secret_iv),
    keyVersion: Number(row.secret_key_version) || 1,
  };
  if (!providerUserId || !value.authTag || !value.ciphertext || !value.iv) return null;
  return { providerUserId, userSecret: decryptBrokerageSecret(value, key) };
}

function readProviderUserOrThrow(
  row: ConnectionRow,
  key: Buffer,
): BrokerageProviderUser | null {
  try {
    return readProviderUser(row, key);
  } catch {
    throw new BrokeragePolicyError(
      "BROKERAGE_CREDENTIALS_RESET_REQUIRED",
      "Reconnect this sandbox brokerage registration before continuing.",
      409,
    );
  }
}

function canDecryptProviderUser(row: ConnectionRow, key: Buffer) {
  try {
    return Boolean(readProviderUser(row, key));
  } catch {
    return false;
  }
}

function hasEncryptedProviderSecret(row: ConnectionRow) {
  return Boolean(
    readString(row.encrypted_user_secret) ||
      readString(row.secret_auth_tag) ||
      readString(row.secret_iv),
  );
}

async function saveRegisteredUser(
  userId: string,
  user: BrokerageProviderUser,
  encrypted: EncryptedBrokerageSecret,
) {
  const result = await supabaseUpdate(
    "brokerage_connections",
    { user_id: `eq.${userId}` },
    {
      encrypted_user_secret: encrypted.ciphertext,
      provider_user_id: user.providerUserId,
      secret_auth_tag: encrypted.authTag,
      secret_iv: encrypted.iv,
      secret_key_version: encrypted.keyVersion,
      status: "registered",
      updated_at: new Date().toISOString(),
    },
  );
  if (!result.ok) throw unavailable(result.error);
}

async function updateConnection(userId: string, payload: Record<string, unknown>) {
  const result = await supabaseUpdate(
    "brokerage_connections",
    { user_id: `eq.${userId}` },
    { ...payload, updated_at: new Date().toISOString() },
  );
  if (!result.ok) throw unavailable(result.error);
}

async function expireProofsForUser(
  userId: string,
  state: "expired" | "disconnected",
) {
  const proofs = await supabaseSelect("brokerage_proofs", {
    owner_user_id: `eq.${userId}`,
    select: "id",
    limit: "1000",
  });
  if (!proofs.ok) throw unavailable(proofs.error);
  const ids = readRows(proofs.data).map((row) => readString(row.id)).filter(Boolean);
  if (!ids.length) return;
  const result = await supabaseUpdate(
    "brokerage_proof_status",
    { proof_id: `in.(${ids.join(",")})` },
    {
      connection_state: state,
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  );
  if (!result.ok) throw unavailable(result.error);
}

function mapDatabaseError(error: string | undefined, status: number) {
  const value = error || "";
  const code = [
    "BROKERAGE_PUBLIC_SHARING_DISABLED",
    "BROKERAGE_PLAN_REQUIRED",
    "BROKERAGE_CONNECTION_REQUIRED",
    "BROKERAGE_PROOF_NOT_ATTACHABLE",
  ].find((candidate) => value.includes(candidate));
  return new BrokeragePolicyError(
    code || "BROKERAGE_UNAVAILABLE",
    code === "BROKERAGE_PUBLIC_SHARING_DISABLED"
      ? "Public sharing is pending provider approval."
      : code === "BROKERAGE_PLAN_REQUIRED"
        ? "A Pro, Advanced, or Ultimate plan is required."
        : code === "BROKERAGE_CONNECTION_REQUIRED"
          ? "Connect a brokerage account first."
          : "The brokerage request could not be completed.",
    status || 502,
  );
}

function mapRefreshDatabaseError(error: string | undefined, status: number) {
  const value = error || "";
  if (value.includes("BROKERAGE_REFRESH_COOLDOWN")) {
    return new BrokeragePolicyError(
      "BROKERAGE_REFRESH_COOLDOWN",
      "Wait 10 minutes before refreshing this brokerage connection again.",
      429,
    );
  }
  if (value.includes("BROKERAGE_REFRESH_LIMIT_REACHED")) {
    return new BrokeragePolicyError(
      "BROKERAGE_REFRESH_LIMIT_REACHED",
      "This month's manual refresh limit is used. Daily automatic sync will continue.",
      429,
    );
  }
  return new BrokeragePolicyError(
    "BROKERAGE_REFRESH_UNAVAILABLE",
    "Manual refresh is temporarily unavailable.",
    status || 502,
  );
}

function unavailable(detail?: string) {
  return new BrokeragePolicyError(
    "BROKERAGE_UNAVAILABLE",
    detail ? "Brokerage data is temporarily unavailable." : "Brokerage data is unavailable.",
    502,
  );
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}
function readSingle(value: unknown) {
  if (Array.isArray(value)) return readRows(value)[0] || null;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function readNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function readTimestamp(value: unknown) {
  const parsed = Date.parse(readString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
function readConnectionState(value: unknown): BrokerageProofSummary["connectionState"] {
  return value === "expired" || value === "disconnected" ? value : "connected";
}
function readSide(value: unknown): BrokerageProofSummary["side"] {
  return value === "SHORT" || value === "BUY" || value === "SELL" ? value : "LONG";
}
function readStage(value: unknown): BrokerageProofSummary["stage"] {
  return value === "historical" || value === "provisional" || value === "final"
    ? value
    : "current";
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeProviderAccountId(value: string) {
  return /^[a-z0-9_-]{1,100}$/i.test(value);
}
