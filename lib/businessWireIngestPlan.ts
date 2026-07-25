import {
  buildSourceHydrationIngestPlan,
  partitionSourceHydrationItems,
  type SourceHydrationExistingState,
  type SourceHydrationIngestPlan,
  type SourceHydrationItem,
} from "./sourceHydrationIngestPlan.ts";

export type BusinessWireExistingState<TRaw, TEvent> =
  SourceHydrationExistingState<TRaw, TEvent>;
export type BusinessWireIngestPlan<TItem, TRaw, TEvent> =
  SourceHydrationIngestPlan<TItem, TRaw, TEvent>;
export type BusinessWireHydrationItem = SourceHydrationItem;

export function partitionBusinessWireHydrationItems<
  TItem extends BusinessWireHydrationItem,
>(items: TItem[]) {
  return partitionSourceHydrationItems(items, "businesswire");
}

export async function buildBusinessWireIngestPlan<
  TItem,
  TRaw extends Record<string, unknown>,
  TEvent,
>(
  items: TItem[],
  loadExistingState: (
    item: TItem,
  ) => Promise<BusinessWireExistingState<TRaw, TEvent>>,
  options: { force?: boolean } = {},
): Promise<BusinessWireIngestPlan<TItem, TRaw, TEvent>> {
  return buildSourceHydrationIngestPlan(
    items,
    loadExistingState,
    options,
  );
}
