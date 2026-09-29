import type { CurrentOwnershipReadResult } from "../monitor/ownershipMonitorPersistence.ts";

export type StockForm4ReportingOwner = Readonly<{
  name: string;
  relation: "direct" | "indirect" | null;
  footnoteIds: readonly string[];
}>;

export type StockForm4Transaction = Readonly<{
  eventId: string;
  accessionNumber: string;
  filingForm: "4" | "4/A";
  filedAt: string;
  transactionIndex: number;
  transactionDate: string | null;
  transactionCode: string | null;
  securityTitle: string | null;
  shares: number | null;
  pricePerShare: number | null;
  reportingOwners: readonly StockForm4ReportingOwner[];
}>;

export function projectStockForm4Transactions(
  current: CurrentOwnershipReadResult,
  symbol: string,
): StockForm4Transaction[] {
  if (current.status !== "available" || current.form !== "form4") return [];
  const filingForm = current.filingForm;
  if (filingForm !== "4" && filingForm !== "4/A") return [];

  const inventory = current.contextEligibility?.status === "eligible"
    ? current.contextEligibility.inventory
    : null;
  const contextRows = current.context?.status === "available"
    ? new Map(current.context.rows.map((item) => [item.rowRef, item.context]))
    : null;
  const footnotes = new Map(inventory?.footnotes.map((item) => [item.footnoteRef, item.xmlId]) ?? []);

  return current.rows.flatMap((row) => {
    if (row.symbol !== symbol || !Number.isInteger(row.transaction_index)) return [];
    const rowRef = `row:form4:${row.transaction_index}`;
    const inventoryRow = inventory?.rows.find((item) => item.rowRef === rowRef);
    const contextRow = contextRows?.get(rowRef);
    const names = stringArray(row.reporting_owner_names);
    const relations = new Map<number, { value: "direct" | "indirect"; footnoteIds: string[] }>();
    const conflictingOwners = new Set<number>();

    if (inventoryRow && contextRow && inventoryRow.ownerNames.length === names.length) {
      for (const assertion of contextRow.assertions) {
        if (
          assertion.fact !== "ownership_relation"
          || assertion.status !== "supported"
          || (assertion.value !== "direct" && assertion.value !== "indirect")
          || typeof assertion.owner_ref !== "string"
        ) continue;
        const ownerIndex = inventoryRow.ownerRefs.indexOf(assertion.owner_ref);
        if (ownerIndex < 0 || names[ownerIndex] !== inventoryRow.ownerNames[ownerIndex]) continue;
        const prior = relations.get(ownerIndex);
        if (prior && prior.value !== assertion.value) {
          conflictingOwners.add(ownerIndex);
          continue;
        }
        const refs = assertion.footnote_refs ?? (assertion.footnote_ref ? [assertion.footnote_ref] : []);
        const footnoteIds = refs.flatMap((ref) => {
          const id = footnotes.get(ref);
          return id ? [id] : [];
        });
        relations.set(ownerIndex, {
          value: assertion.value,
          footnoteIds: [...new Set([...(prior?.footnoteIds ?? []), ...footnoteIds])],
        });
      }
    }

    return [{
      eventId: current.eventId,
      accessionNumber: current.accessionNumber,
      filingForm,
      filedAt: current.filedAt ?? "",
      transactionIndex: row.transaction_index,
      transactionDate: text(row.transaction_date),
      transactionCode: text(row.transaction_code),
      securityTitle: text(row.security_title),
      shares: finiteNumber(row.shares),
      pricePerShare: finiteNumber(row.price_per_share),
      reportingOwners: names.map((name, ownerIndex) => {
        const relation = conflictingOwners.has(ownerIndex) ? null : relations.get(ownerIndex);
        return {
          name,
          relation: relation?.value ?? null,
          footnoteIds: relation?.footnoteIds ?? [],
        };
      }),
    }];
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
