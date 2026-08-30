import {
  applyDilutionRegistrySource,
  DilutionRegistryApplyError,
  type DilutionRegistryApplyDependencies,
} from "./applyContract.ts";
import {
  hasDilutionRegistryOsObservationRows,
  parseDilutionRegistryJson,
  type DilutionRegistryPayload,
} from "./preview.ts";
import type {
  HumanVerifiedShareCountApproval,
  HumanVerifiedShareCountWriteResult,
} from "../sec-structured-data/humanVerifiedShareCountObservation.ts";

export type DilutionRegistryCombinedApplyResult = {
  registry: {
    status: "saved" | "already_saved" | "failed";
  };
  sharesOutstanding: {
    status: "saved" | "already_saved" | "skipped" | "failed";
    verifierStatus: "Verified" | "Review" | "Not Verified" | null;
    reasons: string[];
  };
};

export async function applyDilutionRegistryAndHumanVerifiedOs(input: {
  source: string;
  approval: HumanVerifiedShareCountApproval;
  ingestedAt: string;
  registryDependencies: DilutionRegistryApplyDependencies;
  writeSharesOutstanding: (writeInput: {
    payload: DilutionRegistryPayload;
    approval: HumanVerifiedShareCountApproval;
    ingestedAt: string;
  }) => Promise<HumanVerifiedShareCountWriteResult>;
}): Promise<DilutionRegistryCombinedApplyResult> {
  const parsed = parseDilutionRegistryJson(input.source);
  if (!parsed.ok) {
    throw new DilutionRegistryApplyError(
      "invalid_source",
      "The combined Admin source did not pass Preview validation.",
    );
  }

  let registry: DilutionRegistryCombinedApplyResult["registry"];
  try {
    registry = await applyDilutionRegistrySource(
      input.source,
      input.registryDependencies,
    );
  } catch {
    return {
      registry: { status: "failed" },
      sharesOutstanding: {
        status: "skipped",
        verifierStatus: null,
        reasons: ["Shares Outstanding was not attempted because the Registry failed."],
      },
    };
  }

  if (!hasDilutionRegistryOsObservationRows(parsed.payload)) {
    return {
      registry,
      sharesOutstanding: {
        status: "skipped",
        verifierStatus: null,
        reasons: ["No Shares Outstanding observation was supplied."],
      },
    };
  }

  try {
    const result = await input.writeSharesOutstanding({
      payload: parsed.payload,
      approval: input.approval,
      ingestedAt: input.ingestedAt,
    });
    if (result.status === "INSERTED") {
      return {
        registry,
        sharesOutstanding: {
          status: "saved",
          verifierStatus: result.verifierStatus,
          reasons: result.reasons,
        },
      };
    }
    if (result.status === "REPLAY") {
      return {
        registry,
        sharesOutstanding: {
          status: "already_saved",
          verifierStatus: result.verifierStatus,
          reasons: result.reasons,
        },
      };
    }
    return {
      registry,
      sharesOutstanding: {
        status: "skipped",
        verifierStatus: result.verifierStatus,
        reasons: result.reasons,
      },
    };
  } catch {
    return {
      registry,
      sharesOutstanding: {
        status: "failed",
        verifierStatus: null,
        reasons: ["Shares Outstanding could not be saved."],
      },
    };
  }
}
