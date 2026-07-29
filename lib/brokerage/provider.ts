import "server-only";

import { getBrokerageConfig } from "./config";
import { MockBrokerageProvider } from "./mockProvider";
import { SnapTradeBrokerageProvider } from "./snaptradeProvider";
import type { BrokerageProvider } from "./types";

export function getBrokerageProvider(): BrokerageProvider | null {
  const config = getBrokerageConfig();
  if (config.mode === "mock") return new MockBrokerageProvider();
  if (config.mode === "real") {
    return new SnapTradeBrokerageProvider({
      clientId: config.clientId,
      consumerKey: config.consumerKey,
    });
  }
  return null;
}
