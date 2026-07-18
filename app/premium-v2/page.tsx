import type { Metadata } from "next";
import { StockRadarPremiumV2 } from "@/components/premium-v2/StockRadarPremiumV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Premium v2 | Stock Radar",
  description: "Stock Radar Premium alert coverage comparison.",
};

export default function PremiumV2Page() {
  return (
    <StockRadarAppShell
      activeNavigationItem="premium"
      themeMode="user-selectable"
    >
      <StockRadarPremiumV2 />
    </StockRadarAppShell>
  );
}
