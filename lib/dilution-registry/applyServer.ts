import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import { applyDilutionRegistrySource } from "./applyContract.ts";
import {
  appendDilutionCorporateActionProjection,
  type DilutionAdjustmentApplied,
  type DilutionAdjustmentReview,
} from "./corporateActionAdjustment.ts";
import { applyDilutionRegistryAndHumanVerifiedOs } from "./combinedApply.ts";
import { applyHumanVerifiedOsOnServer } from "./humanVerifiedOsServer.ts";
import { runDilutionCorporateActionAdjustmentForIssuer } from "./corporateActionAdjustmentRuntime.ts";

export function applyDilutionRegistrySourceOnServer(source: string) {
  return applyDilutionRegistrySource(source, {
    rpc: supabaseRpc,
    runCorporateActionAdjustmentForIssuer: (input) =>
      runDilutionCorporateActionAdjustmentForIssuer(input),
  });
}

export function appendDilutionCorporateActionProjectionOnServer(
  projection: DilutionAdjustmentApplied | DilutionAdjustmentReview,
) {
  return appendDilutionCorporateActionProjection(projection, { rpc: supabaseRpc });
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
    registryDependencies: {
      rpc: supabaseRpc,
      now: () => new Date(approvedAt),
      runCorporateActionAdjustmentForIssuer: (input) =>
        runDilutionCorporateActionAdjustmentForIssuer(input),
    },
    writeSharesOutstanding: applyHumanVerifiedOsOnServer,
  });
}
