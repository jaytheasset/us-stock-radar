import type { DilutionRegistryCombinedApplyResult } from "./combinedApply.ts";
import { parseDilutionRegistryJson } from "./previewClient.ts";

export type DilutionRegistryApplyUiState =
  | "idle"
  | "saving"
  | "complete"
  | "error";

export const DILUTION_REGISTRY_APPLY_MESSAGES: Record<
  Exclude<DilutionRegistryApplyUiState, "idle">,
  string
> = {
  saving: "Saving...",
  complete: "Apply complete.",
  error: "Could not save the Registry.",
};

export const DILUTION_REGISTRY_RESULT_LABELS = {
  registry: {
    saved: "Saved",
    already_saved: "Already Saved",
    failed: "Failed",
  },
  sharesOutstanding: {
    saved: "Saved",
    already_saved: "Already Saved",
    skipped: "Skipped",
    failed: "Failed",
  },
} as const;

export function isDilutionRegistryApplyEnabled({
  canApply,
  previewedSource,
  source,
  state,
}: {
  canApply: boolean;
  previewedSource: string | null;
  source: string;
  state: DilutionRegistryApplyUiState;
}) {
  return (
    canApply &&
    previewedSource !== null &&
    previewedSource === source &&
    state !== "saving"
  );
}

export async function createDilutionRegistryApplyRequestBody({
  previewedSource,
  source,
}: {
  previewedSource: string | null;
  source: string;
}) {
  if (previewedSource === null || previewedSource !== source) {
    throw new Error("A fresh successful Preview is required before Apply.");
  }
  const parsed = await parseDilutionRegistryJson(source);
  if (!parsed.ok) throw new Error("The exact Preview source is invalid.");
  return previewedSource;
}

export function readDilutionRegistryApplyResponse(
  value: unknown,
): DilutionRegistryCombinedApplyResult | null {
  if (!value || typeof value !== "object") return null;
  const response = value as {
    ok?: unknown;
    registry?: { status?: unknown };
    sharesOutstanding?: {
      status?: unknown;
      verifierStatus?: unknown;
      reasons?: unknown;
    };
  };
  if (response.ok === false) return null;
  const registryStatus = response.registry?.status;
  const osStatus = response.sharesOutstanding?.status;
  const verifierStatus = response.sharesOutstanding?.verifierStatus;
  if (!["saved", "already_saved", "failed"].includes(String(registryStatus))) return null;
  if (!["saved", "already_saved", "skipped", "failed"].includes(String(osStatus))) return null;
  if (verifierStatus !== null && !["Verified", "Review", "Not Verified"].includes(String(verifierStatus))) return null;
  if (!Array.isArray(response.sharesOutstanding?.reasons)
    || response.sharesOutstanding.reasons.some((reason) => typeof reason !== "string")) return null;
  return {
    registry: { status: registryStatus as DilutionRegistryCombinedApplyResult["registry"]["status"] },
    sharesOutstanding: {
      status: osStatus as DilutionRegistryCombinedApplyResult["sharesOutstanding"]["status"],
      verifierStatus: verifierStatus as DilutionRegistryCombinedApplyResult["sharesOutstanding"]["verifierStatus"],
      reasons: [...response.sharesOutstanding.reasons] as string[],
    },
  };
}
