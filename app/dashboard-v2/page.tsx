import type { Metadata } from "next";
import { StockRadarDashboardV2 } from "@/components/dashboard-v2/StockRadarDashboardV2";

export const metadata: Metadata = {
  title: "Dashboard v2 | Stock Radar",
  description: "Mock Stock Radar market movers dashboard v2.",
};

export default function DashboardV2Page() {
  return <StockRadarDashboardV2 />;
}
