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
  };
}
