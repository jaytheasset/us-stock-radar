import type { DashboardV2MoverMode } from "./dashboardV2ExtendedMovers";
import type { DashboardV2MarketMover } from "./dashboardV2Types";
import { supabaseSelect, supabaseUpsert } from "./supabase";

type DataStatus = "ready" | "partial" | "empty" | "unavailable";

export type DashboardMoverSnapshot = {
  asOf: string | null;
  dataAvailability: Record<"events" | "marketCap" | "volume", DataStatus>;
  fetchedAt: string;
  rows: DashboardV2MarketMover[];
  sourceCount: number;
};

export async function readDashboardMoverSnapshot(
  mode: DashboardV2MoverMode,
): Promise<DashboardMoverSnapshot | null> {
  const result = await supabaseSelect("dashboard_mover_snapshots", {
    select: "mode,provider_as_of,captured_at,rows,data_availability,source_count",
    mode: `eq.${mode}`,
    limit: "1",
  });
  if (!result.ok || !Array.isArray(result.data)) return null;
  return normalizeSnapshot(result.data[0]);
}

export async function writeDashboardMoverSnapshot(
  mode: DashboardV2MoverMode,
  snapshot: DashboardMoverSnapshot,
) {
  return supabaseUpsert(
    "dashboard_mover_snapshots",
    {
      captured_at: snapshot.fetchedAt,
      data_availability: snapshot.dataAvailability,
      mode,
      provider_as_of: snapshot.asOf,
      rows: snapshot.rows,
      source_count: snapshot.sourceCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mode" },
  );
}

function normalizeSnapshot(value: unknown): DashboardMoverSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const fetchedAt = stringValue(row.captured_at);
  const sourceCount = numberValue(row.source_count);
  const rows = normalizeRows(row.rows);
  if (!fetchedAt || sourceCount === null || !rows) return null;

  return {
    asOf: stringValue(row.provider_as_of) || null,
    dataAvailability: normalizeAvailability(row.data_availability),
    fetchedAt,
    rows,
    sourceCount,
  };
}

function normalizeRows(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is DashboardV2MarketMover => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<DashboardV2MarketMover>;
    return (
      typeof row.ticker === "string" &&
      typeof row.company === "string" &&
      typeof row.price === "string" &&
      typeof row.priceValue === "number" &&
      typeof row.changePercent === "string" &&
      typeof row.rank === "number" &&
      Array.isArray(row.events)
    );
  });
}

function normalizeAvailability(value: unknown): DashboardMoverSnapshot["dataAvailability"] {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    events: normalizeStatus(row.events),
    marketCap: normalizeStatus(row.marketCap),
    volume: normalizeStatus(row.volume),
  };
}

function normalizeStatus(value: unknown): DataStatus {
  return value === "ready" || value === "partial" || value === "empty" || value === "unavailable"
    ? value
    : "unavailable";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
