import "server-only";

import { readCurrentOwnershipFacts } from "../monitor/ownershipMonitorPersistence.ts";
import { supabaseSelect } from "../supabase.ts";
import { normalizeStockTicker } from "./stockOverview.ts";
import {
  projectStockForm4Transactions,
  type StockForm4Transaction,
} from "./stockForm4Transactions.ts";

const CANDIDATE_ROW_LIMIT = 100;
const FILING_LIMIT = 12;
const TRANSACTION_LIMIT = 30;

export async function fetchStockForm4Transactions(symbolValue: string): Promise<StockForm4Transaction[]> {
  const symbol = normalizeStockTicker(symbolValue);
  if (!symbol) return [];

  // This indexed lookup discovers event identities only. Every returned row is
  // read again through the official reader before it can reach the stock page.
  const result = await supabaseSelect("event_form4_transactions", {
    select: "event_id",
    symbol: `eq.${symbol}`,
    order: "transaction_date.desc,transaction_index.asc",
    limit: String(CANDIDATE_ROW_LIMIT),
  });
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error("Stored Form 4 transactions are unavailable");
  }
  const eventIds = [...new Set(result.data.flatMap((row) => {
    const id = row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>).event_id
      : null;
    return typeof id === "string" ? [id] : [];
  }))].slice(0, FILING_LIMIT);
  const reads = await Promise.allSettled(eventIds.map((id) => readCurrentOwnershipFacts(id)));
  if (reads.length > 0 && reads.every((read) => read.status === "rejected")) {
    throw new Error("Stored Form 4 transactions are unavailable");
  }
  return reads.flatMap((read) => read.status === "fulfilled"
    ? projectStockForm4Transactions(read.value, symbol)
    : [])
    .sort((left, right) => {
      const leftDate = left.transactionDate ?? left.filedAt;
      const rightDate = right.transactionDate ?? right.filedAt;
      return rightDate.localeCompare(leftDate)
        || right.filedAt.localeCompare(left.filedAt)
        || left.eventId.localeCompare(right.eventId)
        || left.transactionIndex - right.transactionIndex;
    })
    .slice(0, TRANSACTION_LIMIT);
}
