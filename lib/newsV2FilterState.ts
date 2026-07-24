import type { NewsV2FilterState } from "@/lib/newsV2";

export function hasResettableNewsV2State(
  filters: NewsV2FilterState,
  queryDraft: string,
  appliedQuery: string,
) {
  return (
    queryDraft.length > 0 ||
    appliedQuery.length > 0 ||
    Object.values(filters).some((values) => values.length > 0)
  );
}
