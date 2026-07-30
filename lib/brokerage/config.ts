import "server-only";

import { getServerEnv } from "@/lib/env";
import { readBrokerageEncryptionKey } from "./crypto";

export function getBrokerageConfig() {
  const env = getServerEnv();
  const mockEnabled =
    process.env.NODE_ENV !== "production" && env.snaptradeMockEnabled;
  const realConfigured = Boolean(
    env.snaptradeConnectionsEnabled &&
      env.snaptradeClientId &&
      env.snaptradeConsumerKey,
  );
  let encryptionKey: Buffer | null = null;
  try {
    encryptionKey = readBrokerageEncryptionKey(
      env.snaptradeUserSecretEncryptionKey,
    );
  } catch {
    encryptionKey = null;
  }
  return {
    clientId: env.snaptradeClientId,
    connectionsEnabled: mockEnabled || realConfigured,
    consumerKey: env.snaptradeConsumerKey,
    encryptionKey,
    mockEnabled,
    mode: mockEnabled ? ("mock" as const) : realConfigured ? ("real" as const) : ("unavailable" as const),
    publicProofsEnabled:
      env.snaptradePublicProofsEnabled || mockEnabled,
    manualRefreshCooldownSeconds: clampInteger(
      env.snaptradeManualRefreshCooldownSeconds,
      60,
      86_400,
      600,
    ),
    manualRefreshEstimatedCostCents: clampInteger(
      env.snaptradeManualRefreshEstimatedCostCents,
      0,
      10_000,
      5,
    ),
    manualRefreshMonthlyLimit: clampInteger(
      env.snaptradeManualRefreshMonthlyLimit,
      1,
      1_000,
      20,
    ),
    sandboxBroker:
      process.env.NODE_ENV !== "production" && env.snaptradeSandboxBroker === "SANDBOX"
        ? ("SANDBOX" as const)
        : null,
  };
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
