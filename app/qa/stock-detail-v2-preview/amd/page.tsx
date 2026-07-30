import type { Metadata } from "next";
import { StockDetailV2Preview } from "@/components/stock-detail-v2-preview/StockDetailV2Preview";

export const metadata: Metadata = {
  description:
    "Development-only Stock Detail V2 structure preview using sample data.",
  robots: {
    follow: false,
    index: false,
  },
  title: "Stock Detail V2 Preview | Stock Radar",
};

export default function StockDetailV2PreviewPage() {
  return <StockDetailV2Preview />;
}
