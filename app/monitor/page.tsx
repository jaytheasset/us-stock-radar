import type { Metadata } from "next";
import { ListingMonitorDraftBuilder } from "@/components/alerts-v2/ListingMonitorDraftBuilder";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "AI Monitor",
  description: "Tell Stock Radar what to watch, review the conditions, and create an AI Monitor.",
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default function MonitorPage() {
  return (
    <StockRadarAppShell activeNavigationItem="alerts" themeMode="user-selectable">
      <div className={styles.page}>
        <header className={styles.hero}>
          <span>AI Monitor</span>
          <h1>Tell Stock Radar what to watch.</h1>
          <p>Describe the market event, timing, or outcome you care about. Review the result, adjust it, and create your monitor.</p>
        </header>
        <ListingMonitorDraftBuilder />
      </div>
    </StockRadarAppShell>
  );
}
