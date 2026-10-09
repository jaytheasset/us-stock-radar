import type { Metadata } from "next";
import { ListingMonitorDraftBuilder } from "@/components/alerts-v2/ListingMonitorDraftBuilder";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Custom alerts — Monitor",
  description: "Tell Stock Radar what to watch, review the conditions, and save conditions for Custom alerts.",
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default function MonitorPage() {
  return (
    <StockRadarAppShell activeNavigationItem="alerts" themeMode="user-selectable">
      <div className={styles.page}>
        <header className={styles.hero}>
          <span>Custom alerts</span>
          <h1>Tell Stock Radar what to watch.</h1>
          <p>Describe the market event, timing, or outcome you care about. Review the result, adjust it, and save conditions for your Custom alerts.</p>
        </header>
        <ListingMonitorDraftBuilder />
      </div>
    </StockRadarAppShell>
  );
}
