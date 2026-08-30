import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import { applyDilutionRegistrySource } from "./applyContract.ts";
import { applyDilutionRegistryAndHumanVerifiedOs } from "./combinedApply.ts";
import { applyHumanVerifiedOsOnServer } from "./humanVerifiedOsServer.ts";

export function applyDilutionRegistrySourceOnServer(source: string) {
  return applyDilutionRegistrySource(source, { rpc: supabaseRpc });
}

export function applyDilutionRegistryAndHumanVerifiedOsOnServer(input: {
  source: string;
  approverUserId: string;
  now?: () => Date;
}) {
  const approvedAt = (input.now ?? (() => new Date()))().toISOString();
  return applyDilutionRegistryAndHumanVerifiedOs({
    source: input.source,
    approval: {
      approverUserId: input.approverUserId,
      approvedAt,
    },
    ingestedAt: approvedAt,
    registryDependencies: { rpc: supabaseRpc },
    writeSharesOutstanding: applyHumanVerifiedOsOnServer,
  });
}
