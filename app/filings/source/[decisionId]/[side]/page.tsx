import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { readIssuerBoundPublicSecTickerSourceFiling } from "@/lib/sec-ticker-resolution/publicTickerSearch";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  description: "Verified, source-only SEC filing evidence for an effective ticker relationship.",
  title: "SEC Source Filing",
};

type SourceFilingPageProps = {
  params: Promise<{ decisionId: string; side: string }>;
};

export default async function SourceFilingPage({ params }: SourceFilingPageProps) {
  const { decisionId, side } = await params;
  if (side !== "before" && side !== "after") notFound();
  const filing = await readIssuerBoundPublicSecTickerSourceFiling({ decisionId, side });
  if (!filing) notFound();

  return (
    <StockRadarAppShell activeNavigationItem="filings" themeMode="user-selectable">
      <main className={styles.page}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href={`/stocks/${encodeURIComponent(filing.currentTicker)}`}>{filing.currentTicker} overview</Link>
          <span aria-hidden="true">/</span>
          <span>SEC source filing</span>
        </nav>

        <article className={styles.card}>
          <div className={styles.eyebrow}>VERIFIED SEC SOURCE · NO EVENT ANALYSIS</div>
          <header>
            <div>
              <span className={styles.ticker}>{filing.historicalTicker}</span>
              <span className={styles.form}>{filing.formType}</span>
            </div>
            <h1>{filing.historicalTicker} filing source evidence</h1>
            <p>
              This filing keeps the ticker reported by the source. It is linked to the current {filing.currentTicker} research page through an effective, security-specific ticker resolution.
            </p>
          </header>

          <dl className={styles.facts}>
            <div><dt>Historical ticker</dt><dd>{filing.historicalTicker}</dd></div>
            <div><dt>Current ticker</dt><dd>{filing.currentTicker}</dd></div>
            <div><dt>Filed</dt><dd>{filing.filedDate}</dd></div>
            <div><dt>Accepted</dt><dd>{filing.acceptedAt}</dd></div>
            <div><dt>Accession</dt><dd>{filing.accessionNumber}</dd></div>
            <div><dt>Issuer CIK</dt><dd>{filing.issuerCik}</dd></div>
            <div><dt>Security</dt><dd>{filing.securityTitle}</dd></div>
            <div><dt>Exchange</dt><dd>{filing.exchange || "Not stated"}</dd></div>
            <div><dt>Source document</dt><dd>{filing.sourceDocument}</dd></div>
            <div><dt>Analysis state</dt><dd>Source evidence only</dd></div>
          </dl>

          <aside className={styles.notice}>
            <strong>Why this page is separate</strong>
            <p>No synthetic event or event analysis was created for this filing. The page shows only validated, stored SEC source evidence.</p>
          </aside>

          <a className={styles.sourceLink} href={filing.sourceUrl} rel="noreferrer" target="_blank">
            View original SEC filing
            <ExternalLink aria-hidden="true" size={15} />
          </a>
        </article>
      </main>
    </StockRadarAppShell>
  );
}
