import type { Metadata } from "next";
import { StockRadarFilingsV2 } from "@/components/filings-v2/StockRadarFilingsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Filings v2 | Stock Radar",
  description: "Deterministic mock SEC filings workspace for Stock Radar UI development.",
};

export default function FilingsV2Page() {
  return (
    <StockRadarAppShell activeNavigationItem="filings">
      <StockRadarFilingsV2 />
    </StockRadarAppShell>
  );
}
