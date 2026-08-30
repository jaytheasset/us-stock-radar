import { createDilutionRegistryPasteIdFromSource } from "./pasteIdentity.ts";
import {
  hasDilutionRegistryOsObservationRows,
  parseDilutionRegistryJson,
} from "./preview.ts";

export const DILUTION_REGISTRY_APPLY_PERMISSION = "data.run" as const;

export type DilutionRegistryApplyStatus = "saved" | "already_saved";

type RpcResponse = {
  ok: boolean;
  data: unknown;
  error?: string;
};

export type DilutionRegistryApplyDependencies = {
  rpc: (
    functionName: string,
    payload: Record<string, unknown>,
  ) => Promise<RpcResponse>;
};

export class DilutionRegistryApplyError extends Error {
  readonly kind: "invalid_source" | "unavailable";

  constructor(kind: "invalid_source" | "unavailable", message: string) {
    super(message);
    this.name = "DilutionRegistryApplyError";
    this.kind = kind;
  }
}

export async function applyDilutionRegistrySource(
  source: string,
  dependencies: DilutionRegistryApplyDependencies,
): Promise<{ status: DilutionRegistryApplyStatus }> {
  const parsed = parseDilutionRegistryJson(source);
  if (!parsed.ok) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      "The Dilution Registry source did not pass Preview validation.",
    );
  }
  if (hasDilutionRegistryOsObservationRows(parsed.payload)) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      "Shares Outstanding observations are Preview-only and cannot be saved by the Dilution Registry RPC.",
    );
  }

  const pasteId = createDilutionRegistryPasteIdFromSource(source);
  const payload = JSON.parse(source) as Record<string, unknown>;
  const response = await dependencies.rpc("apply_dilution_registry_v1", {
    p_payload: payload,
    p_paste_id: pasteId,
    p_source: source,
  });

  if (!response.ok) {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry could not be saved.",
    );
  }

  return { status: readApplyStatus(response.data) };
}

export async function runAuthorizedDilutionRegistryApply<TAccess>({
  authorize,
  apply,
}: {
  authorize: (permission: typeof DILUTION_REGISTRY_APPLY_PERMISSION) => Promise<TAccess>;
  apply: () => Promise<{ status: DilutionRegistryApplyStatus }>;
}) {
  const access = await authorize(DILUTION_REGISTRY_APPLY_PERMISSION);
  const result = await apply();
  return { access, result };
}

function readApplyStatus(value: unknown): DilutionRegistryApplyStatus {
  if (!isRecord(value) || typeof value.already_saved !== "boolean") {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry returned an invalid save result.",
    );
  }

  if (!isRecord(value.added)) {
    throw new DilutionRegistryApplyError(
      "unavailable",
      "The Dilution Registry returned an invalid save result.",
    );
  }

  for (const key of ["instruments", "snapshots", "activities", "totals"]) {
    const count = value.added[key];
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new DilutionRegistryApplyError(
        "unavailable",
        "The Dilution Registry returned an invalid save result.",
      );
    }
  }

  return value.already_saved ? "already_saved" : "saved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
