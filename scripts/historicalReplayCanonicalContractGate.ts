export type HistoricalReplayCurrentCanonicalSelection =
  | {
      status: "available";
      eventId: string;
      parentPrimaryAiRunId: string;
      sourceExecutionId: string;
      analyzerContractVersion: string;
      persistedAt: string;
    }
  | { status: "not_applicable" }
  | { status: "not_ready"; reason: string };

export type HistoricalReplayCanonicalContractState = {
  current_contract_fact_count: number;
  current_contract_result_count: number;
  selected_fact_count: number;
  selected_result_count: number;
  preserved_legacy_or_prior_fact_count: number;
  preserved_legacy_or_prior_result_count: number;
  current_analyzer_contract_version: string;
  selected_source_execution_id: string;
  known_at: string;
};

export function assertHistoricalReplayCanonicalContractState(
  current: HistoricalReplayCurrentCanonicalSelection,
  value: unknown,
): HistoricalReplayCanonicalContractState {
  if (current.status !== "available") {
    const reason = current.status === "not_ready" ? current.reason : "not_applicable";
    throw new Error(`Corporate Action current reader returned ${current.status}: ${reason}`);
  }

  const row = record(value);
  if (!row) throw new Error("Canonical contract integrity query returned no row");

  const currentContractFactCount = integer(row.current_contract_fact_count);
  const currentContractResultCount = integer(row.current_contract_result_count);
  const selectedFactCount = integer(row.selected_fact_count);
  const selectedResultCount = integer(row.selected_result_count);
  const preservedFactCount = integer(row.preserved_legacy_or_prior_fact_count);
  const preservedResultCount = integer(row.preserved_legacy_or_prior_result_count);
  const selectedFactPersistedAt = stringValue(row.selected_fact_persisted_at);

  if (currentContractFactCount !== 1) {
    throw new Error(
      `Expected exactly one canonical fact for current contract ${current.analyzerContractVersion}, found ${currentContractFactCount}`,
    );
  }
  if (currentContractResultCount !== 1) {
    throw new Error(
      `Expected exactly one canonical result for current contract ${current.analyzerContractVersion}, found ${currentContractResultCount}`,
    );
  }
  if (selectedFactCount !== 1 || selectedResultCount !== 1) {
    throw new Error(
      `Production-selected canonical identity is incomplete: fact=${selectedFactCount}, result=${selectedResultCount}`,
    );
  }
  if (!sameInstant(selectedFactPersistedAt, current.persistedAt)) {
    throw new Error("Production-selected canonical fact timestamp does not match the current reader");
  }

  return {
    current_contract_fact_count: currentContractFactCount,
    current_contract_result_count: currentContractResultCount,
    selected_fact_count: selectedFactCount,
    selected_result_count: selectedResultCount,
    preserved_legacy_or_prior_fact_count: preservedFactCount,
    preserved_legacy_or_prior_result_count: preservedResultCount,
    current_analyzer_contract_version: current.analyzerContractVersion,
    selected_source_execution_id: current.sourceExecutionId,
    known_at: new Date(Date.parse(current.persistedAt) + 1_000).toISOString(),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameInstant(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}
