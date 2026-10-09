import type { ReactNode } from "react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import type { DetailTone } from "@/app/events/[id]/detailTypes";
import shared from "./GenericFilingAnalysis.module.css";
import styles from "./AnalysisDetailDocument.module.css";

/** Presentation slots for detail families whose data is not a GenericFilingAnalysis. */
export function AnalysisDetailDocument({
  navigation, title, ticker, identity, timestamp, breadcrumb, badges,
  actions, children, rail, original,
}: {
  navigation: "filings" | "news";
  title: string;
  ticker?: string;
  identity: ReactNode;
  timestamp: ReactNode;
  breadcrumb: ReactNode;
  badges: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  rail: ReactNode;
  original?: ReactNode;
}) {
  return (
    <StockRadarAppShell activeNavigationItem={navigation} themeMode="user-selectable">
      <div className={`${shared.page} ${shared.filingDocument} ${styles.document}`}>
        <div className={shared.workspace}>
          <div className={shared.layout}>
            <article className={shared.mainColumn}>
              <header className={shared.hero}>
                <div className={styles.breadcrumb}>{breadcrumb}</div>
                <div className={shared.heroMetaRow}>
                  <div className={shared.heroTimestamp}>{timestamp}</div>
                </div>
                <div className={`${shared.heroIdentity}${ticker ? "" : ` ${shared.heroIdentityWithoutTicker}`}`}>
                  {ticker ? <MarketTickerLogo size="detail" ticker={ticker} /> : null}
                  <div className={shared.heroTitleGroup}>
                    <div className={shared.companyActionRow}>
                      <div className={`${shared.companyLine} ${styles.identity}`}>{identity}</div>
                    </div>
                    <h1>{title}</h1>
                    <div className={shared.classificationActionRow}>
                      <div className={`${shared.classification} ${styles.badges}`}>{badges}</div>
                      {actions ? <div className={shared.heroActions}>{actions}</div> : null}
                    </div>
                  </div>
                </div>
              </header>
              {children}
            </article>
            <aside className={shared.rail}>{rail}</aside>
            {original ? <div className={shared.originalColumn}>{original}</div> : null}
          </div>
        </div>
      </div>
    </StockRadarAppShell>
  );
}

export function AnalysisDetailCard({ children, kind = "copy", className = "" }: {
  children: ReactNode;
  kind?: "copy" | "rail" | "renderer" | "original";
  className?: string;
}) {
  const appearance = kind === "renderer" || kind === "original"
    ? `${shared.rendererCard} ${kind === "original" ? shared.originalRendererCard : ""}`
    : kind === "rail" ? shared.railCard : `${shared.card} ${shared.analysisCopyCard}`;
  return <section className={`${appearance} ${styles.card} ${kind === "original" ? styles.original : ""} ${className}`}>{children}</section>;
}

export function AnalysisDetailImpact({ score, signal }: { score: number; signal: DetailTone }) {
  return (
    <span
      className={`${shared.impactScore} ${shared.signalScore} ${shared[signal]}`}
      aria-label={`${signal} impact score ${score}`}
    >
      <span>{signal}</span>
      <strong data-score-tone={getDirectionalScoreTone(score, signal)}>{score}</strong>
    </span>
  );
}
