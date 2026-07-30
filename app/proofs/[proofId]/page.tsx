import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  BrokerageProofCard,
  formatBrokerageProofTimestamp,
} from "@/components/brokerage/BrokerageProofCard";
import styles from "@/components/brokerage/Brokerage.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getBrokerageProof } from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Brokerage proof | Stock Radar",
  robots: { follow: false, index: false },
};

export default async function ProofPage({
  params,
}: {
  params: Promise<{ proofId: string }>;
}) {
  const { proofId } = await params;
  const proof = await getBrokerageProof(proofId);
  if (!proof) notFound();
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <section className={styles.page}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>Linked evidence</span>
          <h1>Verified</h1>
          <p>
            {proof.kind === "position" ? "Position" : "Trade"} snapshot
            generated from a read-only brokerage connection.
          </p>
        </header>
        <article className={styles.panel}>
          <BrokerageProofCard proof={proof} />
          <dl className={styles.proofDetails}>
            <div><dt>Verified as of</dt><dd>{formatBrokerageProofTimestamp(proof.verifiedAsOf)}</dd></div>
            <div><dt>Data state</dt><dd>{proof.stage}</dd></div>
            <div><dt>Connection</dt><dd>{proof.connectionState}</dd></div>
            {proof.executionDate ? <div><dt>Execution date</dt><dd>{formatBrokerageProofTimestamp(proof.executionDate)}</dd></div> : null}
            {proof.units !== null ? <div><dt>Units</dt><dd>{proof.units}</dd></div> : null}
            {proof.averageCost !== null ? <div><dt>Average cost</dt><dd>{proof.averageCost}</dd></div> : null}
            {proof.executionPrice !== null ? <div><dt>Execution price</dt><dd>{proof.executionPrice}</dd></div> : null}
            {proof.executionQuantity !== null ? <div><dt>Execution quantity</dt><dd>{proof.executionQuantity}</dd></div> : null}
            {proof.brokerName ? <div><dt>Broker</dt><dd>{proof.brokerName}</dd></div> : null}
          </dl>
          <p className={styles.disclaimer}>
            This verifies linked brokerage data at the stated time, not ownership or the accuracy of the analysis.
          </p>
        </article>
      </section>
    </StockRadarAppShell>
  );
}
