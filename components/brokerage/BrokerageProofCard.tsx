import Link from "next/link";
import { BadgeCheck, FileClock } from "lucide-react";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import styles from "./Brokerage.module.css";

export function BrokerageProofCard({
  proof,
  compact = false,
  linked = true,
}: {
  proof: BrokerageProofSummary;
  compact?: boolean;
  linked?: boolean;
}) {
  const historical =
    proof.connectionState !== "connected" ||
    proof.stage === "historical";
  const content = (
    <>
      {proof.revoked ? <FileClock aria-hidden="true" size={16} /> : <BadgeCheck aria-hidden="true" size={16} />}
      <span className={styles.proofMain}>
        <strong>{proof.kind === "position" ? "Broker-linked position" : "Broker-linked execution"}</strong>
        <span>{proof.ticker} · {proof.side} · {proof.accountType === "paper" ? "Paper account" : "Live account"}</span>
      </span>
      <span className={styles.proofState}>
        {proof.revoked
          ? "Revoked"
          : historical
            ? "Historical snapshot / Connection expired"
            : proof.stage === "provisional"
              ? "Provisional"
              : proof.stage === "final"
                ? "Final"
              : "Current"}
      </span>
    </>
  );
  const sharedProps = {
    className: styles.proofCard,
    "data-compact": compact ? "true" : "false",
    "data-proof-kind": proof.kind,
  };
  if (!linked) {
    return <span {...sharedProps}>{content}</span>;
  }
  return (
    <Link
      {...sharedProps}
      href={`/proofs/${encodeURIComponent(proof.id)}`}
    >
      {content}
    </Link>
  );
}
