import "server-only";
import { readStockHeaderSecIdentity } from "../watchlist/stockHeaderSecIdentity.ts";
import { readStockHeaderCurrent } from "../watchlist/stockHeaderCurrentReader.ts";
import type { SecCurrentSubmissionsResult } from "../sec-structured-data/types.ts";
import { financialTargetSchema, sameFinancialTargetSelection, type FinancialTargetResult, type FinancialTargetSelection } from "./financialMonitorTarget.ts";

/** Reuse the stock header's exact catalog + official current Submissions gate. */
export async function readFinancialMonitorTarget(ticker: string, dependencies: Parameters<typeof readStockHeaderSecIdentity>[1] = {}): Promise<FinancialTargetResult> {
  const snapshots: Extract<SecCurrentSubmissionsResult, { status: "available" }>[] = [];
  const identity = await readStockHeaderSecIdentity(ticker, {
    ...dependencies,
    readCurrent: async cik => {
      const result = await (dependencies.readCurrent ?? readStockHeaderCurrent)(cik);
      if (result.status === "available") snapshots.push(result);
      return result;
    },
  });
  if (identity.status !== "available" || snapshots.length !== 1) return { status: "unavailable" };
  const current = snapshots[0];
  const parsed = financialTargetSchema.safeParse({
    version: "financial_monitor_target_v1", scope: "issuer", ticker: identity.ticker,
    issuerCik: current.cik, companyName: identity.companyName, exchange: identity.exchange,
    sourceRawId: current.sourceRawId, contentHash: current.contentHash,
    refreshSequence: current.refreshSequence, confirmedAt: current.confirmedAt, verifiedAt: new Date().toISOString(),
  });
  return parsed.success ? { status: "available", target: parsed.data } : { status: "unavailable" };
}

export async function verifyFinancialMonitorSelection(selection: FinancialTargetSelection, readTarget = readFinancialMonitorTarget): Promise<FinancialTargetResult> {
  const result = await readTarget(selection.ticker);
  return result.status === "available" && sameFinancialTargetSelection(selection, result.target) ? result : { status: "unavailable" };
}
