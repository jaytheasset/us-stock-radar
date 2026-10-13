import { reportedHoldingsMonitorSchema, reportedHoldingsSettingsSchema, type ReportedHoldingsMonitor } from "./reportedHoldings.ts";
import { financialTargetSchema, type FinancialTarget } from "./financialMonitorTarget.ts";

export async function createReportedHoldingsMonitor(ownerId: string, settings: unknown, target: FinancialTarget) {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("reported_holding_monitors", {
    user_id: ownerId, settings: reportedHoldingsSettingsSchema.parse(settings), target: financialTargetSchema.parse(target), is_active: true,
    // DB creation clock only. No request timestamp, historical flag or date override.
  }, { prefer: "return=representation" });
  if (!result.ok) throw new Error("reported_holdings_write_failed");
  const row = Array.isArray(result.data) ? result.data[0] : null;
  const parsed = parseReportedHoldingsMonitor(row);
  if (!parsed || parsed.userId !== ownerId) throw new Error("reported_holdings_readback_invalid");
  return parsed;
}
export function parseReportedHoldingsMonitor(row: unknown): ReportedHoldingsMonitor | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const parsed = reportedHoldingsMonitorSchema.safeParse({ id: r.id, userId: r.user_id, target: r.target, settings: r.settings, isActive: r.is_active, createdAt: r.created_at });
  return parsed.success ? parsed.data : null;
}
export async function listReportedHoldingsMonitors(ownerId?: string) {
  const repository = await import("../supabase.ts");
  const monitors: ReportedHoldingsMonitor[] = [], invalidIds: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await repository.supabaseSelect("reported_holding_monitors", { select: "*", ...(ownerId ? { user_id: `eq.${ownerId}` } : { is_active: "eq.true" }), order: "created_at.asc,id.asc", limit: "1000", offset: String(offset) });
    if (!result.ok || !Array.isArray(result.data)) throw new Error("reported_holdings_read_failed");
    for (const row of result.data) {
      const monitor = parseReportedHoldingsMonitor(row);
      if (monitor && (!ownerId || monitor.userId === ownerId)) monitors.push(monitor);
      else invalidIds.push(String(row?.id ?? "unknown"));
    }
    if (result.data.length < 1000) break;
  }
  return { monitors, invalidIds };
}
