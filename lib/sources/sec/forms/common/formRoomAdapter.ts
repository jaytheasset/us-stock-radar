import {
  deriveSecDeliveryLevel,
  type SecDeliveryLevel,
  type SecDisplayPayload,
  type SecFilingContext,
  type SecRequiredOutputJson,
  type SecTransactionFingerprint,
  validateSecRequiredOutputJson,
} from "./secIntegrationContract";

export type SecDisplayPayloadStorageTarget = "events.metadata.display_payload";
export type SecStructuredPersistenceTarget = "event_offering_terms";
export type SecDisplayPayloadStorageMode = "metadata_only" | "metadata_and_offering_terms_candidate";

export type SecFormRoomAdapterOutput = {
  parser_output: SecRequiredOutputJson["parser_output"];
  analysis_output: SecRequiredOutputJson["analysis_output"] & {
    delivery_level: SecDeliveryLevel;
  };
  display_payload: SecDisplayPayload;
  transaction_fingerprint?: SecTransactionFingerprint | null;
  filing_context?: SecFilingContext | null;
  metadata: {
    display_payload: SecDisplayPayload;
    transaction_fingerprint?: SecTransactionFingerprint | null;
    display_payload_storage_target: SecDisplayPayloadStorageTarget;
    display_payload_storage_mode: SecDisplayPayloadStorageMode;
    candidate_special_metadata_only: boolean;
  };
  structured_persistence_targets: SecStructuredPersistenceTarget[];
};

export type SecFormRoomAdapterResult =
  | {
      ok: true;
      value: SecFormRoomAdapterOutput;
      errors: [];
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
      value?: undefined;
    };

export function adaptSecFormRoomOutputForIngest(value: unknown): SecFormRoomAdapterResult {
  const validation = validateSecRequiredOutputJson(value);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  return {
    ok: true,
    value: toProductionAdapterOutput(validation.value),
    errors: [],
    warnings: validation.warnings,
  };
}

export function getSecDisplayPayloadStorageMode(displayPayload: SecDisplayPayload): SecDisplayPayloadStorageMode {
  if (displayPayload.display_type === "offering_terms") return "metadata_and_offering_terms_candidate";
  return "metadata_only";
}

export function getSecStructuredPersistenceTargets(displayPayload: SecDisplayPayload): SecStructuredPersistenceTarget[] {
  if (displayPayload.display_type === "offering_terms") return ["event_offering_terms"];
  return [];
}

function toProductionAdapterOutput(value: SecRequiredOutputJson): SecFormRoomAdapterOutput {
  const deliveryLevel = deriveSecDeliveryLevel(value.analysis_output.score);
  const displayPayload = value.display_payload;

  return {
    parser_output: value.parser_output,
    display_payload: value.display_payload,
    ...(value.transaction_fingerprint !== undefined ? { transaction_fingerprint: value.transaction_fingerprint } : {}),
    ...(value.filing_context !== undefined ? { filing_context: value.filing_context } : {}),
    analysis_output: {
      ...value.analysis_output,
      delivery_level: deliveryLevel,
    },
    metadata: {
      display_payload: displayPayload,
      ...(value.transaction_fingerprint !== undefined
        ? { transaction_fingerprint: value.transaction_fingerprint }
        : {}),
      display_payload_storage_target: "events.metadata.display_payload",
      display_payload_storage_mode: getSecDisplayPayloadStorageMode(displayPayload),
      candidate_special_metadata_only: displayPayload.display_type === "candidate_special",
    },
    structured_persistence_targets: getSecStructuredPersistenceTargets(displayPayload),
  };
}
