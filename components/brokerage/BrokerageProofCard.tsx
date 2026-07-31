import Link from "next/link";
import { BadgeDollarSign, Clock3, FileClock } from "lucide-react";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import styles from "./Brokerage.module.css";

export function BrokerageProofCard({
  proof,
  compact = false,
  linked = true,
  sample = null,
}: {
  proof: BrokerageProofSummary;
  compact?: boolean;
  linked?: boolean;
  sample?: BrokerageProofSampleDetails | null;
}) {
  const isPosition = proof.kind === "position";
  const historical =
    proof.connectionState !== "connected" ||
    proof.stage === "historical";
  const stateLabel = proof.revoked
    ? "Revoked"
    : isPosition
      ? historical
        ? "Historical"
        : "Current"
      : proof.stage === "final"
        ? "Final"
        : proof.stage === "provisional"
          ? "Provisional"
          : "Historical";
  const accountLabel =
    proof.accountType === "paper"
      ? "Paper · Test funds"
      : "Live account";
  const hiddenExecutionFields = [
    proof.executionQuantity === null ? "Quantity" : null,
    proof.executionPrice === null ? "price" : null,
    proof.brokerName === null ? "broker" : null,
  ].filter(Boolean);
  const disclosureLabel = isPosition
    ? proof.units === null
      ? "Position size hidden"
      : "Position size disclosed"
    : hiddenExecutionFields.length
      ? `${hiddenExecutionFields.join(", ")} hidden`
      : "Execution details disclosed";
  const content = (
    <>
      <span className={styles.proofIcon}>
        {proof.revoked ? (
          <FileClock aria-hidden="true" size={16} />
        ) : (
          <BadgeDollarSign aria-hidden="true" size={16} />
        )}
      </span>
      <span className={styles.proofBody}>
        {sample ? (
          <span className={styles.proofSampleLabel}>
            Sample · Paper test data
          </span>
        ) : null}
        <span className={styles.proofHeading}>
          <strong>
            {isPosition ? "Verified position" : "Verified trade"}
          </strong>
          <span
            className={styles.proofState}
            data-state={stateLabel.toLowerCase()}
          >
            {stateLabel}
          </span>
        </span>
        <span className={styles.proofIdentity}>
          <strong>{proof.ticker}</strong>
          <span className={styles.proofSide}>{proof.side}</span>
          <span
            className={styles.proofAccountType}
            data-account-type={proof.accountType}
          >
            {accountLabel}
          </span>
        </span>
        {proof.executionDate ? (
          <span className={styles.proofTimestamp}>
            <Clock3 aria-hidden="true" size={12} />
            Executed {formatBrokerageProofTimestamp(proof.executionDate)}
          </span>
        ) : null}
        <span className={styles.proofTimestamp}>
          <BadgeDollarSign aria-hidden="true" size={12} />
          Verified {formatBrokerageProofTimestamp(proof.verifiedAsOf)}
        </span>
        {sample?.averageEntry ? (
          <span className={styles.proofSampleMetrics}>
            <span>
              <small>Average entry</small>
              <strong>{sample.averageEntry}</strong>
            </span>
            <span>
              <small>Current price</small>
              <strong>{sample.currentPrice}</strong>
            </span>
            <span>
              <small>Return</small>
              <strong data-tone="positive">{sample.returnPercent}</strong>
            </span>
            <span>
              <small>Quantity</small>
              <strong>{sample.quantity}</strong>
            </span>
          </span>
        ) : null}
        <span className={styles.proofDisclosure}>
          {sample?.averageEntry ? "Full disclosure sample" : disclosureLabel}
        </span>
      </span>
    </>
  );
  const sharedProps = {
    className: styles.proofCard,
    "data-compact": compact ? "true" : "false",
    "data-proof-kind": proof.kind,
    "data-sample": sample ? "true" : "false",
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

type BrokerageProofSampleDetails = {
  averageEntry: string;
  currentPrice: string;
  quantity: string;
  returnPercent: string;
};

export function BrokerageProofSampleCard({
  disclosure,
}: {
  disclosure: "basic" | "full";
}) {
  const proof: BrokerageProofSummary = {
    accountType: "paper",
    averageCost: disclosure === "full" ? 98.2 : null,
    brokerName: null,
    connectionState: "connected",
    executionDate: null,
    executionPrice: null,
    executionQuantity: null,
    id: `local-qa-${disclosure}`,
    kind: "position",
    revoked: false,
    side: "LONG",
    stage: "current",
    ticker: "NVDA",
    units: disclosure === "full" ? 120 : null,
    verifiedAsOf: "2026-07-30T10:30:00.000Z",
  };
  return (
    <BrokerageProofCard
      compact
      linked={false}
      proof={proof}
      sample={
        disclosure === "full"
          ? {
              averageEntry: "$98.20",
              currentPrice: "$135.91",
              quantity: "120",
              returnPercent: "+38.4%",
            }
          : {
              averageEntry: "",
              currentPrice: "",
              quantity: "",
              returnPercent: "",
            }
      }
    />
  );
}

export function formatBrokerageProofTimestamp(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = new Date(dateOnly ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(timestamp.valueOf())) return value;
  const formatted = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: dateOnly ? undefined : "numeric",
    minute: dateOnly ? undefined : "2-digit",
    month: "short",
    timeZone: "America/New_York",
    year: dateOnly ? "numeric" : undefined,
  }).format(timestamp);
  return `${formatted} ET`;
}
