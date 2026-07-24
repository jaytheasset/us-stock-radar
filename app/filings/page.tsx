import type { Metadata } from "next";
import { StockRadarFilingsV2 } from "@/components/filings-v2/StockRadarFilingsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getServerEnv } from "@/lib/env";
import { loadFilingsV2Data } from "@/lib/filingsV2Data";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Filings | Stock Radar",
  description: "Search and review investor-relevant SEC filings.",
};

export default async function FilingsPage() {
  const data = await loadFilingsV2Data();
  const preferredSourceUrl = buildGooglePreferredSourceUrl(getServerEnv().appBaseUrl);

  return (
    <div className={styles.route}>
      <StockRadarAppShell
        activeNavigationItem="filings"
        themeMode="user-selectable"
      >
        <StockRadarFilingsV2 {...data} preferredSourceUrl={preferredSourceUrl} />
      </StockRadarAppShell>
    </div>
  );
}
