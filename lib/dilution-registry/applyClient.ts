import type { DilutionRegistryApplyStatus } from "./applyContract.ts";

export type DilutionRegistryApplyUiState =
  | "idle"
  | "saving"
  | DilutionRegistryApplyStatus
  | "error";

export const DILUTION_REGISTRY_APPLY_MESSAGES: Record<
  Exclude<DilutionRegistryApplyUiState, "idle">,
  string
> = {
  saving: "Saving...",
  saved: "Registry saved.",
  already_saved: "Already saved.",
  error: "Could not save the Registry.",
};

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

export function createDilutionRegistryApplyRequestBody({
  previewedSource,
  source,
}: {
  previewedSource: string | null;
  source: string;
}) {
  if (previewedSource === null || previewedSource !== source) {
    throw new Error("A fresh successful Preview is required before Apply.");
  }
  return previewedSource;
}

export function readDilutionRegistryApplyResponse(
  value: unknown,
): DilutionRegistryApplyStatus | null {
  if (!value || typeof value !== "object" || !("status" in value)) return null;
  const status = (value as { status?: unknown }).status;
  return status === "saved" || status === "already_saved" ? status : null;
}
