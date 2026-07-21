import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./GovernanceEventDetails.module.css";

export type GovernanceEventMode =
  | "leadership_change"
  | "auditor_change"
  | "vote_result"
  | "governance_change"
  | "mixed";

export type GovernanceEventChangeDetail = {
  label: string;
  note?: string;
  value: string;
};

export type GovernanceEventChange = {
  category: string;
  details: GovernanceEventChangeDetail[];
  explanation: string;
  title: string;
};

export type GovernanceEventData = {
  changes: GovernanceEventChange[];
  changesTitle: string;
  mode: GovernanceEventMode;
  snapshot: ListingFinancialRiskSnapshotData;
};

export function GovernanceEventSnapshot({ data }: { data: GovernanceEventData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function GovernanceEventChanges({ data }: { data: GovernanceEventData }) {
  if (!data.changes.length) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <h2>{data.changesTitle}</h2>
        <span>{data.changes.length} {data.changes.length === 1 ? "item" : "items"}</span>
      </div>

      <ol className={styles.list}>
        {data.changes.map((change, index) => (
          <li className={styles.change} key={`${change.category}-${change.title}-${index}`}>
            <span className={styles.index} aria-hidden="true">{index + 1}</span>
            <div className={styles.copy}>
              <span className={styles.category}>{change.category}</span>
              <h3>{change.title}</h3>
              {change.explanation ? <p>{change.explanation}</p> : null}
            </div>
            {change.details.length ? (
              <dl className={styles.details}>
                {change.details.map((detail, detailIndex) => (
                  <div className={styles.detail} key={`${detail.label}-${detail.value}-${detailIndex}`}>
                    <dt>{detail.label}</dt>
                    <dd>
                      <strong>{detail.value}</strong>
                      {detail.note ? <span>{detail.note}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
