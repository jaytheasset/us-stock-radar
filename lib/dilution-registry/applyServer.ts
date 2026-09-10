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
import { parseDilutionRegistryJson } from "./preview.ts";
import { runOfferingMonitorAutomaticTriggerForRegistryPayload } from "../monitor/offeringMonitorAutomaticTrigger.ts";

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

export async function applyDilutionRegistryAndHumanVerifiedOsOnServer(input: {
  source: string;
  approverUserId: string;
  now?: () => Date;
}) {
  const approvedAt = (input.now ?? (() => new Date()))().toISOString();
  const result = await applyDilutionRegistryAndHumanVerifiedOs({
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
  if (result.registry.status === "failed") {
    return {
      ...result,
      offeringMonitorAlerts: {
        status: "skipped" as const,
        reason: "Registry Apply failed before Offering Monitor evaluation.",
      },
    };
  }

  const parsed = parseDilutionRegistryJson(input.source);
  if (!parsed.ok) {
    return {
      ...result,
      offeringMonitorAlerts: {
        status: "failed" as const,
        error: "The saved Registry source could not be prepared for Offering Monitor evaluation.",
      },
    };
  }
  try {
    const trigger = await runOfferingMonitorAutomaticTriggerForRegistryPayload({
      payload: parsed.payload,
    });
    return {
      ...result,
      offeringMonitorAlerts: {
        status: "completed" as const,
        trigger,
      },
    };
  } catch (error) {
    return {
      ...result,
      offeringMonitorAlerts: {
        status: "failed" as const,
        error: error instanceof Error
          ? error.message
          : "Offering Monitor evaluation failed after Registry Apply.",
      },
    };
  }
}
